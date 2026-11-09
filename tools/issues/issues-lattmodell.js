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
  discDialog: null,      // { pid, grupper, farger } när "Färga modellen efter disciplin" är öppen
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
  filterPid: null,       // projektet som filter, ordning och öppna mappar gäller (ilmLasMinne)
  sortering: 'namn',     // namn | nyast | aldst, per projekt
  merFilter: false,      // "Fler filter" är öppet
  detaljer:  isvLasVal('ilm-detaljer', false),   // version, storlek och disciplinkod på raderna
  sida:      null,       // 'inst' när Inställningar visas
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

async function ilmSkrivIndexNu(pid, andra, valdMapp) {
  const farsk = await ilmHittaIndex(pid);
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
  const itemId = await writeTextFile(pid, mapp.id, ILM_FIL, text, farsk.itemId);
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

// Tar bort projektets filer som väntar i kön (inte den som görs om just nu).
function ilmTomKo(pid) {
  const bort = _ilm.ko.filter(k => k.startsWith(`${pid}|`) && _ilm.jobb.get(k)?.steg === 'I kö');
  _ilm.ko = _ilm.ko.filter(k => !bort.includes(k));
  for (const k of bort) _ilm.jobb.delete(k);
  ilmUppdateraVyer(pid);
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
  // Sökningen först; går den inte läses mapparna en och en.
  ilmLasMapparSok(pid, mapp, t).catch(err => {
    console.warn('Modellinställningar: sökningen gick inte, läser mapparna en och en', err);
    if (_ilm.trad.get(pid) !== t) return null;
    Object.assign(t, { lasta: 0, hittade: 0 });
    return ilmLasMappar(pid, mapp, t);
  }).then(data => {
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
  ilmRitaNu();
  if (!ix.mapp) return;   // sparas med förteckningen när lagringsmappen väljs
  try {
    await ilmSkrivIndex(pid, d => { d.disciplin = val; });
  } catch (err) {
    alert(`Inställningen för disciplinkoden kunde inte sparas i ACC: ${vkFelText(err)}`);
  }
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

// Paletten: Mahdis färger och "Ingen färg", under (eller ovanför) knappen som
// öppnade den. valj(farg) får '#RRGGBB' eller null. nyckel säger vad paletten
// gäller, så att ett nytt klick på samma knapp stänger den.
function ilmPalett(knapp, { nyckel, nu, rubrik, valj }) {
  const fonster = document.querySelector('#ilm-ruta .ilm-fonster');
  if (_ilm.fargMeny?.nyckel === nyckel) { ilmStangFargMeny(); return; }
  ilmStangFargMeny();
  if (!fonster || !knapp) return;
  _ilm.fargMeny = { nyckel, knapp, valj };
  const cirkel = (farg, titel) => `
    <button onclick="ilmValjFarg(${farg ? `'${farg}'` : 'null'})" title="${titel}"
            class="w-6 h-6 rounded-full border ${farg === nu ? 'ring-2 ring-offset-2 ring-ads-blue' : ''} ${farg === '#FFFFFF' || !farg ? 'border-ads-border' : 'border-transparent'} hover:scale-110 transition-transform"
            style="${ilmFargRuta(farg)}"></button>`;
  const meny = document.createElement('div');
  meny.id = 'ilm-fargmeny';
  meny.className = 'absolute z-50 w-max left-0 top-0 bg-white rounded-lg shadow-xl border border-ads-border p-3';
  meny.innerHTML = `
    <div class="text-[11px] text-ads-muted mb-2 max-w-[19rem] truncate" title="${vkEsc(rubrik)}">${vkEsc(rubrik)}</div>
    <div class="grid grid-cols-10 gap-1.5">${ILM_PALETT.flat().map(f => cirkel(f, f)).join('')}</div>
    <div class="mt-2 flex items-center gap-2">${cirkel(null, 'Ingen färg: modellens egna färger')}<span class="text-[11px] text-ads-muted">Ingen färg</span></div>`;
  meny.addEventListener('mousedown', ev => ev.stopPropagation());
  fonster.appendChild(meny);
  // Under rutan, eller ovanför om den inte får plats.
  const f = fonster.getBoundingClientRect(), k = knapp.getBoundingClientRect(), m = meny.getBoundingClientRect();
  // Rutorna i listan sitter till höger: paletten slutar vid rutan. I dialogen sitter de till vänster: den börjar där.
  const vanster = Math.max(8, Math.min(k.right - f.left > f.width / 2 ? k.right - f.left - m.width : k.left - f.left, f.width - m.width - 8));
  const under = k.bottom - f.top + 6;
  meny.style.left = `${vanster}px`;
  meny.style.top = `${under + m.height > f.height - 8 ? Math.max(8, k.top - f.top - m.height - 6) : under}px`;
  setTimeout(() => document.addEventListener('mousedown', ilmFargUtanfor), 0);
  for (const id of ['ilm-rulla', 'ilm-disc-lista']) document.getElementById(id)?.addEventListener('scroll', ilmStangFargMeny, { once: true });
}

function ilmFargMeny(e, pid, itemId) {
  e.stopPropagation();
  const namn = ilmFiler(pid).find(f => f.ifc.itemId === itemId)?.ifc.namn || '';
  ilmPalett(e.currentTarget, { nyckel: `fil|${itemId}`, nu: ilmFarg(pid, itemId), rubrik: `Färg för ${namn}`,
                               valj: farg => ilmSattFarg(pid, itemId, farg) });
}

// Ett klick utanför stänger paletten; ett klick på samma färgruta stänger den via ilmPalett.
function ilmFargUtanfor(e) {
  if (_ilm.fargMeny?.knapp?.contains(e.target)) return;
  ilmStangFargMeny();
}

function ilmStangFargMeny() {
  _ilm.fargMeny = null;
  document.getElementById('ilm-fargmeny')?.remove();
  document.removeEventListener('mousedown', ilmFargUtanfor);
}

function ilmValjFarg(farg) {
  const m = _ilm.fargMeny;
  ilmStangFargMeny();
  m?.valj(farg);
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

function ilmFargaEfterDisciplin() {
  const pid = _ilm.projektId;
  const grupper = ilmDisciplinGrupper(pid);
  if (!grupper.length) { alert('Ingen fil i modellen har en disciplinkod.'); return; }
  const lediga = ILM_EXTRA_FARGER.filter(f => !grupper.some(g => ILM_DISCIPLIN_FARG[g.kod] === f));
  const farger = new Map();
  for (const g of grupper) {
    const nu = [...new Set(g.filer.map(f => f.farg || null))];
    farger.set(g.kod, nu.length === 1 && nu[0] ? nu[0] : (ILM_DISCIPLIN_FARG[g.kod] || lediga.shift() || '#808080'));
  }
  _ilm.discDialog = { pid, grupper, farger };
  ilmRitaDiscDialog();
}

// Dialogen ligger i fönstret, över allt annat utom paletten.
function ilmRitaDiscDialog() {
  const d = _ilm.discDialog;
  const fonster = document.querySelector('#ilm-ruta .ilm-fonster');
  let el = document.getElementById('ilm-discdialog');
  if (!d || !fonster) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'ilm-discdialog';
    el.className = 'absolute inset-0 z-40 flex items-center justify-center bg-black/30 rounded-lg p-6';
    el.addEventListener('mousedown', ev => { if (ev.target === el) ilmStangDiscDialog(); });
    fonster.appendChild(el);
  }
  const lista = document.getElementById('ilm-disc-lista');
  const rull = lista?.scrollTop || 0;
  const antal = n => `${n} ${n === 1 ? 'fil' : 'filer'}`;
  const utan = ilmFiler(d.pid).length - d.grupper.reduce((s, g) => s + g.filer.length, 0);
  el.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="ilm-disc-rubrik"
         class="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-full flex flex-col text-xs">
      <div class="px-5 pt-4 pb-2">
        <h4 id="ilm-disc-rubrik" class="text-sm font-semibold text-ads-text">Färga modellen efter disciplin</h4>
        <p class="text-ads-muted mt-1">Välj en färg för varje disciplin i modellen. Klicka på en färg för att byta. Gäller alla i projektet.</p>
      </div>
      <div id="ilm-disc-lista" class="flex-1 min-h-0 overflow-y-auto px-5 py-1">
        ${d.grupper.map((g, i) => `
          <div class="flex items-center gap-3 py-1.5 border-b border-ads-border/40 last:border-0">
            <button onclick="ilmDiscPalett(event, ${i})" title="Byt färg för ${vkEsc(g.kod)}"
                    class="shrink-0 w-6 h-6 rounded-full border border-ads-border hover:ring-2 hover:ring-ads-blue/40" style="${ilmFargRuta(d.farger.get(g.kod))}"></button>
            <span class="shrink-0 w-14 font-semibold text-ads-text">${vkEsc(g.kod)}</span>
            <span class="min-w-0 flex-1 truncate text-ads-muted" title="${vkEsc(g.filer.map(f => f.ifc.namn).join('\n'))}">${antal(g.filer.length)}: ${vkEsc(g.filer.slice(0, 2).map(f => f.ifc.namn).join(', '))}${g.filer.length > 2 ? ', …' : ''}</span>
          </div>`).join('')}
      </div>
      ${utan ? `<p class="px-5 pt-2 text-[11px] text-ads-muted">${antal(utan)} utan disciplinkod behåller sin färg.</p>` : ''}
      <div class="flex items-center gap-2 px-5 py-3 mt-1 border-t border-ads-border">
        <span class="flex-1"></span>
        ${ilmKnapp('ilmStangDiscDialog()', 'Avbryt')}
        ${ilmKnapp('ilmDiscDialogKlar()', 'Färga modellen', ILM_KNAPP_HUVUD)}
      </div>
    </div>`;
  const ny = document.getElementById('ilm-disc-lista');
  if (ny) ny.scrollTop = rull;
}

function ilmDiscPalett(e, i) {
  e.stopPropagation();
  const d = _ilm.discDialog;
  const g = d?.grupper[i];
  if (!g) return;
  ilmPalett(e.currentTarget, { nyckel: `disc|${g.kod}`, nu: d.farger.get(g.kod), rubrik: `Färg för disciplin ${g.kod}`,
                               valj: farg => { d.farger.set(g.kod, farg); ilmRitaDiscDialog(); } });
}

function ilmStangDiscDialog() {
  ilmStangFargMeny();
  _ilm.discDialog = null;
  ilmRitaDiscDialog();
}

function ilmDiscDialogKlar() {
  const d = _ilm.discDialog;
  ilmStangDiscDialog();
  if (!d) return;
  for (const g of d.grupper) for (const f of g.filer) ilmSattFarg(d.pid, f.ifc.itemId, d.farger.get(g.kod) ?? null);
}

// ── Filter ────────────────────────────────────────────────────────────────────
// Synligt från början: sökfältet och Alla / I modellen / Inte i modellen (och
// Ny version när det finns sådana). Datum, disciplin och ordning ligger under
// "Fler filter"; aktiva filter därifrån visas som etiketter med ✕. Filter,
// ordning och öppna mappar minns per projekt i webbläsaren (ilm-minne:<id>),
// utom söktexten och "Ny version" (som annars ger en tom lista när allt är
// uppdaterat).

function ilmTomtFilter() {
  return { sok: '', visa: 'alla', datum: 'alla', disciplin: '' };
}

function ilmLasMinne(pid) {
  const m = isvLasVal(`ilm-minne:${pid}`, null) || {};
  const sok = _ilm.filterPid === pid ? _ilm.filter.sok : '';
  _ilm.filterPid = pid;
  _ilm.filter = {
    sok,
    visa: ['imodellen', 'inte'].includes(m.visa) ? m.visa : 'alla',
    datum: ['nya', 'gamla'].includes(m.datum) ? m.datum : 'alla',
    disciplin: typeof m.disciplin === 'string' ? m.disciplin : '',
  };
  _ilm.sortering = ['namn', 'nyast', 'aldst'].includes(m.sortering) ? m.sortering : isvLasVal('ilm-sortering', 'namn');
  if (!_ilm.oppna.has(pid) && Array.isArray(m.oppna)) _ilm.oppna.set(pid, new Set(m.oppna));
}

function ilmSparaMinne(pid = _ilm.projektId) {
  if (!pid || _ilm.filterPid !== pid) return;
  const f = _ilm.filter, oppna = _ilm.oppna.get(pid);
  isvSparaVal(`ilm-minne:${pid}`, { visa: f.visa, datum: f.datum, disciplin: f.disciplin, sortering: _ilm.sortering,
                                    oppna: oppna ? [...oppna].slice(-500) : null });
}

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

function ilmSorteraFiler(filer) {
  if (_ilm.sortering === 'namn') return filer;
  const tid = f => Date.parse(f.datum || '') || 0;
  return [...filer].sort((a, b) => _ilm.sortering === 'nyast' ? tid(b) - tid(a) : tid(a) - tid(b));
}

function ilmSattSortering(varde) {
  _ilm.sortering = varde;
  isvSparaVal('ilm-sortering', varde);   // standard för projekt utan eget val
  ilmSparaMinne();
  ilmRitaNu();
}

function ilmSattFilter(namn, varde) {
  _ilm.filter[namn] = varde;
  if (namn !== 'sok') ilmSparaMinne();
  ilmRitaNu();
  const rulla = document.getElementById('ilm-rulla');
  if (rulla) rulla.scrollTop = 0;
}

function ilmRensaFilter() {
  _ilm.filter = ilmTomtFilter();
  const sok = document.getElementById('ilm-sok');
  if (sok) sok.value = '';
  ilmSparaMinne();
  ilmRitaNu();
}

function ilmVaxlaMerFilter() {
  _ilm.merFilter = !_ilm.merFilter;
  ilmRitaNu();
}

function ilmVaxlaDetaljer() {
  _ilm.detaljer = !_ilm.detaljer;
  isvSparaVal('ilm-detaljer', _ilm.detaljer);
  ilmRitaNu();
}

// ── Popupfönstret ─────────────────────────────────────────────────────────────
// Fönstret har fyra lägen (ilmLage):
//   guide   Kom igång: så länge IFC-mappen eller lagringsmappen saknas visas
//           bara de två valen, inget annat.
//   huvud   trädet med kryssrutor, sökfältet och filtren.
//   inst    Inställningar (⚙): mapparna, automatisk uppdatering, disciplinkoden
//           och gamla modellfiler. Allt sparas direkt.
//   blad    mappväljaren (ilmOppnaBlad), öppnad från guiden eller inställningarna.
// Kortkommandon: / söker, Ctrl+S sparar valen, Esc stänger det översta.

function ilmOppna(projektId) {
  const pid = projektId || isvProjektId();
  if (!_ilm.oppen || _ilm.projektId !== pid) ilmLasMinne(pid);
  _ilm.projektId = pid;
  ilmLasOchTrad(pid);
  if (_ilm.oppen) { ilmRita(); return; }
  _ilm.oppen = true;
  _ilm.blad = null;
  _ilm.sida = null;

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
// Förbättring 5: förteckningen läses om i bakgrunden när fönstret eller
// modellen öppnas och var femte minut medan någon av dem är öppen, så att
// det andra har lagt till, tagit bort eller färgat syns utan omladdning. IFC-
// versionerna kollas om högst var femte minut. Inget läses medan en egen
// sparning pågår (den skriver ändå det senaste).
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

function ilmStang() {
  if (!_ilm.blad && ilmHarAndringar(_ilm.projektId)
      && !confirm('Du har kryssat i eller ur filer utan att spara.\n\nStäng ändå? Valen finns kvar nästa gång du öppnar fönstret.')) return;
  const ruta = document.getElementById('ilm-ruta');
  ilmStangFargMeny();
  _ilm.discDialog = null;
  _ilm.oppen = false;
  _ilm.blad = null;
  _ilm.sida = null;
  document.removeEventListener('keydown', ilmTangent, true);
  if (!ruta) return;
  ruta.querySelector('.ilm-bakgrund')?.classList.add('opacity-0');
  ruta.querySelector('.ilm-fonster')?.classList.add('opacity-0', 'translate-y-4', 'scale-[0.97]');
  ruta.style.pointerEvents = 'none';
  setTimeout(() => ruta.remove(), ILM_ANIMERING_MS);
}

// Förbättring 9: / söker, Ctrl+S sparar, Esc tömmer sökfältet eller stänger
// det översta (paletten, mappväljaren, inställningarna, fönstret).
function ilmTangent(e) {
  if (!_ilm.oppen) return;
  const mal = e.target;
  const skriver = /^(INPUT|SELECT|TEXTAREA)$/.test(mal?.tagName || '') && !['checkbox', 'radio'].includes(mal.type);
  const huvud = ilmLage(_ilm.projektId) === 'huvud';
  if (e.key === '/' && !skriver && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const sok = huvud && document.getElementById('ilm-sok');
    if (sok) { e.preventDefault(); sok.focus(); sok.select(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();   // aldrig webbläsarens "Spara sidan" medan fönstret är öppet
    if (huvud && ilmHarAndringar(_ilm.projektId)) ilmSparaVal();
    return;
  }
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  if (_ilm.fargMeny) { ilmStangFargMeny(); return; }
  if (_ilm.discDialog) { ilmStangDiscDialog(); return; }
  if (mal?.id === 'ilm-sok' && mal.value) { e.preventDefault(); mal.value = ''; ilmSattFilter('sok', ''); return; }
  if (_ilm.blad) { _ilm.blad = null; ilmRitaNu(); return; }
  if (_ilm.sida) { ilmVisaSida(null); return; }
  ilmStang();
}

function ilmValjProjekt(projektId) {
  ilmLasMinne(projektId);
  _ilm.projektId = projektId;
  _ilm.blad = null;
  _ilm.sida = null;
  ilmLasOchTrad(projektId);
  ilmRitaNu();
}

function ilmVisaSida(sida) {
  ilmStangFargMeny();
  _ilm.sida = sida;
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

// Förbättring 1: guiden så länge någon av de två mapparna saknas.
function ilmLage(pid) {
  if (_ilm.blad) return 'blad';
  if (_ilm.sida) return _ilm.sida;
  const ix = _ilm.index.get(pid);
  if (!ix || ix.laddar) return 'laddar';
  return ilmIfcMapp(pid) && ix.mapp ? 'huvud' : 'guide';
}

function ilmRitaNu() {
  const inne = document.getElementById('ilm-innehall');
  if (!inne) return;
  const pid = _ilm.projektId;
  const lage = ilmLage(pid);
  if (lage === 'blad') {
    // Mappväljaren byggs en gång och ritar sedan om sig själv (ilmBladRita).
    if (inne.dataset.vy !== _ilm.blad.id) {
      inne.dataset.vy = _ilm.blad.id;
      inne.innerHTML = ilmHuvudHtml(pid, lage) + ilmBladSkal(_ilm.blad);
      ilmBladRita();
    }
    return;
  }
  // Skalet byggs om bara när läget eller projektet byts, så att sökfältet
  // behåller fokus och öppna listor inte stängs när förloppet uppdateras.
  const vy = `${lage}|${pid}`;
  if (inne.dataset.vy !== vy) {
    inne.dataset.vy = vy;
    ilmStangFargMeny();
    inne.innerHTML = ilmHuvudHtml(pid, lage) + (lage === 'huvud' ? ilmSkalHtml() : ilmSidSkalHtml());
  }
  if (lage === 'huvud') {
    ilmRitaInfo(pid);
    ilmRitaFilter(pid);
    ilmRitaLista(pid);
    ilmRitaStatus(pid);
    ilmRitaFot(pid);
    return;
  }
  ilmSatt(document.getElementById('ilm-sida'),
    lage === 'inst' ? ilmInstHtml(pid) : lage === 'guide' ? ilmGuideHtml(pid) : ilmMitten('Letar efter modellens inställningar i projektet…'));
  ilmSatt(document.getElementById('ilm-fot'), `
    <div class="flex items-center gap-2 px-5 py-3">
      <div class="flex-1"></div>
      ${lage === 'inst' ? ilmKnapp('ilmVisaSida(null)', 'Klar', ILM_KNAPP_HUVUD) : ilmKnapp('ilmStang()', 'Stäng')}
    </div>`);
}

function ilmKnapp(klick, text, extra = '', attr = '') {
  return `<button onclick="${klick}" ${attr} class="text-xs border rounded px-3 py-1.5 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${extra || 'border-ads-border bg-white hover:border-ads-blue'}">${text}</button>`;
}

// Förbättring 5: en enda blå knapp i varje läge; övriga ser ut som länkar eller vanliga knappar.
const ILM_KNAPP_HUVUD = 'border-ads-blue bg-ads-blue text-white hover:bg-ads-blue-dark';

function ilmLank(klick, text, attr = '') {
  return `<button onclick="${klick}" ${attr} class="text-ads-blue hover:underline whitespace-nowrap disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">${text}</button>`;
}

// Förbättring 6: ett litet ? med förklaringen när musen hålls över.
function ilmHjalp(text) {
  return `<span class="inline-flex items-center justify-center shrink-0 w-3.5 h-3.5 rounded-full border border-ads-border text-[9px] leading-none text-ads-muted cursor-help align-middle" title="${vkEsc(text)}">?</span>`;
}

function ilmHuvudHtml(pid, lage) {
  const b = _ilm.blad;
  const flera = _is.projekt.size > 1 && (lage === 'huvud' || lage === 'guide');
  const rubrik = b ? (b.syfte === 'ifc' ? 'Välj mappen med projektets IFC-filer' : 'Välj mappen där modellen sparas')
               : lage === 'inst' ? 'Inställningar' : 'Modellinställningar';
  return `
    <div class="shrink-0 flex items-start gap-3 px-5 pt-4 pb-3 border-b border-ads-border">
      <div class="min-w-0">
        <h3 id="ilm-rubrik" class="text-base font-semibold text-ads-text">${rubrik}</h3>
        ${flera ? `
          <select onchange="ilmValjProjekt(this.value)" class="mt-1 text-xs border border-ads-border rounded px-1.5 py-0.5 max-w-full">
            ${[..._is.projekt.values()].map(p => `<option value="${vkEsc(p.id)}" ${p.id === pid ? 'selected' : ''}>${vkEsc(p.namn)}</option>`).join('')}
          </select>`
          : `<p class="text-xs text-ads-muted mt-0.5">${vkEsc(_is.projekt.get(pid)?.namn || '')}</p>`}
      </div>
      <span class="flex-1"></span>
      ${lage === 'huvud' ? `
        <button onclick="ilmVisaSida('inst')" title="Mappar, automatisk uppdatering, disciplinkod och gamla modellfiler"
                class="text-xs border border-ads-border rounded px-2.5 py-1.5 bg-white text-ads-text hover:border-ads-blue whitespace-nowrap">⚙ Inställningar</button>` : ''}
      <button onclick="ilmStang()" class="text-ads-muted hover:text-ads-text text-lg leading-none" title="Stäng (Esc)">✕</button>
    </div>`;
}

// Huvudläget. Sökfältet ritas bara en gång (fokus); resten ritas om med ilmSatt.
function ilmSkalHtml() {
  return `
    <div id="ilm-inst" class="shrink-0 px-5 py-2 border-b border-ads-border/60 text-xs"></div>
    <div class="shrink-0 px-5 pt-3 pb-2 flex flex-col gap-2 border-b border-ads-border/60">
      <div class="flex items-center gap-2 flex-wrap">
        <input id="ilm-sok" type="search" autocomplete="off" spellcheck="false" value="${vkEsc(_ilm.filter.sok)}" oninput="ilmSattFilter('sok', this.value)"
               placeholder="Sök på filnamn eller mapp" title="Tryck / för att söka"
               class="flex-1 min-w-[14rem] text-sm border border-ads-border rounded px-3 py-1.5 focus:outline-none focus:border-ads-blue" />
        <span id="ilm-filterknappar" class="contents"></span>
      </div>
      <div id="ilm-merfilter"></div>
      <div class="flex items-center gap-3 text-[11px] text-ads-muted min-h-[1rem]">
        <span id="ilm-status-text" class="truncate flex items-center gap-1.5 min-w-0"></span>
        <span class="flex-1"></span>
        <span id="ilm-status-knappar" class="flex items-center gap-3 whitespace-nowrap"></span>
      </div>
    </div>
    <div id="ilm-rulla" class="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-xs"></div>
    <div id="ilm-fot" class="shrink-0 border-t border-ads-border bg-ads-gray/50 rounded-b-lg"></div>`;
}

// Guiden, inställningarna och "Letar…": en rullande yta och en fot.
function ilmSidSkalHtml() {
  return `
    <div id="ilm-sida" class="flex-1 min-h-0 overflow-y-auto text-xs"></div>
    <div id="ilm-fot" class="shrink-0 border-t border-ads-border bg-ads-gray/50 rounded-b-lg"></div>`;
}

function ilmAccMappLank(pid, mappId) {
  return `https://${accDoman()}/docs/files/projects/${encodeURIComponent(String(pid).replace(/^b\./, ''))}`
       + `?folderUrn=${encodeURIComponent(mappId)}&viewModel=detail&moduleId=folders`;
}

function ilmAccLank(pid, mapp) {
  return `<a href="${ilmAccMappLank(pid, mapp.id)}" target="_blank" rel="noopener" class="text-ads-blue hover:underline whitespace-nowrap">Öppna i ACC</a>`;
}

// Varningar om förteckningen och flytten. Visas både i huvudläget och i inställningarna.
function ilmVarningarHtml(pid) {
  const ix = _ilm.index.get(pid);
  const flytt = _ilm.jobb.get(`${pid}|flytt`);
  return [
    ix?.dubletter ? `<div class="text-amber-700">Modellen finns sparad på ${ix.dubletter === 1 ? 'ett ställe' : `${ix.dubletter} ställen`} till i projektet. Den senast ändrade används.
      ${ilmHjalp(`Filen heter ${ILM_FIL}. Ta bort de äldre kopiorna i ACC om de inte behövs.`)}</div>` : '',
    ix?.fel ? `<div class="text-red-700">${vkEsc(ix.fel)} ${ilmLank(`ilmLas('${vkEsc(pid)}', true)`, 'Försök igen')}</div>` : '',
    flytt ? `<div class="${flytt.fel ? 'text-red-700' : 'text-ads-blue'}">${vkEsc(flytt.fel || `${flytt.namn}: ${flytt.steg}…`)}</div>` : '',
  ].join('');
}

// Förbättring 2: överst bara en kort rad om var filerna hämtas och sparas.
// Ett klick på en mapp öppnar inställningarna.
function ilmRitaInfo(pid) {
  const el = document.getElementById('ilm-inst');
  if (!el) return;
  const ix = _ilm.index.get(pid);
  const mapp = m => `<button onclick="ilmVisaSida('inst')" title="${vkEsc(m?.sokvag || '')}&#10;Klicka för att ändra"
      class="min-w-0 truncate font-medium text-ads-text hover:text-ads-blue">${vkEsc(m?.sokvag || 'vald mapp')}</button>`;
  ilmSatt(el, `
    <div class="flex items-center gap-1.5 min-w-0 text-ads-muted">
      <span class="shrink-0">IFC-filer från</span>${mapp(ilmIfcMapp(pid))}
      <span class="shrink-0 px-1">·</span>
      <span class="shrink-0">modellen sparas i</span>${mapp(ix?.mapp)}
      ${ilmHjalp('Mapparna gäller alla i projektet. Ändra dem under ⚙ Inställningar.')}
    </div>
    ${ilmVarningarHtml(pid)}`);
}

// ── Kom igång ─────────────────────────────────────────────────────────────────

function ilmGuideHtml(pid) {
  const ix = _ilm.index.get(pid);
  const ifc = ilmIfcMapp(pid);
  const lagring = ix?.mapp;
  const nasta = !ifc ? 'ifc' : 'lagring';
  const upptagen = !!ix?.flyttar;
  const steg = (nr, syfte, mapp, rubrik, text) => `
    <div class="flex gap-4 py-5 ${nr > 1 ? 'border-t border-ads-border/60' : ''}">
      <div class="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold
                  ${mapp ? 'bg-green-600 text-white' : nasta === syfte ? 'bg-ads-blue text-white' : 'bg-ads-gray text-ads-muted'}">${mapp ? '✓' : nr}</div>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-ads-text">${rubrik}</div>
        <p class="text-ads-muted mt-1">${text}</p>
        ${mapp ? `<p class="mt-2 flex items-center gap-3 min-w-0"><span class="truncate font-medium text-ads-text" title="${vkEsc(mapp.sokvag || '')}">${vkEsc(mapp.sokvag || 'vald mapp')}</span>
                   ${ilmLank(`ilmOppnaBlad('${syfte}')`, 'Ändra', upptagen ? 'disabled' : '')}</p>` : ''}
      </div>
      ${mapp ? '' : `<div class="shrink-0 self-center">${ilmKnapp(`ilmOppnaBlad('${syfte}')`, 'Välj mapp', nasta === syfte ? ILM_KNAPP_HUVUD : '')}</div>`}
    </div>`;
  return `
    <div class="max-w-xl mx-auto px-6 py-8">
      <h4 class="text-lg font-semibold text-ads-text">Kom igång</h4>
      <p class="text-ads-muted mt-1">Modellen visas under ärendelistan, så att du ser var ärendena sitter.
        Två mappar behöver väljas, en gång per projekt. Valen gäller alla i projektet.</p>
      ${ix?.fel ? `<div class="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          Modellens inställningar gick inte att läsa: ${vkEsc(ix.fel)} ${ilmLank(`ilmLas('${vkEsc(pid)}', true)`, 'Försök igen')}
          ${lagring ? '' : '<div class="mt-1 text-[11px]">Om projektet redan har en modell: försök igen innan du väljer en ny mapp, annars kan projektet få två modeller.</div>'}
        </div>` : ''}
      <div class="mt-4">
        ${steg(1, 'ifc', ifc, 'Var ligger projektets IFC-filer?',
               `Välj den översta mappen. Allt under den visas, utom mappar utan IFC-filer och mappar med ${ILM_ARKIV_TEXT} i namnet.`)}
        ${steg(2, 'lagring', lagring, 'Var ska modellen sparas?',
               'Välj en mapp där du får skapa filer, gärna en egen mapp för modellen. Alla i projektet läser modellen därifrån.')}
      </div>
      <p class="text-ads-muted mt-2">Sedan kryssar du i vilka IFC-filer som ska ingå i modellen.</p>
    </div>`;
}

// ── Inställningar ─────────────────────────────────────────────────────────────

function ilmInstHtml(pid) {
  const ix = _ilm.index.get(pid);
  const pidJs = vkEsc(pid);
  const ifc = ilmIfcMapp(pid);
  // Lagringsmappen kan inte bytas medan filer görs om eller väntar i kön (de
  // sparas i den gamla mappen) eller medan modellen flyttas. Varför står synligt.
  const pagar = [..._ilm.jobb.values()].filter(j => j.pid === pid && !j.fel && j.kalla !== 'flytt');
  const upptagen = !!ix?.flyttar || pagar.length > 0;
  const iKo = _ilm.ko.filter(k => k.startsWith(`${pid}|`) && _ilm.jobb.get(k)?.steg === 'I kö').length;
  const varfor = !ix?.mapp || !upptagen ? '' : ix.flyttar ? 'Modellen flyttas just nu.' : `
    <div class="mt-1 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
      Kan inte ändras medan modellen uppdateras: ${pagar.length} ${pagar.length === 1 ? 'fil' : 'filer'} kvar
      (${pagar.slice(0, 3).map(j => `${vkEsc(j.namn)}: ${vkEsc(j.steg || 'I kö')}`).join(', ')}${pagar.length > 3 ? ', …' : ''}).
      Vänta tills ${pagar.length === 1 ? 'den är klar' : 'de är klara'}${iKo ? `, eller ${ilmLank(`ilmTomKo('${pidJs}')`, `ta bort ${iKo === 1 ? 'filen som väntar' : `de ${iKo} som väntar`} i kön`)}` : ''}.
    </div>`;
  const avsnitt = (rubrik, inne) => `
    <section class="py-4 border-t border-ads-border/60 first:border-0">
      <h4 class="text-[11px] font-semibold uppercase tracking-wider text-ads-muted mb-2">${rubrik}</h4>${inne}</section>`;
  const mappRad = (etikett, m, hjalp, knappar) => `
    <div class="flex items-baseline gap-3 py-1.5 min-w-0">
      <span class="w-40 shrink-0 text-ads-muted">${etikett}</span>
      <div class="min-w-0 flex-1">
        <div class="truncate ${m ? 'font-medium text-ads-text' : 'text-amber-700'}" title="${vkEsc(m?.sokvag || '')}">${m ? vkEsc(m.sokvag || 'vald mapp') : 'Ingen mapp vald'}</div>
        <div class="text-[11px] text-ads-muted mt-0.5">${hjalp}</div>
      </div>
      <span class="shrink-0 flex items-center gap-3">${knappar}</span>
    </div>`;
  const gamlaOppen = _ilm.gamla?.pid === pid;
  return `
    <div class="max-w-3xl mx-auto px-6 py-3">
      <p class="text-ads-muted">Inställningarna gäller alla i projektet och sparas direkt.</p>
      ${avsnitt('Mappar', `
        ${mappRad('IFC-filer hämtas från', ifc, `Allt under mappen visas, utom mappar utan IFC-filer och mappar med ${ILM_ARKIV_TEXT} i namnet.`,
                  `${ifc ? ilmAccLank(pid, ifc) : ''}${ilmLank(`ilmOppnaBlad('ifc')`, ifc ? 'Ändra' : 'Välj mapp')}`)}
        ${mappRad('Modellen sparas i', ix?.mapp, 'Den som uppdaterar modellen behöver kunna skapa filer i mappen. Byts mappen kopieras modellen dit.',
                  `${ix?.mapp ? ilmAccLank(pid, ix.mapp) : ''}${ilmLank(`ilmOppnaBlad('lagring')`, ix?.mapp ? 'Ändra' : 'Välj mapp',
                    upptagen && ix?.mapp ? 'disabled title="Vänta tills modellen är klar"' : '')}`)}
        ${varfor ? `<div class="pl-[10.75rem]">${varfor}</div>` : ''}
        <div class="mt-1">${ilmVarningarHtml(pid)}</div>`)}
      ${avsnitt('Uppdatering', `
        <label class="flex items-start gap-2 ${ix?.mapp ? 'cursor-pointer' : 'opacity-50'}">
          <input type="checkbox" ${ilmAuto(pid) ? 'checked' : ''} ${ix?.mapp ? '' : 'disabled'} onchange="ilmSattAuto(this.checked)" class="mt-0.5 accent-ads-blue" />
          <span><span class="text-ads-text">Uppdatera modellen automatiskt när en IFC-fil får en ny version</span>
            <span class="block text-[11px] text-ads-muted mt-0.5">Görs i webbläsaren hos den som har modellen eller det här fönstret öppet.
              Filer över ${ilmStorlek(ILM_STOR_IFC)} uppdateras inte automatiskt.</span></span>
        </label>`)}
      ${avsnitt('Disciplinkod', ilmDisciplinHtml(pid))}
      ${avsnitt('Gamla modellfiler', ix?.mapp ? `
        <div class="flex items-baseline gap-3">
          <p class="flex-1 text-ads-muted">Filer i lagringsmappen som modellen inte längre använder, till exempel efter att en IFC-fil tagits bort ur modellen.</p>
          ${ilmLank(`ilmVisaGamla('${pidJs}')`, gamlaOppen ? 'Dölj' : 'Leta efter gamla filer')}
        </div>
        ${ilmGamlaHtml(pid)}` : '<p class="text-ads-muted">Välj först var modellen sparas.</p>')}
    </div>`;
}

// Var i filnamnet disciplinkoden står, med exempel, och "Färga efter disciplin".
function ilmDisciplinHtml(pid) {
  const data = ilmTrad(pid)?.data;
  if (!data?.filer.length) {
    return `<p class="text-ads-muted">${ilmTrad(pid)?.laddar ? 'Läser IFC-mappen…' : 'Inga IFC-filer att visa exempel från.'}</p>`;
  }
  const del = ilmDisciplinDel(pid);
  const val = ilmDisciplinVal(pid);
  const nu = val == null ? 'auto' : val === -1 ? 'av' : String(val);
  const forslag = ilmForeslagenDel(data);
  const antalDelar = Math.min(8, Math.max(...data.filer.map(f => ilmNamnDelar(f.namn).length)));
  const exempel = i => {
    const n = new Map();
    for (const f of data.filer) { const v = (ilmNamnDelar(f.namn)[i] || '').toUpperCase(); if (v) n.set(v, (n.get(v) || 0) + 1); }
    return [...n].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v]) => v).join(', ');
  };
  const opt = (v, text) => `<option value="${v}" ${nu === v ? 'selected' : ''}>${vkEsc(text)}</option>`;
  const exFil = data.filer.find(f => ilmDisciplin(pid, f.namn, del)) || data.filer[0];
  const iModellen = del != null && ilmFiler(pid).some(f => ilmDisciplin(pid, f.ifc.namn, del));
  const under = inne => `<div class="pl-[10.75rem] mt-1.5 text-[11px] text-ads-muted">${inne}</div>`;
  return `
    <div class="flex items-center gap-3">
      <span class="w-40 shrink-0 text-ads-muted">Koden står i</span>
      <select onchange="ilmSattDisciplin(this.value)" class="text-xs border border-ads-border rounded px-1.5 py-1 bg-white max-w-full">
        ${opt('auto', forslag == null ? 'Förslag (ingen kod hittad)' : `Förslag: del ${forslag + 1} i namnet (${exempel(forslag)})`)}
        ${Array.from({ length: antalDelar }, (_, i) => opt(String(i), `Del ${i + 1} i namnet (${exempel(i)})`)).join('')}
        ${opt('av', 'Används inte')}
      </select>
    </div>
    ${exFil && del != null ? under(`Exempel: ${vkEsc(exFil.namn)} → <b class="text-ads-text">${vkEsc(ilmDisciplin(pid, exFil.namn, del) || '–')}</b>`) : ''}
    ${under('Namnet delas vid - _ . och mellanslag. Koden används för att filtrera listan och för att färga modellen efter disciplin.')}
    ${iModellen ? `<div class="pl-[10.75rem] mt-3">${ilmKnapp('ilmFargaEfterDisciplin()', 'Färga modellen efter disciplin')}</div>` : ''}`;
}

// Förbättring 8: modellfiler (.frag) i lagringsmappen som förteckningen inte
// längre pekar på, till exempel efter att en IFC tagits bort ur modellen eller
// modellen flyttats. Appen får inte radera filer i ACC, så de listas med en länk.
async function ilmVisaGamla(pid) {
  if (_ilm.gamla?.pid === pid) { _ilm.gamla = null; ilmRitaNu(); return; }
  const mapp = _ilm.index.get(pid)?.mapp;
  if (!mapp) return;
  const g = _ilm.gamla = { pid, laddar: true, fel: null, filer: [] };
  ilmRitaNu();
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
  if (_ilm.gamla === g) ilmRitaNu();
}

function ilmGamlaHtml(pid) {
  const g = _ilm.gamla;
  if (!g || g.pid !== pid) return '';
  const ram = inne => `<div class="mt-2 rounded bg-ads-gray/60 px-3 py-2 text-[11px] text-ads-muted">${inne}</div>`;
  if (g.laddar) return ram('Letar efter gamla modellfiler i mappen…');
  if (g.fel) return ram(`<span class="text-red-700">Mappen gick inte att läsa: ${vkEsc(g.fel)}</span>`);
  if (!g.filer.length) return ram('Inga gamla modellfiler. Allt i mappen används av modellen.');
  const summa = g.filer.reduce((s, f) => s + (f.storlek || 0), 0);
  const mapp = _ilm.index.get(pid)?.mapp;
  return ram(`
    <div class="text-ads-text">${g.filer.length} ${g.filer.length === 1 ? 'modellfil' : 'modellfiler'} (${ilmStorlek(summa)}) används inte längre.
      Appen får inte radera filer i ACC, så ta bort dem där om du vill. ${mapp ? ilmAccLank(pid, mapp) : ''}</div>
    <div class="mt-1 max-h-32 overflow-y-auto">${g.filer.map(f => `
      <div class="flex gap-3"><span class="truncate">${vkEsc(f.namn)}</span><span class="ml-auto whitespace-nowrap">${ilmStorlek(f.storlek)} · ${ilmDatum(f.datum)}</span></div>`).join('')}</div>`);
}

// Förbättring 4: uppdatera automatiskt. Gäller hela projektet (auto i
// förteckningen). När någon har modellen eller fönstret öppet och en vald IFC
// har en nyare version görs den om i den personens webbläsare, en gång per
// session. Filer över ILM_STOR_IFC görs inte om automatiskt.
function ilmAuto(pid) {
  return !!_ilm.index.get(pid)?.data?.auto;
}

async function ilmSattAuto(pa) {
  const pid = _ilm.projektId;
  const ix = _ilm.index.get(pid);
  if (!ix?.data) return;
  ix.data.auto = pa;
  ilmRitaNu();
  try {
    await ilmSkrivIndex(pid, d => { d.auto = pa; });
    if (pa) ilmAutoUppdatera(pid);
  } catch (err) {
    alert(`Inställningen kunde inte sparas i ACC: ${vkFelText(err)}`);
    ilmLas(pid, true);
  }
}

const _ilmAutoKord = new Set();

// Varje ny version görs om automatiskt högst en gång per session (misslyckas
// det visas felet, och den röda bubblan finns kvar).
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

// ── Huvudläget ────────────────────────────────────────────────────────────────

// Förbättring 3: Alla / I modellen / Inte i modellen (/ Ny version), "Fler
// filter" och etiketterna för aktiva filter därifrån.
function ilmRitaFilter(pid) {
  const f = _ilm.filter;
  const data = ilmTrad(pid)?.data;
  const del = ilmDisciplinDel(pid);
  const koder = new Map();
  if (data && del != null) {
    for (const x of data.filer) {
      const k = ilmDisciplin(pid, x.namn, del);
      if (k) koder.set(k, (koder.get(k) || 0) + 1);
    }
  }
  if (data && f.disciplin && !koder.has(f.disciplin)) f.disciplin = '';
  const nya = ilmFiler(pid).filter(x => ilmArInaktuell(pid, x)).length;
  const flik = (v, text, rod = false) => `
    <button onclick="ilmSattFilter('visa', '${v}')" class="px-2.5 py-1.5 whitespace-nowrap ${f.visa === v
      ? 'bg-ads-blue text-white' : `bg-white hover:bg-ads-gray ${rod ? 'text-red-700 font-medium' : 'text-ads-text'}`}">${text}</button>`;
  const extra = (f.datum !== 'alla' ? 1 : 0) + (f.disciplin ? 1 : 0);
  const etikett = (text, klick) => `
    <span class="inline-flex items-center gap-1 rounded-full bg-ads-blue/10 text-ads-blue pl-2.5 pr-1 py-0.5 text-[11px] whitespace-nowrap">${text}
      <button onclick="${klick}" class="w-4 h-4 rounded-full hover:bg-ads-blue/20 leading-none" title="Ta bort filtret">✕</button></span>`;
  ilmSatt(document.getElementById('ilm-filterknappar'), `
    <div class="flex items-stretch text-xs border border-ads-border rounded overflow-hidden divide-x divide-ads-border">
      ${flik('alla', 'Alla')}${flik('imodellen', 'I modellen')}${flik('inte', 'Inte i modellen')}
      ${nya || f.visa === 'nyversion' ? flik('nyversion', `Ny version${nya ? ` (${nya})` : ''}`, true) : ''}
    </div>
    <button onclick="ilmVaxlaMerFilter()" title="Filtrera på datum och disciplin, eller ändra ordningen"
            class="text-xs border rounded px-2.5 py-1.5 whitespace-nowrap ${_ilm.merFilter
              ? 'border-ads-blue text-ads-blue bg-ads-blue/5' : 'border-ads-border bg-white text-ads-text hover:border-ads-blue'}">
      Fler filter${extra ? ` (${extra})` : ''} ${_ilm.merFilter ? '▴' : '▾'}</button>
    ${f.datum !== 'alla' ? etikett(`${f.datum === 'gamla' ? 'Äldre' : 'Nyare'} än ${ILM_GAMMAL_DAGAR} dagar`, "ilmSattFilter('datum', 'alla')") : ''}
    ${f.disciplin ? etikett(`Disciplin ${vkEsc(f.disciplin)}`, "ilmSattFilter('disciplin', '')") : ''}`);

  const val = (v, t, nu) => `<option value="${vkEsc(v)}" ${nu === v ? 'selected' : ''}>${t}</option>`;
  const lista = 'text-xs border border-ads-border rounded px-1.5 py-1 bg-white focus:outline-none focus:border-ads-blue';
  const sortera = [...koder].sort((a, b) => a[0].localeCompare(b[0], 'sv'));
  ilmSatt(document.getElementById('ilm-merfilter'), !_ilm.merFilter ? '' : `
    <div class="flex items-center gap-x-6 gap-y-2 flex-wrap text-[11px] text-ads-muted bg-ads-gray/60 rounded px-3 py-2">
      <label class="flex items-center gap-1.5" title="När IFC-filens senaste version laddades upp till ACC">Uppladdad
        <select onchange="ilmSattFilter('datum', this.value)" class="${lista}">
          ${val('alla', 'När som helst', f.datum)}${val('nya', `Nyare än ${ILM_GAMMAL_DAGAR} dagar`, f.datum)}${val('gamla', `Äldre än ${ILM_GAMMAL_DAGAR} dagar`, f.datum)}
        </select></label>
      ${del != null && koder.size ? `
        <label class="flex items-center gap-1.5">Disciplin
          <select onchange="ilmSattFilter('disciplin', this.value)" class="${lista}">
            ${val('', 'Alla', f.disciplin)}${sortera.map(([k, n]) => val(k, `${vkEsc(k)} (${n})`, f.disciplin)).join('')}
          </select></label>`
        : `<span class="flex items-center gap-1.5">Disciplin ${ilmLank("ilmVisaSida('inst')", del == null ? 'av, ställ in' : 'ingen kod hittad, ställ in')}</span>`}
      <label class="flex items-center gap-1.5">Ordning
        <select onchange="ilmSattSortering(this.value)" class="${lista}">
          ${val('namn', 'Namn A–Ö', _ilm.sortering)}${val('nyast', 'Nyast först', _ilm.sortering)}${val('aldst', 'Äldst först', _ilm.sortering)}
        </select></label>
    </div>`);
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
  ilmSatt(text, `<span class="truncate">${delar.join(' · ')}</span>${ilmHjalp(
    `Mappar utan IFC-filer och mappar med ${ILM_ARKIV_TEXT} i namnet visas inte.\n\n`
    + 'Kortkommandon: / söker, Ctrl+S sparar, Esc stänger. Shift-klick kryssar i eller ur alla filer mellan två klick.')}`);

  const k = [];
  const valbara = _ilm.synligaValbara || [];
  if (ilmFilterAktivt()) {
    if (valbara.length) {
      const modell = ilmModellKarta(pid);
      const alla = valbara.every(f => ilmArValt(pid, f.itemId, modell));
      k.push(ilmLank(`ilmMarkeraSynliga(${alla ? 'false' : 'true'})`, alla ? 'Kryssa ur alla som syns' : `Kryssa i alla som syns (${valbara.length})`));
    }
    k.push(ilmLank('ilmRensaFilter()', 'Rensa filter'));
  }
  if (!t.laddar) k.push(ilmLank('ilmTradLas(_ilm.projektId, true)', 'Läs om', 'title="Läs IFC-mappen från ACC igen, till exempel om en ny fil har laddats upp"'));
  k.push(ilmLank('ilmVaxlaDetaljer()', _ilm.detaljer ? 'Dölj detaljer' : 'Visa detaljer', 'title="Version, storlek och disciplinkod på varje fil"'));
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
  if (!ifc) return ilmMitten(`Ingen IFC-mapp är vald. ${ilmLank("ilmVisaSida('inst')", 'Välj under Inställningar')}`);
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
    for (const f of ilmSorteraFiler(x.filerI.get(mappId) || [])) {
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
                     storlek: m.ifc.storlek, datum: ilmIfcDatum(pid, m) });
    }
  }
  for (const j of _ilm.jobb.values()) {
    const id = j.ifc?.itemId;
    if (j.pid === pid && id && !x.filer.has(id) && !modell.has(id)) {
      utanfor.push({ itemId: id, namn: j.namn, sokvag: j.ifc.sokvag || '', version: null, storlek: null, datum: null });
    }
  }
  const utanforSyns = ilmSorteraFiler(utanfor.filter(f => ilmSynlig(pid, f, modell, del)));
  if (utanforSyns.length) {
    html.push(`<div class="mt-3 mb-1 mx-1 pt-3 border-t border-ads-border text-[11px] font-semibold uppercase tracking-wider text-ads-muted">
      Ingår i modellen men syns inte i IFC-mappen (${utanforSyns.length})</div>`);
    for (const f of utanforSyns) {
      const borta = _ilm.tips.get(`${pid}|${f.itemId}`)?.borta;
      html.push(ilmFilRad(pid, f, 0, modell, del, borta
        ? 'Finns inte längre i ACC'
        : 'Ligger i en arkivmapp, utanför IFC-mappen eller i en mapp som inte gick att läsa'));
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

// Förbättring 4: en lugn rad med kryssruta, namn, status, färg och datum.
// Version, storlek och disciplinkod syns med "Visa detaljer" (och i namnets
// verktygstips). orsak: text för filer som inte finns i trädet.
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
  const detalj = [f.version ? `V${f.version}` : '', ilmStorlek(f.storlek)].filter(Boolean).join(' · ');
  const tips = [f.sokvag ? `${f.sokvag} / ${f.namn}` : f.namn, [detalj, kod ? `disciplin ${kod}` : ''].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
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
          <span class="truncate text-ads-text ${imod ? 'font-medium' : ''}" title="${vkEsc(tips)}">${vkEsc(f.namn)}</span>
          ${_ilm.detaljer && kod ? `<span class="shrink-0 px-1 rounded bg-ads-gray text-[10px] font-semibold text-ads-muted" title="Disciplinkod">${vkEsc(kod)}</span>` : ''}
          ${andring ? `<span class="shrink-0 text-[11px] text-ads-blue">${imod ? 'tas bort' : 'läggs till'}</span>` : ''}
        </div>
        ${orsak ? `<div class="text-[11px] text-amber-700 truncate" title="${vkEsc(f.sokvag)}">${vkEsc(orsak)}${f.sokvag ? ` · ${vkEsc(f.sokvag)}` : ''}</div>` : ''}
      </div>
      <span class="shrink-0 flex items-center gap-1.5 text-[11px]">${ilmFilStatus(pid, id, imod, j)}</span>
      ${imod ? `<button onclick="ilmFargMeny(event, '${vkEsc(pid)}', '${vkEsc(id)}')" title="${imod.farg ? 'Modellens färg. Klicka för att ändra.' : 'Ingen färg: modellens egna färger. Klicka för att välja.'}"
                        class="shrink-0 w-4 h-4 rounded-full border border-ads-border hover:ring-2 hover:ring-ads-blue/40" style="${ilmFargRuta(imod.farg)}"></button>`
             : '<span class="shrink-0 w-4"></span>'}
      ${_ilm.detaljer ? `<span class="shrink-0 w-24 text-right text-[11px] text-ads-muted whitespace-nowrap">${detalj}</span>` : ''}
      <span class="shrink-0 w-[5.5rem] text-right text-[11px] whitespace-nowrap ${gammal ? 'text-amber-800 bg-amber-100 rounded px-1' : 'text-ads-muted'}"
            title="${vkEsc(datumTitel)}">${ilmDatum(f.datum) || '–'}</span>
    </div>`;
}

function ilmJobbText(j) {
  return `${j.steg}${j.andel != null ? ` ${Math.round(j.andel * 100)} %` : ''}…`;
}

// Filens status som en etikett: I modellen, Ny version, förloppet eller felet.
function ilmFilStatus(pid, id, imod, j) {
  const pidJs = vkEsc(pid), idJs = vkEsc(id);
  const etikett = (klass, text, titel = '') => `<span class="px-1.5 py-px rounded whitespace-nowrap ${klass}" title="${vkEsc(titel)}">${text}</span>`;
  if (j && !j.fel) return `<span class="text-ads-blue whitespace-nowrap" data-ilm-jobb="${vkEsc(`${pid}|${j.nyckel}`)}">${vkEsc(ilmJobbText(j))}</span>`;
  if (j?.fel) {
    return `${etikett('bg-red-50 text-red-700 max-w-[14rem] truncate', `Gick inte: ${vkEsc(j.fel)}`, j.fel)}
      ${ilmLank(`event.stopPropagation(); ilmForsokIgen('${pidJs}', '${idJs}')`, 'Försök igen')}
      ${imod ? '' : `<button onclick="event.stopPropagation(); ilmGlomJobb('${pidJs}', '${vkEsc(j.nyckel)}')" class="text-ads-muted hover:text-ads-text" title="Glöm felet">✕</button>`}`;
  }
  if (!imod) return '';
  const t = _ilm.tips.get(`${pid}|${id}`);
  if (t?.borta) return etikett('bg-red-50 text-red-700', 'Borttagen i ACC', 'IFC-filen finns inte längre i ACC. Ta bort den ur modellen.');
  if (ilmArInaktuell(pid, imod)) {
    const ny = t && t.version != null && imod.ifc.version != null && t.version > imod.ifc.version;
    return `${etikett('bg-red-50 text-red-700 font-medium', ny ? 'Ny version' : 'Behöver uppdateras',
                      ny ? `Modellen har V${imod.ifc.version}, ACC har V${t.version}.` : 'Appen läser nu mer ur IFC-filer än när modellen gjordes. Uppdatera för att få med allt.')}
      ${ilmLank(`event.stopPropagation(); ilmUppdatera('${pidJs}', '${idJs}')`, 'Uppdatera')}`;
  }
  const uppdaterad = imod.omvandlad ? `Uppdaterad ${new Date(imod.omvandlad).toLocaleString('sv-SE').slice(0, 16)}${imod.omvandladAv ? ` av ${imod.omvandladAv}` : ''}` : '';
  return etikett('bg-green-50 text-green-700', 'I modellen', uppdaterad);
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
  ilmSparaMinne(pid);
  ilmRitaLista(pid);
}

function ilmRitaVal(pid) {
  ilmRitaLista(pid);
  ilmRitaStatus(pid);
  ilmRitaFot(pid);
}

// Förbättring 5: en blå knapp, den som tar nästa steg: Spara ändringar när något
// är ikryssat, annars Uppdatera modellen när något behöver det.
function ilmRitaFot(pid) {
  const el = document.getElementById('ilm-fot');
  if (!el) return;
  const ix = _ilm.index.get(pid);
  const v = ilmVal(pid);
  const lagg = v.lagg.size, tabort = v.tabort.size;
  const filer = ilmFiler(pid);
  const inaktuella = filer.filter(f => ilmArInaktuell(pid, f) && !ilmUpptagen(pid, f.ifc.itemId)).length;
  const pagar = [..._ilm.jobb.values()].filter(j => j.pid === pid && !j.fel && j.kalla !== 'flytt').length;
  let text, knappar;
  if (lagg || tabort) {
    const delar = [lagg ? `lägg till ${lagg}` : '', tabort ? `ta bort ${tabort}` : ''].filter(Boolean).join(', ');
    text = `<span class="text-ads-blue font-medium">${delar[0].toUpperCase()}${delar.slice(1)}. Inte sparat.</span>`;
    knappar = `${ilmLank('ilmAngraVal()', 'Ångra val')}
      ${ilmKnapp('ilmSparaVal()', 'Spara ändringar', ILM_KNAPP_HUVUD, `title="Ctrl+S" ${ix?.mapp ? '' : 'disabled'}`)}`;
  } else {
    if (pagar) text = `<span class="text-ads-blue">Modellen uppdateras: ${pagar} ${pagar === 1 ? 'fil' : 'filer'} kvar. Det fortsätter även om fönstret stängs.</span>`;
    else if (inaktuella) text = `<span class="text-red-700">${inaktuella} ${inaktuella === 1 ? 'fil har' : 'filer har'} en ny version.</span>`;
    else text = `<span class="text-ads-muted">${filer.length ? `${filer.length} IFC-${filer.length === 1 ? 'fil' : 'filer'} i modellen. Modellen är uppdaterad.` : 'Inga IFC-filer i modellen än. Kryssa i de som ska ingå.'}</span>`;
    knappar = inaktuella ? ilmKnapp(`ilmUppdateraAlla('${vkEsc(pid)}')`, `Uppdatera modellen (${inaktuella})`, ILM_KNAPP_HUVUD) : '';
  }
  ilmSatt(el, `
    <div class="flex items-center gap-3 px-5 py-3">
      <div class="text-xs min-w-0 truncate">${text}</div>
      <div class="flex-1"></div>
      <span class="flex items-center gap-3 text-xs">${knappar}</span>
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
      ? `Allt under mappen visas i Modellinställningar, utom mappar utan IFC och mappar med ${ILM_ARKIV_TEXT} i namnet. Valet gäller alla i projektet.`
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
    if (!confirm(`Flytta modellen till ${mapp.sokvag}?\n\nModellen${antal ? ` (${antal} ${antal === 1 ? 'fil' : 'filer'})` : ''} kopieras dit, och alla i projektet hittar den där. De gamla filerna ligger kvar i ${ix.mapp.sokvag} tills du tar bort dem.`)) {
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
  ilmSparaMinne(pid);
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

// Flytten går i samma kö som alla sparningar av förteckningen, så att en färg
// som väljs under flytten sparas efteråt i den nya mappen och inte samtidigt
// i den gamla (troligen Mahdis "Fold…"-fel 2026-11-09).
function ilmFlyttaModell(pid, mapp) {
  _ilm.skriver++;
  const p = _ilm.skrivKo.then(() => ilmFlyttaModellNu(pid, mapp));
  _ilm.skrivKo = p.catch(() => {});
  p.finally(() => { _ilm.skriver--; });
  return p;
}

async function ilmFlyttaModellNu(pid, mapp) {
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
    if (data.auto === undefined) data.auto = ilmAuto(pid);
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
