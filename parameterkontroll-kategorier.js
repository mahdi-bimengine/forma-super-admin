// parameterkontroll-kategorier.js — steg 2 i fliken Parameterkontroll:
// kategorier och undantag (del 3).
//
// En tabell per filtyp: kategorierna som rader, modellerna som kolumner och
// antalet element i varje ruta. Bara kategorier som har element visas, delade
// i tre grupper: modellkategorier (med 3D-geometri), projektgemensamma och
// övriga. Övriga är ihopfällda, eftersom Revit även räknar skisslinjer,
// referensplan och material som element.
//
// En rad som kryssas för alla modeller hamnar i setup.radval och kryssas
// automatiskt i modeller som läggs till senare.

const PK_PROJEKTGEMENSAMMA = new Set([
  'Project Information', 'Levels', 'Level', 'Grids', 'Rooms', 'Spaces', 'MEP Spaces', 'Areas', 'HVAC Zones', 'Zones',
  'Piping Systems', 'Duct Systems', 'Electrical Circuits', 'Phases',
  'IfcProject', 'IfcSite', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSpace', 'IfcZone', 'IfcSpatialZone',
  'IfcSystem', 'IfcDistributionSystem', 'IfcGrid',
]);

const PK_KATEGORIGRUPPER = [
  { id: 'modell',  namn: 'Modellkategorier',   info: 'Kategorier med 3D-geometri.' },
  { id: 'projekt', namn: 'Projektgemensamma',  info: 'Projektinformation, våningar, rum, zoner och system.' },
  { id: 'ovriga',  namn: 'Övriga',             info: 'Taggar, mått, vyer, skisser och andra objekt utan 3D-geometri.' },
];

// Kategorin i gränssnittet: det svenska namnet med det engelska i grått bredvid.
function pkKatHtml(kat) {
  const sv = pkKatSv(kat);
  return sv ? `${pkEsc(sv)} <span class="text-[11px] text-ads-muted">${pkEsc(kat)}</span>` : pkEsc(kat);
}

function pkKatUi() {
  _pk.ui.kat ??= { sok: '', baraValda: false, sortering: 'namn', oppnaGrupper: new Set(['modell', 'projekt']), undantagForm: null };
  return _pk.ui.kat;
}

function pkTomtSteg(text, steg, knapptext) {
  return `
    <div class="bg-white border border-dashed border-ads-border rounded-lg px-6 py-12 text-center">
      <p class="text-sm text-ads-text font-medium">${pkEsc(text)}</p>
      ${steg ? `<button onclick="pkGaTill('${steg}')" class="mt-3 text-sm text-ads-blue hover:underline">${pkEsc(knapptext || 'Gå dit')}</button>` : ''}
    </div>`;
}

// Det gemensamma början på namnen tas bort i kolumnrubrikerna, så att det som
// skiljer modellerna åt syns. Klipps vid en avgränsare, aldrig mitt i ett ord.
function pkKortaNamn(namn) {
  const bas = namn.map(n => n.replace(/\.[^.]+$/, ''));
  if (bas.length < 2) return bas;
  let prefix = bas[0];
  for (const n of bas.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++;
    prefix = prefix.slice(0, i);
  }
  const m = prefix.match(/^(.*[-_ .])/);
  const bort = m ? m[1].length : 0;
  return bas.map(n => n.slice(bort) || n);
}

// ── Steget ────────────────────────────────────────────────────────────────────

function pkKategorierHtml() {
  const s  = _pk.setup;
  const ui = pkKatUi();
  if (!s.modeller.length) return pkTomtSteg('Välj modeller först.', 'modeller', 'Till Modeller');
  const grupper = ['rvt', 'ifc'].map(t => s.modeller.filter(m => m.filtyp === t)).filter(g => g.length);
  return `
    <div class="flex items-center gap-3 mb-3 flex-wrap">
      <input type="search" value="${pkEsc(ui.sok)}" placeholder="Sök kategori…" oninput="pkKatSok(this.value)"
             class="w-64 px-3 py-1.5 text-sm border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue bg-white"/>
      <label class="flex items-center gap-1.5 text-sm text-ads-text cursor-pointer">
        <input type="checkbox" ${ui.baraValda ? 'checked' : ''} onchange="pkKatBaraValda(this.checked)" class="accent-ads-blue"/> Visa bara valda
      </label>
      <label class="flex items-center gap-1.5 text-sm text-ads-text cursor-pointer" title="ACC ger Revits kategorier på engelska. Det engelska namnet visas alltid bredvid.">
        <input type="checkbox" ${pkSvenskaKategorier() ? 'checked' : ''} onchange="pkKatSvenska(this.checked)" class="accent-ads-blue"/> Svenska kategorinamn
      </label>
      <label class="flex items-center gap-1.5 text-sm text-ads-muted">Sortera
        <select onchange="pkKatSortera(this.value)" class="text-sm border border-ads-border rounded px-2 py-1 bg-white">
          <option value="namn" ${ui.sortering === 'namn' ? 'selected' : ''}>på namn</option>
          <option value="antal" ${ui.sortering === 'antal' ? 'selected' : ''}>på antal element</option>
        </select>
      </label>
    </div>
    <p class="text-xs text-ads-muted mb-3">Bara kategorier som har element i modellerna visas. En rad som kryssas för alla modeller
      kryssas också i modeller som läggs till senare.</p>
    <div id="pk-matriser">${grupper.map(pkMatrisHtml).join('')}</div>
    <div id="pk-undantag" class="mt-6">${pkUndantagHtml()}</div>`;
}

function pkKatSok(q) { pkKatUi().sok = q; pkRitaMatriser(); }
function pkKatBaraValda(pa) { pkKatUi().baraValda = pa; pkRitaMatriser(); }
function pkKatSortera(s) { pkKatUi().sortering = s; pkRitaMatriser(); }
function pkKatSvenska(pa) { pkSattSvenskaKategorier(pa); pkRita(); }

function pkKatGrupp(id) {
  const ui = pkKatUi();
  if (ui.oppnaGrupper.has(id)) ui.oppnaGrupper.delete(id);
  else ui.oppnaGrupper.add(id);
  pkRitaMatriser();
}

function pkRitaMatriser() {
  const el = document.getElementById('pk-matriser');
  if (!el) return;
  const s = _pk.setup;
  el.innerHTML = ['rvt', 'ifc'].map(t => s.modeller.filter(m => m.filtyp === t)).filter(g => g.length).map(pkMatrisHtml).join('');
}

// När förberedelse eller körning rapporterar något ritas bara tabellerna om.
function pkRitaStegDelar() {
  if (_pk.steg === 'kategorier') { pkRitaMatriser(); return; }
  if (_pk.steg === 'resultat' && typeof pkRitaResultatDelar === 'function') pkRitaResultatDelar();
  if (_pk.steg === 'parametrar' && typeof pkRitaParametrarDelar === 'function') pkRitaParametrarDelar();
}

// Raderna i en tabell: alla kategorier som någon av modellerna har, plus de
// som är valda men saknas i en ny version (de ska synas, inte försvinna).
function pkKategoriRader(modeller) {
  const rader = new Map();
  for (const m of modeller) {
    const d = pkModellData(m.id);
    for (const [kat, a] of Object.entries(d?.kategoriAntal || {})) {
      const r = rader.get(kat) || { namn: kat, geometri: 0, totalt: 0 };
      r.geometri += a.geometri ?? 1;
      r.totalt   += a.antal;
      rader.set(kat, r);
    }
    for (const kat of m.kategorier) if (!rader.has(kat)) rader.set(kat, { namn: kat, geometri: 1, totalt: 0 });
  }
  for (const r of rader.values()) r.grupp = PK_PROJEKTGEMENSAMMA.has(r.namn) ? 'projekt' : r.geometri > 0 ? 'modell' : 'ovriga';
  return [...rader.values()];
}

function pkMatrisHtml(modeller) {
  const ui    = pkKatUi();
  const typ   = modeller[0].filtyp;
  const korta = pkKortaNamn(modeller.map(m => m.namn));
  const q     = ui.sok.trim().toLocaleLowerCase('sv');
  const klara = modeller.filter(m => pkModellData(m.id)?.status === 'klar').length;
  let rader   = pkKategoriRader(modeller)
    .filter(r => !q || r.namn.toLocaleLowerCase('sv').includes(q) || (pkKatSv(r.namn) || '').toLocaleLowerCase('sv').includes(q))
    .filter(r => !ui.baraValda || modeller.some(m => m.kategorier.includes(r.namn)));
  const visas = r => pkKatSv(r.namn) || r.namn;
  rader.sort(ui.sortering === 'antal' ? (a, b) => b.totalt - a.totalt : (a, b) => visas(a).localeCompare(visas(b), 'sv'));

  const kolumner = modeller.map((m, i) => {
    const d = pkModellData(m.id);
    const j = pkNod(m.id);
    const kopiera = modeller.filter(x => x !== m && x.kategorier.length);
    return `
      <th class="px-2 py-2 text-left align-bottom font-normal min-w-[8rem]">
        <div class="text-[10px] uppercase tracking-wide text-ads-muted">${pkEsc(m.disciplin || '')}</div>
        <div class="text-xs font-semibold text-ads-text truncate max-w-[10rem]" title="${pkEsc(m.namn)}">${pkEsc(korta[i])}</div>
        <div class="text-[11px] text-ads-muted">${d?.fel ? '<span class="text-red-600">fel</span>' : d?.status === 'klar' ? `${m.kategorier.length} valda` : 'förbereds…'}</div>
        ${kopiera.length ? `<select onchange="pkKopieraKategorier(${j}, this.value); this.value=''" class="mt-1 text-[11px] border border-ads-border rounded px-1 py-0.5 bg-white max-w-[10rem]">
          <option value="">Kopiera val från…</option>
          ${kopiera.map(x => `<option value="${pkNod(x.id)}">${pkEsc(korta[modeller.indexOf(x)])}</option>`).join('')}
        </select>` : ''}
      </th>`;
  }).join('');

  const grupperHtml = PK_KATEGORIGRUPPER.map(g => {
    const gr = rader.filter(r => r.grupp === g.id);
    if (!gr.length) return '';
    const oppen = ui.oppnaGrupper.has(g.id) || !!q;
    const valdaIGrupp = gr.reduce((n, r) => n + modeller.filter(m => m.kategorier.includes(r.namn)).length, 0);
    return `
      <tbody>
        <tr class="bg-ads-gray/60 border-t border-ads-border">
          <td colspan="${modeller.length + 1}" class="px-3 py-1.5">
            <button onclick="pkKatGrupp('${g.id}')" class="flex items-center gap-2 text-xs text-ads-text">
              <svg class="w-3 h-3 transition-transform ${oppen ? 'rotate-90' : ''}" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/></svg>
              <span class="font-semibold">${g.namn}</span>
              <span class="text-ads-muted">${gr.length} ${gr.length === 1 ? 'kategori' : 'kategorier'}${valdaIGrupp ? ` · ${valdaIGrupp} val` : ''} · ${g.info}</span>
            </button>
          </td>
        </tr>
        ${oppen ? gr.map(r => pkKategoriRadHtml(r, modeller)).join('') : ''}
      </tbody>`;
  }).join('');

  return `
    <div class="bg-white border border-ads-border rounded-lg mb-4 overflow-hidden">
      <div class="px-4 py-2.5 border-b border-ads-border flex items-center gap-2">
        ${pkTypBricka(typ)}<h3 class="text-sm font-semibold text-ads-text">${typ === 'ifc' ? 'IFC-modeller' : 'Revit-modeller'}</h3>
        ${klara < modeller.length ? `<span class="text-xs text-ads-muted">${modeller.length - klara} förbereds fortfarande…</span>` : ''}
      </div>
      <div class="overflow-auto" style="max-height:70vh">
        <table class="text-sm border-collapse">
          <thead class="sticky top-0 bg-white z-10 shadow-[0_1px_0_#e0e0e0]">
            <tr><th class="px-3 py-2 text-left align-bottom text-[11px] uppercase tracking-wide text-ads-muted font-semibold sticky left-0 bg-white min-w-[14rem]">Kategori</th>${kolumner}</tr>
          </thead>
          ${grupperHtml || `<tbody><tr><td colspan="${modeller.length + 1}" class="px-4 py-6 text-sm text-ads-muted">${q ? 'Ingen kategori matchar sökningen.' : klara ? 'Inga kategorier.' : 'Modellerna förbereds…'}</td></tr></tbody>`}
        </table>
      </div>
    </div>`;
}

function pkKategoriRadHtml(r, modeller) {
  const k = pkNod(`kat:${r.namn}`);
  const harDen = modeller.filter(m => pkModellData(m.id)?.kategoriAntal?.[r.namn]);
  const valda  = harDen.filter(m => m.kategorier.includes(r.namn)).length;
  const alla   = harDen.length && valda === harDen.length;
  const rad    = (_pk.setup.radval || []).includes(r.namn);
  return `
    <tr class="border-t border-ads-border hover:bg-ads-gray/40">
      <td class="px-3 py-1.5 sticky left-0 bg-white">
        <button onclick="pkKryssaRad(${k}, '${modeller[0].filtyp}')" class="flex items-center gap-2 text-left w-full"
                title="${alla ? 'Avmarkera i alla modeller' : 'Välj i alla modeller som har kategorin'}">
          <span class="w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px]
                       ${alla ? 'bg-ads-blue border-ads-blue text-white' : valda ? 'border-ads-blue text-ads-blue' : 'border-ads-muted'}">${alla ? '✓' : valda ? '–' : ''}</span>
          <span class="text-ads-text truncate">${pkKatHtml(r.namn)}</span>
          ${rad ? `<span class="text-[10px] text-ads-blue shrink-0" title="Kryssas automatiskt i modeller som läggs till senare">alla</span>` : ''}
        </button>
      </td>
      ${modeller.map(m => {
        const d = pkModellData(m.id);
        const a = d?.kategoriAntal?.[r.namn];
        const vald = m.kategorier.includes(r.namn);
        const j = pkNod(m.id);
        if (!a && vald) {
          return `<td class="px-2 py-1.5"><label class="flex items-center gap-1.5 text-xs text-amber-700 cursor-pointer" title="Kategorin är vald men har inga element i den här versionen">
            <input type="checkbox" checked onchange="pkKryssaCell(${j}, ${k}, this.checked)" class="accent-ads-blue"/> 0 element</label></td>`;
        }
        if (!a) return `<td class="px-2 py-1.5 text-ads-border text-xs">${d?.status === 'klar' ? '' : '·'}</td>`;
        const ny = m.sedda?.length && !m.sedda.includes(r.namn);
        return `<td class="px-2 py-1.5"><label class="flex items-center gap-1.5 text-xs cursor-pointer ${vald ? 'text-ads-text' : 'text-ads-muted'}">
          <input type="checkbox" ${vald ? 'checked' : ''} onchange="pkKryssaCell(${j}, ${k}, this.checked)" class="accent-ads-blue"/>
          ${pkTalText(a.antal)}${ny ? `<span class="text-[10px] font-semibold bg-amber-100 text-amber-700 rounded px-1">Ny</span>` : ''}</label></td>`;
      }).join('')}
    </tr>`;
}

function pkKryssaCell(j, k, pa) {
  const id  = pkNodId(j);
  const kat = pkNodId(k).slice(4);
  pkAndra(`${pa ? 'Valde' : 'Tog bort'} ${kat}`, s => {
    const m = s.modeller.find(x => x.id === id);
    if (!m) return;
    m.kategorier = pa ? [...new Set([...m.kategorier, kat])] : m.kategorier.filter(x => x !== kat);
    if (!pa) s.radval = (s.radval || []).filter(x => x !== kat);
  });
}

function pkKryssaRad(k, filtyp) {
  const kat     = pkNodId(k).slice(4);
  const modeller = _pk.setup.modeller.filter(m => m.filtyp === filtyp && pkModellData(m.id)?.kategoriAntal?.[kat]);
  const alla    = modeller.length && modeller.every(m => m.kategorier.includes(kat));
  pkAndra(`${alla ? 'Tog bort' : 'Valde'} ${kat} i alla modeller`, s => {
    const ids = new Set(modeller.map(m => m.id));
    for (const m of s.modeller) {
      if (!ids.has(m.id) && !(alla && m.filtyp === filtyp)) continue;
      m.kategorier = alla ? m.kategorier.filter(x => x !== kat) : [...new Set([...m.kategorier, kat])];
    }
    s.radval = alla ? (s.radval || []).filter(x => x !== kat) : [...new Set([...(s.radval || []), kat])];
  });
}

function pkKopieraKategorier(j, franNod) {
  if (franNod === '') return;
  const till = _pk.setup.modeller.find(m => m.id === pkNodId(j));
  const fran = _pk.setup.modeller.find(m => m.id === pkNodId(Number(franNod)));
  if (!till || !fran) return;
  const finns = pkModellData(till.id)?.kategoriAntal || {};
  const kopior = fran.kategorier.filter(k => finns[k]);
  pkAndra(`Kopierade kategorival till ${till.namn}`, s => {
    const m = s.modeller.find(x => x.id === till.id);
    m.kategorier = [...new Set([...m.kategorier, ...kopior])];
  });
  const saknas = fran.kategorier.length - kopior.length;
  vkToast(`${kopior.length} kategorier kopierade.${saknas ? ` ${saknas} finns inte i ${till.namn}.` : ''}`);
}

// Rader som kryssats för alla modeller kryssas även i nya modeller, så fort
// de är förberedda. Bara en gång per modell, så att ett eget avval står kvar.
function pkTillampaRadval(id) {
  const m = _pk.setup.modeller.find(x => x.id === id);
  const d = pkModellData(id);
  if (!m?.ny || !d?.kategoriAntal) return;
  const nya = (_pk.setup.radval || []).filter(k => d.kategoriAntal[k] && !m.kategorier.includes(k));
  m.kategorier.push(...nya);
  delete m.ny;
  if (nya.length) { _pk.andrat = true; pkSparaUtkast(); }
}

// ── Undantag ──────────────────────────────────────────────────────────────────

const PK_OPERATORER = [
  ['ar', 'är'], ['innehaller', 'innehåller'], ['borjar', 'börjar med'], ['tom', 'är tom'], ['inteTom', 'är inte tom'],
];

function pkUndantagText(u) {
  const vad = u.typ === 'familj' ? `Familj ${u.monster}`
    : u.typ === 'typ' ? `Typ ${u.monster}`
    : `${u.parameter} ${(PK_OPERATORER.find(o => o[0] === u.operator) || [, u.operator])[1]}${['tom', 'inteTom'].includes(u.operator) ? '' : ` ${u.varde}`}`;
  const var_ = [
    u.modeller?.length ? u.modeller.map(id => _pk.setup.modeller.find(m => m.id === id)?.namn || 'borttagen modell').join(', ') : 'alla modeller',
    u.kategorier?.length ? u.kategorier.map(k => pkKatText(k)).join(', ') : 'alla kategorier',
  ].join(' · ');
  return { vad, var: var_ };
}

// Antal undantagna per regel ur senaste körningen. Före körning finns inga
// elementdata att räkna på.
function pkUndantagAntal(id) {
  const res = _pk.korning?.resultat;
  if (!res) return null;
  return res.modeller.reduce((n, m) => n + (m.undantag.find(u => u.id === id)?.antal || 0), 0);
}

function pkUndantagHtml() {
  const s  = _pk.setup;
  const ui = pkKatUi();
  const t  = _pk.korning?.resultat;
  const varningar = t ? t.modeller.flatMap(m => [
    ...m.tackning.undantagUtanTraff.map(id => ({ id, text: `matchade inga element i ${m.namn}` })),
    ...m.tackning.storaUndantag.map(u => ({ id: u.id, text: `tar bort ${u.antal} av ${u.av} element i ${pkKatText(u.kategori)} i ${m.namn}` })),
  ]) : [];
  return `
    <div class="bg-white border border-ads-border rounded-lg">
      <div class="px-4 py-2.5 border-b border-ads-border flex items-center gap-3">
        <h3 class="text-sm font-semibold text-ads-text">Undantag</h3>
        <span class="text-xs text-ads-muted">Element som med avsikt inte ska kontrolleras. De räknas och listas alltid i rapporterna.</span>
        ${ui.undantagForm ? '' : `<button onclick="pkUndantagNytt()" class="ml-auto text-sm text-ads-blue hover:underline shrink-0">+ Lägg till undantag</button>`}
      </div>
      ${s.undantag.length ? `<ul class="divide-y divide-ads-border">${s.undantag.map((u, i) => {
        const txt = pkUndantagText(u);
        const n   = pkUndantagAntal(u.id);
        const var_ = varningar.filter(v => v.id === u.id);
        return `
          <li class="px-4 py-2.5 flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-sm text-ads-text">${pkEsc(txt.vad)} <span class="text-xs text-ads-muted">· ${pkEsc(txt.var)}</span></p>
              ${u.skal ? `<p class="text-xs text-ads-muted mt-0.5">Skäl: ${pkEsc(u.skal)}</p>` : ''}
              ${var_.map(v => `<p class="text-xs text-amber-700 mt-0.5">Regeln ${pkEsc(v.text)}.</p>`).join('')}
            </div>
            <span class="text-xs ${n ? 'text-ads-text' : 'text-ads-muted'} shrink-0 mt-0.5">${n === null ? 'Antal visas efter körning' : `${pkTalText(n)} element undantagna`}</span>
            <button onclick="pkUndantagTaBort(${i})" class="text-ads-muted hover:text-red-500 shrink-0" title="Ta bort regeln">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M5 5l10 10M15 5L5 15"/></svg></button>
          </li>`;
      }).join('')}</ul>` : ui.undantagForm ? '' : `<p class="px-4 py-4 text-sm text-ads-muted">Inga undantag. Alla element i de valda kategorierna kontrolleras.</p>`}
      ${ui.undantagForm ? pkUndantagFormHtml() : ''}
    </div>`;
}

function pkUndantagNytt() {
  pkKatUi().undantagForm = { typ: 'familj', monster: '', parameter: '', operator: 'ar', varde: '', modell: '', kategori: '', skal: '' };
  pkRitaUndantag();
}

function pkRitaUndantag() {
  const el = document.getElementById('pk-undantag');
  if (el) el.innerHTML = pkUndantagHtml();
}

function pkUndantagFalt(falt, varde) {
  const f = pkKatUi().undantagForm;
  if (!f) return;
  f[falt] = varde;
  if (falt === 'typ' || falt === 'operator') pkRitaUndantag();
}

function pkUndantagFormHtml() {
  const f = pkKatUi().undantagForm;
  const s = _pk.setup;
  const kategorier = [...new Set(s.modeller.flatMap(m => m.kategorier))].sort((a, b) => a.localeCompare(b, 'sv'));
  const parametrar = [...new Set(s.modeller.flatMap(m => (pkModellData(m.id)?.karta?.falt || []).map(x => x.namn)))].sort((a, b) => a.localeCompare(b, 'sv'));
  const falt = 'px-2 py-1.5 text-sm border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue bg-white';
  const utanVarde = ['tom', 'inteTom'].includes(f.operator);
  return `
    <div class="px-4 py-3 border-t border-ads-border bg-ads-gray/40 flex flex-col gap-2.5">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-sm text-ads-text">Undanta element där</span>
        <select onchange="pkUndantagFalt('typ', this.value)" class="${falt}">
          <option value="familj" ${f.typ === 'familj' ? 'selected' : ''}>familjenamnet</option>
          <option value="typ" ${f.typ === 'typ' ? 'selected' : ''}>typnamnet</option>
          <option value="parameter" ${f.typ === 'parameter' ? 'selected' : ''}>parametern</option>
        </select>
        ${f.typ === 'parameter' ? `
          <input value="${pkEsc(f.parameter)}" list="pk-undantag-param" placeholder="Parameternamn" oninput="pkUndantagFalt('parameter', this.value)" class="${falt} w-48"/>
          <datalist id="pk-undantag-param">${parametrar.map(p => `<option value="${pkEsc(p)}">`).join('')}</datalist>
          <select onchange="pkUndantagFalt('operator', this.value)" class="${falt}">
            ${PK_OPERATORER.map(([v, t]) => `<option value="${v}" ${f.operator === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          ${utanVarde ? '' : `<input value="${pkEsc(f.varde)}" placeholder="Värde" oninput="pkUndantagFalt('varde', this.value)" class="${falt} w-40"/>`}
        ` : `
          <span class="text-sm text-ads-text">matchar</span>
          <input value="${pkEsc(f.monster)}" placeholder="t.ex. *Ref* eller Befintlig*" oninput="pkUndantagFalt('monster', this.value)" class="${falt} w-56"/>
        `}
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-sm text-ads-text">i</span>
        <select onchange="pkUndantagFalt('modell', this.value)" class="${falt}">
          <option value="">alla modeller</option>
          ${s.modeller.map(m => `<option value="${pkNod(m.id)}" ${f.modell === String(pkNod(m.id)) ? 'selected' : ''}>${pkEsc(m.namn)}</option>`).join('')}
        </select>
        <select onchange="pkUndantagFalt('kategori', this.value)" class="${falt}">
          <option value="">alla kategorier</option>
          ${kategorier.map(k => `<option value="${pkEsc(k)}" ${f.kategori === k ? 'selected' : ''}>${pkEsc(pkKatText(k))}</option>`).join('')}
        </select>
        <input value="${pkEsc(f.skal)}" placeholder="Skäl, visas i rapporterna" oninput="pkUndantagFalt('skal', this.value)" class="${falt} flex-1 min-w-[12rem]"/>
      </div>
      <p class="text-xs text-ads-muted">* står för vad som helst och ? för ett tecken. Inget skiftläge. Undantagna element räknas och listas alltid.</p>
      <div class="flex gap-2 justify-end">
        ${pkKnapp('Avbryt', 'pkUndantagAvbryt()')}
        ${pkKnapp('Lägg till', 'pkUndantagSpara()', { primar: true })}
      </div>
    </div>`;
}

function pkUndantagAvbryt() {
  pkKatUi().undantagForm = null;
  pkRitaUndantag();
}

function pkUndantagSpara() {
  const f = pkKatUi().undantagForm;
  if (!f) return;
  const regel = { id: pkNyttId(), typ: f.typ, skal: f.skal.trim() };
  if (f.typ === 'parameter') {
    if (!f.parameter.trim()) return vkToast('Skriv vilken parameter regeln gäller.', 'red');
    if (!['tom', 'inteTom'].includes(f.operator) && !f.varde.trim()) return vkToast('Skriv vilket värde regeln gäller.', 'red');
    Object.assign(regel, { parameter: f.parameter.trim(), operator: f.operator, varde: f.varde.trim() });
  } else {
    if (!f.monster.trim()) return vkToast(`Skriv vilket ${f.typ === 'familj' ? 'familjenamn' : 'typnamn'} regeln gäller.`, 'red');
    regel.monster = f.monster.trim();
  }
  if (f.modell !== '') regel.modeller = [pkNodId(Number(f.modell))];
  if (f.kategori) regel.kategorier = [f.kategori];
  pkKatUi().undantagForm = null;
  pkAndra('La till ett undantag', s => { s.undantag.push(regel); });
}

function pkUndantagTaBort(i) {
  pkAndra('Tog bort ett undantag', s => { s.undantag.splice(i, 1); });
}
