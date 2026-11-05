// parameterkontroll-spara.js — sparade uppsättningar och kravprofiler i ACC
// (del 3).
//
// Allt sparas i projektet, i parameterkontroll.json i en mapp som väljs första
// gången någon sparar. Filen hittas sedan med ACC:s mappsökning var den än
// ligger, som Granskningars sparade filter. Ligger den på flera ställen används
// den senast ändrade och de övriga rapporteras.
//
// Filen läses om precis innan varje ändring, så att det någon annan sparat
// under tiden står kvar. Har någon annan sparat samma uppsättning sedan den
// öppnades får användaren välja: skriva över eller spara som kopia.

const PK_FIL    = 'parameterkontroll.json';
const PK_FILTYP = 'forma-console-parameterkontroll';

function pkLagring() {
  _pk.lagring ??= { laddad: false, laddar: null, itemId: null, mapp: null, dubletter: 0, data: { uppsattningar: [], kravprofiler: [] } };
  return _pk.lagring;
}

function pkTolkaFil(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`${PK_FIL} i projektet går inte att läsa, innehållet är inte giltig JSON.`); }
  return {
    uppsattningar: (Array.isArray(data?.uppsattningar) ? data.uppsattningar : []).filter(u => u?.id && Array.isArray(u.modeller)),
    kravprofiler:  (Array.isArray(data?.kravprofiler) ? data.kravprofiler : []).filter(k => k?.id && Array.isArray(k.krav)),
  };
}

async function pkHittaFil(projektId) {
  const toppar  = await getTopFolders(_hubs[_hubIdx].id, projektId);
  const traffar = [];
  for (const topp of toppar) {
    try { traffar.push(...await searchFolder(projektId, topp.id, PK_FIL)); }
    catch { /* en toppmapp som inte går att söka i ska inte stoppa resten */ }
  }
  const filer = [...new Map(traffar.map(t => [t.itemId, t])).values()]
    .sort((a, b) => String(b.andrad || '').localeCompare(String(a.andrad || '')));
  if (!filer.length) return { itemId: null, mapp: null, dubletter: 0, data: { uppsattningar: [], kravprofiler: [] } };

  const itemId = filer[0].itemId;
  const [text, mapp] = await Promise.all([readTextFile(projektId, itemId), getItemParent(projektId, itemId).catch(() => null)]);
  return { itemId, mapp: mapp ? { id: mapp.id, sokvag: vkMappNamnAv(mapp) } : null, dubletter: filer.length - 1, data: pkTolkaFil(text) };
}

// ACC:s sökning hittar en nyskapad fil först efter 10–20 sekunder (prövat i
// R&D BIM ENGINE). Vet vi redan var filen ligger läses den då direkt, så att
// en andra sparning strax efter den första inte tappar bort filen.
async function pkFarskFil(projektId) {
  const f = await pkHittaFil(projektId);
  const l = pkLagring();
  if (f.itemId || !l.itemId) return f;
  return { itemId: l.itemId, mapp: l.mapp, dubletter: l.dubletter, data: pkTolkaFil(await readTextFile(projektId, l.itemId)) };
}

// Läser filen en gång per projektbesök. Flera anrop samtidigt väntar på samma läsning.
async function pkLasLagring() {
  const l = pkLagring();
  if (l.laddad) return l;
  const projektId = _currentProject.id;
  l.laddar ??= pkHittaFil(projektId).then(fil => {
    if (_currentProject?.id === projektId) Object.assign(l, fil, { laddad: true });
  }).finally(() => { l.laddar = null; });
  await l.laddar;
  return l;
}

// Läser om filen, låter andra ändra innehållet och skriver tillbaka det som en
// ny version. mapp behövs bara när filen inte finns än.
async function pkSkrivFil(andra, mapp) {
  const projektId = _currentProject.id;
  const farsk     = await pkFarskFil(projektId);
  const malmapp   = farsk.itemId ? farsk.mapp : mapp;
  if (!malmapp) throw new Error(farsk.itemId ? 'mappen där filen ligger gick inte att läsa' : 'ingen mapp är vald');

  const data   = andra(farsk.data);
  data.uppsattningar.sort((a, b) => a.namn.localeCompare(b.namn, 'sv'));
  data.kravprofiler.sort((a, b) => a.namn.localeCompare(b.namn, 'sv'));
  const text   = JSON.stringify({ typ: PK_FILTYP, version: 1, ...data }, null, 2);
  const itemId = await writeTextFile(projektId, malmapp.id, PK_FIL, text, farsk.itemId);
  if (_currentProject?.id !== projektId) return null;
  Object.assign(pkLagring(), { laddad: true, itemId, mapp: malmapp, dubletter: farsk.dubletter, data });
  return data;
}

function pkSparadAv() {
  return { sparadAv: _profile?.name || _profile?.email || '', sparadAvEpost: _profile?.email || '', sparad: new Date().toISOString() };
}

// ── Spara ─────────────────────────────────────────────────────────────────────

function pkSparaKnapp() {
  const andrat = _pk.andrat && _pk.setup.modeller.length;
  return pkKnapp(`Spara${andrat ? ' <span class="w-1.5 h-1.5 rounded-full bg-ads-blue inline-block" aria-label="osparade ändringar"></span>' : ''}`, 'pkSpara()', {
    av: !_pk.setup.modeller.length || _pk.sparar,
    titel: _pk.sparar ? 'Sparar…' : andrat ? 'Spara ändringarna i projektet' : 'Spara uppsättningen i projektet',
  });
}

async function pkSpara(somKopia = false) {
  if (_pk.sparar) return;
  _pk.sparar = true;
  pkRitaTopp();
  try {
    const l = await pkLasLagring();
    let mapp = null;
    if (!l.itemId) {
      mapp = await pkValjMapp(`Var ska ${PK_FIL} sparas?`,
        'Projektet har inga sparade parameterkontroller än. Välj en mapp. Alla med läsrätt i mappen ser kontrollerna, och den som sparar behöver kunna skapa filer där.');
      if (!mapp) return;
    }

    // Har någon annan sparat samma uppsättning sedan den öppnades?
    const farsk = await pkFarskFil(_currentProject.id);
    const deras = farsk.data.uppsattningar.find(u => u.id === _pk.setup.id);
    if (!somKopia && deras && _pk.sparadTid && deras.sparad !== _pk.sparadTid) {
      _pk.sparar = false;
      pkRitaTopp();
      return pkDialog({
        titel: 'Någon annan har sparat den här kontrollen',
        text: `${deras.sparadAv || 'Någon'} sparade ${new Date(deras.sparad).toLocaleString('sv-SE')}, efter att du öppnade den. Dina ändringar kan skriva över deras.`,
        knappar: [
          { text: 'Avbryt' },
          { text: 'Spara som kopia', gor: () => { pkSpara(true); } },
          { text: 'Skriv över', primar: true, gor: () => { _pk.sparadTid = deras.sparad; pkSpara(); } },
        ],
      });
    }

    if (somKopia) {
      _pk.setup.id   = pkNyttId();
      _pk.setup.namn = `${_pk.setup.namn} (kopia)`;
    }
    const post = { ...JSON.parse(JSON.stringify(_pk.setup)), ...pkSparadAv() };
    for (const m of post.modeller) delete m.ny;
    const data = await pkSkrivFil(d => ({ ...d, uppsattningar: [...d.uppsattningar.filter(u => u.id !== post.id), post] }), mapp);
    if (!data) return;
    _pk.sparatId  = post.id;
    _pk.sparadTid = post.sparad;
    _pk.andrat    = false;
    vkToast(`Sparat i projektet: ${pkLagring().mapp?.sokvag || ''} / ${PK_FIL}`);
  } catch (err) {
    vkToast(`Kunde inte spara: ${vkFelText(err)}`, 'red');
  } finally {
    _pk.sparar = false;
    if (pkSynlig()) { pkRitaTopp(); pkRitaUtkast(); }
  }
}

// ── Öppna ─────────────────────────────────────────────────────────────────────

function pkOppnaSparadKnapp() {
  return pkKnapp('Öppna sparad', 'pkOppnaSparade()', { titel: 'Öppna en kontroll som sparats i projektet' });
}

async function pkOppnaSparade() {
  const d = pkDialog({ titel: 'Sparade kontroller', html: `<div id="pk-sparade">${pkLaddarHtml('Söker i projektet…')}</div>`, knappar: [{ text: 'Stäng' }], bredd: 'w-[640px]' });
  try {
    const l = await pkLasLagring();
    if (!document.body.contains(d)) return;
    pkRitaSparadeLista(l);
  } catch (err) {
    const el = document.getElementById('pk-sparade');
    if (el) el.innerHTML = `<p class="text-sm text-red-600">Kunde inte läsa ${PK_FIL}: ${pkEsc(vkFelText(err))}</p>`;
  }
}

function pkRitaSparadeLista(l) {
  const el = document.getElementById('pk-sparade');
  if (!el) return;
  const lista = l.data.uppsattningar;
  el.innerHTML = `
    ${l.mapp ? `<p class="text-xs text-ads-muted mb-2">Sparas i ${pkEsc(l.mapp.sokvag)} / ${PK_FIL}${l.dubletter ? ` · filen finns på ${l.dubletter} ställen till, den senast ändrade används` : ''}</p>` : ''}
    ${lista.length ? `<ul class="border border-ads-border rounded divide-y divide-ads-border">${lista.map(u => `
      <li class="px-3 py-2.5 flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-ads-text truncate">${pkEsc(u.namn)}${u.id === _pk.sparatId ? ' <span class="text-xs text-ads-blue font-normal">öppen</span>' : ''}</p>
          <p class="text-xs text-ads-muted">${u.modeller.length} modeller · ${(u.kravprofil?.krav?.length || 0)} krav · sparad ${pkEsc(new Date(u.sparad).toLocaleString('sv-SE'))}${u.sparadAv ? ` av ${pkEsc(u.sparadAv)}` : ''}</p>
        </div>
        <button onclick="pkOppnaUppsattning('${pkNod(u.id)}')" class="text-sm text-ads-blue hover:underline shrink-0">Öppna</button>
        <button onclick="pkTaBortUppsattning('${pkNod(u.id)}')" class="text-sm text-ads-muted hover:text-red-600 shrink-0">Ta bort</button>
      </li>`).join('')}</ul>` : `<p class="text-sm text-ads-muted">Inga sparade kontroller i projektet än.</p>`}
    <button onclick="pkNyKontroll()" class="mt-3 text-sm text-ads-blue hover:underline">+ Börja en ny kontroll</button>`;
}

function pkNormaliseraUppsattning(u) {
  const ny = pkNyUppsattning();
  const s  = { ...ny, ...JSON.parse(JSON.stringify(u)), kravprofil: { ...ny.kravprofil, ...(u.kravprofil || {}) } };
  delete s.sparadAv; delete s.sparadAvEpost; delete s.sparad;
  s.modeller = s.modeller.map(m => ({ disciplin: '', kategorier: [], ...m }));
  return s;
}

function pkBekraftaBytet(gor) {
  if (!_pk.andrat || !_pk.setup.modeller.length) return gor();
  pkDialog({
    titel: 'Osparade ändringar',
    text: `"${_pk.setup.namn}" har ändringar som inte är sparade i projektet. Utkastet finns kvar i webbläsaren tills du byter, sedan försvinner det.`,
    knappar: [{ text: 'Avbryt' }, { text: 'Byt ändå', primar: true, gor: () => { setTimeout(gor, 0); } }],
  });
}

function pkOppnaUppsattning(nod) {
  const u = pkLagring().data.uppsattningar.find(x => x.id === pkNodId(Number(nod)));
  if (!u) return;
  document.getElementById('pk-dialog')?.remove();
  pkBekraftaBytet(() => {
    _pk.korning?.avbryt?.abort();
    Object.assign(_pk, {
      setup: pkNormaliseraUppsattning(u), sparatId: u.id, sparadTid: u.sparad,
      andrat: false, angra: [], korning: null, utkast: null, steg: 'modeller',
      oppning: { tid: u.sparad, av: u.sparadAv, modellset: null },
    });
    pkSparaUtkast();
    pkForbered();
    pkKollaModellset();
    if (typeof pkKollaParameterfil === 'function') pkKollaParameterfil();
    pkUppdatera();
  });
}

function pkNyKontroll() {
  document.getElementById('pk-dialog')?.remove();
  pkBekraftaBytet(() => {
    _pk.korning?.avbryt?.abort();
    Object.assign(_pk, { setup: pkNyUppsattning(), sparatId: null, sparadTid: null, andrat: false, angra: [], korning: null, utkast: null, oppning: null, steg: 'modeller' });
    pkSparaUtkast();
    pkUppdatera();
  });
}

function pkTaBortUppsattning(nod) {
  const id = pkNodId(Number(nod));
  const u  = pkLagring().data.uppsattningar.find(x => x.id === id);
  if (!u) return;
  pkDialog({
    titel: `Ta bort "${u.namn}"?`,
    text: 'Kontrollen tas bort ur projektets fil för alla. ACC behåller filens tidigare versioner.',
    knappar: [{ text: 'Avbryt' }, { text: 'Ta bort', primar: true, gor: async () => {
      try {
        await pkSkrivFil(d => ({ ...d, uppsattningar: d.uppsattningar.filter(x => x.id !== id) }));
        if (_pk.sparatId === id) { _pk.sparatId = null; _pk.sparadTid = null; _pk.andrat = true; }
        vkToast(`"${u.namn}" är borttagen.`);
      } catch (err) {
        vkToast(`Kunde inte ta bort: ${vkFelText(err)}`, 'red');
      }
    } }],
  });
}

// ── Efter öppning ─────────────────────────────────────────────────────────────
// En öppnad uppsättning visar vad som hänt sedan den sparades: nya och
// borttagna modeller i ett följt model set och nya kategorier. Inget läggs
// till av sig självt.

async function pkKollaModellset() {
  const ms = _pk.setup.modellset;
  if (!ms) return;
  const gen = _pk.generation, oppning = _pk.oppning;
  try {
    const modeller = await pkModellsetModeller(ms.id);
    if (gen !== _pk.generation || _pk.oppning !== oppning) return;
    const valda = new Set(_pk.setup.modeller.map(m => m.id));
    const iSet  = new Set(modeller.map(m => m.id));
    oppning.modellset = {
      nya:       modeller.filter(m => !valda.has(m.id)).map(m => ({ id: m.id, namn: m.namn, mapp: `Model set: ${ms.namn}`, kalla: 'mc' })),
      borttagna: _pk.setup.modeller.filter(m => m.kalla === 'mc' && !iSet.has(m.id)),
    };
  } catch (err) {
    if (oppning) oppning.modellset = { fel: vkFelText(err) };
  }
  pkRitaUtkast();
}

function pkModellsetLaggTillNya() {
  const nya = _pk.oppning?.modellset?.nya || [];
  pkLaggTillModeller(nya);
  _pk.oppning.modellset.nya = [];
  pkRitaUtkast();
}

function pkModellsetIgnorera() {
  if (_pk.oppning?.modellset) _pk.oppning.modellset = null;
  pkRitaUtkast();
}

// Nya kategorier i modellerna sedan förra körningen.
function pkNyaKategorier() {
  let n = 0;
  for (const m of _pk.setup.modeller) {
    const antal = pkModellData(m.id)?.kategoriAntal;
    if (antal && m.sedda?.length) n += Object.keys(antal).filter(k => !m.sedda.includes(k)).length;
  }
  return n;
}

function pkOppningsHtml() {
  const o = _pk.oppning;
  if (!o) return '';
  const ms   = o.modellset;
  const nyaK = pkNyaKategorier();
  const rad  = [];
  if (ms?.nya?.length) rad.push(`${ms.nya.length} ${ms.nya.length === 1 ? 'ny modell' : 'nya modeller'} i model set
    <button onclick="pkModellsetLaggTillNya()" class="text-ads-blue hover:underline">Lägg till</button>
    <button onclick="pkModellsetIgnorera()" class="text-ads-muted hover:underline">Ignorera</button>`);
  if (ms?.borttagna?.length) rad.push(`${ms.borttagna.length} ${ms.borttagna.length === 1 ? 'modell finns' : 'modeller finns'} inte längre i model set`);
  if (ms?.fel) rad.push(`model set gick inte att läsa: ${pkEsc(ms.fel)}`);
  if (nyaK) rad.push(`${nyaK} ${nyaK === 1 ? 'ny kategori' : 'nya kategorier'} sedan förra körningen <button onclick="pkGaTill('kategorier')" class="text-ads-blue hover:underline">Visa</button>`);
  if (o.parameterfil) rad.push(`parameterfilen har en ny version <button onclick="pkGaTill('parametrar')" class="text-ads-blue hover:underline">Visa</button>`);
  return `
    <div class="mt-4 bg-white border border-ads-border rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
      <span class="text-ads-text">Sparad ${pkEsc(new Date(o.tid).toLocaleString('sv-SE'))}${o.av ? ` av ${pkEsc(o.av)}` : ''}.
        Kontrollen körs alltid mot modellernas senaste versioner.</span>
      ${rad.map(r => `<span class="text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">${r}</span>`).join('')}
      <span class="ml-auto flex gap-2">
        ${pkKnapp('Stäng', '_pk.oppning = null; pkRitaUtkast()')}
        ${pkKanInteKora() ? '' : pkKnapp('Kör med senaste versionerna', 'pkKor()', { primar: true })}
      </span>
    </div>`;
}

// ── Mappval ───────────────────────────────────────────────────────────────────
// Ett litet mappträd i en dialog. Svarar med { id, sokvag } eller null. Med
// filer (en funktion som tar ett filnamn) väljs i stället en fil, och svaret
// har också namn.

function pkValjMapp(titel, text, { filer = null } = {}) {
  return new Promise(klar => {
    let svarat = false;
    const svara = v => { if (svarat) return; svarat = true; _pk.mappval = null; klar(v); };
    _pk.mappval = { topp: null, innehall: new Map(), oppna: new Set(), vald: null, filer };
    pkDialog({
      titel, text, bredd: 'w-[560px]',
      html: `<div id="pk-mappval"></div>`,
      vidStang: () => svara(null),
      knappar: [
        { text: 'Avbryt' },
        { text: filer ? 'Välj filen' : 'Välj mappen', primar: true, gor: () => {
          if (!_pk.mappval?.vald) { vkToast(filer ? 'Välj en fil först.' : 'Välj en mapp först.', 'red'); return false; }
          svara(_pk.mappval.vald);
        } },
      ],
    });
    pkMappvalLas();
  });
}

async function pkMappvalLas() {
  const m = _pk.mappval;
  m.topp = { laddar: true };
  pkRitaMappval();
  try { m.topp = { items: await getTopFolders(_hubs[_hubIdx].id, _currentProject.id) }; }
  catch (err) { m.topp = { fel: vkFelText(err) }; }
  pkRitaMappval();
}

async function pkMappvalOppna(i) {
  const m = _pk.mappval, id = pkNodId(i);
  if (!m) return;
  if (m.oppna.has(id)) { m.oppna.delete(id); return pkRitaMappval(); }
  m.oppna.add(id);
  if (!m.innehall.has(id)) {
    m.innehall.set(id, { laddar: true });
    pkRitaMappval();
    try { m.innehall.set(id, { items: await getFolderContents(_currentProject.id, id) }); }
    catch (err) { m.innehall.set(id, { fel: vkFelText(err) }); }
  }
  pkRitaMappval();
}

function pkMappvalValj(i, sokvag, namn = '') {
  const m = _pk.mappval;
  if (!m) return;
  const id = pkNodId(i);
  m.vald = m.vald?.id === id ? null : { id, sokvag: decodeURIComponent(sokvag), namn: decodeURIComponent(namn) };
  pkRitaMappval();
}

function pkRitaMappval() {
  const el = document.getElementById('pk-mappval');
  const m  = _pk.mappval;
  if (!el || !m) return;
  const filrad = (it, djup, foralder) => {
    const namn = vkMappNamnAv(it), i = pkNod(it.id), vald = m.vald?.id === it.id;
    return `
      <button onclick="pkMappvalValj(${i}, '${encodeURIComponent(foralder)}', '${encodeURIComponent(namn)}')"
              class="w-full flex items-center gap-2 py-1 pr-3 text-sm text-left hover:bg-ads-gray ${vald ? 'bg-blue-50' : ''}" style="padding-left:${30 + djup * 18}px">
        <span class="w-3.5 h-3.5 shrink-0 rounded-full ${vald ? 'border-4 border-ads-blue' : 'border border-ads-muted'}"></span>
        <span class="truncate ${vald ? 'text-ads-blue font-medium' : 'text-ads-text'}">${pkEsc(namn)}</span></button>`;
  };
  const rader = (items, djup, foralder) => (items || []).filter(it => !it.attributes?.hidden && (it.type === 'folders' || (m.filer && it.type === 'items' && m.filer(vkMappNamnAv(it))))).map(it => {
    if (it.type === 'items') return filrad(it, djup, foralder);
    const namn = vkMappNamnAv(it), sokvag = foralder ? `${foralder} / ${namn}` : namn;
    const i = pkNod(it.id), oppen = m.oppna.has(it.id), vald = m.vald?.id === it.id, inne = m.innehall.get(it.id);
    const under = !oppen ? '' : inne?.laddar ? `<p class="text-xs text-ads-muted py-1" style="padding-left:${34 + djup * 18}px">Läser…</p>`
      : inne?.fel ? `<p class="text-xs text-red-600 py-1" style="padding-left:${34 + djup * 18}px">${pkEsc(inne.fel)}</p>`
      : rader(inne?.items, djup + 1, sokvag);
    return `
      <div class="flex items-center gap-1.5 py-1 pr-3 hover:bg-ads-gray text-sm select-none" style="padding-left:${8 + djup * 18}px">
        <button onclick="pkMappvalOppna(${i})" class="text-ads-muted p-0.5" aria-label="${oppen ? 'Fäll ihop' : 'Fäll ut'}">
          <svg class="w-3.5 h-3.5 transition-transform ${oppen ? 'rotate-90' : ''}" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/></svg></button>
        ${m.filer ? `<button onclick="pkMappvalOppna(${i})" class="flex items-center gap-2 flex-1 min-w-0 text-left">
          <svg class="w-4 h-4 shrink-0 text-amber-400" viewBox="0 0 20 15" fill="currentColor"><path d="M0 2.5A1.5 1.5 0 0 1 1.5 1h4.764a1.5 1.5 0 0 1 1.06.44l.94.94A1.5 1.5 0 0 0 9.322 3H18.5A1.5 1.5 0 0 1 20 4.5v8A1.5 1.5 0 0 1 18.5 14H1.5A1.5 1.5 0 0 1 0 12.5v-10z"/></svg>
          <span class="truncate text-ads-text">${pkEsc(namn)}</span></button>` : `
        <button onclick="pkMappvalValj(${i}, '${encodeURIComponent(sokvag)}')" class="flex items-center gap-2 flex-1 min-w-0 text-left">
          <span class="w-3.5 h-3.5 shrink-0 rounded-full ${vald ? 'border-4 border-ads-blue' : 'border border-ads-muted'}"></span>
          <span class="truncate ${vald ? 'text-ads-blue font-medium' : 'text-ads-text'}">${pkEsc(namn)}</span></button>`}
      </div>${under}`;
  }).join('');
  el.innerHTML = `
    <div class="border border-ads-border rounded max-h-72 overflow-auto py-1">
      ${!m.topp || m.topp.laddar ? `<p class="text-xs text-ads-muted px-3 py-3">Läser mappar…</p>` : m.topp.fel ? `<p class="text-xs text-red-600 px-3 py-3">${pkEsc(m.topp.fel)}</p>` : rader(m.topp.items, 0, '') || `<p class="text-xs text-ads-muted px-3 py-3">Inga mappar.</p>`}
    </div>
    <p class="text-[11px] mt-1 ${m.vald ? 'text-ads-blue' : 'text-ads-muted italic'}">${m.vald ? (m.filer ? `Vald fil: ${pkEsc(m.vald.namn)}` : `Vald mapp: ${pkEsc(m.vald.sokvag)}`) : (m.filer ? 'Ingen fil vald.' : 'Ingen mapp vald.')}</p>`;
}
