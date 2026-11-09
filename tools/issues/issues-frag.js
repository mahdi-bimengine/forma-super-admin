// issues-frag.js — den lätta modellen under ärendelistan, byggd på That Opens
// Fragments (docs/PLAN-FRAGMENTS.md).
//
// Biblioteken (three, @thatopen/components, @thatopen/fragments, web-ifc,
// @thatopen/components-front för mätning) är ES-moduler från CDN med fasta
// versioner i import map:en i index.html. De laddas först när modellen visas,
// med dynamisk import() från det här vanliga skriptet. En misslyckad
// modulladdning kommer webbläsaren ihåg för sidan, så import map:en måste vara
// komplett från början (provat 2026-11-06).
//
// Visaren (en That Open-"värld": scen, kamera, renderare) skapas i #isv-visare,
// som ligger i panelens bestående ruta (_isv.ruta) och flyttas med vid varje
// omritning. Storleken följs med en ResizeObserver.
//
// Projektets modell är en .frag per IFC (issues-lattmodell.js). De laddas med
// IFC-filens lineage som modell-id, så att ett ärendes linkedDocuments.urn
// pekar rätt på modellen (del 4). Fragments flyttar varje modell nära origo och
// lägger dem rätt mot den första (autoCoordinate). .frag-filerna sparas i
// webbläsaren (IndexedDB, nyckel = filens versions-id i ACC), så en andra
// öppning hämtar inget.
//
// Verktyg (isfRitaVerktyg): snitt (en låda av sex plan som går att dra, eller
// fria plan med dubbelklick), mätning (dubbelklick på två punkter, fäster mot
// hörn och kanter) och egenskaper (klick på ett element).

const _isf = {
  bibliotek: null,   // löfte om { THREE, OBC, FRAGS }
  front:     null,   // löfte om @thatopen/components-front (mätning), laddas vid behov
  startar:   null,   // löfte om världen, medan den startas och sedan
  varld:     null,   // { components, world, fm, behallare, observer, THREE, OBC, FRAGS }
  projektId: null,   // projektet vars modell visas
  fel:       null,   // text om visaren inte gick att starta
  db:        null,   // löfte om webbläsarens modellcache (isfCacheDb)
  laddade:   new Map(), // modell-id (IFC-lineage) → { versionId, namn, koord, farg (den som är lagd på) }
  vantar:    false,     // ett ärende klickades medan modellerna laddades: gå dit efteråt
  dolda:     new Set(), // modell-id som användaren har dolt (per webbläsare och projekt, isf-dolda:<id>)
  modellMeny: false,    // listan Modeller ovanför verktygsraden är öppen
  behall:    new Map(), // modell-id → Set med element som inte tonas ner (isfTonaNer)
  laddar:    false,
  laddaIgen: false,
  laddning:  null,   // { klara, totalt, namn } medan modeller hämtas
  laddFel:   [],     // texter om modeller som inte gick att ladda
  // Verktygen.
  snitt:     null,   // null, 'lada' eller 'plan'
  mat:       false,
  egenskaper: isvLasVal('isf-egenskaper', false),
  vald:      null,   // { modelId, localId }
  meny:      false,  // snittmenyn är öppen
  // Ärendena i modellen (isfGaTillArende).
  platser:   new Map(), // ärende-id → plats (isfPlacera) eller null; töms när modellerna ändras
  lage:      new Map(), // ärende-id → 'ja' | 'nej': finns ärendets modell eller element i den lätta modellen
  markor:    null,      // nålen i scenen
  tonade:    false,     // omgivningen är nedtonad
  arendeSnitt: isvLasVal('isf-arendesnitt', true),  // snittlåda runt ärendet
  tona:      isvLasVal('isf-tona', true),           // tona ner allt utom elementen vid nålen
  lador:     new Map(), // modell-id → löfte om { ids, boxar } för nedtoningen
};

// Fokus på ärendet. Mått i meter.
const ISF_NARA_M     = 0.3;  // element inom så här långt från nålen hör till ärendet (krockar)
const ISF_MARGINAL_M = 3;    // snittlådan sträcker sig så här långt runt nålen
const ISF_ELEMENT_M  = 8;    // och tar med elementet upp till så här långt bort
const ISF_EXAKT_M    = 0.5;  // en omräknad nål längre än så från sitt element räknas som fel

const ISF_VALD_FARG = '#0696D7';
// Markeringen på en modell med en blå färg nära ISF_VALD_FARG (finns i paletten).
const ISF_VALD_FARG_BLA_MODELL = '#F59E0B';

function isfValdFarg(modelId) {
  const farg = _isf.laddade.get(modelId)?.farg;
  if (!farg) return ISF_VALD_FARG;
  const a = parseInt(farg.slice(1), 16), b = parseInt(ISF_VALD_FARG.slice(1), 16);
  const d = Math.hypot(((a >> 16) & 255) - ((b >> 16) & 255), ((a >> 8) & 255) - ((b >> 8) & 255), (a & 255) - (b & 255));
  return d < 120 ? ISF_VALD_FARG_BLA_MODELL : ISF_VALD_FARG;
}

function isfBibliotek() {
  if (!_isf.bibliotek) {
    _isf.bibliotek = Promise.all([import('three'), import('@thatopen/components'), import('@thatopen/fragments')])
      .then(([THREE, OBC, FRAGS]) => ({ THREE, OBC, FRAGS }));
    _isf.bibliotek.catch(() => { _isf.bibliotek = null; });
  }
  return _isf.bibliotek;
}

function isfFront() {
  if (!_isf.front) {
    _isf.front = import('@thatopen/components-front');
    _isf.front.catch(() => { _isf.front = null; });
  }
  return _isf.front;
}

// Startar visaren en gång per öppnad panel.
function isfStarta() {
  if (_isf.startar) return _isf.startar;
  const behallare = document.getElementById('isv-visare');
  if (!behallare) return Promise.reject(new Error('Modellrutan är stängd.'));
  _isf.fel = null;
  _isf.startar = (async () => {
    const { THREE, OBC, FRAGS } = await isfBibliotek();
    if (!behallare.isConnected) throw new Error('Modellrutan stängdes.');
    const components = new OBC.Components();
    const world = components.get(OBC.Worlds).create();
    world.scene = new OBC.SimpleScene(components);
    world.scene.setup();
    world.scene.three.background = new THREE.Color('#eef1f5');
    world.renderer = new OBC.SimpleRenderer(components, behallare);
    world.camera = new OBC.OrthoPerspectiveCamera(components);
    components.init();
    isfStallInMusen(world.camera.controls);
    await world.camera.controls.setLookAt(25, 18, 25, 0, 0, 0, false);
    components.get(OBC.Grids).create(world);
    components.get(OBC.Raycasters).get(world);

    const fm = components.get(OBC.FragmentsManager);
    fm.init(await OBC.FragmentsManager.getWorker());
    // Fragments ritar bara det som syns; efter en kamerarörelse räknas det om.
    world.camera.controls.addEventListener('rest', () => fm.core.update(true));
    fm.list.onItemSet.add(({ value: model }) => {
      model.useCamera(world.camera.three);
      world.scene.three.add(model.object);
      fm.core.update(true);
    });

    const observer = new ResizeObserver(() => {
      if (!behallare.clientWidth || !behallare.clientHeight) return;
      world.renderer.resize();
      world.camera.updateAspect?.();
      _isf.varld?.etiketter?.storlek();
    });
    observer.observe(behallare);
    _isf.varld = { components, world, fm, behallare, observer, THREE, OBC, FRAGS };
    isfKopplaMus(behallare);
    return _isf.varld;
  })();
  _isf.startar.catch(err => {
    console.warn('Modellvisaren', err);
    _isf.startar = null;
    _isf.fel = `Modellvisaren kunde inte starta: ${String(err.message || err).slice(0, 160)}`;
    isvRitaRad();
  });
  return _isf.startar;
}

// ── Projektets modeller ───────────────────────────────────────────────────────

// Visar projektets modell. Byts projekt tas den förra modellen bort.
async function isfVisaProjekt(projektId) {
  if (_isf.projektId && _isf.projektId !== projektId) await isfTomVisaren();
  _isf.projektId = projektId;
  _isf.dolda = new Set(isvLasVal(`isf-dolda:${projektId}`, []));
  ilmLas(projektId);
  ilmLasOm?.(projektId);
  isvRitaRad();
  try {
    await isfStarta();
  } catch { return; /* felet visas av isfStarta */ }
  isvRitaRad();
  isfLaddaProjekt(projektId);
}

// Modellens filer i projektet har ändrats (lagts till, gjorts om, tagits bort).
function isfModellAndrad(projektId) {
  if (_isf.varld && projektId === _isf.projektId && !ilmLaddar(projektId)) isfLaddaProjekt(projektId);
}

// Laddar det som saknas, tar bort det som inte längre ingår och lägger på
// modellernas färger. En körning åt gången; ändras förteckningen under tiden
// körs den en gång till. Kameran går till ärendet bara om modellerna faktiskt
// ändrades (eller ett ärende klickades under tiden), så att till exempel ett
// färgbyte inte flyttar den.
async function isfLaddaProjekt(pid) {
  if (_isf.laddar) { _isf.laddaIgen = true; return; }
  _isf.laddar = true;
  let andrat = false;
  try {
    do {
      _isf.laddaIgen = false;
      const v = await isfStarta();
      await ilmLas(pid);
      if (_isf.projektId !== pid || _isf.varld !== v) return;
      const filer = ilmFiler(pid).filter(f => f.frag?.itemId);
      const onskade = new Map(filer.map(f => [f.ifc.itemId, f]));
      let andratNu = false;

      for (const [id, info] of [..._isf.laddade]) {
        const f = onskade.get(id);
        if (f && f.frag.versionId === info.versionId) continue;
        if (_isf.vald?.modelId === id) _isf.vald = null;
        await v.fm.core.disposeModel(id).catch(() => {});
        _isf.laddade.delete(id);
        andratNu = true;
      }

      const nya = filer.filter(f => !_isf.laddade.has(f.ifc.itemId));
      const forsta = !_isf.laddade.size;
      _isf.laddFel = _isf.laddFel.filter(t => !nya.some(f => t.startsWith(f.ifc.namn)));
      _isf.laddning = nya.length ? { klara: 0, totalt: nya.length, namn: '' } : null;
      for (const f of nya) {
        _isf.laddning.namn = f.ifc.namn;
        isvRitaRad();
        try {
          let bytes = f.frag.versionId ? await isfCacheHamta(f.frag.versionId).catch(() => null) : null;
          if (!bytes) {
            bytes = new Uint8Array(await ilmHamtaFil(pid, f.frag.itemId, () => {}));
            if (f.frag.versionId) isfCacheSpara(f.frag.versionId, bytes).catch(() => {});
          }
          if (_isf.projektId !== pid || _isf.varld !== v) return;
          const modell = await v.fm.core.load(bytes, { modelId: f.ifc.itemId, camera: v.world.camera.three });
          // Hur långt omvandlingen flyttade modellen mot origo (web-ifc:s
          // COORDINATE_TO_ORIGIN), i meter med Y uppåt. Behövs för ärendenas nålar.
          const koord = (await modell.getCoordinates().catch(() => null))?.slice(0, 3) || [0, 0, 0];
          _isf.laddade.set(f.ifc.itemId, { versionId: f.frag.versionId, namn: f.ifc.namn, koord, farg: null });
          andratNu = true;
        } catch (err) {
          console.warn('Modellvisaren: ladda', f.ifc.namn, err);
          _isf.laddFel.push(`${f.ifc.namn}: ${String(err.message || err).slice(0, 120)}`);
        }
        _isf.laddning.klara++;
      }
      _isf.laddning = null;
      await isfFargaModeller(pid);
      v.fm.core.update(true);
      if (andratNu) {
        // Modellerna har ändrats: ärendenas placering räknas om.
        andrat = true;
        _isf.platser.clear();
        _isf.lador.clear();
        if (forsta && _isf.laddade.size && !_isv.aktiv) await isfVisaAllt();
        if (_isf.snitt === 'lada' && !_isv.aktiv) isfSnittlada();
      }
    } while (_isf.laddaIgen);
  } finally {
    _isf.laddar = false;
    _isf.laddning = null;
    isvRitaRad();
    // Stängdes visaren eller byttes projekt medan det laddade, och bad den nya
    // visaren om en laddning under tiden, görs den nu (annars blev den tom).
    // (Efter en vanlig körning är laddaIgen alltid falsk.)
    if (_isf.laddaIgen && _isf.varld && _isf.projektId) {
      _isf.laddaIgen = false;
      setTimeout(() => isfLaddaProjekt(_isf.projektId), 0);
    }
  }
  if (andrat) await isfKartlagg(pid);
  if (_isv.aktiv && _isv.aktiv.projektId === pid && (andrat || _isf.vantar)) {
    _isf.vantar = false;
    isfGaTillArende(_isv.aktiv, _isv.lank);
  }
}

// Lägger på varje modells färg ur förteckningen (eller tar bort den), bara där
// den har ändrats. Färgen och nedtoningen delar biblioteket i samma fält per
// element men slås ihop, så nedtoningen ligger kvar. Det markerade elementet
// markeras om efteråt, annars tar färgen över markeringen. Dolda modeller
// (listan Modeller) döljs här också.
async function isfFargaModeller(pid) {
  const v = _isf.varld;
  if (!v || _isf.projektId !== pid) return;
  for (const f of ilmFiler(pid)) {
    const info = _isf.laddade.get(f.ifc.itemId);
    const modell = v.fm.list.get(f.ifc.itemId);
    if (!info || !modell) continue;
    const dold = _isf.dolda.has(f.ifc.itemId);
    if (!!info.dold !== dold) {
      await modell.setVisible(undefined, !dold).catch(err => console.warn('Modellvisaren: dölj', f.ifc.namn, err));
      info.dold = dold;
    }
    const farg = f.farg || null;
    if (info.farg === farg) continue;
    try {
      if (farg) await modell.setColor(undefined, new v.THREE.Color(farg));
      else await modell.resetColor(undefined);
      info.farg = farg;
    } catch (err) {
      console.warn('Modellvisaren: färg', f.ifc.namn, err);
    }
    if (_isf.vald?.modelId === f.ifc.itemId) await isfMarkera(_isf.vald);
  }
  isfRitaVerktyg();   // listan Modeller visar färgerna
}

async function isfTomVisaren() {
  const v = _isf.varld;
  isfStangVerktyg();
  await isfRensaArende();
  _isf.vald = null;
  _isf.platser.clear();
  _isf.lage.clear();
  _isf.lador.clear();
  if (v) for (const id of [..._isf.laddade.keys()]) await v.fm.core.disposeModel(id).catch(() => {});
  _isf.laddade.clear();
  _isf.laddFel = [];
}

// Alla laddade modellers utbredning, i visarens koordinater.
function isfModellernasLada() {
  const v = _isf.varld;
  const lada = new v.THREE.Box3();
  for (const m of v.fm.list.values()) {
    if (_isf.dolda.has(m.modelId)) continue;
    const b = m.box;
    if (b && !b.isEmpty()) lada.union(b);
  }
  return lada;
}

// Hela modellen snett ovanifrån.
async function isfVisaAllt() {
  const v = _isf.varld;
  if (!v) return;
  const lada = isfModellernasLada();
  if (lada.isEmpty()) return;
  const mitt = lada.getCenter(new v.THREE.Vector3());
  const r = Math.max(1, lada.getSize(new v.THREE.Vector3()).length());
  await v.world.camera.controls.setLookAt(mitt.x + r * 0.7, mitt.y + r * 0.55, mitt.z + r * 0.7, mitt.x, mitt.y, mitt.z, false);
  await v.world.camera.controls.fitToBox(lada, false, { paddingTop: 0.5, paddingBottom: 0.5, paddingLeft: 0.5, paddingRight: 0.5 });
  v.fm.core.update(true);
}

// Är någon modell laddad i visaren?
function isfHarModell() {
  return !!_isf.varld && _isf.varld.fm.list.size > 0;
}

// Text mitt i modellrutan, eller '' när modellen syns. Får innehålla HTML.
function isfMeddelande(projektId) {
  if (_isf.fel) return `<span class="text-red-700">${vkEsc(_isf.fel)}</span>`;
  if (!_isf.varld) return 'Startar modellvisaren…';
  if (ilmLaddar(projektId)) return 'Läser modellinställningarna…';
  if (!ilmFiler(projektId).length) {
    return `Projektet har ingen modell än.<br>Välj vilka IFC-filer den ska bestå av i
      <button onclick="ilmOppna()" class="text-ads-blue hover:underline">Modellinställningar</button>.`;
  }
  if (_isf.laddning && !isfHarModell()) {
    const l = _isf.laddning;
    return `Laddar modellen (${l.klara + 1} av ${l.totalt})…<br><span class="text-xs">${vkEsc(l.namn)}</span>`;
  }
  if (!isfHarModell() && _isf.laddFel.length) {
    return `<span class="text-red-700">Modellen gick inte att ladda.</span><br><span class="text-xs">${_isf.laddFel.map(vkEsc).join('<br>')}</span>`;
  }
  return '';
}

// Kort status i raden ovanför modellen.
function isfStatus() {
  if (_isf.laddning && isfHarModell()) return `Laddar ${_isf.laddning.klara + 1} av ${_isf.laddning.totalt}…`;
  if (_isf.laddFel.length && isfHarModell()) return `${_isf.laddFel.length} ${_isf.laddFel.length === 1 ? 'fil' : 'filer'} kunde inte laddas`;
  return '';
}

// ── Ärenden i modellen ────────────────────────────────────────────────────────
// Ett ärende placerat i Model Coordination har en nål (position), kamera
// (viewerState.viewport) och elementets id (externalId) i Autodesks koordinater:
//   IFC-modell:   externalId är elementets GlobalId. Position och kamera ligger
//                 i filens längdenhet med georeferensen (IfcMapConversion)
//                 pålagd, och viewerState.globalOffset ska läggas till (var 0
//                 i alla provade ärenden). isfFranAutodesk räknar tillbaka:
//                 ta bort kartan, till meter, Y uppåt, modellens förskjutning i
//                 visaren. Provat på R&D #19: nålen hamnar 0,000 m från sitt element.
//   Revit-modell: externalId är Revits UniqueId, som görs om till IFC-exportens
//                 GlobalId (isfRevitTillIfcGuid). Revits interna koordinater går
//                 inte att räkna om utan exportinställningarna, så nålen sätts
//                 mitt på elementet och märks som ungefärlig. Bara provat med
//                 påhittade id:n (R&D saknar Revit-modell med IFC-export).
// En omräknad nål kontrolleras mot sitt element (ISF_EXAKT_M); stämmer den
// inte används elementets mitt, så ett fel i kartan aldrig visar fel ställe.

const ISF_IFC_TECKEN = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

function isfArIfcGuid(s) {
  return /^[0-9A-Za-z_$]{22}$/.test(String(s || ''));
}

// 128 bitar (32 hextecken i vanlig ordning) → IFC:s komprimerade GlobalId (22 tecken).
function isfIfcGuidFranHex(hex) {
  const b = hex.match(/../g).map(h => parseInt(h, 16));
  const tal = [b[0], (b[1] << 16) | (b[2] << 8) | b[3], (b[4] << 16) | (b[5] << 8) | b[6],
               (b[7] << 16) | (b[8] << 8) | b[9], (b[10] << 16) | (b[11] << 8) | b[12], (b[13] << 16) | (b[14] << 8) | b[15]];
  const koda = (n, siffror) => { let s = ''; for (let i = 0; i < siffror; i++) { s = ISF_IFC_TECKEN[n % 64] + s; n = Math.floor(n / 64); } return s; };
  return koda(tal[0], 2) + tal.slice(1).map(n => koda(n, 4)).join('');
}

// Revits UniqueId (episod-GUID + "-" + element-id i hex) → GlobalId i IFC-exporten:
// episodens sista 8 hextecken XOR element-id (Revits ExportUtils.GetExportId).
// Gäller när exporten inte har fått egna GlobalId:n.
function isfRevitTillIfcGuid(uid) {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{8})$/i.exec(String(uid || ''));
  if (!m) return null;
  const g = m[1].replace(/-/g, '');
  const sista = (parseInt(g.slice(24), 16) ^ parseInt(m[2], 16)) >>> 0;
  return isfIfcGuidFranHex(g.slice(0, 24) + sista.toString(16).padStart(8, '0'));
}

function isfArendetsGuid(lank) {
  const ext = lank?.details?.externalId;
  return isfArIfcGuid(ext) ? ext : isfRevitTillIfcGuid(ext);
}

function isfTre(p) {
  if (Array.isArray(p)) return [+p[0], +p[1], +p[2]];
  if (p && typeof p === 'object') return [+p.x, +p.y, +p.z];
  return null;
}

// En punkt i Autodesks koordinater för en IFC-fil → visarens koordinater:
//   Autodesk = georeferensen pålagd på IFC-filens egna koordinater (provat:
//     zonens hörn i Autodesks visare och i web-ifc stämmer på 0,2 mm)
//   .frag    = web-ifc:s koordinater (meter, Y uppåt) + getCoordinates()
//   visaren  = .frag + modellens förskjutning (autoCoordinate), matrixWorld
function isfFranAutodesk(p, offset, fil, modell) {
  const xyz = isfTre(p);
  if (!xyz || xyz.some(n => !Number.isFinite(n))) return null;
  const o = isfTre(offset) || [0, 0, 0];
  let [x, y, z] = xyz.map((n, i) => n + (Number.isFinite(o[i]) ? o[i] : 0));
  const k = fil.ifc.karta;
  if (k) {
    const dx = x - k.E, dy = y - k.N;
    [x, y, z] = [(dx * k.a + dy * k.o) / k.s, (-dx * k.o + dy * k.a) / k.s, z - k.H];
  }
  const e = fil.ifc.enhet || 1;
  const [kx, ky, kz] = _isf.laddade.get(modell.modelId)?.koord || [0, 0, 0];
  modell.object.updateMatrixWorld(true);
  return new _isf.varld.THREE.Vector3(x * e + kx, z * e + ky, -y * e + kz).applyMatrix4(modell.object.matrixWorld);
}

// Var ärendet sitter i den lätta modellen, eller null om dess modell och element saknas.
async function isfPlacera(lank) {
  const v = _isf.varld;
  const T = v.THREE;
  const filer = ilmFiler(_isf.projektId).filter(f => v.fm.list.has(f.ifc.itemId));
  const lineage = isvLineage(lank.urn);
  const guid = isfArendetsGuid(lank);
  let fil = filer.find(f => f.ifc.itemId === lineage) || null;
  let localId = null;
  if (fil && guid) [localId] = await v.fm.list.get(fil.ifc.itemId).getLocalIdsByGuids([guid]);
  if (localId == null && guid) {
    for (const f of filer) {
      const [id] = await v.fm.list.get(f.ifc.itemId).getLocalIdsByGuids([guid]);
      if (id != null) { fil = f; localId = id; break; }
    }
  }
  if (!fil) return null;
  const m = v.fm.list.get(fil.ifc.itemId);
  let elementLada = null;
  if (localId != null) {
    // getMergedBox ger visarens koordinater (modellens förskjutning är med).
    const b = await m.getMergedBox([localId]);
    if (!b.isEmpty()) elementLada = b;
  }

  // Exakt: nålen på en IFC (samma fil, eller samma GlobalId som i en IFC) räknas om.
  let punkt = null, kamera = null, exakt = false;
  const ifcNal = fil.ifc.itemId === lineage || isfArIfcGuid(lank.details?.externalId);
  if (ifcNal && lank.details?.position) {
    const vs = lank.details.viewerState || {};
    const p = isfFranAutodesk(lank.details.position, vs.globalOffset, fil, m);
    if (p && (!elementLada || elementLada.distanceToPoint(p) <= ISF_EXAKT_M)) {
      punkt = p;
      exakt = true;
      const oga = isfFranAutodesk(vs.viewport?.eye, vs.globalOffset, fil, m);
      const mal = isfFranAutodesk(vs.viewport?.target, vs.globalOffset, fil, m);
      if (oga && mal && oga.distanceTo(mal) > 1e-6) kamera = { oga, mal };
    }
  }
  if (!punkt && elementLada) punkt = elementLada.getCenter(new T.Vector3());
  if (!punkt) return null;
  return { modelId: fil.ifc.itemId, localId, punkt, elementLada, kamera, exakt };
}

// Finns varje placerat ärende i projektets lätta modell? En sökning per modell
// för alla ärendens GlobalId:n på en gång. Styr gråmarkeringen i listan.
async function isfKartlagg(pid) {
  const v = _isf.varld;
  if (!v || _isf.projektId !== pid) return;
  await _isv.placeringar.get(pid)?.catch(() => {});
  const filer = ilmFiler(pid).filter(f => v.fm.list.has(f.ifc.itemId));
  const lineages = new Set(filer.map(f => f.ifc.itemId));
  const arenden = isAllaArenden().filter(a => a.projektId === pid && _isv.arenden.get(a.id)).map(a => [a.id, _isv.arenden.get(a.id)]);
  const guid = new Map(arenden.map(([id, l]) => [id, isfArendetsGuid(l)]).filter(([, g]) => g));
  const lista = [...new Set(guid.values())];
  const hittade = new Set();
  if (lista.length) {
    for (const f of filer) {
      const ids = await v.fm.list.get(f.ifc.itemId).getLocalIdsByGuids(lista).catch(() => []);
      lista.forEach((g, i) => { if (ids[i] != null) hittade.add(g); });
    }
  }
  if (_isf.projektId !== pid) return;
  _isf.lage = new Map(arenden.map(([id, l]) => [id, lineages.has(isvLineage(l.urn)) || hittade.has(guid.get(id)) ? 'ja' : 'nej']));
  isvRitaRad();
}

// 'ja', 'nej' eller null (okänt än, eller ett annat projekt än det som visas).
function isfArendeLage(id) {
  return _isf.lage.get(id) || null;
}

// Tar bort förra ärendets nål, nedtoning och snittlåda.
async function isfRensaArende() {
  const v = _isf.varld;
  if (!v) return;
  if (_isf.markor) { _isf.markor.removeFromParent(); _isf.markor.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); _isf.markor = null; }
  if (_isf.tonade) {
    _isf.tonade = false;
    _isf.behall.clear();
    for (const m of v.fm.list.values()) await m.resetOpacity(undefined).catch(() => {});
  }
}

let _isfArendeNr = 0;

// Går till ärendets plats: nål, markerat element, snittlåda, nedtoning och kamera.
async function isfGaTillArende(arende, lank) {
  const nr = ++_isfArendeNr;
  if (!arende) return;
  if (!lank) { isvSattStatus('Ärendet är inte placerat i någon modell.'); await isfRensaArende(); return; }
  const v = _isf.varld;
  // Laddas modellen fortfarande går isfLaddaProjekt hit när den är klar.
  if (v && _isf.projektId === arende.projektId && (_isf.laddar || ilmLaddar(arende.projektId))) { _isf.vantar = true; return; }
  if (!v || _isf.projektId !== arende.projektId) return;
  if (!isfHarModell()) return;

  let plats = _isf.platser.get(arende.id);
  if (plats === undefined) {
    try { plats = await isfPlacera(lank); } catch (err) { console.warn('Modellvisaren: placera', err); plats = null; }
    _isf.platser.set(arende.id, plats);
  }
  if (nr !== _isfArendeNr) return;
  await isfRensaArende();
  if (nr !== _isfArendeNr) return;
  if (!plats) {
    await isfMarkera(null);
    isvSattStatus('Ärendets modell finns inte i den lätta modellen.');
    return;
  }
  const T = v.THREE;

  // Nålen: en orange kula som syns genom det som ligger framför.
  const kula = new T.Mesh(new T.SphereGeometry(0.12, 24, 16),
                          new T.MeshBasicMaterial({ color: '#E8590C', depthTest: false, transparent: true, opacity: 0.95 }));
  kula.renderOrder = 999;
  kula.position.copy(plats.punkt);
  _isf.markor = kula;
  v.world.scene.three.add(kula);

  // Området runt ärendet: några meter runt nålen plus elementet (begränsat).
  const lada = new T.Box3(plats.punkt.clone(), plats.punkt.clone()).expandByScalar(ISF_MARGINAL_M);
  if (plats.elementLada) {
    const tak = new T.Box3(plats.punkt.clone(), plats.punkt.clone()).expandByScalar(ISF_ELEMENT_M);
    lada.union(plats.elementLada.clone().intersect(tak));
  }
  if (_isf.arendeSnitt) {
    const clipper = v.components.get(v.OBC.Clipper);
    if (_isf.snitt !== 'lada') isfSnitt('lada');
    clipper.enabled = true;
    isfSnittlada(lada);
  } else if (_isf.snitt === 'lada') {
    isfSnitt(null);
  }

  await isfMarkera(plats.localId != null ? { modelId: plats.modelId, localId: plats.localId } : null);
  if (nr !== _isfArendeNr) return;
  if (_isf.tona) await isfTonaNer(plats);
  if (nr !== _isfArendeNr) return;

  // Kameran: ärendets egen blickriktning, så nära att området fyller bilden.
  const riktning = plats.kamera ? plats.kamera.mal.clone().sub(plats.kamera.oga).normalize() : new T.Vector3(-1, -0.8, -1).normalize();
  const mitt = lada.getCenter(new T.Vector3());
  const radie = lada.getBoundingSphere(new T.Sphere()).radius;
  const fov = (v.world.camera.three.fov || 45) * Math.PI / 180;
  const avstand = Math.max(2, radie / Math.sin(fov / 2) * 0.9);
  const oga = mitt.clone().sub(riktning.multiplyScalar(avstand));
  await v.world.camera.controls.setLookAt(oga.x, oga.y, oga.z, mitt.x, mitt.y, mitt.z, true);
  v.fm.core.update(true);
  if (nr !== _isfArendeNr) return;
  isvSattStatus(plats.exakt ? '' : 'Ungefärlig placering: nålen visas mitt på elementet.');
}

// Allt blir genomskinligt utom ärendets element och det som ligger vid nålen.
async function isfTonaNer(plats) {
  const v = _isf.varld;
  const T = v.THREE;
  const nara = new T.Box3(plats.punkt.clone(), plats.punkt.clone()).expandByScalar(ISF_NARA_M);
  _isf.tonade = true;
  for (const m of v.fm.list.values()) {
    if (!_isf.lador.has(m.modelId)) {
      _isf.lador.set(m.modelId, (async () => {
        const ids = await m.getItemsIdsWithGeometry();
        return { ids, boxar: await m.getBoxes(ids) };
      })());
    }
    const { ids, boxar } = await _isf.lador.get(m.modelId);
    // getBoxes ger, som getMergedBox, visarens koordinater.
    const behall = ids.filter((id, i) => boxar[i] && boxar[i].intersectsBox(nara));
    if (m.modelId === plats.modelId && plats.localId != null && !behall.includes(plats.localId)) behall.push(plats.localId);
    _isf.behall.set(m.modelId, new Set(behall));
    await m.setOpacity(undefined, 0.12);
    if (behall.length) await m.resetOpacity(behall);
  }
  v.fm.core.update(true);
}

function isfVaxlaArendeval(namn) {
  _isf[namn] = !_isf[namn];
  isvSparaVal(namn === 'tona' ? 'isf-tona' : 'isf-arendesnitt', _isf[namn]);
  isvRitaRad();
  if (_isv.aktiv) isfGaTillArende(_isv.aktiv, _isv.lank);
}

// Visas det valda ärendet i modellen (för knapparna i raden)?
function isfArendeVisas() {
  const id = _isv.aktiv?.id;
  return !!id && !!_isf.platser.get(id);
}

// ── Mus: som i Model Coordination ────────────────────────────────────────────
// Mahdi (2026-11-06): kontrollerna ska kännas som Autodesks visare i Model
// Coordination, och snurra i lugnare takt än That Opens standard:
//   vänster drag   snurra runt mittpunkten
//   höger drag     panorera (även mittenknappen)
//   hjul           zooma mot muspekaren, och vidare förbi punkten
//   klick          välj element
//   dubbelklick    zooma in på elementet; det blir ny mittpunkt
// Rörelserna följer musen direkt (ingen eftersläpning), men byte av vy glider.

const ISF_SNURR_FART = 0.5;   // That Opens standard är 1, vilket upplevdes som för snabbt
const ISF_ZOOM_FART  = 0.6;

function isfStallInMusen(c) {
  const A = c.constructor.ACTION;
  c.mouseButtons.left   = A.ROTATE;
  c.mouseButtons.right  = A.TRUCK;
  c.mouseButtons.middle = A.TRUCK;
  c.mouseButtons.wheel  = A.DOLLY;
  c.touches.one   = A.TOUCH_ROTATE;
  c.touches.two   = A.TOUCH_DOLLY_TRUCK;
  c.touches.three = A.TOUCH_TRUCK;
  c.azimuthRotateSpeed = ISF_SNURR_FART;
  c.polarRotateSpeed   = ISF_SNURR_FART;
  c.dollySpeed         = ISF_ZOOM_FART;
  c.truckSpeed         = 2;          // panorering följer pekaren
  c.dollyToCursor      = true;
  c.infinityDolly      = true;       // zooma vidare in i modellen i stället för att fastna
  c.minDistance        = 0.5;
  c.maxDistance        = 1e5;        // That Opens orbitläge sätter 300 m, för lite för stora projekt
  c.draggingSmoothTime = 0;
  c.smoothTime         = 0.2;
}

// Dubbelklick utan verktyg: zooma in på elementet under musen och snurra runt det.
async function isfZoomaTillElement() {
  const v = _isf.varld;
  if (!v || !isfHarModell()) return;
  const traff = await v.components.get(v.OBC.Raycasters).get(v.world).castRay().catch(() => null);
  if (!traff?.fragments || traff.localId == null) return;
  const lada = await traff.fragments.getMergedBox([traff.localId]).catch(() => null);
  if (!lada || lada.isEmpty()) return;
  const T = v.THREE;
  const c = v.world.camera.controls;
  const mitt = lada.getCenter(new T.Vector3());
  const radie = Math.max(0.5, lada.getBoundingSphere(new T.Sphere()).radius);
  const fov = (v.world.camera.three.fov || 45) * Math.PI / 180;
  // Samma blickriktning som nu, så nära att elementet fyller ungefär halva bilden.
  const riktning = c.getPosition(new T.Vector3()).sub(c.getTarget(new T.Vector3())).normalize();
  const oga = mitt.clone().add(riktning.multiplyScalar(radie / Math.sin(fov / 2) * 1.6));
  await c.setLookAt(oga.x, oga.y, oga.z, mitt.x, mitt.y, mitt.z, true);
  v.fm.core.update(true);
}

// ── Mus: välja element, dubbelklick för mätning och snittplan ─────────────────

function isfKopplaMus(behallare) {
  let ned = null;
  behallare.addEventListener('pointerdown', e => { ned = { x: e.clientX, y: e.clientY }; });
  behallare.addEventListener('pointerup', e => {
    if (!ned || e.button !== 0) return;
    const flytt = Math.hypot(e.clientX - ned.x, e.clientY - ned.y);
    ned = null;
    if (flytt > 4 || _isf.mat) return;
    isfValjUnderMusen();
  });
  // Delete tar bort mätningen under musen (som i That Opens exempel).
  let over = false;
  behallare.addEventListener('pointerenter', () => { over = true; });
  behallare.addEventListener('pointerleave', () => { over = false; });
  document.addEventListener('keydown', async e => {
    if (!over || !_isf.mat || !_isf.varld || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
    if (e.target.closest?.('input, select, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    const OBF = await isfFront();
    _isf.varld?.components.get(OBF.LengthMeasurement).delete();
  });
  behallare.addEventListener('dblclick', async () => {
    const v = _isf.varld;
    if (!v) return;
    if (_isf.mat) {
      const OBF = await isfFront();
      v.components.get(OBF.LengthMeasurement).create();
    } else if (_isf.snitt === 'plan') {
      await v.components.get(v.OBC.Clipper).create(v.world);
    } else {
      await isfZoomaTillElement();
    }
  });
  // Högerklick panorerar; webbläsarens meny ska inte komma upp.
  behallare.addEventListener('contextmenu', e => e.preventDefault());
}

async function isfValjUnderMusen() {
  const v = _isf.varld;
  if (!v || !isfHarModell()) return;
  const traff = await v.components.get(v.OBC.Raycasters).get(v.world).castRay().catch(() => null);
  const ny = traff?.fragments && traff.localId != null ? { modelId: traff.fragments.modelId, localId: traff.localId } : null;
  await isfMarkera(ny);
}

async function isfMarkera(ny) {
  const v = _isf.varld;
  if (!v) return;
  const forra = _isf.vald;
  _isf.vald = ny;
  if (forra) {
    // resetHighlight tömmer allt på elementet, även modellens färg och
    // nedtoningen, så de läggs tillbaka.
    const m = v.fm.list.get(forra.modelId);
    await m?.resetHighlight([forra.localId]).catch(() => {});
    const farg = _isf.laddade.get(forra.modelId)?.farg;
    if (m && farg) await m.setColor([forra.localId], new v.THREE.Color(farg)).catch(() => {});
    if (m && _isf.tonade && !_isf.behall.get(forra.modelId)?.has(forra.localId)) await m.setOpacity([forra.localId], 0.12).catch(() => {});
  }
  if (ny) {
    // Biblioteket slår ihop med det som redan ligger på elementet, och en
    // modellfärg vinner då över markeringens färg. Därför töms elementet först.
    const m = v.fm.list.get(ny.modelId);
    if (_isf.laddade.get(ny.modelId)?.farg) await m?.resetHighlight([ny.localId]).catch(() => {});
    await m?.highlight([ny.localId], {
      color: new v.THREE.Color(isfValdFarg(ny.modelId)), renderedFaces: v.FRAGS.RenderedFaces.TWO, opacity: 1, transparent: false,
    }).catch(() => {});
  }
  v.fm.core.update(true);
  isfRitaEgenskaper();
}

// ── Verktygsraden ─────────────────────────────────────────────────────────────

function isfRitaVerktyg() {
  const ruta = document.getElementById('isf-verktyg');
  if (!ruta) return;
  if (!isfHarModell()) { ruta.innerHTML = ''; return; }
  const knapp = (pa, klick, text, titel, extra = '') => `
    <button onclick="${klick}" title="${titel}"
            class="px-2.5 py-1 ${extra} ${pa ? 'bg-ads-blue text-white' : 'bg-white text-ads-text hover:bg-ads-gray'}">${text}</button>`;
  const snittText = { lada: 'Snitt: låda', plan: 'Snitt: plan' }[_isf.snitt] || 'Snitt';
  const antalDolda = [..._isf.dolda].filter(id => _isf.laddade.has(id)).length;
  ruta.innerHTML = `
    <div class="relative flex items-stretch text-xs border border-ads-border rounded shadow divide-x divide-ads-border bg-white">
      ${knapp(false, 'isfVisaAllt()', '⌂', 'Visa hela modellen', 'rounded-l')}
      ${knapp(_isf.modellMeny, 'isfVaxlaModellMeny()', `Modeller${antalDolda ? ` (${antalDolda} dolda)` : ''}`, 'Vilka modeller som syns, deras färg och datum')}
      ${_isf.modellMeny ? isfModellMenyHtml() : ''}
      ${knapp(!!_isf.snitt, `isfSnitt(${_isf.snitt ? 'null' : "'lada'"})`, snittText,
              _isf.snitt ? 'Ta bort snittet' : 'Snittlåda: dra i pilarna för att flytta sidorna')}
      ${knapp(_isf.meny, 'isfSnittMeny()', '▾', 'Fler sätt att snitta')}
      ${knapp(_isf.mat, 'isfMat()', 'Mät', _isf.mat ? 'Sluta mäta' : 'Dubbelklicka på två punkter för att mäta avståndet')}
      ${knapp(_isf.egenskaper, 'isfVaxlaEgenskaper()', 'Egenskaper', 'Klicka på ett element för att se dess egenskaper', 'rounded-r')}
      ${_isf.meny ? `
        <div class="absolute bottom-full left-8 mb-1 w-64 bg-white border border-ads-border rounded shadow-lg py-1">
          <button onclick="isfSnitt('lada')" class="block w-full text-left px-3 py-1.5 hover:bg-ads-gray ${_isf.snitt === 'lada' ? 'font-semibold text-ads-blue' : ''}">Snittlåda
            <span class="block text-[10px] text-ads-muted">Sex sidor runt modellen. Dra i pilarna för att flytta en sida.</span></button>
          <button onclick="isfSnitt('plan')" class="block w-full text-left px-3 py-1.5 hover:bg-ads-gray ${_isf.snitt === 'plan' ? 'font-semibold text-ads-blue' : ''}">Snittplan
            <span class="block text-[10px] text-ads-muted">Dubbelklicka på en yta för att snitta där. Dra i pilen för att flytta.</span></button>
          ${_isf.snitt ? '<button onclick="isfSnitt(null)" class="block w-full text-left px-3 py-1.5 hover:bg-ads-gray border-t border-ads-border">Ta bort snittet</button>' : ''}
        </div>` : ''}
    </div>
    ${_isf.mat ? `
      <div class="mt-1 text-center text-[11px] text-ads-muted bg-white/90 rounded px-2 py-0.5">
        Dubbelklicka på två punkter. Delete tar bort mätningen under musen.
        <button onclick="isfRensaMatningar()" class="ml-1 text-ads-blue hover:underline">Rensa alla</button>
      </div>` : _isf.snitt === 'plan' ? `
      <div class="mt-1 text-center text-[11px] text-ads-muted bg-white/90 rounded px-2 py-0.5">Dubbelklicka på en yta för att lägga till ett snittplan.</div>` : ''}`;
}

function isfSnittMeny() {
  _isf.meny = !_isf.meny;
  _isf.modellMeny = false;
  isfRitaVerktyg();
}

// Förbättring 2: listan Modeller, med färg, namn och IFC-datum (gult när det är
// äldre än ILM_GAMMAL_DAGAR), och en kryssruta som visar eller döljer modellen.
// Vad som är dolt gäller bara den egna webbläsaren.
function isfVaxlaModellMeny() {
  _isf.modellMeny = !_isf.modellMeny;
  _isf.meny = false;
  isfRitaVerktyg();
}

function isfModellMenyHtml() {
  const pid = _isf.projektId;
  const filer = ilmFiler(pid).filter(f => _isf.laddade.has(f.ifc.itemId));
  const rader = filer.map((f, i) => {
    const dold = _isf.dolda.has(f.ifc.itemId);
    const gammal = ilmArGammal(f.ifc.datum);
    return `
      <label class="flex items-center gap-2 px-3 py-1 hover:bg-ads-gray cursor-pointer ${dold ? 'text-ads-muted' : 'text-ads-text'}">
        <input type="checkbox" ${dold ? '' : 'checked'} onchange="isfVaxlaModell(${i})" class="accent-ads-blue" />
        <span class="shrink-0 w-3 h-3 rounded-full border border-ads-border" style="${ilmFargRuta(f.farg || null)}"></span>
        <span class="truncate flex-1" title="${vkEsc(f.ifc.sokvag ? `${f.ifc.sokvag} / ${f.ifc.namn}` : f.ifc.namn)}">${vkEsc(f.ifc.namn)}</span>
        <span class="shrink-0 text-[10px] ${gammal ? 'text-amber-800 bg-amber-100 rounded px-1' : 'text-ads-muted'}"
              title="När IFC-versionen i modellen laddades upp till ACC">${ilmDatum(f.ifc.datum) || ''}</span>
      </label>`;
  }).join('');
  return `
    <div class="absolute bottom-full left-6 mb-1 w-80 bg-white border border-ads-border rounded shadow-lg py-1 text-xs">
      <div class="px-3 pt-1 pb-1.5 flex items-center gap-2 text-[11px] text-ads-muted border-b border-ads-border/60">
        <span class="font-semibold uppercase tracking-wider">Modeller</span><span class="flex-1"></span>
        ${_isf.dolda.size ? '<button onclick="isfVisaAllaModeller()" class="text-ads-blue hover:underline">Visa alla</button>' : ''}
        <button onclick="isfVaxlaModellMeny(); ilmOppna()" class="text-ads-blue hover:underline" title="Färger och vilka IFC-filer som ingår">Ändra…</button>
      </div>
      <div class="max-h-64 overflow-y-auto py-1">${rader || '<div class="px-3 py-2 text-ads-muted">Inga modeller laddade.</div>'}</div>
    </div>`;
}

function isfVaxlaModell(i) {
  const f = ilmFiler(_isf.projektId).filter(x => _isf.laddade.has(x.ifc.itemId))[i];
  if (!f) return;
  if (_isf.dolda.has(f.ifc.itemId)) _isf.dolda.delete(f.ifc.itemId); else _isf.dolda.add(f.ifc.itemId);
  isfSparaDolda();
}

function isfVisaAllaModeller() {
  _isf.dolda.clear();
  isfSparaDolda();
}

async function isfSparaDolda() {
  isvSparaVal(`isf-dolda:${_isf.projektId}`, [..._isf.dolda]);
  isfRitaVerktyg();
  await isfFargaModeller(_isf.projektId);
  _isf.varld?.fm.core.update(true);
}

// Slår på eller av snittet. 'lada' gör sex plan runt modellen, 'plan' låter
// användaren dubbelklicka fram plan.
function isfSnitt(lage) {
  const v = _isf.varld;
  _isf.meny = false;
  if (!v) return;
  const clipper = v.components.get(v.OBC.Clipper);
  clipper.deleteAll();
  if (!v.snittStil) {
    // Ljusa, genomskinliga plan i stället för bibliotekets kraftiga lila.
    clipper.material = new v.THREE.MeshBasicMaterial({ color: ISF_VALD_FARG, transparent: true, opacity: 0.06, side: v.THREE.DoubleSide, depthWrite: false });
    v.snittStil = true;
  }
  _isf.snitt = lage;
  clipper.enabled = !!lage;
  clipper.visible = !!lage;
  if (lage === 'lada') isfSnittlada();
  v.fm.core.update(true);
  isfRitaVerktyg();
}

// Sex plan runt lådan (i del 4 ärendets låda, annars hela modellen). Planens
// normaler pekar inåt: det som ligger utanför lådan skärs bort.
function isfSnittlada(lada) {
  const v = _isf.varld;
  if (!v) return;
  const clipper = v.components.get(v.OBC.Clipper);
  clipper.deleteAll();
  const l = lada || isfModellernasLada().expandByScalar(0.05);
  if (l.isEmpty()) return;
  const V = v.THREE.Vector3;
  const sidor = [
    [new V(1, 0, 0),  new V(l.min.x, 0, 0)], [new V(-1, 0, 0), new V(l.max.x, 0, 0)],
    [new V(0, 1, 0),  new V(0, l.min.y, 0)], [new V(0, -1, 0), new V(0, l.max.y, 0)],
    [new V(0, 0, 1),  new V(0, 0, l.min.z)], [new V(0, 0, -1), new V(0, 0, l.max.z)],
  ];
  const mitt = l.getCenter(new V());
  for (const [n, p] of sidor) {
    const punkt = mitt.clone();
    if (n.x) punkt.x = p.x; if (n.y) punkt.y = p.y; if (n.z) punkt.z = p.z;
    // three.js skär bort planets negativa sida; normalen inåt behåller lådans insida.
    clipper.createFromNormalAndCoplanarPoint(v.world, n, punkt);
  }
  v.fm.core.update(true);
}

async function isfMat() {
  const v = _isf.varld;
  if (!v) return;
  try {
    const OBF = await isfFront();
    await isfEtiketter(v);
    const m = v.components.get(OBF.LengthMeasurement);
    if (!m.world) {
      m.world = v.world;
      m.color = new v.THREE.Color('#E8590C');
      m.units = 'mm';
      m.rounding = 0;
      m.snapDistance = 0.3;
    }
    _isf.mat = !_isf.mat;
    m.enabled = _isf.mat;
    if (_isf.mat) await isfMarkera(null);
  } catch (err) {
    console.warn('Modellvisaren: mätning', err);
    _isf.mat = false;
    isvSattStatus('Mätverktyget gick inte att starta.', true);
  }
  isfRitaVerktyg();
}

// Mätningarnas siffror är HTML-etiketter (CSS2D), som den vanliga renderaren
// inte ritar. Ett eget etikettlager läggs ovanpå modellen första gången.
async function isfEtiketter(v) {
  if (v.etiketter) return;
  const { CSS2DRenderer } = await import('three/examples/jsm/renderers/CSS2DRenderer.js');
  const r = new CSS2DRenderer();
  Object.assign(r.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
  v.behallare.appendChild(r.domElement);
  const storlek = () => r.setSize(v.behallare.clientWidth, v.behallare.clientHeight);
  storlek();
  v.world.renderer.onAfterUpdate.add(() => r.render(v.world.scene.three, v.world.camera.three));
  v.etiketter = { r, storlek };
}

async function isfRensaMatningar() {
  const v = _isf.varld;
  if (!v || !_isf.front) return;
  const OBF = await isfFront();
  v.components.get(OBF.LengthMeasurement).list.clear();
}

// Stänger mätning och snitt (vid projektbyte och när panelen stängs).
function isfStangVerktyg() {
  const v = _isf.varld;
  _isf.meny = false;
  if (v && _isf.snitt) {
    const clipper = v.components.get(v.OBC.Clipper);
    clipper.deleteAll();
    clipper.enabled = false;
  }
  _isf.snitt = null;
  if (v && _isf.mat && _isf.front) {
    _isf.front.then(OBF => { const m = v.components.get(OBF.LengthMeasurement); m.list.clear(); m.enabled = false; }).catch(() => {});
  }
  _isf.mat = false;
}

// ── Egenskaper ────────────────────────────────────────────────────────────────

function isfVaxlaEgenskaper() {
  _isf.egenskaper = !_isf.egenskaper;
  isvSparaVal('isf-egenskaper', _isf.egenskaper);
  isfRitaVerktyg();
  isfRitaEgenskaper();
}

// IFC-värdet i en egenskap eller kvantitet.
function isfVarde(p) {
  for (const k of ['NominalValue', 'LengthValue', 'AreaValue', 'VolumeValue', 'CountValue', 'WeightValue', 'TimeValue', 'Value']) {
    const v = p?.[k]?.value;
    if (v !== undefined && v !== null && v !== '') return typeof v === 'number' ? String(Math.round(v * 1000) / 1000).replace('.', ',') : String(v);
  }
  return '';
}

// Elementets egna attribut och dess egenskaps- och kvantitetsuppsättningar.
async function isfLasEgenskaper(m, localId) {
  const [data] = await m.getItemsData([localId], {
    attributesDefault: true,
    relations: { IsDefinedBy: { attributes: true, relations: true }, IsTypedBy: { attributes: true, relations: false },
                 ContainedInStructure: { attributes: true, relations: false }, DefinesOccurrence: { attributes: false, relations: false } },
  });
  const grupper = [];
  const egna = [];
  for (const [namn, v] of Object.entries(data || {})) {
    if (Array.isArray(v) || v?.value === undefined || v.value === null || v.value === '') continue;
    const visat = { _category: 'IFC-klass', _guid: 'GlobalId', _localId: 'Id i modellen' }[namn] || namn;
    egna.push([visat, String(v.value)]);
  }
  egna.sort((a, b) => (a[0] === 'Name' ? -1 : b[0] === 'Name' ? 1 : 0));
  grupper.push(['Element', egna]);
  const typ = data?.IsTypedBy?.[0];
  if (typ?.Name?.value) grupper.push(['Typ', [['Name', String(typ.Name.value)], ...(typ._category?.value ? [['IFC-klass', String(typ._category.value)]] : [])]]);
  const vaning = data?.ContainedInStructure?.[0];
  if (vaning?.Name?.value) grupper.push(['Placering', [['Våning / del', String(vaning.Name.value)]]]);
  for (const ps of data?.IsDefinedBy || []) {
    const rader = (ps.HasProperties || ps.Quantities || []).map(p => [String(p?.Name?.value ?? ''), isfVarde(p)]).filter(r => r[0]);
    if (rader.length) grupper.push([String(ps.Name?.value || 'Egenskaper'), rader]);
  }
  return { namn: egna.find(r => r[0] === 'Name')?.[1] || '', klass: egna.find(r => r[0] === 'IFC-klass')?.[1] || '', grupper };
}

async function isfRitaEgenskaper() {
  const panel = document.getElementById('isf-egenskaper');
  if (!panel) return;
  const visa = _isf.egenskaper && isfHarModell();
  panel.classList.toggle('hidden', !visa);
  if (!visa) return;
  const huvud = (rubrik, under = '') => `
    <div class="shrink-0 flex items-start gap-2 px-3 py-2 border-b border-ads-border">
      <div class="min-w-0"><div class="font-semibold text-ads-text truncate">${rubrik}</div>${under ? `<div class="text-[11px] text-ads-muted truncate">${under}</div>` : ''}</div>
      <button onclick="isfVaxlaEgenskaper()" class="ml-auto text-ads-muted hover:text-ads-text" title="Stäng">✕</button>
    </div>`;
  const vald = _isf.vald;
  if (!vald) { panel.innerHTML = huvud('Egenskaper') + '<p class="p-3 text-ads-muted">Klicka på ett element i modellen.</p>'; return; }
  const nyckel = `${vald.modelId}|${vald.localId}`;
  panel.dataset.nyckel = nyckel;
  panel.innerHTML = huvud('Egenskaper') + '<p class="p-3 text-ads-muted">Läser…</p>';
  const m = _isf.varld.fm.list.get(vald.modelId);
  let e;
  try { e = await isfLasEgenskaper(m, vald.localId); } catch (err) { e = { fel: String(err.message || err) }; }
  if (panel.dataset.nyckel !== nyckel || _isf.vald !== vald) return;
  if (e.fel) { panel.innerHTML = huvud('Egenskaper') + `<p class="p-3 text-red-700">Kunde inte läsa egenskaperna: ${vkEsc(e.fel.slice(0, 160))}</p>`; return; }
  const fil = _isf.laddade.get(vald.modelId)?.namn || '';
  panel.innerHTML = huvud(vkEsc(e.namn || e.klass || 'Element'), vkEsc([e.klass, fil].filter(Boolean).join(' · '))) + `
    <div class="flex-1 min-h-0 overflow-y-auto">
      ${e.grupper.map(([grupp, rader]) => `
        <details open class="border-b border-ads-border/60">
          <summary class="px-3 py-1.5 cursor-pointer font-semibold text-ads-text bg-ads-gray/60">${vkEsc(grupp)}</summary>
          <table class="w-full table-fixed"><tbody>
            ${rader.map(([n, v]) => `<tr class="border-t border-ads-border/40 align-top">
              <td class="px-3 py-1 text-ads-muted w-2/5 break-words">${vkEsc(n)}</td>
              <td class="px-3 py-1 break-all">${v ? vkEsc(v) : '<span class="text-ads-muted">–</span>'}</td></tr>`).join('')}
          </tbody></table>
        </details>`).join('')}
    </div>`;
}

// ── Stänga ────────────────────────────────────────────────────────────────────

function isfStang() {
  const v = _isf.varld;
  _isf.varld = null;
  _isf.startar = null;
  _isf.projektId = null;
  _isf.fel = null;
  _isf.laddade.clear();
  _isf.vantar = false;
  _isf.behall.clear();
  _isf.modellMeny = false;
  _isf.laddaIgen = false;
  _isf.laddning = null;
  _isf.laddFel = [];
  _isf.snitt = null;
  _isf.mat = false;
  _isf.meny = false;
  _isf.vald = null;
  _isf.platser.clear();
  _isf.lage.clear();
  _isf.lador.clear();
  _isf.markor = null;
  _isf.tonade = false;
  if (!v) return;
  v.observer.disconnect();
  try { v.components.dispose(); } catch (err) { console.warn('Modellvisaren: stängning', err); }
}

// ── Modellerna sparas i webbläsaren (IndexedDB) ───────────────────────────────
// Nyckeln är Fragments-filens versions-id i ACC, så en ny version hämtas alltid.
// Högst ISF_CACHE_MAX byte; de som använts minst nyligen tas bort först. Det är
// projektets geometri på den egna datorn, som ACC:s egen synkning.

const ISF_CACHE_DB  = 'forma-lattmodell';
const ISF_CACHE_MAX = 1.5 * 1024 * 1024 * 1024;

function isfCacheDb() {
  if (!_isf.db) {
    _isf.db = new Promise((klar, fel) => {
      const r = indexedDB.open(ISF_CACHE_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('frag', { keyPath: 'nyckel' });
      r.onsuccess = () => klar(r.result);
      r.onerror = () => fel(r.error);
    });
    _isf.db.catch(() => { _isf.db = null; });
  }
  return _isf.db;
}

function isfCacheTx(lage, gor) {
  return isfCacheDb().then(db => new Promise((klar, fel) => {
    const tx = db.transaction('frag', lage);
    const ut = gor(tx.objectStore('frag'));
    tx.oncomplete = () => klar(ut?.result ?? ut);
    tx.onerror = () => fel(tx.error);
    tx.onabort = () => fel(tx.error);
  }));
}

async function isfCacheHamta(nyckel) {
  const post = await isfCacheTx('readonly', s => s.get(nyckel));
  if (!post) return null;
  isfCacheTx('readwrite', s => s.put({ ...post, anvand: Date.now() })).catch(() => {});
  return new Uint8Array(post.bytes);
}

async function isfCacheSpara(nyckel, bytes) {
  const alla = await isfCacheTx('readonly', s => s.getAll());
  let summa = bytes.byteLength + alla.reduce((s, p) => s + (p.nyckel === nyckel ? 0 : p.storlek || 0), 0);
  const bort = [];
  for (const p of alla.filter(p => p.nyckel !== nyckel).sort((a, b) => (a.anvand || 0) - (b.anvand || 0))) {
    if (summa <= ISF_CACHE_MAX) break;
    bort.push(p.nyckel);
    summa -= p.storlek || 0;
  }
  const kopia = bytes.slice().buffer;
  await isfCacheTx('readwrite', s => {
    for (const k of bort) s.delete(k);
    s.put({ nyckel, bytes: kopia, storlek: kopia.byteLength, anvand: Date.now() });
  });
}
