// issues-lattmodell.js — "Modellinställningar": vilka IFC-filer projektets
// lätta modell består av (docs/PLAN-FRAGMENTS.md, del 2).
//
// Modellen sparas i ACC så att alla i projektet ser samma: en mapp väljs en
// gång per projekt, och där ligger
//   arenden-lattmodell.json   innehållsförteckningen (ILM_FIL, format nedan)
//   <ifc-namn> (<id>).frag    en Fragments-fil per IFC
//   IFC-filer som laddats upp från datorn (så att alla kan uppdatera dem)
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
//   { typ: ILM_TYP, version: 1, mapp: { id, sokvag },
//     filer: [{ kalla: 'acc'|'dator',
//               ifc:  { itemId, namn, sokvag, version, versionId, storlek, enhet, karta },
//               frag: { itemId, namn, versionId, storlek, format },
//               omvandlad, omvandladAv }] }
// ifc.itemId är IFC-filens lineage, samma som ärendenas linkedDocuments.urn.
// ifc.enhet är filens längdenhet i meter, ifc.karta dess IfcMapConversion
// { E, N, H, a, o, s } eller null (se ilmLasGeoreferens). frag.format är
// ILM_FORMAT när filen gjordes om; en äldre siffra betyder att den ska göras om.
//
// Popupfönstret ligger direkt i <body>, utanför #main-content, så att flikens
// omritningar inte stänger det. Det tonar in och glider upp; Esc, ✕ och klick
// utanför stänger. Jobben fortsätter även när fönstret är stängt.

const ILM_FIL = 'arenden-lattmodell.json';
const ILM_TYP = 'forma-console-lattmodell';
const ILM_ANIMERING_MS = 200;
const ILM_STOR_IFC = 300 * 1024 * 1024;   // varning: lång tid och mycket minne
// Omvandlingens version. Räknas upp när omvandlingen ändras (fler IFC-klasser,
// mer sparad information), så att äldre modeller visas som inaktuella.
//   1  första versionen (2026-11-06)
//   2  IfcSpatialZone och infraklasser med, georeferens sparad (2026-11-06)
const ILM_FORMAT = 2;

const _ilm = {
  oppen:     false,
  projektId: null,
  index:     new Map(),  // projekt-id → { laddar, fel, itemId, mapp, data, dubletter }
  tips:      new Map(),  // "projekt|ifc-item" → { version, versionId, storlek, borta } senaste i ACC
  jobb:      new Map(),  // "projekt|nyckel" → { pid, nyckel, namn, steg, andel, fel, kalla, ifc, fil }
  ko:        [],         // jobbnycklar i tur
  arbetar:   false,
  blad:      null,       // filväljaren: { lage: 'ifc'|'mapp', pid, topp, innehall, oppna, valda, noder, vald }
  drar:      false,      // en fil dras över fönstret
};

// ── Förteckningen i ACC ───────────────────────────────────────────────────────

function ilmHub() {
  return _hubs[_hubIdx]?.id;
}

function ilmTolka(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error(`${ILM_FIL} är inte giltig JSON`); }
  if (d?.typ !== ILM_TYP) throw new Error(`${ILM_FIL} har fel innehåll`);
  return { mapp: d.mapp || null, filer: Array.isArray(d.filer) ? d.filer.filter(f => f?.ifc?.itemId) : [] };
}

// Letar upp förteckningen: först där den låg senast, annars med sökning.
async function ilmHittaIndex(pid) {
  const minne = isvLasVal(`ilm-index:${pid}`, null);
  if (minne) {
    try {
      const [text, mapp] = await Promise.all([readTextFile(pid, minne), getItemParent(pid, minne)]);
      const data = ilmTolka(text);
      return { itemId: minne, mapp: { id: mapp.id, sokvag: data.mapp?.sokvag || vkMappNamnAv(mapp) }, data, dubletter: 0 };
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
  const itemId = filer[0].itemId;
  const [text, mapp] = await Promise.all([readTextFile(pid, itemId), getItemParent(pid, itemId).catch(() => null)]);
  const data = ilmTolka(text);
  isvSparaVal(`ilm-index:${pid}`, itemId);
  return { itemId, mapp: mapp ? { id: mapp.id, sokvag: data.mapp?.sokvag || vkMappNamnAv(mapp) } : data.mapp, data, dubletter: filer.length - 1 };
}

// Läser projektets förteckning en gång (eller om, med tvinga) och kollar sedan versionerna.
function ilmLas(pid, tvinga = false) {
  const nu = _ilm.index.get(pid);
  if (nu && (nu.laddar || (!tvinga && !nu.fel))) return nu.lofte;
  const post = { laddar: true, fel: null, itemId: null, mapp: null, data: null, dubletter: 0 };
  post.lofte = (async () => {
    try {
      Object.assign(post, await ilmHittaIndex(pid));
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

// Läser förteckningen färskt, låter andra(data) ändra den och sparar.
async function ilmSkrivIndex(pid, andra, valdMapp) {
  const farsk = await ilmHittaIndex(pid);
  const mapp = farsk.itemId ? farsk.mapp : (valdMapp || _ilm.index.get(pid)?.mapp);
  if (!mapp) throw new Error('ingen mapp är vald för modellen');
  const data = farsk.data || { mapp, filer: [] };
  andra(data);
  data.mapp = { id: mapp.id, sokvag: mapp.sokvag || data.mapp?.sokvag || '' };
  const text = JSON.stringify({ typ: ILM_TYP, version: 1, mapp: data.mapp, filer: data.filer }, null, 2);
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

// IFC-filer från datorn (filväljaren eller dra och släpp). De laddas upp till modellens mapp.
function ilmLaggTillFranDatorn(pid, filer) {
  const ifc = [...filer].filter(f => /\.ifc$/i.test(f.name));
  const andra = [...filer].length - ifc.length;
  if (andra) alert(`${andra} ${andra === 1 ? 'fil är' : 'filer är'} inte IFC och hoppas över.`);
  if (!_ilm.index.get(pid)?.mapp) { alert('Välj först en mapp i ACC där modellen sparas.'); return; }
  for (const f of ifc) {
    if (!ilmStorOk(f.name, f.size)) continue;
    ilmKoa(pid, { nyckel: `dator:${f.name}`, namn: f.name, kalla: 'dator', fil: f });
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

async function ilmTaBort(pid, itemId) {
  const f = ilmFiler(pid).find(x => x.ifc.itemId === itemId);
  if (!f || !confirm(`Ta bort ${f.ifc.namn} ur modellen?\n\nFilerna ligger kvar i ACC.`)) return;
  try {
    await ilmSkrivIndex(pid, d => { d.filer = d.filer.filter(x => x.ifc.itemId !== itemId); });
  } catch (err) {
    alert(`Kunde inte spara: ${vkFelText(err)}`);
  }
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

function ilmSteg(j, steg, andel = null) {
  j.steg = steg;
  j.andel = andel;
  if (_ilm.oppen) ilmRita();
}

async function ilmKorJobb(j) {
  const pid = j.pid;
  const mapp = _ilm.index.get(pid)?.mapp;
  if (!mapp) throw new Error('ingen mapp är vald för modellen');
  let bytes;

  if (j.kalla === 'dator' && j.fil) {
    // Upp till modellens mapp: ny version om en fil med samma namn redan finns där.
    ilmSteg(j, 'Laddar upp IFC', 0);
    const finns = await ilmFilIMapp(pid, mapp.id, j.fil.name);
    const storage = await createStorage(pid, mapp.id, j.fil.name);
    await uploadToStorage(storage, j.fil, a => ilmSteg(j, 'Laddar upp IFC', a));
    const itemId = finns
      ? (await createVersion(pid, finns, j.fil.name, storage), finns)
      : await createItem(pid, mapp.id, j.fil.name, storage);
    j.ifc = { itemId, namn: j.fil.name, sokvag: mapp.sokvag };
    bytes = await j.fil.arrayBuffer();
  }

  const tip = await ilmTip(pid, j.ifc.itemId);
  if (tip.borta) throw new Error('IFC-filen finns inte längre i ACC');
  if (tip.fel) throw new Error('kunde inte läsa IFC-filens version i ACC');
  const ifc = { ...j.ifc, version: tip.version, versionId: tip.versionId, storlek: tip.storlek };

  if (!bytes) {
    ilmSteg(j, 'Hämtar IFC', 0);
    bytes = await ilmHamtaFil(pid, ifc.itemId, a => ilmSteg(j, 'Hämtar IFC', a));
  }

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

// ── Popupfönstret ─────────────────────────────────────────────────────────────

function ilmOppna(projektId) {
  _ilm.projektId = projektId || isvProjektId();
  ilmLas(_ilm.projektId);
  if (_ilm.oppen) { ilmRita(); return; }
  _ilm.oppen = true;
  _ilm.blad = null;

  const ruta = document.createElement('div');
  ruta.id = 'ilm-ruta';
  ruta.className = 'fixed inset-0 z-[90] flex items-center justify-center p-6';
  ruta.innerHTML = `
    <div onclick="ilmStang()" class="ilm-bakgrund absolute inset-0 bg-black/40 opacity-0 transition-opacity motion-reduce:transition-none" style="transition-duration: ${ILM_ANIMERING_MS}ms"></div>
    <div role="dialog" aria-modal="true" aria-labelledby="ilm-rubrik"
         class="ilm-fonster relative bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col text-sm
                opacity-0 translate-y-4 scale-[0.97] transition ease-out motion-reduce:transition-none" style="transition-duration: ${ILM_ANIMERING_MS}ms">
      <div id="ilm-innehall" class="flex flex-col min-h-0 flex-1"></div>
    </div>`;
  // Dra och släpp IFC-filer var som helst i fönstret.
  const fonster = ruta.querySelector('.ilm-fonster');
  fonster.addEventListener('dragover', e => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    if (!_ilm.drar) { _ilm.drar = true; ilmRita(); }
  });
  fonster.addEventListener('dragleave', e => {
    if (fonster.contains(e.relatedTarget)) return;
    _ilm.drar = false; ilmRita();
  });
  fonster.addEventListener('drop', e => {
    e.preventDefault();
    _ilm.drar = false;
    ilmRita();
    if (e.dataTransfer?.files?.length) ilmLaggTillFranDatorn(_ilm.projektId, e.dataTransfer.files);
  });
  document.body.appendChild(ruta);
  document.addEventListener('keydown', ilmTangent, true);
  ilmRita();
  // Nästa bildruta: då har webbläsaren ritat startläget och övergången syns.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ruta.querySelector('.ilm-bakgrund')?.classList.remove('opacity-0');
    fonster.classList.remove('opacity-0', 'translate-y-4', 'scale-[0.97]');
  }));
}

function ilmStang() {
  const ruta = document.getElementById('ilm-ruta');
  _ilm.oppen = false;
  _ilm.blad = null;
  _ilm.drar = false;
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
  if (_ilm.blad) { _ilm.blad = null; ilmRita(); return; }
  ilmStang();
}

function ilmValjProjekt(projektId) {
  _ilm.projektId = projektId;
  _ilm.blad = null;
  ilmLas(projektId);
  ilmRita();
}

function ilmRita() {
  const inne = document.getElementById('ilm-innehall');
  if (!inne) return;
  const pid = _ilm.projektId;
  const flera = _is.projekt.size > 1;
  const huvud = `
    <div class="shrink-0 flex items-start gap-3 px-5 pt-4 pb-3 border-b border-ads-border">
      <div class="min-w-0">
        <h3 id="ilm-rubrik" class="text-base font-semibold text-ads-text">${_ilm.blad ? (_ilm.blad.lage === 'mapp' ? 'Välj mapp för modellen' : 'Välj IFC-filer i ACC') : 'Modellinställningar'}</h3>
        ${flera && !_ilm.blad ? `
          <select onchange="ilmValjProjekt(this.value)" class="mt-1 text-xs border border-ads-border rounded px-1.5 py-0.5 max-w-full">
            ${[..._is.projekt.values()].map(p => `<option value="${vkEsc(p.id)}" ${p.id === pid ? 'selected' : ''}>${vkEsc(p.namn)}</option>`).join('')}
          </select>`
          : `<p class="text-xs text-ads-muted mt-0.5">${vkEsc(_is.projekt.get(pid)?.namn || '')}</p>`}
      </div>
      <button onclick="ilmStang()" class="ml-auto text-ads-muted hover:text-ads-text text-lg leading-none" title="Stäng (Esc)">✕</button>
    </div>`;
  inne.innerHTML = huvud + (_ilm.blad ? ilmBladHtml() : ilmHuvudvyHtml(pid));
}

function ilmKnapp(klick, text, extra = '', attr = '') {
  return `<button onclick="${klick}" ${attr} class="text-xs border rounded px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${extra || 'border-ads-border bg-white hover:border-ads-blue'}">${text}</button>`;
}

function ilmHuvudvyHtml(pid) {
  const ix = _ilm.index.get(pid);
  const fot = inne => `
    <div class="shrink-0 flex items-center gap-2 px-5 py-3 border-t border-ads-border bg-ads-gray/50 rounded-b-lg">${inne}</div>`;
  if (!ix || ix.laddar) {
    return `<div class="flex-1 px-5 py-10 text-center text-ads-muted">Letar efter modellen i projektet…</div>` + fot(`<div class="flex-1"></div>${ilmKnapp('ilmStang()', 'Stäng')}`);
  }
  if (ix.fel && !ix.mapp) {
    return `<div class="flex-1 px-5 py-8 text-center"><p class="text-red-700">Kunde inte läsa modellens inställningar: ${vkEsc(ix.fel)}</p>
      <div class="mt-3">${ilmKnapp(`ilmLas('${vkEsc(pid)}', true)`, 'Försök igen')}</div></div>` + fot(`<div class="flex-1"></div>${ilmKnapp('ilmStang()', 'Stäng')}`);
  }

  const pidJs = vkEsc(pid);
  if (!ix.mapp) {
    return `
      <div class="flex-1 px-5 py-6">
        <p class="text-xs text-ads-muted">Modellen under ärendelistan består av de IFC-filer som väljs här. Den görs om till ett lätt format och sparas i ACC, så alla i projektet ser samma modell.</p>
        <div class="mt-5 p-6 border border-dashed border-ads-border rounded text-center">
          <p class="text-ads-text">Välj först en mapp i ACC där modellen ska sparas.</p>
          <p class="text-xs text-ads-muted mt-1">Alla i projektet hittar den sedan automatiskt. Den som uppdaterar modellen behöver kunna skapa filer i mappen.</p>
          <div class="mt-4">${ilmKnapp(`ilmOppnaBlad('mapp')`, 'Välj mapp', 'border-ads-blue bg-ads-blue text-white hover:bg-ads-blue-dark')}</div>
        </div>
      </div>` + fot(`<div class="flex-1"></div>${ilmKnapp('ilmStang()', 'Stäng')}`);
  }

  const filer = ix.data?.filer || [];
  const jobb = [..._ilm.jobb.values()].filter(j => j.pid === pid);
  // Nya filer som inte finns i förteckningen än visas från kön.
  const nya = jobb.filter(j => !filer.some(f => f.ifc.itemId === j.ifc?.itemId));
  const inaktuella = filer.filter(f => ilmArInaktuell(pid, f) && !_ilm.jobb.get(`${pid}|${f.ifc.itemId}`)).length;

  const rader = [
    ...filer.map(f => ilmFilradHtml(pid, f, _ilm.jobb.get(`${pid}|${f.ifc.itemId}`))),
    ...nya.map(j => ilmFilradHtml(pid, null, j)),
  ].join('');

  return `
    <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 ${_ilm.drar ? 'bg-ads-blue/5' : ''}">
      <div class="flex items-baseline gap-2 text-xs text-ads-muted">
        <span>Sparas i ACC:</span>
        <span class="font-medium text-ads-text truncate" title="${vkEsc(ix.mapp.sokvag || '')}">${vkEsc(ix.mapp.sokvag || 'vald mapp')}</span>
        ${ix.dubletter ? `<span class="text-amber-700">(${ix.dubletter} äldre ${ix.dubletter === 1 ? 'kopia' : 'kopior'} av ${ILM_FIL} finns också i projektet)</span>` : ''}
      </div>
      ${ix.fel ? `<p class="mt-2 text-xs text-red-700">${vkEsc(ix.fel)}</p>` : ''}

      <div class="mt-4 flex items-center gap-2">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-ads-muted">IFC-filer i modellen (${filer.length})</div>
        <div class="flex-1"></div>
        ${ilmKnapp(`ilmOppnaBlad('ifc')`, 'Lägg till från ACC')}
        ${ilmKnapp(`document.getElementById('ilm-filval').click()`, 'Lägg till från datorn')}
        <input id="ilm-filval" type="file" accept=".ifc" multiple class="hidden" onchange="ilmLaggTillFranDatorn('${pidJs}', this.files); this.value = ''" />
      </div>
      <div class="mt-2 border border-ads-border rounded divide-y divide-ads-border/70">
        ${rader || '<div class="p-4 text-center text-ads-muted">Inga IFC-filer valda än.</div>'}
      </div>
      <div class="mt-3 p-4 border-2 border-dashed rounded text-center text-xs transition-colors ${_ilm.drar ? 'border-ads-blue text-ads-blue bg-white' : 'border-ads-border text-ads-muted'}">
        ${_ilm.drar ? 'Släpp IFC-filerna här' : 'Dra och släpp IFC-filer här. De laddas upp till mappen ovan, så att alla kan uppdatera modellen.'}
      </div>
    </div>` + fot(`
      ${inaktuella ? `<span class="text-xs text-red-700">${inaktuella} ${inaktuella === 1 ? 'fil behöver' : 'filer behöver'} uppdateras.</span>` : '<span class="text-xs text-ads-muted">Modellen är uppdaterad.</span>'}
      <div class="flex-1"></div>
      ${ilmKnapp(`ilmUppdateraAlla('${pidJs}')`, `Uppdatera modellen${inaktuella ? ` (${inaktuella})` : ''}`,
                 inaktuella ? 'border-ads-blue bg-ads-blue text-white hover:bg-ads-blue-dark' : '', inaktuella ? '' : 'disabled')}
      ${ilmKnapp('ilmStang()', 'Stäng')}`);
}

function ilmFilradHtml(pid, f, j) {
  const pidJs = vkEsc(pid);
  const itemJs = f ? vkEsc(f.ifc.itemId) : '';
  const namn = f?.ifc.namn || j?.namn || '';
  const sokvag = f ? (f.kalla === 'dator' ? `${f.ifc.sokvag || ''} · uppladdad från datorn` : f.ifc.sokvag || '') : (j?.kalla === 'dator' ? 'från datorn' : j?.ifc?.sokvag || '');
  const t = f ? _ilm.tips.get(`${pid}|${f.ifc.itemId}`) : null;

  let status;
  if (j && !j.fel) {
    const pct = j.andel != null ? ` ${Math.round(j.andel * 100)} %` : '';
    status = `<span class="text-ads-blue">${vkEsc(j.steg)}${pct}…</span>
      ${j.andel != null ? `<div class="mt-1 h-1 bg-ads-gray rounded overflow-hidden"><div class="h-full bg-ads-blue transition-all" style="width: ${Math.round(j.andel * 100)}%"></div></div>` : ''}`;
  } else if (j?.fel) {
    status = `<span class="text-red-700">${vkEsc(j.fel)}</span>
      ${f ? `<button onclick="ilmUppdatera('${pidJs}', '${itemJs}')" class="ml-1 text-ads-blue hover:underline">Försök igen</button>` : `<button onclick="ilmGlomJobb('${pidJs}', '${vkEsc(j.nyckel)}')" class="ml-1 text-ads-blue hover:underline">Ta bort</button>`}`;
  } else if (t?.borta) {
    status = '<span class="text-red-700">Finns inte längre i ACC</span>';
  } else if (ilmArInaktuell(pid, f)) {
    const nyVersion = t && t.version != null && f.ifc.version != null && t.version > f.ifc.version;
    status = `<span class="text-red-700 font-medium" title="${nyVersion ? '' : 'Omvandlingen har förbättrats sedan modellen gjordes. Gör om den för att få med allt.'}">${nyVersion ? `Ny version (V${t.version}) finns` : 'Behöver göras om'}</span>
      <button onclick="ilmUppdatera('${pidJs}', '${itemJs}')" class="ml-1 text-ads-blue hover:underline">Uppdatera</button>`;
  } else {
    status = `<span class="text-ads-muted">V${f.ifc.version ?? '?'} · ${ilmStorlek(f.frag?.storlek)}</span>`;
  }
  const omvandlad = f?.omvandlad ? `Omgjord ${new Date(f.omvandlad).toLocaleString('sv-SE').slice(0, 16)}${f.omvandladAv ? ` av ${vkEsc(f.omvandladAv)}` : ''}` : '';
  return `
    <div class="px-3 py-2 flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <div class="font-medium text-ads-text truncate" title="${vkEsc(namn)}">${vkEsc(namn)}</div>
        <div class="text-[11px] text-ads-muted truncate" title="${vkEsc(sokvag)}">${vkEsc(sokvag)}</div>
        ${omvandlad ? `<div class="text-[11px] text-ads-muted">${omvandlad}</div>` : ''}
      </div>
      <div class="w-56 shrink-0 text-xs text-right">${status}</div>
      ${f && !(j && !j.fel) ? `<button onclick="ilmTaBort('${pidJs}', '${itemJs}')" class="text-ads-muted hover:text-red-700" title="Ta bort ur modellen">✕</button>` : '<span class="w-3"></span>'}
    </div>`;
}

function ilmGlomJobb(pid, nyckel) {
  _ilm.jobb.delete(`${pid}|${nyckel}`);
  ilmRita();
}

// ── Filväljaren: mappar och IFC-filer i ACC ───────────────────────────────────
// Samma träd för båda lägena: 'mapp' väljer modellens mapp (en), 'ifc' väljer
// IFC-filer (flera). Id:n innehåller tecken som inte passar i onclick, så
// knapparna får löpnummer som pekar in i blad.noder.

function ilmOppnaBlad(lage) {
  const pid = _ilm.projektId;
  _ilm.blad = { lage, pid, topp: { laddar: true }, innehall: new Map(), oppna: new Set(), valda: new Map(), noder: [], vald: null };
  ilmRita();
  getTopFolders(ilmHub(), pid).then(
    items => { if (_ilm.blad?.pid === pid) _ilm.blad.topp = { items: items.filter(f => !f.attributes?.hidden) }; ilmRita(); },
    err   => { if (_ilm.blad?.pid === pid) _ilm.blad.topp = { fel: vkFelText(err) }; ilmRita(); });
}

function ilmNod(post) {
  const noder = _ilm.blad.noder;
  let i = noder.findIndex(n => n.id === post.id);
  if (i === -1) i = noder.push(post) - 1;
  return i;
}

async function ilmBladOppna(i) {
  const b = _ilm.blad;
  const nod = b?.noder[i];
  if (!nod) return;
  if (b.oppna.has(nod.id)) { b.oppna.delete(nod.id); return ilmRita(); }
  b.oppna.add(nod.id);
  if (!b.innehall.has(nod.id)) {
    b.innehall.set(nod.id, { laddar: true });
    ilmRita();
    try {
      const { poster, tips } = await getFolderContentsWithTips(b.pid, nod.id);
      b.innehall.set(nod.id, { poster, tips });
    } catch (err) {
      b.innehall.set(nod.id, { fel: vkFelText(err) });
    }
  }
  ilmRita();
}

function ilmBladValj(i) {
  const b = _ilm.blad;
  const nod = b?.noder[i];
  if (!nod) return;
  if (b.lage === 'mapp') b.vald = b.vald?.id === nod.id ? null : nod;
  else if (b.valda.has(nod.id)) b.valda.delete(nod.id);
  else b.valda.set(nod.id, nod);
  ilmRita();
}

async function ilmBladKlar() {
  const b = _ilm.blad;
  if (!b) return;
  const pid = b.pid;
  if (b.lage === 'mapp') {
    if (!b.vald) return;
    const mapp = { id: b.vald.id, sokvag: b.vald.sokvag };
    _ilm.blad = null;
    const ix = _ilm.index.get(pid);
    Object.assign(ix, { laddar: true, fel: null });
    ilmRita();
    try {
      // En tom förteckning skrivs direkt: då hittar alla mappen, och behörigheten prövas.
      await ilmSkrivIndex(pid, () => {}, mapp);
    } catch (err) {
      Object.assign(ix, { laddar: false, mapp: null, fel: `Kunde inte spara i mappen: ${vkFelText(err)}` });
    }
    ilmRita();
    return;
  }
  const valda = [...b.valda.values()].map(n => ({ itemId: n.id, namn: n.namn, sokvag: n.sokvag, storlek: n.storlek }));
  _ilm.blad = null;
  ilmRita();
  ilmLaggTillFranAcc(pid, valda);
}

function ilmBladHtml() {
  const b = _ilm.blad;
  const iModellen = new Set(ilmFiler(b.pid).map(f => f.ifc.itemId));
  const rad = (djup, inne) => `<div class="flex items-center gap-1.5 py-0.5" style="padding-left: ${djup * 16}px">${inne}</div>`;
  const mappar = (items, djup, foralder) => items.map(f => {
    const namn = vkMappNamnAv(f);
    const sokvag = foralder ? `${foralder} / ${namn}` : namn;
    const i = ilmNod({ id: f.id, namn, sokvag });
    const oppen = b.oppna.has(f.id);
    const inne = b.innehall.get(f.id);
    const vald = b.lage === 'mapp' && b.vald?.id === f.id;
    let html = rad(djup, `
      <button onclick="ilmBladOppna(${i})" class="w-4 text-ads-muted hover:text-ads-text">${oppen ? '▾' : '▸'}</button>
      ${b.lage === 'mapp' ? `<input type="radio" name="ilm-mapp" ${vald ? 'checked' : ''} onclick="ilmBladValj(${i})" class="accent-ads-blue" />` : ''}
      <button onclick="${b.lage === 'mapp' ? `ilmBladValj(${i})` : `ilmBladOppna(${i})`}" class="text-left truncate ${vald ? 'font-semibold text-ads-blue' : 'text-ads-text'}">📁 ${vkEsc(namn)}</button>`);
    if (oppen) {
      if (!inne || inne.laddar) html += rad(djup + 1, '<span class="text-ads-muted">Läser…</span>');
      else if (inne.fel) html += rad(djup + 1, `<span class="text-red-700">${vkEsc(inne.fel)}</span>`);
      else {
        const under = inne.poster.filter(p => p.type === 'folders').sort((x, y) => vkMappNamnAv(x).localeCompare(vkMappNamnAv(y), 'sv'));
        html += mappar(under, djup + 1, sokvag);
        if (b.lage === 'ifc') {
          const ifc = inne.poster.filter(p => p.type === 'items' && /\.ifc$/i.test(p.attributes?.displayName || ''))
            .sort((x, y) => x.attributes.displayName.localeCompare(y.attributes.displayName, 'sv'));
          html += ifc.map(p => {
            const tip = tipVersionOf(p, inne.tips);
            const storlek = tip?.attributes?.storageSize ?? null;
            const j = ilmNod({ id: p.id, namn: p.attributes.displayName, sokvag, storlek });
            const finns = iModellen.has(p.id);
            return rad(djup + 1, `
              <span class="w-4"></span>
              <input type="checkbox" ${finns || b.valda.has(p.id) ? 'checked' : ''} ${finns ? 'disabled' : ''} onclick="ilmBladValj(${j})" class="accent-ads-blue" />
              <button ${finns ? 'disabled' : `onclick="ilmBladValj(${j})"`} class="text-left truncate ${finns ? 'text-ads-muted' : 'text-ads-text'}">${vkEsc(p.attributes.displayName)}</button>
              <span class="text-[11px] text-ads-muted whitespace-nowrap">${tip?.attributes?.versionNumber ? `V${tip.attributes.versionNumber}` : ''} ${ilmStorlek(storlek)}${finns ? ' · ingår redan' : ''}</span>`);
          }).join('');
          if (!under.length && !ifc.length) html += rad(djup + 1, '<span class="text-ads-muted italic">Inga mappar eller IFC-filer.</span>');
        }
      }
    }
    return html;
  }).join('');

  const topp = b.topp;
  const trad = topp.laddar ? '<p class="text-ads-muted">Läser mapparna…</p>'
    : topp.fel ? `<p class="text-red-700">${vkEsc(topp.fel)}</p>`
    : mappar(topp.items, 0, '');
  const antal = b.lage === 'mapp' ? (b.vald ? 1 : 0) : b.valda.size;
  return `
    <div class="flex-1 min-h-0 overflow-y-auto px-5 py-3 text-xs">${trad}</div>
    <div class="shrink-0 flex items-center gap-2 px-5 py-3 border-t border-ads-border bg-ads-gray/50 rounded-b-lg">
      <span class="text-xs text-ads-muted truncate">${b.lage === 'mapp' ? (b.vald ? vkEsc(b.vald.sokvag) : 'Ingen mapp vald') : `${antal} ${antal === 1 ? 'fil vald' : 'filer valda'}`}</span>
      <div class="flex-1"></div>
      ${ilmKnapp('_ilm.blad = null; ilmRita()', 'Tillbaka')}
      ${ilmKnapp('ilmBladKlar()', b.lage === 'mapp' ? 'Välj mappen' : `Lägg till${antal ? ` (${antal})` : ''}`,
                 antal ? 'border-ads-blue bg-ads-blue text-white hover:bg-ads-blue-dark' : '', antal ? '' : 'disabled')}
    </div>`;
}
