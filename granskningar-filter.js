// granskningar-filter.js — filtret i fliken Granskningar (del 2).
//
// Filtret är en grupp villkor. Varje grupp är inställd på Alla (OCH), Minst en
// (ELLER) eller Exakt en (XOR, betyder att precis ett villkor är sant, inte ett
// udda antal). Huvudgruppen kan innehålla grupper i ett led, som en parentes.
//
// Villkor som inte är ifyllda räknas inte, och en grupp utan ifyllda villkor
// räknas inte heller. Varje villkor får en bokstav i ordning, A, B, C, och
// kolumnen Träff visar vilka av dem en granskning uppfyllde.
//
// State ligger i _gk.filter (huvudgruppen) och _gk.visaBortfiltrerade.

let _gkfNasta = 1;   // id för nästa villkor eller grupp

const GK_LAGEN = [
  ['alla',    'Alla'],
  ['minstEn', 'Minst en'],
  ['exaktEn', 'Exakt en'],
];

// varden ger en lista att välja bland, text och datum ett värde att jämföra.
const GK_FALT = {
  status:      { namn: 'Status',            typ: 'lista', varden: r => [GK_STATUS[r.status]?.text || r.status] },
  arbetsflode: { namn: 'Arbetsflöde',       typ: 'lista', varden: r => r.arbetsflode ? [r.arbetsflode] : [] },
  stegNr:      { namn: 'Aktuellt steg',     typ: 'lista', varden: r => r.stegNr ? [String(r.stegNr)] : [] },
  stegTotalt:  { namn: 'Totalt antal steg', typ: 'lista', varden: r => r.stegTotalt ? [String(r.stegTotalt)] : [] },
  initieradAv: { namn: 'Initierad av',      typ: 'lista', varden: r => r.initieradAv ? [r.initieradAv] : [] },
  nastaAtgard: { namn: 'Nästa åtgärd av',   typ: 'lista', varden: r => r.nastaAlla },
  godkantAv:   { namn: 'Godkänt av',        typ: 'lista', varden: r => r.godkantAv ? [r.godkantAv] : [] },
  forfaller:   { namn: 'Förfaller',         typ: 'datum', datum: r => r.forfaller, standardOp: 'passerat' },
  skapad:      { namn: 'Skapad',            typ: 'datum', datum: r => r.skapad },
  slutford:    { namn: 'Slutförd',          typ: 'datum', datum: r => r.slutford },
  namn:        { namn: 'Namn',              typ: 'text',  text: r => r.namn },
  // Personerna att välja bland är de som kan agera eller redan har agerat i
  // ett aktuellt steg. Statusen kommer från förloppet, se gkLasForlopp.
  deltagare:   { namn: 'Aktuell stegdeltagare', typ: 'deltagare',
                 varden: r => [...(r.deltagare || []).map(d => d.namn), ...r.nastaAlla.filter(n => !/ \((roll|företag)\)$/.test(n))] },
};

const GK_OPERATORER = {
  lista: [['ar', 'är'], ['arInte', 'är inte']],
  text:  [['innehaller', 'innehåller'], ['innehallerInte', 'innehåller inte']],
  datum: [
    ['passerat', 'har passerat'],
    ['kommande', 'inom'],
    ['senaste',  'de senaste'],
    ['fore',     'före'],
    ['efter',    'efter'],
    ['saknas',   'saknas'],
  ],
  deltagare: [
    ['paborjat',   'har påbörjat'],
    ['inlamnat',   'har lämnat in'],
    ['agerat',     'har påbörjat eller lämnat in'],
    ['inteAgerat', 'har inte påbörjat eller lämnat in'],
  ],
};

function gkfGrupp(lage = 'alla', delar = []) {
  return { id: _gkfNasta++, typ: 'grupp', lage, delar };
}

function gkfVillkor(falt = 'status') {
  const v = { id: _gkfNasta++, typ: 'villkor', falt, op: '', varde: '' };
  gkfStandard(v);
  return v;
}

function gkfRot() {
  if (!_gk.filter) _gk.filter = gkfGrupp();
  return _gk.filter;
}

// Ger ett nytt eller ändrat villkor ett operator och ett värde som går att
// använda direkt, så att det räknas så fort det läggs till.
function gkfStandard(v) {
  const f = GK_FALT[v.falt];
  if (!GK_OPERATORER[f.typ].some(([op]) => op === v.op)) v.op = f.standardOp || GK_OPERATORER[f.typ][0][0];
  v.varde = gkfStandardvarde(v);
}

function gkfStandardvarde(v) {
  const f = GK_FALT[v.falt];
  if (f.typ === 'lista' || f.typ === 'deltagare') {
    const varden = gkfVarden(v.falt);
    return v.falt === 'status' && varden.includes('Öppen') ? 'Öppen' : varden[0] || '';
  }
  if (f.typ === 'datum') {
    if (v.op === 'fore' || v.op === 'efter') return vkKortDatum(new Date().toISOString());
    if (v.op === 'kommande') return '7';
    if (v.op === 'senaste')  return '30';
  }
  return '';
}

// Värdena som finns i projektets granskningar, för listan att välja i.
function gkfVarden(falt) {
  const alla = new Set();
  for (const r of _gk.rader) for (const v of GK_FALT[falt].varden(r)) if (v) alla.add(v);
  return [...alla].sort((a, b) => a.localeCompare(b, 'sv', { numeric: true }));
}

function gkfHitta(id, n = gkfRot()) {
  if (n.id === id) return n;
  if (n.typ === 'grupp') for (const d of n.delar) { const x = gkfHitta(id, d); if (x) return x; }
  return null;
}

function gkfForalder(id, g = gkfRot()) {
  if (g.delar.some(d => d.id === id)) return g;
  for (const d of g.delar) if (d.typ === 'grupp') { const x = gkfForalder(id, d); if (x) return x; }
  return null;
}

// Alla villkor i den ordning de står, med bokstäverna satta.
function gkfVillkorslista() {
  const lista = [];
  const ga = n => {
    if (n.typ === 'grupp') return n.delar.forEach(ga);
    const i = lista.length;
    n.bokstav = String.fromCharCode(65 + i % 26) + (i >= 26 ? Math.floor(i / 26) : '');
    lista.push(n);
  };
  ga(gkfRot());
  return lista;
}

// ── Utvärdering ───────────────────────────────────────────────────────────────

function gkfKomplett(v) {
  if (GK_FALT[v.falt].typ === 'datum') {
    if (v.op === 'passerat' || v.op === 'saknas') return true;
    if (v.op === 'fore' || v.op === 'efter')     return /^\d{4}-\d{2}-\d{2}$/.test(v.varde);
    return Number(v.varde) > 0;
  }
  // Ett villkor på stegdeltagare räknas först när förloppet är inläst.
  if (GK_FALT[v.falt].typ === 'deltagare' && !_gk.forlopp.laddat) return false;
  return String(v.varde ?? '').trim() !== '';
}

function gkfBehoverForlopp() {
  return gkfVillkorslista().some(v => GK_FALT[v.falt].typ === 'deltagare');
}

function gkfAktivt() {
  return gkfVillkorslista().some(gkfKomplett);
}

function gkfTestaVillkor(v, r) {
  const f = GK_FALT[v.falt];
  if (f.typ === 'datum') return gkfTestaDatum(v, f.datum(r));
  if (f.typ === 'text') {
    const finns = f.text(r).toLowerCase().includes(v.varde.trim().toLowerCase());
    return v.op === 'innehaller' ? finns : !finns;
  }
  if (f.typ === 'deltagare') {
    // Gäller bara pågående granskningar vars förlopp gick att läsa.
    if (r.status !== 'OPEN' || !r.deltagare) return false;
    const status = r.deltagare.find(d => d.namn === v.varde)?.status;
    if (v.op === 'paborjat') return status === 'paborjat';
    if (v.op === 'inlamnat') return status === 'inlamnat';
    if (v.op === 'agerat')   return !!status;
    return !status;
  }
  const finns = f.varden(r).includes(v.varde);
  return v.op === 'ar' ? finns : !finns;
}

function gkfTestaDatum(v, iso) {
  if (v.op === 'saknas') return !iso;
  if (!iso) return false;
  const t   = new Date(iso).getTime();
  const nu  = Date.now();
  const dag = 864e5;
  if (v.op === 'passerat') return t < nu;
  if (v.op === 'kommande') return t >= nu && t <= nu + Number(v.varde) * dag;
  if (v.op === 'senaste')  return t <= nu && t >= nu - Number(v.varde) * dag;
  const d = vkKortDatum(iso);   // åååå-mm-dd, går att jämföra som text
  return v.op === 'fore' ? d < v.varde : d > v.varde;
}

// ok är om granskningen ska visas, traffar vilka ifyllda villkor den uppfyllde.
function gkfUtvardera(r) {
  const traffar = {};
  const ga = n => {
    if (n.typ === 'villkor') {
      if (!gkfKomplett(n)) return null;
      return (traffar[n.id] = gkfTestaVillkor(n, r));
    }
    const svar = n.delar.map(ga).filter(x => x !== null);
    if (!svar.length) return null;
    const sanna = svar.filter(Boolean).length;
    if (n.lage === 'alla')    return sanna === svar.length;
    if (n.lage === 'minstEn') return sanna > 0;
    return sanna === 1;
  };
  return { ok: ga(gkfRot()) !== false, traffar };
}

// Ett villkor i ord, till exempel "Förfaller inom 7 dagar".
function gkfBeskrivning(v) {
  const f  = GK_FALT[v.falt];
  const op = (GK_OPERATORER[f.typ].find(([o]) => o === v.op) || [null, v.op])[1];
  if (v.op === 'kommande') return `${f.namn} inom ${v.varde} dagar`;
  if (v.op === 'senaste')  return `${f.namn} de senaste ${v.varde} dagarna`;
  if (v.op === 'passerat' || v.op === 'saknas') return `${f.namn} ${op}`;
  if (f.typ === 'deltagare') return `${v.varde} ${op} i aktuellt steg`;
  return `${f.namn} ${op} ${v.varde}`;
}

// Filtret som en rad text, till exempel "A och exakt en av (B, C)".
function gkfFormel(g = gkfRot(), yttersta = true) {
  const delar = g.delar
    .map(d => d.typ === 'villkor' ? (gkfKomplett(d) ? d.bokstav : null) : gkfFormel(d, false))
    .filter(Boolean);
  if (!delar.length) return yttersta ? '' : null;
  if (delar.length === 1) return delar[0];
  const text = g.lage === 'alla'    ? delar.join(' och ')
             : g.lage === 'minstEn' ? delar.join(' eller ')
             : `exakt en av ${delar.join(', ')}`;
  return yttersta ? text : `(${text})`;
}

// ── Ändringar ─────────────────────────────────────────────────────────────────

function gkfVaxla() {
  _gk.filterOppet = !_gk.filterOppet;
  // De sparade filtren letas fram först när någon öppnar filtret.
  if (_gk.filterOppet && !_gk.sparade.laddade && !_gk.sparade.fel) gkLasSparade();
  gkfUppdatera();
}

function gkfSattLage(gruppId, lage) {
  const g = gkfHitta(gruppId);
  if (g) g.lage = lage;
  gkfUppdatera();
}

function gkfNyttVillkor(gruppId) {
  gkfHitta(gruppId)?.delar.push(gkfVillkor());
  gkfUppdatera();
}

function gkfNyGrupp() {
  gkfRot().delar.push(gkfGrupp('minstEn', [gkfVillkor(), gkfVillkor('nastaAtgard')]));
  gkfUppdatera();
}

function gkfTaBort(id) {
  const g = gkfForalder(id);
  if (g) g.delar = g.delar.filter(d => d.id !== id);
  gkfUppdatera();
}

function gkfRensa() {
  _gk.filter = gkfGrupp();
  gkfUppdatera();
}

function gkfAndra(id, nyckel, varde) {
  const v = gkfHitta(id);
  if (!v) return;
  const forut = gkfVardetyp(v.op);
  v[nyckel] = varde;
  if (nyckel === 'falt') { v.op = ''; gkfStandard(v); }
  // Värdet behålls när operatorn byts, utom när det ska fyllas i på annat sätt,
  // som från ett datum till ett antal dagar.
  if (nyckel === 'op' && gkfVardetyp(v.op) !== forut) v.varde = gkfStandardvarde(v);
  gkfUppdatera();
}

function gkfVardetyp(op) {
  if (op === 'fore' || op === 'efter')        return 'datum';
  if (op === 'kommande' || op === 'senaste')  return 'dagar';
  if (op === 'passerat' || op === 'saknas')   return 'inget';
  return 'samma';
}

// För text- och sifferrutor: bara tabellen och bokstaven ritas om, så att
// rutan behåller markören medan man skriver.
function gkfSkriv(id, varde) {
  const v = gkfHitta(id);
  if (!v) return;
  v.varde = varde;
  const el = document.getElementById(`gkf-bokstav-${id}`);
  if (el) el.outerHTML = gkfBokstavHtml(v);
  gkfRitaFormel();
  gkfRitaKnapp();
  gkRitaSparade();
  gkRitaTabell();
}

function gkfVisaBortfiltrerade(pa) {
  _gk.visaBortfiltrerade = pa;
  _gk.sida = 0;
  gkRitaTabell();
}

// ── Ritning ───────────────────────────────────────────────────────────────────

function gkfUppdatera() {
  const el = document.getElementById('gk-filter');
  if (el) el.innerHTML = gkfKort();
  gkfRitaKnapp();
  _gk.sida = 0;
  gkRitaTabell();
  // Ett nytt eller inläst villkor på stegdeltagare sätter igång läsningen.
  const f = _gk.forlopp;
  if (_gk.laddad && !f.laddat && !f.laddar && gkfBehoverForlopp()) gkLasForlopp();
}

function gkfForloppText() {
  const f = _gk.forlopp;
  return f.laddar ? `Läser vem som påbörjat och lämnat in… ${f.hamtade} av ${f.totalt}` : '';
}

function gkfRitaForlopp() {
  document.querySelectorAll('.gkf-forlopp').forEach(el => { el.textContent = gkfForloppText(); });
}

function gkfRitaKnapp() {
  const el = document.getElementById('gk-filterknapp');
  if (el) el.outerHTML = gkfKnapp();
}

function gkfRitaFormel() {
  const el = document.getElementById('gkf-formel');
  if (el) el.outerHTML = gkfFormelHtml();
}

function gkfKnapp() {
  const antal = gkfVillkorslista().filter(gkfKomplett).length;
  return `
    <button id="gk-filterknapp" onclick="gkfVaxla()"
            class="inline-flex items-center gap-1.5 text-sm border rounded px-3 py-1.5 transition-colors
                   ${_gk.filterOppet || antal ? 'border-ads-blue text-ads-blue bg-white' : 'border-ads-border text-ads-text bg-white hover:border-ads-blue'}">
      <svg class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 4h14l-5.5 6.5V16l-3 1.5v-7L3 4z"/></svg>
      Filter${antal ? ` <span class="bg-ads-blue text-white rounded-full text-[10px] leading-none px-1.5 py-0.5">${antal}</span>` : ''}
    </button>`;
}

function gkfKort() {
  if (!_gk.filterOppet) return '';
  const rot = gkfRot();
  gkfVillkorslista();   // sätter bokstäverna

  return `
    <div class="bg-white border border-ads-border rounded p-4 mb-3">
      ${gkSparadeHtml()}
      ${gkfGruppHtml(rot, 0)}
      ${!rot.delar.length ? `<p class="text-xs text-ads-muted mt-2">Inga villkor ännu. Lägg till ett villkor för att filtrera listan.</p>` : ''}
      ${_gk.forlopp.misslyckade ? `<p class="text-xs text-amber-700 mt-2">
        Förloppet gick inte att läsa för ${_gk.forlopp.misslyckade} granskning${_gk.forlopp.misslyckade === 1 ? '' : 'ar'}.
        ${_gk.forlopp.misslyckade === 1 ? 'Den uppfyller' : 'De uppfyller'} inga villkor om stegdeltagare.</p>` : ''}
      <div class="flex items-center gap-4 mt-3 pt-3 border-t border-ads-border text-xs text-ads-muted flex-wrap">
        ${gkfFormelHtml()}
        <label class="ml-auto flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" ${_gk.visaBortfiltrerade ? 'checked' : ''} onchange="gkfVisaBortfiltrerade(this.checked)"
                 class="w-3.5 h-3.5 accent-ads-blue"/>
          Visa bortfiltrerade
        </label>
        ${rot.delar.length ? `<button onclick="gkfRensa()" class="hover:text-ads-text">Rensa filter</button>` : ''}
      </div>
    </div>`;
}

function gkfFormelHtml() {
  const formel = gkfFormel();
  return `<span id="gkf-formel">${formel ? `Villkor: <span class="text-ads-text font-medium">${vkEsc(formel)}</span>` : 'Inget filter, alla granskningar visas'}</span>`;
}

function gkfGruppHtml(g, djup) {
  const knappar = GK_LAGEN.map(([lage, text]) => `
    <button onclick="gkfSattLage(${g.id}, '${lage}')"
            class="px-3 py-1 text-xs border-l first:border-l-0 border-ads-border transition-colors
                   ${g.lage === lage ? 'bg-ads-blue text-white' : 'bg-white text-ads-muted hover:text-ads-text'}">${text}</button>`).join('');
  const lagg = `text-xs text-ads-blue hover:text-ads-blue-dark inline-flex items-center gap-1`;

  return `
    <div class="${djup ? 'ml-8 border border-ads-border rounded p-3 bg-ads-gray/40' : ''} space-y-2">
      <div class="flex items-center gap-2 text-sm text-ads-muted">
        ${djup ? 'Grupp som uppfyller' : 'Visa granskningar som uppfyller'}
        <span class="inline-flex border border-ads-border rounded overflow-hidden">${knappar}</span>
        ${djup ? `<button onclick="gkfTaBort(${g.id})" title="Ta bort gruppen"
                   class="ml-auto text-ads-muted hover:text-red-600 px-1">✕</button>` : ''}
      </div>
      ${g.delar.map(d => d.typ === 'villkor' ? gkfVillkorHtml(d) : gkfGruppHtml(d, djup + 1)).join('')}
      <div class="flex items-center gap-4 pt-1">
        <button onclick="gkfNyttVillkor(${g.id})" class="${lagg}">+ Villkor</button>
        ${djup ? '' : `<button onclick="gkfNyGrupp()" class="${lagg}">+ Grupp</button>`}
      </div>
    </div>`;
}

function gkfBokstavHtml(v) {
  const klar = gkfKomplett(v);
  return `
    <span id="gkf-bokstav-${v.id}" title="${klar ? '' : GK_FALT[v.falt].typ === 'deltagare' && !_gk.forlopp.laddat ? 'Räknas när förloppet är läst' : 'Inte ifyllt, räknas inte'}"
          class="w-6 h-6 shrink-0 rounded-full inline-flex items-center justify-center text-[11px] font-semibold
                 ${klar ? 'bg-ads-blue/10 text-ads-blue' : 'border border-dashed border-ads-border text-ads-muted'}">${v.bokstav}</span>`;
}

function gkfVillkorHtml(v) {
  const f     = GK_FALT[v.falt];
  const ruta  = 'border border-ads-border rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-ads-blue';
  const val   = (lista, vald) => lista.map(([k, text]) =>
    `<option value="${vkEsc(k)}" ${k === vald ? 'selected' : ''}>${vkEsc(text)}</option>`).join('');

  const operator = `
      <select onchange="gkfAndra(${v.id}, 'op', this.value)" class="${ruta} ${f.typ === 'deltagare' ? 'w-60' : 'w-36'}">
        ${val(GK_OPERATORER[f.typ], v.op)}
      </select>`;
  // Stegdeltagare läses "Adrian har påbörjat", så personen står före.
  const deltagare = f.typ === 'deltagare';

  return `
    <div class="flex items-center gap-2 flex-wrap">
      ${gkfBokstavHtml(v)}
      <select onchange="gkfAndra(${v.id}, 'falt', this.value)" class="${ruta} w-44">
        ${val(Object.entries(GK_FALT).map(([k, d]) => [k, d.namn]), v.falt)}
      </select>
      ${deltagare ? '' : operator}
      ${gkfVardeHtml(v, ruta)}
      ${deltagare ? operator : ''}
      ${deltagare && _gk.forlopp.laddar ? `<span class="gkf-forlopp text-xs text-ads-muted">${gkfForloppText()}</span>` : ''}
      <button onclick="gkfTaBort(${v.id})" title="Ta bort villkoret"
              class="text-ads-muted hover:text-red-600 px-1">✕</button>
    </div>`;
}

function gkfVardeHtml(v, ruta) {
  const f = GK_FALT[v.falt];
  if (f.typ === 'text') {
    return `<input value="${vkEsc(v.varde)}" oninput="gkfSkriv(${v.id}, this.value)" placeholder="Text i namnet"
                   class="${ruta} w-64"/>`;
  }
  if (f.typ === 'datum') {
    if (v.op === 'fore' || v.op === 'efter') {
      return `<input type="date" value="${vkEsc(v.varde)}" onchange="gkfSkriv(${v.id}, this.value)" class="${ruta}"/>`;
    }
    if (v.op === 'kommande' || v.op === 'senaste') {
      return `<input type="number" min="1" step="1" value="${vkEsc(v.varde)}" oninput="gkfSkriv(${v.id}, this.value)"
                     class="${ruta} w-20"/>
              <span class="text-sm text-ads-muted">${v.op === 'kommande' ? 'dagar' : 'dagarna'}</span>`;
    }
    return '';
  }

  // Ett sparat värde som inte längre finns i projektet ska ändå synas.
  const varden = gkfVarden(v.falt);
  if (v.varde && !varden.includes(v.varde)) varden.unshift(v.varde);
  if (!varden.length) return `<span class="text-sm text-ads-muted italic">Inga värden i projektet</span>`;
  return `
    <select onchange="gkfAndra(${v.id}, 'varde', this.value)" class="${ruta} min-w-48 max-w-80">
      ${varden.map(x => `<option value="${vkEsc(x)}" ${x === v.varde ? 'selected' : ''}>${vkEsc(x)}</option>`).join('')}
    </select>`;
}

function gkfTraffHtml(villkor, traffar) {
  return villkor.map(v => `
    <span title="${traffar[v.id] ? 'Uppfyller' : 'Uppfyller inte'} ${v.bokstav}: ${vkEsc(gkfBeskrivning(v))}"
          class="w-5 h-5 inline-flex items-center justify-center rounded-full text-[10px] font-semibold mr-0.5
                 ${traffar[v.id] ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}">${v.bokstav}</span>`).join('');
}
