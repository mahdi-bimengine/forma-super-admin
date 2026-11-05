// issues-visare.js — modellvy under ärendelistan (docs/PLAN-ARENDEVY.md, del 2).
//
// Med "Modellvy" på delas fliken: ärendena överst, en lätt APS-visare under.
// Klick på en rad hämtar ärendet och hoppar till platsen där det skapades i
// Model Coordination. Ärendets viewerState innehåller alla modeller som var
// öppna (objectSet[].seedUrn, versions-URN i base64), kameran och elementet.
//
// Modellerna laddas i sina egna interna koordinater (applyRefPoint: false,
// globalOffset 0), annars pekar den sparade kameran ut i tomma luften. Kameran
// sätts först när geometrin är laddad, annars skriver visaren över den.
//
// Fliken ritas om helt vid varje ändring, så visaren ligger i en egen ruta
// (_isv.ruta) som flyttas tillbaka in i platshållaren efter varje omritning.
// Modeller som redan är laddade behålls när nästa ärende har samma modeller.

const _isv = {
  pa:        false,
  ruta:      null,        // den bestående rutan med visaren
  viewer:    null,
  modeller:  new Map(),   // seedUrn → laddad modell
  aktiv:     null,        // { id, nr, rubrik, projekt }
  lank:      null,        // ärendets linkedDocument med viewerState
  status:    '',
  fel:       false,
  arenden:   new Map(),   // ärende-id → linkedDocument eller null (inte placerat)
  onskat:    null,        // senast klickade ärende, väntar på att laddas
  arbetar:   false,
  // Val som sparas per webbläsare.
  snitt:     isvLasVal('isv-snitt', true),   // snittlåda runt ärendet
  tona:      isvLasVal('isv-tona', true),    // tona ner allt utom elementen vid nålen
  hojd:      isvLasVal('isv-hojd', 48),      // modellrutans höjd i procent
};

const ISV_YTOR = ['alla', 'clash'];

// Del 3: fokus på platsen. Mått i meter, räknas om till modellens enheter.
const ISV_NARA_M     = 0.3;  // element inom så här långt från nålen hör till clashen
const ISV_MARGINAL_M = 3;    // snittlådan sträcker sig så här långt runt nålen
const ISV_ELEMENT_M  = 8;    // och tar med det klickade elementet upp till så här långt bort

function isvLasVal(nyckel, standard) {
  try { const v = JSON.parse(localStorage.getItem(nyckel)); return v ?? standard; } catch { return standard; }
}

function isvSparaVal(nyckel, varde) {
  try { localStorage.setItem(nyckel, JSON.stringify(varde)); } catch { /* inte kritiskt */ }
}

function isvVisas() {
  return _isv.pa && ISV_YTOR.includes(_is.yta) && !!_is.hamtad && !_is.valjProjekt;
}

function isvKnappHtml() {
  if (!ISV_YTOR.includes(_is.yta)) return '';
  return `<button onclick="isvVaxla()" title="Visa modellen under listan. Klicka på ett ärende för att gå till platsen."
                  class="text-xs border rounded px-2.5 py-1.5 transition-colors ${_isv.pa
                    ? 'bg-be-charcoal text-white border-be-charcoal' : 'bg-white text-ads-text border-ads-border hover:border-ads-blue'}">Modellvy</button>`;
}

function isvVaxla() {
  _isv.pa = !_isv.pa;
  if (!_isv.pa) isvStang();
  isRita();
}

// Platshållaren i fliken. Själva rutan sätts in av isvFastsatt.
function isvPlatsHtml() {
  if (!isvVisas()) return '';
  return `
    <div id="isv-plats" class="relative shrink-0 border-t-2 border-ads-border bg-white" style="height: ${_isv.hojd}%">
      <div onmousedown="isvDra(event)" title="Dra för att ändra storlek"
           class="absolute left-0 right-0 z-10 cursor-row-resize" style="top: -6px; height: 10px"></div>
    </div>`;
}

// Dra i kanten ovanför modellen för att dela om utrymmet med listan.
function isvDra(e) {
  e.preventDefault();
  const plats = document.getElementById('isv-plats');
  const kolumn = plats?.parentElement;
  if (!kolumn) return;
  const flytta = ev => {
    const px = plats.getBoundingClientRect().bottom - ev.clientY;
    _isv.hojd = Math.round(Math.min(85, Math.max(20, px / kolumn.getBoundingClientRect().height * 100)));
    plats.style.height = `${_isv.hojd}%`;
    _isv.viewer?.resize();
  };
  const slapp = () => {
    window.removeEventListener('mousemove', flytta);
    window.removeEventListener('mouseup', slapp);
    isvSparaVal('isv-hojd', _isv.hojd);
  };
  window.addEventListener('mousemove', flytta);
  window.addEventListener('mouseup', slapp);
}

// Anropas sist i isRita.
function isvFastsatt() {
  const plats = document.getElementById('isv-plats');
  if (!plats) return;
  if (!_isv.ruta) _isv.ruta = isvSkapaRuta();
  plats.appendChild(_isv.ruta);
  isvRitaRad();
  _isv.viewer?.resize();
}

function isvSkapaRuta() {
  const ruta = document.createElement('div');
  ruta.className = 'h-full flex flex-col';
  ruta.innerHTML = `
    <div id="isv-rad" class="shrink-0 px-4 py-1.5 border-b border-ads-border flex items-center gap-3 text-xs"></div>
    <div class="relative flex-1 min-h-0">
      <div id="isv-visare" class="absolute inset-0"></div>
      <div id="isv-meddelande" class="absolute inset-0 flex items-center justify-center pointer-events-none"></div>
    </div>`;
  return ruta;
}

// Raden ovanför visaren: vilket ärende, läge och knappar.
function isvRitaRad() {
  const rad = document.getElementById('isv-rad');
  if (!rad) return;
  const a = _isv.aktiv;
  rad.innerHTML = `
    <span class="font-semibold text-ads-text">${a ? `#${a.nr}` : 'Modellvy'}</span>
    <span class="text-ads-muted truncate">${a ? vkEsc(`${a.rubrik} · ${a.projekt}`) : 'Klicka på ett ärende i listan.'}</span>
    <span class="${_isv.fel ? 'text-red-700' : 'text-ads-muted'}">${vkEsc(_isv.status)}</span>
    <div class="flex-1"></div>
    ${_isv.lank && _isv.viewer && _isv.modeller.size && !_isv.fel ? `
      <label class="flex items-center gap-1 cursor-pointer text-ads-muted" title="Skär bort allt utom några meter runt ärendet">
        <input type="checkbox" ${_isv.snitt ? 'checked' : ''} onchange="isvVaxlaVal('snitt')" class="accent-ads-blue" /> Snittlåda</label>
      <label class="flex items-center gap-1 cursor-pointer text-ads-muted" title="Visa elementen vid nålen tydligt och resten genomskinligt">
        <input type="checkbox" ${_isv.tona ? 'checked' : ''} onchange="isvVaxlaVal('tona')" class="accent-ads-blue" /> Tona ner omgivningen</label>
      <span class="text-ads-border">|</span>
      <button onclick="isvArendetsVy()" class="hover:text-ads-blue">Ärendets vy</button>
      <button onclick="isvHelaModellen()" class="hover:text-ads-blue">Hela modellen</button>` : ''}
    <button onclick="isvVaxla()" class="text-ads-muted hover:text-ads-text" title="Stäng modellvyn">✕</button>`;
  const medd = document.getElementById('isv-meddelande');
  if (medd) {
    // Täcker också förra ärendets modell när det valda ärendet saknar placering.
    const visa = !_isv.viewer || !_isv.modeller.size || (!!a && !_isv.lank) || _isv.fel;
    medd.style.background = visa && _isv.modeller.size ? 'rgba(255, 255, 255, 0.92)' : '';
    medd.innerHTML = visa ? `<p class="text-sm text-ads-muted text-center max-w-md px-6">${
      vkEsc(_isv.status || 'Klicka på ett ärende som är placerat i Model Coordination.')}</p>` : '';
  }
  // Markera raden för det aktiva ärendet.
  document.querySelectorAll('tr[data-isv]').forEach(tr => {
    const aktiv = !!a && tr.dataset.isv === a.id;
    tr.style.boxShadow  = aktiv ? 'inset 3px 0 0 #0696D7' : '';
    tr.style.background = aktiv ? 'rgba(6, 150, 215, 0.08)' : '';
  });
}

function isvSattStatus(text, fel = false) {
  _isv.status = text;
  _isv.fel = fel;
  isvRitaRad();
}

// Klasser och attribut som raderna får när modellvyn är på.
function isvRadAttr(a) {
  if (!isvVisas()) return '';
  return `data-isv="${vkEsc(a.id)}" onclick="isvRadKlick(event, ${isRef(a)})" style="cursor: pointer"`;
}

function isvRadKlick(e, ref) {
  // Klick på knappar, rutor och fält i raden ska göra det de alltid gjort.
  if (e.target.closest('input, button, select, textarea, a, label')) return;
  isvVisa(_is.ref[ref]);
}

function isvVisa(a) {
  if (!a) return;
  _isv.aktiv  = { id: a.id, nr: a.nr, rubrik: a.rubrik, projekt: a.projekt, accId: a.accId };
  _isv.onskat = _isv.aktiv;
  if (_isv.arenden.has(a.id)) _isv.lank = _isv.arenden.get(a.id);
  isvRitaRad();
  if (!_isv.arbetar) isvArbeta();
}

// Tar alltid det senast klickade ärendet, så snabba klick inte laddar i otakt.
async function isvArbeta() {
  _isv.arbetar = true;
  try {
    while (_isv.onskat) {
      const a = _isv.onskat;
      _isv.onskat = null;
      try {
        await isvGaTill(a);
      } catch (err) {
        if (!_isv.onskat) isvSattStatus(String(err.message || err), true);
      }
    }
  } finally {
    _isv.arbetar = false;
  }
}

async function isvGaTill(a) {
  let lank = _isv.arenden.get(a.id);
  if (lank === undefined) {
    isvSattStatus('Hämtar ärendet…');
    const ra = await bhMedOmforsok(() => apsGet(`/construction/issues/v1/projects/${a.accId}/issues/${a.id}`));
    lank = (ra.linkedDocuments || []).find(d => d.details?.viewerState?.objectSet?.length) || null;
    _isv.arenden.set(a.id, lank);
  }
  if (_isv.onskat) return;
  _isv.lank = lank;
  if (!lank) {
    isvSattStatus('Ärendet är inte placerat i någon modell.');
    return;
  }

  const vs = lank.details.viewerState;
  const antal = vs.objectSet.length;
  isvSattStatus(`Laddar ${antal === 1 ? 'modellen' : `${antal} modeller`}…`);
  const t0 = performance.now();
  await isvLaddaModeller(vs.objectSet, lank.details.viewable?.guid);
  if (_isv.onskat) return;

  isvArendetsVy();
  const sek = (performance.now() - t0) / 1000;
  isvSattStatus(sek > 0.3 ? `Klar på ${sek.toFixed(1).replace('.', ',')} s` : '');
}

async function isvLaddaModeller(objectSet, guid) {
  await vkStartaVisare();
  if (!_isv.viewer) {
    const behallare = document.getElementById('isv-visare');
    if (!behallare) throw new Error('Modellvyn är stängd.');
    _isv.viewer = new Autodesk.Viewing.Viewer3D(behallare);
    _isv.viewer.start();
  }
  const v = _isv.viewer;
  const behov = objectSet.map(o => o.seedUrn);

  for (const [urn, m] of _isv.modeller) {
    if (!behov.includes(urn)) { v.unloadModel(m); _isv.modeller.delete(urn); }
  }
  for (const urn of behov) {
    if (_isv.modeller.has(urn)) continue;
    const doc  = await isvLaddaDokument(urn);
    const nod  = (guid && doc.getRoot().search({ guid })[0]) || doc.getRoot().getDefaultGeometry();
    if (!nod) throw new Error('Modellen har ingen 3D-vy.');
    if (_isv.viewer !== v) throw new Error('Modellvyn stängdes.');
    const m = await v.loadDocumentNode(doc, nod, { keepCurrentModels: true, globalOffset: { x: 0, y: 0, z: 0 }, applyRefPoint: false });
    if (_isv.viewer !== v) throw new Error('Modellvyn stängdes.');
    _isv.modeller.set(urn, m);
  }
  await Promise.all([..._isv.modeller.values()].map(isvVantaPaGeometri));
}

function isvLaddaDokument(seedUrn) {
  return new Promise((klar, fel) => Autodesk.Viewing.Document.load('urn:' + seedUrn, klar, kod => fel(new Error(
    kod === 4 ? 'Modellen är inte översatt i ACC.' : kod === 3 || kod === 5 ? 'Du har inte behörighet till modellen.' : `Visaren nekade modellen (kod ${kod}).`))));
}

function isvVantaPaGeometri(m) {
  if (m.isLoadDone()) return Promise.resolve();
  return new Promise(klar => {
    const lyssna = e => { if (e.model === m) { _isv.viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, lyssna); klar(); } };
    _isv.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, lyssna);
    setTimeout(klar, 60000);
  });
}

// Modellen som nålen sitter i: seedUrn avkodad innehåller lineage-id:t.
function isvNalModell(lank) {
  const lineage = String(lank.urn || '').split(':').pop();
  for (const [urn, m] of _isv.modeller) {
    try { if (atob(urn.replace(/-/g, '+').replace(/_/g, '/')).includes(lineage)) return m; } catch { /* nästa */ }
  }
  return null;
}

function isvArendetsVy() {
  const v = _isv.viewer, lank = _isv.lank;
  if (!v || !lank) return;
  v.showAll();
  v.setCutPlanes([]);
  v.restoreState(lank.details.viewerState, null, true);
  const m = isvNalModell(lank);
  if (m && lank.details.objectId != null) v.select([lank.details.objectId], m);
  try { isvFokus(v, lank, m); } catch (err) { console.warn('Modellvy: kunde inte fokusera', err); }
}

// Snittlåda runt nålen och nedtoning av allt utom elementen vid nålen. Ärenden
// som redan har ett eget snitt eller egna dolda/isolerade element i ACC visas
// som de sparades, utan att det här skrivs över.
function isvFokus(v, lank, nalModell) {
  const vs  = lank.details.viewerState;
  const pos = lank.details.position;
  if (!pos) return;
  const p = new THREE.Vector3(pos.x, pos.y, pos.z);
  const enhet = 1 / ((nalModell || v.model).getUnitScale?.() || 1);   // modellenheter per meter

  // Elementen nära nålen, i alla modeller. Det är i praktiken de som krockar.
  const nara = new THREE.Box3(p.clone(), p.clone()).expandByScalar(ISV_NARA_M * enhet);
  const traffar = [];
  for (const m of _isv.modeller.values()) {
    const ids = isvElementIRuta(m, nara);
    if (m === nalModell && lank.details.objectId != null && !ids.includes(lank.details.objectId)) ids.push(lank.details.objectId);
    if (ids.length) traffar.push({ m, ids });
  }

  if (_isv.snitt && !vs.cutplanes?.length) {
    const lada = new THREE.Box3(p.clone(), p.clone()).expandByScalar(ISV_MARGINAL_M * enhet);
    if (nalModell && lank.details.objectId != null) {
      const tak = new THREE.Box3(p.clone(), p.clone()).expandByScalar(ISV_ELEMENT_M * enhet);
      const el = isvElementGranser(nalModell, lank.details.objectId);
      if (!el.isEmpty()) lada.union(el.intersect(tak));
    }
    v.setCutPlanes(isvLadansPlan(lada));
    // Ärendets kamera står ofta långt bort. Gå närmare, men behåll riktningen.
    v.navigation.fitBounds(true, lada);
  }

  const egnaVal = vs.objectSet.some(o => o.isolated?.length || o.hidden?.length);
  if (_isv.tona && !egnaVal && traffar.length) {
    v.setGhosting(true);
    for (const t of traffar) v.isolate(t.ids, t.m);
  }
}

// dbId för alla delar vars utbredning går in i rutan.
function isvElementIRuta(m, ruta) {
  const fl = m.getFragmentList?.();
  if (!fl) return [];
  const b = new THREE.Box3();
  const ids = new Set();
  const antal = fl.getCount();
  for (let f = 0; f < antal; f++) {
    fl.getWorldBounds(f, b);
    if (!b.intersectsBox(ruta)) continue;
    const d = fl.fragments?.fragId2dbId?.[f] ?? fl.getDbIds?.(f);
    for (const id of [].concat(d)) if (id != null && id >= 0) ids.add(id);
  }
  return [...ids];
}

function isvElementGranser(m, dbId) {
  const ut = new THREE.Box3();
  const trad = m.getInstanceTree?.();
  const fl = m.getFragmentList?.();
  if (!trad || !fl) return ut;
  const b = new THREE.Box3();
  trad.enumNodeFragments(dbId, f => { fl.getWorldBounds(f, b); ut.union(b); }, true);
  return ut;
}

// Sex snittplan som tillsammans bildar en låda. Visaren skär bort det som
// ligger på planets positiva sida (n·p + d > 0).
function isvLadansPlan(l) {
  return [
    new THREE.Vector4(-1, 0, 0, l.min.x), new THREE.Vector4(1, 0, 0, -l.max.x),
    new THREE.Vector4(0, -1, 0, l.min.y), new THREE.Vector4(0, 1, 0, -l.max.y),
    new THREE.Vector4(0, 0, -1, l.min.z), new THREE.Vector4(0, 0, 1, -l.max.z),
  ];
}

function isvVaxlaVal(namn) {
  _isv[namn] = !_isv[namn];
  isvSparaVal(`isv-${namn}`, _isv[namn]);
  isvRitaRad();
  isvArendetsVy();
}

// Hela modellen utan snitt och nedtoning. "Ärendets vy" tar tillbaka dem.
function isvHelaModellen() {
  const v = _isv.viewer;
  if (!v) return;
  v.setCutPlanes([]);
  v.showAll();
  v.fitToView();
}

function isvStang() {
  try { _isv.viewer?.finish(); } catch { /* redan borta */ }
  _isv.viewer = null;
  _isv.ruta = null;
  _isv.modeller.clear();
  _isv.aktiv = null;
  _isv.lank = null;
  _isv.onskat = null;
  _isv.status = '';
  _isv.fel = false;
}
