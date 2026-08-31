// ── Veckokontroll: körning och jämförelse ─────────────────────────────────────
// Kör veckans kontroll, jämför mot förra avläsningen och visar resultatet.
//
// Jämförelsen bygger på veckologgen, en fil i samma mapp som inställningarna.
// Den sparas först när du själv godkänner avläsningen, så att en extra körning
// samma dag inte tar bort jämförelsen mot förra veckan.
//
// Del 2 av 5.

const VK_LOGG_FIL   = 'veckokontroll-logg.json';
const VK_LOGG_ANTAL = 12;   // antal körningar som sparas i loggen

// ── Loggen ────────────────────────────────────────────────────────────────────

async function vkHittaLoggfil() {
  if (!_vk.lagring.mapp) return null;
  const poster = await getFolderContents(_currentProject.id, _vk.lagring.mapp.id);
  const fil = poster.find(p =>
    p.type === 'items' &&
    (p.attributes?.displayName || p.attributes?.name || '').toLowerCase() === VK_LOGG_FIL);
  return fil?.id || null;
}

async function vkLasLogg() {
  const itemId = await vkHittaLoggfil();
  _vk.kor.loggItemId = itemId;
  if (!itemId) return { version: 1, korningar: [] };

  const logg = JSON.parse(await readTextFile(_currentProject.id, itemId));
  if (!Array.isArray(logg.korningar)) logg.korningar = [];
  return logg;
}

// ── Körningen ─────────────────────────────────────────────────────────────────

async function vkKor() {
  const inst = _vk.installningar;
  if (!inst || _vk.kor.pagar) return;

  _vk.kor.pagar    = true;
  _vk.kor.fel      = null;
  _vk.kor.resultat = null;
  _vk.kor.sparad   = false;
  _vk.kor.steg     = 'Läser veckologgen';
  _vk.bp           = { pagar: false, avbryt: false, klara: 0, totalt: 0, rader: [], steg: '' };
  _vk.not          = { text: null, sparar: false, sparadSom: null, issue: null };
  renderVeckokontroll();

  const rapport = text => {
    _vk.kor.steg = text;
    const el = document.getElementById('vk-kor-steg');
    if (el) el.textContent = text;
  };

  try {
    const logg = await vkLasLogg();
    _vk.kor.logg = logg;
    const forra = logg.korningar[logg.korningar.length - 1] || null;

    const mappData = inst.mappar.length
      ? await vkLasMappar(inst, rapport)
      : { modeller: [], problem: [], antalMappar: 0, bromsad: false };

    const setData = inst.modellSet.length
      ? await vkLasModellSet(inst, rapport)
      : { setLista: [], problem: [] };

    const vyData = setData.setLista.length
      ? await vkLasVyer(setData.setLista, rapport)
      : { vyer: [], problem: [] };

    rapport('Jämför mot förra avläsningen');
    _vk.kor.resultat = vkJamfor(inst, mappData, setData, vyData, forra);
  } catch (err) {
    _vk.kor.fel = vkFelText(err);
  }

  _vk.kor.pagar = false;
  renderVeckokontroll();
}

// ── Jämförelsen ───────────────────────────────────────────────────────────────

function vkJamfor(inst, mappData, setData, vyData, forra, nu = Date.now()) {
  const grans      = inst.grans?.dagar ?? 7;
  const forraLista = forra?.modeller || [];
  const forraPer   = new Map(forraLista.map(m => [m.itemId, m]));

  // Varje modell kan ligga i flera model set. Samla dem per modell.
  const setPerModell = new Map();
  setData.setLista.forEach(s => (s.dokument || []).forEach(d => {
    if (!setPerModell.has(d.itemId)) setPerModell.set(d.itemId, []);
    setPerModell.get(d.itemId).push({ setNamn: s.namn, ...d });
  }));

  const harSet = setData.setLista.length > 0;

  const rader = mappData.modeller.map(m => {
    const f     = forraPer.get(m.itemId);
    const iSet  = setPerModell.get(m.itemId) || [];
    const alder = vkDagarSedan(m.andrad, nu);

    return {
      ...m,
      forraVersion:  f?.version ?? null,
      ny:            !f,
      forstaGangen:  !f && m.version === 1,
      uppdaterad:    !!f && m.version > f.version,
      ovanforandrad: !!f && m.version === f.version,
      alder,
      gammal:        alder != null && alder > grans,
      set:           iSet.map(s => ({ namn: s.setNamn, version: s.versionISet, arTip: s.arTip, status: s.status })),
      saknasISet:    harSet && iSet.length === 0,
      setEfter:      iSet.some(s => s.arTip === false),
      setFel:        iSet.some(s => s.status && s.status !== 'Succeeded'),
    };
  });

  // Modeller som samordningen känner till men som inte ligger i de bevakade
  // mapparna. Antingen ligger de någon annanstans, eller så bevakas för lite.
  const iMappar = new Set(mappData.modeller.map(m => m.itemId));
  const utanfor = [];
  setPerModell.forEach((poster, itemId) => {
    if (iMappar.has(itemId)) return;
    utanfor.push({ itemId, namn: poster[0].namn || '(namnlös)', set: [...new Set(poster.map(p => p.setNamn))] });
  });

  // Modeller som fanns i förra avläsningen men inte hittas nu.
  const borttagna = forraLista.filter(m => !iMappar.has(m.itemId));

  rader.sort((a, b) => vkAllvar(b) - vkAllvar(a) || a.namn.localeCompare(b.namn, 'sv'));

  const vyer = vkKopplaVyer(inst, vyData, forra);

  return {
    tid:      new Date().toISOString(),
    forsta:   !forra,
    forraTid: forra?.tid || null,
    rader, utanfor, borttagna, vyer,
    setLista: setData.setLista,
    problem:  [...(mappData.problem || []), ...(setData.problem || []), ...(vyData.problem || [])],
    bromsad:  mappData.bromsad,
    antalMappar: mappData.antalMappar,
    grans,
    summering: {
      totalt:      rader.length,
      uppdaterade: rader.filter(r => r.uppdaterad).length,
      ovanforandrade: rader.filter(r => r.ovanforandrad).length,
      nya:         rader.filter(r => r.ny).length,
      gamla:       rader.filter(r => r.gammal).length,
      saknasISet:  rader.filter(r => r.saknasISet).length,
      setEfter:    rader.filter(r => r.setEfter).length,
      borttagna:   borttagna.length,
      utanfor:     utanfor.length,
      vyerEfter:   vyer.rader.filter(v => !v.iFas).length,
      vyerObekraftade: vyer.rader.filter(v => v.behoverBekraftas).length,
      vyerAttGa:   vyer.rader.filter(v => !v.iFas || v.behoverBekraftas).length,
    },
  };
}

// ── Vyerna ────────────────────────────────────────────────────────────────────
// Inställningarna säger vilka vyer som ska bevakas. Har inga valts visas alla
// vyer som finns i model setten, det är mer användbart än en tom lista.

function vkVyNyckel(v) {
  return v.viewId || `namn:${String(v.namn || '').trim().toLowerCase()}`;
}

function vkKopplaVyer(inst, vyData, forra) {
  const valda     = inst.vyer || [];
  const forraVyer = new Map((forra?.vyer || []).map(v => [vkVyNyckel(v), v]));

  const passar = (val, vy) => val.viewId
    ? val.viewId === vy.viewId
    : String(val.namn || '').trim().toLowerCase() === vy.namn.toLowerCase();

  const bevakade = valda.length ? vyData.vyer.filter(vy => valda.some(val => passar(val, vy))) : vyData.vyer;

  const rader = bevakade.map(vy => {
    // Bekräftelsen hänger på model set-versionen, inte på körningen. Har settet
    // fått en ny version sedan bekräftelsen behöver vyn ses över igen.
    const tidigare = forraVyer.get(vkVyNyckel(vy)) || forraVyer.get(`namn:${vy.namn.toLowerCase()}`);
    const bekraftadFor = tidigare?.bekraftad ? (tidigare.setVersion ?? null) : null;

    return {
      ...vy,
      notering:        valda.find(val => passar(val, vy))?.notering || '',
      bekraftadFor,
      bekraftadAv:     tidigare?.av || '',
      bekraftadTid:    tidigare?.tid || null,
      behoverBekraftas: bekraftadFor == null || bekraftadFor !== vy.setVersion,
      bekraftad:       false,   // kryssas i under den här körningen
    };
  });

  rader.sort((a, b) => (a.iFas === b.iFas ? 0 : a.iFas ? 1 : -1) || a.namn.localeCompare(b.namn, 'sv'));

  const hittadeInte = valda.filter(val => !vyData.vyer.some(vy => passar(val, vy)));
  const ovriga      = valda.length ? vyData.vyer.filter(vy => !bevakade.includes(vy)) : [];

  return { rader, hittadeInte, ovriga, antalIProjektet: vyData.vyer.length, allaVisas: !valda.length };
}

function vkToggleVyBekraftad(i) {
  const v = _vk.kor.resultat?.vyer?.rader?.[i];
  if (!v) return;
  v.bekraftad = !v.bekraftad;
  const el = document.getElementById('vk-vyer-kort');
  if (el) el.innerHTML = vkRenderVyerInnehall(_vk.kor.resultat);
}

// Sorteringsvikt, så att det som behöver åtgärdas ligger överst.
function vkAllvar(r) {
  return (r.saknasISet ? 8 : 0) + (r.setEfter ? 4 : 0) + (r.gammal ? 2 : 0) + (r.ovanforandrad ? 1 : 0);
}

// ── Spara avläsningen ─────────────────────────────────────────────────────────

async function vkSparaAvlasning() {
  const res = _vk.kor.resultat;
  if (!res || _vk.kor.sparar) return;

  _vk.kor.sparar = true;
  renderVeckokontroll();

  try {
    const logg = _vk.kor.logg || { version: 1, korningar: [] };

    logg.version = 1;
    logg.projekt = { id: _currentProject.id, namn: _currentProject?.attributes?.name || '' };
    logg.korningar.push({
      tid: res.tid,
      av:  _profile?.email || '',
      modeller: res.rader.map(r => ({
        itemId: r.itemId, namn: r.namn, sokvag: r.sokvag,
        version: r.version, andrad: r.andrad, av: r.av,
      })),
      modellSet: res.setLista.map(s => ({ id: s.id, namn: s.namn, version: s.version, tid: s.tid })),
      vyer: res.vyer.rader.map(v => vkBekraftelseAttSpara(v)),
      baspunkt: _vk.bp.rader.map(r => ({
        namn: r.namn, status: r.status,
        position: r.position ? { x: r.position.x, y: r.position.y, z: r.position.z } : null,
        varsta: r.varsta ?? null, fel: r.fel || null,
      })),
      summering: res.summering,
    });
    while (logg.korningar.length > VK_LOGG_ANTAL) logg.korningar.shift();

    _vk.kor.loggItemId = await writeTextFile(
      _currentProject.id,
      _vk.lagring.mapp.id,
      VK_LOGG_FIL,
      JSON.stringify(logg, null, 2),
      _vk.kor.loggItemId
    );

    _vk.kor.logg   = logg;
    _vk.kor.sparad = true;
    vkToast('Veckans avläsning är sparad i projektet.');
  } catch (err) {
    vkToast(`Kunde inte spara avläsningen: ${vkFelText(err)}`, 'red');
  }

  _vk.kor.sparar = false;
  renderVeckokontroll();
}

// En bekräftelse gäller den model set-version den sattes för. Kryssas vyn i nu
// skrivs en ny bekräftelse, annars följer den gamla med oförändrad, så att en
// vy som redan är genomgången inte tappar sin bock bara för att veckan går.
function vkBekraftelseAttSpara(vy) {
  if (vy.bekraftad) {
    return {
      viewId: vy.viewId, namn: vy.namn, setVersion: vy.setVersion,
      bekraftad: true, av: _profile?.email || '', tid: new Date().toISOString(),
    };
  }
  return {
    viewId: vy.viewId, namn: vy.namn,
    setVersion: vy.bekraftadFor ?? null,
    bekraftad:  vy.bekraftadFor != null,
    av:  vy.bekraftadAv || '',
    tid: vy.bekraftadTid || null,
  };
}

// ── Körkortet ─────────────────────────────────────────────────────────────────

function vkRenderKorkort() {
  const k = _vk.kor;

  if (k.pagar) {
    return `
      <div class="bg-white border border-ads-border rounded p-5">
        <div class="flex items-center gap-2.5 text-sm text-ads-text">
          <svg class="animate-spin w-4 h-4 shrink-0 text-ads-blue" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
            <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
          </svg>
          <span class="font-medium">Kontrollen körs</span>
        </div>
        <p id="vk-kor-steg" class="text-xs text-ads-muted mt-2 ml-6.5">${vkEsc(k.steg || '')}</p>
      </div>`;
  }

  const senaste = _vk.kor.logg?.korningar?.[_vk.kor.logg.korningar.length - 1];

  return `
    <div class="bg-white border border-ads-border rounded p-5">
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 class="text-sm font-semibold text-ads-text">Kör veckans kontroll</h3>
          <p class="text-xs text-ads-muted mt-0.5">
            Läser senaste versionen av varje modell och jämför med förra avläsningen.
            ${senaste ? `Senast sparad ${vkEsc(vkDatum(senaste.tid))}${senaste.av ? ` av ${vkEsc(senaste.av)}` : ''}.` : ''}
          </p>
        </div>
        <button onclick="vkKor()"
                class="shrink-0 bg-ads-blue text-white text-sm font-medium rounded px-4 py-2 hover:bg-ads-blue-dark transition-colors">
          ${_vk.kor.resultat ? 'Kör igen' : 'Kör veckokontroll'}
        </button>
      </div>
      ${k.fel ? `<p class="text-sm text-red-600 mt-3 border-t border-dashed border-ads-border pt-3">${vkEsc(k.fel)}</p>` : ''}
    </div>`;
}

// ── Resultatet ────────────────────────────────────────────────────────────────

// Ritar om resultatdelen utan att röra resten av fliken, så att sidan inte
// hoppar när en delvy uppdateras.
function vkRitaResultat() {
  const el = document.getElementById('vk-resultat');
  if (el) el.outerHTML = vkRenderResultat();
  else renderVeckokontroll();
}

function vkRenderResultat() {
  const res = _vk.kor.resultat;
  if (!res) return '';

  return `
    <div id="vk-resultat" class="mt-5 space-y-5">
      ${vkRenderSammanfattning(res)}
      ${vkRenderModelltabell(res)}
      ${vkRenderVyer(res)}
      ${vkRenderBaspunkt(res)}
      ${vkRenderAvvikelser(res)}
      ${vkRenderNot(res)}
      ${vkRenderSparaKort(res)}
    </div>`;
}

function vkRenderSammanfattning(res) {
  const s = res.summering;

  const bricka = (antal, etikett, farg) => `
    <div class="flex-1 min-w-[104px] border border-ads-border rounded px-3 py-2.5 bg-white">
      <div class="text-xl font-semibold ${farg}">${antal}</div>
      <div class="text-[11px] text-ads-muted leading-tight mt-0.5">${etikett}</div>
    </div>`;

  return `
    <div>
      ${res.forsta ? `
        <div class="bg-blue-50 border border-blue-200 rounded px-4 py-3 mb-3">
          <p class="text-sm text-ads-text font-medium">Första avläsningen i det här projektet</p>
          <p class="text-xs text-ads-muted mt-0.5">
            Det finns inget att jämföra med ännu, så alla modeller räknas som nya. Spara avläsningen
            längst ned, så har nästa veckas körning ett läge att utgå från.
          </p>
        </div>` : `
        <p class="text-xs text-ads-muted mb-3">
          Jämfört med avläsningen ${vkEsc(vkDatum(res.forraTid))}. Åldersgräns ${res.grans} dagar.
          ${vkDagarSedan(res.forraTid) === 0 ? `<span class="text-orange-700">Den är från i dag,
            så ingenting hinner ha ändrats sedan dess. Kolonnen Sedan förra säger därför inget om veckan.</span>` : ''}
        </p>`}

      <div class="flex flex-wrap gap-2">
        ${bricka(s.totalt, 'modeller i mapparna', 'text-ads-text')}
        ${bricka(s.uppdaterade, 'uppdaterade sedan förra', 'text-green-600')}
        ${bricka(s.ovanforandrade, 'oförändrad version', s.ovanforandrade ? 'text-orange-600' : 'text-ads-text')}
        ${bricka(s.nya, res.forsta ? 'nya (allt är nytt)' : 'nya modeller', 'text-ads-blue')}
        ${bricka(s.gamla, `äldre än ${res.grans} dagar`, s.gamla ? 'text-orange-600' : 'text-ads-text')}
        ${bricka(s.saknasISet + s.setEfter, 'avviker mot samordningen', (s.saknasISet + s.setEfter) ? 'text-orange-600' : 'text-ads-text')}
        ${bricka(s.borttagna, 'försvunna sedan förra', s.borttagna ? 'text-red-600' : 'text-ads-text')}
        ${res.setLista.length ? bricka(s.vyerAttGa, 'vyer att gå igenom', s.vyerAttGa ? 'text-orange-600' : 'text-ads-text') : ''}
      </div>
    </div>`;
}

function vkMarke(text, ton) {
  const toner = {
    gron:   'bg-green-100 text-green-700',
    orange: 'bg-orange-100 text-orange-700',
    rod:    'bg-red-100 text-red-700',
    bla:    'bg-blue-100 text-blue-700',
    gra:    'bg-gray-100 text-gray-500',
  };
  return `<span class="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${toner[ton]}">${text}</span>`;
}

function vkForandringsMarke(r) {
  if (r.ny)            return vkMarke(r.forstaGangen ? 'Ny, första uppladdningen' : 'Ny sedan förra', 'bla');
  if (r.uppdaterad) {
    const steg = r.version - r.forraVersion;
    return vkMarke(steg > 1 ? `Uppdaterad, +${steg} versioner` : 'Uppdaterad', 'gron');
  }
  if (r.ovanforandrad) return vkMarke('Oförändrad version', 'orange');
  // Ska inte hända, versioner i ACC går bara uppåt. Visa siffrorna i stället för
  // att gissa vad som hänt.
  return vkMarke(`Version v${r.version ?? '?'}, förra v${r.forraVersion ?? '?'}`, 'orange');
}

function vkSamordningsMarke(r) {
  if (!r.set.length) return r.saknasISet ? vkMarke('Saknas i samordningen', 'rod') : vkMarke('–', 'gra');

  const efter = r.set.filter(s => s.arTip === false);
  if (efter.length) {
    const s = efter[0];
    return vkMarke(`Samordningen ligger efter (v${s.version ?? '?'})`, 'orange');
  }
  if (r.setFel) return vkMarke('Fel vid bearbetning', 'orange');
  return vkMarke('I fas', 'gron');
}

function vkRenderModelltabell(res) {
  if (!res.rader.length) {
    return `
      <div class="bg-white border border-ads-border rounded p-6">
        <p class="text-sm text-ads-muted">
          Inga modeller hittades i de bevakade mapparna. Kontrollera mappval och filtyper i inställningarna.
        </p>
      </div>`;
  }

  const rad = r => `
    <tr class="border-t border-ads-border align-top">
      <td class="py-2 pr-3">
        <div class="text-sm text-ads-text">${vkEsc(r.namn)}</div>
        <div class="text-[11px] text-ads-muted">${vkEsc(r.sokvag)}</div>
      </td>
      <td class="py-2 pr-3 text-sm text-ads-text whitespace-nowrap">v${r.version ?? '?'}</td>
      <td class="py-2 pr-3 whitespace-nowrap">
        <div class="text-sm text-ads-text">${vkEsc(vkKortDatum(r.andrad))}</div>
        ${r.av ? `<div class="text-[11px] text-ads-muted">${vkEsc(r.av)}</div>` : ''}
      </td>
      <td class="py-2 pr-3">${vkForandringsMarke(r)}</td>
      <td class="py-2 pr-3 text-sm whitespace-nowrap ${r.gammal ? 'text-orange-700 font-medium' : 'text-ads-text'}">
        ${r.alder == null ? '–' : `${r.alder} d`}
      </td>
      <td class="py-2">${vkSamordningsMarke(r)}</td>
    </tr>`;

  return `
    <div class="bg-white border border-ads-border rounded p-5">
      <h3 class="text-sm font-semibold text-ads-text mb-3">Modellerna</h3>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="text-[10px] uppercase tracking-widest text-ads-muted">
              <th class="pb-2 pr-3 font-semibold">Modell</th>
              <th class="pb-2 pr-3 font-semibold">Version</th>
              <th class="pb-2 pr-3 font-semibold">Senast uppladdad</th>
              <th class="pb-2 pr-3 font-semibold">Sedan förra</th>
              <th class="pb-2 pr-3 font-semibold">Ålder</th>
              <th class="pb-2 font-semibold">Samordning</th>
            </tr>
          </thead>
          <tbody>${res.rader.map(rad).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Vy-kortet ─────────────────────────────────────────────────────────────────

function vkRenderVyer(res) {
  if (!res.setLista.length) return '';

  return `
    <div class="bg-white border border-ads-border rounded p-5">
      <h3 class="text-sm font-semibold text-ads-text mb-1">Vyer i samordningen</h3>
      <p class="text-xs text-ads-muted mb-3 max-w-2xl">
        Om en vy innehåller senaste versionen av sina modeller går att läsa ur samordningen.
        Om vyn ser rätt ut måste du däremot titta på den själv, och kryssa i den här.
        Bocken gäller den model set-version den sattes för, så när settet får en ny version
        behöver vyn ses över igen.
      </p>
      <div id="vk-vyer-kort">${vkRenderVyerInnehall(res)}</div>
    </div>`;
}

function vkRenderVyerInnehall(res) {
  const v = res.vyer;

  if (!v.rader.length && !v.hittadeInte.length) {
    return `<p class="text-sm text-ads-muted">Inga vyer hittades i de valda model setten.</p>`;
  }

  const rad = (vy, i) => {
    const status = vy.iFas
      ? vkMarke('I fas med senaste modellerna', 'gron')
      : vy.efter.length
        ? vkMarke(`${vy.efter.length} modell${vy.efter.length === 1 ? '' : 'er'} ligger efter`, 'orange')
        : vkMarke(`${vy.saknade.length} modell${vy.saknade.length === 1 ? '' : 'er'} saknas i vyn`, 'orange');

    const bekraftelse = vy.bekraftad
      ? `<span class="text-[11px] text-green-700 font-medium">Bekräftad nu för v${vy.setVersion}</span>`
      : vy.behoverBekraftas
        ? `<span class="text-[11px] text-orange-700">
             ${vy.bekraftadFor != null
               ? `Bekräftad för v${vy.bekraftadFor}, settet är på v${vy.setVersion}`
               : 'Inte bekräftad ännu'}
           </span>`
        : `<span class="text-[11px] text-ads-muted">
             Bekräftad för v${vy.bekraftadFor}${vy.bekraftadAv ? ` av ${vkEsc(vy.bekraftadAv)}` : ''}
             ${vy.bekraftadTid ? vkEsc(vkKortDatum(vy.bekraftadTid)) : ''}
           </span>`;

    return `
      <div class="border-t border-ads-border py-2.5 flex items-start gap-3">
        <label class="flex items-center pt-0.5 cursor-pointer shrink-0" title="Bekräfta att vyn är genomgången">
          <input type="checkbox" ${vy.bekraftad ? 'checked' : ''} onchange="vkToggleVyBekraftad(${i})"
                 class="w-4 h-4 accent-ads-blue"/>
        </label>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm text-ads-text font-medium">${vkEsc(vy.namn)}</span>
            ${vy.privat ? vkMarke('Privat vy', 'gra') : ''}
            ${status}
          </div>
          <div class="text-[11px] text-ads-muted mt-0.5">
            ${vkEsc(vy.setNamn)} v${vy.setVersion}, ${vy.antalModeller} modell${vy.antalModeller === 1 ? '' : 'er'}
            ${vy.notering ? ` &middot; ${vkEsc(vy.notering)}` : ''}
          </div>
          ${vy.efter.length ? `
            <div class="text-[11px] text-orange-700 mt-1">
              Ligger efter: ${vy.efter.map(d => `${vkEsc(d.namn)} (v${d.versionISet ?? '?'} av v${d.tipVersion ?? '?'})`).join(', ')}
            </div>` : ''}
          <div class="mt-1">${bekraftelse}</div>
        </div>
      </div>`;
  };

  return `
    ${v.allaVisas && v.rader.length ? `
      <p class="text-[11px] text-ads-muted mb-1">
        Inga vyer är utpekade i inställningarna, så alla ${v.antalIProjektet} vyer visas.
      </p>` : ''}
    ${v.rader.map(rad).join('')}
    ${v.hittadeInte.length ? `
      <div class="border-t border-ads-border pt-3 mt-1">
        <p class="text-xs text-orange-700">
          Hittade inte ${v.hittadeInte.length === 1 ? 'vyn' : 'vyerna'}
          ${v.hittadeInte.map(x => `<strong>${vkEsc(x.namn)}</strong>`).join(', ')}
          i model setten. Vyn kan ha bytt namn, tagits bort, eller vara privat för någon annan.
        </p>
      </div>` : ''}
    ${v.ovriga.length ? `
      <p class="text-[11px] text-ads-muted border-t border-ads-border pt-2.5 mt-1">
        ${v.ovriga.length} ${v.ovriga.length === 1 ? 'vy' : 'vyer'} till finns i settet men bevakas inte:
        ${v.ovriga.map(x => vkEsc(x.namn)).join(', ')}
      </p>` : ''}`;
}

function vkRenderAvvikelser(res) {
  const delar = [];

  if (res.borttagna.length) {
    delar.push(vkAvvikelseLista(
      'Fanns förra avläsningen men hittas inte nu',
      'Filen kan vara flyttad, omdöpt eller borttagen. Kontrollera i ACC innan den rapporteras som saknad.',
      res.borttagna.map(m => `${vkEsc(m.namn)} <span class="text-ads-muted">(${vkEsc(m.sokvag || '')}, senast v${m.version ?? '?'})</span>`),
      'rod'));
  }

  if (res.utanfor.length) {
    delar.push(vkAvvikelseLista(
      'Ligger i samordningen men utanför de bevakade mapparna',
      'Antingen ligger filen i en mapp som inte bevakas, eller så behöver mappvalet i inställningarna utökas.',
      res.utanfor.map(m => `${vkEsc(m.namn)} <span class="text-ads-muted">(${vkEsc(m.set.join(', '))})</span>`),
      'orange'));
  }

  const setUtanVersion = res.setLista.filter(s => s.version == null);
  if (setUtanVersion.length) {
    delar.push(vkAvvikelseLista(
      'Model set utan läsbar version',
      'Model set-versionen kunde inte läsas, så jämförelsen mot samordningen saknas för dessa.',
      setUtanVersion.map(s => `${vkEsc(s.namn)}${s.fel ? ` <span class="text-ads-muted">(${vkEsc(s.fel)})</span>` : ''}`),
      'orange'));
  }

  if (res.problem.length) {
    delar.push(vkAvvikelseLista(
      'Det gick inte att läsa allt',
      'Resultatet ovan är därför inte fullständigt.',
      res.problem.map(vkEsc), 'orange'));
  }

  if (res.bromsad) {
    delar.push(vkAvvikelseLista(
      'Mappgränsen nåddes',
      `Kontrollen läste ${res.antalMappar} mappar och slutade där. Peka ut mapparna närmare modellerna, eller stäng av undermappar.`,
      [], 'orange'));
  }

  return delar.join('');
}

function vkAvvikelseLista(rubrik, hjalp, poster, ton) {
  const ram = ton === 'rod' ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50';
  return `
    <div class="border ${ram} rounded p-4">
      <h4 class="text-sm font-semibold text-ads-text">${rubrik}</h4>
      <p class="text-xs text-ads-muted mt-0.5 mb-2">${hjalp}</p>
      ${poster.length ? `<ul class="text-sm text-ads-text space-y-1">
        ${poster.map(p => `<li class="flex gap-2"><span class="text-ads-muted">•</span><span>${p}</span></li>`).join('')}
      </ul>` : ''}
    </div>`;
}

function vkRenderSparaKort(res) {
  if (_vk.kor.sparad) {
    return `
      <div class="border border-green-200 bg-green-50 rounded p-4 flex items-center gap-2.5">
        <svg class="w-4 h-4 text-green-600 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 10.5l4 4 8-8"/>
        </svg>
        <p class="text-sm text-ads-text">
          Avläsningen är sparad. Nästa körning jämförs mot den.
        </p>
      </div>`;
  }

  return `
    <div class="bg-white border border-ads-border rounded p-5 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h3 class="text-sm font-semibold text-ads-text">Spara veckans avläsning</h3>
        <p class="text-xs text-ads-muted mt-0.5 max-w-xl">
          Sparar dagens versionsnummer som utgångsläge, i
          <code class="bg-ads-gray px-1 py-0.5 rounded">${VK_LOGG_FIL}</code> i samma mapp som inställningarna.
          Nästa vecka jämförs mot detta. Kör du bara för att titta behöver du inte spara.
        </p>
      </div>
      <button onclick="vkSparaAvlasning()" ${_vk.kor.sparar ? 'disabled' : ''}
              class="shrink-0 text-sm font-medium rounded px-4 py-2 transition-colors
                     ${_vk.kor.sparar
                       ? 'bg-ads-border text-ads-muted cursor-not-allowed'
                       : 'bg-be-charcoal text-white hover:bg-black'}">
        ${_vk.kor.sparar ? 'Sparar…' : 'Spara avläsningen'}
      </button>
    </div>`;
}

function vkKortDatum(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
