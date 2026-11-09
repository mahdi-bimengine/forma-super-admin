// issues-lattmodell-fonster.js — fönstret "Modellinställningar" som ett
// arbetsflöde i steg (Mahdi, 2026-11-09: "en mer styrd process, ett steg ska
// inte kunna låsa ett annat"). Data, kön och trädet finns i issues-lattmodell.js.
//
//   Översikt  startsidan när modellen finns: status per fil, Uppdatera alla,
//             automatisk uppdatering, Visa modellen, Fortsätt setup, Ändra setup.
//   1 IFC-mapp   mappen med projektets IFC-filer.
//   2 Lagring    mappen där modellen sparas (byts den läggs en flytt i kön).
//   3 Filer      trädet med kryssrutor; Nästa sparar (läggs till i kön, tas bort).
//   4 Färger     disciplinkoden och en färg per disciplin eller fil; Nästa sparar.
//
// Nedtill: ✕ slänger det som inte är sparat, 💾 sparar ett utkast i
// webbläsaren (ilm-utkast:<projekt>) och stänger, Tillbaka och Nästa. Inget
// grånas medan något görs om: allt som tar tid ligger i kön (ilmKoa), och
// bannern längst ner i appen visar den även när fönstret är stängt.

const ILM_STEG = [
  { nr: 1, namn: 'IFC-mapp' },
  { nr: 2, namn: 'Lagring' },
  { nr: 3, namn: 'Filer' },
  { nr: 4, namn: 'Färger' },
];

// ── Utkastet ──────────────────────────────────────────────────────────────────
// Det som valts men inte sparats med Nästa: mappar i steg 1 och 2, kryssen i
// steg 3, färger och disciplinkod i steg 4. Ligger i minnet medan fönstret är
// öppet och i webbläsaren efter 💾. Gäller bara den egna webbläsaren.

function ilmUtkast(pid) {
  if (!_ilm.utkast.has(pid)) _ilm.utkast.set(pid, { ifcMapp: null, lagring: null, farger: new Map(), disciplin: undefined });
  return _ilm.utkast.get(pid);
}

function ilmHarUtkast(pid) {
  const u = _ilm.utkast.get(pid);
  return ilmHarAndringar(pid) || !!(u && (u.ifcMapp || u.lagring || u.farger.size || u.disciplin !== undefined));
}

function ilmSparatUtkast(pid) {
  return isvLasVal(`ilm-utkast:${pid}`, null);
}

function ilmSparaUtkast(pid) {
  const u = ilmUtkast(pid), v = ilmVal(pid);
  isvSparaVal(`ilm-utkast:${pid}`, {
    steg: typeof _ilm.steg === 'number' ? _ilm.steg : 1, sparat: new Date().toISOString(),
    ifcMapp: u.ifcMapp, lagring: u.lagring, farger: [...u.farger], disciplin: u.disciplin ?? null, harDisciplin: u.disciplin !== undefined,
    lagg: [...v.lagg.values()], tabort: [...v.tabort],
  });
}

function ilmLasUtkast(pid) {
  const s = ilmSparatUtkast(pid);
  if (!s) return 1;
  _ilm.utkast.set(pid, { ifcMapp: s.ifcMapp || null, lagring: s.lagring || null, farger: new Map(s.farger || []), disciplin: s.harDisciplin ? s.disciplin : undefined });
  _ilm.val.set(pid, { lagg: new Map((s.lagg || []).map(f => [f.itemId, f])), tabort: new Set(s.tabort || []) });
  return s.steg || 1;
}

function ilmGlomUtkast(pid) {
  _ilm.utkast.delete(pid);
  _ilm.val.delete(pid);
  _ilm.rensaKlar.delete(pid);   // urkryssningen efter ett byte av IFC-mapp görs om nästa gång (ilmRensaUtanfor)
  try { localStorage.removeItem(`ilm-utkast:${pid}`); } catch { /* inte kritiskt */ }
}

// ── Öppna och stänga ──────────────────────────────────────────────────────────

// Finns modellen (båda mapparna och minst en fil)? Då öppnar fönstret på Översikt.
function ilmModellFinns(pid) {
  return !!(ilmIfcMapp(pid) && _ilm.index.get(pid)?.mapp && ilmFiler(pid).length);
}

// Startsteget när förteckningen är läst: Översikt om modellen finns, annars
// det sparade utkastets steg, annars det första steget som inte är klart.
function ilmStartsteg(pid) {
  if (ilmModellFinns(pid)) return 'oversikt';
  if (ilmSparatUtkast(pid)) return ilmLasUtkast(pid);
  if (!ilmIfcMapp(pid)) return 1;
  if (!_ilm.index.get(pid)?.mapp) return 2;
  return 3;
}

function ilmOppna(projektId, steg) {
  const pid = projektId || isvProjektId();
  if (!_ilm.oppen || _ilm.projektId !== pid) ilmLasMinne(pid);
  _ilm.projektId = pid;
  _ilm.steg = steg ?? null;   // null: bestäms när förteckningen är läst
  _ilm.blad = null;
  ilmLasOchTrad(pid);
  if (_ilm.oppen) { ilmRitaNu(); return; }
  _ilm.oppen = true;
  const ruta = document.createElement('div');
  ruta.id = 'ilm-ruta';
  ruta.className = 'fixed inset-0 z-[90] flex items-center justify-center p-6';
  ruta.innerHTML = `
    <div onclick="ilmAvsluta()" class="ilm-bakgrund absolute inset-0 bg-black/40 opacity-0 transition-opacity motion-reduce:transition-none" style="transition-duration: ${ILM_ANIMERING_MS}ms"></div>
    <div role="dialog" aria-modal="true" aria-labelledby="ilm-rubrik"
         class="ilm-fonster relative bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col text-sm
                opacity-0 translate-y-4 scale-[0.97] transition ease-out motion-reduce:transition-none" style="transition-duration: ${ILM_ANIMERING_MS}ms">
      <div id="ilm-innehall" class="flex flex-col min-h-0 flex-1"></div>
    </div>`;
  document.body.appendChild(ruta);
  document.addEventListener('keydown', ilmTangent, true);
  ilmRitaNu();
  ilmRitaBanner();
  const fonster = ruta.querySelector('.ilm-fonster');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ruta.querySelector('.ilm-bakgrund')?.classList.remove('opacity-0');
    fonster.classList.remove('opacity-0', 'translate-y-4', 'scale-[0.97]');
  }));
}

function ilmStangFonster() {
  const ruta = document.getElementById('ilm-ruta');
  ilmStangFargMeny();
  _ilm.oppen = false;
  _ilm.blad = null;
  _ilm.steg = null;
  document.removeEventListener('keydown', ilmTangent, true);
  ilmRitaBanner();
  if (!ruta) return;
  ruta.querySelector('.ilm-bakgrund')?.classList.add('opacity-0');
  ruta.querySelector('.ilm-fonster')?.classList.add('opacity-0', 'translate-y-4', 'scale-[0.97]');
  ruta.style.pointerEvents = 'none';
  setTimeout(() => ruta.remove(), ILM_ANIMERING_MS);
}

// ✕, Esc och klick utanför: det som inte är sparat slängs (efter en fråga).
// Det som redan sparats med Nästa, och det som ligger i kön, finns kvar.
function ilmAvsluta() {
  const pid = _ilm.projektId;
  if (ilmHarUtkast(pid) && !confirm('Ändringar som inte har sparats med Nästa slängs.\n\nDet som redan är sparat, och filer som görs om, påverkas inte.\n\nAvbryta ändå?')) return;
  ilmGlomUtkast(pid);
  ilmStangFonster();
}

// 💾: utkastet sparas i webbläsaren och fönstret stängs. Fortsätt från Översikt.
function ilmPausa() {
  const pid = _ilm.projektId;
  if (ilmHarUtkast(pid) || typeof _ilm.steg === 'number') ilmSparaUtkast(pid);
  ilmStangFonster();
}

function ilmTangent(e) {
  if (!_ilm.oppen) return;
  const mal = e.target;
  const skriver = /^(INPUT|SELECT|TEXTAREA)$/.test(mal?.tagName || '') && !['checkbox', 'radio'].includes(mal.type);
  if (e.key === '/' && !skriver && !e.ctrlKey && !e.metaKey && !e.altKey && _ilm.steg === 3) {
    const sok = document.getElementById('ilm-sok');
    if (sok) { e.preventDefault(); sok.focus(); sok.select(); }
    return;
  }
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  if (_ilm.fargMeny) { ilmStangFargMeny(); return; }
  if (mal?.id === 'ilm-sok' && mal.value) { e.preventDefault(); mal.value = ''; ilmSattFilter('sok', ''); return; }
  ilmAvsluta();
}

function ilmValjProjekt(projektId) {
  if (ilmHarUtkast(_ilm.projektId)) ilmSparaUtkast(_ilm.projektId);
  ilmLasMinne(projektId);
  _ilm.projektId = projektId;
  _ilm.steg = null;
  _ilm.blad = null;
  ilmLasOchTrad(projektId);
  ilmRitaNu();
}

// ── Stegen ────────────────────────────────────────────────────────────────────

// Är steget klart (bock)? 3 och 4 kräver att mapparna finns.
function ilmStegKlart(pid, nr) {
  const ix = _ilm.index.get(pid);
  if (nr === 1) return !!ilmIfcMapp(pid);
  if (nr === 2) return !!ix?.mapp;
  return !!ilmIfcMapp(pid) && !!ix?.mapp && ilmFiler(pid).length > 0;
}

function ilmStegTillgangligt(pid, nr) {
  return nr <= 2 || (ilmStegKlart(pid, 1) && ilmStegKlart(pid, 2));
}

// Röd prick: något behöver göras. Blå: något pågår.
function ilmStegPrick(pid, nr) {
  const ix = _ilm.index.get(pid);
  const flytt = _ilm.jobb.get(`${pid}|flytt`);
  if (nr === 2) return flytt?.fel || ix?.fel ? 'rod' : flytt ? 'bla' : '';
  if (nr === 3) return ilmPagar(pid).some(j => j.kalla !== 'flytt') ? 'bla' : '';
  return '';
}

function ilmGaTillSteg(nr) {
  const pid = _ilm.projektId;
  if (typeof nr === 'number' && !ilmStegTillgangligt(pid, nr)) return;
  ilmStangFargMeny();
  _ilm.steg = nr;
  _ilm.blad = null;
  ilmRitaNu();
}

// "Ändra setup" går igenom stegen med det som finns ifyllt.
function ilmAndraSetup() {
  ilmGaTillSteg(1);
}

function ilmFortsattSetup() {
  ilmGaTillSteg(ilmLasUtkast(_ilm.projektId));
}

// Nästa: sparar steget och går vidare. Misslyckas sparningen stannar man kvar
// och felet står i steget.
async function ilmNasta() {
  const pid = _ilm.projektId;
  const steg = _ilm.steg;
  if (_ilm.sparar) return;
  _ilm.sparar = true;
  _ilm.stegFel = null;
  ilmRitaNu();
  try {
    if (steg === 1) await ilmSparaSteg1(pid);
    if (steg === 2) await ilmSparaSteg2(pid);
    if (steg === 3) { if (!await ilmSparaSteg3(pid)) return; }
    if (steg === 4) await ilmSparaSteg4(pid);
    _ilm.blad = null;
    if (steg === 4) {
      // Klar: utkastet är förbrukat.
      try { localStorage.removeItem(`ilm-utkast:${pid}`); } catch { /* inte kritiskt */ }
      _ilm.steg = 'oversikt';
    } else {
      _ilm.steg = steg + 1;
    }
  } catch (err) {
    console.warn('Modellinställningar: steg', steg, err);
    _ilm.stegFel = ilmAccFel(err);
  } finally {
    _ilm.sparar = false;
    ilmRitaNu();
  }
}

function ilmTillbaka() {
  const s = _ilm.steg;
  ilmGaTillSteg(s === 1 ? 'oversikt' : s - 1);
}

// ── Ritningen ─────────────────────────────────────────────────────────────────

// Omritningar samlas till en per bildruta (jobbens förlopp och läsningen ber om många).
function ilmRita() {
  ilmRitaBanner();
  if (!_ilm.oppen || _ilm.ritar) return;
  _ilm.ritar = true;
  requestAnimationFrame(() => { _ilm.ritar = false; ilmRitaNu(); });
}

function ilmRitaNu() {
  const inne = document.getElementById('ilm-innehall');
  if (!inne) return;
  const pid = _ilm.projektId;
  const ix = _ilm.index.get(pid);
  if (_ilm.steg == null && ix && !ix.laddar) _ilm.steg = ilmStartsteg(pid);
  const steg = _ilm.steg ?? 'laddar';
  // Skalet byggs om bara när steget eller projektet byts, så att sökfältet
  // behåller fokus och öppna listor inte stängs när förloppet uppdateras.
  const vy = `${steg}|${pid}`;
  if (inne.dataset.vy !== vy) {
    inne.dataset.vy = vy;
    ilmStangFargMeny();
    inne.innerHTML = `
      ${ilmHuvudHtml(pid)}
      <div id="ilm-stegrad" class="shrink-0 px-5 py-2.5 border-b border-ads-border"></div>
      ${steg === 3 ? ilmSkalHtml() : '<div id="ilm-sida" class="flex-1 min-h-0 overflow-y-auto text-xs"></div>'}
      <div id="ilm-fot" class="shrink-0 border-t border-ads-border bg-ads-gray/50 rounded-b-lg"></div>`;
    if (steg === 1 || steg === 2) ilmOppnaMappval(steg);
    if (steg === 3) _ilm.rensaKlar.delete(pid);
  }
  ilmSatt(document.getElementById('ilm-stegrad'), ilmStegradHtml(pid, steg));
  if (steg === 3) {
    ilmRensaUtanfor(pid);
    ilmRitaFilter(pid);
    ilmRitaLista(pid);
    ilmRitaStatus(pid);
  } else {
    const sida = document.getElementById('ilm-sida');
    if (steg === 'laddar') ilmSatt(sida, ilmMitten('Letar efter modellens inställningar i projektet…'));
    if (steg === 'oversikt') ilmSatt(sida, ilmOversiktHtml(pid));
    if (steg === 1 || steg === 2) { ilmSatt(sida, ilmMappStegHtml(pid, steg)); ilmBladRita(); }
    if (steg === 4) ilmSatt(sida, ilmFargStegHtml(pid));
  }
  ilmSatt(document.getElementById('ilm-fot'), ilmFotHtml(pid, steg));
}

function ilmHuvudHtml(pid) {
  const flera = _is.projekt.size > 1;
  return `
    <div class="shrink-0 flex items-start gap-3 px-5 pt-4 pb-3 border-b border-ads-border">
      <div class="min-w-0">
        <h3 id="ilm-rubrik" class="text-base font-semibold text-ads-text">Modellinställningar</h3>
        ${flera ? `
          <select onchange="ilmValjProjekt(this.value)" class="mt-1 text-xs border border-ads-border rounded px-1.5 py-0.5 max-w-full">
            ${[..._is.projekt.values()].map(p => `<option value="${vkEsc(p.id)}" ${p.id === pid ? 'selected' : ''}>${vkEsc(p.namn)}</option>`).join('')}
          </select>`
          : `<p class="text-xs text-ads-muted mt-0.5">${vkEsc(_is.projekt.get(pid)?.namn || '')}</p>`}
      </div>
      <span class="flex-1"></span>
      <button onclick="ilmAvsluta()" class="text-ads-muted hover:text-ads-text text-lg leading-none" title="Stäng (Esc)">✕</button>
    </div>`;
}

// Stegraden: Översikt (när modellen finns), sedan 1–4 med bock eller nummer.
function ilmStegradHtml(pid, steg) {
  const flik = (nyckel, inne, aktiv, kan, titel) => `
    <button onclick="ilmGaTillSteg(${typeof nyckel === 'number' ? nyckel : `'${nyckel}'`})" ${kan ? '' : 'disabled'} title="${vkEsc(titel)}"
            class="flex items-center gap-2 px-2.5 py-1.5 rounded text-xs whitespace-nowrap ${aktiv ? 'bg-ads-blue/10 text-ads-blue font-semibold' : kan ? 'text-ads-text hover:bg-ads-gray' : 'text-ads-muted/60 cursor-not-allowed'}">${inne}</button>`;
  const delar = [];
  if (ilmModellFinns(pid)) delar.push(flik('oversikt', 'Översikt', steg === 'oversikt', true, 'Modellens filer och status'));
  for (const s of ILM_STEG) {
    const klart = ilmStegKlart(pid, s.nr);
    const kan = ilmStegTillgangligt(pid, s.nr);
    const prick = ilmStegPrick(pid, s.nr);
    const cirkel = `<span class="relative w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold
        ${steg === s.nr ? 'bg-ads-blue text-white' : klart ? 'bg-green-600 text-white' : 'bg-ads-gray text-ads-muted'}">${klart && steg !== s.nr ? '✓' : s.nr}
        ${prick ? `<span class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white ${prick === 'rod' ? 'bg-red-600' : 'bg-ads-blue'}"></span>` : ''}</span>`;
    delar.push(flik(s.nr, `${cirkel}${s.namn}`, steg === s.nr, kan, kan ? s.namn : 'Välj först IFC-mapp och lagring'));
  }
  return `<div class="flex items-center gap-1 flex-wrap">${delar.join('<span class="text-ads-border">›</span>')}</div>`;
}

// Foten: ✕ och 💾 till vänster om Tillbaka och Nästa (Mahdi, 2026-11-09).
function ilmFotHtml(pid, steg) {
  if (steg === 'oversikt' || steg === 'laddar') {
    return `<div class="flex items-center gap-2 px-5 py-3"><div class="flex-1"></div>${ilmKnapp('ilmStangFonster()', 'Stäng')}</div>`;
  }
  const ikon = (klick, tecken, titel) => `
    <button onclick="${klick}" title="${titel}" class="w-8 h-8 flex items-center justify-center border border-ads-border rounded bg-white text-ads-muted hover:text-ads-text hover:border-ads-blue">${tecken}</button>`;
  const nasta = steg === 4 ? 'Spara och klar' : steg === 3 && ilmHarAndringar(pid) ? 'Spara och nästa' : 'Nästa';
  const kanNasta = !_ilm.sparar && ilmKanGaVidare(pid, steg);
  return `
    <div class="flex items-center gap-2 px-5 py-3">
      <div class="text-xs min-w-0 truncate">${_ilm.stegFel ? `<span class="text-red-700">${vkEsc(_ilm.stegFel)}</span>`
        : _ilm.sparar ? '<span class="text-ads-blue">Sparar i ACC…</span>' : ilmStegHint(pid, steg)}</div>
      <div class="flex-1"></div>
      ${ikon('ilmAvsluta()', '✕', 'Avbryt: det som inte är sparat slängs')}
      ${ikon('ilmPausa()', '💾', 'Spara och fortsätt senare: utkastet sparas i din webbläsare')}
      ${ilmKnapp('ilmTillbaka()', 'Tillbaka')}
      ${ilmKnapp('ilmNasta()', nasta, ILM_KNAPP_HUVUD, kanNasta ? '' : 'disabled')}
    </div>`;
}

// Nästa kräver ett val i steg 1 och 2 (antingen redan sparat eller nyss valt).
function ilmKanGaVidare(pid, steg) {
  if (steg === 1) return !!(ilmUtkast(pid).ifcMapp || ilmIfcMapp(pid));
  if (steg === 2) return !!(ilmUtkast(pid).lagring || _ilm.index.get(pid)?.mapp);
  return true;
}

function ilmStegHint(pid, steg) {
  const v = ilmVal(pid);
  if (steg === 3 && ilmHarAndringar(pid)) {
    const delar = [v.lagg.size ? `lägg till ${v.lagg.size}` : '', v.tabort.size ? `ta bort ${v.tabort.size}` : ''].filter(Boolean).join(', ');
    return `<span class="text-ads-blue font-medium">${delar[0].toUpperCase()}${delar.slice(1)}. Sparas med Nästa.</span>`;
  }
  if (steg === 4 && (ilmUtkast(pid).farger.size || ilmUtkast(pid).disciplin !== undefined)) return '<span class="text-ads-blue font-medium">Ändrade färger sparas med Nästa.</span>';
  return '';
}

// ── Steg 1 och 2: mapparna ────────────────────────────────────────────────────
// Mappträdet byggs en gång per steg (ilmOppnaMappval) och ritas sedan om i
// #ilm-kropp med behållen rullning. Det valda läggs i utkastet; Nästa sparar.

let _ilmBladNrSteg = 0;

function ilmOppnaMappval(steg) {
  const pid = _ilm.projektId;
  const syfte = steg === 1 ? 'ifc' : 'lagring';
  const u = ilmUtkast(pid);
  const nu = syfte === 'ifc' ? ilmIfcMapp(pid) : _ilm.index.get(pid)?.mapp;
  const vald = (syfte === 'ifc' ? u.ifcMapp : u.lagring) || nu;
  const b = {
    id: `blad${++_ilmBladNrSteg}`, syfte, pid, topp: { laddar: true }, innehall: new Map(), oppna: new Set(), noder: [],
    vald: vald ? { id: vald.id, namn: '', sokvag: vald.sokvag } : null, nu: nu?.id || null,
  };
  _ilm.blad = b;
  getTopFolders(ilmHub(), pid).then(
    items => { if (_ilm.blad !== b) return; b.topp = { items: items.filter(f => !ilmDoljMapp(f)) }; ilmBladRita(); },
    err   => { if (_ilm.blad !== b) return; b.topp = { fel: vkFelText(err) }; ilmBladRita(); });
}

function ilmBladRita() {
  const b = _ilm.blad;
  const kropp = document.getElementById('ilm-kropp');
  if (!b || !kropp) return;
  const rull = kropp.scrollTop;
  kropp.innerHTML = ilmBladTradHtml(b);
  kropp.scrollTop = rull;
}

// Ett klick i trädet: valet hamnar i utkastet.
function ilmBladKlick(i) {
  const b = _ilm.blad;
  const nod = b?.noder[i];
  if (!nod) return;
  b.vald = nod;
  const u = ilmUtkast(b.pid);
  const mapp = nod.id === b.nu ? null : { id: nod.id, sokvag: nod.sokvag };
  if (b.syfte === 'ifc') u.ifcMapp = mapp; else u.lagring = mapp;
  ilmRitaNu();
}

function ilmMappStegHtml(pid, steg) {
  const ix = _ilm.index.get(pid);
  const u = ilmUtkast(pid);
  const ifc = steg === 1;
  const nu = ifc ? ilmIfcMapp(pid) : ix?.mapp;
  const vald = ifc ? u.ifcMapp : u.lagring;
  const flytt = _ilm.jobb.get(`${pid}|flytt`);
  const pagar = ilmPagar(pid).filter(j => j.kalla !== 'flytt');
  const rad = (etikett, varde) => `<div class="flex items-baseline gap-3"><span class="w-28 shrink-0 text-ads-muted">${etikett}</span><div class="min-w-0 flex-1">${varde}</div></div>`;
  const mapp = m => `<span class="font-medium text-ads-text" title="${vkEsc(m.sokvag || '')}">${vkEsc(m.sokvag || 'vald mapp')}</span> ${ilmAccLank(pid, m)}`;
  const info = [];
  if (nu) info.push(rad('Nu', mapp(nu)));
  if (vald) info.push(rad('Ny', `<span class="font-medium text-ads-blue">${vkEsc(vald.sokvag)}</span> <span class="text-ads-muted">sparas med Nästa</span>`));
  if (ifc && vald && ilmFiler(pid).length) {
    info.push(`<div class="rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">Filer i modellen som inte ligger under den nya mappen tas bort ur modellen.
      Du ser vilka i steg 3 innan något sparas.</div>`);
  }
  if (!ifc && vald && ix?.mapp) {
    info.push(`<div class="rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">Modellen kopieras till den nya mappen${pagar.length
      ? ` när ${pagar.length} ${pagar.length === 1 ? 'fil' : 'filer'} som görs om är klara` : ''}. Den gamla mappen kan tas bort när flytten är klar, inte innan.</div>`);
  }
  if (!ifc) {
    if (flytt) {
      const vantar = _ilm.ko.includes(`${pid}|flytt`);
      info.push(`<div class="rounded px-2 py-1.5 text-[11px] ${flytt.fel ? 'bg-red-50 text-red-700' : 'bg-ads-blue/10 text-ads-blue'}">${vkEsc(flytt.fel
        || (vantar ? `Flyttas till ${flytt.mapp.sokvag} när ${pagar.length} ${pagar.length === 1 ? 'fil' : 'filer'} som görs om är klara.` : `${flytt.namn}: ${ilmJobbText(flytt)}`))}</div>`);
    }
    if (ix?.flyttadFran && !flytt) info.push(`<div class="rounded bg-green-50 px-2 py-1.5 text-[11px] text-green-800">Flytten är klar. Den gamla mappen ${vkEsc(ix.flyttadFran.sokvag)} kan tas bort i ACC.</div>`);
    if (ix?.dubletter) info.push(`<div class="text-[11px] text-amber-700">Modellen finns sparad på ${ix.dubletter === 1 ? 'ett ställe' : `${ix.dubletter} ställen`} till i projektet. Den senast ändrade används.</div>`);
    if (ix?.fel) info.push(`<div class="text-[11px] text-red-700">${vkEsc(ix.fel)} ${ilmLank(`ilmLas('${vkEsc(pid)}', true)`, 'Försök igen')}</div>`);
    if (ix?.mapp) info.push(`<div class="text-[11px]">${ilmLank(`ilmVisaGamla('${vkEsc(pid)}')`, _ilm.gamla?.pid === pid ? 'Dölj gamla modellfiler' : 'Visa gamla modellfiler i mappen')}${ilmGamlaHtml(pid)}</div>`);
  }
  return `
    <div class="flex flex-col h-full">
      <div class="shrink-0 px-6 pt-4 pb-3 border-b border-ads-border/60">
        <h4 class="text-sm font-semibold text-ads-text">${ifc ? 'Var ligger projektets IFC-filer?' : 'Var ska modellen sparas?'}</h4>
        <p class="text-ads-muted mt-1">${ifc
          ? `Välj den översta mappen. Allt under den visas i steg 3, utom mappar utan IFC-filer, dolda mappar och mappar med ${ILM_ARKIV_TEXT} i namnet.`
          : 'Välj en mapp där du får skapa filer, gärna en egen mapp för modellen. Alla i projektet läser modellen därifrån. Ta inte bort mappen i ACC.'}
          Valet gäller alla i projektet.</p>
        ${info.length ? `<div class="mt-3 flex flex-col gap-1.5">${info.join('')}</div>` : ''}
      </div>
      <div id="ilm-kropp" class="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-xs"></div>
    </div>`;
}

async function ilmSparaSteg1(pid) {
  const u = ilmUtkast(pid);
  if (!u.ifcMapp) return;
  const mapp = u.ifcMapp;
  // Filer utanför den nya mappen kryssas ur i steg 3 när trädet är läst. Det
  // minns (också i webbläsaren) tills steg 3 sparas, så ✕ eller 💾 hoppar inte över det.
  if (ilmFiler(pid).length) { _ilm.rensa.set(pid, mapp.id); isvSparaVal(`ilm-rensa:${pid}`, mapp.id); }
  await ilmSattIfcMapp(pid, mapp);
  u.ifcMapp = null;
}

async function ilmSparaSteg2(pid) {
  const u = ilmUtkast(pid);
  if (!u.lagring) return;
  await ilmSattLagring(pid, u.lagring);
  u.lagring = null;
}

// Efter ett byte av IFC-mapp: filer i modellen som inte finns i den nya mappens
// träd kryssas ur (Mahdi: "behåll inte"), en gång varje gång steg 3 öppnas, tills
// steg 3 sparas. De syns som "tas bort" tills Nästa.
function ilmRensaUtanfor(pid) {
  const mappId = _ilm.rensa.get(pid) || isvLasVal(`ilm-rensa:${pid}`, null);
  const t = ilmTrad(pid);
  if (!mappId || _ilm.rensaKlar.has(pid) || !t?.data || t.laddar || t.mappId !== mappId) return;
  _ilm.rensaKlar.add(pid);
  const x = ilmTradIndex(t.data);
  const v = ilmVal(pid);
  for (const f of ilmFiler(pid)) if (!x.filer.has(f.ifc.itemId)) v.tabort.add(f.ifc.itemId);
}

// ── Steg 3: filerna ───────────────────────────────────────────────────────────

function ilmRensaKlar(pid) {
  _ilm.rensa.delete(pid);
  try { localStorage.removeItem(`ilm-rensa:${pid}`); } catch { /* inte kritiskt */ }
}

// Sökfältet ritas bara en gång (fokus); resten ritas om med ilmSatt.
function ilmSkalHtml() {
  return `
    <div class="shrink-0 px-5 pt-3 pb-2 flex flex-col gap-2 border-b border-ads-border/60">
      <div class="flex items-center gap-2 flex-wrap">
        <input id="ilm-sok" type="search" autocomplete="off" spellcheck="false" value="${vkEsc(_ilm.filter.sok)}" oninput="ilmSattFilter('sok', this.value)"
               placeholder="Sök på filnamn eller mapp" title="Tryck / för att söka"
               class="flex-1 min-w-[14rem] text-sm border border-ads-border rounded px-3 py-1.5 focus:outline-none focus:border-ads-blue" />
        <span id="ilm-filterknappar" class="contents"></span>
      </div>
      <div id="ilm-merfilter"></div>
      <div class="flex items-center gap-3 text-[11px] text-ads-muted min-h-[1rem]">
        <span id="ilm-status-text" class="truncate flex items-center gap-1.5 min-w-0"></span>
        <span class="flex-1"></span>
        <span id="ilm-status-knappar" class="flex items-center gap-3 whitespace-nowrap"></span>
      </div>
    </div>
    <div id="ilm-rulla" class="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-xs"></div>`;
}

function ilmRitaVal(pid) {
  ilmRitaLista(pid);
  ilmRitaStatus(pid);
  ilmSatt(document.getElementById('ilm-fot'), ilmFotHtml(pid, _ilm.steg));
}

// Sparar kryssen: urkryssade tas bort ur modellen (och ur kön), ikryssade läggs
// i kön. Returnerar false om användaren ångrade sig.
async function ilmSparaSteg3(pid) {
  const v = ilmVal(pid);
  const lagg = [...v.lagg.values()];
  const tabort = [...v.tabort];
  if (!lagg.length && !tabort.length) { ilmRensaKlar(pid); return true; }
  if (tabort.length) {
    const namn = tabort.map(id => ilmFiler(pid).find(f => f.ifc.itemId === id)?.ifc.namn || ilmJobbFor(pid, id)?.namn).filter(Boolean).map(n => `• ${n}`);
    const lista = namn.slice(0, 15).join('\n') + (namn.length > 15 ? `\n… och ${namn.length - 15} till` : '');
    if (!confirm(`Ta bort ${tabort.length} ${tabort.length === 1 ? 'fil' : 'filer'} ur modellen?\n\n${lista}\n\nIFC-filerna ligger kvar i ACC.`)) return false;
    for (const id of tabort) ilmAvbryt(pid, id);
    const iModellen = tabort.filter(id => ilmFiler(pid).some(f => f.ifc.itemId === id));
    if (iModellen.length) await ilmSkrivIndex(pid, d => { d.filer = d.filer.filter(x => !iModellen.includes(x.ifc.itemId)); });
  }
  ilmLaggTillFranAcc(pid, lagg.map(f => ({ itemId: f.itemId, namn: f.namn, sokvag: f.sokvag || '', storlek: f.storlek })));
  _ilm.val.delete(pid);
  ilmRensaKlar(pid);
  return true;
}

// ── Steg 4: färgerna ──────────────────────────────────────────────────────────
// Disciplinkoden och en färg per disciplin; en grupp kan fällas ut till sina
// filer, som kan få en egen färg. Allt ligger i utkastet tills Nästa.

function ilmUtkastDelVal(pid) {
  const u = ilmUtkast(pid);
  return u.disciplin !== undefined ? u.disciplin : ilmDisciplinVal(pid);
}

function ilmUtkastDel(pid) {
  const val = ilmUtkastDelVal(pid);
  if (val === -1) return null;
  if (Number.isInteger(val) && val >= 0) return val;
  return ilmForeslagenDel(ilmTrad(pid)?.data);
}

function ilmUtkastDisciplin(varde) {
  const u = ilmUtkast(_ilm.projektId);
  u.disciplin = varde === 'auto' ? null : varde === 'av' ? -1 : Number(varde);
  ilmRitaNu();
}

function ilmUtkastFarg(pid, itemId) {
  const u = ilmUtkast(pid);
  return u.farger.has(itemId) ? u.farger.get(itemId) : ilmFarg(pid, itemId);
}

function ilmFargGrupper(pid) {
  const del = ilmUtkastDel(pid);
  const grupper = new Map();
  for (const f of ilmFiler(pid)) {
    const k = del == null ? '' : ilmDisciplin(pid, f.ifc.namn, del);
    if (!grupper.has(k)) grupper.set(k, []);
    grupper.get(k).push(f);
  }
  return [...grupper].sort((a, b) => (a[0] === '') - (b[0] === '') || a[0].localeCompare(b[0], 'sv')).map(([kod, filer]) => ({ kod, filer }));
}

// Gruppens färg: den alla filer delar, annars null (blandat).
function ilmGruppFarg(pid, g) {
  const f = [...new Set(g.filer.map(x => ilmUtkastFarg(pid, x.ifc.itemId) || null))];
  return f.length === 1 ? { farg: f[0], blandad: false } : { farg: null, blandad: true };
}

function ilmFargStegHtml(pid) {
  if (!ilmFiler(pid).length) {
    return ilmMitten('Modellen har inga filer än. Färgerna väljs när filerna i steg 3 är klara.');
  }
  const grupper = ilmFargGrupper(pid);
  _ilm.fargGrupper = grupper;
  const antal = n => `${n} ${n === 1 ? 'fil' : 'filer'}`;
  const ruta = (klick, farg, titel, blandad = false) => `
    <button onclick="${klick}" title="${vkEsc(titel)}"
            class="shrink-0 w-6 h-6 rounded-full border border-ads-border hover:ring-2 hover:ring-ads-blue/40"
            style="${blandad ? 'background: conic-gradient(#EC4A41, #FAA21B, #87B340, #0696D7, #A76EF5, #EC4A41)' : ilmFargRuta(farg)}"></button>`;
  const pagar = ilmPagar(pid).filter(j => j.kalla !== 'flytt' && !ilmFiler(pid).some(f => f.ifc.itemId === j.ifc?.itemId)).length;
  return `
    <div class="max-w-3xl mx-auto px-6 py-4">
      <h4 class="text-sm font-semibold text-ads-text">Färger i modellen</h4>
      <p class="text-ads-muted mt-1">Välj en färg för varje disciplin, eller fäll ut en disciplin och välj per fil. Färgerna gäller alla i projektet.
        ${pagar ? `${antal(pagar)} som görs om just nu kan färgas när de är klara.` : ''}</p>
      <div class="mt-4 rounded border border-ads-border/70 px-3 py-2.5">${ilmDisciplinHtml(pid)}</div>
      <div class="mt-4">
        ${grupper.map((g, i) => {
          const { farg, blandad } = ilmGruppFarg(pid, g);
          const oppen = _ilm.fargOppna.has(g.kod);
          return `
            <div class="border-b border-ads-border/50 last:border-0">
              <div class="flex items-center gap-3 py-2">
                ${ruta(`ilmGruppPalett(event, ${i})`, farg, `Färg för ${g.kod || 'filer utan disciplinkod'}`, blandad)}
                <button onclick="ilmVaxlaFargGrupp(${i})" class="flex items-center gap-2 min-w-0 flex-1 text-left">
                  <span class="text-ads-muted w-3">${oppen ? '▾' : '▸'}</span>
                  <span class="font-semibold text-ads-text w-16 shrink-0">${vkEsc(g.kod || 'Utan kod')}</span>
                  <span class="truncate text-ads-muted">${antal(g.filer.length)}${blandad ? ' · olika färger' : ''}</span>
                </button>
              </div>
              ${oppen ? `<div class="pl-9 pb-2">${g.filer.map((f, j) => `
                <div class="flex items-center gap-3 py-1">
                  ${ruta(`ilmFilPalett(event, ${i}, ${j})`, ilmUtkastFarg(pid, f.ifc.itemId), `Färg för ${f.ifc.namn}`)}
                  <span class="truncate text-ads-text">${vkEsc(f.ifc.namn)}</span>
                </div>`).join('')}</div>` : ''}
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function ilmVaxlaFargGrupp(i) {
  const g = _ilm.fargGrupper?.[i];
  if (!g) return;
  if (_ilm.fargOppna.has(g.kod)) _ilm.fargOppna.delete(g.kod); else _ilm.fargOppna.add(g.kod);
  ilmRitaNu();
}

// Gruppens ruta: hela disciplinen får färgen. Förslaget för en disciplin utan
// färg är dess vanliga färg (ILM_DISCIPLIN_FARG).
function ilmGruppPalett(e, i) {
  e.stopPropagation();
  const pid = _ilm.projektId;
  const g = _ilm.fargGrupper?.[i];
  if (!g) return;
  const { farg, blandad } = ilmGruppFarg(pid, g);
  ilmPalett(e.currentTarget, { nyckel: `grupp|${g.kod}`, nu: blandad ? undefined : farg, rubrik: `Färg för ${g.kod || 'filer utan disciplinkod'}`,
    valj: f => { for (const x of g.filer) ilmUtkast(pid).farger.set(x.ifc.itemId, f); ilmRitaNu(); } });
}

function ilmFilPalett(e, i, j) {
  e.stopPropagation();
  const pid = _ilm.projektId;
  const f = _ilm.fargGrupper?.[i]?.filer[j];
  if (!f) return;
  ilmPalett(e.currentTarget, { nyckel: `fil|${f.ifc.itemId}`, nu: ilmUtkastFarg(pid, f.ifc.itemId), rubrik: `Färg för ${f.ifc.namn}`,
    valj: farg => { ilmUtkast(pid).farger.set(f.ifc.itemId, farg); ilmRitaNu(); } });
}

// En sparning: disciplinkoden och alla ändrade färger.
async function ilmSparaSteg4(pid) {
  const u = ilmUtkast(pid);
  const farger = new Map([...u.farger].filter(([id, farg]) => (ilmFarg(pid, id) || null) !== (farg || null)));
  const disc = u.disciplin;
  if (!farger.size && disc === undefined) return;
  await ilmSkrivIndex(pid, d => {
    if (disc !== undefined) d.disciplin = disc;
    for (const f of d.filer) if (farger.has(f.ifc.itemId)) f.farg = farger.get(f.ifc.itemId) || null;
  });
  u.farger.clear();
  u.disciplin = undefined;
  isfModellAndrad?.(pid);
}

// ── Översikt ──────────────────────────────────────────────────────────────────

function ilmOversiktHtml(pid) {
  const ix = _ilm.index.get(pid);
  const filer = ilmFiler(pid);
  const modell = ilmModellKarta(pid);
  const del = ilmDisciplinDel(pid);
  const inaktuella = filer.filter(f => ilmArInaktuell(pid, f) && !ilmUpptagen(pid, f.ifc.itemId)).length;
  const nyaJobb = ilmPagar(pid).filter(j => j.kalla !== 'flytt' && !modell.has(j.ifc?.itemId));
  const utkast = ilmSparatUtkast(pid);
  const rader = [...filer.map(f => ({ itemId: f.ifc.itemId, namn: f.ifc.namn, sokvag: f.ifc.sokvag, datum: ilmIfcDatum(pid, f), farg: f.farg })),
                 ...nyaJobb.map(j => ({ itemId: j.ifc.itemId, namn: j.namn, sokvag: j.ifc.sokvag, datum: null, farg: null }))]
    .sort((a, b) => a.namn.localeCompare(b.namn, 'sv', { numeric: true }));
  const flytt = _ilm.jobb.get(`${pid}|flytt`);
  const fil = r => {
    const j = ilmJobbFor(pid, r.itemId);
    const gammal = ilmArGammal(r.datum);
    return `
      <div class="flex items-center gap-3 py-1.5 border-b border-ads-border/40 last:border-0">
        <span class="shrink-0 w-3.5 h-3.5 rounded-full border border-ads-border" style="${ilmFargRuta(r.farg)}"></span>
        <span class="min-w-0 flex-1 truncate text-ads-text" title="${vkEsc(r.sokvag ? `${r.sokvag} / ${r.namn}` : r.namn)}">${vkEsc(r.namn)}</span>
        <span class="shrink-0 flex items-center gap-1.5 text-[11px]">${ilmFilStatus(pid, r.itemId, modell.get(r.itemId), j) || '<span class="text-ads-muted">Läggs till</span>'}</span>
        <span class="shrink-0 w-[5.5rem] text-right text-[11px] whitespace-nowrap ${gammal ? 'text-amber-800 bg-amber-100 rounded px-1' : 'text-ads-muted'}">${ilmDatum(r.datum) || ''}</span>
      </div>`;
  };
  return `
    <div class="max-w-3xl mx-auto px-6 py-4">
      ${utkast ? `
        <div class="mb-4 flex items-center gap-3 rounded border border-ads-blue/40 bg-ads-blue/5 px-3 py-2">
          <span class="flex-1">Du har en setup som inte är klar (steg ${utkast.steg}), sparad ${new Date(utkast.sparat).toLocaleString('sv-SE').slice(0, 16)}.
            <span class="text-ads-muted">Bara du ser den.</span></span>
          ${ilmKnapp('ilmFortsattSetup()', `Fortsätt setup (steg ${utkast.steg})`, ILM_KNAPP_HUVUD)}
          ${ilmLank(`ilmGlomUtkast('${vkEsc(pid)}'); ilmRitaNu()`, 'Släng')}
        </div>` : ''}
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1 text-ads-muted leading-relaxed">
          <div>IFC-filer från <span class="text-ads-text font-medium">${vkEsc(ilmIfcMapp(pid)?.sokvag || '')}</span></div>
          <div>Sparas i <span class="text-ads-text font-medium">${vkEsc(ix?.mapp?.sokvag || '')}</span>${flytt ? ` <span class="text-ads-blue">→ ${vkEsc(flytt.mapp.sokvag)} (${flytt.fel ? 'flytten gick inte' : 'flyttas'})</span>` : ''}</div>
          ${ix?.flyttadFran && !flytt ? `<div class="text-green-800">Den gamla mappen ${vkEsc(ix.flyttadFran.sokvag)} kan tas bort i ACC nu.</div>` : ''}
        </div>
        ${utkast ? ilmKnapp('ilmAndraSetup()', 'Ändra setup') : ilmKnapp('ilmAndraSetup()', 'Ändra setup', ILM_KNAPP_HUVUD)}
      </div>
      <div class="mt-4 flex items-center gap-3">
        <h4 class="text-[11px] font-semibold uppercase tracking-wider text-ads-muted">Modellens filer (${filer.length})</h4>
        <span class="flex-1"></span>
        ${inaktuella ? ilmKnapp(`ilmUppdateraAlla('${vkEsc(pid)}')`, `Uppdatera alla (${inaktuella})`, 'border-red-300 bg-red-50 text-red-700 hover:border-red-500') : ''}
        ${_isv.pa ? '' : ilmKnapp('ilmStangFonster(); if (!_isv.pa) isvVaxla()', 'Visa modellen')}
      </div>
      <div class="mt-1">${rader.map(fil).join('') || '<p class="py-3 text-ads-muted">Inga filer.</p>'}</div>
      <label class="mt-4 flex items-start gap-2 cursor-pointer">
        <input type="checkbox" ${ilmAuto(pid) ? 'checked' : ''} onchange="ilmSattAuto(this.checked)" class="mt-0.5 accent-ads-blue" />
        <span><span class="text-ads-text">Uppdatera modellen automatiskt när en IFC-fil får en ny version</span>
          <span class="block text-[11px] text-ads-muted mt-0.5">Görs i webbläsaren hos den som har modellen eller det här fönstret öppet. Filer över ${ilmStorlek(ILM_STOR_IFC)} uppdateras inte automatiskt.</span></span>
      </label>
    </div>`;
}

// ── Bannern och varningen när sidan stängs ────────────────────────────────────
// Kön arbetar så länge appen är öppen, även när fönstret är stängt. Bannern
// längst ner säger det; ett klick öppnar Översikt. Stängs eller laddas sidan om
// medan något pågår frågar webbläsaren först (då avbryts det som pågår).

function ilmRitaBanner() {
  const jobb = ilmPagar();
  let el = document.getElementById('ilm-banner');
  if (!jobb.length || _ilm.oppen) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('button');
    el.id = 'ilm-banner';
    el.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-3 rounded-full bg-be-charcoal text-white text-xs px-4 py-2 shadow-lg hover:bg-black';
    el.onclick = () => ilmOppna(ilmPagar()[0]?.pid, 'oversikt');
    document.body.appendChild(el);
  }
  const nu = jobb.find(j => !_ilm.ko.includes(`${j.pid}|${j.nyckel}`)) || jobb[0];
  ilmSatt(el, `<span class="w-2 h-2 rounded-full bg-ads-blue animate-pulse"></span>
    <span>Modellen uppdateras: ${vkEsc(nu.namn)} – ${vkEsc(ilmJobbText(nu))}${jobb.length > 1 ? ` · ${jobb.length - 1} till i kön` : ''}</span>
    <span class="text-white/60">Stäng inte sidan</span>`);
}

window.addEventListener('beforeunload', e => {
  if (!ilmPagar().length) return;
  e.preventDefault();
  e.returnValue = '';
});

// ── Det som flyttades från issues-lattmodell.js: filter, trädet i steg 3, mappträdet, paletten ──

function ilmTomtFilter() {
  return { sok: '', visa: 'alla', datum: 'alla', disciplin: '' };
}

function ilmLasMinne(pid) {
  const m = isvLasVal(`ilm-minne:${pid}`, null) || {};
  const sok = _ilm.filterPid === pid ? _ilm.filter.sok : '';
  _ilm.filterPid = pid;
  _ilm.filter = {
    sok,
    visa: ['imodellen', 'inte'].includes(m.visa) ? m.visa : 'alla',
    datum: ['nya', 'gamla'].includes(m.datum) ? m.datum : 'alla',
    disciplin: typeof m.disciplin === 'string' ? m.disciplin : '',
  };
  _ilm.sortering = ['namn', 'nyast', 'aldst'].includes(m.sortering) ? m.sortering : isvLasVal('ilm-sortering', 'namn');
  if (!_ilm.oppna.has(pid) && Array.isArray(m.oppna)) _ilm.oppna.set(pid, new Set(m.oppna));
}

function ilmSparaMinne(pid = _ilm.projektId) {
  if (!pid || _ilm.filterPid !== pid) return;
  const f = _ilm.filter, oppna = _ilm.oppna.get(pid);
  isvSparaVal(`ilm-minne:${pid}`, { visa: f.visa, datum: f.datum, disciplin: f.disciplin, sortering: _ilm.sortering,
                                    oppna: oppna ? [...oppna].slice(-500) : null });
}

function ilmFilterAktivt() {
  const f = _ilm.filter;
  return !!(f.sok.trim() || f.visa !== 'alla' || f.datum !== 'alla' || f.disciplin);
}

// fil: { itemId, namn, sokvag, datum }. modell: item-id → fil i modellen.
function ilmSynlig(pid, fil, modell, del) {
  const f = _ilm.filter;
  const kod = ilmDisciplin(pid, fil.namn, del);
  if (f.disciplin && kod !== f.disciplin) return false;
  const iModellen = modell.get(fil.itemId);
  if (f.visa === 'imodellen' && !iModellen) return false;
  if (f.visa === 'inte' && iModellen) return false;
  if (f.visa === 'nyversion' && !(iModellen && ilmArInaktuell(pid, iModellen))) return false;
  if (f.datum !== 'alla' && (f.datum === 'gamla') !== ilmArGammal(fil.datum)) return false;
  const ord = f.sok.toLowerCase().split(/\s+/).filter(Boolean);
  if (!ord.length) return true;
  const text = `${fil.namn} ${fil.sokvag || ''} ${kod}`.toLowerCase();
  return ord.every(o => text.includes(o));
}

function ilmSorteraFiler(filer) {
  if (_ilm.sortering === 'namn') return filer;
  const tid = f => Date.parse(f.datum || '') || 0;
  return [...filer].sort((a, b) => _ilm.sortering === 'nyast' ? tid(b) - tid(a) : tid(a) - tid(b));
}

function ilmSattSortering(varde) {
  _ilm.sortering = varde;
  isvSparaVal('ilm-sortering', varde);   // standard för projekt utan eget val
  ilmSparaMinne();
  ilmRitaNu();
}

function ilmSattFilter(namn, varde) {
  _ilm.filter[namn] = varde;
  if (namn !== 'sok') ilmSparaMinne();
  ilmRitaNu();
  const rulla = document.getElementById('ilm-rulla');
  if (rulla) rulla.scrollTop = 0;
}

function ilmRensaFilter() {
  _ilm.filter = ilmTomtFilter();
  const sok = document.getElementById('ilm-sok');
  if (sok) sok.value = '';
  ilmSparaMinne();
  ilmRitaNu();
}

function ilmVaxlaMerFilter() {
  _ilm.merFilter = !_ilm.merFilter;
  ilmRitaNu();
}

function ilmVaxlaDetaljer() {
  _ilm.detaljer = !_ilm.detaljer;
  isvSparaVal('ilm-detaljer', _ilm.detaljer);
  ilmRitaNu();
}


// Byter innehållet bara när det har ändrats. Annars missas klick som träffar
// en knapp eller rad precis när den byts ut (förloppet uppdateras ofta).
function ilmSatt(el, html) {
  if (!el || el._ilmHtml === html) return false;
  el._ilmHtml = html;
  el.innerHTML = html;
  return true;
}

function ilmKnapp(klick, text, extra = '', attr = '') {
  return `<button onclick="${klick}" ${attr} class="text-xs border rounded px-3 py-1.5 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${extra || 'border-ads-border bg-white hover:border-ads-blue'}">${text}</button>`;
}

// Förbättring 5: en enda blå knapp i varje läge; övriga ser ut som länkar eller vanliga knappar.
const ILM_KNAPP_HUVUD = 'border-ads-blue bg-ads-blue text-white hover:bg-ads-blue-dark';

function ilmLank(klick, text, attr = '') {
  return `<button onclick="${klick}" ${attr} class="text-ads-blue hover:underline whitespace-nowrap disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">${text}</button>`;
}

// Förbättring 6: ett litet ? med förklaringen när musen hålls över.
function ilmHjalp(text) {
  return `<span class="inline-flex items-center justify-center shrink-0 w-3.5 h-3.5 rounded-full border border-ads-border text-[9px] leading-none text-ads-muted cursor-help align-middle" title="${vkEsc(text)}">?</span>`;
}

function ilmAccLank(pid, mapp) {
  return `<a href="${ilmAccMappLank(pid, mapp.id)}" target="_blank" rel="noopener" class="text-ads-blue hover:underline whitespace-nowrap">Öppna i ACC</a>`;
}

function ilmMitten(inne) {
  return `<div class="px-5 py-10 text-center text-ads-muted">${inne}</div>`;
}

// Förbättring 3: Alla / I modellen / Inte i modellen (/ Ny version), "Fler
// filter" och etiketterna för aktiva filter därifrån.
function ilmRitaFilter(pid) {
  const f = _ilm.filter;
  const data = ilmTrad(pid)?.data;
  const del = ilmDisciplinDel(pid);
  const koder = new Map();
  if (data && del != null) {
    for (const x of data.filer) {
      const k = ilmDisciplin(pid, x.namn, del);
      if (k) koder.set(k, (koder.get(k) || 0) + 1);
    }
  }
  if (data && f.disciplin && !koder.has(f.disciplin)) f.disciplin = '';
  const nya = ilmFiler(pid).filter(x => ilmArInaktuell(pid, x)).length;
  const flik = (v, text, rod = false) => `
    <button onclick="ilmSattFilter('visa', '${v}')" class="px-2.5 py-1.5 whitespace-nowrap ${f.visa === v
      ? 'bg-ads-blue text-white' : `bg-white hover:bg-ads-gray ${rod ? 'text-red-700 font-medium' : 'text-ads-text'}`}">${text}</button>`;
  const extra = (f.datum !== 'alla' ? 1 : 0) + (f.disciplin ? 1 : 0);
  const etikett = (text, klick) => `
    <span class="inline-flex items-center gap-1 rounded-full bg-ads-blue/10 text-ads-blue pl-2.5 pr-1 py-0.5 text-[11px] whitespace-nowrap">${text}
      <button onclick="${klick}" class="w-4 h-4 rounded-full hover:bg-ads-blue/20 leading-none" title="Ta bort filtret">✕</button></span>`;
  ilmSatt(document.getElementById('ilm-filterknappar'), `
    <div class="flex items-stretch text-xs border border-ads-border rounded overflow-hidden divide-x divide-ads-border">
      ${flik('alla', 'Alla')}${flik('imodellen', 'I modellen')}${flik('inte', 'Inte i modellen')}
      ${nya || f.visa === 'nyversion' ? flik('nyversion', `Ny version${nya ? ` (${nya})` : ''}`, true) : ''}
    </div>
    <button onclick="ilmVaxlaMerFilter()" title="Filtrera på datum och disciplin, eller ändra ordningen"
            class="text-xs border rounded px-2.5 py-1.5 whitespace-nowrap ${_ilm.merFilter
              ? 'border-ads-blue text-ads-blue bg-ads-blue/5' : 'border-ads-border bg-white text-ads-text hover:border-ads-blue'}">
      Fler filter${extra ? ` (${extra})` : ''} ${_ilm.merFilter ? '▴' : '▾'}</button>
    ${f.datum !== 'alla' ? etikett(`${f.datum === 'gamla' ? 'Äldre' : 'Nyare'} än ${ILM_GAMMAL_DAGAR} dagar`, "ilmSattFilter('datum', 'alla')") : ''}
    ${f.disciplin ? etikett(`Disciplin ${vkEsc(f.disciplin)}`, "ilmSattFilter('disciplin', '')") : ''}`);

  const val = (v, t, nu) => `<option value="${vkEsc(v)}" ${nu === v ? 'selected' : ''}>${t}</option>`;
  const lista = 'text-xs border border-ads-border rounded px-1.5 py-1 bg-white focus:outline-none focus:border-ads-blue';
  const sortera = [...koder].sort((a, b) => a[0].localeCompare(b[0], 'sv'));
  ilmSatt(document.getElementById('ilm-merfilter'), !_ilm.merFilter ? '' : `
    <div class="flex items-center gap-x-6 gap-y-2 flex-wrap text-[11px] text-ads-muted bg-ads-gray/60 rounded px-3 py-2">
      <label class="flex items-center gap-1.5" title="När IFC-filens senaste version laddades upp till ACC">Uppladdad
        <select onchange="ilmSattFilter('datum', this.value)" class="${lista}">
          ${val('alla', 'När som helst', f.datum)}${val('nya', `Nyare än ${ILM_GAMMAL_DAGAR} dagar`, f.datum)}${val('gamla', `Äldre än ${ILM_GAMMAL_DAGAR} dagar`, f.datum)}
        </select></label>
      ${del != null && koder.size ? `
        <label class="flex items-center gap-1.5">Disciplin
          <select onchange="ilmSattFilter('disciplin', this.value)" class="${lista}">
            ${val('', 'Alla', f.disciplin)}${sortera.map(([k, n]) => val(k, `${vkEsc(k)} (${n})`, f.disciplin)).join('')}
          </select></label>`
        : `<span class="flex items-center gap-1.5">Disciplin ${ilmLank('ilmGaTillSteg(4)', del == null ? 'av, ställ in i steg 4' : 'ingen kod hittad, ställ in i steg 4')}</span>`}
      <label class="flex items-center gap-1.5">Ordning
        <select onchange="ilmSattSortering(this.value)" class="${lista}">
          ${val('namn', 'Namn A–Ö', _ilm.sortering)}${val('nyast', 'Nyast först', _ilm.sortering)}${val('aldst', 'Äldst först', _ilm.sortering)}
        </select></label>
    </div>`);
}

// Raden under filtren: hur många filer, när trädet lästes, och knapparna.
function ilmRitaStatus(pid) {
  const text = document.getElementById('ilm-status-text');
  const knappar = document.getElementById('ilm-status-knappar');
  const t = ilmTrad(pid);
  if (!ilmIfcMapp(pid) || !t) { ilmSatt(text, ''); ilmSatt(knappar, ''); return; }
  const delar = [];
  if (t.data) {
    const n = t.data.filer.length;
    delar.push(ilmFilterAktivt() ? `${_ilm.antalSynliga} av ${n} IFC-filer syns` : `${n} IFC-filer`);
  }
  if (t.laddar) delar.push(`<span class="text-ads-blue">${t.data ? 'Läser om' : 'Läser'} IFC-mappen… ${t.lasta} ${t.lasta === 1 ? 'mapp' : 'mappar'} lästa</span>`);
  else if (t.tid) {
    const d = new Date(t.tid);
    const idag = d.toDateString() === new Date().toDateString();
    delar.push(`läst ${idag ? `i dag ${d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString('sv-SE').slice(0, 16)}`);
  }
  if (t.fel && t.data) delar.push(`<span class="text-red-700">läsningen gick inte: ${vkEsc(t.fel)}</span>`);
  if (t.data?.ejLasta) delar.push(`<span class="text-amber-700">${t.data.ejLasta} ${t.data.ejLasta === 1 ? 'mapp' : 'mappar'} gick inte att läsa</span>`);
  if (t.data?.forManga) delar.push(`<span class="text-amber-700">fler än ${ILM_MAX_MAPPAR} mappar, välj en IFC-mapp längre ner</span>`);
  ilmSatt(text, `<span class="truncate">${delar.join(' · ')}</span>${ilmHjalp(
    `Mappar utan IFC-filer och mappar med ${ILM_ARKIV_TEXT} i namnet visas inte.\n\n`
    + 'Kortkommandon: / söker, Ctrl+S sparar, Esc stänger. Shift-klick kryssar i eller ur alla filer mellan två klick.')}`);

  const k = [];
  const valbara = _ilm.synligaValbara || [];
  if (ilmFilterAktivt()) {
    if (valbara.length) {
      const modell = ilmModellKarta(pid);
      const alla = valbara.every(f => ilmArValt(pid, f.itemId, modell));
      k.push(ilmLank(`ilmMarkeraSynliga(${alla ? 'false' : 'true'})`, alla ? 'Kryssa ur alla som syns' : `Kryssa i alla som syns (${valbara.length})`));
    }
    k.push(ilmLank('ilmRensaFilter()', 'Rensa filter'));
  }
  if (!t.laddar) k.push(ilmLank('ilmTradLas(_ilm.projektId, true)', 'Läs om', 'title="Läs IFC-mappen från ACC igen, till exempel om en ny fil har laddats upp"'));
  k.push(ilmLank('ilmVaxlaDetaljer()', _ilm.detaljer ? 'Dölj detaljer' : 'Visa detaljer', 'title="Version, storlek och disciplinkod på varje fil"'));
  ilmSatt(knappar, k.join(''));
}

function ilmRitaLista(pid) {
  const el = document.getElementById('ilm-rulla');
  if (!el) return;
  const rull = el.scrollTop;
  if (ilmSatt(el, ilmListaHtml(pid))) {
    el.scrollTop = rull;
    el.querySelectorAll('input[data-blandad="1"]').forEach(r => { r.indeterminate = true; });
  }
}

// Trädet: undermappar först, sedan filerna, bara mappar med IFC som syns.
// Med ett filter är alla mappar med träffar öppna.
function ilmListaHtml(pid) {
  _ilm.rader = [];
  _ilm.synligaValbara = [];
  _ilm.antalSynliga = 0;
  const ix = _ilm.index.get(pid);
  if (!ix || ix.laddar) return '';
  const ifc = ilmIfcMapp(pid);
  if (!ifc) return ilmMitten(`Ingen IFC-mapp är vald. ${ilmLank('ilmGaTillSteg(1)', 'Välj i steg 1')}`);
  const t = ilmTrad(pid);
  if (!t?.data) {
    if (t?.fel) {
      return ilmMitten(`<p class="text-red-700">IFC-mappen gick inte att läsa: ${vkEsc(t.fel)}</p>
        <div class="mt-3">${ilmKnapp('ilmTradLas(_ilm.projektId, true)', 'Försök igen')}</div>`);
    }
    return ilmMitten(`
      <p class="text-ads-text">Läser IFC-mappen… ${t?.lasta || 0} ${t?.lasta === 1 ? 'mapp' : 'mappar'} lästa, ${t?.hittade || 0} IFC-filer hittade.</p>
      <p class="text-xs mt-1">Det kan ta en stund i stora projekt. Nästa gång visas listan direkt.</p>`);
  }

  const data = t.data;
  const x = ilmTradIndex(data);
  const modell = ilmModellKarta(pid);
  const del = ilmDisciplinDel(pid);
  const aktivt = ilmFilterAktivt();
  let oppna = _ilm.oppna.get(pid);
  if (!oppna) {
    // Första gången: allt öppet i små projekt, annars bara översta nivån.
    oppna = new Set(data.filer.length <= 80 ? data.mappar.map(m => m.id) : []);
    _ilm.oppna.set(pid, oppna);
  }

  const syns = new Set();
  for (const f of data.filer) if (ilmSynlig(pid, { ...f, sokvag: x.sokvag.get(f.mappId) }, modell, del)) syns.add(f.itemId);
  const underMapp = new Map();   // mapp-id → filer som syns under den
  for (const f of data.filer) {
    if (!syns.has(f.itemId)) continue;
    for (let id = f.mappId, n = 0; id && n < 200; id = x.mappar.get(id)?.foralder, n++) {
      const l = underMapp.get(id);
      if (l) l.push(f); else underMapp.set(id, [f]);
    }
  }

  const html = [];
  const rita = (mappId, djup) => {
    for (const m of x.barn.get(mappId) || []) {
      const filer = underMapp.get(m.id);
      if (!filer) continue;
      const oppen = aktivt || oppna.has(m.id);
      html.push(ilmMappRad(pid, m, djup, oppen, filer, modell, aktivt));
      if (oppen) rita(m.id, djup + 1);
    }
    for (const f of ilmSorteraFiler(x.filerI.get(mappId) || [])) {
      if (syns.has(f.itemId)) html.push(ilmFilRad(pid, { ...f, sokvag: x.sokvag.get(f.mappId) }, djup, modell, del));
    }
  };
  rita(data.rotId, 0);
  _ilm.antalSynliga = syns.size;
  _ilm.synligaValbara = data.filer.filter(f => syns.has(f.itemId))
    .map(f => ({ ...f, sokvag: x.sokvag.get(f.mappId) }));

  // Filer i modellen (eller på väg in) som inte finns i trädet: i en Arkiv-mapp,
  // utanför IFC-mappen eller borttagna. De måste gå att ta bort ur modellen.
  const utanfor = [];
  for (const m of modell.values()) {
    if (!x.filer.has(m.ifc.itemId)) {
      utanfor.push({ itemId: m.ifc.itemId, namn: m.ifc.namn, sokvag: m.ifc.sokvag || '', version: m.ifc.version,
                     storlek: m.ifc.storlek, datum: ilmIfcDatum(pid, m) });
    }
  }
  for (const j of _ilm.jobb.values()) {
    const id = j.ifc?.itemId;
    if (j.pid === pid && id && !x.filer.has(id) && !modell.has(id)) {
      utanfor.push({ itemId: id, namn: j.namn, sokvag: j.ifc.sokvag || '', version: null, storlek: null, datum: null });
    }
  }
  const utanforSyns = ilmSorteraFiler(utanfor.filter(f => ilmSynlig(pid, f, modell, del)));
  if (utanforSyns.length) {
    html.push(`<div class="mt-3 mb-1 mx-1 pt-3 border-t border-ads-border text-[11px] font-semibold uppercase tracking-wider text-ads-muted">
      Ingår i modellen men syns inte i IFC-mappen (${utanforSyns.length})</div>`);
    for (const f of utanforSyns) {
      const borta = _ilm.tips.get(`${pid}|${f.itemId}`)?.borta;
      html.push(ilmFilRad(pid, f, 0, modell, del, borta
        ? 'Finns inte längre i ACC'
        : ilmVal(pid).tabort.has(f.itemId)
          ? 'Ligger utanför IFC-mappen. Tas bort ur modellen när du sparar.'
          : 'Ligger i en arkivmapp, utanför IFC-mappen eller i en mapp som inte gick att läsa'));
    }
  }

  if (!data.filer.length && !utanfor.length) return ilmMitten(`Hittade inga IFC-filer under ${vkEsc(ifc.sokvag || 'IFC-mappen')}.`);
  if (!html.length) {
    return ilmMitten(`Inga IFC-filer matchar filtret.
      <div class="mt-3">${ilmKnapp('ilmRensaFilter()', 'Rensa filter')}</div>`);
  }
  return html.join('');
}

function ilmMappRad(pid, m, djup, oppen, filer, modell, aktivt) {
  const valbara = filer;
  const valda = valbara.filter(f => ilmArValt(pid, f.itemId, modell)).length;
  const alla = valbara.length > 0 && valda === valbara.length;
  const blandad = valda > 0 && !alla;
  const imod = filer.filter(f => modell.has(f.itemId)).length;
  const i = _ilm.rader.push({ typ: 'mapp', id: m.id, filer: valbara.map(f => ({ ...f, sokvag: '' })) }) - 1;
  return `
    <div class="flex items-center gap-1.5 py-1 pr-2 rounded hover:bg-ads-gray" style="padding-left: ${djup * 16 + 4}px">
      <button onclick="ilmOppnaMapp(${i})" class="w-4 text-ads-muted hover:text-ads-text ${aktivt ? 'invisible' : ''}">${oppen ? '▾' : '▸'}</button>
      <input type="checkbox" onclick="ilmKlickMapp(event, ${i})" ${alla ? 'checked' : ''} data-blandad="${blandad ? 1 : 0}" ${valbara.length ? '' : 'disabled'}
             class="accent-ads-blue cursor-pointer" title="Kryssa i eller ur alla IFC-filer i mappen som syns" />
      <button onclick="ilmOppnaMapp(${i})" class="min-w-0 text-left truncate text-ads-text">📁 ${vkEsc(m.namn)}</button>
      <span class="shrink-0 text-[11px] text-ads-muted">${filer.length} IFC${imod ? ` · ${imod} i modellen` : ''}</span>
    </div>`;
}

// Förbättring 4: en lugn rad med kryssruta, namn, status, färg och datum.
// Version, storlek och disciplinkod syns med "Visa detaljer" (och i namnets
// verktygstips). orsak: text för filer som inte finns i trädet.
function ilmFilRad(pid, f, djup, modell, del, orsak = '') {
  const id = f.itemId;
  const j = ilmJobbFor(pid, id);
  const upptagen = !!j && !j.fel;
  const imod = modell.get(id);
  const valt = ilmArValt(pid, id, modell);
  const v = ilmVal(pid);
  const andring = (imod || upptagen) ? v.tabort.has(id) : v.lagg.has(id);
  const i = _ilm.rader.push({ typ: 'fil', fil: f }) - 1;
  const kod = ilmDisciplin(pid, f.namn, del);
  const gammal = ilmArGammal(f.datum);
  const detalj = [f.version ? `V${f.version}` : '', ilmStorlek(f.storlek)].filter(Boolean).join(' · ');
  const tips = [f.sokvag ? `${f.sokvag} / ${f.namn}` : f.namn, [detalj, kod ? `disciplin ${kod}` : ''].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
  const datumTitel = f.datum
    ? `${orsak ? 'Versionen i modellen' : `Senaste versionen i ACC${f.version ? ` (V${f.version})` : ''}`} laddades upp ${new Date(f.datum).toLocaleString('sv-SE').slice(0, 16)}${f.av ? ` av ${f.av}` : ''}.${gammal ? ` Äldre än ${ILM_GAMMAL_DAGAR} dagar.` : ''}`
    : 'Datumet är okänt';
  return `
    <div data-ilm-rad="${i}" onclick="ilmKlickFil(event, ${i})" onmousedown="if (event.shiftKey) event.preventDefault()"
         class="flex items-center gap-2 py-1 pr-2 rounded select-none cursor-pointer hover:bg-ads-gray ${andring ? 'bg-ads-blue/10' : ''}"
         style="padding-left: ${djup * 16 + 26}px">
      <input type="checkbox" tabindex="-1" class="pointer-events-none accent-ads-blue" ${valt ? 'checked' : ''} />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 min-w-0">
          <span class="truncate text-ads-text ${imod ? 'font-medium' : ''}" title="${vkEsc(tips)}">${vkEsc(f.namn)}</span>
          ${_ilm.detaljer && kod ? `<span class="shrink-0 px-1 rounded bg-ads-gray text-[10px] font-semibold text-ads-muted" title="Disciplinkod">${vkEsc(kod)}</span>` : ''}
          ${andring ? `<span class="shrink-0 text-[11px] text-ads-blue">${imod || upptagen ? 'tas bort' : 'läggs till'}</span>` : ''}
        </div>
        ${orsak ? `<div class="text-[11px] text-amber-700 truncate" title="${vkEsc(f.sokvag)}">${vkEsc(orsak)}${f.sokvag ? ` · ${vkEsc(f.sokvag)}` : ''}</div>` : ''}
      </div>
      <span class="shrink-0 flex items-center gap-1.5 text-[11px]">${ilmFilStatus(pid, id, imod, j)}</span>
      ${imod ? `<button onclick="ilmFargMeny(event, '${vkEsc(pid)}', '${vkEsc(id)}')" title="${imod.farg ? 'Modellens färg. Klicka för att ändra.' : 'Ingen färg: modellens egna färger. Klicka för att välja.'}"
                        class="shrink-0 w-4 h-4 rounded-full border border-ads-border hover:ring-2 hover:ring-ads-blue/40" style="${ilmFargRuta(imod.farg)}"></button>`
             : '<span class="shrink-0 w-4"></span>'}
      ${_ilm.detaljer ? `<span class="shrink-0 w-24 text-right text-[11px] text-ads-muted whitespace-nowrap">${detalj}</span>` : ''}
      <span class="shrink-0 w-[5.5rem] text-right text-[11px] whitespace-nowrap ${gammal ? 'text-amber-800 bg-amber-100 rounded px-1' : 'text-ads-muted'}"
            title="${vkEsc(datumTitel)}">${ilmDatum(f.datum) || '–'}</span>
    </div>`;
}

function ilmJobbText(j) {
  return `${j.steg}${j.andel != null ? ` ${Math.round(j.andel * 100)} %` : ''}…`;
}

// Filens status som en etikett: I modellen, Ny version, förloppet eller felet.
function ilmFilStatus(pid, id, imod, j) {
  const pidJs = vkEsc(pid), idJs = vkEsc(id);
  const etikett = (klass, text, titel = '') => `<span class="px-1.5 py-px rounded whitespace-nowrap ${klass}" title="${vkEsc(titel)}">${text}</span>`;
  if (j && !j.fel && j.taBort) return '<span class="text-ads-muted whitespace-nowrap">Tas bort när den är klar</span>';
  if (j && !j.fel) return `<span class="text-ads-blue whitespace-nowrap" data-ilm-jobb="${vkEsc(`${pid}|${j.nyckel}`)}">${vkEsc(ilmJobbText(j))}</span>`;
  if (j?.fel) {
    return `${etikett('bg-red-50 text-red-700 max-w-[14rem] truncate', `Gick inte: ${vkEsc(j.fel)}`, j.fel)}
      ${ilmLank(`event.stopPropagation(); ilmForsokIgen('${pidJs}', '${idJs}')`, 'Försök igen')}
      ${imod ? '' : `<button onclick="event.stopPropagation(); ilmGlomJobb('${pidJs}', '${vkEsc(j.nyckel)}')" class="text-ads-muted hover:text-ads-text" title="Glöm felet">✕</button>`}`;
  }
  if (!imod) return '';
  const t = _ilm.tips.get(`${pid}|${id}`);
  if (t?.borta) return etikett('bg-red-50 text-red-700', 'Borttagen i ACC', 'IFC-filen finns inte längre i ACC. Ta bort den ur modellen.');
  if (ilmArInaktuell(pid, imod)) {
    const ny = t && t.version != null && imod.ifc.version != null && t.version > imod.ifc.version;
    return `${etikett('bg-red-50 text-red-700 font-medium', ny ? 'Ny version' : 'Behöver uppdateras',
                      ny ? `Modellen har V${imod.ifc.version}, ACC har V${t.version}.` : 'Appen läser nu mer ur IFC-filer än när modellen gjordes. Uppdatera för att få med allt.')}
      ${ilmLank(`event.stopPropagation(); ilmUppdatera('${pidJs}', '${idJs}')`, 'Uppdatera')}`;
  }
  const uppdaterad = imod.omvandlad ? `Uppdaterad ${new Date(imod.omvandlad).toLocaleString('sv-SE').slice(0, 16)}${imod.omvandladAv ? ` av ${imod.omvandladAv}` : ''}` : '';
  return etikett('bg-green-50 text-green-700', 'I modellen', uppdaterad);
}

// Klick på en fil: kryssa i eller ur. Shift-klick tar med alla filrader mellan
// det förra klicket och det här, åt samma håll.
function ilmKlickFil(e, i) {
  const pid = _ilm.projektId;
  const r = _ilm.rader[i];
  if (r?.typ !== 'fil') return;
  const modell = ilmModellKarta(pid);
  const pa = !ilmArValt(pid, r.fil.itemId, modell);
  const filRader = _ilm.rader.filter(x => x.typ === 'fil');
  const fran = filRader.findIndex(x => x.fil.itemId === _ilm.senast);
  const till = filRader.indexOf(r);
  if (e?.shiftKey && fran >= 0 && till >= 0) {
    const [a, b] = fran < till ? [fran, till] : [till, fran];
    for (const x of filRader.slice(a, b + 1)) ilmSattVal(pid, x.fil, pa, modell);
  } else {
    ilmSattVal(pid, r.fil, pa, modell);
  }
  _ilm.senast = r.fil.itemId;
  ilmRitaVal(pid);
}

// Kryssrutan på en mapp: alla filer som syns under den, i eller ur.
function ilmKlickMapp(e, i) {
  e.stopPropagation();
  const pid = _ilm.projektId;
  const r = _ilm.rader[i];
  if (r?.typ !== 'mapp') return;
  const modell = ilmModellKarta(pid);
  const alla = r.filer.every(f => ilmArValt(pid, f.itemId, modell));
  const x = ilmTradIndex(ilmTrad(pid).data);
  for (const f of r.filer) ilmSattVal(pid, { ...f, sokvag: x.sokvag.get(f.mappId) }, !alla, modell);
  ilmRitaVal(pid);
}

function ilmMarkeraSynliga(pa) {
  const pid = _ilm.projektId;
  const modell = ilmModellKarta(pid);
  for (const f of _ilm.synligaValbara || []) ilmSattVal(pid, f, pa, modell);
  ilmRitaVal(pid);
}

function ilmOppnaMapp(i) {
  const pid = _ilm.projektId;
  const r = _ilm.rader[i];
  if (r?.typ !== 'mapp' || ilmFilterAktivt()) return;
  const oppna = _ilm.oppna.get(pid);
  if (oppna.has(r.id)) oppna.delete(r.id); else oppna.add(r.id);
  ilmSparaMinne(pid);
  ilmRitaLista(pid);
}

// Var i filnamnet disciplinkoden står, med exempel (steg 4; sparas med Nästa).
function ilmDisciplinHtml(pid) {
  const data = ilmTrad(pid)?.data;
  if (!data?.filer.length) {
    return `<p class="text-ads-muted">${ilmTrad(pid)?.laddar ? 'Läser IFC-mappen…' : 'Inga IFC-filer att visa exempel från.'}</p>`;
  }
  const del = ilmUtkastDel(pid);
  const val = ilmUtkastDelVal(pid);
  const nu = val == null ? 'auto' : val === -1 ? 'av' : String(val);
  const forslag = ilmForeslagenDel(data);
  const antalDelar = Math.min(8, Math.max(...data.filer.map(f => ilmNamnDelar(f.namn).length)));
  const exempel = i => {
    const n = new Map();
    for (const f of data.filer) { const v = (ilmNamnDelar(f.namn)[i] || '').toUpperCase(); if (v) n.set(v, (n.get(v) || 0) + 1); }
    return [...n].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v]) => v).join(', ');
  };
  const opt = (v, text) => `<option value="${v}" ${nu === v ? 'selected' : ''}>${vkEsc(text)}</option>`;
  const exFil = data.filer.find(f => ilmDisciplin(pid, f.namn, del)) || data.filer[0];
  const under = inne => `<div class="pl-[10.75rem] mt-1.5 text-[11px] text-ads-muted">${inne}</div>`;
  return `
    <div class="flex items-center gap-3">
      <span class="w-40 shrink-0 text-ads-muted">Disciplinkoden står i</span>
      <select onchange="ilmUtkastDisciplin(this.value)" class="text-xs border border-ads-border rounded px-1.5 py-1 bg-white max-w-full">
        ${opt('auto', forslag == null ? 'Förslag (ingen kod hittad)' : `Förslag: del ${forslag + 1} i namnet (${exempel(forslag)})`)}
        ${Array.from({ length: antalDelar }, (_, i) => opt(String(i), `Del ${i + 1} i namnet (${exempel(i)})`)).join('')}
        ${opt('av', 'Används inte')}
      </select>
    </div>
    ${exFil && del != null ? under(`Exempel: ${vkEsc(exFil.namn)} → <b class="text-ads-text">${vkEsc(ilmDisciplin(pid, exFil.namn, del) || '–')}</b>`) : ''}
    ${under('Namnet delas vid - _ . och mellanslag. Koden används för att filtrera listan i steg 3 och för färgerna nedan.')}
`;
}

function ilmGamlaHtml(pid) {
  const g = _ilm.gamla;
  if (!g || g.pid !== pid) return '';
  const ram = inne => `<div class="mt-2 rounded bg-ads-gray/60 px-3 py-2 text-[11px] text-ads-muted">${inne}</div>`;
  if (g.laddar) return ram('Letar efter gamla modellfiler i mappen…');
  if (g.fel) return ram(`<span class="text-red-700">Mappen gick inte att läsa: ${vkEsc(g.fel)}</span>`);
  if (!g.filer.length) return ram('Inga gamla modellfiler. Allt i mappen används av modellen.');
  const summa = g.filer.reduce((s, f) => s + (f.storlek || 0), 0);
  const mapp = _ilm.index.get(pid)?.mapp;
  return ram(`
    <div class="text-ads-text">${g.filer.length} ${g.filer.length === 1 ? 'modellfil' : 'modellfiler'} (${ilmStorlek(summa)}) används inte längre.
      Appen får inte radera filer i ACC, så ta bort dem där om du vill. ${mapp ? ilmAccLank(pid, mapp) : ''}</div>
    <div class="mt-1 max-h-32 overflow-y-auto">${g.filer.map(f => `
      <div class="flex gap-3"><span class="truncate">${vkEsc(f.namn)}</span><span class="ml-auto whitespace-nowrap">${ilmStorlek(f.storlek)} · ${ilmDatum(f.datum)}</span></div>`).join('')}</div>`);
}

let _ilmBladNr = 0;

function ilmNod(post) {
  const noder = _ilm.blad.noder;
  let i = noder.findIndex(n => n.id === post.id);
  if (i === -1) i = noder.push(post) - 1;
  return i;
}

async function ilmBladOppna(i) {
  const b = _ilm.blad;
  const nod = b?.noder[i];
  if (!nod) return;
  if (b.oppna.has(nod.id)) { b.oppna.delete(nod.id); return ilmBladRita(); }
  b.oppna.add(nod.id);
  if (!b.innehall.has(nod.id)) {
    b.innehall.set(nod.id, { laddar: true });
    ilmBladRita();
    try {
      const { poster } = await getFolderContentsWithTips(b.pid, nod.id);
      b.innehall.set(nod.id, { poster });
    } catch (err) {
      b.innehall.set(nod.id, { fel: vkFelText(err) });
    }
    if (_ilm.blad !== b) return;
  }
  ilmBladRita();
}


function ilmBladTradHtml(b) {
  const rad = (djup, inne, klass = '') => `<div class="flex items-center gap-1.5 py-0.5 pr-2 rounded ${klass}" style="padding-left: ${djup * 16 + 4}px">${inne}</div>`;
  const mappar = (items, djup, foralder) => items.map(f => {
    const namn = vkMappNamnAv(f);
    const sokvag = foralder ? `${foralder} / ${namn}` : namn;
    const i = ilmNod({ id: f.id, namn, sokvag });
    const oppen = b.oppna.has(f.id);
    const inne = b.innehall.get(f.id);
    const vald = b.vald?.id === f.id;
    let html = rad(djup, `
      <button onclick="ilmBladOppna(${i})" class="w-4 text-ads-muted hover:text-ads-text">${oppen ? '▾' : '▸'}</button>
      <input type="radio" name="ilm-mapp" ${vald ? 'checked' : ''} onclick="ilmBladKlick(${i})" class="accent-ads-blue" />
      <button onclick="ilmBladKlick(${i})" class="min-w-0 text-left truncate ${vald ? 'font-semibold text-ads-blue' : 'text-ads-text'}">📁 ${vkEsc(namn)}</button>
      ${b.nu === f.id ? '<span class="shrink-0 text-[11px] text-ads-muted">(vald nu)</span>' : ''}`,
      vald ? 'bg-ads-blue/10' : 'hover:bg-ads-gray');
    if (oppen) {
      if (!inne || inne.laddar) html += rad(djup + 1, '<span class="w-4"></span><span class="text-ads-muted">Läser…</span>');
      else if (inne.fel) html += rad(djup + 1, `<span class="w-4"></span><span class="text-red-700">${vkEsc(inne.fel)}</span>`);
      else {
        const under = inne.poster.filter(p => p.type === 'folders' && !ilmDoljMapp(p))
          .sort((x, y) => vkMappNamnAv(x).localeCompare(vkMappNamnAv(y), 'sv', { numeric: true }));
        html += under.length ? mappar(under, djup + 1, sokvag) : rad(djup + 1, '<span class="w-4"></span><span class="text-ads-muted italic">Inga undermappar.</span>');
      }
    }
    return html;
  }).join('');
  const topp = b.topp;
  return topp.laddar ? '<p class="p-2 text-ads-muted">Läser mapparna…</p>'
    : topp.fel ? `<p class="p-2 text-red-700">${vkEsc(topp.fel)}</p>`
    : mappar(topp.items, 0, '');
}

// Paletten: Mahdis färger och "Ingen färg", under (eller ovanför) knappen som
// öppnade den. valj(farg) får '#RRGGBB' eller null. nyckel säger vad paletten
// gäller, så att ett nytt klick på samma knapp stänger den.
function ilmPalett(knapp, { nyckel, nu, rubrik, valj }) {
  const fonster = document.querySelector('#ilm-ruta .ilm-fonster');
  if (_ilm.fargMeny?.nyckel === nyckel) { ilmStangFargMeny(); return; }
  ilmStangFargMeny();
  if (!fonster || !knapp) return;
  _ilm.fargMeny = { nyckel, knapp, valj };
  const cirkel = (farg, titel) => `
    <button onclick="ilmValjFarg(${farg ? `'${farg}'` : 'null'})" title="${titel}"
            class="w-6 h-6 rounded-full border ${farg === nu ? 'ring-2 ring-offset-2 ring-ads-blue' : ''} ${farg === '#FFFFFF' || !farg ? 'border-ads-border' : 'border-transparent'} hover:scale-110 transition-transform"
            style="${ilmFargRuta(farg)}"></button>`;
  const meny = document.createElement('div');
  meny.id = 'ilm-fargmeny';
  meny.className = 'absolute z-50 w-max left-0 top-0 bg-white rounded-lg shadow-xl border border-ads-border p-3';
  meny.innerHTML = `
    <div class="text-[11px] text-ads-muted mb-2 max-w-[19rem] truncate" title="${vkEsc(rubrik)}">${vkEsc(rubrik)}</div>
    <div class="grid grid-cols-10 gap-1.5">${ILM_PALETT.flat().map(f => cirkel(f, f)).join('')}</div>
    <div class="mt-2 flex items-center gap-2">${cirkel(null, 'Ingen färg: modellens egna färger')}<span class="text-[11px] text-ads-muted">Ingen färg</span></div>`;
  meny.addEventListener('mousedown', ev => ev.stopPropagation());
  fonster.appendChild(meny);
  // Under rutan, eller ovanför om den inte får plats.
  const f = fonster.getBoundingClientRect(), k = knapp.getBoundingClientRect(), m = meny.getBoundingClientRect();
  // Rutorna i listan sitter till höger: paletten slutar vid rutan. I dialogen sitter de till vänster: den börjar där.
  const vanster = Math.max(8, Math.min(k.right - f.left > f.width / 2 ? k.right - f.left - m.width : k.left - f.left, f.width - m.width - 8));
  const under = k.bottom - f.top + 6;
  meny.style.left = `${vanster}px`;
  meny.style.top = `${under + m.height > f.height - 8 ? Math.max(8, k.top - f.top - m.height - 6) : under}px`;
  setTimeout(() => document.addEventListener('mousedown', ilmFargUtanfor), 0);
  for (const id of ['ilm-rulla', 'ilm-disc-lista']) document.getElementById(id)?.addEventListener('scroll', ilmStangFargMeny, { once: true });
}

function ilmFargMeny(e, pid, itemId) {
  e.stopPropagation();
  const namn = ilmFiler(pid).find(f => f.ifc.itemId === itemId)?.ifc.namn || '';
  ilmPalett(e.currentTarget, { nyckel: `fil|${itemId}`, nu: ilmFarg(pid, itemId), rubrik: `Färg för ${namn}`,
                               valj: farg => ilmSattFarg(pid, itemId, farg) });
}

// Ett klick utanför stänger paletten; ett klick på samma färgruta stänger den via ilmPalett.
function ilmFargUtanfor(e) {
  if (_ilm.fargMeny?.knapp?.contains(e.target)) return;
  ilmStangFargMeny();
}

function ilmStangFargMeny() {
  _ilm.fargMeny = null;
  document.getElementById('ilm-fargmeny')?.remove();
  document.removeEventListener('mousedown', ilmFargUtanfor);
}

function ilmValjFarg(farg) {
  const m = _ilm.fargMeny;
  ilmStangFargMeny();
  m?.valj(farg);
}
