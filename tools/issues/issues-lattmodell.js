// issues-lattmodell.js — "Modellinställningar": vilka IFC-filer projektets
// lätta modell består av (docs/PLAN-FRAGMENTS.md, del 2).
//
// Två mappar väljs en gång per projekt och gäller alla i projektet:
//   IFC-mappen    där projektets IFC-filer ligger. Fönstret visar trädet under
//                 den, bara mappar som innehåller IFC, aldrig mappar med "arkiv"
//                 i namnet (Mahdi, 2026-11-09). Trädet läses mapp för mapp
//                 (ilmLasMappar) och sparas i webbläsaren (IndexedDB ilm-trad),
//                 så att det syns direkt nästa gång; det läses om i bakgrunden
//                 en gång per session.
//   lagringsmappen  där modellen sparas, alltid vald av användaren:
//     arenden-lattmodell.json   innehållsförteckningen (ILM_FIL, format nedan)
//     <ifc-namn> (<id>).frag    en Fragments-fil per IFC
// IFC-filer laddas inte längre upp från datorn; de som redan gjorts det fungerar.
// Förteckningen hittas med ACC:s sökning över toppmapparna (senast ändrad
// vinner, övriga rapporteras); dess item-id minns per webbläsare
// (ilm-index:<projekt-id>) så att sökningen bara görs första gången. Den läses
// om precis före varje sparning, så att två personer inte skriver över
// varandras ändringar.
//
// Varje IFC görs om för sig (en .frag per IFC), i en Web Worker
// (issues-frag-omvandla.js), en i taget. Bara en ändrad IFC behöver göras om.
// Den röda bubblan på knappen visar att en vald IFC har en nyare version i ACC
// än den som gjordes om; det kollas med ett anrop per IFC när fliken läses in.
//
// Förteckningens format:
//   { typ: ILM_TYP, version: 1, mapp: { id, sokvag }, ifcMapp: { id, sokvag },
//     disciplin: null | -1 | n,
//     filer: [{ kalla: 'acc'|'dator',
//               ifc:  { itemId, namn, sokvag, version, versionId, storlek, datum, enhet, karta },
//               frag: { itemId, namn, versionId, storlek, format },
//               omvandlad, omvandladAv }] }
// mapp är lagringsmappen. disciplin säger var i filnamnet disciplinkoden står:
// null = föreslås av verktyget, -1 = används inte, n = del n (från 0) när
// namnet delas vid - _ . och mellanslag. En äldre version av appen skriver bara
// mapp och filer; IFC-mappen finns därför också i webbläsaren (ilm-ifcmapp:<id>).
// ifc.datum är när IFC-versionen laddades upp till ACC.
// ifc.itemId är IFC-filens lineage, samma som ärendenas linkedDocuments.urn.
// ifc.enhet är filens längdenhet i meter, ifc.karta dess IfcMapConversion
// { E, N, H, a, o, s } eller null (se ilmLasGeoreferens). frag.format är
// ILM_FORMAT när filen gjordes om; en äldre siffra betyder att den ska göras om.
//
// Popupfönstret ligger direkt i <body>, utanför #main-content, så att flikens
// omritningar inte stänger det. Det tonar in och glider upp; Esc, ✕ och klick
// utanför stänger. Jobben fortsätter även när fönstret är stängt. Det är ett
// enda fönster: trädet med kryssrutor är modellen, och "Spara ändringar" lägger
// till och tar bort.

const ILM_FIL = 'arenden-lattmodell.json';
const ILM_TYP = 'forma-console-lattmodell';
const ILM_ANIMERING_MS = 200;
const ILM_STOR_IFC = 300 * 1024 * 1024;   // varning: lång tid och mycket minne
// Omvandlingens version. Räknas upp när omvandlingen ändras (fler IFC-klasser,
// mer sparad information), så att äldre modeller visas som inaktuella.
//   1  första versionen (2026-11-06)
//   2  IfcSpatialZone och infraklasser med, georeferens sparad (2026-11-06)
const ILM_FORMAT = 2;

// Mappar med det här i namnet visas aldrig och läses inte (stora som små bokstäver).
const ILM_ARKIV = /arkiv/i;
const ILM_MAX_MAPPAR = 5000;     // skydd mot att läsa ett helt projekt av misstag
const ILM_GAMMAL_DAGAR = 14;     // IFC-filer äldre än så får gult datum
// Vanliga disciplinkoder, för att föreslå var i filnamnet koden står.
const ILM_KANDA_KODER = new Set(['A', 'B', 'E', 'F', 'G', 'I', 'K', 'L', 'M', 'P', 'R', 'S', 'T', 'U', 'V', 'W', 'Y', 'Z',
  'EL', 'VS', 'VE', 'SP', 'BR', 'ARK', 'KON', 'VVS', 'RÖR', 'SPR', 'TELE', 'STYR', 'MARK', 'GEO', 'LAND', 'KONST']);

const _ilm = {
  oppen:     false,
  projektId: null,
  index:     new Map(),  // projekt-id → { laddar, fel, itemId, mapp, data, dubletter, lokalt }
  tips:      new Map(),  // "projekt|ifc-item" → { version, versionId, storlek, datum, borta } senaste i ACC
  jobb:      new Map(),  // "projekt|nyckel" → { pid, nyckel, namn, steg, andel, fel, kalla, ifc }
  ko:        [],         // jobbnycklar i tur
  arbetar:   false,
  blad:      null,       // mappväljaren, se ilmOppnaBlad
  trad:      new Map(),  // projekt-id → IFC-mappens träd, se ilmTradLas
  val:       new Map(),  // projekt-id → { lagg: Map(item-id → fil), tabort: Set(item-id) }, inte sparat än
  oppna:     new Map(),  // projekt-id → Set med öppna mappar i trädet
  filter:    { sok: '', visa: 'alla', datum: 'alla', disciplin: '' },
  discOppen: false,      // raden där disciplinkoden ställs in är öppen
  rader:     [],         // trädets rader vid senaste ritningen (klick pekar hit med löpnummer)
  skrivKo:   Promise.resolve(),  // sparningar av förteckningen görs en i taget
  ritar:     false,      // en omritning är beställd till nästa bildruta
  db:        null,       // löfte om IndexedDB ilm-trad
};

// ── Förteckningen i ACC ───────────────────────────────────────────────────────

function ilmHub() {
  return _hubs[_hubIdx]?.id;
}

function ilmTolka(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error(`${ILM_FIL} är inte giltig JSON`); }
  if (d?.typ !== ILM_TYP) throw new Error(`${ILM_FIL} har fel innehåll`);
  // En flyttad modell lämnar en hänvisning till förteckningen i den nya mappen (ilmFlyttaModell).
  if (d.flyttadTill) return { flyttadTill: d.flyttadTill, mapp: d.mapp || null, filer: [] };
  // disciplin saknas (undefined) när en äldre version av appen sparade; null betyder "föreslå".
  return { mapp: d.mapp || null, ifcMapp: d.ifcMapp?.id ? d.ifcMapp : null, disciplin: d.disciplin,
           filer: Array.isArray(d.filer) ? d.filer.filter(f => f?.ifc?.itemId) : [] };
}

function ilmIndexText(data) {
  return JSON.stringify({ typ: ILM_TYP, version: 1, mapp: data.mapp, ifcMapp: data.ifcMapp || null,
                          disciplin: data.disciplin ?? null, filer: data.filer }, null, 2);
}

// IFC-mappen: ur förteckningen, annars det som valts innan lagringsmappen fanns
// eller det som en äldre version av appen tappade (webbläsarens minne).
function ilmIfcMapp(pid) {
  const ix = _ilm.index.get(pid);
  return ix?.data?.ifcMapp || ix?.lokalt?.ifcMapp || isvLasVal(`ilm-ifcmapp:${pid}`, null);
}

// Var disciplinkoden står: null (föreslå), -1 (används inte) eller delens nummer.
function ilmDisciplinVal(pid) {
  const ix = _ilm.index.get(pid);
  const d = ix?.data?.disciplin;
  return d !== undefined ? d : (ix?.lokalt?.disciplin ?? null);
}

// Läser en förteckning (och följer en hänvisning efter en flytt, ett steg).
async function ilmLasIndexfil(pid, itemId) {
  let [text, mapp] = await Promise.all([readTextFile(pid, itemId), getItemParent(pid, itemId).catch(() => null)]);
  let data = ilmTolka(text);
  if (data.flyttadTill) {
    itemId = data.flyttadTill;
    [text, mapp] = await Promise.all([readTextFile(pid, itemId), getItemParent(pid, itemId).catch(() => null)]);
    data = ilmTolka(text);
    if (data.flyttadTill) throw new Error(`${ILM_FIL} hänvisar i en ring`);
  }
  return { itemId, mapp: mapp ? { id: mapp.id, sokvag: data.mapp?.sokvag || vkMappNamnAv(mapp) } : data.mapp, data };
}

// Letar upp förteckningen: först där den låg senast, annars med sökning.
async function ilmHittaIndex(pid) {
  const minne = isvLasVal(`ilm-index:${pid}`, null);
  if (minne) {
    try {
      const fil = await ilmLasIndexfil(pid, minne);
      if (fil.itemId !== minne) isvSparaVal(`ilm-index:${pid}`, fil.itemId);
      return { ...fil, dubletter: 0 };
    } catch { /* borttagen eller flyttad: sök */ }
  }
  const toppar = (await getTopFolders(ilmHub(), pid)).filter(f => !f.attributes?.hidden);
  const traffar = [];
  for (const t of toppar) {
    try { traffar.push(...await searchFolder(pid, t.id, ILM_FIL)); } catch { /* en mapp som inte går att söka i stoppar inte resten */ }
  }
  const filer = [...new Map(traffar.map(t => [t.itemId, t])).values()]
    .sort((a, b) => String(b.andrad || '').localeCompare(String(a.andrad || '')));
  if (!filer.length) return { itemId: null, mapp: null, data: null, dubletter: 0 };
  const fil = await ilmLasIndexfil(pid, filer[0].itemId);
  isvSparaVal(`ilm-index:${pid}`, fil.itemId);
  // En hänvisning efter en flytt och dess mål räknas inte som dubletter.
  const foljd = fil.itemId !== filer[0].itemId && filer.some(f => f.itemId === fil.itemId);
  return { ...fil, dubletter: Math.max(0, filer.length - (foljd ? 2 : 1)) };
}

// Läser projektets förteckning en gång (eller om, med tvinga) och kollar sedan versionerna.
function ilmLas(pid, tvinga = false) {
  const nu = _ilm.index.get(pid);
  if (nu && (nu.laddar || (!tvinga && !nu.fel))) return nu.lofte;
  const post = { laddar: true, fel: null, itemId: null, mapp: null, data: null, dubletter: 0, lokalt: nu?.lokalt || null };
  post.lofte = (async () => {
    try {
      Object.assign(post, await ilmHittaIndex(pid));
      if (post.data?.ifcMapp) isvSparaVal(`ilm-ifcmapp:${pid}`, post.data.ifcMapp);
    } catch (err) {
      post.fel = vkFelText(err);
    }
    post.laddar = false;
    ilmUppdateraVyer(pid);
    if (post.data?.filer.length) await ilmKollaVersioner(pid);
  })();
  _ilm.index.set(pid, post);
  ilmUppdateraVyer(pid);
  return post.lofte;
}

// Läser förteckningen färskt, låter andra(data) ändra den och sparar. En
// sparning i taget, så att två samtidiga (en färdig omvandling och ett
// borttag) inte skriver över varandra.
function ilmSkrivIndex(pid, andra, valdMapp) {
  const p = _ilm.skrivKo.then(() => ilmSkrivIndexNu(pid, andra, valdMapp));
  _ilm.skrivKo = p.catch(() => {});
  return p;
}

async function ilmSkrivIndexNu(pid, andra, valdMapp) {
  const farsk = await ilmHittaIndex(pid);
  const mapp = farsk.itemId ? farsk.mapp : (valdMapp || _ilm.index.get(pid)?.mapp);
  if (!mapp) throw new Error('ingen mapp är vald för modellen');
  const data = farsk.data || { mapp, filer: [] };
  if (!data.ifcMapp) data.ifcMapp = ilmIfcMapp(pid);
  if (data.disciplin === undefined) data.disciplin = ilmDisciplinVal(pid);
  andra(data);
  data.mapp = { id: mapp.id, sokvag: mapp.sokvag || data.mapp?.sokvag || '' };
  const text = ilmIndexText(data);
  const itemId = await writeTextFile(pid, mapp.id, ILM_FIL, text, farsk.itemId);
  isvSparaVal(`ilm-index:${pid}`, itemId);
  const post = _ilm.index.get(pid) || {};
  Object.assign(post, { laddar: false, fel: null, itemId, mapp: data.mapp, data, dubletter: farsk.dubletter });
  _ilm.index.set(pid, post);
  ilmUppdateraVyer(pid);
}

// Senaste versionen i ACC av varje vald IFC, fyra åt gången.
async function ilmKollaVersioner(pid) {
  const filer = [...(_ilm.index.get(pid)?.data?.filer || [])];
  let i = 0;
  const arbetare = async () => {
    while (i < filer.length) {
      const f = filer[i++];
      _ilm.tips.set(`${pid}|${f.ifc.itemId}`, await ilmTip(pid, f.ifc.itemId));
    }
  };
  await Promise.all([arbetare(), arbetare(), arbetare(), arbetare()]);
  ilmUppdateraVyer(pid);
}

async function ilmTip(pid, itemId) {
  try {
    const t = await bhMedOmforsok(() => getItemTip(pid, itemId));
    const borta = /deleted/i.test(t?.attributes?.extension?.type || '');
    return { version: t?.attributes?.versionNumber ?? null, versionId: t?.id || null, storlek: t?.attributes?.storageSize ?? null, borta,
             datum: t?.attributes?.createTime || t?.attributes?.lastModifiedTime || null,
             av: t?.attributes?.createUserName || t?.attributes?.lastModifiedUserName || '' };
  } catch (err) {
    return { borta: /\b404\b/.test(String(err?.message)), fel: !/\b404\b/.test(String(err?.message)) };
  }
}

// ── Det andra filerna frågar efter ────────────────────────────────────────────

// IFC-filerna som projektets modell består av.
function ilmFiler(pid) {
  return _ilm.index.get(pid)?.data?.filer || [];
}

// Läses projektets förteckning fortfarande?
function ilmLaddar(pid) {
  const p = _ilm.index.get(pid);
  return !p || p.laddar;
}

// Har IFC:n en nyare version i ACC än den som gjordes om, eller gjordes den om
// med en äldre omvandling?
function ilmArInaktuell(pid, f) {
  if (ilmGammaltFormat(f)) return true;
  const t = _ilm.tips.get(`${pid}|${f.ifc.itemId}`);
  return !!t && !t.borta && t.version != null && f.ifc.version != null && t.version > f.ifc.version;
}

function ilmGammaltFormat(f) {
  return !!f.frag && (f.frag.format || 1) < ILM_FORMAT;
}

// Finns det nyare IFC-versioner att hämta i något av de hämtade projekten?
function ilmHarUppdateringar(pid) {
  const projekt = pid ? [pid] : [..._is.projekt.keys()];
  return projekt.some(p => ilmFiler(p).some(f => ilmArInaktuell(p, f)));
}

function ilmArOppen() {
  return _ilm.oppen;
}

// Startar inläsningen för de hämtade projekten (för bubblan). Anropas när knappen ritas.
function ilmStartaKoll() {
  if (!_is.hamtad) return;
  for (const pid of _is.projekt.keys()) if (!_ilm.index.has(pid)) ilmLas(pid);
}

// Knappens innehåll, med den röda bubblan när det finns uppdateringar.
function ilmKnappInre() {
  return `Modellinställningar${ilmHarUppdateringar()
    ? '<span class="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-red-600 border-2 border-white" title="Modellen behöver uppdateras: nyare IFC-versioner finns, eller omvandlingen har förbättrats"></span>' : ''}`;
}

// Ritar om det som visar förteckningen: knappen, fönstret och modellrutan.
function ilmUppdateraVyer(pid) {
  const knapp = document.getElementById('ilm-knapp');
  if (knapp) knapp.innerHTML = ilmKnappInre();
  if (_ilm.oppen) ilmRita();
  if (typeof isvRitaRad === 'function') isvRitaRad();
  if (pid) isfModellAndrad?.(pid);
}

// ── Lägga till, uppdatera, ta bort ───────────────────────────────────────────

function ilmStorlek(byte) {
  if (byte == null) return '';
  if (byte < 1024 * 1024) return `${Math.max(1, Math.round(byte / 1024))} kB`;
  return `${(byte / 1024 / 1024).toFixed(byte < 100 * 1024 * 1024 ? 1 : 0).replace('.', ',')} MB`;
}

function ilmFragNamn(ifcNamn, itemId) {
  const stam = String(ifcNamn).replace(/\.ifc$/i, '');
  const kort = String(itemId).split(':').pop().slice(0, 8);
  return `${stam} (${kort}).frag`;
}

function ilmStorOk(namn, storlek) {
  if (!(storlek > ILM_STOR_IFC)) return true;
  return confirm(`${namn} är ${ilmStorlek(storlek)}. Att göra om den kan ta lång tid och kräva mycket minne i webbläsaren. Fortsätta?`);
}

// IFC-filer valda i ACC: [{ itemId, namn, sokvag, storlek }].
function ilmLaggTillFranAcc(pid, valda) {
  for (const v of valda) {
    if (!ilmStorOk(v.namn, v.storlek)) continue;
    ilmKoa(pid, { nyckel: v.itemId, namn: v.namn, kalla: 'acc', ifc: { itemId: v.itemId, namn: v.namn, sokvag: v.sokvag } });
  }
}

// Gör om en IFC som redan ingår, med den senaste versionen i ACC.
function ilmUppdatera(pid, itemId) {
  const f = ilmFiler(pid).find(x => x.ifc.itemId === itemId);
  if (!f) return;
  ilmKoa(pid, { nyckel: itemId, namn: f.ifc.namn, kalla: f.kalla, ifc: { itemId, namn: f.ifc.namn, sokvag: f.ifc.sokvag } });
}

function ilmUppdateraAlla(pid) {
  for (const f of ilmFiler(pid)) if (ilmArInaktuell(pid, f)) ilmUppdatera(pid, f.ifc.itemId);
}

// ── Kön: hämta, göra om, ladda upp, spara ────────────────────────────────────

function ilmKoa(pid, jobb) {
  const k = `${pid}|${jobb.nyckel}`;
  const nu = _ilm.jobb.get(k);
  if (nu && !nu.fel) return;   // redan i kön eller på gång
  _ilm.jobb.set(k, { ...jobb, pid, steg: 'I kö', andel: null, fel: null });
  _ilm.ko.push(k);
  ilmUppdateraVyer();
  if (!_ilm.arbetar) ilmArbeta();
}

async function ilmArbeta() {
  _ilm.arbetar = true;
  while (_ilm.ko.length) {
    const k = _ilm.ko.shift();
    const j = _ilm.jobb.get(k);
    if (!j) continue;
    try {
      await ilmKorJobb(j);
      _ilm.jobb.delete(k);
    } catch (err) {
      console.warn('Modellinställningar', err);
      j.fel = vkFelText(err);
      j.steg = '';
    }
    ilmUppdateraVyer(j.pid);
  }
  _ilm.arbetar = false;
}

// Förloppet skrivs direkt i radens text, så att listan inte ritas om hela
// tiden (då missas klick). Ett nytt steg ritar om.
function ilmSteg(j, steg, andel = null) {
  const nyttSteg = j.steg !== steg;
  j.steg = steg;
  j.andel = andel;
  if (!_ilm.oppen) return;
  const el = nyttSteg ? null : document.querySelector(`[data-ilm-jobb="${CSS.escape(`${j.pid}|${j.nyckel}`)}"]`);
  if (el) el.textContent = ilmJobbText(j);
  else ilmRita();
}

async function ilmKorJobb(j) {
  const pid = j.pid;
  const mapp = _ilm.index.get(pid)?.mapp;
  if (!mapp) throw new Error('ingen mapp är vald för modellen');

  const tip = await ilmTip(pid, j.ifc.itemId);
  if (tip.borta) throw new Error('IFC-filen finns inte längre i ACC');
  if (tip.fel) throw new Error('kunde inte läsa IFC-filens version i ACC');
  const ifc = { ...j.ifc, version: tip.version, versionId: tip.versionId, storlek: tip.storlek, datum: tip.datum };

  ilmSteg(j, 'Hämtar IFC', 0);
  let bytes = await ilmHamtaFil(pid, ifc.itemId, a => ilmSteg(j, 'Hämtar IFC', a));

  // Georeferensen läses innan filen lämnas över till omvandlingen.
  Object.assign(ifc, ilmLasGeoreferens(bytes));

  ilmSteg(j, 'Gör om', 0);
  const frag = await ilmGorOm(bytes, a => ilmSteg(j, 'Gör om', a));
  bytes = null;

  // Fragments-filen: ny version av samma fil om den redan finns.
  ilmSteg(j, 'Laddar upp modellen', 0);
  const fragNamn = ilmFragNamn(ifc.namn, ifc.itemId);
  const tidigare = ilmFiler(pid).find(f => f.ifc.itemId === ifc.itemId)?.frag?.itemId || await ilmFilIMapp(pid, mapp.id, fragNamn);
  const storage = await createStorage(pid, mapp.id, fragNamn);
  await uploadToStorage(storage, new Blob([frag]), a => ilmSteg(j, 'Laddar upp modellen', a));
  const fragItem = tidigare
    ? (await createVersion(pid, tidigare, fragNamn, storage), tidigare)
    : await createItem(pid, mapp.id, fragNamn, storage);
  const fragTip = await ilmTip(pid, fragItem);

  ilmSteg(j, 'Sparar');
  const post = {
    kalla: j.kalla, ifc,
    frag: { itemId: fragItem, namn: fragNamn, versionId: fragTip.versionId || null, storlek: frag.byteLength, format: ILM_FORMAT },
    // Namnet tas från ACC:s version av filen (den inloggades profil kan sakna namn).
    omvandlad: new Date().toISOString(), omvandladAv: fragTip.av || _profile?.name || _profile?.email || '',
  };
  await ilmSkrivIndex(pid, d => { d.filer = d.filer.filter(x => x.ifc.itemId !== ifc.itemId).concat(post); });
  _ilm.tips.set(`${pid}|${ifc.itemId}`, tip);
  // Den nya modellen sparas i webbläsaren direkt, så att den inte behöver hämtas igen.
  if (post.frag.versionId) isfCacheSpara?.(post.frag.versionId, frag).catch(() => {});
}

// IFC-filens längdenhet och georeferens (IfcMapConversion). Autodesks visare
// placerar IFC-modeller med georeferensen: R&D:s Building-Architecture hamnade
// 729 km öster / 9 064 km norr, vriden 60° och 1,3 m upp, precis kartans värden.
// Fragments hoppar över georeferensen, så ärendenas nålar räknas tillbaka med
// den (isfFranAutodesk). Bara början av filen läses; där ligger enheterna och
// kartan i praktiken.
function ilmLasGeoreferens(bytes) {
  const text = new TextDecoder('latin1').decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 30 * 1024 * 1024)));
  const prefix = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 100, DECA: 10,
                   DECI: 0.1, CENTI: 0.01, MILLI: 0.001, MICRO: 1e-6, NANO: 1e-9 };
  let enhet = 1;
  const si = /IFCSIUNIT\s*\(\s*\*\s*,\s*\.LENGTHUNIT\.\s*,\s*(\.([A-Z]+)\.|\$)\s*,\s*\.METRE\.\s*\)/i.exec(text);
  const konv = /IFCCONVERSIONBASEDUNIT\s*\([^,]*,\s*\.LENGTHUNIT\.\s*,\s*'([^']*)'/i.exec(text);
  if (si) enhet = si[2] ? prefix[si[2].toUpperCase()] ?? 1 : 1;
  else if (konv) enhet = /foot|feet/i.test(konv[1]) ? 0.3048 : /inch/i.test(konv[1]) ? 0.0254 : 1;

  const m = /IFCMAPCONVERSION\s*\(([^;]*)\)\s*;/i.exec(text);
  if (!m) return { enhet, karta: null };
  const arg = m[1].split(',').map(s => s.trim());
  const tal = (s, std) => { const v = parseFloat(s); return Number.isFinite(v) ? v : std; };
  let a = tal(arg[5], 1), o = tal(arg[6], 0);
  const l = Math.hypot(a, o) || 1;
  a /= l; o /= l;
  return { enhet, karta: { E: tal(arg[2], 0), N: tal(arg[3], 0), H: tal(arg[4], 0), a, o, s: tal(arg[7], 1) || 1 } };
}

async function ilmFilIMapp(pid, mappId, namn) {
  const { poster } = await getFolderContentsWithTips(pid, mappId);
  return poster.find(p => p.type === 'items' && (p.attributes?.displayName || p.attributes?.name) === namn)?.id || null;
}

// Hela filen ur ACC, med förlopp när storleken är känd.
async function ilmHamtaFil(pid, itemId, framsteg) {
  const { urls, size } = await getItemDownload(pid, itemId);
  if (!urls.length) throw new Error('IFC-filen har ingen nedladdningsadress');
  const delar = [];
  let fatt = 0;
  for (const u of urls) {
    const svar = await fetch(u);
    if (!svar.ok) throw new Error(`kunde inte hämta IFC-filen (${svar.status})`);
    const total = size || Number(svar.headers.get('content-length')) || 0;
    const lasare = svar.body.getReader();
    for (;;) {
      const { done, value } = await lasare.read();
      if (done) break;
      delar.push(value);
      fatt += value.byteLength;
      if (total) framsteg(Math.min(1, fatt / total));
    }
  }
  return await new Blob(delar).arrayBuffer();
}

// IFC → Fragments i en Web Worker, så att sidan inte fryser.
function ilmGorOm(bytes, framsteg) {
  return new Promise((klar, fel) => {
    const w = new Worker('tools/issues/issues-frag-omvandla.js', { type: 'module' });
    w.onmessage = e => {
      const m = e.data;
      if (m.typ === 'framsteg') return framsteg(m.andel);
      w.terminate();
      if (m.typ === 'klar') klar(new Uint8Array(m.frag));
      else fel(new Error(`IFC-filen gick inte att göra om: ${m.text}`));
    };
    w.onerror = e => {
      w.terminate();
      fel(new Error(e.message ? `omvandlingen stannade: ${e.message}` : 'omvandlingen stannade (för lite minne, eller biblioteket gick inte att hämta)'));
    };
    w.postMessage({ bytes }, [bytes]);
  });
}

// ── IFC-mappens träd ──────────────────────────────────────────────────────────
// Läses mapp för mapp, sex åt gången, från IFC-mappen och nedåt. Mappar som är
// dolda i ACC eller har "arkiv" i namnet hoppas över helt, liksom allt under
// dem. Mappar utan IFC någonstans under sig visas inte (ilmTradIndex).

function ilmDoljMapp(f) {
  return !!f?.attributes?.hidden || ILM_ARKIV.test(vkMappNamnAv(f));
}

function ilmTrad(pid) {
  return _ilm.trad.get(pid) || null;
}

async function ilmLasMappar(pid, rot, t) {
  const mappar = new Map([[rot.id, { id: rot.id, namn: String(rot.sokvag || '').split(' / ').pop(), foralder: null }]]);
  const filer = [];
  const ko = [rot.id];
  let aktiva = 0, ejLasta = 0, forManga = false;
  const arbetare = async () => {
    for (;;) {
      if (_ilm.trad.get(pid) !== t) return;   // IFC-mappen har bytts: sluta
      if (!ko.length) {
        if (!aktiva) return;
        await new Promise(r => setTimeout(r, 40));
        continue;
      }
      const id = ko.shift();
      aktiva++;
      try {
        const { poster, tips } = await bhMedOmforsok(() => getFolderContentsWithTips(pid, id));
        for (const p of poster) {
          if (p.type === 'folders') {
            if (ilmDoljMapp(p) || mappar.has(p.id)) continue;
            if (mappar.size >= ILM_MAX_MAPPAR) { forManga = true; continue; }
            mappar.set(p.id, { id: p.id, namn: vkMappNamnAv(p), foralder: id });
            ko.push(p.id);
          } else if (p.type === 'items') {
            const namn = p.attributes?.displayName || '';
            if (!/\.ifc$/i.test(namn)) continue;
            const tip = tipVersionOf(p, tips);
            if (/deleted/i.test(tip?.attributes?.extension?.type || '')) continue;
            const a = tip?.attributes || {};
            filer.push({ itemId: p.id, namn, mappId: id, version: a.versionNumber ?? null, versionId: tip?.id || null,
                         storlek: a.storageSize ?? null, datum: a.createTime || a.lastModifiedTime || p.attributes?.lastModifiedTime || null,
                         av: a.createUserName || a.lastModifiedUserName || '' });
          }
        }
      } catch (err) {
        if (id === rot.id) { ko.length = 0; throw err; }
        ejLasta++;   // en undermapp som inte går att läsa stoppar inte resten
      } finally {
        aktiva--;
        t.lasta++;
        t.hittade = filer.length;
        ilmRita();
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, arbetare));
  return { rotId: rot.id, rotSokvag: rot.sokvag || '', mappar: [...mappar.values()], filer, ejLasta, forManga };
}

// Läser IFC-mappens träd en gång per session (eller om, med tvinga). Det
// senast lästa trädet visas direkt ur webbläsarens lager medan det läses om.
function ilmTradLas(pid, tvinga = false) {
  const mapp = ilmIfcMapp(pid);
  if (!mapp) return;
  let t = _ilm.trad.get(pid);
  if (t && t.mappId !== mapp.id) t = null;
  if (t && (t.laddar || (t.farsk && !tvinga))) return;
  if (!t) {
    t = { mappId: mapp.id, laddar: false, data: null, fel: null, tid: null, farsk: false, lasta: 0, hittade: 0 };
    _ilm.trad.set(pid, t);
    ilmTradFranLager(pid, t);
  }
  Object.assign(t, { laddar: true, fel: null, lasta: 0, hittade: 0 });
  ilmRita();
  ilmLasMappar(pid, mapp, t).then(data => {
    if (_ilm.trad.get(pid) !== t) return;
    Object.assign(t, { laddar: false, data, tid: Date.now(), farsk: true });
    ilmTradTillLager(pid, t);
    ilmTipsFranTrad(pid, data);
    ilmUppdateraVyer();
  }, err => {
    if (_ilm.trad.get(pid) !== t) return;
    const text = /\b40[34]\b/.test(String(err?.message)) ? 'du har inte behörighet att se mappen, eller så finns den inte längre' : vkFelText(err);
    Object.assign(t, { laddar: false, fel: text, farsk: true });
    ilmRita();
  });
}

// Läsningen ger de valda IFC-filernas senaste version utan extra anrop (för bubblan).
function ilmTipsFranTrad(pid, data) {
  const iModellen = new Set(ilmFiler(pid).map(f => f.ifc.itemId));
  for (const f of data.filer) {
    if (iModellen.has(f.itemId)) {
      _ilm.tips.set(`${pid}|${f.itemId}`, { version: f.version, versionId: f.versionId, storlek: f.storlek, datum: f.datum, borta: false, av: f.av });
    }
  }
}

function ilmTradDb() {
  if (!_ilm.db) {
    _ilm.db = new Promise((klar, fel) => {
      const r = indexedDB.open('ilm-trad', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('trad');
      r.onsuccess = () => klar(r.result);
      r.onerror = () => fel(r.error);
    });
    _ilm.db.catch(() => { _ilm.db = null; });
  }
  return _ilm.db;
}

async function ilmTradFranLager(pid, t) {
  try {
    const db = await ilmTradDb();
    const v = await new Promise((klar, fel) => {
      const r = db.transaction('trad').objectStore('trad').get(`${pid}|${t.mappId}`);
      r.onsuccess = () => klar(r.result);
      r.onerror = () => fel(r.error);
    });
    // Läsningen kan ha hunnit bli klar före lagret: då vinner den.
    if (v?.data && !t.data && _ilm.trad.get(pid) === t) {
      t.data = v.data;
      t.tid = v.tid;
      ilmRita();
    }
  } catch { /* utan lager läses trädet bara från ACC */ }
}

async function ilmTradTillLager(pid, t) {
  try {
    const db = await ilmTradDb();
    db.transaction('trad', 'readwrite').objectStore('trad').put({ data: t.data, tid: t.tid }, `${pid}|${t.mappId}`);
  } catch { /* inte kritiskt */ }
}

// Trädets uppslag: undermappar och filer per mapp (sorterade), antal IFC under
// varje mapp och varje mapps sökväg. Byggs en gång per läsning.
const _ilmTradIx = new WeakMap();

function ilmTradIndex(data) {
  let x = _ilmTradIx.get(data);
  if (x) return x;
  const mappar = new Map(data.mappar.map(m => [m.id, m]));
  const filerI = new Map(), barn = new Map(), antal = new Map(), sokvag = new Map();
  const lagg = (karta, nyckel, v) => { const l = karta.get(nyckel); if (l) l.push(v); else karta.set(nyckel, [v]); };
  for (const f of data.filer) {
    lagg(filerI, f.mappId, f);
    for (let id = f.mappId, n = 0; id && n < 200; id = mappar.get(id)?.foralder, n++) antal.set(id, (antal.get(id) || 0) + 1);
  }
  for (const m of data.mappar) if (m.foralder && antal.get(m.id)) lagg(barn, m.foralder, m);
  const sv = (a, b) => a.namn.localeCompare(b.namn, 'sv', { numeric: true });
  for (const l of barn.values()) l.sort(sv);
  for (const l of filerI.values()) l.sort(sv);
  const vag = id => {
    if (sokvag.has(id)) return sokvag.get(id);
    const m = mappar.get(id);
    const s = !m || id === data.rotId || !m.foralder ? data.rotSokvag : `${vag(m.foralder)} / ${m.namn}`;
    sokvag.set(id, s);
    return s;
  };
  for (const m of data.mappar) vag(m.id);
  x = { mappar, filerI, barn, antal, sokvag, filer: new Map(data.filer.map(f => [f.itemId, f])) };
  _ilmTradIx.set(data, x);
  return x;
}

// ── Disciplinkoden ────────────────────────────────────────────────────────────
// Namnet delas vid - _ . och mellanslag. Verktyget föreslår den del som oftast
// är en kort bokstavskod (helst en känd disciplinkod) och varierar mellan
// filerna; användaren kan välja en annan del eller stänga av det.

function ilmNamnDelar(namn) {
  return String(namn || '').replace(/\.ifc$/i, '').split(/[-_.\s]+/).filter(Boolean);
}

const _ilmForslag = new WeakMap();

function ilmForeslagenDel(data) {
  if (!data?.filer?.length) return null;
  if (_ilmForslag.has(data)) return _ilmForslag.get(data);
  let bast = null, bastPoang = 0;
  for (let i = 0; i < 8; i++) {
    const varden = data.filer.map(f => ilmNamnDelar(f.namn)[i]).filter(Boolean).map(v => v.toUpperCase());
    if (varden.length < data.filer.length * 0.6) continue;
    const korta = varden.filter(v => /^[A-ZÅÄÖ]{1,5}\d?$/.test(v)).length / varden.length;
    if (korta < 0.6) continue;
    const kanda = varden.filter(v => ILM_KANDA_KODER.has(v)).length / varden.length;
    const olika = new Set(varden).size;
    const poang = korta + 2 * kanda + (olika >= 2 && olika <= 20 ? 0.5 : 0) - i * 0.05;
    if (poang > bastPoang) { bastPoang = poang; bast = i; }
  }
  _ilmForslag.set(data, bast);
  return bast;
}

// Delen som används just nu, eller null om ingen.
function ilmDisciplinDel(pid) {
  const val = ilmDisciplinVal(pid);
  if (val === -1) return null;
  if (Number.isInteger(val) && val >= 0) return val;
  return ilmForeslagenDel(ilmTrad(pid)?.data);
}

function ilmDisciplin(pid, namn, del = ilmDisciplinDel(pid)) {
  return del == null ? '' : (ilmNamnDelar(namn)[del] || '').toUpperCase();
}

async function ilmSattDisciplin(varde) {
  const pid = _ilm.projektId;
  const ix = _ilm.index.get(pid);
  if (!ix) return;
  const val = varde === 'auto' ? null : varde === 'av' ? -1 : Number(varde);
  if (ix.data) ix.data.disciplin = val;
  ix.lokalt = { ...(ix.lokalt || {}), disciplin: val };
  _ilm.filter.disciplin = '';
  ilmRitaNu();
  if (!ix.mapp) return;   // sparas med förteckningen när lagringsmappen väljs
  try {
    await ilmSkrivIndex(pid, d => { d.disciplin = val; });
  } catch (err) {
    alert(`Inställningen för disciplinkoden kunde inte sparas i ACC: ${vkFelText(err)}`);
  }
}

function ilmVaxlaDisc() {
  _ilm.discOppen = !_ilm.discOppen;
  ilmRitaNu();
}

// ── Val som inte är sparade ───────────────────────────────────────────────────
// En kryssruta visar om filen ingår: i modellen och inte urkryssad, eller
// ikryssad men inte sparad. Filer som håller på att göras om går inte att ändra.

function ilmVal(pid) {
  if (!_ilm.val.has(pid)) _ilm.val.set(pid, { lagg: new Map(), tabort: new Set() });
  return _ilm.val.get(pid);
}

function ilmModellKarta(pid) {
  return new Map(ilmFiler(pid).map(f => [f.ifc.itemId, f]));
}

function ilmJobbFor(pid, itemId) {
  return _ilm.jobb.get(`${pid}|${itemId}`) || null;
}

function ilmUpptagen(pid, itemId) {
  const j = ilmJobbFor(pid, itemId);
  return !!j && !j.fel;
}

function ilmArValt(pid, itemId, modell) {
  if (ilmUpptagen(pid, itemId)) return true;
  const v = ilmVal(pid);
  return modell.has(itemId) ? !v.tabort.has(itemId) : v.lagg.has(itemId);
}

function ilmSattVal(pid, fil, pa, modell) {
  const v = ilmVal(pid), id = fil.itemId;
  if (ilmUpptagen(pid, id)) return;
  if (modell.has(id)) { if (pa) v.tabort.delete(id); else v.tabort.add(id); }
  else if (pa) v.lagg.set(id, fil);
  else v.lagg.delete(id);
}

function ilmHarAndringar(pid) {
  const v = _ilm.val.get(pid);
  return !!v && (v.lagg.size + v.tabort.size) > 0;
}

function ilmAngraVal() {
  _ilm.val.delete(_ilm.projektId);
  ilmRitaNu();
}

async function ilmSparaVal() {
  const pid = _ilm.projektId;
  const ix = _ilm.index.get(pid);
  if (!ix?.mapp) { alert('Välj först mappen där modellen sparas.'); return; }
  const v = ilmVal(pid);
  const lagg = [...v.lagg.values()];
  const tabort = [...v.tabort];
  if (!lagg.length && !tabort.length) return;
  if (tabort.length) {
    const namn = ilmFiler(pid).filter(f => v.tabort.has(f.ifc.itemId)).map(f => `• ${f.ifc.namn}`);
    const lista = namn.slice(0, 15).join('\n') + (namn.length > 15 ? `\n… och ${namn.length - 15} till` : '');
    if (!confirm(`Ta bort ${tabort.length} ${tabort.length === 1 ? 'fil' : 'filer'} ur modellen?\n\n${lista}\n\nIFC-filerna ligger kvar i ACC.`)) return;
  }
  _ilm.val.delete(pid);
  ilmRitaNu();
  if (tabort.length) {
    try {
      await ilmSkrivIndex(pid, d => { d.filer = d.filer.filter(x => !tabort.includes(x.ifc.itemId)); });
    } catch (err) {
      for (const id of tabort) ilmVal(pid).tabort.add(id);   // valen finns kvar, så att det går att försöka igen
      ilmRita();
      alert(`Filerna kunde inte tas bort ur modellen: ${vkFelText(err)}`);
    }
  }
  ilmLaggTillFranAcc(pid, lagg.map(f => ({ itemId: f.itemId, namn: f.namn, sokvag: f.sokvag || '', storlek: f.storlek })));
}

function ilmForsokIgen(pid, itemId) {
  const j = ilmJobbFor(pid, itemId);
  if (j?.ifc) ilmKoa(pid, { nyckel: j.nyckel, namn: j.namn, kalla: j.kalla, ifc: j.ifc });
}

function ilmGlomJobb(pid, nyckel) {
  _ilm.jobb.delete(`${pid}|${nyckel}`);
  ilmRita();
}

// ── Filter ────────────────────────────────────────────────────────────────────

function ilmFilterAktivt() {
  const f = _ilm.filter;
  return !!(f.sok.trim() || f.visa !== 'alla' || f.datum !== 'alla' || f.disciplin);
}

function ilmArGammal(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) && Date.now() - t > ILM_GAMMAL_DAGAR * 86400000;
}

function ilmDatum(iso) {
  const d = new Date(iso || '');
  return isNaN(d) ? '' : d.toLocaleDateString('sv-SE');
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

function ilmSattFilter(namn, varde) {
  _ilm.filter[namn] = varde;
  ilmRitaNu();
  const rulla = document.getElementById('ilm-rulla');
  if (rulla) rulla.scrollTop = 0;
}

function ilmRensaFilter() {
  _ilm.filter = { sok: '', visa: 'alla', datum: 'alla', disciplin: '' };
  const inne = document.getElementById('ilm-innehall');
  if (inne) inne.dataset.vy = '';   // fälten ritas om med de tomma värdena
  ilmRitaNu();
}

// ── Popupfönstret ─────────────────────────────────────────────────────────────

function ilmOppna(projektId) {
  _ilm.projektId = projektId || isvProjektId();
  ilmLasOchTrad(_ilm.projektId);
  if (_ilm.oppen) { ilmRita(); return; }
  _ilm.oppen = true;
  _ilm.blad = null;

  const ruta = document.createElement('div');
  ruta.id = 'ilm-ruta';
  ruta.className = 'fixed inset-0 z-[90] flex items-center justify-center p-6';
  ruta.innerHTML = `
    <div onclick="ilmStang()" class="ilm-bakgrund absolute inset-0 bg-black/40 opacity-0 transition-opacity motion-reduce:transition-none" style="transition-duration: ${ILM_ANIMERING_MS}ms"></div>
    <div role="dialog" aria-modal="true" aria-labelledby="ilm-rubrik"
         class="ilm-fonster relative bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col text-sm
                opacity-0 translate-y-4 scale-[0.97] transition ease-out motion-reduce:transition-none" style="transition-duration: ${ILM_ANIMERING_MS}ms">
      <div id="ilm-innehall" class="flex flex-col min-h-0 flex-1"></div>
    </div>`;
  document.body.appendChild(ruta);
  document.addEventListener('keydown', ilmTangent, true);
  ilmRitaNu();
  // Nästa bildruta: då har webbläsaren ritat startläget och övergången syns.
  const fonster = ruta.querySelector('.ilm-fonster');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ruta.querySelector('.ilm-bakgrund')?.classList.remove('opacity-0');
    fonster.classList.remove('opacity-0', 'translate-y-4', 'scale-[0.97]');
  }));
}

// Förteckningen först (den säger vilken IFC-mappen är), sedan trädet.
function ilmLasOchTrad(pid) {
  Promise.resolve(ilmLas(pid)).then(() => {
    if (_ilm.oppen && _ilm.projektId === pid) { ilmTradLas(pid); ilmRita(); }
  });
}

function ilmStang() {
  if (!_ilm.blad && ilmHarAndringar(_ilm.projektId)
      && !confirm('Du har kryssat i eller ur filer utan att spara.\n\nStäng ändå? Valen finns kvar nästa gång du öppnar fönstret.')) return;
  const ruta = document.getElementById('ilm-ruta');
  _ilm.oppen = false;
  _ilm.blad = null;
  document.removeEventListener('keydown', ilmTangent, true);
  if (!ruta) return;
  ruta.querySelector('.ilm-bakgrund')?.classList.add('opacity-0');
  ruta.querySelector('.ilm-fonster')?.classList.add('opacity-0', 'translate-y-4', 'scale-[0.97]');
  ruta.style.pointerEvents = 'none';
  setTimeout(() => ruta.remove(), ILM_ANIMERING_MS);
}

function ilmTangent(e) {
  if (e.key !== 'Escape' || !_ilm.oppen) return;
  e.stopPropagation();
  if (_ilm.blad) { _ilm.blad = null; ilmRitaNu(); return; }
  ilmStang();
}

function ilmValjProjekt(projektId) {
  _ilm.projektId = projektId;
  _ilm.blad = null;
  ilmLasOchTrad(projektId);
  ilmRitaNu();
}

// Omritningar samlas till en per bildruta (jobbens förlopp och läsningen ber om många).
function ilmRita() {
  if (!_ilm.oppen || _ilm.ritar) return;
  _ilm.ritar = true;
  requestAnimationFrame(() => { _ilm.ritar = false; ilmRitaNu(); });
}

// Byter innehållet bara när det har ändrats. Annars missas klick som träffar
// en knapp eller rad precis när den byts ut (förloppet uppdateras ofta).
function ilmSatt(el, html) {
  if (!el || el._ilmHtml === html) return false;
  el._ilmHtml = html;
  el.innerHTML = html;
  return true;
}

function ilmRitaNu() {
  const inne = document.getElementById('ilm-innehall');
  if (!inne) return;
  const pid = _ilm.projektId;
  if (_ilm.blad) {
    // Mappväljaren byggs en gång och ritar sedan om sig själv (ilmBladRita).
    if (inne.dataset.vy !== _ilm.blad.id) {
      inne.dataset.vy = _ilm.blad.id;
      inne.innerHTML = ilmHuvudHtml(pid) + ilmBladSkal(_ilm.blad);
      ilmBladRita();
    }
    return;
  }
  const vy = `huvud|${pid}`;
  if (inne.dataset.vy !== vy) {
    inne.dataset.vy = vy;
    inne.innerHTML = ilmHuvudHtml(pid) + ilmSkalHtml();
  }
  ilmRitaInstallningar(pid);
  ilmRitaVerktyg(pid);
  ilmRitaLista(pid);
  ilmRitaStatus(pid);
  ilmRitaFot(pid);
}

function ilmKnapp(klick, text, extra = '', attr = '') {
  return `<button onclick="${klick}" ${attr} class="text-xs border rounded px-3 py-1.5 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${extra || 'border-ads-border bg-white hover:border-ads-blue'}">${text}</button>`;
}

const ILM_KNAPP_HUVUD = 'border-ads-blue bg-ads-blue text-white hover:bg-ads-blue-dark';

function ilmHuvudHtml(pid) {
  const b = _ilm.blad;
  const flera = _is.projekt.size > 1;
  const rubrik = !b ? 'Modellinställningar' : b.syfte === 'ifc' ? 'Välj mappen med projektets IFC-filer' : 'Välj mappen där modellen sparas';
  return `
    <div class="shrink-0 flex items-start gap-3 px-5 pt-4 pb-3 border-b border-ads-border">
      <div class="min-w-0">
        <h3 id="ilm-rubrik" class="text-base font-semibold text-ads-text">${rubrik}</h3>
        ${flera && !b ? `
          <select onchange="ilmValjProjekt(this.value)" class="mt-1 text-xs border border-ads-border rounded px-1.5 py-0.5 max-w-full">
            ${[..._is.projekt.values()].map(p => `<option value="${vkEsc(p.id)}" ${p.id === pid ? 'selected' : ''}>${vkEsc(p.namn)}</option>`).join('')}
          </select>`
          : `<p class="text-xs text-ads-muted mt-0.5">${vkEsc(_is.projekt.get(pid)?.namn || '')}</p>`}
      </div>
      <button onclick="ilmStang()" class="ml-auto text-ads-muted hover:text-ads-text text-lg leading-none" title="Stäng (Esc)">✕</button>
    </div>`;
}

// Fönstrets delar. Sökfältet och listorna ritas bara en gång, så att fokus och
// öppna listor inte försvinner när förloppet uppdateras.
function ilmSkalHtml() {
  const f = _ilm.filter;
  const val = (v, t, nu) => `<option value="${v}" ${nu === v ? 'selected' : ''}>${t}</option>`;
  const lista = 'text-xs border border-ads-border rounded px-1.5 py-1.5 bg-white focus:outline-none focus:border-ads-blue';
  return `
    <div id="ilm-inst" class="shrink-0 px-5 py-3 border-b border-ads-border/60 text-xs flex flex-col gap-1.5"></div>
    <div class="shrink-0 px-5 pt-3 pb-2 flex flex-col gap-2 border-b border-ads-border/60">
      <div class="flex items-center gap-2 flex-wrap">
        <input id="ilm-sok" type="search" autocomplete="off" spellcheck="false" value="${vkEsc(f.sok)}" oninput="ilmSattFilter('sok', this.value)"
               placeholder="Sök på filnamn, mapp eller disciplin"
               class="flex-1 min-w-[14rem] text-sm border border-ads-border rounded px-3 py-1.5 focus:outline-none focus:border-ads-blue" />
        <select onchange="ilmSattFilter('visa', this.value)" class="${lista}" title="Vilka filer som visas">
          ${val('alla', 'Alla filer', f.visa)}${val('imodellen', 'I modellen', f.visa)}${val('inte', 'Inte i modellen', f.visa)}${val('nyversion', 'Ny version finns', f.visa)}
        </select>
        <select onchange="ilmSattFilter('datum', this.value)" class="${lista}" title="När IFC-filens senaste version laddades upp till ACC">
          ${val('alla', 'Alla datum', f.datum)}${val('nya', `Nyare än ${ILM_GAMMAL_DAGAR} dagar`, f.datum)}${val('gamla', `Äldre än ${ILM_GAMMAL_DAGAR} dagar`, f.datum)}
        </select>
        <span id="ilm-disc-val" class="flex items-center"></span>
      </div>
      <div id="ilm-disc-rad"></div>
      <div class="flex items-center gap-3 text-[11px] text-ads-muted min-h-[1rem]">
        <span id="ilm-status-text" class="truncate"></span>
        <span class="flex-1"></span>
        <span id="ilm-status-knappar" class="flex items-center gap-3 whitespace-nowrap"></span>
      </div>
    </div>
    <div id="ilm-rulla" class="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-xs"></div>
    <div id="ilm-fot" class="shrink-0 border-t border-ads-border bg-ads-gray/50 rounded-b-lg"></div>`;
}

function ilmAccMappLank(pid, mappId) {
  return `https://${accDoman()}/docs/files/projects/${encodeURIComponent(String(pid).replace(/^b\./, ''))}`
       + `?folderUrn=${encodeURIComponent(mappId)}&viewModel=detail&moduleId=folders`;
}

// Överst: var IFC-filerna hämtas och var modellen sparas, med länk till ACC.
function ilmRitaInstallningar(pid) {
  const el = document.getElementById('ilm-inst');
  if (!el) return;
  const ix = _ilm.index.get(pid);
  if (!ix || ix.laddar) {
    ilmSatt(el, '<span class="text-ads-muted">Letar efter modellens inställningar i projektet…</span>');
    return;
  }
  const ifc = ilmIfcMapp(pid);
  const flytt = _ilm.jobb.get(`${pid}|flytt`);
  const upptagen = !!ix.flyttar || [..._ilm.jobb.values()].some(j => j.pid === pid && !j.fel);
  const vag = m => `<span class="font-medium text-ads-text truncate" title="${vkEsc(m.sokvag || '')}">${vkEsc(m.sokvag || 'vald mapp')}</span>`;
  const saknas = '<span class="text-amber-700">Ingen mapp vald</span>';
  const lank = (klick, text, av = false) => `<button onclick="${klick}" ${av ? 'disabled title="Vänta tills modellen är klar"' : ''}
      class="text-ads-blue hover:underline whitespace-nowrap disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">${text}</button>`;
  const rad = (etikett, varde, knappar) => `
    <div class="flex items-baseline gap-2 min-w-0">
      <span class="w-36 shrink-0 text-ads-muted">${etikett}</span>${varde}<span class="flex-1"></span>${knappar}
    </div>`;
  ilmSatt(el, [
    rad('IFC-filer hämtas från', ifc ? vag(ifc) : saknas,
        `${ifc ? `<a href="${ilmAccMappLank(pid, ifc.id)}" target="_blank" rel="noopener" class="text-ads-blue hover:underline whitespace-nowrap">Öppna i ACC</a>` : ''}
         ${lank(`ilmOppnaBlad('ifc')`, ifc ? 'Ändra' : 'Välj mapp')}`),
    rad('Modellen sparas i', ix.mapp ? vag(ix.mapp) : saknas,
        `${ix.mapp ? `<a href="${ilmAccMappLank(pid, ix.mapp.id)}" target="_blank" rel="noopener" class="text-ads-blue hover:underline whitespace-nowrap">Öppna i ACC</a>` : ''}
         ${lank(`ilmOppnaBlad('lagring')`, ix.mapp ? 'Ändra' : 'Välj mapp', upptagen && !!ix.mapp)}`),
    ix.dubletter ? `<div class="text-amber-700">${ix.dubletter} äldre ${ix.dubletter === 1 ? 'kopia' : 'kopior'} av ${ILM_FIL} finns också i projektet. Den senast ändrade används.</div>` : '',
    ix.fel ? `<div class="text-red-700">${vkEsc(ix.fel)} ${lank(`ilmLas('${vkEsc(pid)}', true)`, 'Försök igen')}</div>` : '',
    flytt ? `<div class="${flytt.fel ? 'text-red-700' : 'text-ads-blue'}">${vkEsc(flytt.fel || `${flytt.namn}: ${flytt.steg}…`)}</div>` : '',
  ].join(''));
}

// Disciplinväljaren, raden där disciplinkoden ställs in, och sökfältets värde.
function ilmRitaVerktyg(pid) {
  const data = ilmTrad(pid)?.data;
  const del = ilmDisciplinDel(pid);
  const koder = new Map();
  if (data && del != null) {
    for (const f of data.filer) {
      const k = ilmDisciplin(pid, f.namn, del);
      if (k) koder.set(k, (koder.get(k) || 0) + 1);
    }
  }
  if (data && _ilm.filter.disciplin && !koder.has(_ilm.filter.disciplin)) _ilm.filter.disciplin = '';
  const sortera = [...koder].sort((a, b) => a[0].localeCompare(b[0], 'sv'));
  ilmSatt(document.getElementById('ilm-disc-val'), `
    ${del != null && koder.size ? `
      <select onchange="ilmSattFilter('disciplin', this.value)" title="Disciplinkod"
              class="text-xs border border-ads-border rounded px-1.5 py-1.5 bg-white focus:outline-none focus:border-ads-blue">
        <option value="">Alla discipliner</option>
        ${sortera.map(([k, n]) => `<option value="${vkEsc(k)}" ${_ilm.filter.disciplin === k ? 'selected' : ''}>${vkEsc(k)} (${n})</option>`).join('')}
      </select>` : ''}
    <button onclick="ilmVaxlaDisc()" class="ml-2 text-[11px] text-ads-blue hover:underline whitespace-nowrap" title="Ställ in var i filnamnet disciplinkoden står">
      ${del == null ? 'Disciplinkod: av' : 'Ställ in disciplinkod'}</button>`);

  let rad = '';
  if (_ilm.discOppen) {
    const val = ilmDisciplinVal(pid);
    const nu = val == null ? 'auto' : val === -1 ? 'av' : String(val);
    const forslag = ilmForeslagenDel(data);
    const antalDelar = data?.filer.length ? Math.min(8, Math.max(...data.filer.map(f => ilmNamnDelar(f.namn).length))) : 0;
    const exempel = i => {
      const n = new Map();
      for (const f of data.filer) { const v = (ilmNamnDelar(f.namn)[i] || '').toUpperCase(); if (v) n.set(v, (n.get(v) || 0) + 1); }
      return [...n].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v]) => v).join(', ');
    };
    const opt = (v, text) => `<option value="${v}" ${nu === v ? 'selected' : ''}>${vkEsc(text)}</option>`;
    const exFil = data?.filer.find(f => ilmDisciplin(pid, f.namn, del)) || data?.filer[0];
    rad = `
      <div class="flex items-center gap-2 flex-wrap text-[11px] bg-ads-gray/70 rounded px-3 py-2">
        <span class="text-ads-text">Disciplinkoden står i</span>
        <select onchange="ilmSattDisciplin(this.value)" class="text-xs border border-ads-border rounded px-1.5 py-1 bg-white">
          ${opt('auto', forslag == null ? 'Förslag (ingen kod hittad)' : `Förslag: del ${forslag + 1} i namnet (${exempel(forslag)})`)}
          ${Array.from({ length: antalDelar }, (_, i) => opt(String(i), `Del ${i + 1} i namnet (${exempel(i)})`)).join('')}
          ${opt('av', 'Används inte')}
        </select>
        ${exFil && del != null ? `<span class="text-ads-muted">Exempel: ${vkEsc(exFil.namn)} → <b class="text-ads-text">${vkEsc(ilmDisciplin(pid, exFil.namn, del) || '–')}</b></span>` : ''}
        <span class="text-ads-muted">Namnet delas vid - _ . och mellanslag. Gäller alla i projektet.</span>
        <button onclick="ilmVaxlaDisc()" class="ml-auto text-ads-muted hover:text-ads-text">Stäng</button>
      </div>`;
  }
  ilmSatt(document.getElementById('ilm-disc-rad'), rad);
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
  delar.push('mappar med ”arkiv” i namnet visas inte');
  ilmSatt(text, delar.join(' · '));

  const k = [];
  const valbara = _ilm.synligaValbara || [];
  if (ilmFilterAktivt()) {
    if (valbara.length) {
      const modell = ilmModellKarta(pid);
      const alla = valbara.every(f => ilmArValt(pid, f.itemId, modell));
      k.push(`<button onclick="ilmMarkeraSynliga(${alla ? 'false' : 'true'})" class="text-ads-blue hover:underline">${alla ? 'Kryssa ur alla som syns' : `Kryssa i alla som syns (${valbara.length})`}</button>`);
    }
    k.push('<button onclick="ilmRensaFilter()" class="text-ads-blue hover:underline">Rensa filter</button>');
  }
  if (!t.laddar) k.push('<button onclick="ilmTradLas(_ilm.projektId, true)" class="text-ads-blue hover:underline" title="Läs IFC-mappen från ACC igen">Läs om</button>');
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

function ilmMitten(inne) {
  return `<div class="px-5 py-10 text-center text-ads-muted">${inne}</div>`;
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
  if (!ifc) {
    return ilmMitten(`
      <p class="text-ads-text">Välj först mappen där projektets IFC-filer ligger.</p>
      <p class="text-xs mt-1">Allt under den visas, utom mappar utan IFC och mappar med ”arkiv” i namnet. Valet gäller alla i projektet.</p>
      <div class="mt-4">${ilmKnapp(`ilmOppnaBlad('ifc')`, 'Välj IFC-mapp', ILM_KNAPP_HUVUD)}</div>`);
  }
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
    for (const f of x.filerI.get(mappId) || []) {
      if (syns.has(f.itemId)) html.push(ilmFilRad(pid, { ...f, sokvag: x.sokvag.get(f.mappId) }, djup, modell, del));
    }
  };
  rita(data.rotId, 0);
  _ilm.antalSynliga = syns.size;
  _ilm.synligaValbara = data.filer.filter(f => syns.has(f.itemId) && !ilmUpptagen(pid, f.itemId))
    .map(f => ({ ...f, sokvag: x.sokvag.get(f.mappId) }));

  // Filer i modellen (eller på väg in) som inte finns i trädet: i en Arkiv-mapp,
  // utanför IFC-mappen eller borttagna. De måste gå att ta bort ur modellen.
  const utanfor = [];
  for (const m of modell.values()) {
    if (!x.filer.has(m.ifc.itemId)) {
      utanfor.push({ itemId: m.ifc.itemId, namn: m.ifc.namn, sokvag: m.ifc.sokvag || '', version: m.ifc.version,
                     storlek: m.ifc.storlek, datum: m.ifc.datum || null });
    }
  }
  for (const j of _ilm.jobb.values()) {
    const id = j.ifc?.itemId;
    if (j.pid === pid && id && !x.filer.has(id) && !modell.has(id)) {
      utanfor.push({ itemId: id, namn: j.namn, sokvag: j.ifc.sokvag || '', version: null, storlek: null, datum: null });
    }
  }
  const utanforSyns = utanfor.filter(f => ilmSynlig(pid, f, modell, del));
  if (utanforSyns.length) {
    html.push(`<div class="mt-3 mb-1 mx-1 pt-3 border-t border-ads-border text-[11px] font-semibold uppercase tracking-wider text-ads-muted">
      Ingår i modellen men syns inte i IFC-mappen (${utanforSyns.length})</div>`);
    for (const f of utanforSyns) {
      const borta = _ilm.tips.get(`${pid}|${f.itemId}`)?.borta;
      html.push(ilmFilRad(pid, f, 0, modell, del, borta
        ? 'Finns inte längre i ACC'
        : 'Ligger i en Arkiv-mapp, utanför IFC-mappen eller i en mapp som inte gick att läsa'));
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
  const valbara = filer.filter(f => !ilmUpptagen(pid, f.itemId));
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

// orsak: text för filer som inte finns i trädet.
function ilmFilRad(pid, f, djup, modell, del, orsak = '') {
  const id = f.itemId;
  const j = ilmJobbFor(pid, id);
  const upptagen = !!j && !j.fel;
  const imod = modell.get(id);
  const valt = ilmArValt(pid, id, modell);
  const v = ilmVal(pid);
  const andring = imod ? v.tabort.has(id) : v.lagg.has(id);
  const i = _ilm.rader.push({ typ: 'fil', fil: f }) - 1;
  const kod = ilmDisciplin(pid, f.namn, del);
  const gammal = ilmArGammal(f.datum);
  const datumTitel = f.datum
    ? `${orsak ? 'Versionen i modellen' : `Senaste versionen i ACC${f.version ? ` (V${f.version})` : ''}`} laddades upp ${new Date(f.datum).toLocaleString('sv-SE').slice(0, 16)}${f.av ? ` av ${f.av}` : ''}.${gammal ? ` Äldre än ${ILM_GAMMAL_DAGAR} dagar.` : ''}`
    : 'Datumet är okänt';
  return `
    <div data-ilm-rad="${i}" ${upptagen ? '' : `onclick="ilmKlickFil(event, ${i})" onmousedown="if (event.shiftKey) event.preventDefault()"`}
         class="flex items-center gap-2 py-1 pr-2 rounded select-none ${upptagen ? '' : 'cursor-pointer hover:bg-ads-gray'} ${andring ? 'bg-ads-blue/10' : ''}"
         style="padding-left: ${djup * 16 + 26}px">
      <input type="checkbox" tabindex="-1" class="pointer-events-none accent-ads-blue" ${valt ? 'checked' : ''} ${upptagen ? 'disabled' : ''} />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 min-w-0">
          <span class="truncate text-ads-text ${imod ? 'font-medium' : ''}" title="${vkEsc(f.sokvag ? `${f.sokvag} / ${f.namn}` : f.namn)}">${vkEsc(f.namn)}</span>
          ${kod ? `<span class="shrink-0 px-1 rounded bg-ads-gray text-[10px] font-semibold text-ads-muted" title="Disciplinkod">${vkEsc(kod)}</span>` : ''}
          ${andring ? `<span class="shrink-0 text-[11px] text-ads-blue">${imod ? 'tas bort' : 'läggs till'}</span>` : ''}
        </div>
        ${orsak ? `<div class="text-[11px] text-amber-700 truncate" title="${vkEsc(f.sokvag)}">${vkEsc(orsak)}${f.sokvag ? ` · ${vkEsc(f.sokvag)}` : ''}</div>` : ''}
      </div>
      <span class="shrink-0 flex items-center gap-1 text-[11px]">${ilmFilStatus(pid, id, imod, j)}</span>
      <span class="shrink-0 w-24 text-right text-[11px] text-ads-muted whitespace-nowrap">${f.version ? `V${f.version} · ` : ''}${ilmStorlek(f.storlek)}</span>
      <span class="shrink-0 w-[5.5rem] text-right text-[11px] whitespace-nowrap ${gammal ? 'text-amber-800 bg-amber-100 rounded px-1' : 'text-ads-muted'}"
            title="${vkEsc(datumTitel)}">${ilmDatum(f.datum) || '–'}</span>
    </div>`;
}

function ilmJobbText(j) {
  return `${j.steg}${j.andel != null ? ` ${Math.round(j.andel * 100)} %` : ''}…`;
}

function ilmFilStatus(pid, id, imod, j) {
  const pidJs = vkEsc(pid), idJs = vkEsc(id);
  if (j && !j.fel) return `<span class="text-ads-blue" data-ilm-jobb="${vkEsc(`${pid}|${j.nyckel}`)}">${vkEsc(ilmJobbText(j))}</span>`;
  if (j?.fel) {
    return `<span class="text-red-700 max-w-[14rem] truncate" title="${vkEsc(j.fel)}">Gick inte: ${vkEsc(j.fel)}</span>
      <button onclick="event.stopPropagation(); ilmForsokIgen('${pidJs}', '${idJs}')" class="text-ads-blue hover:underline whitespace-nowrap">Försök igen</button>
      ${imod ? '' : `<button onclick="event.stopPropagation(); ilmGlomJobb('${pidJs}', '${vkEsc(j.nyckel)}')" class="text-ads-muted hover:text-ads-text" title="Glöm felet">✕</button>`}`;
  }
  if (!imod) return '';
  const t = _ilm.tips.get(`${pid}|${id}`);
  if (t?.borta) return '<span class="text-red-700">Finns inte längre i ACC</span>';
  if (ilmArInaktuell(pid, imod)) {
    const ny = t && t.version != null && imod.ifc.version != null && t.version > imod.ifc.version;
    return `<span class="text-red-700 font-medium whitespace-nowrap" title="${ny ? 'Modellen är gjord av en äldre version av IFC-filen' : 'Omvandlingen har förbättrats sedan modellen gjordes. Gör om den för att få med allt.'}">${ny ? `Modellen har V${imod.ifc.version}` : 'Behöver göras om'}</span>
      <button onclick="event.stopPropagation(); ilmUppdatera('${pidJs}', '${idJs}')" class="text-ads-blue hover:underline whitespace-nowrap">Uppdatera</button>`;
  }
  const omvandlad = imod.omvandlad ? `Omgjord ${new Date(imod.omvandlad).toLocaleString('sv-SE').slice(0, 16)}${imod.omvandladAv ? ` av ${imod.omvandladAv}` : ''}` : '';
  return `<span class="text-green-700 whitespace-nowrap" title="${vkEsc(omvandlad)}">✓ I modellen</span>`;
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
  ilmRitaLista(pid);
}

function ilmRitaVal(pid) {
  ilmRitaLista(pid);
  ilmRitaStatus(pid);
  ilmRitaFot(pid);
}

function ilmRitaFot(pid) {
  const el = document.getElementById('ilm-fot');
  if (!el) return;
  const ix = _ilm.index.get(pid);
  const v = ilmVal(pid);
  const lagg = v.lagg.size, tabort = v.tabort.size;
  const filer = ilmFiler(pid);
  const inaktuella = filer.filter(f => ilmArInaktuell(pid, f) && !ilmUpptagen(pid, f.ifc.itemId)).length;
  const pagar = [..._ilm.jobb.values()].filter(j => j.pid === pid && !j.fel && j.kalla !== 'flytt').length;
  let text;
  if (lagg || tabort) {
    const delar = [lagg ? `lägg till ${lagg}` : '', tabort ? `ta bort ${tabort}` : ''].filter(Boolean).join(', ');
    text = `<span class="text-ads-blue font-medium">${delar[0].toUpperCase()}${delar.slice(1)}. Inte sparat.</span>`
         + (ix?.mapp ? '' : ' <span class="text-amber-700">Välj först var modellen sparas.</span>');
  } else if (pagar) {
    text = `<span class="text-ads-blue">${pagar} ${pagar === 1 ? 'fil görs' : 'filer görs'} om. Det fortsätter även om fönstret stängs.</span>`;
  } else if (inaktuella) {
    text = `<span class="text-red-700">${inaktuella} ${inaktuella === 1 ? 'fil behöver' : 'filer behöver'} uppdateras.</span>`;
  } else {
    text = `<span class="text-ads-muted">${filer.length ? `${filer.length} IFC-${filer.length === 1 ? 'fil' : 'filer'} i modellen. Modellen är uppdaterad.` : 'Inga IFC-filer i modellen än. Kryssa i de som ska ingå.'}</span>`;
  }
  ilmSatt(el, `
    <div class="flex items-center gap-2 px-5 py-3">
      <div class="text-xs min-w-0 truncate">${text}</div>
      <div class="flex-1"></div>
      ${lagg || tabort
        ? `${ilmKnapp('ilmAngraVal()', 'Ångra val')}${ilmKnapp('ilmSparaVal()', 'Spara ändringar', ILM_KNAPP_HUVUD, ix?.mapp ? '' : 'disabled')}`
        : ilmKnapp(`ilmUppdateraAlla('${vkEsc(pid)}')`, `Uppdatera modellen${inaktuella ? ` (${inaktuella})` : ''}`,
                   inaktuella ? ILM_KNAPP_HUVUD : '', inaktuella ? '' : 'disabled')}
      ${ilmKnapp('ilmStang()', 'Stäng')}
    </div>`);
}

// ── Mappväljaren: IFC-mappen och lagringsmappen ───────────────────────────────
// Ett träd med bara mappar (dolda mappar och Arkiv-mappar syns inte). Byggs en
// gång och ritas sedan om med behållen rullning. Id:n innehåller tecken som
// inte passar i onclick, så raderna får löpnummer som pekar in i blad.noder.

let _ilmBladNr = 0;

function ilmOppnaBlad(syfte) {
  const pid = _ilm.projektId;
  const nu = syfte === 'ifc' ? ilmIfcMapp(pid) : _ilm.index.get(pid)?.mapp;
  const b = {
    id: `blad${++_ilmBladNr}`, syfte, pid, topp: { laddar: true }, innehall: new Map(), oppna: new Set(), noder: [],
    vald: nu ? { id: nu.id, namn: '', sokvag: nu.sokvag } : null, nu: nu?.id || null,
  };
  _ilm.blad = b;
  ilmRitaNu();
  getTopFolders(ilmHub(), pid).then(
    items => { if (_ilm.blad !== b) return; b.topp = { items: items.filter(f => !ilmDoljMapp(f)) }; ilmBladRita(); },
    err   => { if (_ilm.blad !== b) return; b.topp = { fel: vkFelText(err) }; ilmBladRita(); });
}

function ilmNod(post) {
  const noder = _ilm.blad.noder;
  let i = noder.findIndex(n => n.id === post.id);
  if (i === -1) i = noder.push(post) - 1;
  return i;
}

function ilmBladSkal(b) {
  return `
    <p class="shrink-0 px-5 pt-3 pb-2 text-xs text-ads-muted border-b border-ads-border/60">${b.syfte === 'ifc'
      ? 'Allt under mappen visas i Modellinställningar, utom mappar utan IFC och mappar med ”arkiv” i namnet. Valet gäller alla i projektet.'
      : 'Här sparas modellens filer, så att alla i projektet ser samma modell. Den som uppdaterar modellen behöver kunna skapa filer i mappen.'}</p>
    <div id="ilm-kropp" class="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-xs"></div>
    <div id="ilm-fot" class="shrink-0 border-t border-ads-border bg-ads-gray/50 rounded-b-lg"></div>`;
}

function ilmBladRita() {
  const b = _ilm.blad;
  const kropp = document.getElementById('ilm-kropp');
  if (!b || !kropp) return;
  const rull = kropp.scrollTop;
  kropp.innerHTML = ilmBladTradHtml(b);
  kropp.scrollTop = rull;
  ilmBladRitaFot();
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

function ilmBladKlick(i) {
  const b = _ilm.blad;
  const nod = b?.noder[i];
  if (!nod) return;
  b.vald = nod;
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

function ilmBladRitaFot() {
  const b = _ilm.blad;
  const el = document.getElementById('ilm-fot');
  if (!b || !el) return;
  el.innerHTML = `
    <div class="flex items-center gap-2 px-5 py-3">
      <span class="text-xs text-ads-muted truncate" title="${vkEsc(b.vald?.sokvag || '')}">${b.vald ? vkEsc(b.vald.sokvag) : 'Ingen mapp vald'}</span>
      <div class="flex-1"></div>
      ${ilmKnapp('_ilm.blad = null; ilmRitaNu()', 'Tillbaka')}
      ${ilmKnapp('ilmBladKlar()', 'Välj mappen', b.vald ? ILM_KNAPP_HUVUD : '', b.vald ? '' : 'disabled')}
    </div>`;
}

async function ilmBladKlar() {
  const b = _ilm.blad;
  if (!b?.vald) return;
  const pid = b.pid;
  const mapp = { id: b.vald.id, sokvag: b.vald.sokvag };
  _ilm.blad = null;
  if (b.syfte === 'ifc') {
    if (mapp.id !== ilmIfcMapp(pid)?.id) ilmSattIfcMapp(pid, mapp);
    ilmRitaNu();
    return;
  }
  const ix = _ilm.index.get(pid);
  if (ix?.itemId && ix.mapp) {
    if (ix.mapp.id === mapp.id) { ilmRitaNu(); return; }
    const antal = ix.data?.filer?.length || 0;
    if (!confirm(`Flytta modellen till ${mapp.sokvag}?\n\nModellens ${antal ? `${antal} ${antal === 1 ? 'fil' : 'filer'} och ` : ''}innehållsförteckning kopieras dit, och alla i projektet hittar den där. De gamla filerna ligger kvar i ${ix.mapp.sokvag} tills du tar bort dem.`)) {
      ilmRitaNu();
      return;
    }
    ilmRitaNu();
    ilmFlyttaModell(pid, mapp);
    return;
  }
  Object.assign(ix, { laddar: true, fel: null });
  ilmRitaNu();
  try {
    // En förteckning skrivs direkt: då hittar alla mappen, och behörigheten prövas.
    await ilmSkrivIndex(pid, () => {}, mapp);
  } catch (err) {
    Object.assign(ix, { laddar: false, mapp: null, fel: `Kunde inte spara i mappen: ${vkFelText(err)}` });
  }
  ilmRitaNu();
}

// IFC-mappen sparas i förteckningen (om lagringsmappen finns) och i webbläsaren.
function ilmSattIfcMapp(pid, mapp) {
  isvSparaVal(`ilm-ifcmapp:${pid}`, mapp);
  const ix = _ilm.index.get(pid);
  if (ix) {
    ix.lokalt = { ...(ix.lokalt || {}), ifcMapp: mapp };
    if (ix.data) ix.data.ifcMapp = mapp;
  }
  _ilm.oppna.delete(pid);
  ilmTradLas(pid, true);
  if (!ix?.mapp) return;
  ilmSkrivIndex(pid, d => { d.ifcMapp = mapp; }).catch(err => {
    ix.fel = `IFC-mappen kunde inte sparas i ACC och gäller bara i din webbläsare: ${vkFelText(err)}`;
    ilmRita();
  });
}

// ── Byta mapp ─────────────────────────────────────────────────────────────────
// Modellen flyttas till den nya mappen: varje .frag kopieras dit, en ny
// förteckning skrivs där, och den gamla förteckningen skrivs om till en
// hänvisning { flyttadTill } så att alla som hittar den gamla följer med
// (ilmHittaIndex). De gamla filerna ligger kvar; ACC lät inte appen ta bort filer.

async function ilmFlyttaModell(pid, mapp) {
  const ix = _ilm.index.get(pid);
  const fran = ix.mapp;
  const nyckel = `${pid}|flytt`;
  const j = { pid, nyckel: 'flytt', namn: `Flyttar modellen till ${mapp.sokvag}`, kalla: 'flytt', steg: 'Flyttar', andel: 0, fel: null };
  _ilm.jobb.set(nyckel, j);
  ix.flyttar = true;
  ilmRita();
  try {
    const farsk = await ilmHittaIndex(pid);
    const data = farsk.data || { filer: [] };
    let klara = 0;
    for (const f of data.filer) {
      ilmSteg(j, `Kopierar ${f.ifc.namn}`, klara / Math.max(1, data.filer.length));
      if (f.frag?.itemId) {
        const bytes = await ilmHamtaFil(pid, f.frag.itemId, () => {});
        const finns = await ilmFilIMapp(pid, mapp.id, f.frag.namn);
        const storage = await createStorage(pid, mapp.id, f.frag.namn);
        await uploadToStorage(storage, new Blob([bytes]));
        const item = finns ? (await createVersion(pid, finns, f.frag.namn, storage), finns) : await createItem(pid, mapp.id, f.frag.namn, storage);
        const tip = await ilmTip(pid, item);
        f.frag = { ...f.frag, itemId: item, versionId: tip.versionId || null };
        if (f.frag.versionId) isfCacheSpara(f.frag.versionId, new Uint8Array(bytes)).catch(() => {});
      }
      klara++;
    }
    ilmSteg(j, 'Sparar', 1);
    data.mapp = { id: mapp.id, sokvag: mapp.sokvag };
    if (!data.ifcMapp) data.ifcMapp = ilmIfcMapp(pid);
    if (data.disciplin === undefined) data.disciplin = ilmDisciplinVal(pid);
    const text = ilmIndexText(data);
    const iNya = await ilmFilIMapp(pid, mapp.id, ILM_FIL);
    const nyttItem = await writeTextFile(pid, mapp.id, ILM_FIL, text, iNya);
    // Den gamla förteckningen pekar vidare; skrivs sist så att den är senast ändrad.
    const hanvisning = JSON.stringify({ typ: ILM_TYP, version: 1, flyttadTill: nyttItem, mapp: data.mapp, flyttad: new Date().toISOString() }, null, 2);
    if (farsk.itemId && farsk.mapp && farsk.itemId !== nyttItem) await writeTextFile(pid, farsk.mapp.id, ILM_FIL, hanvisning, farsk.itemId);
    isvSparaVal(`ilm-index:${pid}`, nyttItem);
    Object.assign(ix, { laddar: false, fel: null, itemId: nyttItem, mapp: data.mapp, data, dubletter: 0, flyttar: false });
    _ilm.jobb.delete(nyckel);
  } catch (err) {
    console.warn('Modellinställningar: flytta', err);
    j.fel = `Flytten gick inte: ${vkFelText(err)}. Modellen ligger kvar i ${fran?.sokvag || 'den gamla mappen'}.`;
    ix.flyttar = false;
  }
  ilmUppdateraVyer(pid);
}
