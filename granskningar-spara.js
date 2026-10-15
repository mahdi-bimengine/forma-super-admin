// granskningar-spara.js — sparade filter och Excel-export i fliken Granskningar
// (del 3).
//
// Sparade filter delas av alla i projektet. De ligger i en JSON-fil med fast
// namn i en mapp som väljs första gången någon sparar. Filen hittas sedan igen
// med ACC:s mappsökning, var den än ligger, som Veckokontrolls inställningar.
// Ligger den på flera ställen används den senast ändrade.
//
// Filen läses om precis innan varje ändring, så att ett filter som någon annan
// sparat under tiden inte skrivs över. ACC behåller de gamla versionerna.
//
// State: _gk.sparade (filen och dess filter), _gk.valtSparat (namnet på det
// filter som är inläst), _gk.spara (panelen för att spara eller ta bort) och
// _gk.mappval (mappträdet första gången).

const GK_FILTERFIL = 'granskningar-filter.json';
const GK_FILTYP    = 'forma-console-granskningsfilter';

function gkNollstallSparade() {
  _gk.sparade    = { laddade: false, laddar: false, fel: null, itemId: null, mapp: null, dubletter: 0, lista: [] };
  _gk.valtSparat = null;
  _gk.spara      = null;
  _gk.mappval    = null;
}

// ── Filen i projektet ─────────────────────────────────────────────────────────

async function gkLasSparade() {
  const s = _gk.sparade;
  if (s.laddar) return;
  const projektId = _currentProject.id;
  s.laddar = true;
  s.fel    = null;
  gkRitaSparade();
  try {
    const fil = await gkHittaFilterfil(projektId);
    if (_currentProject?.id !== projektId) return;
    Object.assign(s, fil, { laddade: true });
  } catch (err) {
    if (_currentProject?.id !== projektId) return;
    s.fel = vkFelText(err);
  }
  s.laddar = false;
  gkRitaSparade();
}

async function gkHittaFilterfil(projektId) {
  const toppar  = await getTopFolders(_hubs[_hubIdx].id, projektId);
  const traffar = [];
  for (const topp of toppar) {
    try {
      traffar.push(...await searchFolder(projektId, topp.id, GK_FILTERFIL));
    } catch {
      // En toppmapp som inte går att söka i ska inte stoppa resten.
    }
  }
  const filer = [...new Map(traffar.map(t => [t.itemId, t])).values()]
    .sort((a, b) => String(b.andrad || '').localeCompare(String(a.andrad || '')));
  if (!filer.length) return { itemId: null, mapp: null, dubletter: 0, lista: [] };

  const itemId = filer[0].itemId;
  const [text, mapp] = await Promise.all([
    readTextFile(projektId, itemId),
    getItemParent(projektId, itemId).catch(() => null),
  ]);
  return {
    itemId,
    mapp:      mapp ? { id: mapp.id, sokvag: vkMappNamnAv(mapp) } : null,
    dubletter: filer.length - 1,
    lista:     gkTolkaFilterfil(text),
  };
}

function gkTolkaFilterfil(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${GK_FILTERFIL} i projektet går inte att läsa, innehållet är inte giltig JSON.`);
  }
  return (Array.isArray(data?.filter) ? data.filter : []).filter(f => f && f.namn && f.filter);
}

// Läser om filen, låter andra ändra listan och skriver tillbaka den som en ny
// version. mapp behövs bara när filen inte finns än.
async function gkSkrivFilterfil(andra, mapp) {
  const projektId = _currentProject.id;
  const farsk     = await gkHittaFilterfil(projektId);
  const malmapp   = farsk.itemId ? farsk.mapp : mapp;
  if (!malmapp) {
    throw new Error(farsk.itemId ? 'mappen där filen ligger gick inte att läsa' : 'ingen mapp är vald');
  }

  const lista = andra(farsk.lista).sort((a, b) => a.namn.localeCompare(b.namn, 'sv'));
  const text  = JSON.stringify({ typ: GK_FILTYP, version: 1, filter: lista }, null, 2);
  const itemId = await writeTextFile(projektId, malmapp.id, GK_FILTERFIL, text, farsk.itemId);
  if (_currentProject?.id !== projektId) return;

  Object.assign(_gk.sparade, { laddade: true, fel: null, itemId, mapp: malmapp, dubletter: farsk.dubletter, lista });
}

// ── Sparat filter till och från filen ─────────────────────────────────────────

function gkfTillSparat(n) {
  return n.typ === 'grupp'
    ? { typ: 'grupp', lage: n.lage, delar: n.delar.map(gkfTillSparat) }
    : { typ: 'villkor', falt: n.falt, op: n.op, varde: n.varde };
}

// Bygger upp ett filter ur filen med nya id:n. Okända fält hoppas över, och
// grupper djupare än ett led tas inte med, eftersom filtret inte kan visa dem.
function gkfFranSparat(n, djup = 0) {
  if (n?.typ === 'grupp') {
    const lage  = GK_LAGEN.some(([l]) => l === n.lage) ? n.lage : 'alla';
    const delar = (n.delar || [])
      .filter(d => d?.typ !== 'grupp' || djup === 0)
      .map(d => gkfFranSparat(d, djup + 1))
      .filter(Boolean);
    return gkfGrupp(lage, delar);
  }
  const f = GK_FALT[n?.falt];
  if (!f) return null;
  const op = GK_OPERATORER[f.typ].some(([o]) => o === n.op) ? n.op : GK_OPERATORER[f.typ][0][0];
  return { id: _gkfNasta++, typ: 'villkor', falt: n.falt, op, varde: String(n.varde ?? '') };
}

function gkValtFilter() {
  return _gk.sparade.lista.find(f => f.namn === _gk.valtSparat) || null;
}

function gkFilterAndrat() {
  const valt = gkValtFilter();
  return !!valt && JSON.stringify(gkfTillSparat(gkfRot())) !== JSON.stringify(gkfFranSparatRensat(valt.filter));
}

// Det sparade filtret i samma form som gkfTillSparat ger, för jämförelse.
function gkfFranSparatRensat(filter) {
  return gkfTillSparat(gkfFranSparat(filter));
}

// ── Åtgärder ──────────────────────────────────────────────────────────────────

function gkAnvandSparat(namn) {
  const f = _gk.sparade.lista.find(x => x.namn === namn);
  _gk.valtSparat = f ? namn : null;
  _gk.spara      = null;
  if (f) _gk.filter = gkfFranSparat(f.filter);
  gkfUppdatera();
}

function gkBorjaSpara() {
  _gk.spara = { steg: 'namn', namn: _gk.valtSparat || '', sparar: false };
  gkRitaSparade();
  document.getElementById('gk-spara-namn')?.focus();
}

function gkBorjaTaBort() {
  if (!_gk.valtSparat) return;
  _gk.spara = { steg: 'tabort', namn: _gk.valtSparat, sparar: false };
  gkRitaSparade();
}

function gkAvbrytSpara() {
  _gk.spara   = null;
  _gk.mappval = null;
  gkRitaSparade();
}

// Namnrutan ritas inte om medan man skriver, bara raden under den.
function gkSparaNamn(text) {
  if (!_gk.spara) return;
  _gk.spara.namn = text;
  const el = document.getElementById('gk-spara-not');
  if (el) el.innerHTML = gkSparaNot();
}

async function gkSparaFilter() {
  const p = _gk.spara;
  if (!p || p.sparar) return;
  const namn = p.namn.trim();
  if (!namn)        return vkToast('Skriv ett namn på filtret.', 'red');
  if (!gkfAktivt()) return vkToast('Filtret har inga ifyllda villkor att spara.', 'red');
  if (!_gk.sparade.itemId && !_gk.mappval?.vald) return vkToast('Välj en mapp för filen först.', 'red');

  p.sparar = true;
  gkRitaSparade();
  const post = {
    namn,
    filter:   gkfTillSparat(gkfRot()),
    sparadAv: _profile?.name || _profile?.email || '',
    sparad:   new Date().toISOString(),
  };
  try {
    await gkSkrivFilterfil(lista => [...lista.filter(f => f.namn !== namn), post], _gk.mappval?.vald);
    _gk.valtSparat = namn;
    _gk.spara      = null;
    _gk.mappval    = null;
    vkToast(`Filtret ${namn} är sparat i projektet.`);
  } catch (err) {
    p.sparar = false;
    vkToast(`Kunde inte spara: ${vkFelText(err)}`, 'red');
  }
  gkRitaSparade();
}

async function gkTaBortSparat() {
  const p = _gk.spara;
  if (!p || p.steg !== 'tabort' || p.sparar) return;
  p.sparar = true;
  gkRitaSparade();
  try {
    await gkSkrivFilterfil(lista => lista.filter(f => f.namn !== p.namn));
    _gk.valtSparat = null;
    _gk.spara      = null;
    vkToast(`Filtret ${p.namn} är borttaget.`);
  } catch (err) {
    p.sparar = false;
    vkToast(`Kunde inte ta bort: ${vkFelText(err)}`, 'red');
  }
  gkRitaSparade();
}

// ── Mappval första gången ─────────────────────────────────────────────────────

function gkMappval() {
  if (!_gk.mappval) {
    _gk.mappval = { topp: null, innehall: new Map(), oppna: new Set(), vald: null, noder: [] };
    gkLasToppmappar();
  }
  return _gk.mappval;
}

async function gkLasToppmappar() {
  const m = _gk.mappval;
  m.topp = { laddar: true };
  try {
    m.topp = { items: await getTopFolders(_hubs[_hubIdx].id, _currentProject.id) };
  } catch (err) {
    m.topp = { fel: vkFelText(err) };
  }
  gkRitaMapptrad();
}

// Mapp-id:n innehåller tecken som inte passar i en onclick, så knapparna får
// ett löpnummer som pekar hit.
function gkMappnod(id, namn, sokvag) {
  const noder = _gk.mappval.noder;
  let i = noder.findIndex(n => n.id === id);
  if (i === -1) i = noder.push({ id, namn, sokvag }) - 1;
  return i;
}

async function gkMappOppna(i) {
  const m    = _gk.mappval;
  const nod  = m?.noder[i];
  if (!nod) return;
  if (m.oppna.has(nod.id)) {
    m.oppna.delete(nod.id);
    return gkRitaMapptrad();
  }
  m.oppna.add(nod.id);
  if (!m.innehall.has(nod.id)) {
    m.innehall.set(nod.id, { laddar: true });
    gkRitaMapptrad();
    try {
      m.innehall.set(nod.id, { items: await getFolderContents(_currentProject.id, nod.id) });
    } catch (err) {
      m.innehall.set(nod.id, { fel: vkFelText(err) });
    }
  }
  gkRitaMapptrad();
}

function gkMappValj(i) {
  const m   = _gk.mappval;
  const nod = m?.noder[i];
  if (!nod) return;
  m.vald = m.vald?.id === nod.id ? null : { id: nod.id, sokvag: nod.sokvag };
  gkRitaMapptrad();
}

// ── Excel ─────────────────────────────────────────────────────────────────────

// Laddar ned de granskningar som syns i tabellen, alltså efter sökning och
// filter. Bortfiltrerade tas inte med även om de visas nedtonade. Ett andra
// blad beskriver urvalet, så att filen går att förstå i efterhand.
function gkExportera() {
  if (typeof XLSX === 'undefined') {
    return vkToast('Excel-biblioteket har inte laddats. Ladda om sidan och försök igen.', 'red');
  }
  const { aktivt, villkor, provade } = gkUrval();
  const rader = provade.filter(x => x.ok);
  if (!rader.length) return vkToast('Inga granskningar att exportera med nuvarande sökning och filter.', 'red');

  const datum = iso => iso ? new Date(iso) : null;
  const vem   = a => a.namn + (a.typ === 'roll' ? ' (roll)' : a.typ === 'foretag' ? ' (företag)' : '');

  const rubriker = ['ID', 'Granskningsnamn', 'Status', 'Arbetsflöde', 'Steg', 'Stegnamn', 'Initierad av',
    'Nästa åtgärd av', 'Godkänt av', 'Förfaller', 'Skapad', 'Slutförd', ...villkor.map(v => `Villkor ${v.bokstav}`)];
  const aoa = [rubriker, ...rader.map(({ r, traffar }) => [
    r.nr, r.namn, GK_STATUS[r.status]?.text || r.status, r.arbetsflode,
    r.stegNr ? `${r.stegNr} av ${r.stegTotalt}` : '', r.stegNamn,
    r.initieradAv, r.nastaAtgard.map(vem).join(', '), r.godkantAv,
    datum(r.forfaller), datum(r.skapad), datum(r.slutford),
    ...villkor.map(v => traffar[v.id] ? 'Ja' : 'Nej'),
  ])];

  const blad = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: 'yyyy-mm-dd' });
  blad['!cols'] = [6, 50, 11, 34, 8, 20, 22, 50, 22, 11, 11, 11, ...villkor.map(() => 10)].map(wch => ({ wch }));
  blad['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: rubriker.length - 1 } }) };

  const projekt = _currentProject?.attributes?.name || '';
  const om = [
    ['Projekt',     projekt],
    ['Exporterad',  new Date().toLocaleString('sv-SE')],
    ['Granskningar', `${rader.length} av ${_gk.rader.length}`],
    ['Sökning',     _gk.sok.trim() || '(ingen)'],
    ['Sparat filter', _gk.valtSparat ? `${_gk.valtSparat}${gkFilterAndrat() ? ' (ändrat)' : ''}` : '(inget)'],
    ['Filter',      aktivt ? gkfFormel() : '(inget, alla granskningar)'],
    ...(aktivt ? [[], ['Villkor', 'Betyder'], ...villkor.map(v => [v.bokstav, gkfBeskrivning(v)])] : []),
  ];
  const omBlad = XLSX.utils.aoa_to_sheet(om);
  omBlad['!cols'] = [{ wch: 16 }, { wch: 70 }];

  const bok = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(bok, blad, 'Granskningar');
  XLSX.utils.book_append_sheet(bok, omBlad, 'Urval');
  const filnamn = `Granskningar ${projekt} ${vkKortDatum(new Date().toISOString())}`.replace(/[\\/:*?"<>|]/g, '').trim();
  XLSX.writeFile(bok, `${filnamn}.xlsx`);
}

// ── Ritning ───────────────────────────────────────────────────────────────────

function gkRitaSparade() {
  const el = document.getElementById('gk-sparade');
  if (el) el.outerHTML = gkSparadeHtml();
}

function gkRitaMapptrad() {
  const el = document.getElementById('gk-mapptrad');
  if (el) el.outerHTML = gkMappvalHtml();
}

function gkSparadeHtml() {
  const s    = _gk.sparade;
  const ruta = 'border border-ads-border rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-ads-blue';
  const lank = 'text-xs text-ads-blue hover:text-ads-blue-dark disabled:opacity-40';
  let innehall;

  if (s.fel) {
    innehall = `
      <span class="text-xs text-red-600">De sparade filtren gick inte att läsa: ${vkEsc(s.fel)}</span>
      <button onclick="gkLasSparade()" class="${lank}">Försök igen</button>`;
  } else if (!s.laddade) {
    innehall = `<span class="text-xs text-ads-muted">Letar efter sparade filter i projektet…</span>`;
  } else {
    const valt   = gkValtFilter();
    const andrat = gkFilterAndrat();
    innehall = `
      <span class="text-ads-muted">Sparade filter</span>
      <select onchange="gkAnvandSparat(this.value)" class="${ruta} min-w-56 max-w-80">
        <option value="">${s.lista.length ? 'Välj ett sparat filter…' : 'Inga sparade filter ännu'}</option>
        ${s.lista.map(f => `<option value="${vkEsc(f.namn)}" ${f.namn === _gk.valtSparat ? 'selected' : ''}>${vkEsc(f.namn)}</option>`).join('')}
      </select>
      ${andrat ? `<span class="text-xs text-amber-600">ändrat</span>` : ''}
      <button onclick="gkBorjaSpara()" class="${lank}">${valt ? 'Spara som…' : 'Spara filtret…'}</button>
      ${valt ? `<button onclick="gkBorjaTaBort()" class="text-xs text-ads-muted hover:text-red-600">Ta bort</button>` : ''}
      <span class="ml-auto text-[11px] text-ads-muted">
        ${valt ? `Sparat av ${vkEsc(valt.sparadAv || 'okänd')}, ${vkEsc(vkKortDatum(valt.sparad))}` : ''}
        ${s.mapp ? `${valt ? ' · ' : ''}Delas via ${vkEsc(s.mapp.sokvag)} / ${GK_FILTERFIL}` : ''}
      </span>`;
  }

  return `
    <div id="gk-sparade" class="mb-3 pb-3 border-b border-ads-border">
      <div class="flex items-center gap-2 flex-wrap text-sm">${innehall}</div>
      ${s.dubletter ? `<p class="text-[11px] text-orange-700 mt-1">
        ${s.dubletter === 1 ? 'Det finns en fil till' : `Det finns ${s.dubletter} filer till`} med namnet ${GK_FILTERFIL}
        i projektet. Den senast ändrade används.</p>` : ''}
      ${gkSparaPanel()}
    </div>`;
}

function gkSparaNot() {
  const p = _gk.spara;
  if (!p) return '';
  const namn = p.namn.trim();
  if (namn && _gk.sparade.lista.some(f => f.namn === namn)) {
    return `<span class="text-amber-700">Det finns redan ett sparat filter med det namnet. Det ersätts.</span>`;
  }
  return 'Filtret sparas för alla i projektet som har läsrätt i mappen.';
}

function gkSparaPanel() {
  const p = _gk.spara;
  if (!p) return '';
  const knapp = 'text-sm rounded px-3 py-1.5 disabled:opacity-40';

  if (p.steg === 'tabort') {
    return `
      <div class="mt-2 border border-red-200 bg-red-50 rounded p-3 flex items-center gap-3 flex-wrap text-sm">
        <span>Ta bort det sparade filtret <span class="font-medium">${vkEsc(p.namn)}</span>? Det försvinner för alla i projektet.</span>
        <button onclick="gkTaBortSparat()" ${p.sparar ? 'disabled' : ''}
                class="${knapp} bg-red-600 text-white hover:bg-red-700">${p.sparar ? 'Tar bort…' : 'Ta bort'}</button>
        <button onclick="gkAvbrytSpara()" class="${knapp} border border-ads-border bg-white">Avbryt</button>
      </div>`;
  }

  return `
    <div class="mt-2 border border-ads-blue rounded p-3 bg-white space-y-2">
      <div class="flex items-center gap-2 flex-wrap">
        <label for="gk-spara-namn" class="text-sm text-ads-text">Namn</label>
        <input id="gk-spara-namn" value="${vkEsc(p.namn)}" oninput="gkSparaNamn(this.value)"
               onkeydown="if (event.key === 'Enter') gkSparaFilter()" placeholder="Försenade hos elkonsulten"
               class="border border-ads-border rounded px-2 py-1 text-sm w-72 focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
        <button onclick="gkSparaFilter()" ${p.sparar ? 'disabled' : ''}
                class="${knapp} bg-ads-blue text-white hover:bg-ads-blue-dark">${p.sparar ? 'Sparar…' : 'Spara'}</button>
        <button onclick="gkAvbrytSpara()" class="${knapp} border border-ads-border bg-white">Avbryt</button>
      </div>
      <p id="gk-spara-not" class="text-[11px] text-ads-muted">${gkSparaNot()}</p>
      ${_gk.sparade.itemId ? '' : gkMappvalHtml()}
    </div>`;
}

function gkMappvalHtml() {
  const m = gkMappval();
  let trad;
  if (!m.topp || m.topp.laddar) trad = `<p class="text-xs text-ads-muted px-3 py-3">Läser mappar…</p>`;
  else if (m.topp.fel)          trad = `<p class="text-xs text-red-600 px-3 py-3">${vkEsc(m.topp.fel)}</p>`;
  else                          trad = gkMappnoder(m.topp.items, 0, '') || `<p class="text-xs text-ads-muted px-3 py-3">Inga mappar.</p>`;

  return `
    <div id="gk-mapptrad">
      <p class="text-xs text-ads-text mb-1">
        Projektet har inga sparade filter än. Välj mappen där filen ${GK_FILTERFIL} ska ligga.
        Alla med läsrätt i mappen ser filtren, och den som ska spara behöver kunna skapa filer där.
      </p>
      <div class="border border-ads-border rounded max-h-64 overflow-auto py-1">${trad}</div>
      <p class="text-[11px] mt-1 ${m.vald ? 'text-ads-blue' : 'text-ads-muted italic'}">
        ${m.vald ? `Vald mapp: ${vkEsc(m.vald.sokvag)}` : 'Ingen mapp vald.'}</p>
    </div>`;
}

function gkMappnoder(items, djup, foralder) {
  const m = _gk.mappval;
  return (items || []).filter(it => it.type === 'folders' && !it.attributes?.hidden).map(it => {
    const namn   = vkMappNamnAv(it);
    const sokvag = foralder ? `${foralder} / ${namn}` : namn;
    const i      = gkMappnod(it.id, namn, sokvag);
    const oppen  = m.oppna.has(it.id);
    const vald   = m.vald?.id === it.id;
    const inne   = m.innehall.get(it.id);
    const under  = !oppen ? ''
      : inne?.laddar ? `<p class="text-xs text-ads-muted py-1" style="padding-left:${30 + (djup + 1) * 18}px">Läser…</p>`
      : inne?.fel    ? `<p class="text-xs text-red-600 py-1" style="padding-left:${30 + (djup + 1) * 18}px">${vkEsc(inne.fel)}</p>`
      : gkMappnoder(inne?.items, djup + 1, sokvag);

    return `
      <div class="flex items-center gap-1.5 py-1 pr-3 rounded hover:bg-ads-gray text-sm select-none"
           style="padding-left:${8 + djup * 18}px">
        <button onclick="gkMappOppna(${i})" aria-label="${oppen ? 'Fäll ihop' : 'Fäll ut'}" class="text-ads-muted p-0.5">
          <svg class="w-3.5 h-3.5 transition-transform ${oppen ? 'rotate-90' : ''}" fill="none" viewBox="0 0 20 20">
            <path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/></svg>
        </button>
        <button onclick="gkMappValj(${i})" class="flex items-center gap-2 flex-1 min-w-0 text-left">
          <span class="w-3.5 h-3.5 shrink-0 rounded-full ${vald ? 'border-4 border-ads-blue' : 'border border-ads-muted'}"></span>
          <svg class="w-4 h-4 shrink-0 text-amber-400" viewBox="0 0 20 15" fill="currentColor">
            <path d="M0 2.5A1.5 1.5 0 0 1 1.5 1h4.764a1.5 1.5 0 0 1 1.06.44l.94.94A1.5 1.5 0 0 0 9.322 3H18.5A1.5 1.5 0 0 1 20 4.5v8A1.5 1.5 0 0 1 18.5 14H1.5A1.5 1.5 0 0 1 0 12.5v-10z"/></svg>
          <span class="truncate ${vald ? 'text-ads-blue font-medium' : 'text-ads-text'}">${vkEsc(namn)}</span>
        </button>
      </div>
      ${under}`;
  }).join('');
}

gkNollstallSparade();
