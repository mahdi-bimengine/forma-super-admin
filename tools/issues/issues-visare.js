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
};

const ISV_YTOR = ['alla', 'clash'];

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
  return `<div id="isv-plats" class="shrink-0 border-t-2 border-ads-border bg-white" style="height: 48%"></div>`;
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
  v.restoreState(lank.details.viewerState, null, true);
  const m = isvNalModell(lank);
  if (m && lank.details.objectId != null) v.select([lank.details.objectId], m);
}

function isvHelaModellen() {
  _isv.viewer?.fitToView();
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
