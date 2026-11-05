// issues-visare.js — modellvy under ärendelistan (docs/PLAN-ARENDEVY.md, del 2).
//
// Med "Modellvy" på delas fliken: ärendena överst, en lätt APS-visare under.
// Man väljer en Model Coordination-vy som bakgrund (isvVyValHtml). Den laddas
// en gång och ligger kvar; ett klick på ett ärende flyttar bara kameran dit.
// Ärendets viewerState har kameran, nålen och elementet.
//
// Ärendets egna sparade läge laddas aldrig: där ingår allt som var öppet när
// ärendet skapades, i ett riktigt projekt hela model setet, och det tog över
// 5 GB minne (2026-11-05).
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
  mcKlar:    new Map(),   // projekt-id → samma sak när den är läst
  mcFel:     new Map(),   // projekt-id → felet om den inte gick att läsa
  projektId: null,        // projektet vars vyer visas
  vy:        null,        // den laddade vyn { projektId, msId, vyId, namn, version }
  laddarVy:  false,
  vyOnskas:  false,       // vyn ska laddas (om) av kön
  storVy:    null,        // { namn, antal } när en vy väntar på bekräftelse
  tillatStor: null,       // "msId|vyId" som användaren bekräftat trots många modeller
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
  // Den vy som valdes senast i projektet laddas direkt.
  if (_isv.pa && isvVisas()) isvBegarVy();
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

// Raden ovanför visaren: vyval först (vyn är bakgrunden), sedan ärendet och knappar.
function isvRitaRad() {
  const rad = document.getElementById('isv-rad');
  if (!rad) return;
  const a = _isv.aktiv;
  const syns = !!a && isvSyns();
  rad.innerHTML = `
    ${isvVyValHtml()}
    <span class="text-ads-border">|</span>
    <span class="font-semibold text-ads-text">${a ? `#${a.nr}` : ''}</span>
    <span class="text-ads-muted truncate">${a ? vkEsc(a.rubrik) : 'Klicka på ett ärende i listan.'}</span>
    <span class="${_isv.fel ? 'text-red-700' : 'text-ads-muted'} whitespace-nowrap">${vkEsc(_isv.status)}</span>
    <div class="flex-1"></div>
    ${syns && !_isv.fel ? `
      <label class="flex items-center gap-1 cursor-pointer text-ads-muted whitespace-nowrap" title="Skär bort allt utom några meter runt ärendet">
        <input type="checkbox" ${_isv.snitt ? 'checked' : ''} onchange="isvVaxlaVal('snitt')" class="accent-ads-blue" /> Snittlåda</label>
      <label class="flex items-center gap-1 cursor-pointer text-ads-muted whitespace-nowrap" title="Visa elementen vid nålen tydligt och resten genomskinligt">
        <input type="checkbox" ${_isv.tona ? 'checked' : ''} onchange="isvVaxlaVal('tona')" class="accent-ads-blue" /> Tona ner omgivningen</label>
      <button onclick="isvArendetsVy()" class="hover:text-ads-blue whitespace-nowrap" title="Gå tillbaka till ärendets plats">Ärendets vy</button>` : ''}
    <button onclick="isvVaxla()" class="text-ads-muted hover:text-ads-text" title="Stäng modellvyn">✕</button>`;

  const medd = document.getElementById('isv-meddelande');
  if (medd) {
    // Meddelandet täcker vyn när det valda ärendet inte syns i den.
    const text = _isv.storVy ? null
      : !_isv.vy && !_isv.laddarVy ? 'Välj en vy i listan uppe till vänster. Den ligger kvar medan du går igenom ärendena.'
      : !_isv.modeller.size ? (_isv.status || (_isv.vy?.arendets ? 'Klicka på ett ärende för att se dess modell.' : 'Laddar vyn…'))
      : a && !syns && !_isv.arbetar ? (_isv.status || '')
      : '';
    const visa = !!_isv.storVy || !!text;
    medd.style.background = visa && _isv.modeller.size ? 'rgba(255, 255, 255, 0.92)' : '';
    medd.innerHTML = !visa ? '' : _isv.storVy ? `
      <div class="text-sm text-ads-muted text-center max-w-md px-6 pointer-events-auto">
        <p>Vyn "${vkEsc(_isv.storVy.namn)}" har ${_isv.storVy.antal} modeller. Det kan ta lång tid och mycket minne.</p>
        <p class="mt-2">Välj en mindre vy, eller
          <button onclick="isvLaddaStorVy()" class="text-ads-blue hover:underline">ladda ändå</button>.</p>
      </div>`
      : `<p class="text-sm text-ads-muted text-center max-w-md px-6">${vkEsc(text)}</p>`;
  }
  // Markera raden för det aktiva ärendet.
  document.querySelectorAll('tr[data-isv]').forEach(tr => {
    const aktiv = !!a && tr.dataset.isv === a.id;
    tr.style.boxShadow  = aktiv ? 'inset 3px 0 0 #0696D7' : '';
    tr.style.background = aktiv ? 'rgba(6, 150, 215, 0.08)' : '';
  });
}

// ── Vyn som bakgrund ──────────────────────────────────────────────────────────
// Man väljer själv en Model Coordination-vy. Dess modeller laddas en gång, i
// model setets senaste version, och ligger kvar medan man går igenom ärendena.
// Ett klick på ett ärende flyttar bara kameran. Valet sparas per projekt i den
// här webbläsaren (isv-vy:<projekt-id>).

const ISV_MAX_MODELLER = 8;   // fler modeller än så i en vy laddas bara efter bekräftelse
const ISV_ARENDETS = 'arende';  // vyvalet "Bara ärendets modell": byts för varje ärende

// Projektet vars vyer visas: det senast klickade ärendets, annars det första.
function isvProjektId() {
  if (_isv.projektId && _is.projekt.has(_isv.projektId)) return _isv.projektId;
  return [..._is.projekt.keys()][0] || null;
}

// Rullistan med projektets vyer, grupperade per model set.
function isvVyValHtml() {
  const pid = isvProjektId();
  if (!pid) return '';
  const info = _isv.mcKlar.get(pid);
  if (!info) {
    if (!_isv.mc.has(pid)) isvMcInfo(pid).then(() => isvRitaRad(), () => isvRitaRad());
    const fel = _isv.mcFel.get(pid);
    return fel ? `<span class="text-red-700" title="${vkEsc(fel)}">Kunde inte läsa vyerna</span>`
               : '<span class="text-ads-muted whitespace-nowrap">Läser vyer…</span>';
  }
  const vald = isvLasVal(`isv-vy:${pid}`, '');
  const flera = _is.projekt.size > 1;
  return `
    <label class="flex items-center gap-1.5 text-ads-text font-medium whitespace-nowrap"
           title="${vkEsc(flera ? `Vyer i ${_is.projekt.get(pid)?.namn || ''}` : 'Vyn som visas bakom ärendena')}">Vy
      <select onchange="isvValjVy(this.value)"
              class="text-xs font-normal border rounded px-1.5 py-0.5 max-w-[16rem] ${vald ? 'border-ads-border bg-white' : 'border-amber-400 bg-amber-50'}">
        <option value="" ${vald ? '' : 'selected'}>Välj vy…</option>
        <option value="${ISV_ARENDETS}" ${vald === ISV_ARENDETS ? 'selected' : ''}>Bara ärendets modell</option>
        ${info.filter(ms => ms.vyer.length).map(ms => `
          <optgroup label="${vkEsc(ms.namn)}">
            ${ms.vyer.map(v => {
              const varde = `${ms.id}|${v.id}`;
              return `<option value="${vkEsc(varde)}" ${varde === vald ? 'selected' : ''}>${vkEsc(v.namn)}${v.privat ? ' (privat)' : ''}</option>`;
            }).join('')}
          </optgroup>`).join('')}
      </select></label>`;
}

function isvValjVy(varde) {
  const pid = isvProjektId();
  if (!pid) return;
  isvSparaVal(`isv-vy:${pid}`, varde);
  _isv.tillatStor = null;
  isvBegarVy();
}

function isvLaddaStorVy() {
  _isv.tillatStor = isvLasVal(`isv-vy:${isvProjektId()}`, '');
  isvBegarVy();
}

// Ber kön ladda (om) den valda vyn.
function isvBegarVy() {
  _isv.vyOnskas = true;
  if (!_isv.arbetar) isvArbeta();
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
  _isv.aktiv  = { id: a.id, nr: a.nr, rubrik: a.rubrik, projekt: a.projekt, accId: a.accId, projektId: a.projektId };
  _isv.onskat = _isv.aktiv;
  _isv.lank   = _isv.arenden.has(a.id) ? _isv.arenden.get(a.id) : null;
  if (a.projektId !== isvProjektId()) {
    // Ärendet hör till ett annat projekt: byt till det projektets vy.
    _isv.projektId = a.projektId;
    _isv.vyOnskas = true;
  }
  isvRitaRad();
  if (!_isv.arbetar) isvArbeta();
}

// En kö: först vyn om den ska bytas, sedan det senast klickade ärendet. Snabba
// klick hoppar över ärenden som hunnit bli inaktuella.
async function isvArbeta() {
  _isv.arbetar = true;
  try {
    while (_isv.vyOnskas || _isv.onskat) {
      try {
        if (_isv.vyOnskas) {
          _isv.vyOnskas = false;
          await isvLaddaVald();
          continue;
        }
        const a = _isv.onskat;
        _isv.onskat = null;
        await isvGaTill(a);
      } catch (err) {
        if (!_isv.onskat && !_isv.vyOnskas) isvSattStatus(String(err.message || err), true);
      }
    }
  } finally {
    _isv.arbetar = false;
    isvRitaRad();
  }
}

// Laddar den sparade vyn för projektet, eller tömmer visaren om ingen är vald.
async function isvLaddaVald() {
  const pid = isvProjektId();
  const varde = pid ? isvLasVal(`isv-vy:${pid}`, '') : '';
  _isv.storVy = null;
  if (!varde) {
    isvTom();
    _isv.vy = null;
    isvSattStatus('');
    return;
  }
  _isv.laddarVy = true;
  try {
    isvSattStatus('Läser vyn…');
    const info = await isvMcInfo(pid);
    if (varde === ISV_ARENDETS) return await isvLaddaArendets(pid, info);
    const [msId, vyId] = varde.split('|');
    const ms = info.find(s => s.id === msId);
    const vy = ms?.vyer.find(v => v.id === vyId);
    if (!vy) {
      isvTom();
      _isv.vy = null;
      isvSparaVal(`isv-vy:${pid}`, '');
      isvSattStatus('Den sparade vyn finns inte längre. Välj en ny.', true);
      return;
    }

    const lista = [];
    for (const d of vy.definition) {
      const lineage = isvLineage(d.lineageUrn);
      const sammaFil = ms.dok.filter(x => isvLineage(x.documentLineage?.lineageUrn) === lineage);
      const dok = sammaFil.find(x => d.viewableName && x.viewableName === d.viewableName) || sammaFil[0];
      if (!dok) continue;
      const nyckel = `${dok.versionUrn}|${dok.viewableGuid || ''}`;
      if (!lista.some(x => x.nyckel === nyckel)) lista.push({ nyckel, urn: toSafeBase64(dok.versionUrn), guid: dok.viewableGuid, lineage });
    }
    if (!lista.length) throw new Error(`Vyn "${vy.namn}" har inga modeller i model setets senaste version.`);
    if (lista.length > ISV_MAX_MODELLER && _isv.tillatStor !== varde) {
      _isv.storVy = { namn: vy.namn, antal: lista.length };
      isvSattStatus('');
      return;
    }

    const nya = lista.filter(x => !_isv.modeller.has(x.nyckel)).length;
    isvSattStatus(nya ? `Laddar ${nya === 1 ? 'en modell' : `${nya} modeller`}…` : '');
    const t0 = performance.now();
    await isvLaddaModeller(lista);
    _isv.vy = { projektId: pid, msId, vyId, namn: vy.namn, version: ms.version };
    const sek = (performance.now() - t0) / 1000;
    isvSattStatus(nya && sek > 0.3 ? `Vyn laddad på ${sek.toFixed(1).replace('.', ',')} s` : '');

    // Står ett ärende redan valt går vi dit, annars visas hela vyn.
    if (_isv.aktiv && _isv.lank && isvSyns()) await isvArendetsVy();
    else if (!_isv.onskat) {
      // Direkt, utan animering: annars hinner animeringen skriva över nästa
      // ärendes kamera om man klickar medan den pågår.
      _isv.viewer.setCutPlanes([]); _isv.viewer.showAll(); _isv.viewer.fitToView(undefined, undefined, true);
      if (_isv.aktiv && _isv.lank) isvSattStatus(`Ärendets modell finns inte i vyn "${vy.namn}".`);
    }
  } finally {
    _isv.laddarVy = false;
  }
}

// "Bara ärendets modell": modellen som det valda ärendet sitter i, i model
// setets senaste version. Finns den inte i något model set tas versionen
// ärendet skapades i.
async function isvLaddaArendets(pid, info) {
  const lank = _isv.lank;
  _isv.vy = { projektId: pid, vyId: ISV_ARENDETS, namn: 'Bara ärendets modell', arendets: true };
  if (!lank) { isvTom(); isvSattStatus(''); return; }

  const lineage = isvLineage(lank.urn);
  const guid = lank.details.viewable?.guid, namn = lank.details.viewable?.name;
  let post = null;
  for (const ms of info) {
    const sammaFil = ms.dok.filter(x => isvLineage(x.documentLineage?.lineageUrn) === lineage);
    const dok = sammaFil.find(x => guid && x.viewableGuid === guid) || sammaFil.find(x => namn && x.viewableName === namn) || sammaFil[0];
    if (dok) { post = { nyckel: `${dok.versionUrn}|${dok.viewableGuid || ''}`, urn: toSafeBase64(dok.versionUrn), guid: dok.viewableGuid, lineage }; break; }
  }
  if (!post) {
    const id = lineage.split(':').pop();
    const o = lank.details.viewerState.objectSet.find(o => {
      try { return atob(o.seedUrn.replace(/-/g, '+').replace(/_/g, '/')).includes(id); } catch { return false; }
    });
    if (o) post = { nyckel: `ärende|${o.seedUrn}`, urn: o.seedUrn, guid, lineage };
  }
  if (!post) throw new Error('Hittar inte modellen som ärendet sitter i.');

  const ny = !_isv.modeller.has(post.nyckel);
  isvSattStatus(ny ? 'Laddar ärendets modell…' : '');
  await isvLaddaModeller([post]);
  await isvArendetsVy();
  isvSattStatus('');
}

// Tar bort alla laddade modeller.
function isvTom() {
  for (const p of _isv.modeller.values()) { try { _isv.viewer?.unloadModel(p.m); } catch { /* redan borta */ } }
  _isv.modeller.clear();
}

// Hämtar ärendets placering (en gång) och flyttar kameran dit om dess modell
// finns i vyn. Ingenting laddas här.
async function isvGaTill(a) {
  let lank = _isv.arenden.get(a.id);
  if (lank === undefined) {
    isvSattStatus('Hämtar ärendet…');
    const ra = await bhMedOmforsok(() => apsGet(`/construction/issues/v1/projects/${a.accId}/issues/${a.id}`));
    lank = (ra.linkedDocuments || []).find(d => d.details?.viewerState?.objectSet?.length) || null;
    _isv.arenden.set(a.id, lank);
  }
  if (_isv.onskat || _isv.vyOnskas) return;
  _isv.lank = lank;
  if (!lank)        return isvSattStatus('Ärendet är inte placerat i någon modell.');
  if (!_isv.vy)     return isvSattStatus('Välj en vy för att se ärendet.');
  // "Bara ärendets modell" byter modell när ärendet sitter i en annan.
  if (_isv.vy.arendets && !isvSyns()) { _isv.vyOnskas = true; return; }
  if (!isvSyns())   return isvSattStatus(`Ärendets modell finns inte i vyn "${_isv.vy.namn}".`);
  await isvArendetsVy();
  isvSattStatus('');
}

// Sitter det valda ärendets nål i en modell som är laddad?
function isvSyns() {
  return !!_isv.lank && !!_isv.vy && !!isvNalModell(_isv.lank);
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
    p.then(info => { _isv.mcKlar.set(projektId, info); _isv.mcFel.delete(projektId); },
           err  => { _isv.mc.delete(projektId); _isv.mcFel.set(projektId, String(err.message || err)); });
    _isv.mc.set(projektId, p);
  }
  return _isv.mc.get(projektId);
}

function isvLineage(urn) {
  return String(urn || '').split('#')[0].split('?')[0];
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
  _isv.vy = null;
  _isv.laddarVy = false;
  _isv.vyOnskas = false;
  _isv.storVy = null;
  _isv.tillatStor = null;
  _isv.onskat = null;
  _isv.status = '';
  _isv.fel = false;
}
