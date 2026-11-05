// issues-visare.js — modellvy under ärendelistan (docs/PLAN-ARENDEVY.md, del 2).
//
// Med "Modellvy" på delas fliken: ärendena överst, en lätt APS-visare under.
// Klick på en rad hämtar ärendet och hoppar till platsen där det skapades i
// Model Coordination. Ärendets viewerState har kameran, nålen och elementet.
//
// Bara modellerna i blockets vy laddas (se isvKontext), aldrig allt som var
// öppet när ärendet skapades: i ett riktigt projekt är det hela model setet,
// och det tog över 5 GB minne (2026-11-05).
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
  modeller:  new Map(),   // versions-URN|vy-guid → { m: laddad modell, lineage }
  mc:        new Map(),   // projekt-id → löfte om model set med senaste filer och vyer
  kontext:   null,        // aktuellt ärendes model set, vyer och valda vy, se isvKontext
  storVy:    null,        // { namn, antal } när en vy väntar på bekräftelse
  tillatStor: null,       // vy-id som användaren bekräftat trots många modeller
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
    ${a && _isv.lank ? isvVyValHtml() : ''}
    ${_isv.lank && _isv.viewer && _isv.modeller.size && !_isv.fel ? `
      <label class="flex items-center gap-1 cursor-pointer text-ads-muted" title="Skär bort allt utom några meter runt ärendet">
        <input type="checkbox" ${_isv.snitt ? 'checked' : ''} onchange="isvVaxlaVal('snitt')" class="accent-ads-blue" /> Snittlåda</label>
      <label class="flex items-center gap-1 cursor-pointer text-ads-muted" title="Visa elementen vid nålen tydligt och resten genomskinligt">
        <input type="checkbox" ${_isv.tona ? 'checked' : ''} onchange="isvVaxlaVal('tona')" class="accent-ads-blue" /> Tona ner omgivningen</label>
      <span class="text-ads-border">|</span>
      <button onclick="isvArendetsVy()" class="hover:text-ads-blue" title="Gå tillbaka till ärendets plats">Ärendets vy</button>` : ''}
    <button onclick="isvVaxla()" class="text-ads-muted hover:text-ads-text" title="Stäng modellvyn">✕</button>`;
  const medd = document.getElementById('isv-meddelande');
  if (medd) {
    // Täcker också förra ärendets modell när det valda ärendet saknar placering.
    const visa = !_isv.viewer || !_isv.modeller.size || (!!a && !_isv.lank) || _isv.fel || !!_isv.storVy;
    medd.style.background = visa && _isv.modeller.size ? 'rgba(255, 255, 255, 0.92)' : '';
    medd.innerHTML = !visa ? '' : _isv.storVy ? `
      <div class="text-sm text-ads-muted text-center max-w-md px-6 pointer-events-auto">
        <p>Vyn "${vkEsc(_isv.storVy.namn)}" har ${_isv.storVy.antal} modeller. Det kan ta lång tid och mycket minne.</p>
        <p class="mt-2">Välj en mindre vy i listan ovanför, eller
          <button onclick="isvLaddaStorVy()" class="text-ads-blue hover:underline">ladda ändå</button>.</p>
      </div>`
      : `<p class="text-sm text-ads-muted text-center max-w-md px-6">${
        vkEsc(_isv.status || 'Klicka på ett ärende som är placerat i Model Coordination.')}</p>`;
  }
  // Markera raden för det aktiva ärendet.
  document.querySelectorAll('tr[data-isv]').forEach(tr => {
    const aktiv = !!a && tr.dataset.isv === a.id;
    tr.style.boxShadow  = aktiv ? 'inset 3px 0 0 #0696D7' : '';
    tr.style.background = aktiv ? 'rgba(6, 150, 215, 0.08)' : '';
  });
}

// Rullistan med model setets vyer. Visas alltid, så att valet går att ändra.
function isvVyValHtml() {
  const k = _isv.kontext;
  if (!k) return '';
  if (!k.ms) {
    const text = k.fel || 'Modellen ingår inte i något model set. Visar bara modellen med nålen.';
    return `<span class="text-ads-muted" title="${vkEsc(text)}">Bara nålens modell</span>`;
  }
  const a = _isv.aktiv;
  const tips = k.hur === 'plats'   ? `Vald efter platsen (${(a?.platsVag || []).join(' › ')})`
             : k.hur === 'gissad'  ? `Gissad efter platsen (${(a?.platsVag || []).join(' › ')}). Ändra om den är fel.`
             : k.hur === 'sparad'  ? 'Ditt eget val för det här blocket. Sparas i den här webbläsaren.'
             : a?.platsVag?.length ? `Ingen vy matchar platsen (${a.platsVag.join(' › ')}). Välj en vy.`
             : 'Ärendet har ingen plats i ACC. Välj en vy.';
  const markera = k.hur === 'gissad' || k.hur === 'ingen';
  return `
    <label class="flex items-center gap-1 text-ads-muted" title="${vkEsc(tips)}">Vy
      <select onchange="isvValjVy(this.value)"
              class="text-xs border rounded px-1.5 py-0.5 max-w-[14rem] ${markera ? 'border-amber-400 bg-amber-50' : 'border-ads-border bg-white'}">
        <option value="" ${!k.vyId ? 'selected' : ''}>Bara nålens modell</option>
        ${k.vyer.map(v => `<option value="${vkEsc(v.id)}" ${v.id === k.vyId ? 'selected' : ''}>${vkEsc(v.namn)}${v.privat ? ' (privat)' : ''}</option>`).join('')}
      </select></label>`;
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
  _isv.aktiv  = { id: a.id, nr: a.nr, rubrik: a.rubrik, projekt: a.projekt, accId: a.accId,
                  projektId: a.projektId, platsVag: a.platsVag || [] };
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

// ── Vilken vy och vilka modeller ──────────────────────────────────────────────
// Ärendet öppnas med modellerna i den Model Coordination-vy som hör till dess
// block, i model setets senaste version. Blocket läses ur ärendets plats i ACC
// och matchas mot vynamnen. Valet kan alltid ändras i rullistan, och ändringen
// sparas per projekt, model set och block i den här webbläsaren.

const ISV_MAX_MODELLER = 8;   // fler modeller än så i en vy laddas bara efter bekräftelse

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
    _isv.kontext = null;
    isvSattStatus('Ärendet är inte placerat i någon modell.');
    return;
  }

  isvSattStatus('Letar upp vyn…');
  _isv.kontext = await isvKontext(a, lank);
  if (_isv.onskat) return;
  await isvLaddaKontext();
}

// Model set, vyer och vald vy för ärendet. Inget laddas ner här.
async function isvKontext(a, lank) {
  const lineage = isvLineage(lank.urn);
  let info = null, fel = '';
  try {
    info = await isvMcInfo(a.projektId);
  } catch (err) {
    fel = `Kunde inte läsa Model Coordination: ${String(err.message || err).slice(0, 120)}`;
  }
  const ms = info?.find(s => s.dok.some(d => isvLineage(d.documentLineage?.lineageUrn) === lineage)) || null;
  const k = { projektId: a.projektId, ms, vyer: ms?.vyer || [], block: null, vyId: null, hur: 'ingen', fel };
  if (!ms) return k;

  const match = isvMatchaVy(a.platsVag, ms.vyer);
  k.block = match.block;
  const sparad = isvLasVal(isvValNyckel(k), undefined);
  if (sparad !== undefined && (sparad === '' || ms.vyer.some(v => v.id === sparad))) {
    k.vyId = sparad; k.hur = 'sparad';
  } else if (match.vyId) {
    k.vyId = match.vyId; k.hur = match.saker ? 'plats' : 'gissad';
  }
  return k;
}

// Model sets med senaste versionens filer och vyerna, en gång per projekt.
function isvMcInfo(projektId) {
  if (!_isv.mc.has(projektId)) {
    const p = (async () => {
      const set = await isMcLas('Läsa model set', () => listModelSets(projektId));
      return Promise.all(set.map(async ms => {
        const versioner = await isMcLas(`Läsa versioner i "${ms.name}"`, () => getModelSetVersions(projektId, ms.id));
        const senaste = versioner[0];
        const [detalj, vyer] = await Promise.all([
          senaste ? isMcLas(`Läsa version ${senaste.version} i "${ms.name}"`, () => getModelSetVersion(projektId, ms.id, senaste.version)) : null,
          isMcLas(`Läsa vyer i "${ms.name}"`, () => listModelSetViews(projektId, ms.id)),
        ]);
        return {
          id: ms.id, namn: ms.name, version: senaste?.version ?? null,
          dok: (detalj?.documentVersions || []).filter(d => d.versionUrn),
          vyer: vyer.map(v => ({ id: v.viewId || v.id, namn: v.name || 'Namnlös vy', privat: !!v.isPrivate, definition: v.definition || [] }))
                    .sort((x, y) => x.namn.localeCompare(y.namn, 'sv')),
        };
      }));
    })();
    p.catch(() => _isv.mc.delete(projektId));   // försök igen nästa gång om det gick fel
    _isv.mc.set(projektId, p);
  }
  return _isv.mc.get(projektId);
}

function isvLineage(urn) {
  return String(urn || '').split('#')[0].split('?')[0];
}

function isvValNyckel(k) {
  return `isv-vy:${k.projektId}:${k.ms?.id}:${k.block ?? '(utan plats)'}`;
}

// Ord i ett namn, i gemener. "Block"/"Blk" räknas inte, så "Block C",
// "BLOCK-C" och "BlockC" blir alla ["c"].
function isvOrd(text) {
  return String(text || '').toLowerCase().split(/[^0-9a-zåäö]+/i)
    .map(o => o.replace(/^(block|blk)(?=.)/, ''))
    .filter(o => o && o !== 'block' && o !== 'blk');
}

// Platsens nivåer prövas inifrån och ut. En vy vars namn är exakt blocket är
// säker; en vy som bara innehåller blockets ord är en gissning, och flera
// lika bra gissningar ger ingen vald vy alls.
function isvMatchaVy(platsVag, vyer) {
  for (const niva of [...(platsVag || [])].reverse()) {
    const ord = isvOrd(niva);
    if (!ord.length) continue;
    const exakta = [], innehaller = [];
    for (const v of vyer) {
      const vo = isvOrd(v.namn);
      if (vo.join(' ') === ord.join(' ')) exakta.push(v);
      else if (isvInnehaller(vo, ord)) innehaller.push(v);
    }
    const block = ord.join(' ');
    if (exakta.length === 1) return { block, vyId: exakta[0].id, saker: true };
    if (exakta.length > 1) return { block, vyId: null };
    if (innehaller.length === 1) return { block, vyId: innehaller[0].id, saker: false };
    if (innehaller.length > 1) return { block, vyId: null };
  }
  return { block: null, vyId: null };
}

function isvInnehaller(helhet, del) {
  for (let i = 0; i + del.length <= helhet.length; i++) {
    if (del.every((o, j) => helhet[i + j] === o)) return true;
  }
  return false;
}

// Rullistan: användaren väljer en annan vy, eller bara modellen med nålen.
function isvValjVy(vyId) {
  const k = _isv.kontext;
  if (!k?.ms || !_isv.aktiv) return;
  k.vyId = vyId;
  k.hur = 'sparad';
  isvSparaVal(isvValNyckel(k), vyId);
  _isv.tillatStor = null;
  isvKorOm();
}

function isvLaddaStorVy() {
  _isv.tillatStor = _isv.kontext?.vyId || null;
  isvKorOm();
}

// Kör om det aktuella ärendet i samma kö som klicken. Valet är redan sparat,
// så isvKontext hittar det.
function isvKorOm() {
  if (!_isv.aktiv) return;
  _isv.onskat = _isv.aktiv;
  if (!_isv.arbetar) isvArbeta();
}

// Laddar vyns modeller, eller bara nålens modell om ingen vy är vald.
async function isvLaddaKontext() {
  const lank = _isv.lank, k = _isv.kontext;
  if (!lank) return;
  const pinLineage = isvLineage(lank.urn);
  const vy = k?.vyer.find(v => v.id === k.vyId) || null;
  const lista = [];

  const lagg = (lineage, viewableName, guid) => {
    const dok = k?.ms?.dok || [];
    const sammaFil = dok.filter(d => isvLineage(d.documentLineage?.lineageUrn) === lineage);
    const d = sammaFil.find(x => guid && x.viewableGuid === guid)
           || sammaFil.find(x => viewableName && x.viewableName === viewableName)
           || sammaFil[0];
    if (!d) return;
    const nyckel = `${d.versionUrn}|${d.viewableGuid || ''}`;
    if (!lista.some(x => x.nyckel === nyckel)) lista.push({ nyckel, urn: toSafeBase64(d.versionUrn), guid: d.viewableGuid, lineage, namn: d.displayName || '' });
  };

  if (vy) for (const d of vy.definition) lagg(isvLineage(d.lineageUrn), d.viewableName, null);
  // Nålens modell är alltid med, även om vyn saknar den.
  lagg(pinLineage, lank.details.viewable?.name, lank.details.viewable?.guid);
  if (!lista.some(x => x.lineage === pinLineage)) {
    // Modellen finns inte i något model set längre: ta versionen ärendet skapades i.
    const o = lank.details.viewerState.objectSet.find(o => isvAvkoda(o.seedUrn).includes(pinLineage.split(':').pop()));
    if (o) lista.push({ nyckel: `ärende|${o.seedUrn}`, urn: o.seedUrn, guid: lank.details.viewable?.guid, lineage: pinLineage, namn: '' });
  }
  if (!lista.length) throw new Error('Hittar inte modellen som ärendet sitter i.');

  if (vy && lista.length > ISV_MAX_MODELLER && _isv.tillatStor !== vy.id) {
    _isv.storVy = { namn: vy.namn, antal: lista.length };
    isvSattStatus('');
    return;
  }
  _isv.storVy = null;

  const nya = lista.filter(x => !_isv.modeller.has(x.nyckel)).length;
  isvSattStatus(nya ? `Laddar ${nya === 1 ? 'en modell' : `${nya} modeller`}…` : '');
  const t0 = performance.now();
  await isvLaddaModeller(lista);
  if (_isv.onskat) return;

  await isvArendetsVy();
  const sek = (performance.now() - t0) / 1000;
  isvSattStatus(nya && sek > 0.3 ? `Klar på ${sek.toFixed(1).replace('.', ',')} s` : '');
}

function isvAvkoda(b64) {
  try { return atob(String(b64).replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; }
}

// Laddar det som saknas och tar bort det som inte behövs, så att minnet bara
// rymmer en vy åt gången.
async function isvLaddaModeller(lista) {
  await vkStartaVisare();
  if (!_isv.viewer) {
    const behallare = document.getElementById('isv-visare');
    if (!behallare) throw new Error('Modellvyn är stängd.');
    _isv.viewer = new Autodesk.Viewing.Viewer3D(behallare);
    _isv.viewer.start();
  }
  const v = _isv.viewer;
  const behov = new Set(lista.map(x => x.nyckel));

  for (const [nyckel, post] of _isv.modeller) {
    if (!behov.has(nyckel)) { v.unloadModel(post.m); _isv.modeller.delete(nyckel); }
  }
  for (const x of lista) {
    if (_isv.modeller.has(x.nyckel)) continue;
    const doc = await isvLaddaDokument(x.urn);
    const nod = (x.guid && doc.getRoot().search({ guid: x.guid })[0]) || doc.getRoot().getDefaultGeometry();
    if (!nod) throw new Error('Modellen har ingen 3D-vy.');
    if (_isv.viewer !== v) throw new Error('Modellvyn stängdes.');
    const m = await v.loadDocumentNode(doc, nod, { keepCurrentModels: true, globalOffset: { x: 0, y: 0, z: 0 }, applyRefPoint: false });
    if (_isv.viewer !== v) throw new Error('Modellvyn stängdes.');
    _isv.modeller.set(x.nyckel, { m, lineage: x.lineage });
  }
  await Promise.all([..._isv.modeller.values()].map(p => isvVantaPaGeometri(p.m)));
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

// Modellen som nålen sitter i.
function isvNalModell(lank) {
  const lineage = isvLineage(lank.urn);
  for (const p of _isv.modeller.values()) if (p.lineage === lineage) return p.m;
  return null;
}

// Elementets id kan skilja mellan versioner. Revits unika id (externalId) är
// detsamma, så det slås upp i den laddade versionen.
function isvElementId(m, lank) {
  const ext = lank.details.externalId;
  if (!m || !ext) return Promise.resolve(lank.details.objectId ?? null);
  return new Promise(klar => {
    m.getExternalIdMapping(karta => klar(karta?.[ext] ?? lank.details.objectId ?? null), () => klar(lank.details.objectId ?? null));
  });
}

async function isvArendetsVy() {
  const v = _isv.viewer, lank = _isv.lank;
  if (!v || !lank) return;
  const m = isvNalModell(lank);
  const dbId = await isvElementId(m, lank);
  v.showAll();
  v.setCutPlanes([]);
  v.restoreState(lank.details.viewerState, null, true);
  if (m && dbId != null) v.select([dbId], m);
  try { isvFokus(v, lank, m, dbId); } catch (err) { console.warn('Modellvy: kunde inte fokusera', err); }
}

// Snittlåda runt nålen och nedtoning av allt utom elementen vid nålen. Ärenden
// som redan har ett eget snitt eller egna dolda/isolerade element i ACC visas
// som de sparades, utan att det här skrivs över.
function isvFokus(v, lank, nalModell, dbId) {
  const vs  = lank.details.viewerState;
  const pos = lank.details.position;
  if (!pos) return;
  const p = new THREE.Vector3(pos.x, pos.y, pos.z);
  const enhet = 1 / ((nalModell || v.model).getUnitScale?.() || 1);   // modellenheter per meter

  // Elementen nära nålen, i alla modeller. Det är i praktiken de som krockar.
  const nara = new THREE.Box3(p.clone(), p.clone()).expandByScalar(ISV_NARA_M * enhet);
  const traffar = [];
  for (const { m } of _isv.modeller.values()) {
    const ids = isvElementIRuta(m, nara);
    if (m === nalModell && dbId != null && !ids.includes(dbId)) ids.push(dbId);
    if (ids.length) traffar.push({ m, ids });
  }

  // Området runt ärendet: några meter runt nålen plus det klickade elementet.
  const lada = new THREE.Box3(p.clone(), p.clone()).expandByScalar(ISV_MARGINAL_M * enhet);
  if (nalModell && dbId != null) {
    const tak = new THREE.Box3(p.clone(), p.clone()).expandByScalar(ISV_ELEMENT_M * enhet);
    const el = isvElementGranser(nalModell, dbId);
    if (!el.isEmpty()) lada.union(el.intersect(tak));
  }
  if (_isv.snitt && !vs.cutplanes?.length) v.setCutPlanes(isvLadansPlan(lada));
  // Alltid till ärendets plats. Riktningen är den som sparades med ärendet.
  v.navigation.fitBounds(true, lada);

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

function isvStang() {
  try { _isv.viewer?.finish(); } catch { /* redan borta */ }
  _isv.viewer = null;
  _isv.ruta = null;
  _isv.modeller.clear();
  _isv.aktiv = null;
  _isv.lank = null;
  _isv.kontext = null;
  _isv.storVy = null;
  _isv.tillatStor = null;
  _isv.onskat = null;
  _isv.status = '';
  _isv.fel = false;
}
