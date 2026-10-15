// behorigheter-skriv.js — ändra mappbehörigheter i ACC från fliken Behörigheter.
//
// Ändringar samlas först i en ändringslista (_bh.andringar), oavsett om de kommer
// från mappdetaljen, Audit eller massändringen. Inget skrivs förrän man granskat
// listan och bekräftat. Varje mapp läses om strax före och strax efter
// skrivningen, så att läget före blir det verkliga och utfallet kan kontrolleras.
//
// Varje sparad omgång loggas med läget före. En omgång kan återställas: då byggs
// en ny ändringslista som sätter tillbaka det som var, och den går genom samma
// granskning. Loggen sparas i webbläsaren per projekt och kan exporteras.
//
// Bara data som hämtats från ACC kan ändras. Excel-läget är skrivskyddat.

// Forma och BIM 360 har olika uppsättningar actions för samma nivå.
const BH_ACTIONS_FORMA = {
  V:  ['VIEW', 'COLLABORATE'],
  VD: ['VIEW', 'COLLABORATE', 'DOWNLOAD'],
  C:  ['VIEW', 'COLLABORATE', 'DOWNLOAD', 'PUBLISH_MARKUP'],
  CU: ['VIEW', 'COLLABORATE', 'DOWNLOAD', 'PUBLISH_MARKUP', 'PUBLISH'],
  E:  ['VIEW', 'COLLABORATE', 'DOWNLOAD', 'PUBLISH_MARKUP', 'PUBLISH', 'EDIT'],
  M:  ['VIEW', 'COLLABORATE', 'DOWNLOAD', 'PUBLISH_MARKUP', 'PUBLISH', 'EDIT', 'CONTROL'],
};
const BH_ACTIONS_BIM360 = {
  V:  ['VIEW', 'COLLABORATE'],
  VD: ['VIEW', 'COLLABORATE', 'DOWNLOAD'],
  CU: ['VIEW', 'COLLABORATE', 'DOWNLOAD', 'PUBLISH'],
  E:  ['VIEW', 'COLLABORATE', 'DOWNLOAD', 'PUBLISH', 'EDIT'],
  M:  ['VIEW', 'COLLABORATE', 'DOWNLOAD', 'PUBLISH', 'EDIT', 'CONTROL'],
};
const BH_LOGG_MAX = 50;

// Data Management ger både ACC- och BIM 360-projekt typen autodesk.bim360:Project.
// Skillnaden står i extension.data.projectType.
function bhActionsTabell() {
  const typ = _currentProject?.attributes?.extension?.data?.projectType;
  return typ === 'BIM360' ? BH_ACTIONS_BIM360 : BH_ACTIONS_FORMA;
}

function bhSkrivNivaer() {
  return Object.keys(bhActionsTabell());
}

function bhKanSkriva() {
  return _bh.data?.meta.kalla === 'ACC' && !!_bh.data.mappId;
}

function bhAccProjektId() {
  return String(_currentProject.id).replace(/^b\./, '');
}

// Det subjekt i ACC som en principal i vyn motsvarar, eller null om den inte
// går att skriva till (som "Alla", eller en Excel-medlem utan ACC-id).
function bhSubjekt(p) {
  if (!p) return null;
  if (p.kind === 'role')    return { subjectType: 'ROLE',    subjectId: p.id, name: p.name };
  if (p.kind === 'company') return { subjectType: 'COMPANY', subjectId: p.id, name: p.name };
  if (p.kind === 'user') {
    const u = _bh.data.users.find(x => x.id === p.id);
    return { subjectType: 'USER', subjectId: p.id, name: p.name, email: u?.email || '' };
  }
  if (p.kind === 'member') {
    const id = p.member.userId || p.member.accId;
    return id ? { subjectType: 'USER', subjectId: id, name: p.member.name, email: p.member.email } : null;
  }
  return null;
}

// Alla som går att ge behörighet: de som redan har behörighet någonstans plus
// medlemmarna, deras roller och företag från Admin-API:et.
function bhSkrivbaraSubjekt(typ) {
  const d   = _bh.data;
  const ut  = new Map();
  const add = s => { if (s.subjectId && !ut.has(s.subjectId)) ut.set(s.subjectId, s); };
  const medl = d.matchedMembers?.members || [];
  if (typ === 'USER') {
    for (const m of medl) { const s = bhSubjekt({ kind: 'member', member: m }); if (s) add(s); }
    for (const u of d.users) add({ subjectType: 'USER', subjectId: u.id, name: u.name, email: u.email });
  }
  if (typ === 'ROLE') {
    for (const r of d.roles) add({ subjectType: 'ROLE', subjectId: r.id, name: r.name });
    for (const m of medl) m.roleNames.forEach((n, i) => m.roleKeys?.[i] && add({ subjectType: 'ROLE', subjectId: m.roleKeys[i], name: n }));
  }
  if (typ === 'COMPANY') {
    for (const c of d.companies) add({ subjectType: 'COMPANY', subjectId: c.id, name: c.name });
    for (const m of medl) if (m.companyKey) add({ subjectType: 'COMPANY', subjectId: m.companyKey, name: m.company });
  }
  return [...ut.values()].sort(bhSv);
}

function bhDirektaActions(path, subjectId) {
  const s = (_bh.data.ra.get(path) || []).find(x => x.subjectId === subjectId);
  return s?.actions?.length ? [...s.actions] : null;
}

// ── Ändringslistan ────────────────────────────────────────────────────────────

// efter är en lista med actions, eller null för att ta bort den direkta
// behörigheten. En ändring per mapp och subjekt: en ny ersätter en gammal.
function bhLaggTillAndring(path, subj, efter) {
  const nyckel = `${path}|${subj.subjectId}`;
  _bh.andringar = _bh.andringar.filter(a => a.nyckel !== nyckel);
  const fore = bhDirektaActions(path, subj.subjectId);
  if (bhSammaActions(fore, efter)) return false;
  _bh.andringar.push({
    nyckel, path,
    folderId: _bh.data.mappId.get(path),
    subjectId: subj.subjectId, subjectType: subj.subjectType, name: subj.name, email: subj.email || '',
    fore, efter,
  });
  return true;
}

function bhSammaActions(a, b) {
  if (!a?.length && !b?.length) return true;
  if (!a?.length || !b?.length) return false;
  return a.length === b.length && a.every(x => b.includes(x));
}

function bhVantandeFor(path, subjectId) {
  return _bh.andringar.find(a => a.path === path && a.subjectId === subjectId) || null;
}

function bhForeslaNiva(pathRef, subjRef, niva) {
  bhLaggTillAndring(_bh.ref[pathRef], _bh.ref[subjRef], niva ? bhActionsTabell()[niva] : null);
  bhRita();
}

function bhAngra(nyckelRef) {
  const nyckel = _bh.ref[nyckelRef];
  _bh.andringar = _bh.andringar.filter(a => a.nyckel !== nyckel);
  bhRita();
}

function bhTomAndringar() {
  _bh.andringar = [];
  if (_bh.dialog === 'granska') _bh.dialog = null;
  bhRita();
}

// Formuläret "Lägg till behörighet" i mappdetaljen.
function bhSattNyTyp(typ) {
  _bh.nyTyp = typ;
  bhRita();
}

function bhLaggTillFranFormular(pathRef) {
  const id   = document.getElementById('bh-ny-subjekt')?.value;
  const niva = document.getElementById('bh-ny-niva')?.value;
  const subj = bhSkrivbaraSubjekt(_bh.nyTyp).find(s => s.subjectId === id);
  if (!subj || !niva) return;
  bhLaggTillAndring(_bh.ref[pathRef], subj, bhActionsTabell()[niva]);
  bhRita();
}

// Audit: ta bort personens direkta behörighet där den är satt.
function bhAuditTaBort(index) {
  const m = _bh.auditPerson;
  const f = bhAudit(_bh.data, m).findings[index];
  const subj = bhSubjekt({ kind: 'member', member: m });
  if (f && subj) bhLaggTillAndring(f.directInheritedFrom || f.path, subj, null);
  bhRita();
}

function bhAuditTaBortAlla(kind) {
  const m = _bh.auditPerson;
  const subj = bhSubjekt({ kind: 'member', member: m });
  if (!subj) return;
  for (const f of bhAudit(_bh.data, m).findings) {
    if (!kind || f.kind === kind) bhLaggTillAndring(f.directInheritedFrom || f.path, subj, null);
  }
  bhRita();
}

// Massändring: samma nivå för den valda principalen på alla markerade mappar.
function bhVaxlaMassandring() {
  _bh.massandring = !_bh.massandring;
  _bh.markerade   = new Set();
  bhRita();
}

function bhMarkera(ref, pa) {
  const path = _bh.ref[ref];
  if (pa) _bh.markerade.add(path); else _bh.markerade.delete(path);
  const el = document.getElementById('bh-massrad');
  if (el) el.innerHTML = bhMassradHtml();
}

function bhMarkeraSynliga(pa) {
  for (const r of bhSynligaRader()) if (pa) _bh.markerade.add(r.path); else _bh.markerade.delete(r.path);
  bhRita();
}

function bhMassForesla(taBort) {
  const subj = bhSubjekt(_bh.vald);
  const niva = document.getElementById('bh-mass-niva')?.value;
  if (!subj || (!taBort && !niva)) return;
  for (const path of _bh.markerade) {
    if (taBort && !bhDirektaActions(path, subj.subjectId)) continue;
    bhLaggTillAndring(path, subj, taBort ? null : bhActionsTabell()[niva]);
  }
  _bh.markerade = new Set();
  bhRita();
}

// ── Granska och spara ─────────────────────────────────────────────────────────

function bhOppnaDialog(namn) {
  _bh.dialog = namn;
  bhRita();
}

function bhStangDialog() {
  if (_bh.kor && !_bh.kor.klar) return;   // stängs inte mitt i en skrivning
  _bh.dialog = null;
  _bh.kor    = null;
  bhRita();
}

// Varningar som visas innan man sparar.
function bhVarningar(andringar) {
  const jag = String(_profile?.email || '').toLowerCase();
  const medl = _bh.data.matchedMembers?.members.find(m => m.email && m.email.toLowerCase() === jag);
  const ut = [];
  const egna = andringar.filter(a => a.subjectType === 'USER' && jag && a.email.toLowerCase() === jag
    && a.fore?.includes('CONTROL') && !a.efter?.includes('CONTROL'));
  if (egna.length && !medl?.isProjectAdmin) {
    ut.push(`Du tar bort Hantera från dig själv på ${egna.length} mapp${egna.length > 1 ? 'ar' : ''}. ` +
            'Har du inte Hantera på något annat sätt kan du inte ändra tillbaka, och inte heller återställa härifrån.');
  }
  const rot = andringar.filter(a => !_bh.data.folders.get(a.path)?.parentPath && !a.efter);
  if (rot.length) ut.push(`${rot.length} borttagning${rot.length > 1 ? 'ar' : ''} på en toppmapp påverkar hela trädet under den.`);
  return ut;
}

async function bhSpara() {
  const d      = _bh.data;
  const accId  = bhAccProjektId();
  const rader  = _bh.andringar.map(a => ({ ...a, status: 'väntar' }));
  const mappar = [...new Set(rader.map(r => r.path))];
  _bh.kor    = { klar: false, rader, klaraMappar: 0, mappar: mappar.length };
  _bh.dialog = 'kor';
  bhRita();

  for (const path of mappar) {
    const grupp    = rader.filter(r => r.path === path);
    const folderId = grupp[0].folderId;
    try {
      // Läs om mappen först, så att läget före är det verkliga.
      bhSattMappBeh(d, path, await bhMedOmforsok(() => getFolderPermissions(accId, folderId)));
      for (const r of grupp) r.fore = bhDirektaActions(path, r.subjectId);

      const post = r => ({ subjectId: r.subjectId, subjectType: r.subjectType, ...(r.efter ? { actions: r.efter } : {}) });
      const kor  = async (op, lista) => {
        if (!lista.length) return;
        try {
          await bhMedOmforsok(() => changeFolderPermissions(accId, folderId, op, lista.map(post)));
        } catch (err) {
          // Har subjektet ärvda behörigheter kan ACC vilja ha update i stället
          // för create. Prövas en gång innan raderna markeras som fel.
          if (op === 'create' && !/APS error 403/.test(err.message)) {
            try { await bhMedOmforsok(() => changeFolderPermissions(accId, folderId, 'update', lista.map(post))); return; }
            catch (err2) { err = err2; }
          }
          lista.forEach(r => { r.status = 'fel'; r.fel = bhKortFel(err); });
        }
      };
      grupp.filter(r => bhSammaActions(r.fore, r.efter)).forEach(r => { r.status = 'oförändrad'; });
      const kvar = grupp.filter(r => r.status === 'väntar');
      await kor('delete', kvar.filter(r => !r.efter));
      await kor('update', kvar.filter(r => r.efter && r.fore));
      await kor('create', kvar.filter(r => r.efter && !r.fore));

      // Läs om efteråt och kontrollera varje ändring mot utfallet.
      bhSattMappBeh(d, path, await bhMedOmforsok(() => getFolderPermissions(accId, folderId)));
      for (const r of kvar) {
        r.faktisk = bhDirektaActions(path, r.subjectId);
        if (r.status === 'fel') continue;
        r.status = bhNivaFranActions(r.faktisk) === bhNivaFranActions(r.efter) ? 'klar' : 'avviker';
      }
    } catch (err) {
      grupp.filter(r => r.status === 'väntar').forEach(r => { r.status = 'fel'; r.fel = bhKortFel(err); });
    }
    _bh.kor.klaraMappar++;
    const el = document.getElementById('bh-dialog');
    if (el) el.outerHTML = bhDialogHtml();
  }

  bhSparaLogg({
    id:          Date.now(),
    tid:         new Date().toISOString(),
    anvandare:   _profile?.email || '',
    aterstaller: _bh.aterstaller || null,
    andringar:   rader.map(({ nyckel, ...r }) => r),
  });
  _bh.aterstaller = null;
  _bh.andringar   = rader.filter(r => r.status === 'fel').map(r => ({ ...r, status: undefined }));
  _bh.kor.klar    = true;
  bhRaknaOm(d);
  bhCacheSpara(_currentProject?.id, d, _bh.medl?.data);
  bhAterkoppla();
  bhRita();
}

function bhKortFel(err) {
  const m = String(err.message || err);
  const status = m.match(/APS error (\d+)/)?.[1];
  const forklaring = { 403: 'Saknar Hantera på mappen', 404: 'Mappen eller subjektet finns inte', 409: 'Konflikt', 422: 'ACC godtog inte ändringen', 423: 'Mappen är låst just nu, försök igen' }[status];
  const detalj = m.replace(/^APS error \d+:\s*/, '').slice(0, 160);
  return forklaring ? `${forklaring} (${status}) ${detalj}` : m.slice(0, 200);
}

// Efter att modellen ändrats pekar valen på gamla medlemsobjekt. Matchningen
// görs om och valen kopplas till de nya objekten.
function bhAterkoppla() {
  const mm = bhMatchaMedlemmar(_bh.medl?.data, _bh.perm.data);
  _bh.data.matchedMembers = mm;
  const hitta = m => m && mm?.members.find(x => (m.email && x.email === m.email) || x.name === m.name) || null;
  if (_bh.vald?.kind === 'member') {
    const m = hitta(_bh.vald.member);
    _bh.vald = m ? { ..._bh.vald, member: m } : null;
  }
  _bh.diffA       = hitta(_bh.diffA);
  _bh.diffB       = hitta(_bh.diffB);
  _bh.auditPerson = hitta(_bh.auditPerson);
}

// ── Logg och återställning ────────────────────────────────────────────────────

function bhLoggNyckel() {
  return `bh-logg:${_currentProject?.id}`;
}

function bhLasLogg() {
  try { return JSON.parse(localStorage.getItem(bhLoggNyckel()) || '[]'); }
  catch { return []; }
}

function bhSparaLogg(post) {
  const logg = [post, ...bhLasLogg()].slice(0, BH_LOGG_MAX);
  _bh.logg = logg;
  try { localStorage.setItem(bhLoggNyckel(), JSON.stringify(logg)); }
  catch { /* privat läge eller full lagring: loggen finns kvar tills sidan laddas om */ }
}

function bhLogg() {
  if (!_bh.logg) _bh.logg = bhLasLogg();
  return _bh.logg;
}

// Bygger en ändringslista som sätter tillbaka läget före omgången. Bara rader
// som faktiskt ändrade något tas med, och de läggs i omvänd ordning.
function bhAterstall(id) {
  const post = bhLogg().find(p => p.id === id);
  if (!post) return;
  if (_bh.andringar.length && !confirm(`${_bh.andringar.length} ändringar väntar i listan och ersätts av återställningen. Fortsätta?`)) return;
  _bh.andringar = [];
  for (const r of [...post.andringar].reverse()) {
    if (r.status !== 'klar' && r.status !== 'avviker') continue;
    if (!_bh.data.mappId.has(r.path)) continue;
    bhLaggTillAndring(r.path, { subjectId: r.subjectId, subjectType: r.subjectType, name: r.name, email: r.email }, r.fore);
  }
  _bh.aterstaller = id;
  _bh.dialog = 'granska';
  bhRita();
}

function bhExporteraLogg() {
  const typ = { USER: 'Person', ROLE: 'Roll', COMPANY: 'Företag' };
  const aoa = [['Tid', 'Utförd av', 'Omgång', 'Återställer', 'Mapp', 'Typ', 'Namn', 'Före', 'Efter', 'Utfall', 'Status', 'Fel']];
  for (const p of bhLogg()) {
    for (const r of p.andringar) {
      aoa.push([
        new Date(p.tid).toLocaleString('sv-SE'), p.anvandare, p.id, p.aterstaller || '',
        r.path, typ[r.subjectType] || r.subjectType, r.name,
        bhNivaFranActions(r.fore) || '–', bhNivaFranActions(r.efter) || '–', bhNivaFranActions(r.faktisk) || '–',
        r.status, r.fel || '',
      ]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 18 }, { wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 60 }, { wch: 9 }, { wch: 28 }, { wch: 6 }, { wch: 6 }, { wch: 7 }, { wch: 11 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ändringslogg');
  const projekt = bhBladnamn(_bh.data.meta.projectName).slice(0, 40);
  bhLaddaNer(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]),
    `${projekt}_behorighetslogg_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const BH_SUBJ_TYP = { USER: 'Person', ROLE: 'Roll', COMPANY: 'Företag' };

function bhNivaval(id, valt, medIngen, onchange = '') {
  return `
    <select ${id ? `id="${id}"` : ''} ${onchange ? `onchange="${onchange}"` : ''}
            class="border border-ads-border rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-ads-blue">
      ${medIngen ? `<option value="" ${!valt ? 'selected' : ''}>${medIngen}</option>` : ''}
      ${bhSkrivNivaer().map(n => `<option value="${n}" ${n === valt ? 'selected' : ''}>${n} · ${BH_PERM[n].label}</option>`).join('')}
    </select>`;
}

function bhFranTill(fore, efter) {
  const f = bhNivaFranActions(fore), e = bhNivaFranActions(efter);
  return `${f ? bhBadge(f, false, true) : '<span class="text-ads-muted text-xs">–</span>'}
          <span class="text-ads-muted text-xs mx-0.5">→</span>
          ${e ? bhBadge(e, false, true) : '<span class="text-xs text-red-700 font-medium">tas bort</span>'}`;
}

// Raden längst ner i översikten: ändringslistan och historiken.
function bhAndringsradHtml() {
  if (!bhKanSkriva()) return '';
  const n = _bh.andringar.length;
  const logg = bhLogg().length;
  return `
    <div class="shrink-0 border-t border-ads-border px-4 py-2 flex items-center gap-3 ${n ? 'bg-amber-50' : 'bg-white'}">
      ${n ? `
        <span class="text-sm text-amber-900"><b>${n}</b> ändring${n > 1 ? 'ar' : ''} väntar</span>
        <button onclick="bhOppnaDialog('granska')"
                class="bg-be-charcoal hover:bg-black text-white text-xs font-medium py-1.5 px-3 rounded">Granska och spara</button>
        <button onclick="bhTomAndringar()" class="text-xs text-ads-muted hover:text-ads-text">Töm listan</button>`
        : '<span class="text-xs text-ads-muted">Inga ändringar väntar. Ändra behörigheter från mappdetaljen, Audit eller med massändring.</span>'}
      <div class="flex-1"></div>
      <button onclick="bhOppnaDialog('historik')" class="text-xs text-ads-blue hover:underline">Historik och återställning${logg ? ` (${logg})` : ''}</button>
    </div>`;
}

function bhDialogHtml() {
  if (!_bh.dialog) return '<div id="bh-dialog"></div>';
  const inneh = _bh.dialog === 'granska' ? bhGranskaHtml() : _bh.dialog === 'kor' ? bhKorHtml() : bhHistorikHtml();
  return `
    <div id="bh-dialog" class="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
         onclick="if (event.target === this) bhStangDialog()">
      <div class="bg-white rounded shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">${inneh}</div>
    </div>`;
}

function bhDialogHuvud(titel, under) {
  return `
    <div class="px-5 py-3 border-b border-ads-border flex items-start gap-3">
      <div class="flex-1">
        <h3 class="font-semibold text-ads-text">${titel}</h3>
        ${under ? `<p class="text-xs text-ads-muted mt-0.5">${under}</p>` : ''}
      </div>
      <button onclick="bhStangDialog()" class="px-1.5 text-ads-muted hover:text-ads-text">✕</button>
    </div>`;
}

function bhAndringsTabell(rader, medAngra, medStatus) {
  const statusStil = {
    klar: 'text-emerald-700', avviker: 'text-amber-700', fel: 'text-red-700',
    väntar: 'text-ads-muted', oförändrad: 'text-ads-muted',
  };
  return `
    <table class="w-full text-sm">
      <thead class="text-[10px] uppercase tracking-wider text-ads-muted text-left sticky top-0 bg-white">
        <tr><th class="py-1.5 px-2">Mapp</th><th class="px-2">Vem</th><th class="px-2">Ändring</th>
            ${medStatus ? '<th class="px-2">Utfall</th>' : ''}${medAngra ? '<th></th>' : ''}</tr>
      </thead>
      <tbody>
        ${rader.map(r => `
          <tr class="border-t border-ads-border/60 align-top">
            <td class="py-1.5 px-2"><div class="font-mono text-[11px] break-all">${vkEsc(r.path)}</div></td>
            <td class="px-2 py-1.5"><div class="truncate max-w-[200px]">${vkEsc(r.name)}</div>
                <div class="text-[10px] text-ads-muted">${BH_SUBJ_TYP[r.subjectType]}</div></td>
            <td class="px-2 py-1.5 whitespace-nowrap">${bhFranTill(r.fore, r.efter)}</td>
            ${medStatus ? `<td class="px-2 py-1.5 text-xs ${statusStil[r.status] || ''}">
                ${r.status}${r.status === 'avviker' ? ` (blev ${bhNivaFranActions(r.faktisk) || 'ingen'})` : ''}
                ${r.fel ? `<div class="text-[10px] text-red-700 max-w-[260px]">${vkEsc(r.fel)}</div>` : ''}</td>` : ''}
            ${medAngra ? `<td class="px-2 py-1.5 text-right"><button onclick="bhAngra(${bhRef(r.nyckel)})" class="text-xs text-ads-muted hover:text-red-700" title="Ta bort ur listan">✕</button></td>` : ''}
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function bhGranskaHtml() {
  const a = _bh.andringar;
  const varningar = bhVarningar(a);
  const mappar = new Set(a.map(x => x.path)).size;
  const titel  = _bh.aterstaller ? 'Granska återställning' : 'Granska ändringar';
  return `
    ${bhDialogHuvud(titel, `${a.length} ändring${a.length === 1 ? '' : 'ar'} i ${mappar} mapp${mappar === 1 ? '' : 'ar'}. Inget har skrivits till ACC än.`)}
    ${varningar.map(v => `<div class="mx-5 mt-3 p-2.5 rounded bg-red-50 border border-red-200 text-xs text-red-800">⚠ ${vkEsc(v)}</div>`).join('')}
    <div class="flex-1 overflow-y-auto px-3 py-2">
      ${a.length ? bhAndringsTabell(a, true, false) : '<p class="p-6 text-center text-sm text-ads-muted">Listan är tom.</p>'}
    </div>
    <div class="px-5 py-3 border-t border-ads-border flex items-center gap-3">
      <p class="text-[11px] text-ads-muted flex-1">
        Ändringarna slår igenom direkt i projektet. Läget före sparas, så omgången kan återställas från Historik.
        Kräver Hantera på mapparna.
      </p>
      <button onclick="bhStangDialog()" class="text-sm text-ads-muted hover:text-ads-text px-3">Avbryt</button>
      <button onclick="bhSpara()" ${a.length ? '' : 'disabled'}
              class="bg-be-charcoal hover:bg-black text-white text-sm font-medium py-2 px-4 rounded disabled:opacity-40">
        Spara ${a.length} ändring${a.length === 1 ? '' : 'ar'} till ACC
      </button>
    </div>`;
}

function bhKorHtml() {
  const k = _bh.kor;
  const rakna = s => k.rader.filter(r => r.status === s).length;
  const under = k.klar
    ? `Klart: ${rakna('klar')} klara, ${rakna('avviker')} avviker, ${rakna('fel')} fel${rakna('oförändrad') ? `, ${rakna('oförändrad')} redan rätt` : ''}.`
    : `Sparar… ${k.klaraMappar} av ${k.mappar} mappar.`;
  return `
    ${bhDialogHuvud(k.klar ? 'Ändringarna är sparade' : 'Sparar till ACC', under)}
    ${!k.klar ? `<div class="h-1 bg-ads-gray"><div class="h-full bg-ads-blue transition-all" style="width:${Math.round(100 * k.klaraMappar / k.mappar)}%"></div></div>` : ''}
    <div class="flex-1 overflow-y-auto px-3 py-2">${bhAndringsTabell(k.rader, false, true)}</div>
    ${k.klar ? `
      <div class="px-5 py-3 border-t border-ads-border flex items-center gap-3">
        <p class="text-[11px] text-ads-muted flex-1">
          Mapparna har lästs om från ACC efter sparandet. "Avviker" betyder att ACC visar en annan nivå än den som sattes.
          ${rakna('fel') ? 'Raderna med fel ligger kvar i ändringslistan.' : ''}
        </p>
        <button onclick="bhOppnaDialog('historik')" class="text-sm text-ads-blue hover:underline px-3">Visa historik</button>
        <button onclick="bhStangDialog()" class="bg-be-charcoal hover:bg-black text-white text-sm font-medium py-2 px-4 rounded">Stäng</button>
      </div>` : ''}`;
}

function bhHistorikHtml() {
  const logg = bhLogg();
  const aterstallda = new Set(logg.map(p => p.aterstaller).filter(Boolean));
  return `
    ${bhDialogHuvud('Historik och återställning',
      'Sparade omgångar i det här projektet, nyast först. Historiken finns i den här webbläsaren. Exportera den om den ska sparas.')}
    <div class="flex-1 overflow-y-auto px-5 py-3 space-y-3">
      ${logg.length ? logg.map(p => {
        const andrade = p.andringar.filter(r => r.status === 'klar' || r.status === 'avviker').length;
        return `
          <details class="border border-ads-border rounded">
            <summary class="px-3 py-2 cursor-pointer flex items-center gap-3 text-sm">
              <span class="font-medium">${new Date(p.tid).toLocaleString('sv-SE')}</span>
              <span class="text-ads-muted text-xs">${vkEsc(p.anvandare)}</span>
              ${p.aterstaller ? '<span class="text-[10px] px-1.5 rounded bg-ads-gray text-ads-muted">återställning</span>' : ''}
              ${aterstallda.has(p.id) ? '<span class="text-[10px] px-1.5 rounded bg-emerald-50 text-emerald-700">återställd</span>' : ''}
              <span class="flex-1 text-xs text-ads-muted text-right">${p.andringar.length} rader · ${andrade} ändrade</span>
              ${andrade ? `<button onclick="event.preventDefault(); bhAterstall(${p.id})"
                                   class="text-xs border border-ads-border rounded px-2 py-1 hover:border-ads-blue">Återställ…</button>` : ''}
            </summary>
            <div class="px-2 pb-2">${bhAndringsTabell(p.andringar, false, true)}</div>
          </details>`;
      }).join('') : '<p class="p-6 text-center text-sm text-ads-muted">Inga sparade ändringar i det här projektet än.</p>'}
    </div>
    <div class="px-5 py-3 border-t border-ads-border flex items-center gap-3">
      <p class="text-[11px] text-ads-muted flex-1">
        Återställ bygger en ändringslista som sätter tillbaka läget före omgången. Du granskar den innan något skrivs.
      </p>
      ${logg.length ? '<button onclick="bhExporteraLogg()" class="text-sm text-ads-blue hover:underline px-3">Exportera till Excel</button>' : ''}
      <button onclick="bhStangDialog()" class="text-sm border border-ads-border rounded px-3 py-1.5 hover:border-ads-blue">Stäng</button>
    </div>`;
}

// Redigering i mappdetaljen när ingen person är vald: direkta behörigheter
// kan ändras eller tas bort, och nya läggas till.
function bhRedigeraRadHtml(path, x, kind) {
  if (!bhKanSkriva() || x.source !== 'direct') return '';
  const subj = bhSubjekt({ kind, id: x.id, name: x.name });
  const vant = bhVantandeFor(path, subj.subjectId);
  const pRef = bhRef(path), sRef = bhRef(subj);
  return `
    <div class="flex items-center gap-1 shrink-0">
      ${vant ? bhVantandeTagg(vant) : ''}
      ${bhNivaval('', bhNivaFranActions(vant ? vant.efter : bhDirektaActions(path, subj.subjectId)) || '', '', `bhForeslaNiva(${pRef}, ${sRef}, this.value)`)}
      <button onclick="bhForeslaNiva(${pRef}, ${sRef}, '')" class="text-ads-muted hover:text-red-700 text-xs px-1" title="Ta bort direkt behörighet">✕</button>
    </div>`;
}

function bhVantandeTagg(a) {
  return `<span class="text-[10px] px-1 rounded bg-amber-100 text-amber-900 whitespace-nowrap" title="Väntar i ändringslistan">
            ${a.efter ? `→ ${bhNivaFranActions(a.efter)}` : 'tas bort'}</span>`;
}

function bhLaggTillHtml(path) {
  if (!bhKanSkriva()) return '';
  const pRef = bhRef(path);
  const subjekt = bhSkrivbaraSubjekt(_bh.nyTyp);
  // Nya poster som väntar på mappen och ännu inte har någon behörighet här.
  const nya = _bh.andringar.filter(a => a.path === path && !a.fore);
  return `
    <div class="mt-5 pt-3 border-t border-ads-border">
      <div class="text-[10px] uppercase tracking-wider text-ads-muted font-semibold mb-2">Lägg till behörighet</div>
      ${nya.map(a => `
        <div class="flex items-center justify-between text-sm py-0.5">
          <span class="truncate">${vkEsc(a.name)} <span class="text-[10px] text-ads-muted">${BH_SUBJ_TYP[a.subjectType]}</span></span>
          <span class="flex items-center gap-1">${bhVantandeTagg(a)}
            <button onclick="bhAngra(${bhRef(a.nyckel)})" class="text-ads-muted hover:text-red-700 text-xs px-1">✕</button></span>
        </div>`).join('')}
      <div class="flex gap-1 mb-1.5">
        ${['ROLE', 'COMPANY', 'USER'].map(t => `
          <button onclick="bhSattNyTyp('${t}')"
                  class="text-[11px] px-2 py-0.5 rounded ${_bh.nyTyp === t ? 'bg-be-charcoal text-white' : 'bg-ads-gray text-ads-text'}">${BH_SUBJ_TYP[t]}</button>`).join('')}
      </div>
      <select id="bh-ny-subjekt" class="w-full border border-ads-border rounded px-2 py-1 text-sm bg-white mb-1.5">
        ${subjekt.map(s => `<option value="${vkEsc(s.subjectId)}">${vkEsc(s.name)}${s.email ? ` (${vkEsc(s.email)})` : ''}</option>`).join('')}
      </select>
      <div class="flex items-center gap-1.5">
        ${bhNivaval('bh-ny-niva', 'VD', '')}
        <button onclick="bhLaggTillFranFormular(${pRef})" ${subjekt.length ? '' : 'disabled'}
                class="text-xs border border-ads-border rounded px-2.5 py-1 hover:border-ads-blue disabled:opacity-40">Lägg i listan</button>
      </div>
    </div>`;
}

// Redigering i mappdetaljen när en person är vald.
function bhRedigeraPersonHtml(path, m) {
  if (!bhKanSkriva()) return '';
  const subj = bhSubjekt({ kind: 'member', member: m });
  if (!subj) {
    return '<p class="mt-4 text-[11px] text-ads-muted italic">Personen saknar id i ACC och kan inte få direkt behörighet härifrån.</p>';
  }
  const pRef = bhRef(path), sRef = bhRef(subj);
  const vant = bhVantandeFor(path, subj.subjectId);
  const nu   = bhNivaFranActions(vant ? vant.efter : bhDirektaActions(path, subj.subjectId));
  return `
    <div class="mt-5 pt-3 border-t border-ads-border">
      <div class="text-[10px] uppercase tracking-wider text-ads-muted font-semibold mb-2">Direkt behörighet på den här mappen</div>
      <div class="flex items-center gap-1.5">
        ${bhNivaval('', nu || '', '– ingen direkt –', `bhForeslaNiva(${pRef}, ${sRef}, this.value)`)}
        ${vant ? bhVantandeTagg(vant) : ''}
      </div>
      <p class="text-[10px] text-ads-muted mt-1.5">Roll och företag ändras genom att avmarkera personen och välja mappen.</p>
    </div>`;
}

// Verktygsraden för massändring i Bläddra.
function bhMassradHtml() {
  const subj = bhSubjekt(_bh.vald);
  const n = _bh.markerade.size;
  if (!subj) {
    return `<span class="text-xs text-ads-muted">Välj en person, roll eller ett företag till vänster för att ändra behörigheterna på flera mappar samtidigt.</span>`;
  }
  return `
    <span class="text-xs"><b>${n}</b> mappar markerade för <b>${vkEsc(subj.name)}</b></span>
    <button onclick="bhMarkeraSynliga(true)" class="text-[11px] text-ads-blue hover:underline">Markera synliga</button>
    <button onclick="bhMarkeraSynliga(false)" class="text-[11px] text-ads-blue hover:underline">Avmarkera</button>
    <div class="flex-1"></div>
    ${bhNivaval('bh-mass-niva', 'VD', '')}
    <button onclick="bhMassForesla(false)" ${n ? '' : 'disabled'}
            class="text-xs border border-ads-border rounded px-2.5 py-1 bg-white hover:border-ads-blue disabled:opacity-40">Sätt nivå</button>
    <button onclick="bhMassForesla(true)" ${n ? '' : 'disabled'}
            class="text-xs border border-ads-border rounded px-2.5 py-1 bg-white hover:border-red-400 disabled:opacity-40">Ta bort direkt</button>`;
}
