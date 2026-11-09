// issues-visare.js — modellen under ärendelistan (docs/PLAN-FRAGMENTS.md).
//
// "Visa modell" delar fliken: ärendena överst, en lätt modell under. Modellen
// är projektets IFC-filer omgjorda till That Opens Fragments (issues-frag.js),
// valda i "Modellinställningar" (issues-lattmodell.js). Autodesks visare och
// Model Coordinations vyer används inte längre: de var för långsamma (Mahdi,
// 2026-11-06).
//
// Den här filen äger panelen, raden ovanför modellen, kopplingen till
// ärendelistan (klick, gråmarkering, Föregående/Nästa) och detaljraden med
// bild, beskrivning och kommentarer.
//
// Fliken ritas om helt vid varje ändring, så modellen ligger i en egen ruta
// (_isv.ruta) som flyttas tillbaka in i platshållaren efter varje omritning.

const _isv = {
  pa:        false,
  ruta:      null,        // den bestående rutan med modellen
  projektId: null,        // projektet vars modell visas
  aktiv:     null,        // { id, nr, rubrik, projekt, accId, projektId }
  lank:      null,        // ärendets linkedDocument (nål, element, kamera)
  status:    '',
  fel:       false,
  arenden:   new Map(),   // ärende-id → linkedDocument eller null (inte placerat)
  placeringar: new Map(), // projekt-id → löfte: alla ärendens placering är lästa (isvLasPlaceringar)
  detaljer:  new Map(),   // ärende-id → { laddar, beskrivning, bild, kommentarer, fel }, se isvLasDetaljer
  hopfallt:  null,        // ärende-id vars detaljrad användaren har stängt
  // Val som sparas per webbläsare.
  hojd:      isvLasVal('isv-hojd', 48),      // modellrutans höjd i procent
};

const ISV_YTOR = ['alla', 'clash'];

function isvLasVal(nyckel, standard) {
  try { const v = JSON.parse(localStorage.getItem(nyckel)); return v ?? standard; } catch { return standard; }
}

function isvSparaVal(nyckel, varde) {
  try { localStorage.setItem(nyckel, JSON.stringify(varde)); } catch { /* inte kritiskt */ }
}

function isvVisas() {
  return _isv.pa && ISV_YTOR.includes(_is.yta) && !!_is.hamtad && !_is.valjProjekt;
}

// En fils lineage-URN utan versions- och frågedel (ärendets linkedDocuments.urn
// jämförs med IFC-filens item-id i den lätta modellen).
function isvLineage(urn) {
  return String(urn || '').split('#')[0].split('?')[0];
}

// Anropas när fliken öppnas: byter projekt i sidomenyn har modellen att följa
// med. Det klickade ärendets projekt och det gamla ärendet gäller inte längre.
function isvFoljProjekt() {
  const pid = _currentProject?.id;
  if (!pid || pid === _isv.sagt) return;
  _isv.sagt = pid;
  _isv.projektId = pid;
  _isv.aktiv = null;
  _isv.lank = null;
  _isv.status = '';
  _isv.fel = false;
  _isv.hopfallt = null;
}

// Projektet vars modell visas: det senast klickade ärendets, annars det första.
function isvProjektId() {
  if (_isv.projektId && _is.projekt.has(_isv.projektId)) return _isv.projektId;
  return [..._is.projekt.keys()][0] || null;
}

// [Visa modell | ⚙] i flikens huvud (Mahdi, 2026-11-09). ⚙ öppnar
// Modellinställningar; den röda bubblan där visar att en vald IFC har en nyare
// version i ACC (ilmHarUppdateringar).
function isvKnappHtml() {
  if (!ISV_YTOR.includes(_is.yta)) return '';
  ilmStartaKoll();
  return `
    <span class="inline-flex items-stretch">
      <button onclick="isvVaxla()" title="Visa projektets modell under listan. Klicka på ett ärende för att gå till platsen."
              class="text-xs border rounded-l px-2.5 py-1.5 transition-colors ${_isv.pa
                ? 'bg-be-charcoal text-white border-be-charcoal' : 'bg-white text-ads-text border-ads-border hover:border-ads-blue'}">Visa modell</button>
      <button onclick="ilmOppna()" title="Modellinställningar: vilka IFC-filer modellen består av, var den sparas och färgerna"
              class="relative text-xs border border-l-0 rounded-r px-2 py-1.5 bg-white text-ads-text border-ads-border hover:border-ads-blue">⚙<span id="ilm-bubbla">${ilmBubblaHtml()}</span></button>
    </span>`;
}

function isvVaxla() {
  _isv.pa = !_isv.pa;
  if (!_isv.pa) isvStang();
  isRita();
  if (_isv.pa && isvVisas()) isfVisaProjekt(isvProjektId());
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
  // Visaren visar ett annat projekt än det valda: byt. Redan hämtade filer
  // ligger kvar i IndexedDB och i IFC-indexet, så inget hämtas eller
  // omvandlas igen, bara läses in från webbläsarens lager.
  const pid = isvProjektId();
  if (_isv.pa && pid && _isf.projektId && _isf.projektId !== pid && _isv.byte !== pid) {
    _isv.byte = pid;
    Promise.resolve(isfVisaProjekt(pid)).finally(() => { _isv.byte = null; });
  }
  isvLasPlaceringar();
  isvRitaRad();
}

function isvSkapaRuta() {
  const ruta = document.createElement('div');
  ruta.className = 'h-full flex flex-col';
  ruta.innerHTML = `
    <div id="isv-rad" class="shrink-0 px-4 py-1.5 border-b border-ads-border flex items-center gap-3 text-xs"></div>
    <div class="relative flex-1 min-h-0">
      <div id="isv-visare" class="absolute inset-0"></div>
      <div id="isv-meddelande" class="absolute inset-0 flex items-center justify-center pointer-events-none"></div>
      <div id="isf-verktyg" class="absolute bottom-3 left-1/2 -translate-x-1/2 z-20"></div>
      <div id="isf-egenskaper" class="hidden absolute top-2 right-2 bottom-2 w-80 z-20 flex flex-col bg-white/95 border border-ads-border rounded shadow-lg text-xs"></div>
    </div>`;
  return ruta;
}

// Raden ovanför modellen: projektets modell, stegning, ärendet och stäng.
function isvRitaRad() {
  const rad = document.getElementById('isv-rad');
  if (!rad) return;
  const a = _isv.aktiv;
  const pid = isvProjektId();
  const flera = _is.projekt.size > 1;
  rad.innerHTML = `
    ${flera ? `<span class="font-medium text-ads-text whitespace-nowrap truncate max-w-[14rem]" title="Modellen som visas">${vkEsc(_is.projekt.get(pid)?.namn || '')}</span>
      <span class="text-ads-border">|</span>` : ''}
    <span class="flex items-center whitespace-nowrap" title="Gå till föregående eller nästa ärende som syns i modellen (också med pil upp och ner)">
      <button onclick="isvSteg(-1)" class="px-1.5 py-0.5 border border-ads-border rounded-l hover:border-ads-blue">‹ Föregående</button>
      <button onclick="isvSteg(1)" class="px-1.5 py-0.5 border border-l-0 border-ads-border rounded-r hover:border-ads-blue">Nästa ›</button>
    </span>
    <span class="font-semibold text-ads-text">${a ? `#${a.nr}` : ''}</span>
    <span class="text-ads-muted truncate">${a ? vkEsc(a.rubrik) : 'Klicka på ett ärende i listan.'}</span>
    <span class="${_isv.fel ? 'text-red-700' : 'text-ads-muted'} whitespace-nowrap">${vkEsc(_isv.status || isfStatus())}</span>
    <div class="flex-1"></div>
    ${isfArendeVisas() ? `
      <label class="flex items-center gap-1 cursor-pointer text-ads-muted whitespace-nowrap" title="Skär bort allt över ärendet och visa det uppifrån, som en planritning">
        <input type="checkbox" ${_isf.arendeSnitt ? 'checked' : ''} onchange="isfVaxlaArendeval('arendeSnitt')" class="accent-ads-blue" /> Plansnitt</label>
      <label class="flex items-center gap-1 cursor-pointer text-ads-muted whitespace-nowrap" title="Visa elementen vid nålen tydligt och resten genomskinligt">
        <input type="checkbox" ${_isf.tona ? 'checked' : ''} onchange="isfVaxlaArendeval('tona')" class="accent-ads-blue" /> Tona ner omgivningen</label>
      <button onclick="isfGaTillArende(_isv.aktiv, _isv.lank)" class="hover:text-ads-blue whitespace-nowrap" title="Gå tillbaka till ärendets plats">Ärendets vy</button>` : ''}
    <button onclick="isvVaxla()" class="text-ads-muted hover:text-ads-text" title="Stäng modellen">✕</button>`;

  // Meddelandet mitt i modellrutan (inget valt underlag, laddar, fel).
  const medd = document.getElementById('isv-meddelande');
  if (medd) {
    const text = isfMeddelande(pid);
    medd.style.background = text && isfHarModell() ? 'rgba(255, 255, 255, 0.92)' : '';
    medd.innerHTML = !text ? '' : `
      <div class="text-sm text-ads-muted text-center max-w-md px-6 pointer-events-auto">${text}</div>`;
  }
  isfRitaVerktyg();
  isvRitaRadlagen();
}

function isvSattStatus(text, fel = false) {
  _isv.status = text;
  _isv.fel = fel;
  isvRitaRad();
}

// ── Listan följer modellen ────────────────────────────────────────────────────
// Varje ärendes placering läses med ett listanrop per projekt (bara fältet
// linkedDocuments, ungefär 0,5 kB per ärende). Rader som inte är placerade i
// någon modell tonas ner och får en förklaring.

const ISV_RADLAGE = {
  ejPlacerad: 'Inte placerat i någon modell',
  utanfor:    'Finns inte i den lätta modellen',
};

// Läser placeringen för alla ärenden i de hämtade projekten, en gång per projekt.
function isvLasPlaceringar() {
  for (const p of _is.projekt.values()) {
    if (_isv.placeringar.has(p.id)) continue;
    const lofte = (async () => {
      const statusar = IS_EJ_STANGDA + (p.medStangda || _is.visaStangda ? ',closed' : '');
      for (let offset = 0; ; offset += 100) {
        const res = await bhMedOmforsok(() => apsGet(
          `/construction/issues/v1/projects/${p.accId}/issues?limit=100&offset=${offset}&fields=displayId,linkedDocuments&filter[status]=${statusar}`));
        for (const r of res.results || []) {
          _isv.arenden.set(r.id, (r.linkedDocuments || []).find(d => d.details?.viewerState?.objectSet?.length) || null);
        }
        if (offset + 100 >= (res.pagination?.totalResults ?? 0) || !(res.results || []).length) break;
      }
    })();
    lofte.then(() => isvRitaRad(), () => _isv.placeringar.delete(p.id));
    _isv.placeringar.set(p.id, lofte);
  }
}

// Radens läge: null (syns, eller okänt än) eller en nyckel i ISV_RADLAGE.
// "utanfor": varken ärendets modell eller dess element finns i projektets
// lätta modell (isfKartlagg).
function isvRadLage(id) {
  if (!_isv.arenden.has(id)) return null;
  if (!_isv.arenden.get(id)) return 'ejPlacerad';
  return isfArendeLage(id) === 'nej' ? 'utanfor' : null;
}

// Markerar aktiv rad och tonar ner raderna som inte kan visas i modellen.
function isvRitaRadlagen() {
  const a = _isv.aktiv;
  const perId = new Map(isAllaArenden().map(x => [x.id, x]));
  document.querySelectorAll('tr[data-isv]').forEach(tr => {
    const id = tr.dataset.isv;
    const aktiv = !!a && id === a.id;
    const lage = isvRadLage(id);
    tr.style.boxShadow  = aktiv ? 'inset 3px 0 0 #0696D7' : '';
    tr.style.background = aktiv ? 'rgba(6, 150, 215, 0.08)' : '';
    tr.style.opacity    = lage && !aktiv ? '0.45' : '';
    tr.dataset.isvLage  = lage || '';

    // Förklaringen läggs under rubriken (eller i första kolumnen efter rutan).
    tr.querySelector('.isv-radtext')?.remove();
    if (!lage) return;
    const rubrik = perId.get(id)?.rubrik || '';
    const cell = (rubrik && [...tr.cells].find(td => td.textContent.includes(rubrik.slice(0, 25)))) || tr.cells[1];
    if (!cell) return;
    const text = document.createElement('div');
    text.className = 'isv-radtext text-[10px] italic text-ads-muted';
    text.textContent = ISV_RADLAGE[lage];
    cell.appendChild(text);
  });
  isvRitaDetaljrad();
}

// ── Det valda ärendet öppnas ──────────────────────────────────────────────────
// Under den valda raden visas ärendets bild (snapshot), beskrivningen och alla
// kommentarer. Det läses en gång per ärende: ärendet självt, kommentarerna
// (sidor om 100) och bilden via en signerad nedladdningsadress.

function isvRitaDetaljrad() {
  document.querySelectorAll('tr.isv-detalj').forEach(tr => tr.remove());
  const a = _isv.aktiv;
  if (!a || _isv.hopfallt === a.id) return;
  const rad = [...document.querySelectorAll('tr[data-isv]')].find(tr => tr.dataset.isv === a.id);
  if (!rad) return;
  const d = _isv.detaljer.get(a.id);
  if (!d) isvLasDetaljer(a);

  const tr = document.createElement('tr');
  tr.className = 'isv-detalj';
  tr.innerHTML = `<td colspan="${rad.cells.length}" class="p-0">${isvDetaljHtml(a, d)}</td>`;
  rad.after(tr);
}

function isvDetaljHtml(a, d) {
  const ram = inne => `
    <div class="mx-2 mb-2 mt-0.5 p-3 bg-white border border-ads-blue/40 rounded flex gap-4 items-start text-xs"
         style="box-shadow: inset 3px 0 0 #0696D7">${inne}
      <button onclick="isvFallIhop()" class="ml-auto text-ads-muted hover:text-ads-text" title="Stäng">✕</button>
    </div>`;
  if (!d || d.laddar) return ram('<span class="text-ads-muted">Läser ärendet…</span>');
  if (d.fel) return ram(`<span class="text-red-700">${vkEsc(d.fel)}</span>`);

  const bild = d.bild
    ? `<img src="${d.bild}" alt="Ärendets bild" onclick="isvVisaBild('${a.id}')"
            class="w-56 max-h-40 object-contain border border-ads-border rounded cursor-zoom-in bg-ads-gray shrink-0" title="Klicka för större bild" />`
    : d.bildLaddar ? '<div class="w-56 h-32 shrink-0 flex items-center justify-center text-ads-muted border border-ads-border rounded">Läser bilden…</div>'
    : '<div class="w-56 h-32 shrink-0 flex items-center justify-center text-ads-muted border border-dashed border-ads-border rounded">Ingen bild</div>';

  const kommentarer = d.kommentarer.length ? d.kommentarer.map(k => `
      <div class="py-1.5 border-t border-ads-border/60 first:border-t-0">
        <div class="text-[11px] text-ads-muted"><span class="font-medium text-ads-text">${vkEsc(k.av)}</span> · ${vkEsc(k.tid)}</div>
        <div class="whitespace-pre-wrap break-words">${vkEsc(k.text)}</div>
      </div>`).join('')
    : '<div class="text-ads-muted italic">Inga kommentarer.</div>';

  return ram(`
    ${bild}
    <div class="min-w-0 flex-1 basis-0">
      <div class="text-[11px] font-semibold uppercase tracking-wider text-ads-muted mb-1">Beskrivning</div>
      <div class="whitespace-pre-wrap break-words max-h-32 overflow-y-auto">${d.beskrivning ? vkEsc(d.beskrivning) : '<span class="text-ads-muted italic">Ingen beskrivning.</span>'}</div>
    </div>
    <div class="min-w-0 flex-1 basis-0">
      <div class="text-[11px] font-semibold uppercase tracking-wider text-ads-muted mb-1">Kommentarer (${d.kommentarer.length})</div>
      <div class="max-h-40 overflow-y-auto pr-1">${kommentarer}</div>
    </div>`);
}

async function isvLasDetaljer(a) {
  const d = { laddar: true, beskrivning: '', bild: null, bildLaddar: false, kommentarer: [], fel: null };
  _isv.detaljer.set(a.id, d);
  try {
    const bas = `/construction/issues/v1/projects/${a.accId}/issues/${a.id}`;
    const [ra, kommentarer] = await Promise.all([
      bhMedOmforsok(() => apsGet(bas)),
      isvLasKommentarer(bas),
    ]);
    const reg = _is.projekt.get(a.projektId)?.namnRegister;
    d.beskrivning = ra.description || '';
    d.kommentarer = kommentarer.map(k => ({
      av:   reg?.get(k.createdBy)?.namn || k.createdBy || '',
      tid:  (k.createdAt || '').slice(0, 16).replace('T', ' '),
      text: k.body || '',
    }));
    d.laddar = false;
    if (ra.snapshotUrn) {
      d.bildLaddar = true;
      isvLasBild(ra.snapshotUrn).then(url => { d.bild = url; }, () => {}).finally(() => { d.bildLaddar = false; isvRitaDetaljrad(); });
    }
  } catch (err) {
    d.laddar = false;
    d.fel = `Kunde inte läsa ärendet: ${String(err.message || err).slice(0, 160)}`;
  }
  isvRitaDetaljrad();
}

// Alla kommentarer, äldst först.
async function isvLasKommentarer(bas) {
  const ut = [];
  for (let offset = 0; ; offset += 100) {
    const res = await bhMedOmforsok(() => apsGet(`${bas}/comments?sortBy=createdAt&limit=100&offset=${offset}`));
    ut.push(...(res.results || []));
    if (offset + 100 >= (res.pagination?.totalResults ?? 0) || !(res.results || []).length) return ut;
  }
}

// Bilden ligger i Autodesks lagring (OSS). En signerad adress ger filen utan inloggning.
async function isvLasBild(snapshotUrn) {
  const m = String(snapshotUrn).match(/os\.object:([^/]+)\/(.+)$/);
  if (!m) throw new Error('Okänd bildadress');
  const sig = await bhMedOmforsok(() => apsGet(`/oss/v2/buckets/${m[1]}/objects/${encodeURIComponent(m[2])}/signeds3download`));
  const svar = await fetch(sig.url);
  if (!svar.ok) throw new Error(`Bilden svarade ${svar.status}`);
  return URL.createObjectURL(await svar.blob());
}

function isvFallIhop() {
  _isv.hopfallt = _isv.aktiv?.id || null;
  isvRitaDetaljrad();
}

// Bilden i full storlek ovanpå sidan. Klick eller Esc stänger.
function isvVisaBild(id) {
  const url = _isv.detaljer.get(id)?.bild;
  if (!url) return;
  const ruta = document.createElement('div');
  ruta.className = 'fixed inset-0 z-[100] bg-black/80 flex items-center justify-center cursor-zoom-out p-6';
  ruta.innerHTML = `<img src="${url}" alt="Ärendets bild" class="max-w-full max-h-full object-contain shadow-2xl" />`;
  const stang = () => { ruta.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); stang(); } };
  ruta.addEventListener('click', stang);
  document.addEventListener('keydown', esc, true);
  document.body.appendChild(ruta);
}

// ── Välja ärende ──────────────────────────────────────────────────────────────

// Klasser och attribut som raderna får när modellen visas.
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
  // Ett nytt ärende öppnas alltid; klick på det valda öppnar det igen om det stängts.
  _isv.hopfallt = null;
  _isv.aktiv = { id: a.id, nr: a.nr, rubrik: a.rubrik, projekt: a.projekt, accId: a.accId, projektId: a.projektId };
  _isv.lank  = _isv.arenden.get(a.id) || null;
  _isv.status = '';
  _isv.fel = false;
  if (a.projektId !== isvProjektId()) {
    // Ärendet hör till ett annat projekt: visa det projektets modell.
    _isv.projektId = a.projektId;
    isfVisaProjekt(a.projektId);
  }
  isvRitaRad();
  isfGaTillArende(_isv.aktiv, _isv.lank);
}

// Föregående/Nästa och piltangenterna: bara ärenden som kan visas i modellen.
function isvSteg(riktning) {
  const rader = [...document.querySelectorAll('tr[data-isv]')].filter(tr => !tr.dataset.isvLage);
  if (!rader.length) return;
  const nu = rader.findIndex(tr => tr.dataset.isv === _isv.aktiv?.id);
  const nasta = rader[nu < 0 ? (riktning > 0 ? 0 : rader.length - 1) : Math.min(rader.length - 1, Math.max(0, nu + riktning))];
  if (!nasta || nasta.dataset.isv === _isv.aktiv?.id) return;
  nasta.scrollIntoView({ block: 'nearest' });
  isvVisa(isAllaArenden().find(x => x.id === nasta.dataset.isv));
}

document.addEventListener('keydown', e => {
  if (!isvVisas() || _is.dialog || ilmArOppen() || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if (e.target.closest?.('input, select, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
  isvSteg(e.key === 'ArrowDown' ? 1 : -1);
});

function isvStang() {
  isfStang();
  _isv.ruta = null;
  _isv.aktiv = null;
  _isv.lank = null;
  _isv.status = '';
  _isv.fel = false;
}
