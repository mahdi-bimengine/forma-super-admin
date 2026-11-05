// vyhantering-matris.js — läget "Jämför mot Excel" i fliken Vyhantering.
//
// Jämför projektets publika vyer i Model Coordination med en Excel som anger
// vilka vyer som ska finnas och vilka modeller varje vy ska innehålla. Filen
// läses bara i webbläsaren. Man pekar själv ut kolumnerna, så att en befintlig
// fil kan användas som den är. Fyra upplägg stöds:
//
//   blad      ett blad per vy: ovanför rubriken "Modell" står vyns namn per
//             ACC-projekt ("DD & Execution: <namn>", "Endast <projekt>" + namn),
//             under den en modell per rad i kolumn A
//   kolumner  en rad per vy, en kolumn per modell, ifylld cell = ska vara med
//   lista     en rad per vy, modellerna i en cell separerade med , ; eller radbrytning
//   rader     en rad per vy och modell
//
// En modell kan skrivas "fil.rvt - 3D-vy", som Model Coordination själv visar
// den, och då jämförs även 3D-vyn. Annars kan den vara hela filnamnet eller en
// del av det, till exempel "EL" eller "K-", och matchar varje modell vars
// filnamn innehåller den som ett helt ord. Avvikelser kan rättas genom att
// modeller läggs till eller tas bort i vyerna (updateModelSetViewDefinition,
// som i läget Per model set).
//
// Vyernas data kommer från vyhantering-publika.js (_vp.rader). State: _vm.

const _vm = {
  fil:       null,     // { namn, blad: { namn: rader } }
  blad:      '',
  mappning:  null,     // se vmStandardMappning
  valda:     new Set(),// nycklar (setId|viewId) för vyer som ska rättas
  taBort:    false,    // ta även bort modeller som inte står i Excel
  plan:      null,     // väntande rättningar
  kor:       null,     // { klar, rader: [{ namn, status, fel }] }
  fel:       null,
};

const VM_NEJ = new Set(['nej', 'no', 'n', '0', '-', 'false', 'falskt', 'ej']);

function vmStandardMappning() {
  return { rubrikrad: 1, vyKol: 0, setKol: -1, upplagg: 'kolumner', modellKol: 1, modellFran: 1, modellTill: -1, projektEtikett: '' };
}

// ── Upplägget "ett blad per vy" ───────────────────────────────────────────────

// Läser ett blad: vynamn per projektetikett, modellerna och raden för "Modell".
function vmLasVyblad(rader) {
  const h = rader.findIndex(r => /^modell$/i.test((r[0] || '').trim()));
  if (h < 0) return null;
  const rader_ovan = rader.slice(0, h).flatMap(r => r.filter(Boolean).flatMap(c => String(c).split(/\r?\n/)))
    .map(s => s.trim()).filter(Boolean);
  if (!rader_ovan.some(s => /^visningsnamn/i.test(s))) return null;

  const namn = new Map();     // projektetikett → vynamn ('' = finns inte där)
  let vantar = null;
  for (const s of rader_ovan) {
    if (/^visningsnamn/i.test(s)) continue;
    const endast = s.match(/^endast\s+(.+)$/i);
    if (endast) { vantar = endast[1].trim(); continue; }
    const par = s.match(/^([^:]+):\s*(.*)$/);
    if (par) { namn.set(par[1].trim(), par[2].trim()); vantar = null; continue; }
    if (vantar) { namn.set(vantar, s); vantar = null; continue; }
    // En ensam etikett, och namnet på nästa rad.
    vantar = s;
  }
  if (vantar && !namn.has(vantar)) namn.set(vantar, '');

  const modeller = [];
  for (let i = h + 1; i < rader.length; i++) {
    const cell = (rader[i][0] || '').trim();
    if (!cell) continue;
    // Fotrader som "DD & Execution: 02/11/2026" och "Kontroll: 03/11/2026".
    if (/^[^:\n]{1,40}:\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})?\s*$/.test(cell)) continue;
    modeller.push({ text: cell, rad: i + 1, kommentar: rader[i].slice(1).filter(Boolean).join(' · ') });
  }
  return { namn, modeller, rad: h + 1 };
}

function vmArBladUpplagg() {
  return !!_vm.fil && Object.values(_vm.fil.blad).some(r => vmLasVyblad(r));
}

// Etiketterna i filen, och den som bäst passar projektet man står i.
function vmProjektEtiketter() {
  const alla = new Set();
  for (const rader of Object.values(_vm.fil?.blad || {})) for (const k of vmLasVyblad(rader)?.namn.keys() || []) alla.add(k);
  return [...alla];
}

function vmGissaEtikett() {
  const projekt = vmNorm(_currentProject?.attributes?.name);
  return vmProjektEtiketter().find(e => vmNorm(e) && projekt.includes(vmNorm(e))) || '';
}

// "fil.rvt - 3D-vy" → { fil, vy3d }. Utan filändelse före " - " är hela
// texten filnamnet.
function vmTolkaModell(text) {
  const s = String(text || '').trim();
  const m = s.match(/^(.+?\.(?:rvt|ifc|ifczip|dwg|dgn|nwc|nwd|stp|step|fbx))\s+-\s+(.+)$/i);
  return m ? { text: s, fil: m[1].trim(), vy3d: m[2].trim() } : { text: s, fil: s, vy3d: null };
}

function vmSparadMappning() {
  try { return { ...vmStandardMappning(), ...JSON.parse(localStorage.getItem('vm-mappning') || '{}') }; }
  catch { return vmStandardMappning(); }
}

function vmSparaMappning() {
  try { localStorage.setItem('vm-mappning', JSON.stringify(_vm.mappning)); } catch { /* inte kritiskt */ }
}

// ── Filen ─────────────────────────────────────────────────────────────────────

async function vmLasFil(filer) {
  const fil = filer?.[0];
  if (!fil) return;
  try {
    const bok = XLSX.read(new Uint8Array(await fil.arrayBuffer()), { type: 'array' });
    const blad = {};
    for (const namn of bok.SheetNames) {
      blad[namn] = XLSX.utils.sheet_to_json(bok.Sheets[namn], { header: 1, defval: '', raw: false, blankrows: true })
        .map(r => r.map(c => String(c ?? '').trim()));
    }
    _vm.fil = { namn: fil.name, blad };
    _vm.blad = bok.SheetNames.find(n => blad[n].some(r => r.some(Boolean))) || bok.SheetNames[0];
    _vm.mappning = vmSparadMappning();
    // En fil med ett blad per vy känns igen direkt.
    if (vmArBladUpplagg()) {
      _vm.mappning.upplagg = 'blad';
      if (!vmProjektEtiketter().includes(_vm.mappning.projektEtikett)) _vm.mappning.projektEtikett = vmGissaEtikett();
    } else if (_vm.mappning.upplagg === 'blad') {
      _vm.mappning.upplagg = 'kolumner';
    }
    _vm.fel = null;
  } catch (err) {
    _vm.fel = `Filen kunde inte läsas: ${err.message}`;
  }
  _vm.plan = null;
  _vm.kor = null;
  vhRita();
}

function vmRader() {
  return _vm.fil?.blad[_vm.blad] || [];
}

function vmAntalKol() {
  return Math.max(0, ...vmRader().slice(0, 200).map(r => r.length));
}

function vmKolNamn(i) {
  const rubrik = vmRader()[(_vm.mappning?.rubrikrad || 1) - 1]?.[i];
  return `${XLSX.utils.encode_col(i)}${rubrik ? ` – ${rubrik}` : ''}`;
}

function vmSattMappning(nyckel, varde) {
  _vm.mappning[nyckel] = ['upplagg', 'projektEtikett'].includes(nyckel) ? varde : Number(varde);
  vmSparaMappning();
  _vm.plan = null;
  vhRita();
}

function vmSattBlad(namn) {
  _vm.blad = namn;
  _vm.plan = null;
  vhRita();
}

// Vyerna och deras modeller enligt filen: [{ vy, set, ider, rad, blad }],
// där ider är [{ text, fil, vy3d, kommentar }]. I upplägget blad kommer också
// de vyer som bara finns i ett annat projekt med, som annatProjekt.
function vmExcelVyer() {
  const m = _vm.mappning;
  if (m.upplagg === 'blad') {
    const ut = [];
    for (const [bladNamn, rader] of Object.entries(_vm.fil.blad)) {
      const b = vmLasVyblad(rader);
      if (!b) continue;
      const vy = b.namn.get(m.projektEtikett) || '';
      const ider = b.modeller.map(x => ({ ...vmTolkaModell(x.text), kommentar: x.kommentar }));
      if (vy) ut.push({ vy, set: '', ider, rad: b.rad, blad: bladNamn });
      else ut.push({ vy: '', set: '', ider, rad: b.rad, blad: bladNamn, annatProjekt: [...b.namn].filter(([, n]) => n).map(([e]) => e) });
    }
    return ut;
  }
  const rader = vmRader();
  const rubrik = rader[m.rubrikrad - 1] || [];
  const perVy = new Map();
  const lagg = (vy, set, ider, rad) => {
    const nyckel = `${vmNorm(set)}|${vmNorm(vy)}`;
    if (!perVy.has(nyckel)) perVy.set(nyckel, { vy, set, ider: [], rad, blad: _vm.blad });
    perVy.get(nyckel).ider.push(...ider.filter(Boolean).map(vmTolkaModell));
  };
  for (let i = m.rubrikrad; i < rader.length; i++) {
    const r = rader[i];
    const vy = r[m.vyKol] || '';
    if (!vy) continue;
    const set = m.setKol >= 0 ? r[m.setKol] || '' : '';
    if (m.upplagg === 'kolumner') {
      const till = m.modellTill >= 0 ? m.modellTill : vmAntalKol() - 1;
      const ider = [];
      for (let k = m.modellFran; k <= till; k++) {
        if (k === m.vyKol || k === m.setKol) continue;
        const cell = (r[k] || '').toLowerCase();
        if (cell && !VM_NEJ.has(cell) && rubrik[k]) ider.push(rubrik[k]);
      }
      lagg(vy, set, ider, i + 1);
    } else if (m.upplagg === 'lista') {
      lagg(vy, set, String(r[m.modellKol] || '').split(/[,;\n]+/).map(s => s.trim()), i + 1);
    } else {
      lagg(vy, set, [r[m.modellKol] || ''], i + 1);
    }
  }
  return [...perVy.values()];
}

// ── Jämförelse ────────────────────────────────────────────────────────────────

function vmNorm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9åäöéü]+/g, ' ').trim();
}

function vmUtanFilandelse(namn) {
  return String(namn || '').replace(/\.(rvt|ifc|nwc|nwd|dwg|dgn|fbx|ifczip)$/i, '');
}

// Ett namn ur Excel matchar en modell om det är hela filnamnet eller står
// som ett eller flera hela ord i det.
function vmMatchar(modellNamn, ident) {
  const n = vmNorm(vmUtanFilandelse(modellNamn));
  const i = vmNorm(vmUtanFilandelse(ident));
  return !!i && (n === i || ` ${n} `.includes(` ${i} `));
}

const vmVy3d = s => String(s || '').trim().toLowerCase();

// Jämför en vy i ACC med vad filen säger. Varje post i vyn är en fil plus,
// för Revit, en 3D-vy. Resultatet:
//   saknas   [{ m, vy3d }]  modell (och 3D-vy) som ska vara med men inte är det
//   felVy    [{ m, har, ska }] modellen finns, men med en annan 3D-vy
//   extra    [{ m, vy3d }]  modell i vyn som inte står i filen
//   okanda   [text]          rader i filen som inte matchar någon modell i model settet
function vmJamforVy(r, ider) {
  const def = (r.ra.definition || []).map(d => ({ itemId: vkUtanViewable(d.lineageUrn), vy3d: d.viewableName || null }));
  const forvantat = new Map();   // itemId → Set av 3D-vyer, '*' = vilken som helst
  const okanda = [];
  for (const id of ider) {
    const traff = r.modeller.filter(m => vmMatchar(m.namn, id.fil));
    if (!traff.length) { okanda.push(id.text); continue; }
    for (const m of traff) {
      if (!forvantat.has(m.itemId)) forvantat.set(m.itemId, new Set());
      forvantat.get(m.itemId).add(id.vy3d ? vmVy3d(id.vy3d) : '*');
    }
  }
  const perId = new Map(r.modeller.map(m => [m.itemId, m]));
  const saknas = [], felVy = [], extra = [];
  for (const [itemId, vyer] of forvantat) {
    const m = perId.get(itemId);
    const har = def.filter(d => d.itemId === itemId);
    if (vyer.has('*')) { if (!har.length) saknas.push({ m, vy3d: null }); continue; }
    const harVyer = new Set(har.map(d => vmVy3d(d.vy3d)));
    for (const v of vyer) {
      if (harVyer.has(v)) continue;
      // Ursprunglig stavning ur filen, eftersom ACC vill ha 3D-vyns exakta namn.
      const ska = ider.find(id => id.vy3d && vmVy3d(id.vy3d) === v)?.vy3d || v;
      if (har.length) felVy.push({ m, har: har.map(d => d.vy3d).filter(Boolean), ska });
      else saknas.push({ m, vy3d: ska });
    }
  }
  for (const d of def) {
    if (forvantat.has(d.itemId)) {
      const vyer = forvantat.get(d.itemId);
      if (vyer.has('*') || vyer.has(vmVy3d(d.vy3d))) continue;
      // En annan 3D-vy av en modell som ska vara med räknas under felVy.
      if (felVy.some(f => f.m.itemId === d.itemId)) continue;
    }
    const m = perId.get(d.itemId);
    if (m) extra.push({ m, vy3d: d.vy3d });
  }
  return { saknas, felVy, extra, okanda };
}

function vmJamfor() {
  const excel = vmExcelVyer();
  const acc = _vp.rader || [];
  const traffade = new Set();
  const vyer = [];
  const saknasIAcc = [];
  const andraProjekt = [];

  for (const e of excel) {
    if (!e.vy) { andraProjekt.push(e); continue; }
    const kandidater = acc.filter(r => vmNorm(r.namn) === vmNorm(e.vy) &&
      (!e.set || vmNorm(r.setNamn).includes(vmNorm(e.set)) || vmNorm(e.set).includes(vmNorm(r.setNamn))));
    if (!kandidater.length) { saknasIAcc.push(e); continue; }
    for (const r of kandidater) {
      const nyckel = `${r.setId}|${r.viewId}`;
      traffade.add(nyckel);
      vyer.push({ nyckel, r, excel: e, ...vmJamforVy(r, e.ider) });
    }
  }
  const ejIExcel = acc.filter(r => !traffade.has(`${r.setId}|${r.viewId}`));
  return { excel, vyer, saknasIAcc, ejIExcel, andraProjekt };
}

function vmAvviker(v) {
  return v.saknas.length || v.felVy.length || v.extra.length || v.okanda.length;
}

// Fel 3D-vy byts alltid ut. Modeller som inte står i filen tas bara bort när
// man kryssat i det.
function vmKanRattas(v) {
  return v.saknas.length || v.felVy.length || (_vm.taBort && v.extra.length);
}

// ── Rättning ──────────────────────────────────────────────────────────────────

function vmToggla(nyckel, pa) {
  if (pa) _vm.valda.add(nyckel); else _vm.valda.delete(nyckel);
  _vm.plan = null;
}

function vmValjAllaAvvikande(pa) {
  const { vyer } = vmJamfor();
  for (const v of vyer) if (vmKanRattas(v)) vmToggla(v.nyckel, pa);
  vhRita();
}

function vmModellText(m, vy3d) {
  return `${vmUtanFilandelse(m.namn)}${vy3d ? ` – ${vy3d}` : ''}`;
}

function vmForbered() {
  const { vyer } = vmJamfor();
  const plan = [];
  for (const v of vyer.filter(x => _vm.valda.has(x.nyckel))) {
    const bort = _vm.taBort ? v.extra : [];
    if (!v.saknas.length && !v.felVy.length && !bort.length) continue;
    const gammal = (v.r.ra.definition || []).map(d => ({ lineageUrn: d.lineageUrn, viewableName: d.viewableName }));
    const nyckel = (id, vy3d) => `${id}|${vmVy3d(vy3d)}`;
    const tasBort = new Set([
      ...bort.map(x => nyckel(x.m.itemId, x.vy3d)),
      ...v.felVy.flatMap(f => f.har.map(h => nyckel(f.m.itemId, h))),
    ]);
    const post = (m, vy3d) => vy3d ? [{ lineageUrn: m.itemId, viewableName: vy3d }]
      : m.viewables?.length ? m.viewables.map(vn => ({ lineageUrn: m.itemId, viewableName: vn })) : [{ lineageUrn: m.itemId }];
    const ny = [
      ...gammal.filter(d => !tasBort.has(nyckel(vkUtanViewable(d.lineageUrn), d.viewableName))),
      ...v.saknas.flatMap(x => post(x.m, x.vy3d)),
      ...v.felVy.flatMap(f => post(f.m, f.ska)),
    ];
    if (ny.length > VH_MAX_MODELLER) {
      return alert(`Vyn ${v.r.namn} skulle få ${ny.length} poster, men Model Coordination tar högst ${VH_MAX_MODELLER}.`);
    }
    plan.push({ v, lagg: v.saknas, byt: v.felVy, bort, gammal, ny });
  }
  if (!plan.length) return alert('Inga valda vyer har något att rätta.');
  _vm.plan = plan;
  vhRita();
}

async function vmKor() {
  const plan = _vm.plan;
  if (!plan) return;
  _vm.plan = null;
  _vm.kor = { klar: false, rader: plan.map(p => ({ namn: `${p.v.r.setNamn} · ${p.v.r.namn}`, status: 'väntar' })) };
  vhRita();
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const rad = _vm.kor.rader[i];
    rad.status = 'pågår';
    vhRita();
    try {
      await updateModelSetViewDefinition(_currentProject.id, p.v.r.setId, p.v.r.viewId, p.gammal, p.ny);
      rad.status = 'klar';
    } catch (err) {
      rad.status = 'fel';
      rad.fel = vhFelText(err.message);
    }
  }
  _vm.kor.klar = true;
  _vm.valda = new Set();
  // Läs om vyerna, så att jämförelsen visar läget efter ändringen.
  await vpLadda();
}

function vmAvbryt() {
  _vm.plan = null;
  vhRita();
}

// ── Export av nuläget ─────────────────────────────────────────────────────────
// Samma upplägg som "kolumner": en rad per vy, en kolumn per modell, x där
// modellen är med. Kan användas som mall för filen.

function vmExporteraNulage() {
  const rader = _vp.rader || [];
  const modeller = [...new Map(rader.flatMap(r => r.modeller.map(m => [m.itemId, m.namn])))]
    .sort((a, b) => a[1].localeCompare(b[1], 'sv'));
  const aoa = [['Model set', 'Vy', ...modeller.map(m => vmUtanFilandelse(m[1]))]];
  for (const r of rader) aoa.push([r.setNamn, r.namn, ...modeller.map(([id]) => r.ingar.has(id) ? 'x' : '')]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 36 }, ...modeller.map(() => ({ wch: 8 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Vyer');
  bhLaddaNer(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]),
    `vymatris_nulage_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function vmExporteraAvvikelser() {
  const { vyer, saknasIAcc, ejIExcel } = vmJamfor();
  const aoa = [['Typ', 'Model set', 'Vy', 'Blad i filen', 'Modeller']];
  for (const e of saknasIAcc) aoa.push(['Vyn saknas i ACC', e.set, e.vy, e.blad, e.ider.map(i => i.text).join(', ')]);
  for (const r of ejIExcel) aoa.push(['Publik vy som inte står i filen', r.setNamn, r.namn, '', '']);
  for (const v of vyer) {
    const rad = (typ, lista) => lista.length && aoa.push([typ, v.r.setNamn, v.r.namn, v.excel.blad, lista.join(', ')]);
    rad('Saknade modeller', v.saknas.map(x => vmModellText(x.m, x.vy3d)));
    rad('Fel 3D-vy', v.felVy.map(f => `${vmUtanFilandelse(f.m.namn)}: ${f.har.join(', ')} ska vara ${f.ska}`));
    rad('Modeller som inte står i filen', v.extra.map(x => vmModellText(x.m, x.vy3d)));
    rad('Rader i filen som inte matchar någon modell', v.okanda);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 40 }, { wch: 26 }, { wch: 36 }, { wch: 26 }, { wch: 100 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Avvikelser');
  bhLaddaNer(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]),
    `vymatris_avvikelser_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function vmKropp() {
  if (_vp.laddar) return vkLaddarKort(_vp.framsteg || 'Läser vyer…');
  if (_vp.fel) return `<div class="bg-white border border-ads-border rounded p-6 text-sm text-red-600">Kunde inte läsa vyerna: ${vkEsc(_vp.fel)}</div>`;
  if (!_vp.rader) { setTimeout(vpLadda); return vkLaddarKort('Läser vyer…'); }

  const filKort = `
    <div class="bg-white border border-ads-border rounded p-4 mb-3">
      <div class="flex items-center gap-3 flex-wrap">
        <label class="text-sm border border-ads-border rounded px-3 py-1.5 bg-white hover:border-ads-blue cursor-pointer">
          ${_vm.fil ? 'Byt fil…' : 'Välj Excel med vyer…'}
          <input type="file" accept=".xlsx,.xls,.xlsm,.csv" class="hidden" onchange="vmLasFil(this.files)" /></label>
        ${_vm.fil ? `<span class="text-sm font-medium">${vkEsc(_vm.fil.namn)}</span>` : ''}
        <div class="flex-1"></div>
        <button onclick="vmExporteraNulage()" class="text-sm text-ads-blue hover:underline">Exportera nuläget som mall</button>
      </div>
      <p class="text-[11px] text-ads-muted mt-2">
        Filen läses bara i den här webbläsaren. ${_vp.rader.length} publika vyer i projektet jämförs.
        Filen kan ha ett blad per vy (vynamnet ovanför rubriken "Modell", en modell per rad, gärna som "fil.rvt - 3D-vy"),
        eller en tabell med en rad per vy.</p>
      ${_vm.fel ? `<p class="text-sm text-red-600 mt-2">${vkEsc(_vm.fel)}</p>` : ''}
    </div>`;
  if (!_vm.fil) return filKort;
  return filKort + vmMappningHtml() + vmResultatHtml();
}

function vmMappningHtml() {
  const m = _vm.mappning;
  const upplaggVal = `
    <label class="block">Upplägg
      <select onchange="vmSattMappning('upplagg', this.value)" class="mt-0.5 block border border-ads-border rounded px-2 py-1 bg-white">
        ${vmArBladUpplagg() ? `<option value="blad" ${m.upplagg === 'blad' ? 'selected' : ''}>Ett blad per vy</option>` : ''}
        <option value="kolumner" ${m.upplagg === 'kolumner' ? 'selected' : ''}>En rad per vy, en kolumn per modell</option>
        <option value="lista" ${m.upplagg === 'lista' ? 'selected' : ''}>En rad per vy, modellerna i en cell</option>
        <option value="rader" ${m.upplagg === 'rader' ? 'selected' : ''}>En rad per vy och modell</option>
      </select></label>`;

  if (m.upplagg === 'blad') {
    const etiketter = vmProjektEtiketter();
    const vyblad = Object.values(_vm.fil.blad).filter(r => vmLasVyblad(r)).length;
    const ovriga = Object.keys(_vm.fil.blad).length - vyblad;
    return `
      <div class="bg-white border border-ads-border rounded p-4 mb-3 text-xs">
        <div class="font-medium text-sm mb-2">Hur filen är uppbyggd</div>
        <div class="grid md:grid-cols-3 gap-x-6 gap-y-2">
          ${upplaggVal}
          <label class="block">Vynamnen för det här projektet står under
            <select onchange="vmSattMappning('projektEtikett', this.value)" class="mt-0.5 block border rounded px-2 py-1 bg-white ${m.projektEtikett ? 'border-ads-border' : 'border-red-400'}">
              <option value="" ${!m.projektEtikett ? 'selected' : ''}>– välj –</option>
              ${etiketter.map(e => `<option value="${vkEsc(e)}" ${e === m.projektEtikett ? 'selected' : ''}>${vkEsc(e)}</option>`).join('')}
            </select></label>
          <div class="text-ads-muted pt-1">${vyblad} blad med vyer${ovriga ? `, ${ovriga} andra blad hoppas över` : ''}.
            Rader som "Kontroll: datum" räknas inte som modeller.</div>
        </div>
      </div>`;
  }

  const n = vmAntalKol();
  const kolVal = (nyckel, varde, medIngen = false, ingenText = 'ingen') => `
    <select onchange="vmSattMappning('${nyckel}', this.value)" class="border border-ads-border rounded px-2 py-1 text-xs bg-white max-w-[220px]">
      ${medIngen ? `<option value="-1" ${varde < 0 ? 'selected' : ''}>${ingenText}</option>` : ''}
      ${Array.from({ length: n }, (_, i) => `<option value="${i}" ${varde === i ? 'selected' : ''}>${vkEsc(vmKolNamn(i))}</option>`).join('')}
    </select>`;
  const rader = vmRader();
  const forhand = rader.slice(0, Math.max(m.rubrikrad + 4, 6));
  const kolumner = Math.min(n, 14);

  return `
    <div class="bg-white border border-ads-border rounded p-4 mb-3 text-xs">
      <div class="font-medium text-sm mb-2">Hur filen är uppbyggd</div>
      <div class="grid md:grid-cols-3 gap-x-6 gap-y-2">
        <label class="block">Blad
          <select onchange="vmSattBlad(this.value)" class="mt-0.5 block border border-ads-border rounded px-2 py-1 bg-white">
            ${Object.keys(_vm.fil.blad).map(b => `<option ${b === _vm.blad ? 'selected' : ''}>${vkEsc(b)}</option>`).join('')}
          </select></label>
        <label class="block">Rubrikrad
          <input type="number" min="1" value="${m.rubrikrad}" onchange="vmSattMappning('rubrikrad', this.value)"
                 class="mt-0.5 block w-20 border border-ads-border rounded px-2 py-1" /></label>
        ${upplaggVal}
        <label class="block">Vynamn ${kolVal('vyKol', m.vyKol)}</label>
        <label class="block">Model set (valfritt) ${kolVal('setKol', m.setKol, true, 'ingen kolumn, matcha vyn i alla model set')}</label>
        ${m.upplagg === 'kolumner' ? `
          <div>Modellkolumner från ${kolVal('modellFran', m.modellFran)} till ${kolVal('modellTill', m.modellTill, true, 'sista kolumnen')}
            <p class="text-[10px] text-ads-muted mt-0.5">Modellens namn står i rubrikraden. En ifylld cell betyder att modellen ska vara med (inte "nej", "0" eller "-").</p></div>`
          : `<label class="block">Modeller ${kolVal('modellKol', m.modellKol)}
              ${m.upplagg === 'lista' ? '<p class="text-[10px] text-ads-muted mt-0.5">Separerade med komma, semikolon eller radbrytning.</p>' : ''}</label>`}
      </div>
      <details class="mt-3">
        <summary class="cursor-pointer text-ads-blue">Förhandsgranska de första raderna</summary>
        <div class="overflow-x-auto mt-2">
          <table class="text-[11px] border-collapse">
            <tr><td></td>${Array.from({ length: kolumner }, (_, i) => `<td class="px-1.5 text-ads-muted font-mono">${XLSX.utils.encode_col(i)}</td>`).join('')}</tr>
            ${forhand.map((r, ri) => `
              <tr class="${ri + 1 === m.rubrikrad ? 'bg-ads-gray font-semibold' : ''}">
                <td class="px-1.5 text-ads-muted font-mono">${ri + 1}</td>
                ${Array.from({ length: kolumner }, (_, i) => `<td class="px-1.5 py-0.5 border border-ads-border/60 max-w-[140px] truncate
                  ${i === m.vyKol ? 'bg-sky-50' : ''}">${vkEsc(r[i] || '')}</td>`).join('')}
              </tr>`).join('')}
          </table>
        </div>
      </details>
    </div>`;
}

function vmResultatHtml() {
  if (_vm.mappning.upplagg === 'blad' && !_vm.mappning.projektEtikett) {
    return '<div class="bg-white border border-ads-border rounded p-6 text-sm text-ads-muted text-center">Välj under vilket projektnamn i filen vyerna för det här projektet står.</div>';
  }
  const { excel, vyer, saknasIAcc, ejIExcel, andraProjekt } = vmJamfor();
  if (!excel.length) return '<div class="bg-white border border-ads-border rounded p-6 text-sm text-ads-muted text-center">Inga vynamn hittades med den här inställningen.</div>';

  const avvikande = vyer.filter(vmAvviker);
  const ok = vyer.length - avvikande.length;
  const lista = (rader, farg) => rader.length ? `<ul class="${farg}">${rader.map(t => `<li>${t}</li>`).join('')}</ul>` : '<span class="text-emerald-700">✓</span>';
  const kortSiffra = (antal, text, farg) => `
    <div class="bg-white border border-ads-border rounded px-4 py-3">
      <div class="text-2xl font-semibold" style="color:${farg}">${antal}</div><div class="text-xs text-ads-muted">${text}</div></div>`;

  return `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
      ${kortSiffra(ok, 'vyer stämmer', '#059669')}
      ${kortSiffra(avvikande.length, 'vyer avviker', avvikande.length ? '#D97706' : '#9CA3AF')}
      ${kortSiffra(saknasIAcc.length, 'vyer i filen saknas i ACC', saknasIAcc.length ? '#DC2626' : '#9CA3AF')}
      ${kortSiffra(ejIExcel.length, 'publika vyer står inte i filen', ejIExcel.length ? '#6B7280' : '#9CA3AF')}
    </div>
    ${_vm.kor ? vmKorHtml() : ''}
    ${_vm.plan ? vmPlanHtml() : ''}
    <div class="bg-white border border-ads-border rounded p-3 mb-3 flex items-center gap-3 flex-wrap text-xs">
      <label class="flex items-center gap-1.5"><input type="checkbox" class="accent-ads-blue" ${_vm.taBort ? 'checked' : ''}
        onchange="_vm.taBort = this.checked; _vm.plan = null; vhRita()" /> Ta även bort modeller som inte står i filen</label>
      <button onclick="vmValjAllaAvvikande(true)" class="text-ads-blue hover:underline">Markera alla som går att rätta</button>
      <div class="flex-1"></div>
      ${bhKnapp('vmExporteraAvvikelser()', 'Avvikelser till Excel')}
      <button onclick="vmForbered()" ${_vm.valda.size ? '' : 'disabled'}
              class="bg-be-charcoal hover:bg-black text-white font-medium py-1.5 px-3 rounded disabled:opacity-40">Rätta markerade (${_vm.valda.size})…</button>
    </div>
    <div class="bg-white border border-ads-border rounded overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-[11px] text-ads-muted text-left bg-ads-gray/60">
          <tr><th class="px-2 py-2 w-8"></th><th class="px-3 py-2">Vy</th><th class="px-3 py-2">Saknas i vyn</th>
              <th class="px-3 py-2">Fel 3D-vy</th><th class="px-3 py-2">I vyn men inte i filen</th><th class="px-3 py-2">Rader i filen utan modell</th></tr>
        </thead>
        <tbody>
          ${[...avvikande, ...vyer.filter(v => !vmAvviker(v))].map(v => `
            <tr class="border-t border-ads-border/60 align-top ${vmAvviker(v) ? '' : 'text-ads-muted'}">
              <td class="px-2 py-2">${vmKanRattas(v) ? `<input type="checkbox" class="accent-ads-blue" ${_vm.valda.has(v.nyckel) ? 'checked' : ''}
                  onchange="vmToggla('${vkEsc(v.nyckel)}', this.checked); vhRita()" />` : ''}</td>
              <td class="px-3 py-2 min-w-[180px]"><div class="font-medium">${vkEsc(v.r.namn)}</div>
                <div class="text-[11px] text-ads-muted">${vkEsc(v.r.setNamn)} · blad ${vkEsc(v.excel.blad || '')}</div></td>
              <td class="px-3 py-2 text-xs">${lista(v.saknas.map(x => vkEsc(vmModellText(x.m, x.vy3d))), 'text-red-700')}</td>
              <td class="px-3 py-2 text-xs">${lista(v.felVy.map(f => `${vkEsc(vmUtanFilandelse(f.m.namn))}: <s>${vkEsc(f.har.join(', '))}</s> → ${vkEsc(f.ska)}`), 'text-amber-800')}</td>
              <td class="px-3 py-2 text-xs">${lista(v.extra.map(x => vkEsc(vmModellText(x.m, x.vy3d))), 'text-amber-800')}</td>
              <td class="px-3 py-2 text-xs text-ads-muted">${v.okanda.map(vkEsc).join('<br>')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${saknasIAcc.length ? `
      <div class="bg-white border border-red-200 rounded p-3 mt-3 text-xs">
        <div class="font-medium text-red-800 mb-1">Vyer i filen som inte finns som publika vyer i ACC (${saknasIAcc.length})</div>
        <p class="text-ads-muted mb-1">Skapas i Model Coordination. Kontrollera också stavningen, vynamnen jämförs utan hänsyn till stora bokstäver och skiljetecken.</p>
        <ul class="list-disc ml-4">${saknasIAcc.map(e => `<li>${vkEsc(e.vy)}${e.set ? ` <span class="text-ads-muted">(${vkEsc(e.set)})</span>` : ''} <span class="text-ads-muted">· ${vkEsc(e.blad || '')}</span></li>`).join('')}</ul>
      </div>` : ''}
    ${ejIExcel.length ? `
      <div class="bg-white border border-ads-border rounded p-3 mt-3 text-xs">
        <div class="font-medium mb-1">Publika vyer som inte står i filen (${ejIExcel.length})</div>
        <ul class="list-disc ml-4">${ejIExcel.map(r => `<li>${vkEsc(r.namn)} <span class="text-ads-muted">(${vkEsc(r.setNamn)})</span></li>`).join('')}</ul>
      </div>` : ''}
    ${andraProjekt.length ? `
      <p class="text-[11px] text-ads-muted mt-3">Blad som bara gäller andra projekt och hoppas över här:
        ${andraProjekt.map(e => `${vkEsc(e.blad)}${e.annatProjekt?.length ? ` (${vkEsc(e.annatProjekt.join(', '))})` : ''}`).join(' · ')}</p>` : ''}`;
}

function vmPlanHtml() {
  const t = (lista, f) => lista.map(f).join(', ');
  return `
    <div class="bg-amber-50 border border-amber-300 rounded p-3 mb-3 text-xs">
      <div class="font-medium text-sm mb-1">Det här skrivs till ACC</div>
      <ul class="space-y-1 mb-2">
        ${_vm.plan.map(p => `<li><b>${vkEsc(p.v.r.namn)}</b> <span class="text-ads-muted">(${vkEsc(p.v.r.setNamn)})</span>:
          ${[p.lagg.length && `läggs till ${vkEsc(t(p.lagg, x => vmModellText(x.m, x.vy3d)))}`,
             p.byt.length && `3D-vy byts för ${vkEsc(t(p.byt, f => `${vmUtanFilandelse(f.m.namn)} → ${f.ska}`))}`,
             p.bort.length && `tas bort ${vkEsc(t(p.bort, x => vmModellText(x.m, x.vy3d)))}`].filter(Boolean).join(' · ')}</li>`).join('')}
      </ul>
      <div class="flex gap-2">
        <button onclick="vmKor()" class="bg-be-charcoal hover:bg-black text-white font-medium py-1.5 px-3 rounded">Spara i ACC</button>
        <button onclick="vmAvbryt()" class="px-2 text-ads-muted hover:text-ads-text">Avbryt</button>
      </div>
    </div>`;
}

function vmKorHtml() {
  const k = _vm.kor;
  const farg = { väntar: 'text-ads-muted', pågår: 'text-ads-blue', klar: 'text-emerald-700', fel: 'text-red-700' };
  return `
    <div class="bg-white border border-ads-border rounded p-3 mb-3 text-xs">
      <div class="flex items-center mb-1"><span class="font-medium text-sm flex-1">${k.klar ? 'Klart' : 'Sparar i ACC…'}</span>
        ${k.klar ? '<button onclick="_vm.kor = null; vhRita()" class="text-ads-muted hover:text-ads-text">✕</button>' : ''}</div>
      <ul>${k.rader.map(r => `<li class="${farg[r.status]}">${vkEsc(r.namn)}: ${r.status}${r.fel ? ` – ${vkEsc(r.fel)}` : ''}</li>`).join('')}</ul>
    </div>`;
}
