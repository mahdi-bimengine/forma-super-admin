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
//               farg, omvandlad, omvandladAv }] }
// farg är modellens färg i visaren ('#RRGGBB' ur ILM_PALETT) eller null
// (modellens egna färger). Den gäller alla i projektet.
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
// utanför stänger. Jobben fortsätter även när fönstret är stängt. Det öppnas
// från modellens verktygsrad (Modeller → Modellinställningar) eller från
// rutan när projektet saknar modell. Enkelt först, djupare för den som vill
// (Mahdi, 2026-11-09): Kom igång tills båda mapparna är valda, sedan trädet med
// sök och tre val; datum, disciplin och ordning under "Fler filter"; mappar,
// automatisk uppdatering, disciplinkod och gamla filer under ⚙ Inställningar.
// Trädet med kryssrutor är modellen, och "Spara ändringar" lägger till och tar bort.

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
// "archiv" täcker engelskans archive, archived, archives (Mahdi, 2026-11-09) och tyskans Archiv.
const ILM_ARKIV = /arkiv|archiv/i;
const ILM_ARKIV_TEXT = '”arkiv” eller ”archive”';
const ILM_MAX_MAPPAR = 5000;     // skydd mot att läsa ett helt projekt av misstag
const ILM_GAMMAL_DAGAR = 14;     // IFC-filer äldre än så får gult datum
// Vanliga disciplinkoder, för att föreslå var i filnamnet koden står.
const ILM_KANDA_KODER = new Set(['A', 'B', 'E', 'F', 'G', 'I', 'K', 'L', 'M', 'P', 'R', 'S', 'T', 'U', 'V', 'W', 'Y', 'Z',
  'EL', 'VS', 'VE', 'SP', 'BR', 'ARK', 'KON', 'VVS', 'RÖR', 'SPR', 'TELE', 'STYR', 'MARK', 'GEO', 'LAND', 'KONST']);

// Färgerna en modell kan få (Mahdi, 2026-11-09, uppmätta ur hans bild). Fyra rader om tio.
const ILM_PALETT = [
  ['#000000', '#3C3C3C', '#4D4D4D', '#666666', '#808080', '#999999', '#BBBBBB', '#CCCCCC', '#DCDCDC', '#FFFFFF'],
  ['#A61A1A', '#916010', '#5D822C', '#12437F', '#006EAF', '#268D82', '#8558C5', '#C72877', '#A84A39', '#523609'],
  ['#EC4A41', '#FAA21B', '#87B340', '#4679B9', '#0696D7', '#32BCAD', '#A76EF5', '#E84396', '#F26A52', '#7D510E'],
  ['#F1A7A7', '#FDDAA4', '#B7D78C', '#A3BCDC', '#9BD5EF', '#84D7CE', '#C9A7F9', '#FF9DCE', '#FFB3A6', '#BB7A14'],
];
const ILM_FARG_VANTA_MS = 700;   // flera snabba färgklick sparas som en

const _ilm = {
  fargVantar: new Map(), // projekt-id → Map(ifc-item → färg) som inte är sparad än
  fargTimer:  new Map(), // projekt-id → väntande sparning
  fargMeny:   null,      // { nyckel, knapp, valj } när paletten är öppen (ilmPalett)
  oppen:     false,
  projektId: null,
  index:     new Map(),  // projekt-id → { laddar, fel, itemId, mapp, data, dubletter, lokalt }
  tips:      new Map(),  // "projekt|ifc-item" → { version, versionId, storlek, datum, borta } senaste i ACC
  jobb:      new Map(),  // "projekt|nyckel" → { pid, nyckel, namn, steg, andel, fel, kalla, ifc }
  ko:        [],         // jobbnycklar i tur
  arbetar:   false,
  blad:      null,       // mappträdet i steg 1 och 2 (issues-lattmodell-fonster.js)
  trad:      new Map(),  // projekt-id → IFC-mappens träd, se ilmTradLas
  val:       new Map(),  // projekt-id → { lagg: Map(item-id → fil), tabort: Set(item-id) }, inte sparat än
  oppna:     new Map(),  // projekt-id → Set med öppna mappar i trädet
  filter:    { sok: '', visa: 'alla', datum: 'alla', disciplin: '' },
  filterPid: null,       // projektet som filter, ordning och öppna mappar gäller (ilmLasMinne)
  sortering: 'namn',     // namn | nyast | aldst, per projekt
  merFilter: false,      // "Fler filter" är öppet
  detaljer:  isvLasVal('ilm-detaljer', false),   // version, storlek och disciplinkod på raderna
  steg:      null,       // 'oversikt' | 1–4 | null (bestäms när förteckningen är läst), se issues-lattmodell-fonster.js
  utkast:    new Map(),  // projekt-id → { ifcMapp, lagring, farger: Map, disciplin } som inte är sparat med Nästa
  rensa:     new Map(),  // projekt-id → ny IFC-mapps id: filer utanför den kryssas ur i steg 3 (även ilm-rensa:<id>)
  rensaKlar: new Set(),  // projekt-id där urkryssningen redan gjorts sedan steg 3 öppnades
  sparar:    false,      // Nästa sparar just nu
  stegFel:   null,       // felet från senaste Nästa
  fargGrupper: [],       // steg 4: grupperna vid senaste ritningen (klick pekar hit med löpnummer)
  fargOppna: new Set(),  // steg 4: utfällda discipliner
  omgang:    new Map(),  // projekt-id → { klara, totalt } för det som köats sedan kön senast var tom ("12 av 55")
  framsteg:  null,       // { klara, totalt } medan Nästa sparar flera saker, annars null
  utkastSparat: new Map(), // projekt-id → { tid, text } senast sparade utkast (för "Utkast sparat" och ✕)
  gamla:     null,       // { pid, laddar, fel, filer } gamla modellfiler i lagringsmappen (ilmVisaGamla)
  rader:     [],         // trädets rader vid senaste ritningen (klick pekar hit med löpnummer)
  skrivKo:   Promise.resolve(),  // sparningar av förteckningen görs en i taget
  skriver:   0,          // antal sparningar i kön eller på gång
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
  return { mapp: d.mapp || null, ifcMapp: d.ifcMapp?.id ? d.ifcMapp : null, disciplin: d.disciplin, auto: d.auto,
           filer: Array.isArray(d.filer) ? d.filer.filter(f => f?.ifc?.itemId) : [] };
}

function ilmIndexText(data) {
  return JSON.stringify({ typ: ILM_TYP, version: 1, mapp: data.mapp, ifcMapp: data.ifcMapp || null,
                          disciplin: data.disciplin ?? null, auto: !!data.auto, filer: data.filer }, null, 2);
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
// utanMinne: sök alltid (efter att den ihågkomna filen visat sig ligga i en borttagen mapp).
async function ilmHittaIndex(pid, utanMinne = false) {
  const minne = utanMinne ? null : isvLasVal(`ilm-index:${pid}`, null);
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
      Object.assign(post, await ilmHittaIndex(pid), { last: Date.now(), versionerKollade: Date.now() });
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
  _ilm.skriver++;
  const p = _ilm.skrivKo.then(() => ilmSkrivIndexNu(pid, andra, valdMapp));
  _ilm.skrivKo = p.catch(() => {});
  p.then(() => { _ilm.skriver--; }, () => { _ilm.skriver--; });
  return p;
}

// ACC:s svar när mappen har tagits bort (Mahdi, 2026-11-09, efter att den gamla
// lagringsmappen raderats): "Folder … do not exist or were deleted in database".
const ILM_BORTTAGEN_MAPP = /do not exist or were deleted/i;

async function ilmSkrivIndexNu(pid, andra, valdMapp, igen = false) {
  const farsk = await ilmHittaIndex(pid, igen);
  const mapp = farsk.itemId ? farsk.mapp : (valdMapp || _ilm.index.get(pid)?.mapp);
  if (!mapp) throw new Error('ingen mapp är vald för modellen');
  const data = farsk.data || { mapp, filer: [] };
  if (!data.ifcMapp) data.ifcMapp = ilmIfcMapp(pid);
  if (data.disciplin === undefined) data.disciplin = ilmDisciplinVal(pid);
  if (data.auto === undefined) data.auto = ilmAuto(pid);
  andra(data);
  // Färger som valts men inte sparats än följer med varje sparning, så att en
  // omvandling som blir klar under tiden inte tar bort dem.
  for (const [id, farg] of _ilm.fargVantar.get(pid) || []) {
    const f = data.filer.find(x => x.ifc.itemId === id);
    if (f) f.farg = farg;
  }
  data.mapp = { id: mapp.id, sokvag: mapp.sokvag || data.mapp?.sokvag || '' };
  const text = ilmIndexText(data);
  let itemId;
  try {
    itemId = await writeTextFile(pid, mapp.id, ILM_FIL, text, farsk.itemId);
  } catch (err) {
    if (!ILM_BORTTAGEN_MAPP.test(String(err?.message))) throw err;
    // Den ihågkomna förteckningen ligger i en borttagen mapp: glöm den och sök
    // efter modellen i projektet en gång till.
    isvSparaVal(`ilm-index:${pid}`, null);
    if (!igen) return ilmSkrivIndexNu(pid, andra, valdMapp, true);
    const ix = _ilm.index.get(pid);
    if (ix) { ix.mapp = null; ix.itemId = null; ilmUppdateraVyer(pid); }
    throw new Error('Mappen där modellen sparas finns inte längre i ACC (den har tagits bort). Välj en ny mapp för modellen.');
  }
  isvSparaVal(`ilm-index:${pid}`, itemId);
  const post = _ilm.index.get(pid) || {};
  Object.assign(post, { laddar: false, fel: null, itemId, mapp: data.mapp, data, dubletter: farsk.dubletter, last: Date.now() });
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
  ilmAutoUppdatera(pid);
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

// När IFC-versionen i modellen laddades upp. Filer omgjorda före 2026-11-09
// saknar ifc.datum; då tas det från ACC:s senaste version om den är samma.
function ilmIfcDatum(pid, f) {
  if (f.ifc.datum) return f.ifc.datum;
  const t = _ilm.tips.get(`${pid}|${f.ifc.itemId}`);
  if (t?.datum && t.version === f.ifc.version) return t.datum;
  const iTrad = ilmTrad(pid)?.data?.filer.find(x => x.itemId === f.ifc.itemId);
  return iTrad?.version === f.ifc.version ? iTrad.datum : null;
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

// Den röda bubblan på "Visa modell" när det finns uppdateringar (förbättring 7:
// fönstret öppnas från modellens verktygsrad, inte från flikens huvud).
function ilmBubblaHtml() {
  return ilmHarUppdateringar()
    ? '<span class="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-red-600 border-2 border-white" title="Modellen behöver uppdateras: det finns nyare IFC-versioner"></span>' : '';
}

// Ritar om det som visar förteckningen: bubblan, fönstret och modellrutan.
function ilmUppdateraVyer(pid) {
  const bubbla = document.getElementById('ilm-bubbla');
  if (bubbla) bubbla.innerHTML = ilmBubblaHtml();
  ilmRitaBanner?.();
  if (_ilm.oppen) ilmRita();
  if (typeof isvRitaRad === 'function') isvRitaRad();
  if (pid) isfModellAndrad?.(pid);
  if (typeof isfRitaVerktyg === 'function') isfRitaVerktyg();
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

// Allt som tar tid går i en kö, i tur och ordning: omvandlingar och flytten av
// modellen (kalla 'flytt'). Ingenting låser något annat: en ny flytt ersätter en
// väntande flytt, och en fil som görs om kan kryssas ur (ilmAvbryt).
function ilmKoa(pid, jobb) {
  const k = `${pid}|${jobb.nyckel}`;
  const nu = _ilm.jobb.get(k);
  if (nu && !nu.fel) {
    // Redan i kön: en väntande flytt får det nya målet, annat ligger kvar som det är.
    if (jobb.kalla === 'flytt' && _ilm.ko.includes(k)) Object.assign(nu, { mapp: jobb.mapp, namn: jobb.namn });
    if (nu.taBort) nu.taBort = false;   // ikryssad igen medan den görs om
    ilmUppdateraVyer(pid);
    return;
  }
  _ilm.jobb.set(k, { ...jobb, pid, steg: 'I kö', andel: null, fel: null });
  _ilm.ko.push(k);
  const o = _ilm.omgang.get(pid) || { klara: 0, totalt: 0 };
  o.totalt++;
  _ilm.omgang.set(pid, o);
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
      if (j.kalla === 'flytt') await ilmFlyttaModell(j);
      else await ilmKorJobb(j);
      _ilm.jobb.delete(k);
      // Urkryssad medan den gjordes om: tas bort ur modellen nu när den är klar.
      if (j.taBort) await ilmSkrivIndex(j.pid, d => { d.filer = d.filer.filter(x => x.ifc.itemId !== j.ifc.itemId); });
    } catch (err) {
      console.warn('Modellinställningar', err);
      j.fel = j.kalla === 'flytt' ? err.message : ilmAccFel(err);
      j.steg = '';
    }
    const o = _ilm.omgang.get(j.pid);
    if (o) o.klara++;
    // Omgången är slut när projektet inte har något kvar i kön.
    if (!ilmPagar(j.pid).length) _ilm.omgang.delete(j.pid);
    ilmUppdateraVyer(j.pid);
  }
  _ilm.arbetar = false;
}

// En fil som kryssas ur medan den väntar tas bort ur kön; görs den om just nu
// tas den bort ur modellen när den är klar.
function ilmAvbryt(pid, itemId) {
  const k = `${pid}|${itemId}`;
  const j = _ilm.jobb.get(k);
  if (!j || j.fel) return;
  if (_ilm.ko.includes(k)) {
    _ilm.ko = _ilm.ko.filter(x => x !== k);
    _ilm.jobb.delete(k);
    const o = _ilm.omgang.get(pid);
    if (o) { o.totalt = Math.max(o.klara, o.totalt - 1); if (!ilmPagar(pid).length) _ilm.omgang.delete(pid); }
  } else j.taBort = true;
  ilmUppdateraVyer(pid);
}

// Projektets jobb som väntar eller pågår (utan de som gått fel).
function ilmPagar(pid) {
  return [..._ilm.jobb.values()].filter(j => (!pid || j.pid === pid) && !j.fel);
}

// Förloppet skrivs direkt i radens text, så att listan inte ritas om hela
// tiden (då missas klick). Ett nytt steg ritar om.
function ilmSteg(j, steg, andel = null) {
  const nyttSteg = j.steg !== steg;
  j.steg = steg;
  j.andel = andel;
  ilmRitaBanner?.();
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

  ilmSteg(j, 'Bearbetar', 0);
  const frag = await ilmGorOm(bytes, a => ilmSteg(j, 'Bearbetar', a));
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
  await ilmSkrivIndex(pid, d => {
    // En uppdaterad IFC behåller sin färg.
    const fore = d.filer.find(x => x.ifc.itemId === ifc.itemId);
    d.filer = d.filer.filter(x => x.ifc.itemId !== ifc.itemId).concat({ ...post, farg: fore?.farg ?? null });
  });
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
      fel(new Error(e.message ? `bearbetningen stannade: ${e.message}` : 'bearbetningen stannade (för lite minne, eller biblioteket gick inte att hämta)'));
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

// Snabbare väg (förbättring 1, 2026-11-09): ACC:s sökning hittar alla IFC-filer
// under IFC-mappen med några få anrop, och sedan läses bara mapparna på vägen
// upp från varje fil (ett anrop per mapp, med föräldern i svaret). Ligger en
// mapp på vägen i en Arkiv-mapp eller är dold hoppas filen över. Sökningen
// kan sakna filer som laddats upp de senaste minuterna (ACC:s index), och om
// den inte går används ilmLasMappar, som läser varje mapp.
async function ilmLasMapparSok(pid, rot, t) {
  const versioner = new Map();   // item-id → senaste versionen
  const foralder = new Map();    // item-id → mapp-id
  let url = `${APS_BASE}/data/v1/projects/${pid}/folders/${encodeURIComponent(rot.id)}/search?filter[fileType]=ifc&page[limit]=200`;
  for (let sidor = 0; url && sidor < 100; sidor++) {
    if (_ilm.trad.get(pid) !== t) return null;
    const res = await bhMedOmforsok(() => apsGetUrl(url));
    for (const it of res.included || []) if (it.type === 'items') foralder.set(it.id, it.relationships?.parent?.data?.id || null);
    for (const v of res.data || []) {
      const a = v.attributes || {};
      if (/deleted/i.test(a.extension?.type || '')) continue;
      const itemId = v.relationships?.item?.data?.id;
      if (!itemId || !/\.ifc$/i.test(a.displayName || '')) continue;
      if ((versioner.get(itemId)?.attributes?.versionNumber ?? -1) >= (a.versionNumber ?? 0)) continue;
      versioner.set(itemId, v);
    }
    t.lasta++;
    t.hittade = versioner.size;
    ilmRita();
    url = res.links?.next?.href || null;
  }

  // Mapparna på vägen upp till IFC-mappen.
  const mappar = new Map([[rot.id, { id: rot.id, namn: String(rot.sokvag || '').split(' / ').pop(), foralder: null, dold: false }]]);
  const lofte = new Map();
  let ejLasta = 0;
  const lasMapp = id => {
    if (!lofte.has(id)) {
      lofte.set(id, (async () => {
        if (mappar.has(id)) return mappar.get(id);
        try {
          const res = await bhMedOmforsok(() => apsGet(`/data/v1/projects/${pid}/folders/${encodeURIComponent(id)}`));
          const m = { id, namn: vkMappNamnAv(res.data), foralder: res.data?.relationships?.parent?.data?.id || null, dold: ilmDoljMapp(res.data) };
          mappar.set(id, m);
          t.lasta++;
          ilmRita();
          return m;
        } catch {
          ejLasta++;
          return null;
        }
      })());
    }
    return lofte.get(id);
  };
  // Följer vägen uppåt; null om någon mapp på vägen döljs eller inte går att läsa.
  const vag = async id => {
    for (let n = 0; id && n < 60; n++) {
      if (id === rot.id) return true;
      const m = await lasMapp(id);
      if (!m || m.dold) return false;
      id = m.foralder;
    }
    return false;
  };
  const filer = [];
  const kandidater = [...versioner.entries()];
  let i = 0;
  const arbetare = async () => {
    while (i < kandidater.length) {
      const [itemId, v] = kandidater[i++];
      const mappId = foralder.get(itemId);
      if (!mappId || !await vag(mappId)) continue;
      const a = v.attributes || {};
      filer.push({ itemId, namn: a.displayName, mappId, version: a.versionNumber ?? null, versionId: v.id || null,
                   storlek: a.storageSize ?? null, datum: a.createTime || a.lastModifiedTime || null,
                   av: a.createUserName || a.lastModifiedUserName || '' });
    }
  };
  await Promise.all(Array.from({ length: 6 }, arbetare));
  const anvanda = new Set([rot.id]);
  for (const f of filer) for (let id = f.mappId, n = 0; id && id !== rot.id && n < 60; id = mappar.get(id)?.foralder, n++) anvanda.add(id);
  return { rotId: rot.id, rotSokvag: rot.sokvag || '', mappar: [...mappar.values()].filter(m => anvanda.has(m.id)).map(({ dold, ...m }) => m),
           filer, ejLasta, forManga: false, sokning: true };
}

// Läser IFC-mappens träd en gång per session (eller om, med tvinga). Det
// senast lästa trädet visas direkt ur webbläsarens lager medan det läses om.
// Mappstrukturen läses om när den är äldre än så här (när fönstret eller steg 3 öppnas).
const ILM_TRAD_MAX_ALDER_MS = 5 * 60 * 1000;

// noggrann: läs mapp för mapp i stället för med ACC:s sökning. Sökningen är
// snabb men kan sakna filer och mappar som lagts till de senaste minuterna;
// "Läs om" läser därför noggrant.
function ilmTradLas(pid, tvinga = false, noggrann = false) {
  const mapp = ilmIfcMapp(pid);
  if (!mapp) return;
  let t = _ilm.trad.get(pid);
  if (t && t.mappId !== mapp.id) t = null;
  if (t && (t.laddar || (t.farsk && !tvinga && Date.now() - (t.tid || 0) < ILM_TRAD_MAX_ALDER_MS))) return;
  if (!t) {
    t = { mappId: mapp.id, laddar: false, data: null, fel: null, tid: null, farsk: false, lasta: 0, hittade: 0 };
    _ilm.trad.set(pid, t);
    ilmTradFranLager(pid, t);
  }
  Object.assign(t, { laddar: true, fel: null, lasta: 0, hittade: 0 });
  ilmRita();
  // Sökningen först; går den inte läses mapparna en och en.
  (noggrann ? ilmLasMappar(pid, mapp, t) : ilmLasMapparSok(pid, mapp, t).catch(err => {
    console.warn('Modellinställningar: sökningen gick inte, läser mapparna en och en', err);
    if (_ilm.trad.get(pid) !== t) return null;
    Object.assign(t, { lasta: 0, hittade: 0 });
    return ilmLasMappar(pid, mapp, t);
  })).then(data => {
    if (!data || _ilm.trad.get(pid) !== t) return;
    Object.assign(t, { laddar: false, data, tid: Date.now(), farsk: true });
    ilmTradTillLager(pid, t);
    ilmTipsFranTrad(pid, data);
    ilmUppdateraVyer();
    ilmAutoUppdatera(pid);
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
      t.data = ilmRensaTrad(v.data);
      t.tid = v.tid;
      ilmRita();
    }
  } catch { /* utan lager läses trädet bara från ACC */ }
}

// Tar bort arkivmappar (och allt under dem) ur ett träd som sparades i
// webbläsaren innan regeln för vilka mappar som döljs ändrades. IFC-mappen
// själv döljs aldrig, även om den heter något med arkiv.
function ilmRensaTrad(data) {
  const bort = new Set(data.mappar.filter(m => m.id !== data.rotId && ILM_ARKIV.test(m.namn || '')).map(m => m.id));
  if (!bort.size) return data;
  const foralder = new Map(data.mappar.map(m => [m.id, m.foralder]));
  const under = id => {
    for (let n = 0; id && n < 200; id = foralder.get(id), n++) if (bort.has(id)) return true;
    return false;
  };
  return { ...data, mappar: data.mappar.filter(m => !under(m.id)), filer: data.filer.filter(f => !under(f.mappId)) };
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
  ilmSparaMinne(pid);
  ilmRita();
  if (!ix.mapp) return;   // sparas med förteckningen när lagringsmappen väljs
  try {
    await ilmSkrivIndex(pid, d => { d.disciplin = val; });
  } catch (err) {
    alert(`Inställningen för disciplinkoden kunde inte sparas i ACC: ${vkFelText(err)}`);
  }
}

// ── Val som inte är sparade ───────────────────────────────────────────────────
// En kryssruta visar om filen ingår: i modellen och inte urkryssad, eller
// ikryssad men inte sparad. En fil som görs om räknas som ikryssad, men går
// att kryssa ur (den tas då ur kön eller ur modellen när steg 3 sparas).

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
  const v = ilmVal(pid);
  if (ilmUpptagen(pid, itemId)) return !v.tabort.has(itemId) && !ilmJobbFor(pid, itemId).taBort;
  return modell.has(itemId) ? !v.tabort.has(itemId) : v.lagg.has(itemId);
}

function ilmSattVal(pid, fil, pa, modell) {
  const v = ilmVal(pid), id = fil.itemId;
  if (ilmUpptagen(pid, id) || modell.has(id)) { if (pa) v.tabort.delete(id); else v.tabort.add(id); }
  else if (pa) v.lagg.set(id, fil);
  else v.lagg.delete(id);
}

function ilmHarAndringar(pid) {
  const v = _ilm.val.get(pid);
  return !!v && (v.lagg.size + v.tabort.size) > 0;
}

function ilmForsokIgen(pid, itemId) {
  const j = ilmJobbFor(pid, itemId);
  if (j?.ifc) ilmKoa(pid, { nyckel: j.nyckel, namn: j.namn, kalla: j.kalla, ifc: j.ifc });
}

function ilmGlomJobb(pid, nyckel) {
  _ilm.jobb.delete(`${pid}|${nyckel}`);
  ilmRita();
}

// ── Färger ────────────────────────────────────────────────────────────────────
// En färg per modell, vald i paletten och sparad i förteckningen för alla i
// projektet. Färgen syns direkt; själva sparningen väntar en kort stund så att
// flera snabba klick blir en sparning. Paletten ligger i fönstret, utanför
// listan, så att den inte försvinner när listan ritas om.

function ilmFarg(pid, itemId) {
  return ilmFiler(pid).find(f => f.ifc.itemId === itemId)?.farg || null;
}

function ilmFargRuta(farg) {
  // Ingen färg: vit med ett rött snedstreck, som i paletten.
  const ingen = 'background: linear-gradient(to top right, #fff calc(50% - 1px), #DC2626 calc(50% - 1px), #DC2626 calc(50% + 1px), #fff calc(50% + 1px))';
  return farg ? `background: ${farg}` : ingen;
}

function ilmSattFarg(pid, itemId, farg) {
  const f = ilmFiler(pid).find(x => x.ifc.itemId === itemId);
  if (!f || (f.farg || null) === farg) return;
  f.farg = farg;
  if (!_ilm.fargVantar.has(pid)) _ilm.fargVantar.set(pid, new Map());
  _ilm.fargVantar.get(pid).set(itemId, farg);
  ilmRita();
  isfModellAndrad?.(pid);
  clearTimeout(_ilm.fargTimer.get(pid));
  _ilm.fargTimer.set(pid, setTimeout(() => ilmSparaFarger(pid), ILM_FARG_VANTA_MS));
}

// ACC:s eget felmeddelande ("detail") i stället för hela svaret, som annars
// kortas av mitt i (Mahdi fick "…detail":"Fold…" 2026-11-09).
function ilmAccFel(err) {
  const text = String(err?.message || err);
  const m = text.match(/^APS error (\d+): ([\s\S]*)$/);
  if (m && !/^40[13]$/.test(m[1])) {
    try {
      const e = JSON.parse(m[2]).errors?.[0];
      if (e) return `${e.detail || e.title || 'okänt fel'} (ACC svarade ${m[1]}${e.code ? `, ${e.code}` : ''})`;
    } catch { /* inte JSON */ }
  }
  return vkFelText(err);
}

// Misslyckas sparningen görs två nya försök (efter 4 och 8 sekunder) innan
// användaren får veta. Färgerna ligger kvar i fargVantar och följer annars med
// nästa sparning av modellen.
async function ilmSparaFarger(pid, forsok = 0) {
  const vantar = _ilm.fargVantar.get(pid);
  if (!vantar?.size) return;
  const sparas = new Map(vantar);
  try {
    await ilmSkrivIndex(pid, () => {});   // de väntande färgerna läggs i av ilmSkrivIndexNu
    // Det som valts under sparningen ligger kvar till nästa gång.
    for (const [id, farg] of sparas) if (vantar.get(id) === farg) vantar.delete(id);
  } catch (err) {
    console.warn(`Modellinställningar: färgerna kunde inte sparas (försök ${forsok + 1})`, err);
    if (forsok < 2) { setTimeout(() => ilmSparaFarger(pid, forsok + 1), 4000 * (forsok + 1)); return; }
    alert(`Färgen kunde inte sparas i ACC, inte heller efter två nya försök:\n\n${ilmAccFel(err)}\n\n`
        + 'Den syns bara för dig tills sidan laddas om, och följer med nästa gång modellen sparas.');
  }
}

// Färga efter disciplin (Mahdi, 2026-11-09): en dialog listar disciplinerna i
// modellen med en färg var, som går att byta i paletten. Förslaget är färgen
// filerna redan har (om alla med koden har samma), annars en fast färg för
// vanliga koder och nästa lediga färg för övriga. Allt sparas i en sparning.
const ILM_DISCIPLIN_FARG = {
  A: '#FDDAA4', ARK: '#FDDAA4', K: '#999999', KON: '#999999', KONST: '#999999',
  V: '#006EAF', VVS: '#006EAF', VS: '#4679B9', VE: '#9BD5EF', R: '#268D82', 'RÖR': '#268D82',
  S: '#EC4A41', SP: '#EC4A41', SPR: '#EC4A41', BR: '#C72877', E: '#FAA21B', EL: '#FAA21B',
  T: '#8558C5', TELE: '#8558C5', STYR: '#A76EF5', L: '#87B340', LAND: '#87B340',
  M: '#5D822C', MARK: '#5D822C', G: '#916010', GEO: '#916010', B: '#A84A39',
};
const ILM_EXTRA_FARGER = ['#E84396', '#32BCAD', '#F26A52', '#12437F', '#7D510E', '#C9A7F9', '#84D7CE', '#FF9DCE', '#B7D78C', '#523609'];

// Modellens filer grupperade efter disciplinkod: [{ kod, filer }], sorterade.
function ilmDisciplinGrupper(pid) {
  const del = ilmDisciplinDel(pid);
  if (del == null) return [];
  const grupper = new Map();
  for (const f of ilmFiler(pid)) {
    const k = ilmDisciplin(pid, f.ifc.namn, del);
    if (!k) continue;
    if (!grupper.has(k)) grupper.set(k, []);
    grupper.get(k).push(f);
  }
  return [...grupper].sort((a, b) => a[0].localeCompare(b[0], 'sv')).map(([kod, filer]) => ({ kod, filer }));
}

// ── Datum ─────────────────────────────────────────────────────────────────────

function ilmArGammal(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) && Date.now() - t > ILM_GAMMAL_DAGAR * 86400000;
}

function ilmDatum(iso) {
  const d = new Date(iso || '');
  return isNaN(d) ? '' : d.toLocaleDateString('sv-SE');
}

function ilmAccMappLank(pid, mappId) {
  return `https://${accDoman()}/docs/files/projects/${encodeURIComponent(String(pid).replace(/^b\./, ''))}`
       + `?folderUrn=${encodeURIComponent(mappId)}&viewModel=detail&moduleId=folders`;
}

// Förteckningen först (den säger vilken IFC-mappen är), sedan trädet. Är
// förteckningen redan läst läses den om i bakgrunden, så att andras ändringar syns.
function ilmLasOchTrad(pid) {
  const redan = _ilm.index.get(pid);
  Promise.resolve(ilmLas(pid)).then(() => {
    if (!(_ilm.oppen && _ilm.projektId === pid)) return;
    ilmTradLas(pid);
    ilmRita();
    if (redan) ilmLasOm(pid);
    ilmAutoUppdatera(pid);
  });
}

// ── Andras ändringar ──────────────────────────────────────────────────────────
// Förteckningen läses om i bakgrunden när fönstret eller modellen öppnas och
// var femte minut medan någon av dem är öppen, så att det andra har lagt till,
// tagit bort eller färgat syns utan omladdning. IFC-versionerna kollas om högst
// var femte minut. Inget läses medan en egen sparning pågår.
const ILM_LAS_OM_MS = 30 * 1000;
const ILM_VERSIONER_OM_MS = 5 * 60 * 1000;

async function ilmLasOm(pid) {
  const ix = _ilm.index.get(pid);
  if (!pid || !ix || ix.laddar || ix.lasOm || _ilm.skriver > 0 || Date.now() - (ix.last || 0) < ILM_LAS_OM_MS) return;
  ix.lasOm = true;
  try {
    const fil = await ilmHittaIndex(pid);
    if (!fil.itemId || _ilm.skriver > 0) return;
    for (const [id, farg] of _ilm.fargVantar.get(pid) || []) {
      const f = fil.data?.filer.find(x => x.ifc.itemId === id);
      if (f) f.farg = farg;
    }
    const fore = JSON.stringify(ix.data);
    Object.assign(ix, { itemId: fil.itemId, mapp: fil.mapp, data: fil.data, dubletter: fil.dubletter, fel: null, last: Date.now() });
    if (ix.data?.ifcMapp) isvSparaVal(`ilm-ifcmapp:${pid}`, ix.data.ifcMapp);
    if (JSON.stringify(ix.data) !== fore) ilmUppdateraVyer(pid);
    if (Date.now() - (ix.versionerKollade || 0) > ILM_VERSIONER_OM_MS) {
      ix.versionerKollade = Date.now();
      await ilmKollaVersioner(pid);
    }
  } catch { /* nästa gång */ } finally {
    ix.lasOm = false;
  }
}

setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (_ilm.oppen) ilmLasOm(_ilm.projektId);
  else if (typeof _isv !== 'undefined' && _isv.pa && _isf.projektId) ilmLasOm(_isf.projektId);
}, 5 * 60 * 1000);

// ── Gamla modellfiler ─────────────────────────────────────────────────────────
// Modellfiler (.frag) i lagringsmappen som förteckningen inte längre pekar på,
// till exempel efter att en IFC tagits bort ur modellen eller modellen flyttats.
// Appen får inte radera filer i ACC, så de listas med en länk.
async function ilmVisaGamla(pid) {
  if (_ilm.gamla?.pid === pid) { _ilm.gamla = null; ilmRita(); return; }
  const mapp = _ilm.index.get(pid)?.mapp;
  if (!mapp) return;
  const g = _ilm.gamla = { pid, laddar: true, fel: null, filer: [] };
  ilmRita();
  try {
    const { poster, tips } = await getFolderContentsWithTips(pid, mapp.id);
    const anvanda = new Set(ilmFiler(pid).map(f => f.frag?.itemId).filter(Boolean));
    g.filer = poster.filter(p => p.type === 'items' && /\.frag$/i.test(p.attributes?.displayName || '') && !anvanda.has(p.id))
      .map(p => {
        const a = tipVersionOf(p, tips)?.attributes || {};
        return { namn: p.attributes.displayName, storlek: a.storageSize ?? null, datum: a.createTime || p.attributes?.lastModifiedTime || null };
      })
      .sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
  } catch (err) {
    g.fel = vkFelText(err);
  }
  g.laddar = false;
  if (_ilm.gamla === g) ilmRita();
}

// ── Automatisk uppdatering ────────────────────────────────────────────────────
// Gäller hela projektet (auto i förteckningen). När någon har modellen eller
// fönstret öppet och en vald IFC har en nyare version görs den om i den
// personens webbläsare, en gång per session. Filer över ILM_STOR_IFC görs inte
// om automatiskt.
function ilmAuto(pid) {
  return !!_ilm.index.get(pid)?.data?.auto;
}

async function ilmSattAuto(pa) {
  const pid = _ilm.projektId;
  const ix = _ilm.index.get(pid);
  if (!ix?.data) return;
  ix.data.auto = pa;
  ilmRita();
  try {
    await ilmSkrivIndex(pid, d => { d.auto = pa; });
    if (pa) ilmAutoUppdatera(pid);
  } catch (err) {
    alert(`Inställningen kunde inte sparas i ACC: ${ilmAccFel(err)}`);
    ilmLas(pid, true);
  }
}

const _ilmAutoKord = new Set();

function ilmAutoUppdatera(pid) {
  if (!pid || !ilmAuto(pid) || ilmLaddar(pid)) return;
  if (!_ilm.oppen && !_isv.pa) return;
  for (const f of ilmFiler(pid)) {
    if (!ilmArInaktuell(pid, f) || ilmUpptagen(pid, f.ifc.itemId)) continue;
    const t = _ilm.tips.get(`${pid}|${f.ifc.itemId}`);
    const nyckel = `${pid}|${f.ifc.itemId}|${t?.version ?? f.ifc.version}|${ILM_FORMAT}`;
    if (_ilmAutoKord.has(nyckel)) continue;
    _ilmAutoKord.add(nyckel);
    if ((t?.storlek ?? f.ifc.storlek) > ILM_STOR_IFC) continue;
    ilmKoa(pid, { nyckel: f.ifc.itemId, namn: f.ifc.namn, kalla: f.kalla, ifc: { itemId: f.ifc.itemId, namn: f.ifc.namn, sokvag: f.ifc.sokvag } });
  }
}

// ── Mapparna ──────────────────────────────────────────────────────────────────

// IFC-mappen sparas i förteckningen (om lagringsmappen finns) och i webbläsaren.
// Filer i modellen som inte ligger under den nya mappen tas bort ur modellen i
// steg 3 (Mahdi, 2026-11-09: "behåll inte").
async function ilmSattIfcMapp(pid, mapp) {
  isvSparaVal(`ilm-ifcmapp:${pid}`, mapp);
  const ix = _ilm.index.get(pid);
  if (ix) {
    ix.lokalt = { ...(ix.lokalt || {}), ifcMapp: mapp };
    if (ix.data) ix.data.ifcMapp = mapp;
  }
  _ilm.oppna.delete(pid);
  ilmSparaMinne(pid);
  ilmTradLas(pid, true);
  if (!ix?.mapp) return;
  await ilmSkrivIndex(pid, d => { d.ifcMapp = mapp; });
}

// Lagringsmappen. Finns ingen modell än skrivs en tom förteckning direkt (då
// hittar alla mappen, och behörigheten prövas). Finns modellen läggs en flytt i
// kön (ilmKoa), efter det som redan görs om.
async function ilmSattLagring(pid, mapp) {
  const ix = _ilm.index.get(pid);
  if (ix?.itemId && ix.mapp) {
    if (ix.mapp.id === mapp.id) return;
    ilmKoa(pid, { nyckel: 'flytt', namn: `Flyttar modellen till ${mapp.sokvag}`, kalla: 'flytt', mapp, fran: ix.mapp });
    return;
  }
  await ilmSkrivIndex(pid, () => {}, mapp);
}

// Mappen modellen flyttas till, om en flytt väntar eller pågår.
function ilmFlyttMal(pid) {
  const j = _ilm.jobb.get(`${pid}|flytt`);
  return j && !j.fel ? j.mapp : null;
}

// ── Byta mapp ─────────────────────────────────────────────────────────────────
// Modellen flyttas till den nya mappen: varje .frag kopieras dit, en ny
// förteckning skrivs där, och den gamla förteckningen skrivs om till en
// hänvisning { flyttadTill } så att alla som hittar den gamla följer med
// (ilmHittaIndex). De gamla filerna ligger kvar; ACC lät inte appen ta bort filer.
// Flytten är ett jobb i samma kö som omvandlingarna (ilmArbeta): omvandlingar
// som köades före den blir klara och kopieras med, de som köas efter sparas i
// den nya mappen. Själva skrivningen går i skrivkön, så en färg som väljs under
// flytten sparas efteråt i den nya mappen.
function ilmFlyttaModell(j) {
  _ilm.skriver++;
  const p = _ilm.skrivKo.then(() => ilmFlyttaModellNu(j));
  _ilm.skrivKo = p.catch(() => {});
  p.finally(() => { _ilm.skriver--; });
  return p;
}

async function ilmFlyttaModellNu(j) {
  const { pid, mapp } = j;
  const ix = _ilm.index.get(pid);
  ix.flyttar = true;
  ilmSteg(j, 'Flyttar', 0);
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
    if (data.auto === undefined) data.auto = ilmAuto(pid);
    for (const [id, farg] of _ilm.fargVantar.get(pid) || []) {
      const f = data.filer.find(x => x.ifc.itemId === id);
      if (f) f.farg = farg;
    }
    const iNya = await ilmFilIMapp(pid, mapp.id, ILM_FIL);
    const nyttItem = await writeTextFile(pid, mapp.id, ILM_FIL, ilmIndexText(data), iNya);
    // Den gamla förteckningen pekar vidare; skrivs sist så att den är senast ändrad.
    const hanvisning = JSON.stringify({ typ: ILM_TYP, version: 1, flyttadTill: nyttItem, mapp: data.mapp, flyttad: new Date().toISOString() }, null, 2);
    if (farsk.itemId && farsk.mapp && farsk.itemId !== nyttItem) {
      // Är den gamla mappen redan borttagen behövs ingen hänvisning.
      await writeTextFile(pid, farsk.mapp.id, ILM_FIL, hanvisning, farsk.itemId)
        .catch(err => { if (!ILM_BORTTAGEN_MAPP.test(String(err?.message))) throw err; });
    }
    isvSparaVal(`ilm-index:${pid}`, nyttItem);
    Object.assign(ix, { laddar: false, fel: null, itemId: nyttItem, mapp: data.mapp, data, dubletter: 0, flyttar: false, flyttadFran: j.fran || null });
  } catch (err) {
    ix.flyttar = false;
    throw new Error(`Flytten gick inte: ${ilmAccFel(err)}. Modellen ligger kvar i ${j.fran?.sokvag || 'den gamla mappen'}.`);
  }
}
