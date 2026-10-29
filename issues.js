// issues.js — fliken Issues.
//
// En ärendedashboard över flera projekt i kontot, hämtad direkt från ACC i stället
// för via en schemalagd export. Vyerna motsvarar flikarna i den tidigare
// dashboarden och är filter på ärendetyp och tilldelning, som kan ändras här.
// Status, tilldelning och förfallodatum kan ändras från tabellen.
//
// Inläsningen ligger i issues-las.js och ändringarna i issues-skriv.js.

const _is = {
  hubId:      null,
  projekt:    new Map(),   // projekt-id → inläst projekt
  valda:      null,        // Set med valda projekt-id
  valjProjekt: false,      // projektväljaren öppen
  projektSok: '',
  laddar:     false,
  framsteg:   null,        // { klara, totalt }
  fel:        null,
  hamtad:     null,

  yta:         'start',    // start | admin | clash | alla, se issues-ytor.js
  inst:        null,
  instUtkast:  null,
  kommentarer: new Map(),  // ärende-id → { uppdaterat, senaste }
  adminVem:    'oss',      // oss | andra | alla
  clashLage:   'redo',     // redo | delvis | ovrigt | alla
  clashValda:  new Set(),
  clashLaddar: null,
  modell:       new Map(), // ärende-id → modellkontroll, se issues-modell.js
  modellStatus: null,
  modellFilter: 'alla',
  medlem:        isNyttMedlemTillstand(),  // ytan Medlemmar, se issues-medlem.js

  vyer:        null,
  vyId:        'koordinator',
  visaStangda: false,
  filter:      { status: null, forfallen: null, projekt: null },
  sok:         '',
  kolFilter:   {},       // kolumn → söktext i tabellens sökrad
  sortering:   { kol: 'forfaller', upp: true },
  visaAntal:   300,
  redigera:    false,

  andringar:   [],
  markerade:   new Set(), // ärende-id markerade i "Alla ärenden", se issues-flera.js
  flera:       { meny: null, status: null, tilldela: null, sok: '', datumLage: 'satt', datum: '', dagar: 7,
                 bevLage: 'lagg', bevValda: [], bevPerson: false, bevForetag: false },
  hoppade:     [],       // ärenden som en ändring av flera hoppade över, med skäl
  kolumner:    null,     // valda kolumner, se issues-kolumner.js
  kolMeny:     false,
  dialog:      null,     // granska | kor | historik | vyer
  kor:         null,
  logg:        null,
  aterstaller: null,
  ref:         [],
};

function isRef(x) {
  return _is.ref.push(x) - 1;
}

function isNyttMedlemTillstand() {
  return { flik: 'onb', foretag: null, steg: null, klistra: null, laddar: false, fel: null, oppen: null,
           utkast: new Map(), projektMedlemmar: new Map(), kor: null, logg: null, meddelande: null };
}

function isOppnaFlik() {
  const hub = _hubs[_hubIdx];
  if (_is.hubId !== hub?.id) {
    // Nytt konto: börja om, men behåll inget från det förra kontot.
    Object.assign(_is, { hubId: hub?.id, projekt: new Map(), valda: null, hamtad: null, fel: null,
                         andringar: [], markerade: new Set(), hoppade: [], kolumner: null, dialog: null, kor: null, logg: null, vyer: null, inst: null,
                         kommentarer: new Map(), clashValda: new Set(), yta: 'start', platsNamn: null,
                         medlem: isNyttMedlemTillstand() });
  }
  if (!_is.vyer)  _is.vyer  = isLasVyer();
  if (!_is.inst)  _is.inst  = { ...IS_STANDARDINST, ...(isHamtaLagrat('is-inst') || {}) };
  if (!_is.platsNamn) _is.platsNamn = isHamtaLagrat('is-platser') || {};

  // Fliken visar projektet som är valt i sidomenyn. Är det inte inläst läses
  // det in direkt, och fler projekt läggs till via "Projekt".
  const aktuellt = _currentProject?.id;
  if (aktuellt && !_is.projekt.has(aktuellt) && !_is.laddar) {
    _is.valda = new Set([aktuellt]);
    _is.valjProjekt = false;
    isHamta();
    return;
  }
  if (!_is.valda) _is.valda = new Set([aktuellt].filter(Boolean));
  if (!_is.hamtad && !_is.laddar) _is.valjProjekt = true;
  isRita();
  if (hub && !_projCache[hub.id]) {
    listProjects(hub.id).then(p => { _projCache[hub.id] = p; isRita(); }).catch(() => {});
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _is.dialog) isStangDialog();
});

// ── Sparade val ───────────────────────────────────────────────────────────────

function isLagra(nyckel, varde) {
  try { localStorage.setItem(`${nyckel}:${_is.hubId}`, JSON.stringify(varde)); } catch { /* inte kritiskt */ }
}

function isHamtaLagrat(nyckel) {
  try { return JSON.parse(localStorage.getItem(`${nyckel}:${_is.hubId}`) || 'null'); } catch { return null; }
}

function isLasVyer() {
  const sparade = isHamtaLagrat('is-vyer');
  return Array.isArray(sparade) && sparade.length ? sparade : IS_STANDARDVYER.map(v => ({ ...v }));
}

// ── Inläsning ─────────────────────────────────────────────────────────────────

async function isHamta() {
  const hub = _hubs[_hubIdx];
  if (!_projCache[hub.id]) _projCache[hub.id] = await listProjects(hub.id);
  const projekt = _projCache[hub.id].filter(p => _is.valda.has(p.id));
  if (!projekt.length) return isRita();
  if (_is.andringar.length && !confirm(`${_is.andringar.length} ändringar väntar och försvinner vid ny hämtning. Fortsätta?`)) {
    // Behåll det som redan är inläst.
    _is.valda = new Set(_is.projekt.keys());
    return isRita();
  }

  Object.assign(_is, { laddar: true, fel: null, valjProjekt: false, andringar: [], hoppade: [], framsteg: { klara: 0, totalt: projekt.length } });
  isRita();

  const nya = new Map();
  const fel = [];
  let i = 0;
  const arbetare = async () => {
    while (i < projekt.length) {
      const p = projekt[i++];
      try { nya.set(p.id, await isLasProjekt(hub.id, p)); }
      catch (err) { fel.push(`${p.attributes?.name}: ${bhKortFel(err)}`); }
      isVisaFramsteg();
    }
  };
  await Promise.all([arbetare(), arbetare(), arbetare()]);

  Object.assign(_is, { projekt: nya, laddar: false, hamtad: new Date(), fel: fel.length ? fel : null, clashValda: new Set(),
                       modell: new Map(), modellStatus: null,
                       medlem: { ...isNyttMedlemTillstand(), flik: _is.medlem.flik, foretag: _is.medlem.foretag, logg: _is.medlem.logg } });
  // Var "Visa stängda" påslaget hämtas de stängda direkt också.
  if (_is.visaStangda) { _is.visaStangda = false; return isVaxlaStangda(); }
  isRita();
  if (_is.yta === 'clash') { isLasClashKommentarer(); if (isInst().modellAuto) isKorModellkontroll(); }
}

// ── Händelser ─────────────────────────────────────────────────────────────────

function isVaxlaProjektval() {
  _is.valjProjekt = !_is.valjProjekt;
  isRita();
}

function isMarkeraProjekt(ref, pa) {
  const id = _is.ref[ref];
  if (pa) _is.valda.add(id); else _is.valda.delete(id);
  const el = document.getElementById('is-antal-valda');
  if (el) el.textContent = _is.valda.size;
}

function isSokProjekt(text) {
  _is.projektSok = text;
  const el = document.getElementById('is-projektlista');
  if (el) el.innerHTML = isProjektlistaHtml();
}

function isValjVy(id) {
  _is.vyId      = id;
  _is.filter    = { status: null, forfallen: null, projekt: null };
  _is.kolFilter = {};
  isRita();
}

function isSattFilter(nyckel, ref) {
  const varde = ref == null ? null : _is.ref[ref];
  _is.filter[nyckel] = _is.filter[nyckel] === varde ? null : varde;
  isRita();
}

function isRensaFilter() {
  _is.filter    = { status: null, forfallen: null, projekt: null };
  _is.sok       = '';
  _is.kolFilter = {};
  isRita();
}

function isSok(text) {
  _is.sok = text;
  isRitaRader();
}

// Sökfälten under kolumnrubrikerna. Bara raderna ritas om, så att fältet
// man skriver i behåller fokus.
function isKolumnSok(kol, text) {
  if (text) _is.kolFilter[kol] = text; else delete _is.kolFilter[kol];
  isRitaRader();
}

// Klick på ett värde i tabellen filtrerar kolumnen på just det värdet.
function isFiltreraPa(kol, ref) {
  const varde = _is.ref[ref];
  if (_is.kolFilter[kol] === varde) delete _is.kolFilter[kol]; else _is.kolFilter[kol] = varde;
  isRita();
}

function isRitaRader() {
  const kropp = document.getElementById('is-tbody');
  const fot   = document.getElementById('is-fot');
  if (!kropp) return;
  isRensaDoldaMarkeringar();
  const { html, fotHtml } = isRaderHtml();
  kropp.innerHTML = html;
  if (fot) fot.innerHTML = fotHtml;
  const diagram = document.getElementById('is-diagram');
  if (diagram) diagram.innerHTML = isDiagramHtml();
  isRitaMarkering();
}

function isSortera(kol) {
  _is.sortering = { kol, upp: _is.sortering.kol === kol ? !_is.sortering.upp : true };
  isRita();
}

// Stängda ärenden hämtas först första gången de ska visas.
async function isVaxlaStangda() {
  _is.visaStangda = !_is.visaStangda;
  const saknas = [..._is.projekt.values()].filter(p => !p.medStangda);
  if (!_is.visaStangda || !saknas.length) return isRita();

  Object.assign(_is, { laddar: true, framsteg: { klara: 0, totalt: saknas.length, text: 'Hämtar stängda ärenden…' } });
  isRita();
  const fel = [];
  await Promise.all(saknas.map(p => isLasStangda(p)
    .catch(err => fel.push(`${p.namn}: ${bhKortFel(err)}`))
    .finally(() => isVisaFramsteg())));
  Object.assign(_is, { laddar: false, fel: fel.length ? fel : _is.fel });
  isRita();
}

function isVisaFramsteg() {
  _is.framsteg.klara++;
  const el = document.getElementById('is-framsteg');
  if (el) el.textContent = isFramstegText();
}

function isFramstegText() {
  const f = _is.framsteg || {};
  return `${f.text || 'Hämtar ärenden…'} ${f.klara || 0} av ${f.totalt || 0} projekt`;
}

function isVaxlaRedigera() {
  _is.redigera = !_is.redigera;
  isRita();
}

function isVisaFler() {
  _is.visaAntal += 300;
  isRita();
}

function isOppnaDialog(namn) {
  _is.dialog = namn;
  if (namn === 'vyer') _is.vyUtkast = _is.vyer.map(v => ({ ...v }));
  if (namn === 'inst') _is.instUtkast = { ...isInst() };
  isRita();
}

function isStangDialog() {
  if (_is.kor && !_is.kor.klar) return;
  _is.dialog = null;
  _is.kor    = null;
  isRita();
}

// ── Vyredigeraren ─────────────────────────────────────────────────────────────

function isVyFalt(i, falt, varde) {
  _is.vyUtkast[i][falt] = varde;
}

function isNyVy() {
  _is.vyUtkast.push({ id: `vy${Date.now()}`, namn: 'Ny vy' });
  isRita();
}

function isTaBortVy(i) {
  _is.vyUtkast.splice(i, 1);
  isRita();
}

function isFlyttaVy(i, steg) {
  const j = i + steg;
  if (j < 0 || j >= _is.vyUtkast.length) return;
  [_is.vyUtkast[i], _is.vyUtkast[j]] = [_is.vyUtkast[j], _is.vyUtkast[i]];
  isRita();
}

function isSparaVyer() {
  _is.vyer = _is.vyUtkast.filter(v => v.namn.trim());
  isLagra('is-vyer', _is.vyer);
  if (!_is.vyer.some(v => v.id === _is.vyId)) _is.vyId = _is.vyer[0]?.id;
  _is.dialog = null;
  isRita();
}

function isStandardVyer() {
  _is.vyUtkast = IS_STANDARDVYER.map(v => ({ ...v }));
  isRita();
}

// ── Urval ─────────────────────────────────────────────────────────────────────

function isAllaArenden() {
  const ut = [];
  for (const p of _is.projekt.values()) ut.push(...p.arenden);
  return ut;
}

// Ärendena i vald vy, före diagramfiltren. Utan "visa stängda" tas stängda bort.
function isVyArenden() {
  const vy = _is.vyer.find(v => v.id === _is.vyId);
  return isAllaArenden().filter(a => (_is.visaStangda || a.status !== 'closed') && isMatcharVy(a, vy));
}

const IS_DAGAR_VAL = {
  forfallna: { text: 'Förfallna',          test: a => isArForfallet(a) },
  snart:     { text: 'Inom 3 dagar',       test: a => { const d = isDagarKvar(a.forfaller); return d != null && d >= 0 && d <= 3 && !IS_KLARA.has(a.status); } },
  utan:      { text: 'Utan förfallodatum', test: a => !a.forfaller },
};

function isMatcharKolumner(a) {
  for (const [kol, varde] of Object.entries(_is.kolFilter)) {
    if (kol === 'status') { if (a.status !== varde) return false; continue; }
    if (kol === 'dagar')  { if (!IS_DAGAR_VAL[varde]?.test(a)) return false; continue; }
    if (kol === 'typ')    { if (!isMatcharTyp(a, varde)) return false; continue; }
    if (kol === 'tilldeladTyp') { if ((a.tilldeladTyp || 'ingen') !== varde) return false; continue; }
    if (kol === 'tilldeladVia') continue;
    if (kol === 'tilldelad' && _is.kolFilter.tilldeladVia) { if (!isTilldeladViaMatchar(a, varde)) return false; continue; }
    // Texten kolumnen visar, se issues-kolumner.js.
    const text = isKolumnText(kol, a);
    // Flera sökord separerade med komma: något av dem ska finnas.
    if (!isDelar(varde).some(t => text.toLowerCase().includes(t))) return false;
  }
  return true;
}

// ── Tilldelning till person, roll eller företag ───────────────────────────────
// Ett ärende kan vara tilldelat en person, en roll eller ett företag. Med
// "även via roll och företag" träffar en sökning på en person också ärenden
// som ligger på personens roller och företag, enligt projektets medlemslista.
// Rollerna och företagen jämförs på namn.

const IS_TILLDELAD_TYP = [['user', 'Person'], ['role', 'Roll'], ['company', 'Företag'], ['ingen', 'Ej tilldelat']];

// Projekt-id → namn (gemener) på roller och företag som hör till personerna
// som matchar sökorden.
function isGrupperForPersoner(varde) {
  if (_is._viaCache?.varde === varde && _is._viaCache.projekt === _is.projekt) return _is._viaCache.karta;
  const termer = isDelar(varde);
  const karta = new Map();
  for (const p of _is.projekt.values()) {
    const namn = new Set();
    for (const m of p.medlemmar || []) {
      const person = `${m.name || ''} ${m.email || ''}`.toLowerCase();
      if (!termer.some(t => person.includes(t))) continue;
      if (m.companyName) namn.add(m.companyName.toLowerCase());
      for (const r of m.roles || []) if (r.name) namn.add(r.name.toLowerCase());
    }
    karta.set(p.id, namn);
  }
  _is._viaCache = { varde, projekt: _is.projekt, karta };
  return karta;
}

function isTilldeladViaMatchar(a, varde) {
  const text = (a.tilldelad || '').toLowerCase();
  if (isDelar(varde).some(t => text.includes(t))) return true;
  if (a.tilldeladTyp !== 'role' && a.tilldeladTyp !== 'company') return false;
  return isGrupperForPersoner(varde).get(a.projektId)?.has(text) || false;
}

function isVaxlaTilldeladVia(pa) {
  if (pa) _is.kolFilter.tilldeladVia = '1'; else delete _is.kolFilter.tilldeladVia;
  isRitaRader();
}

// Liten etikett framför namnet för roller och företag.
function isTilldeladEtikett(typ) {
  if (typ === 'role') return '<span class="mr-1 text-[9px] uppercase tracking-wide px-1 rounded bg-violet-100 text-violet-800">Roll</span>';
  if (typ === 'company') return '<span class="mr-1 text-[9px] uppercase tracking-wide px-1 rounded bg-teal-100 text-teal-800">Företag</span>';
  return '';
}

// Sökfältet och kolumnfiltren. Styr både tabellen och nyckeltalen.
function isSokfiltrerade(arenden) {
  const q = _is.sok.trim().toLowerCase();
  return arenden.filter(a =>
    isMatcharKolumner(a) &&
    (!q || [a.rubrik, a.typ, a.subtyp, a.tilldelad, a.skapadAv, String(a.nr), a.projekt, isLocation(a)].some(s => (s || '').toLowerCase().includes(q))));
}

// Plus klicken i diagrammen, som bara styr tabellen.
function isFiltrerade(arenden) {
  const f = _is.filter;
  return isSokfiltrerade(arenden).filter(a =>
    (!f.status || a.status === f.status) &&
    (f.forfallen == null || isArForfallet(a) === f.forfallen) &&
    (!f.projekt || a.projekt === f.projekt));
}

function isSorterade(arenden) {
  const { kol, upp } = _is.sortering;
  // Ärenden utan värde hamnar sist oavsett riktning.
  const tomt  = upp ? '￿' : '';
  const varde = a => kol === 'dagar' ? (isDagarKvar(a.forfaller) ?? (upp ? 99999 : -99999))
                   : kol === 'nr' ? a.nr
                   : kol === 'forfaller' ? (a.forfaller || tomt)
                   : (isKolumnText(kol, a) || tomt);
  return [...arenden].sort((x, y) => {
    const a = varde(x), b = varde(y);
    const c = typeof a === 'number' ? a - b : String(a).localeCompare(String(b), 'sv', { numeric: true });
    return upp ? c : -c;
  });
}

// ── Export ────────────────────────────────────────────────────────────────────

function isExportera() {
  const rader = isSorterade(isFiltrerade(isVyArenden()));
  const aoa = [['Nr', 'Projekt', 'Ärendetyp', 'Subtyp', 'Rubrik', 'Status', 'Tilldelad till', 'Tilldelad typ', 'Skapad av', 'Skapat', 'Förfallodatum', 'Dagar till förfall', 'Förfallet', 'Location', 'Länk']];
  for (const a of rader) {
    aoa.push([a.nr, a.projekt, a.typ, a.subtyp, a.rubrik, isStatusLabel(a.status), a.tilldelad, isTypNamn(a.tilldeladTyp), a.skapadAv, a.skapat,
              a.forfaller, isDagarKvar(a.forfaller) ?? '', isArForfallet(a) ? 'Ja' : 'Nej', isLocation(a), isLank(a)]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 6 }, { wch: 26 }, { wch: 20 }, { wch: 20 }, { wch: 40 }, { wch: 11 }, { wch: 26 }, { wch: 9 }, { wch: 22 }, { wch: 11 }, { wch: 11 }, { wch: 8 }, { wch: 8 }, { wch: 22 }, { wch: 60 }];
  const wb = XLSX.utils.book_new();
  const vy = _is.vyer.find(v => v.id === _is.vyId);
  XLSX.utils.book_append_sheet(wb, ws, bhBladnamn(vy?.namn || 'Ärenden'));
  bhLaddaNer(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]),
    `arenden_${(vy?.namn || 'alla').replace(/[\\/?*[\]:\s]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Länk till ärendet i ACC. EU-konton ligger på acc.autodesk.eu.
function isLank(a) {
  const doman = _hubs[_hubIdx]?.attributes?.region === 'EMEA' ? 'acc.autodesk.eu' : 'acc.autodesk.com';
  return `https://${doman}/build/issues/projects/${a.accId}/issues?issueId=${a.id}`;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function isRita() {
  _is.ref = [];
  document.getElementById('main-content').innerHTML = `
    <div class="flex flex-col bg-ads-gray" style="height: calc(100vh - 3rem)">
      ${isHuvudHtml()}
      <div class="flex-1 overflow-y-auto">${isKroppHtml()}</div>
      ${_is.hamtad ? isAndringsradHtml() : ''}
    </div>
    ${isDialogHtml()}`;
  isVisaMarkeraAlla();
}

function isHuvudHtml() {
  const antalProjekt = _is.projekt.size;
  return `
    <div class="shrink-0 bg-white border-b border-ads-border px-5 py-3 flex items-center gap-4 flex-wrap">
      <div>
        <h2 class="text-lg font-semibold text-ads-text leading-tight">Ärenden</h2>
        <p class="text-[11px] text-ads-muted">
          ${_is.hamtad ? `${antalProjekt} projekt · hämtat ${_is.hamtad.toLocaleString('sv-SE')}` : 'Direkt från ACC, över valda projekt'}
        </p>
      </div>
      ${_is.hamtad && !_is.valjProjekt ? `
        <nav class="flex items-center bg-ads-gray rounded p-0.5 ml-2">
          ${[['start', 'Start'], ['admin', 'Admin'], ['clash', 'Clash'], ['medlem', 'Medlemmar'], ['alla', 'Alla ärenden']].map(([y, t]) => `
            <button onclick="isSattYta('${y}')"
                    class="px-3 py-1 text-xs font-medium rounded ${_is.yta === y ? 'bg-white shadow-sm text-ads-text' : 'text-ads-muted hover:text-ads-text'}">${t}</button>`).join('')}
        </nav>` : ''}
      <div class="flex-1"></div>
      ${_is.hamtad ? `
        ${bhKnapp('isVaxlaProjektval()', `Projekt (${_is.valda.size}) ▾`)}
        ${_is.yta === 'alla' ? '' : bhKnapp('isHamta()', 'Uppdatera', _is.laddar ? 'disabled' : '')}
        ${_is.yta === 'alla' ? bhKnapp('isOppnaDialog(\'vyer\')', 'Redigera vyer') : ''}
        ${bhKnapp('isOppnaDialog(\'inst\')', 'Inställningar')}` : ''}
    </div>`;
}

function isKroppHtml() {
  if (_is.laddar) {
    return `<div class="max-w-xl mx-auto mt-16">${vkLaddarKort('§').replace('§', `<span id="is-framsteg">${isFramstegText()}</span>`)}</div>`;
  }
  const fel = _is.fel ? `
    <div class="mx-5 mt-4 p-3 rounded border border-red-200 bg-red-50 text-xs text-red-800">
      ${_is.fel.map(f => `<div>${vkEsc(f)}</div>`).join('')}
    </div>` : '';
  if (_is.valjProjekt || !_is.hamtad) return fel + isProjektvalHtml();
  const yta = { start: isStartHtml, admin: isAdminHtml, clash: isClashHtml, medlem: isMedlemHtml, alla: isDashboardHtml }[_is.yta] || isStartHtml;
  return fel + isVarningarHtml() + yta();
}

function isProjektvalHtml() {
  return `
    <div class="max-w-3xl mx-auto px-5 py-6">
      <div class="bg-white border border-ads-border rounded p-5">
        <h3 class="text-sm font-semibold text-ads-text mb-1">Vilka projekt ska räknas?</h3>
        <p class="text-xs text-ads-muted mb-3">Valet sparas till nästa gång. Du ser bara de ärenden du har rätt att se i ACC.</p>
        <input type="search" placeholder="Sök projekt…" value="${vkEsc(_is.projektSok)}" oninput="isSokProjekt(this.value)"
               class="w-full px-2.5 py-1.5 text-sm border border-ads-border rounded mb-2 focus:outline-none focus:ring-1 focus:ring-ads-blue" />
        <div id="is-projektlista" class="max-h-80 overflow-y-auto border border-ads-border rounded">${isProjektlistaHtml()}</div>
        <div class="flex items-center gap-3 mt-4">
          <span class="text-xs text-ads-muted"><b id="is-antal-valda">${_is.valda.size}</b> valda</span>
          <div class="flex-1"></div>
          ${_is.hamtad ? `<button onclick="isVaxlaProjektval()" class="text-sm text-ads-muted hover:text-ads-text px-3">Avbryt</button>` : ''}
          <button onclick="isHamta()" class="bg-be-charcoal hover:bg-black text-white text-sm font-medium py-2 px-4 rounded">Hämta ärenden</button>
        </div>
      </div>
    </div>`;
}

function isProjektlistaHtml() {
  const alla = _projCache[_is.hubId] || [];
  const q = _is.projektSok.trim().toLowerCase();
  const fav = favoriter();
  const lista = alla.filter(p => !q || (p.attributes?.name || '').toLowerCase().includes(q))
    .sort((a, b) => (_is.valda.has(b.id) - _is.valda.has(a.id)) || (fav.has(b.id) - fav.has(a.id))
      || (a.attributes?.name || '').localeCompare(b.attributes?.name || '', 'sv'));
  if (!lista.length) return '<p class="p-4 text-sm text-ads-muted text-center">Inga projekt</p>';
  return lista.map(p => `
    <label class="flex items-center gap-2 px-3 py-1.5 border-b border-ads-border/60 last:border-b-0 text-sm cursor-pointer hover:bg-ads-gray">
      <input type="checkbox" ${_is.valda.has(p.id) ? 'checked' : ''} onchange="isMarkeraProjekt(${isRef(p.id)}, this.checked)" class="accent-ads-blue" />
      ${vkEsc(p.attributes?.name || p.id)}
    </label>`).join('');
}

function isVarningarHtml() {
  const varningar = [];
  for (const p of _is.projekt.values()) for (const v of p.varningar) varningar.push(`${p.namn}: ${v}`);
  if (!varningar.length) return '';
  return `
    <details class="mx-5 mt-4 p-2.5 rounded border border-amber-200 bg-amber-50 text-xs text-amber-900">
      <summary class="cursor-pointer">${varningar.length} anmärkning${varningar.length > 1 ? 'ar' : ''} vid hämtningen</summary>
      <div class="mt-1">${varningar.map(v => `<div>${vkEsc(v)}</div>`).join('')}</div>
    </details>`;
}

function isDashboardHtml() {
  const f = _is.filter;
  const aktivaFilter = [
    f.status && `Status: ${isStatusLabel(f.status)}`,
    f.forfallen != null && (f.forfallen ? 'Förfallna' : 'Ej förfallna'),
    f.projekt && `Projekt: ${f.projekt}`,
  ].filter(Boolean);
  isRensaDoldaMarkeringar();

  return `
    <div class="px-5 pt-4">
      <div class="flex items-center gap-1 flex-wrap border-b border-ads-border">
        ${_is.vyer.map(v => `
          <button onclick="isValjVy('${v.id}')"
                  class="px-3 py-2 text-xs font-medium -mb-px border-b-2 ${v.id === _is.vyId ? 'border-ads-blue text-ads-text' : 'border-transparent text-ads-muted hover:text-ads-text'}">
            ${vkEsc(v.namn)}</button>`).join('')}
      </div>
    </div>

    <div id="is-diagram">${isDiagramHtml()}</div>

    <div class="px-5 py-4">
      <div class="bg-white border border-ads-border rounded">
        <div class="px-4 py-2.5 border-b border-ads-border flex items-center gap-3 flex-wrap">
          <h3 class="text-sm font-semibold text-ads-text">Ärenden</h3>
          <button onclick="isHamta()" ${_is.laddar ? 'disabled' : ''} title="Hämta om ärendena från ACC. Vy och filter behålls."
                  class="flex items-center gap-1.5 text-xs border border-ads-border rounded px-2.5 py-1 bg-white hover:border-ads-blue disabled:opacity-40">
            <span>↻</span> Uppdatera</button>
          <span class="text-[11px] text-ads-muted">hämtat ${_is.hamtad.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}</span>
          <div class="flex-1"></div>
          <div class="relative">
            ${bhKnapp('isVaxlaKolumnmeny()', 'Kolumner ▾')}
            ${_is.kolMeny ? isKolumnmenyHtml() : ''}
          </div>
          ${bhKnapp('isOppnaPlatser()', 'Namnge platser')}${bhKnapp('isExportera()', 'Excel')}
        </div>
        <div class="px-4 py-2 border-b border-ads-border flex items-center gap-3 flex-wrap">
          <span class="w-36 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ads-text">Filter</span>
          <input type="search" placeholder="Sök rubrik, person, nr…" value="${vkEsc(_is.sok)}" oninput="isSok(this.value)"
                 class="px-2.5 py-1 text-sm border border-ads-border rounded w-56 focus:outline-none focus:ring-1 focus:ring-ads-blue" />
          <label class="flex items-center gap-1.5 text-xs text-ads-muted cursor-pointer">
            <input type="checkbox" ${_is.visaStangda ? 'checked' : ''} onchange="isVaxlaStangda()" class="accent-ads-blue" /> Visa stängda</label>
          ${aktivaFilter.map(t => `<span class="text-[11px] px-2 py-0.5 rounded-full bg-ads-blue/10 text-ads-blue">${vkEsc(t)}</span>`).join('')}
          ${aktivaFilter.length || _is.sok || Object.keys(_is.kolFilter).length
            ? '<button onclick="isRensaFilter()" class="text-[11px] text-ads-muted hover:text-ads-text">Rensa alla filter ✕</button>' : ''}
          <span class="text-[11px] text-ads-muted">Filtrera också per kolumn i raden under rubrikerna.</span>
        </div>
        <div id="is-markrad">${isMarkradHtml()}</div>
        <div id="is-tabell" class="overflow-x-auto">${isTabellHtml()}</div>
      </div>
    </div>`;
}

// Nyckeltal och diagram. De följer vyn, sökfältet och kolumnfiltren, så att
// till exempel ett namn i "Tilldelad till" ger den personens siffror. Klick i
// diagrammen filtrerar bara tabellen, annars skulle diagrammet krympa till
// det man klickat på.
function isDiagramHtml() {
  const s = isSammanstall(isSokfiltrerade(isVyArenden()));
  const f = _is.filter;
  const kort = (titel, antal, farg, filterNyckel, filterVarde) => `
    <button onclick="isSattFilter('${filterNyckel}', ${filterVarde == null ? 'null' : isRef(filterVarde)})"
            class="bg-white border rounded p-4 text-left transition-colors hover:border-ads-blue
                   ${filterNyckel && f[filterNyckel] === filterVarde && filterVarde != null ? 'border-ads-blue ring-1 ring-ads-blue' : 'border-ads-border'}">
      <div class="text-sm font-semibold" style="color:${farg}">${titel}</div>
      <div class="text-3xl font-semibold text-ads-text mt-2">${antal}</div>
    </button>`;
  const sokText = [_is.sok && `sök "${_is.sok}"`, ...Object.entries(_is.kolFilter).map(([k, v]) =>
    k === 'tilldeladVia' ? 'även via roll och företag' :
    `${k === 'tilldeladTyp' ? 'Tilldelad till' : isKolumnNamn(k)}: ${
      k === 'status' ? isStatusLabel(v) : k === 'dagar' ? IS_DAGAR_VAL[v]?.text
      : k === 'tilldeladTyp' ? (IS_TILLDELAD_TYP.find(([t]) => t === v)?.[1] || v) : v}`)].filter(Boolean);

  return `
    ${sokText.length ? `
      <div class="px-5 pt-3 text-xs text-ads-muted">Siffrorna gäller filtret: <span class="text-ads-blue">${vkEsc(sokText.join(' · '))}</span></div>` : ''}
    <div class="px-5 py-4 grid grid-cols-2 md:grid-cols-5 gap-3">
      ${kort(_is.visaStangda ? 'Ärenden' : 'Ej stängda ärenden', s.totalt, '#3d3d3d', 'status', null)}
      ${kort('Slutförda', s.perStatus.completed || 0, '#5c8a1e', 'status', 'completed')}
      ${kort('Pågående', s.perStatus.in_progress || 0, '#2BA3DB', 'status', 'in_progress')}
      ${kort('Öppna', s.perStatus.open || 0, '#F28C0F', 'status', 'open')}
      ${kort('Förfallna', s.forfallna, '#DC2626', 'forfallen', true)}
    </div>

    <div class="px-5 grid lg:grid-cols-3 gap-3">
      <div class="bg-white border border-ads-border rounded p-4">
        <h3 class="text-sm font-semibold text-ads-text mb-2">Statusfördelning</h3>
        ${isDonutHtml(IS_STATUS_ORDNING.filter(k => s.perStatus[k]).map(k => ({
          label: isStatusLabel(k), antal: s.perStatus[k], farg: IS_STATUS[k].farg,
          onclick: `isSattFilter('status', ${isRef(k)})`, aktiv: f.status === k,
        })), s.totalt)}
      </div>
      <div class="bg-white border border-ads-border rounded p-4">
        <h3 class="text-sm font-semibold text-ads-text mb-2"><span style="color:#DC2626">Förfallna</span> / <span style="color:#3aa60f">ej förfallna</span></h3>
        ${isDonutHtml([
          { label: 'Förfallna', antal: s.forfallna, farg: '#DC2626', onclick: `isSattFilter('forfallen', ${isRef(true)})`, aktiv: f.forfallen === true },
          { label: 'Ej förfallna', antal: s.ejForfallna, farg: '#3aa60f', onclick: `isSattFilter('forfallen', ${isRef(false)})`, aktiv: f.forfallen === false },
        ].filter(x => x.antal), s.totalt)}
      </div>
      <div class="bg-white border border-ads-border rounded p-4">
        <h3 class="text-sm font-semibold text-ads-text mb-3">Status per projekt</h3>
        ${isStapelHtml(s)}
      </div>
    </div>`;
}

// Ringdiagram med klickbara segment.
function isDonutHtml(delar, totalt) {
  if (!totalt) return '<p class="text-sm text-ads-muted py-10 text-center">Inga ärenden</p>';
  const r = 60, omkrets = 2 * Math.PI * r;
  let start = 0;
  const segment = delar.map(d => {
    const langd = omkrets * d.antal / totalt;
    const s = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${d.farg}" stroke-width="${d.aktiv ? 26 : 20}"
                       stroke-dasharray="${langd} ${omkrets - langd}" stroke-dashoffset="${-start}"
                       transform="rotate(-90 80 80)" class="cursor-pointer" onclick="${d.onclick}">
                 <title>${d.label}: ${d.antal}</title></circle>`;
    start += langd;
    return s;
  }).join('');
  return `
    <div class="flex items-center gap-4">
      <svg viewBox="0 0 160 160" class="w-40 h-40 shrink-0">
        ${segment}
        <text x="80" y="88" text-anchor="middle" class="fill-current text-ads-text" style="font-size:24px;font-weight:600">${totalt}</text>
      </svg>
      <div class="space-y-1 min-w-0">
        ${delar.map(d => `
          <button onclick="${d.onclick}" class="flex items-center gap-1.5 text-xs w-full text-left ${d.aktiv ? 'font-semibold' : ''}">
            <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background:${d.farg}"></span>
            <span class="truncate">${d.label}</span>
            <span class="ml-auto font-mono text-ads-muted pl-2">${d.antal}${totalt ? ` (${Math.round(100 * d.antal / totalt)}%)` : ''}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

// Liggande staplar per projekt, uppdelade på status.
function isStapelHtml(s) {
  const rader = [...s.perProjekt.entries()]
    .map(([namn, perStatus]) => ({ namn, perStatus, totalt: Object.values(perStatus).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.totalt - a.totalt);
  if (!rader.length) return '<p class="text-sm text-ads-muted py-10 text-center">Inga ärenden</p>';
  const max = Math.max(...rader.map(r => r.totalt));
  return `
    <div class="space-y-2">
      ${rader.map(r => `
        <div>
          <button onclick="isSattFilter('projekt', ${isRef(r.namn)})"
                  class="text-[11px] truncate block max-w-full text-left ${_is.filter.projekt === r.namn ? 'font-semibold text-ads-blue' : 'text-ads-text'}">${vkEsc(r.namn)}</button>
          <div class="flex items-center gap-2">
            <div class="flex h-4 rounded overflow-hidden" style="width:${Math.max(4, 100 * r.totalt / max)}%">
              ${IS_STATUS_ORDNING.filter(k => r.perStatus[k]).map(k => `
                <div title="${isStatusLabel(k)}: ${r.perStatus[k]}" style="width:${100 * r.perStatus[k] / r.totalt}%;background:${IS_STATUS[k].farg}"></div>`).join('')}
            </div>
            <span class="text-[11px] font-mono text-ads-muted">${r.totalt}</span>
          </div>
        </div>`).join('')}
    </div>`;
}

function isTabellHtml() {
  // Kolumnerna och deras filter står i issues-kolumner.js.
  const kolumner = isSynligaKolumner();
  const vy = isVyArenden();
  const { html, fotHtml } = isRaderHtml();
  const markerbara = isMarkerbara().length;
  const markerade = _is.markerade.size;

  return `
    ${kolumner.filter(k => k.sok === 'lista').map(k => isKolumnDatalista(k, vy)).join('')}
    <table class="w-full text-sm">
      <thead class="text-[11px] text-ads-muted text-left bg-ads-gray/60">
        <tr>
          <th class="pl-3 pr-1 pt-2 pb-1 w-6">
            <input id="is-markera-alla" type="checkbox" onchange="isMarkeraAlla(this.checked)" class="accent-ads-blue"
                   ${markerade && markerade === markerbara ? 'checked' : ''} title="Markera alla ${markerbara} som syns med vy, sök och filter" /></th>
          ${kolumner.map(isKolumnRubrikHtml).join('')}
        </tr>
        <tr>
          <th></th>${kolumner.map(k => isKolumnSokHtml(k, vy)).join('')}
        </tr>
      </thead>
      <tbody id="is-tbody">${html}</tbody>
    </table>
    <div id="is-fot">${fotHtml}</div>`;
}

// Raderna och foten under tabellen. Ritas om för sig när man söker.
function isRaderHtml() {
  const alla  = isSorterade(isFiltrerade(isVyArenden()));
  const rader = alla.slice(0, _is.visaAntal);
  if (!alla.length) {
    return { html: `<tr><td colspan="${isAntalCeller()}" class="p-8 text-center text-sm text-ads-muted">Inga ärenden matchar vyn och filtren.</td></tr>`, fotHtml: '' };
  }
  // Ett värde som går att klicka på för att filtrera kolumnen på det.
  const klick = (k, varde, visas = varde) => varde
    ? `<button onclick="isFiltreraPa(_is.ref[${isRef(k)}], ${isRef(varde)})" class="text-left hover:text-ads-blue hover:underline"
               title="Filtrera på ${vkEsc(varde)}">${vkEsc(visas)}</button>`
    : '';
  const kolumner = isSynligaKolumner();

  const html = rader.map(a => {
    const ref = isRef(a);
    return `
      <tr data-id="${vkEsc(a.id)}" class="border-t border-ads-border/60 hover:bg-ads-gray/40 ${_is.markerade.has(a.id) ? 'bg-ads-blue/5' : isVantande(a) ? 'bg-amber-50/60' : ''}">
        <td class="pl-3 pr-1 py-1.5"><input type="checkbox" ${_is.markerade.has(a.id) ? 'checked' : ''} onchange="isMarkeraRad(${ref}, this.checked)" class="accent-ads-blue" /></td>
        ${kolumner.map(k => isKolumnCellHtml(k, a, ref, klick)).join('')}
      </tr>`;
  }).join('');

  const fotHtml = `
    <div class="px-3 py-2 text-center text-xs text-ads-muted">
      ${alla.length > rader.length
        ? `Visar ${rader.length} av ${alla.length}. <button onclick="isVisaFler()" class="text-ads-blue hover:underline">Visa fler</button>`
        : `${alla.length} ärende${alla.length === 1 ? '' : 'n'}`}
    </div>`;
  return { html, fotHtml };
}

// Redigeraren för vyerna. Visar vilka ärendetyper som finns, som hjälp.
function isVyRedigerareHtml() {
  const typer = new Map();
  for (const a of isAllaArenden()) {
    const t = a.subtyp && a.subtyp !== a.typ ? `${a.typ} › ${a.subtyp}` : a.typ;
    if (t) typer.set(t, (typer.get(t) || 0) + 1);
  }
  const falt = (i, namn, varde, platshallare, bredd) => `
    <input value="${vkEsc(varde || '')}" placeholder="${platshallare}" oninput="isVyFalt(${i}, '${namn}', this.value)"
           class="${bredd} px-2 py-1 text-sm border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue" />`;
  return `
    ${isDialogHuvud('Redigera vyer', 'Varje vy filtrerar på ärendetyp och/eller tilldelning. Flera värden separeras med komma, och delar av namn räcker. Tomt fält filtrerar inte.')}
    <div class="flex-1 overflow-y-auto px-5 py-3">
      <div class="grid grid-cols-[1fr_1fr_1fr_8rem_auto] gap-2 text-[10px] uppercase tracking-wider text-ads-muted mb-1">
        <span>Namn</span><span>Ärendetyp innehåller</span><span>Tilldelad innehåller</span><span>Tilldelad är</span><span></span>
      </div>
      ${_is.vyUtkast.map((v, i) => `
        <div class="grid grid-cols-[1fr_1fr_1fr_8rem_auto] gap-2 mb-2 items-center">
          ${falt(i, 'namn', v.namn, 'Namn', 'w-full')}
          ${falt(i, 'typ', v.typ, 't.ex. Onboarding', 'w-full')}
          ${falt(i, 'tilldelad', v.tilldelad, 't.ex. BIM-Koordinator', 'w-full')}
          <select onchange="isVyFalt(${i}, 'tilldeladTyp', this.value)" class="px-1 py-1 text-sm border border-ads-border rounded bg-white">
            ${[['', 'vem som helst'], ['user', 'person'], ['role', 'roll'], ['company', 'företag']].map(([k, t]) =>
              `<option value="${k}" ${(v.tilldeladTyp || '') === k ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <span class="flex gap-1 text-ads-muted">
            <button onclick="isFlyttaVy(${i}, -1)" title="Upp">▲</button><button onclick="isFlyttaVy(${i}, 1)" title="Ned">▼</button>
            <button onclick="isTaBortVy(${i})" class="hover:text-red-700 ml-1" title="Ta bort">✕</button>
          </span>
        </div>`).join('')}
      <button onclick="isNyVy()" class="text-xs text-ads-blue hover:underline mt-1">+ Ny vy</button>
      ${typer.size ? `
        <div class="mt-5 pt-3 border-t border-ads-border">
          <div class="text-[10px] uppercase tracking-wider text-ads-muted mb-1.5">Ärendetyper i de hämtade projekten</div>
          <div class="flex flex-wrap gap-1.5">
            ${[...typer.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) =>
              `<span class="text-[11px] px-2 py-0.5 rounded bg-ads-gray">${vkEsc(t)} <span class="text-ads-muted">${n}</span></span>`).join('')}
          </div>
        </div>` : ''}
    </div>
    <div class="px-5 py-3 border-t border-ads-border flex items-center gap-3">
      <button onclick="isStandardVyer()" class="text-xs text-ads-muted hover:text-ads-text">Återställ standardvyer</button>
      <p class="text-[11px] text-ads-muted flex-1">Vyerna sparas i den här webbläsaren.</p>
      <button onclick="isStangDialog()" class="text-sm text-ads-muted hover:text-ads-text px-3">Avbryt</button>
      <button onclick="isSparaVyer()" class="bg-be-charcoal hover:bg-black text-white text-sm font-medium py-2 px-4 rounded">Spara vyer</button>
    </div>`;
}
