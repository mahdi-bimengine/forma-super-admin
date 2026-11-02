// parameterkontroll.js — fliken Parameterkontroll: arbetsytan och modellsteget
// (del 2). Planen står i PLAN-PARAMETERKONTROLL.md.
//
// Fliken är en arbetsyta, inte en guide. De fyra stegen går alltid att nå från
// vänsterspalten och inget nollställs när man byter steg. Tre saker hålls isär:
//
//   _pk.setup   användarens val: modeller, kategorier, krav, undantag. Det som
//               sparas i ACC och det som Ångra går tillbaka i.
//   _pk.data    det som hämtats från ACC per modell, med cache per version.
//   _pk.korning den senaste körningen: en fryst kopia av valen och resultatet
//               från pkBerakna.
//
// Varje modell förbereds i bakgrunden så fort den läggs till: senaste version,
// egenskapsindex, katalog och antal element per kategori. Värdena hämtas först
// när kontrollen körs, och bara det som inte redan finns hämtat.

const PK_STEG = [
  { id: 'modeller',   namn: 'Modeller' },
  { id: 'kategorier', namn: 'Kategorier' },
  { id: 'parametrar', namn: 'Parametrar' },
  { id: 'resultat',   namn: 'Resultat' },
];
const PK_SAMTIDIGA  = 3;     // modeller som hämtas samtidigt
const PK_MAX_MAPPAR = 200;   // mappar som läses när en hel mapp kryssas
const PK_MAX_ANGRA  = 50;

let _pk = null;

function pkNyttId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function pkNyUppsattning() {
  return {
    id: pkNyttId(),
    namn: 'Ny kontroll',
    modeller: [],          // { id, namn, filtyp, kalla, mapp, disciplin, kategorier, sedda }
    modellset: null,       // { id, namn } när uppsättningen följer ett model set
    radval: [],            // kategorier valda för alla modeller, även senare tillagda
    raknaNastlade: false,
    undantag: [],
    sprak: 'sv',
    kravprofil: { id: pkNyttId(), namn: 'Kravprofil', krav: [], regler: [], tomma: [], troskel: 100, parameterfil: null },
  };
}

function pkReset() {
  _pk?.korning?.avbryt?.abort();
  _pk = {
    generation: (_pk?.generation || 0) + 1,
    steg:       'modeller',
    setup:      pkNyUppsattning(),
    data:       {},
    korning:    null,
    andrat:     false,
    angra:      [],
    utkast:     null,
    forbereder: false,
    noder:      [],          // id:n för onclick, se pkNod
    kalla: {
      typ: 'dm', filter: 'alla', sok: '',
      mappar: {},            // mapp-id → { laddar, items, fel }
      oppna: new Set(),
      laddarMapp: null,
      modellset: null,       // null | { laddar } | { lista, fel }
      msInnehall: {},        // model set-id → { laddar, modeller, fel }
      msOppna: new Set(),
    },
    ui: {},                  // stegens egna tillstånd, se respektive fil
  };
}

// Id:n innehåller tecken som inte passar i onclick, så knapparna får ett
// löpnummer som pekar hit.
function pkNod(id) {
  let i = _pk.noder.indexOf(id);
  if (i === -1) i = _pk.noder.push(id) - 1;
  return i;
}

function pkNodId(i) { return _pk.noder[i]; }

function pkEsc(s) { return vkEsc(s); }

function pkSynlig() { return !!document.getElementById('pk-rot'); }

function pkFiltyp(namn) {
  const ext = (String(namn).split('.').pop() || '').toLowerCase();
  return ext === 'rvt' || ext === 'ifc' ? ext : null;
}

function pkModellData(id) {
  return _pk.data[id] || null;
}

// ── Ändringar, ångra och utkast ───────────────────────────────────────────────
// Alla ändringar i valen går genom pkAndra, så att de kan ångras, sparas som
// utkast i webbläsaren och markera uppsättningen som osparad.

function pkAndra(beskrivning, fn, { rita = true } = {}) {
  _pk.angra.push({ beskrivning, setup: JSON.stringify(_pk.setup) });
  if (_pk.angra.length > PK_MAX_ANGRA) _pk.angra.shift();
  fn(_pk.setup);
  _pk.andrat = true;
  pkSparaUtkast();
  if (rita) pkUppdatera();
}

function pkAngra() {
  const sista = _pk.angra.pop();
  if (!sista) return;
  _pk.setup  = JSON.parse(sista.setup);
  _pk.andrat = true;
  pkSparaUtkast();
  pkForbered();
  pkUppdatera();
  vkToast(`Ångrade: ${sista.beskrivning}`);
}

function pkUtkastNyckel() {
  return `pk-utkast:${_currentProject?.id}:${_profile?.email || ''}`;
}

function pkSparaUtkast() {
  try { localStorage.setItem(pkUtkastNyckel(), JSON.stringify({ tid: new Date().toISOString(), setup: _pk.setup })); } catch {}
}

function pkLasUtkast() {
  try {
    const u = JSON.parse(localStorage.getItem(pkUtkastNyckel()) || 'null');
    return u?.setup?.modeller?.length ? u : null;
  } catch { return null; }
}

function pkAnvandUtkast(anvand) {
  const u = _pk.utkast;
  _pk.utkast = null;
  if (anvand && u) {
    _pk.setup  = { ...pkNyUppsattning(), ...u.setup };
    _pk.andrat = true;
    pkForbered();
  }
  pkUppdatera();
}

// ── Fliken ────────────────────────────────────────────────────────────────────

function pkOppnaFlik() {
  if (!_pk.setup.modeller.length && !_pk.sparatId && !_pk.utkast) _pk.utkast = pkLasUtkast();
  pkRita();
}

function pkGaTill(steg) {
  _pk.steg = steg;
  pkUppdatera();
  document.getElementById('main-content')?.scrollTo({ top: 0 });
}

function pkRita() {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `
    <div id="pk-rot" class="max-w-7xl mx-auto px-6 py-6">
      <div id="pk-topp"></div>
      <div id="pk-utkast"></div>
      <div class="flex gap-6 mt-5 items-start">
        <nav id="pk-rail" class="w-56 shrink-0 sticky top-4"></nav>
        <section id="pk-kropp" class="flex-1 min-w-0"></section>
      </div>
    </div>`;
  pkUppdatera();
}

function pkUppdatera() {
  if (!pkSynlig()) return;
  pkRitaTopp();
  pkRitaUtkast();
  pkRitaRail();
  pkRitaKropp();
}

// Uppdaterar det som visar förberedelser och körning utan att rita om
// steget, så att fokus och skrollning i sökfält och listor står kvar.
function pkRitaDelar() {
  if (!pkSynlig()) return;
  pkRitaTopp();
  pkRitaRail();
  if (_pk.steg === 'modeller') pkRitaValda();
  else if (typeof pkRitaStegDelar === 'function') pkRitaStegDelar();
}

function pkRitaKropp() {
  const el = document.getElementById('pk-kropp');
  if (!el) return;
  const rita = {
    modeller:   pkModellerHtml,
    kategorier: typeof pkKategorierHtml === 'function' ? pkKategorierHtml : null,
    parametrar: typeof pkParametrarHtml === 'function' ? pkParametrarHtml : null,
    resultat:   typeof pkResultatHtml === 'function' ? pkResultatHtml : null,
  }[_pk.steg];
  el.innerHTML = rita ? rita() : `<p class="text-sm text-ads-muted">Steget är inte byggt än.</p>`;
  if (_pk.steg === 'modeller') pkRitaKalla();
  if (_pk.steg === 'parametrar' && typeof pkEfterParametrar === 'function') pkEfterParametrar();
  if (_pk.steg === 'resultat' && typeof pkEfterResultat === 'function') pkEfterResultat();
}

// ── Toppen ────────────────────────────────────────────────────────────────────

function pkKnapp(text, onclick, { primar = false, av = false, titel = '', ikon = '' } = {}) {
  const cls = primar
    ? 'bg-ads-blue text-white border-ads-blue hover:bg-ads-blue-dark'
    : 'bg-white text-ads-text border-ads-border hover:border-ads-blue hover:text-ads-blue';
  return `<button onclick="${onclick}" ${av ? 'disabled' : ''} title="${pkEsc(titel)}"
            class="inline-flex items-center gap-1.5 text-sm border rounded px-3 py-1.5 transition-colors ${cls}
                   disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-ads-border disabled:hover:text-ads-text">${ikon}${text}</button>`;
}

// Varför kontrollen inte kan köras än, eller null.
function pkKanInteKora() {
  const s = _pk.setup;
  if (!s.modeller.length) return 'Välj minst en modell.';
  if (!s.modeller.some(m => m.kategorier.length)) return 'Välj minst en kategori.';
  if (!s.kravprofil.krav.length && !s.kravprofil.regler.length) return 'Lägg till minst en parameter.';
  return null;
}

function pkRitaTopp() {
  const el = document.getElementById('pk-topp');
  if (!el) return;
  const hinder = pkKanInteKora();
  const kor    = _pk.korning;
  const omfang = pkOmfang();
  el.innerHTML = `
    <div class="flex items-center gap-3 flex-wrap">
      <div class="flex items-center gap-2 min-w-0">
        <h2 class="text-lg font-semibold text-ads-text">Parameterkontroll</h2>
      </div>
      <input value="${pkEsc(_pk.setup.namn)}" aria-label="Kontrollens namn"
             onchange="pkAndra('Bytte namn', s => { s.namn = this.value.trim() || 'Ny kontroll'; })"
             class="text-sm border border-transparent hover:border-ads-border focus:border-ads-blue rounded px-2 py-1 min-w-0 w-64
                    focus:outline-none bg-transparent text-ads-text font-medium"/>
      <div class="ml-auto flex items-center gap-2 flex-wrap">
        ${typeof pkOppnaSparadKnapp === 'function' ? pkOppnaSparadKnapp() : ''}
        ${pkKnapp('Ångra', 'pkAngra()', { av: !_pk.angra.length, titel: _pk.angra.length ? `Ångra: ${_pk.angra.at(-1).beskrivning}` : 'Inget att ångra' })}
        ${typeof pkSparaKnapp === 'function' ? pkSparaKnapp() : ''}
        ${kor?.pagar
          ? pkKnapp('Avbryt', 'pkAvbryt()', { titel: 'Stoppa körningen' })
          : pkKnapp('Kör kontroll', 'pkKor()', { primar: true, av: !!hinder, titel: hinder || 'Kör kontrollen med senaste versionerna' })}
      </div>
    </div>
    <p class="text-xs text-ads-muted mt-1.5">${omfang}</p>`;
}

// Hur stor kontrollen blir med nuvarande val, innan något körts.
function pkOmfang() {
  const s = _pk.setup;
  if (!s.modeller.length) return 'Välj modeller, kategorier och parametrar. Inget hämtas förrän du kör kontrollen.';
  let element = 0, varden = 0, okand = false;
  const modeller = s.modeller.map(m => pkBerakningsModell(m.id, { utanVarden: true }));
  const { krav } = pkKravLista(pkBerakningsVal(), modeller.filter(Boolean));
  for (const m of s.modeller) {
    const d = pkModellData(m.id);
    if (!d?.kategoriAntal) { if (m.kategorier.length) okand = true; continue; }
    for (const kat of m.kategorier) {
      const n = d.kategoriAntal[kat]?.antal || 0;
      element += n;
      varden  += n * krav.filter(k => !k.kategorier || k.kategorier.includes(kat)).length;
    }
  }
  const delar = [
    `${s.modeller.length} ${s.modeller.length === 1 ? 'modell' : 'modeller'}`,
    `${pkTalText(element)} element`,
    `${krav.length} krav`,
  ];
  return `${delar.join(' · ')} ⇒ ${pkTalText(varden)} värden att kontrollera${okand ? ' (fler när alla modeller är förberedda)' : ''}`;
}

function pkRitaUtkast() {
  const el = document.getElementById('pk-utkast');
  if (!el) return;
  const u = _pk.utkast;
  el.innerHTML = !u ? (typeof pkOppningsHtml === 'function' ? pkOppningsHtml() : '') : `
    <div class="mt-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
      <span class="text-ads-text">Du har ett osparat utkast från ${pkEsc(new Date(u.tid).toLocaleString('sv-SE'))}
        med ${u.setup.modeller.length} modeller. Fortsätt där du slutade?</span>
      <span class="ml-auto flex gap-2">
        ${pkKnapp('Börja om', 'pkAnvandUtkast(false)')}
        ${pkKnapp('Fortsätt', 'pkAnvandUtkast(true)', { primar: true })}
      </span>
    </div>`;
}

// ── Vänsterspalten ────────────────────────────────────────────────────────────

function pkStegSammanfattning(id) {
  const s = _pk.setup;
  if (id === 'modeller') {
    if (!s.modeller.length) return { text: 'Inga valda', klar: false };
    const forbereds = s.modeller.filter(m => !['klar', 'fel'].includes(pkModellData(m.id)?.status) && !pkModellData(m.id)?.fel).length;
    const fel = s.modeller.filter(m => pkModellData(m.id)?.fel).length;
    return { text: `${s.modeller.length} valda${forbereds ? ` · ${forbereds} förbereds` : ''}${fel ? ` · ${fel} med fel` : ''}`, klar: !forbereds && !fel, varning: fel > 0 };
  }
  if (id === 'kategorier') {
    const val = s.modeller.reduce((n, m) => n + m.kategorier.length, 0);
    const med = s.modeller.filter(m => m.kategorier.length).length;
    return val ? { text: `${val} val i ${med} ${med === 1 ? 'modell' : 'modeller'}`, klar: true } : { text: 'Inga valda', klar: false };
  }
  if (id === 'parametrar') {
    const p = s.kravprofil;
    const n = p.krav.length, r = p.regler.length;
    return n || r ? { text: [n && `${n} krav`, r && `${r} ${r === 1 ? 'regel' : 'regler'}`].filter(Boolean).join(' · '), klar: true } : { text: 'Inga krav', klar: false };
  }
  const k = _pk.korning;
  if (k?.pagar) return { text: 'Körs…', klar: false };
  if (!k?.resultat) return { text: 'Inte körd', klar: false };
  const tid = new Date(k.tid).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  return pkResultatInaktuellt()
    ? { text: `Inaktuell · körd ${tid}`, klar: false, varning: true }
    : { text: `Körd ${tid}`, klar: true };
}

function pkRitaRail() {
  const el = document.getElementById('pk-rail');
  if (!el) return;
  el.innerHTML = `
    <ol class="flex flex-col gap-1">
      ${PK_STEG.map((st, i) => {
        const aktiv = _pk.steg === st.id;
        const sam   = pkStegSammanfattning(st.id);
        const ring  = aktiv ? 'bg-ads-blue text-white' : sam.varning ? 'bg-amber-100 text-amber-700' : sam.klar ? 'bg-green-100 text-green-700' : 'bg-ads-gray text-ads-muted border border-ads-border';
        return `
          <li>
            <button onclick="pkGaTill('${st.id}')" aria-current="${aktiv ? 'step' : 'false'}"
                    class="w-full flex items-start gap-2.5 text-left rounded-lg px-3 py-2.5 transition-colors
                           ${aktiv ? 'bg-white border border-ads-border shadow-sm' : 'border border-transparent hover:bg-white/70'}">
              <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${ring}">${sam.klar && !aktiv ? '✓' : i + 1}</span>
              <span class="min-w-0">
                <span class="block text-sm ${aktiv ? 'font-semibold text-ads-text' : 'text-ads-text'}">${st.namn}</span>
                <span class="block text-xs ${sam.varning ? 'text-amber-700' : 'text-ads-muted'} truncate">${pkEsc(sam.text)}</span>
              </span>
            </button>
          </li>`;
      }).join('')}
    </ol>`;
}

// ── Steg 1: Modeller ──────────────────────────────────────────────────────────

function pkModellerHtml() {
  const k = _pk.kalla;
  const flik = (typ, text) => `
    <button onclick="pkValjKalla('${typ}')"
            class="px-4 py-2.5 text-sm border-b-2 transition-colors ${k.typ === typ ? 'border-ads-blue text-ads-blue font-medium' : 'border-transparent text-ads-muted hover:text-ads-text'}">${text}</button>`;
  const chip = (f, text) => `
    <button onclick="pkFilterKalla('${f}')"
            class="px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors
                   ${k.filter === f ? 'bg-ads-blue border-ads-blue text-white' : 'bg-white border-ads-border text-ads-muted hover:border-ads-blue hover:text-ads-blue'}">${text}</button>`;
  return `
    <div class="grid grid-cols-1 xl:grid-cols-5 gap-5">
      <div class="xl:col-span-2 bg-white border border-ads-border rounded-lg overflow-hidden flex flex-col">
        <div class="flex border-b border-ads-border">${flik('dm', 'Docs')}${flik('mc', 'Model Coordination')}</div>
        <div class="flex items-center gap-2 px-3 py-2 border-b border-ads-border">
          ${chip('alla', 'Alla')}${chip('rvt', 'RVT')}${chip('ifc', 'IFC')}
          <input type="search" value="${pkEsc(k.sok)}" placeholder="Sök fil…" oninput="pkSokKalla(this.value)"
                 class="flex-1 min-w-0 px-2 py-1 text-xs border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
        </div>
        <div id="pk-kalla" class="overflow-auto" style="max-height:60vh"></div>
      </div>
      <div class="xl:col-span-3" id="pk-valda">${pkValdaHtml()}</div>
    </div>`;
}

function pkValjKalla(typ) {
  _pk.kalla.typ = typ;
  pkRitaKropp();
}

function pkFilterKalla(f) {
  _pk.kalla.filter = f;
  pkRitaKropp();
}

function pkSokKalla(q) {
  _pk.kalla.sok = q;
  pkRitaKalla();
}

function pkFiltetTillater(namn) {
  const typ = pkFiltyp(namn);
  if (!typ) return false;
  if (_pk.kalla.filter !== 'alla' && typ !== _pk.kalla.filter) return false;
  const q = _pk.kalla.sok.trim().toLocaleLowerCase('sv');
  return !q || namn.toLocaleLowerCase('sv').includes(q);
}

function pkArVald(id) {
  return _pk.setup.modeller.some(m => m.id === id);
}

function pkRitaKalla() {
  const el = document.getElementById('pk-kalla');
  if (!el) return;
  if (_pk.kalla.typ === 'dm') {
    const topp = _pk.kalla.mappar.__topp__;
    if (!topp) { pkLasMapp('__topp__'); return pkRitaKalla(); }
    if (topp.laddar) { el.innerHTML = pkLaddarHtml('Läser mappar…'); return; }
    if (topp.fel)    { el.innerHTML = `<p class="text-sm text-red-600 px-4 py-4">${pkEsc(topp.fel)}</p>`; return; }
    const html = pkMappRader(topp.items, 0, '');
    el.innerHTML = html || `<p class="text-sm text-ads-muted px-4 py-4">${_pk.kalla.sok ? 'Inga träffar bland öppnade mappar.' : 'Inga mappar.'}</p>`;
    if (_pk.kalla.sok) el.insertAdjacentHTML('afterbegin', `<p class="text-[11px] text-ads-muted px-3 pt-2">Sökningen gäller mappar som är öppnade.</p>`);
  } else {
    el.innerHTML = pkModellsetHtml();
  }
}

function pkLaddarHtml(text) {
  return `<div class="flex items-center gap-2 px-4 py-4 text-sm text-ads-muted">
    <svg class="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
    <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/></svg>${pkEsc(text)}</div>`;
}

// ── Docs: mappträd ────────────────────────────────────────────────────────────

async function pkLasMapp(id) {
  const k = _pk.kalla;
  const gen = _pk.generation;
  k.mappar[id] = { laddar: true };
  try {
    const items = id === '__topp__'
      ? await getTopFolders(_hubs[_hubIdx].id, _currentProject.id)
      : await getFolderContents(_currentProject.id, id);
    if (gen !== _pk.generation) return;
    k.mappar[id] = { items };
  } catch (err) {
    if (gen !== _pk.generation) return;
    k.mappar[id] = { fel: vkFelText(err) };
  }
  pkRitaKalla();
}

// Filerna som redan är lästa under en mapp, utan att läsa något nytt.
function pkKandaFiler(id, ut = []) {
  for (const it of _pk.kalla.mappar[id]?.items || []) {
    if (it.type === 'items' && pkFiltyp(vkMappNamnAv(it))) ut.push(it);
    if (it.type === 'folders') pkKandaFiler(it.id, ut);
  }
  return ut;
}

function pkMappRader(items, djup, sokvag) {
  const k = _pk.kalla;
  const q = k.sok.trim();
  return (items || []).filter(it => !it.attributes?.hidden).map(it => {
    const namn = vkMappNamnAv(it);
    const pad  = 10 + djup * 18;
    if (it.type === 'folders') {
      const i      = pkNod(it.id);
      const oppen  = k.oppna.has(it.id);
      const st     = k.mappar[it.id];
      const under  = oppen ? (st?.laddar ? `<div style="padding-left:${pad + 24}px">${pkLaddarHtml('Läser…')}</div>`
        : st?.fel ? `<p class="text-xs text-red-600 py-1" style="padding-left:${pad + 24}px">${pkEsc(st.fel)}</p>`
        : pkMappRader(st?.items, djup + 1, sokvag ? `${sokvag} / ${namn}` : namn)) : '';
      const kanda  = pkKandaFiler(it.id).filter(f => pkFiltetTillater(vkMappNamnAv(f)));
      if (q && !kanda.length) return '';
      const valda  = kanda.filter(f => pkArVald(f.id)).length;
      const laddar = k.laddarMapp === it.id;
      return `
        <div class="flex items-center gap-1.5 py-1 pr-3 hover:bg-ads-gray select-none" style="padding-left:${pad}px">
          <button onclick="pkMappOppna(${i})" class="p-0.5 text-ads-muted" aria-label="${oppen ? 'Fäll ihop' : 'Fäll ut'}">
            <svg class="w-3.5 h-3.5 transition-transform ${oppen ? 'rotate-90' : ''}" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/></svg>
          </button>
          <button onclick="pkMappKryssa(${i})" title="Lägg till alla RVT- och IFC-filer i mappen och dess undermappar"
                  class="w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px]
                         ${valda && valda === kanda.length ? 'bg-ads-blue border-ads-blue text-white' : valda ? 'border-ads-blue text-ads-blue' : 'border-ads-muted'}">
            ${laddar ? '…' : valda && valda === kanda.length ? '✓' : valda ? '–' : ''}</button>
          <svg class="w-4 h-4 shrink-0 text-amber-400" viewBox="0 0 20 15" fill="currentColor"><path d="M0 2.5A1.5 1.5 0 0 1 1.5 1h4.764a1.5 1.5 0 0 1 1.06.44l.94.94A1.5 1.5 0 0 0 9.322 3H18.5A1.5 1.5 0 0 1 20 4.5v8A1.5 1.5 0 0 1 18.5 14H1.5A1.5 1.5 0 0 1 0 12.5v-10z"/></svg>
          <button onclick="pkMappOppna(${i})" class="text-sm text-ads-text truncate text-left flex-1">${pkEsc(namn)}</button>
        </div>${under}`;
    }
    if (it.type === 'items' && pkFiltetTillater(namn)) {
      const i    = pkNod(it.id);
      const vald = pkArVald(it.id);
      _pk.kalla.filinfo ??= {};
      _pk.kalla.filinfo[it.id] = { namn, mapp: sokvag };
      return `
        <label class="flex items-center gap-2 py-1.5 pr-3 cursor-pointer select-none ${vald ? 'bg-blue-50' : 'hover:bg-ads-gray'}" style="padding-left:${pad + 24}px">
          <input type="checkbox" ${vald ? 'checked' : ''} onchange="pkFilKryssa(${i}, this.checked)" class="accent-ads-blue"/>
          ${pkTypBricka(pkFiltyp(namn))}
          <span class="text-sm truncate ${vald ? 'text-ads-blue font-medium' : 'text-ads-text'}">${pkEsc(namn)}</span>
        </label>`;
    }
    return '';
  }).join('');
}

function pkTypBricka(typ) {
  const cls = typ === 'ifc' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700';
  return `<span class="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${cls}">${typ}</span>`;
}

function pkMappOppna(i) {
  const id = pkNodId(i);
  const k  = _pk.kalla;
  if (k.oppna.has(id)) k.oppna.delete(id);
  else {
    k.oppna.add(id);
    if (!k.mappar[id]) pkLasMapp(id);
  }
  pkRitaKalla();
}

function pkFilKryssa(i, pa) {
  const id   = pkNodId(i);
  const info = _pk.kalla.filinfo?.[id];
  if (!info) return;
  if (pa) pkLaggTillModeller([{ id, namn: info.namn, mapp: info.mapp, kalla: 'dm' }]);
  else    pkTaBortModell(id);
}

// En kryssad mapp läser hela sitt träd först, så att inga filer i oöppnade
// undermappar faller bort, och frågar sedan.
async function pkMappKryssa(i) {
  const id  = pkNodId(i);
  const k   = _pk.kalla;
  const gen = _pk.generation;
  if (k.laddarMapp) return;
  k.laddarMapp = id;
  pkRitaKalla();

  const filer = [];
  let lasta = 0, avbrutet = false;
  const ko = [{ id, sokvag: '' }];
  try {
    while (ko.length) {
      if (lasta >= PK_MAX_MAPPAR) { avbrutet = true; break; }
      const { id: mapp, sokvag } = ko.shift();
      if (!k.mappar[mapp]?.items) k.mappar[mapp] = { items: await getFolderContents(_currentProject.id, mapp) };
      if (gen !== _pk.generation) return;
      lasta++;
      for (const it of k.mappar[mapp].items) {
        const namn = vkMappNamnAv(it);
        if (it.type === 'folders' && !it.attributes?.hidden) ko.push({ id: it.id, sokvag: sokvag ? `${sokvag} / ${namn}` : namn });
        if (it.type === 'items' && pkFiltyp(namn) && (k.filter === 'alla' || pkFiltyp(namn) === k.filter)) filer.push({ id: it.id, namn, mapp: sokvag, kalla: 'dm' });
      }
    }
  } catch (err) {
    k.laddarMapp = null;
    pkRitaKalla();
    vkToast(`Kunde inte läsa mappen: ${vkFelText(err)}`, 'red');
    return;
  }
  k.laddarMapp = null;
  pkRitaKalla();

  const nya = filer.filter(f => !pkArVald(f.id));
  const extra = avbrutet ? ` Bara de första ${PK_MAX_MAPPAR} mapparna lästes, så det kan finnas fler.` : '';
  if (!filer.length) return vkToast(`Inga ${k.filter === 'alla' ? 'RVT- eller IFC-filer' : k.filter.toUpperCase() + '-filer'} i mappen.${extra}`, 'red');
  if (!nya.length) {
    return pkDialog({
      titel: 'Alla filer i mappen är redan valda',
      text: `Ta bort de ${filer.length} modellerna från kontrollen?`,
      knappar: [{ text: 'Avbryt' }, { text: `Ta bort ${filer.length}`, primar: true, gor: () => pkAndra(`Tog bort ${filer.length} modeller`, s => { const bort = new Set(filer.map(f => f.id)); s.modeller = s.modeller.filter(m => !bort.has(m.id)); }) }],
    });
  }
  pkDialog({
    titel: `Lägg till ${nya.length} ${nya.length === 1 ? 'modell' : 'modeller'}?`,
    text: `Mappen och dess undermappar innehåller ${filer.length} ${k.filter === 'alla' ? 'RVT- och IFC-filer' : k.filter.toUpperCase() + '-filer'}, varav ${nya.length} inte är valda än.${extra}`,
    lista: nya.map(f => f.mapp ? `${f.mapp} / ${f.namn}` : f.namn),
    knappar: [{ text: 'Avbryt' }, { text: `Lägg till ${nya.length}`, primar: true, gor: () => pkLaggTillModeller(nya) }],
  });
}

// ── Model Coordination ────────────────────────────────────────────────────────

async function pkLasModellset() {
  const k = _pk.kalla, gen = _pk.generation;
  k.modellset = { laddar: true };
  try {
    const lista = await listModelSets(_currentProject.id);
    if (gen !== _pk.generation) return;
    k.modellset = { lista };
  } catch (err) {
    if (gen !== _pk.generation) return;
    k.modellset = { fel: vkFelText(err) };
  }
  pkRitaKalla();
}

// Modellerna i senaste versionen av ett model set.
async function pkModellsetModeller(id) {
  const versioner = await getModelSetVersions(_currentProject.id, id);
  if (!versioner.length) return [];
  return (await listModelSetItems(_currentProject.id, id, versioner[0].id))
    .filter(m => pkFiltyp(m.name))
    .map(m => ({ id: m.itemUrn, namn: m.name, mcVersionUrn: m.versionUrn, arSenaste: m.isTipVersion }));
}

async function pkModellsetOppna(i) {
  const id = pkNodId(i), k = _pk.kalla, gen = _pk.generation;
  if (k.msOppna.has(id)) { k.msOppna.delete(id); return pkRitaKalla(); }
  k.msOppna.add(id);
  if (!k.msInnehall[id]) {
    k.msInnehall[id] = { laddar: true };
    pkRitaKalla();
    try {
      const modeller = await pkModellsetModeller(id);
      if (gen !== _pk.generation) return;
      k.msInnehall[id] = { modeller };
    } catch (err) {
      if (gen !== _pk.generation) return;
      k.msInnehall[id] = { fel: vkFelText(err) };
    }
  }
  pkRitaKalla();
}

function pkModellsetHtml() {
  const k = _pk.kalla;
  if (!k.modellset) { pkLasModellset(); return pkLaddarHtml('Läser model sets…'); }
  if (k.modellset.laddar) return pkLaddarHtml('Läser model sets…');
  if (k.modellset.fel) return `<p class="text-sm text-red-600 px-4 py-4">${pkEsc(k.modellset.fel)}</p>`;
  if (!k.modellset.lista.length) return `<p class="text-sm text-ads-muted px-4 py-4">Projektet har inga model sets.</p>`;
  const foljer = _pk.setup.modellset?.id;
  return k.modellset.lista.map(ms => {
    const i     = pkNod(ms.id);
    const oppen = k.msOppna.has(ms.id);
    const inne  = k.msInnehall[ms.id];
    const modeller = (inne?.modeller || []).filter(m => pkFiltetTillater(m.namn));
    const nya   = modeller.filter(m => !pkArVald(m.id));
    return `
      <div class="border-b border-ads-border last:border-0">
        <div class="flex items-center gap-2 px-3 py-2 hover:bg-ads-gray">
          <button onclick="pkModellsetOppna(${i})" class="flex items-center gap-2 flex-1 min-w-0 text-left">
            <svg class="w-3.5 h-3.5 shrink-0 text-ads-muted transition-transform ${oppen ? 'rotate-90' : ''}" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/></svg>
            <span class="text-sm text-ads-text truncate">${pkEsc(ms.name || ms.id)}</span>
            ${foljer === ms.id ? `<span class="text-[10px] font-semibold bg-blue-50 text-ads-blue rounded px-1.5 py-0.5 shrink-0">följs</span>` : ''}
          </button>
        </div>
        ${!oppen ? '' : inne?.laddar ? pkLaddarHtml('Läser modeller…') : inne?.fel ? `<p class="text-xs text-red-600 px-8 py-2">${pkEsc(inne.fel)}</p>` : `
          <div class="pb-2">
            <div class="flex items-center gap-2 px-8 py-1 flex-wrap">
              ${nya.length ? `<button onclick="pkModellsetLaggTillAlla(${i})" class="text-xs text-ads-blue hover:underline">Lägg till alla ${nya.length}</button>` : `<span class="text-xs text-ads-muted">Alla är valda</span>`}
              <span class="text-ads-border">|</span>
              <button onclick="pkModellsetFolj(${i})" class="text-xs text-ads-blue hover:underline"
                      title="Uppsättningen visar nya och borttagna modeller i det här model set när den öppnas">${foljer === ms.id ? 'Sluta följa' : 'Följ model set'}</button>
            </div>
            ${modeller.map(m => {
              const j = pkNod(m.id);
              const vald = pkArVald(m.id);
              return `
                <label class="flex items-center gap-2 py-1.5 pr-3 pl-8 cursor-pointer select-none ${vald ? 'bg-blue-50' : 'hover:bg-ads-gray'}">
                  <input type="checkbox" ${vald ? 'checked' : ''} onchange="pkMcKryssa(${i}, ${j}, this.checked)" class="accent-ads-blue"/>
                  ${pkTypBricka(pkFiltyp(m.namn))}
                  <span class="text-sm truncate ${vald ? 'text-ads-blue font-medium' : 'text-ads-text'}">${pkEsc(m.namn)}</span>
                  ${m.arSenaste === false ? `<span class="text-[10px] text-amber-700 shrink-0" title="Model set har en äldre version än den senaste i Docs">äldre version i model set</span>` : ''}
                </label>`;
            }).join('') || `<p class="text-xs text-ads-muted px-8 py-1">Inga RVT- eller IFC-modeller${k.sok || k.filter !== 'alla' ? ' som matchar' : ''}.</p>`}
          </div>`}
      </div>`;
  }).join('');
}

function pkMcModell(msId, modellId) {
  const ms = _pk.kalla.modellset?.lista?.find(x => x.id === msId);
  const m  = _pk.kalla.msInnehall[msId]?.modeller?.find(x => x.id === modellId);
  return m ? { id: m.id, namn: m.namn, mapp: `Model set: ${ms?.name || ''}`, kalla: 'mc' } : null;
}

function pkMcKryssa(i, j, pa) {
  const m = pkMcModell(pkNodId(i), pkNodId(j));
  if (!m) return;
  if (pa) pkLaggTillModeller([m]);
  else    pkTaBortModell(m.id);
}

function pkModellsetLaggTillAlla(i) {
  const msId = pkNodId(i);
  const nya  = (_pk.kalla.msInnehall[msId]?.modeller || [])
    .filter(m => pkFiltetTillater(m.namn) && !pkArVald(m.id))
    .map(m => pkMcModell(msId, m.id));
  pkLaggTillModeller(nya);
}

function pkModellsetFolj(i) {
  const msId = pkNodId(i);
  const ms   = _pk.kalla.modellset?.lista?.find(x => x.id === msId);
  pkAndra(_pk.setup.modellset?.id === msId ? 'Slutade följa model set' : 'Följer model set', s => {
    s.modellset = s.modellset?.id === msId ? null : { id: msId, namn: ms?.name || '' };
  });
}

// ── Valda modeller ────────────────────────────────────────────────────────────

function pkLaggTillModeller(lista) {
  const nya = lista.filter(m => m && !pkArVald(m.id));
  if (!nya.length) return;
  pkAndra(nya.length === 1 ? `La till ${nya[0].namn}` : `La till ${nya.length} modeller`, s => {
    for (const m of nya) {
      s.modeller.push({ id: m.id, namn: m.namn, filtyp: pkFiltyp(m.namn), kalla: m.kalla, mapp: m.mapp || '', disciplin: '', kategorier: [], ny: true });
    }
  });
  pkForbered();
}

function pkTaBortModell(id) {
  const m = _pk.setup.modeller.find(x => x.id === id);
  if (!m) return;
  pkAndra(`Tog bort ${m.namn}`, s => { s.modeller = s.modeller.filter(x => x.id !== id); });
}

function pkTaBortModellNod(i) {
  pkTaBortModell(pkNodId(i));
}

function pkSattDisciplin(i, varde) {
  const id = pkNodId(i);
  pkAndra('Ändrade disciplin', s => {
    const m = s.modeller.find(x => x.id === id);
    if (m) m.disciplin = pkNyckel(varde);
  }, { rita: false });
  pkRitaTopp();
  pkRitaRail();
}

// Förslag på disciplin ur filnamnen: den position i namnet där korta koder
// skiljer sig mest mellan filerna, t.ex. K i B1-K-200-V-ZZ-001 eller PS1 i
// L1D1-MLH-PS1-500. En kod börjar med en bokstav och har högst fyra tecken.
// Rena bokstavskoder går före koder med siffror vid lika, så att ett
// versionsnummer som V11 inte vinner. Inga koder är inbyggda; det är filernas
// egen namngivning som avgör.
function pkDisciplinForslag(modeller) {
  const delar = modeller.map(m => String(m.namn).replace(/\.[^.]+$/, '').split(/[-_. ]+/));
  if (delar.length < 2) return {};
  let basta = -1, bastaPoang = 1.5;
  const langst = Math.max(...delar.map(d => d.length));
  for (let p = 0; p < langst; p++) {
    const varden = delar.map(d => d[p]);
    if (varden.some(v => !v || !/^[A-Za-zÅÄÖåäö][A-Za-zÅÄÖåäö0-9]{0,3}$/.test(v))) continue;
    const poang = new Set(varden.map(v => v.toUpperCase())).size + (varden.every(v => /^[A-Za-zÅÄÖåäö]+$/.test(v)) ? 0.5 : 0);
    if (poang > bastaPoang) { basta = p; bastaPoang = poang; }
  }
  if (basta === -1) return {};
  return Object.fromEntries(modeller.map((m, i) => [m.id, delar[i][basta].toUpperCase()]));
}

function pkAnvandDisciplinForslag() {
  const forslag = pkDisciplinForslag(_pk.setup.modeller);
  const tomma   = _pk.setup.modeller.filter(m => !m.disciplin && forslag[m.id]);
  if (!tomma.length) return vkToast('Hittade inga förslag i filnamnen. Skriv disciplinerna själv.', 'red');
  pkAndra(`Föreslog disciplin för ${tomma.length} modeller`, s => {
    for (const m of s.modeller) if (!m.disciplin && forslag[m.id]) m.disciplin = forslag[m.id];
  });
}

function pkRitaValda() {
  const el = document.getElementById('pk-valda');
  if (!el) return;
  // Ett fält med fokus ritas inte om, så att skrivandet inte avbryts.
  const fokus = document.activeElement;
  if (fokus && el.contains(fokus) && fokus.tagName === 'INPUT') {
    el.querySelectorAll('[data-pk-status]').forEach(s => { s.innerHTML = pkModellStatusHtml(s.dataset.pkStatus); });
    return;
  }
  el.innerHTML = pkValdaHtml();
}

function pkValdaHtml() {
  const s = _pk.setup;
  if (!s.modeller.length) {
    return `
      <div class="bg-white border border-dashed border-ads-border rounded-lg px-6 py-12 text-center">
        <p class="text-sm text-ads-text font-medium">Inga modeller valda</p>
        <p class="text-xs text-ads-muted mt-1">Kryssa i Revit- eller IFC-filer till vänster, en och en eller en hel mapp i taget.
          Varje modell förbereds direkt i bakgrunden.</p>
      </div>`;
  }
  const forslag   = pkDisciplinForslag(s.modeller);
  const kandaDisc = [...new Set(s.modeller.map(m => m.disciplin).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
  const namnRakning = {};
  s.modeller.forEach(m => { namnRakning[m.namn] = (namnRakning[m.namn] || 0) + 1; });
  const basnamn = m => m.namn.replace(/\.[^.]+$/, '');
  const dubbla  = new Set(s.modeller.filter(m => s.modeller.some(x => x !== m && x.filtyp !== m.filtyp && basnamn(x) === basnamn(m))).map(m => m.id));
  const harForslag = s.modeller.some(m => !m.disciplin && forslag[m.id]);

  return `
    <div class="bg-white border border-ads-border rounded-lg">
      <div class="flex items-center gap-3 px-4 py-2.5 border-b border-ads-border flex-wrap">
        <h3 class="text-sm font-semibold text-ads-text">Valda modeller (${s.modeller.length})</h3>
        ${s.modellset ? `<span class="text-xs text-ads-muted">Följer model set ${pkEsc(s.modellset.namn)}</span>` : ''}
        <span class="ml-auto flex gap-3">
          ${harForslag ? `<button onclick="pkAnvandDisciplinForslag()" class="text-xs text-ads-blue hover:underline">Föreslå discipliner ur filnamnen</button>` : ''}
          <button onclick="pkSokNyaVersioner()" class="text-xs text-ads-blue hover:underline">Sök nya versioner</button>
        </span>
      </div>
      <datalist id="pk-discipliner">${kandaDisc.map(d => `<option value="${pkEsc(d)}">`).join('')}</datalist>
      <table class="w-full text-sm">
        <thead><tr class="text-[11px] uppercase tracking-wide text-ads-muted text-left">
          <th class="px-4 py-2 font-semibold">Modell</th>
          <th class="px-2 py-2 font-semibold w-28">Version</th>
          <th class="px-2 py-2 font-semibold w-28">Disciplin</th>
          <th class="px-2 py-2 font-semibold">Status</th>
          <th class="w-8"></th>
        </tr></thead>
        <tbody>
          ${s.modeller.map(m => {
            const i = pkNod(m.id);
            const d = pkModellData(m.id);
            const v = d?.version;
            return `
              <tr class="border-t border-ads-border align-top">
                <td class="px-4 py-2">
                  <div class="flex items-center gap-2 min-w-0">${pkTypBricka(m.filtyp)}<span class="truncate text-ads-text" title="${pkEsc(m.namn)}">${pkEsc(m.namn)}</span></div>
                  ${m.mapp && (namnRakning[m.namn] > 1 || m.kalla === 'mc') ? `<p class="text-[11px] text-ads-muted truncate mt-0.5">${pkEsc(m.mapp)}</p>` : ''}
                  ${dubbla.has(m.id) ? `<p class="text-[11px] text-amber-700 mt-0.5">Samma modell finns både som RVT och IFC och räknas då två gånger i disciplinens siffror.</p>` : ''}
                </td>
                <td class="px-2 py-2 text-xs text-ads-muted whitespace-nowrap">${v ? `v${v.nummer ?? '?'}${v.datum ? ` · ${pkEsc(String(v.datum).slice(0, 10))}` : ''}` : '–'}
                  ${d?.nyareVersion ? `<button onclick="pkAnvandNyVersion(${i})" class="block text-[11px] text-amber-700 hover:underline mt-0.5">Ny version v${d.nyareVersion.nummer} – använd</button>` : ''}</td>
                <td class="px-2 py-2">
                  <input value="${pkEsc(m.disciplin)}" list="pk-discipliner" placeholder="${pkEsc(forslag[m.id] || '–')}"
                         onchange="pkSattDisciplin(${i}, this.value)" aria-label="Disciplin för ${pkEsc(m.namn)}"
                         class="w-24 px-2 py-1 text-xs border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
                </td>
                <td class="px-2 py-2" data-pk-status="${pkEsc(m.id)}">${pkModellStatusHtml(m.id)}</td>
                <td class="px-2 py-2 text-right">
                  <button onclick="pkTaBortModellNod(${i})" title="Ta bort modellen" class="text-ads-muted hover:text-red-500">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M5 5l10 10M15 5L5 15"/></svg>
                  </button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

const PK_FORBEREDELSE_TEXT = {
  version:    'Hämtar senaste version…',
  index:      'ACC bygger egenskapsindex…',
  katalog:    'Läser parametrar…',
  kategorier: 'Räknar element…',
};

function pkModellStatusHtml(id) {
  const d = pkModellData(id);
  if (!d) return `<span class="text-xs text-ads-muted">Väntar…</span>`;
  if (d.fel) {
    const i = pkNod(id);
    return `<span class="text-xs text-red-600">${pkEsc(d.fel)}</span>
      <button onclick="pkForsokIgen(${i})" class="block text-xs text-ads-blue hover:underline mt-0.5">Försök igen</button>`;
  }
  if (d.status === 'klar') {
    const n = Object.keys(d.kategoriAntal || {}).length;
    return `<span class="text-xs text-green-700">Klar · ${n} ${n === 1 ? 'kategori' : 'kategorier'}</span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 text-xs text-ads-muted">
    <svg class="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/><path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/></svg>
    ${pkEsc(PK_FORBEREDELSE_TEXT[d.status] || 'Förbereder…')}</span>`;
}

function pkForsokIgen(i) {
  delete _pk.data[pkNodId(i)];
  pkForbered();
  pkRitaDelar();
}

// ── Förberedelse i bakgrunden ─────────────────────────────────────────────────

async function pkParallellt(lista, antal, fn) {
  let nasta = 0;
  await Promise.all(Array.from({ length: Math.min(antal, lista.length) }, async () => {
    while (nasta < lista.length) await fn(lista[nasta++]);
  }));
}

function pkVersionAv(tip) {
  const a = tip?.attributes || {};
  return { nummer: a.versionNumber ?? null, datum: a.lastModifiedTime || a.createTime || null, urn: tip.id };
}

// Förbereder alla valda modeller som saknar data. Körs igen om fler modeller
// läggs till under tiden.
async function pkForbered() {
  if (_pk.forbereder) { _pk.forberedIgen = true; return; }
  _pk.forbereder = true;
  const gen = _pk.generation;
  const pid = _currentProject.id;
  const aktuell = () => gen === _pk.generation;
  try {
    do {
      _pk.forberedIgen = false;
      const nya = _pk.setup.modeller.filter(m => !_pk.data[m.id]);
      if (!nya.length) break;
      for (const m of nya) _pk.data[m.id] = { status: 'version' };
      pkRitaDelar();

      await pkParallellt(nya, PK_SAMTIDIGA, async m => {
        const d = _pk.data[m.id];
        try {
          d.version = pkVersionAv(await getItemTip(pid, m.id));
          d.status  = 'index';
        } catch (err) {
          d.fel = `Kunde inte läsa filen: ${vkFelText(err)}`;
        }
        if (aktuell()) pkRitaDelar();
      });
      if (!aktuell()) return;

      const redo = nya.filter(m => !_pk.data[m.id].fel);
      if (redo.length) {
        let index;
        try {
          index = await pkIndexera(pid, redo.map(m => _pk.data[m.id].version.urn));
        } catch (err) {
          for (const m of redo) _pk.data[m.id].fel = `ACC:s egenskapsindex svarar inte: ${vkFelText(err)}`;
        }
        if (!aktuell()) return;
        if (index) await pkParallellt(redo, PK_SAMTIDIGA, async m => {
          await pkForberedModell(pid, m, index[_pk.data[m.id].version.urn]);
          if (aktuell()) pkRitaDelar();
        });
      }
      if (!aktuell()) return;
      pkRitaDelar();
    } while (_pk.forberedIgen);
  } finally {
    if (aktuell()) _pk.forbereder = false;
  }
}

async function pkForberedModell(pid, m, index) {
  const d = _pk.data[m.id];
  if (index?.state !== 'FINISHED') {
    d.fel = index?.state === 'PROCESSING'
      ? 'ACC har inte byggt klart egenskapsindexet. Försök igen om en stund.'
      : `ACC kunde inte bygga egenskapsindex (${index?.state || 'inget svar'}). Saknar versionen 3D-data? Öppna filen i ACC en gång och försök igen.`;
    return;
  }
  try {
    d.index  = index;
    d.status = 'katalog';
    pkRitaDelar();
    d.karta  = await pkLasKatalog(index);
    if (d.karta.sort === 'okand') { d.fel = 'ACC:s data för filen är varken Revit eller IFC.'; return; }
    d.status = 'kategorier';
    pkRitaDelar();
    Object.assign(d, await pkLasKategorier(pid, index, d.karta));
    d.cache  = null;
    d.status = 'klar';
    if (typeof pkTillampaRadval === 'function') pkTillampaRadval(m.id);
  } catch (err) {
    d.fel = `Kunde inte läsa modellen: ${vkFelText(err)}`;
  }
}

// Kollar om någon modell fått en ny version sedan den förbereddes.
async function pkSokNyaVersioner() {
  const pid = _currentProject.id, gen = _pk.generation;
  let nya = 0;
  await pkParallellt(_pk.setup.modeller.filter(m => pkModellData(m.id)?.version), PK_SAMTIDIGA, async m => {
    try {
      const v = pkVersionAv(await getItemTip(pid, m.id));
      if (gen !== _pk.generation) return;
      const d = pkModellData(m.id);
      if (d && v.urn !== d.version.urn) { d.nyareVersion = v; nya++; }
    } catch {}
  });
  if (gen !== _pk.generation) return;
  pkRitaDelar();
  vkToast(nya ? `${nya} ${nya === 1 ? 'modell har' : 'modeller har'} en ny version.` : 'Alla modeller har sin senaste version.');
}

function pkAnvandNyVersion(i) {
  const id = pkNodId(i);
  delete _pk.data[id];
  pkForbered();
  pkRitaDelar();
}

// ── Dialoger ──────────────────────────────────────────────────────────────────
// Stängs med sin avbrytknapp, ett klick utanför eller Escape.

function pkDialog({ titel, text = '', lista = null, html = '', knappar = [{ text: 'OK', primar: true }], bredd = 'w-[480px]', vidStang = null }) {
  document.getElementById('pk-dialog')?.remove();
  const d = document.createElement('div');
  d.id = 'pk-dialog';
  d.className = 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4';
  d.innerHTML = `
    <div role="dialog" aria-modal="true" class="bg-white rounded-lg shadow-xl ${bredd} max-w-full flex flex-col" style="max-height:85vh">
      <div class="px-5 pt-4 pb-2"><h3 class="font-semibold text-ads-text">${pkEsc(titel)}</h3>
        ${text ? `<p class="text-sm text-ads-muted mt-1">${pkEsc(text)}</p>` : ''}</div>
      ${lista ? `<ul class="mx-5 mb-2 border border-ads-border rounded overflow-auto text-xs text-ads-text divide-y divide-ads-border" style="max-height:40vh">
        ${lista.map(l => `<li class="px-2.5 py-1.5">${pkEsc(l)}</li>`).join('')}</ul>` : ''}
      ${html ? `<div class="px-5 pb-2 overflow-auto">${html}</div>` : ''}
      <div class="px-5 py-3 flex justify-end gap-2 border-t border-ads-border mt-2">
        ${knappar.map((k, i) => `<button data-i="${i}" class="text-sm rounded px-4 py-1.5 border ${k.primar ? 'bg-ads-blue text-white border-ads-blue hover:bg-ads-blue-dark' : 'bg-white text-ads-text border-ads-border hover:border-ads-blue'}">${pkEsc(k.text)}</button>`).join('')}
      </div>
    </div>`;
  const stang = () => { d.remove(); document.removeEventListener('keydown', esc); vidStang?.(); };
  const esc = e => { if (e.key === 'Escape') stang(); };
  d.addEventListener('mousedown', e => { if (e.target === d) stang(); });
  d.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', () => {
    const k = knappar[Number(b.dataset.i)];
    if (k.gor?.(d) === false) return;
    stang();
  }));
  document.addEventListener('keydown', esc);
  document.body.appendChild(d);
  d.querySelector('button[data-i].bg-ads-blue, button[data-i]')?.focus();
  return d;
}

// ── Värden och beräkning ──────────────────────────────────────────────────────
// Värdena hämtas när kontrollen körs. Det som redan hämtats för en modell
// sparas, och bara nya kategorier och parametrar hämtas nästa gång.

function pkBerakningsVal(setup = _pk.setup) {
  const p = setup.kravprofil;
  return {
    modeller:      setup.modeller.map(m => ({ id: m.id, kategorier: m.kategorier, disciplin: m.disciplin })),
    krav:          p.krav,
    regler:        p.regler,
    undantag:      setup.undantag,
    raknaNastlade: setup.raknaNastlade,
    tomma:         p.tomma,
    troskel:       p.troskel,
  };
}

// Parametrarna som behövs för en modell: kraven, de namn i modellens katalog
// som en regel fångar och de som undantagsreglerna tittar på.
function pkBehovdaParametrar(setup, d) {
  const modell = { status: 'klar', falt: d.karta?.falt || [] };
  const { krav } = pkKravLista(pkBerakningsVal(setup), [modell]);
  const namn = new Set(krav.map(k => k.namn));
  for (const u of setup.undantag || []) if (u.typ === 'parameter' && u.parameter) namn.add(pkNyckel(u.parameter));
  return [...namn];
}

// Hämtar det som fattas för en modell och lägger det i dess cache.
async function pkSakerstallVarden(pid, m, setup, signal) {
  const d = pkModellData(m.id);
  const kategorier = m.kategorier.filter(k => d.kategoriAntal?.[k]);
  const parametrar = pkBehovdaParametrar(setup, d);
  d.cache ??= { kategorier: new Set(), parametrar: new Set(), element: new Map(), typer: {}, narvaro: {}, narvaroFor: '' };
  const c = d.cache;

  const slaIhop = ({ element, typer }) => {
    for (const el of element) {
      const fanns = c.element.get(el.id);
      if (fanns) Object.assign(fanns.varden, el.varden);
      else c.element.set(el.id, el);
    }
    for (const [id, t] of Object.entries(typer)) {
      if (c.typer[id]) Object.assign(c.typer[id].varden, t.varden);
      else c.typer[id] = t;
    }
  };

  // Nya parametrar för kategorier som redan finns i cachen.
  const nyaParam = parametrar.filter(p => !c.parametrar.has(p));
  const gamlaKat = [...c.kategorier];
  if (nyaParam.length && gamlaKat.length) {
    slaIhop(await pkLasVarden(pid, d.index, d.karta, d.raNamn, gamlaKat, nyaParam, signal));
  }
  // Nya kategorier, med alla parametrar som behövs.
  const nyaKat = kategorier.filter(k => !c.kategorier.has(k));
  const allaParam = [...new Set([...c.parametrar, ...parametrar])];
  if (nyaKat.length) {
    slaIhop(await pkLasVarden(pid, d.index, d.karta, d.raNamn, nyaKat, allaParam, signal));
  }
  nyaKat.forEach(k => c.kategorier.add(k));
  parametrar.forEach(p => c.parametrar.add(p));

  // Närvaron i ej valda kategorier beror på både kategorier och parametrar.
  const narvaroFor = JSON.stringify([[...c.kategorier].sort(), [...c.parametrar].sort()]);
  if (c.narvaroFor !== narvaroFor && c.parametrar.size) {
    c.narvaro    = await pkLasNarvaro(pid, d.index, d.karta, [...c.kategorier], [...c.parametrar], signal);
    c.narvaroFor = narvaroFor;
  }
}

// Modellen i beräkningens format. utanVarden ger bara katalog och antal, för
// omfångsräkningen innan något hämtats.
function pkBerakningsModell(id, { utanVarden = false } = {}) {
  const m = _pk.setup.modeller.find(x => x.id === id);
  const d = pkModellData(id);
  if (!m) return null;
  const bas = { id, namn: m.namn, filtyp: m.filtyp, version: d?.version || null, disciplin: m.disciplin };
  if (d?.fel) return { ...bas, status: 'fel', fel: d.fel };
  if (d?.status !== 'klar') return utanVarden ? null : { ...bas, status: 'fel', fel: 'Modellen blev inte förberedd.' };
  const c = d.cache;
  return {
    ...bas,
    status:        'klar',
    falt:          d.karta.falt,
    kategoriAntal: d.kategoriAntal,
    hamtade:       utanVarden ? [] : [...(c?.parametrar || [])],
    element:       utanVarden ? [] : [...(c?.element.values() || [])],
    typer:         utanVarden ? {} : c?.typer || {},
    narvaro:       utanVarden ? {} : c?.narvaro || {},
    uteslutna:     [],
  };
}

// ── Körning ───────────────────────────────────────────────────────────────────
// Körningen arbetar med en fryst kopia av valen, så att ändringar under tiden
// inte blandas in. Ändras något efteråt blir resultatet inaktuellt.

function pkValSignatur(setup = _pk.setup) {
  const p = setup.kravprofil;
  return JSON.stringify([setup.modeller.map(m => [m.id, m.kategorier, m.disciplin]), p.krav, p.regler, p.tomma, p.troskel, setup.undantag, setup.raknaNastlade]);
}

function pkResultatInaktuellt() {
  const k = _pk.korning;
  if (!k?.resultat) return false;
  if (k.signatur !== pkValSignatur()) return true;
  return _pk.setup.modeller.some(m => pkModellData(m.id)?.version && k.versioner[m.id] && pkModellData(m.id).version.urn !== k.versioner[m.id]);
}

async function pkKor() {
  const hinder = pkKanInteKora();
  if (hinder) return vkToast(hinder, 'red');
  _pk.korning?.avbryt?.abort();

  const gen    = _pk.generation;
  const pid    = _currentProject.id;
  const setup  = JSON.parse(JSON.stringify(_pk.setup));
  const avbryt = new AbortController();
  const korning = {
    id: pkNyttId(), pagar: true, avbryt, setup, signatur: pkValSignatur(setup),
    tid: null, resultat: null, versioner: {}, steg: {}, fel: null,
    forra: _pk.korning?.resultat ? _pk.korning : null,
  };
  _pk.korning = korning;
  pkGaTill('resultat');

  const aktuell = () => gen === _pk.generation && _pk.korning === korning;
  try {
    pkForbered();
    // Vänta tills förberedelsen av de valda modellerna är klar.
    while (setup.modeller.some(m => { const d = pkModellData(m.id); return !d || (!d.fel && d.status !== 'klar'); })) {
      await pkVanta(500, avbryt.signal);
      if (!aktuell()) return;
      if (setup.modeller.some(m => !pkModellData(m.id)) && !_pk.forbereder) pkForbered();
    }

    const medKategorier = setup.modeller.filter(m => m.kategorier.length && !pkModellData(m.id)?.fel);
    await pkParallellt(medKategorier, PK_SAMTIDIGA, async m => {
      korning.steg[m.id] = 'hamtar';
      if (aktuell()) pkRitaDelar();
      try {
        await pkSakerstallVarden(pid, m, setup, avbryt.signal);
        korning.steg[m.id] = 'klar';
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        korning.steg[m.id] = 'fel';
        pkModellData(m.id).fel = `Kunde inte hämta värden: ${vkFelText(err)}`;
      }
      if (aktuell()) pkRitaDelar();
    });
    if (!aktuell()) return;

    const modeller = setup.modeller.map(m => pkBerakningsModell(m.id)).filter(Boolean);
    for (const m of setup.modeller) korning.versioner[m.id] = pkModellData(m.id)?.version?.urn || null;
    korning.modeller = modeller;
    korning.resultat = pkBerakna(modeller, pkBerakningsVal(setup));
    korning.tid      = new Date().toISOString();

    // Vilka kategorier modellerna hade, så att nya kan märkas nästa gång.
    for (const m of _pk.setup.modeller) {
      const antal = pkModellData(m.id)?.kategoriAntal;
      if (antal) m.sedda = Object.keys(antal);
    }
    pkSparaUtkast();
  } catch (err) {
    if (err.name === 'AbortError') {
      if (_pk.korning === korning) _pk.korning = korning.forra;
      if (gen === _pk.generation && pkSynlig()) { pkUppdatera(); vkToast('Körningen avbröts.'); }
      return;
    }
    korning.fel = vkFelText(err);
  }
  if (!aktuell()) return;
  korning.pagar = false;
  if (pkSynlig()) pkUppdatera();
  else vkToast(korning.fel ? `Parameterkontrollen misslyckades: ${korning.fel}` : 'Parameterkontrollen är klar.', korning.fel ? 'red' : 'green');
}

function pkAvbryt() {
  _pk.korning?.avbryt?.abort();
}

pkReset();
