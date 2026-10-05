// vyhantering.js — fliken Vyhantering.
//
// Visar vilka vyer i ett model set som innehåller de modeller man väljer, så att
// man efter att en ny modell lagts till kan se vilka vyer som saknar den.
// Man kan också kryssa i vyer och lägga till eller ta bort de valda modellerna
// i alla på en gång. Ändringen visas först och skrivs till ACC efter bekräftelse.
//
// Läsningen av model set-versioner och vyer delas med Veckokontroll
// (vkGrupperaDokument, vkUtanViewable, vkSenasteSetVersion, vkEsc).

const _vh = {
  setLista:   null,    // model set i projektet
  setFel:     null,
  setId:      null,    // valt model set
  laddar:     false,
  fel:        null,
  version:    null,    // senaste model set-versionen
  modeller:   [],      // { itemId, namn, ext, viewables }
  vyer:       [],      // { viewId, namn, privat, definition, ingar: Set, laddade: Set, okanda }
  valda:      new Set(), // itemId för de modeller som granskas
  markerade:  new Set(), // viewId för de vyer som ska ändras
  sok:        '',
  filter:     'alla',  // alla | saknar | har
  plan:       null,    // ändringen som väntar på bekräftelse
  kor:        null,    // { klar, rader: [{ namn, status, fel }] } under och efter sparandet
};

const VH_MAX_MODELLER = 50;   // Model Coordination tar högst 50 poster per vy

function vhReset() {
  _vh.setLista = null;
  _vh.setFel   = null;
  _vh.setId    = null;
  vhNollstallSet();
}

function vhNollstallSet() {
  _vh.laddar   = false;
  _vh.fel      = null;
  _vh.version  = null;
  _vh.modeller = [];
  _vh.vyer     = [];
  _vh.valda     = new Set();
  _vh.markerade = new Set();
  _vh.sok       = '';
  _vh.filter    = 'alla';
  _vh.plan      = null;
  _vh.kor       = null;
}

function vhOppnaFlik() {
  renderVyhantering();
  if (!_vh.setLista && !_vh.setFel) vhLaddaSetLista();
}

// ── Läsning ───────────────────────────────────────────────────────────────────

async function vhLaddaSetLista() {
  _vh.setFel = null;
  vhRita();
  try {
    const lista = await listModelSets(_currentProject.id);
    _vh.setLista = lista
      .map(s => ({ id: s.id, namn: s.name || '(namnlöst model set)' }))
      .sort((a, b) => a.namn.localeCompare(b.namn, 'sv'));
    if (_vh.setLista.length === 1) return vhValjSet(_vh.setLista[0].id);
  } catch (err) {
    _vh.setFel = err.message;
  }
  vhRita();
}

async function vhValjSet(setId) {
  vhNollstallSet();
  _vh.setId = setId || null;
  if (!_vh.setId) return vhRita();

  _vh.laddar = true;
  vhRita();

  const projektId = _currentProject.id;
  try {
    const versioner = await getModelSetVersions(projektId, setId);
    if (!versioner.length) throw new Error('Model settet har ingen version ännu.');

    const senaste = vkSenasteSetVersion(versioner);
    const nr      = senaste.version ?? senaste.id;
    const [detalj, definitioner, innehall] = await Promise.all([
      getModelSetVersion(projektId, setId, nr),
      listModelSetViews(projektId, setId),
      listModelSetViewVersions(projektId, setId, nr),
    ]);
    if (_vh.setId !== setId) return;   // användaren hann byta set

    _vh.version  = detalj.version ?? nr;
    _vh.modeller = vkGrupperaDokument(detalj.documentVersions || [])
      // viewables är de 3D-vyer ur filen som model settet använder. Samma
      // läggs in när modellen läggs till i en vy.
      .map(d => ({ itemId: d.itemId, namn: d.namn, ext: vkFilandelse(d.namn), viewables: [...new Set(d.vyer)] }))
      .sort((a, b) => a.namn.localeCompare(b.namn, 'sv'));

    const kanda   = new Set(_vh.modeller.map(m => m.itemId));
    const perVy   = new Map(innehall.map(v => [v.viewId, v]));

    _vh.vyer = definitioner.map(def => {
      // Vad vyn är inställd att innehålla, och vad som faktiskt kom med i
      // den senaste versionen. En Revitfil kan stå flera gånger, en per 3D-vy.
      const ingar   = new Set((def.definition || []).map(d => vkUtanViewable(d.lineageUrn)).filter(Boolean));
      const laddade = new Set(vkGrupperaDokument(perVy.get(def.viewId)?.documentVersions || []).map(d => d.itemId));
      return {
        viewId:  def.viewId,
        namn:    def.name || '(namnlös vy)',
        privat:  !!def.isPrivate,
        definition: (def.definition || []).map(d => ({ lineageUrn: d.lineageUrn, viewableName: d.viewableName })),
        ingar,
        laddade,
        okanda:  [...ingar].filter(id => !kanda.has(id)).length,
      };
    }).sort((a, b) => a.namn.localeCompare(b.namn, 'sv'));
  } catch (err) {
    if (_vh.setId !== setId) return;
    _vh.fel = err.message;
  }
  _vh.laddar = false;
  vhRita();
}

// ── Val ───────────────────────────────────────────────────────────────────────

function vhLasOm() {
  // Behåll valda modeller, markerade vyer, filter och resultatet av senaste
  // sparandet när samma set läses om.
  const { valda, markerade, kor, filter } = _vh;
  return vhValjSet(_vh.setId).then(() => {
    _vh.valda     = new Set([...valda].filter(id => _vh.modeller.some(m => m.itemId === id)));
    _vh.markerade = new Set([...markerade].filter(id => _vh.vyer.some(v => v.viewId === id)));
    _vh.kor       = kor;
    _vh.filter    = filter;
    vhRita();
  });
}

function vhToggleModell(i) {
  const m = _vh.modeller[i];
  if (!m) return;
  if (_vh.valda.has(m.itemId)) _vh.valda.delete(m.itemId);
  else _vh.valda.add(m.itemId);
  vhRita();
}

function vhRensaVal() {
  _vh.valda = new Set();
  _vh.plan  = null;
  vhRita();
}

function vhToggleVy(i) {
  const vy = _vh.vyer[i];
  if (!vy) return;
  if (_vh.markerade.has(vy.viewId)) _vh.markerade.delete(vy.viewId);
  else _vh.markerade.add(vy.viewId);
  _vh.plan = null;
  vhRita();
}

// Kryssar i eller ur alla vyer som syns med nuvarande filter.
function vhToggleAllaVyer() {
  const synliga = vhSynligaVyer();
  const alla    = synliga.length && synliga.every(vy => _vh.markerade.has(vy.viewId));
  synliga.forEach(vy => alla ? _vh.markerade.delete(vy.viewId) : _vh.markerade.add(vy.viewId));
  _vh.plan = null;
  vhRita();
}

// ── Ändra vyerna ──────────────────────────────────────────────────────────────
// Planen räknas fram per vy innan något skrivs: vad som läggs till eller tas
// bort, vilka vyer som redan är rätt och vilka som inte går att ändra.

function vhForbered(typ) {
  const modeller = _vh.modeller.filter(m => _vh.valda.has(m.itemId));
  const vyer     = _vh.vyer.filter(vy => _vh.markerade.has(vy.viewId));

  const rader = vyer.map(vy => {
    const berorda = modeller.filter(m => typ === 'lagg' ? !vy.ingar.has(m.itemId) : vy.ingar.has(m.itemId));
    const rad = { viewId: vy.viewId, namn: vy.namn, modeller: berorda.map(m => m.namn), hinder: null, ny: null };

    if (!berorda.length) return { ...rad, hinder: typ === 'lagg' ? 'Har redan modellerna' : 'Har inte modellerna' };

    if (typ === 'lagg') {
      const utan = berorda.filter(m => !m.viewables.length);
      if (utan.length) return { ...rad, hinder: `Vet inte vilken 3D-vy som ska användas för ${utan.map(m => m.namn).join(', ')}` };
      const ny = [...vy.definition, ...berorda.flatMap(m => m.viewables.map(v => ({ lineageUrn: m.itemId, viewableName: v })))];
      if (ny.length > VH_MAX_MODELLER) return { ...rad, hinder: `Vyn skulle få fler än ${VH_MAX_MODELLER} poster` };
      return { ...rad, ny };
    }

    const bort = new Set(berorda.map(m => m.itemId));
    const ny   = vy.definition.filter(d => !bort.has(vkUtanViewable(d.lineageUrn)));
    if (!ny.length) return { ...rad, hinder: 'Vyn kan inte bli tom' };
    return { ...rad, ny };
  });

  _vh.plan = { typ, rader };
  _vh.kor  = null;
  vhRita();
}

function vhFelText(text) {
  if (/APS error 403/.test(text))     return 'Du har inte behörighet att ändra vyn. En privat vy kan bara ändras av den som skapade den.';
  if (/APS error (409|412)/.test(text)) return 'Vyn har ändrats av någon annan under tiden. Läs om och försök igen.';
  return text;
}

function vhAvbryt() {
  _vh.plan = null;
  vhRita();
}

function vhStangResultat() {
  _vh.kor = null;
  vhRita();
}

async function vhSpara() {
  const plan = _vh.plan;
  if (!plan || (_vh.kor && !_vh.kor.klar)) return;
  const attGora = plan.rader.filter(r => r.ny);
  if (!attGora.length) return;

  _vh.kor  = { klar: false, rader: attGora.map(r => ({ namn: r.namn, status: 'vantar', fel: null })) };
  _vh.plan = null;
  vhRita();

  // En vy i taget, så att ett fel i en vy syns för just den och inte stoppar de andra.
  for (let i = 0; i < attGora.length; i++) {
    const r  = attGora[i];
    const vy = _vh.vyer.find(v => v.viewId === r.viewId);
    _vh.kor.rader[i].status = 'pagar';
    vhRita();
    try {
      await updateModelSetViewDefinition(_currentProject.id, _vh.setId, r.viewId, vy.definition, r.ny);
      _vh.kor.rader[i].status = 'klar';
    } catch (err) {
      _vh.kor.rader[i].status = 'fel';
      _vh.kor.rader[i].fel    = vhFelText(err.message);
    }
    vhRita();
  }

  // Läs om från Model Coordination och kontrollera att varje vy blev som tänkt.
  const nyckel = d => `${vkUtanViewable(d.lineageUrn)}|${d.viewableName || ''}`;
  const kor    = _vh.kor;
  await vhLasOm();
  attGora.forEach((r, i) => {
    const rad = kor.rader[i];
    if (rad.status !== 'klar') return;
    const vy  = _vh.vyer.find(v => v.viewId === r.viewId);
    const ar  = new Set((vy?.definition || []).map(nyckel));
    const bor = new Set(r.ny.map(nyckel));
    if (!vy || ar.size !== bor.size || [...bor].some(x => !ar.has(x))) {
      rad.status = 'fel';
      rad.fel    = 'Sparades, men vyn ser inte ut som väntat när den lästes om.';
    }
  });
  kor.klar = true;
  _vh.kor  = kor;
  vhRita();
}

function vhSok(text) {
  _vh.sok = text;
  const el = document.getElementById('vh-modellista');
  if (el) el.innerHTML = vhRenderModellrader();
}

function vhSattFilter(f) {
  _vh.filter = f;
  vhRita();
}

// ── Ritning ───────────────────────────────────────────────────────────────────

function vhRita() {
  const el = document.getElementById('vh-innehall');
  if (el) el.innerHTML = vhKropp();
}

function renderVyhantering() {
  document.getElementById('main-content').innerHTML = `
    <div class="max-w-6xl mx-auto px-6 py-8">
      <div class="mb-6">
        <h2 class="text-lg font-semibold text-ads-text">Vyhantering</h2>
        <p class="text-ads-muted text-sm mt-0.5">
          Välj en eller flera modeller och se vilka vyer i Model Coordination som innehåller dem.
        </p>
      </div>
      <div id="vh-innehall">${vhKropp()}</div>
    </div>`;
}

function vhKropp() {
  if (_vh.setFel) {
    return `
      <div class="bg-white border border-ads-border rounded p-6">
        <p class="text-sm text-red-600 mb-3">Kunde inte läsa model set: ${vkEsc(_vh.setFel)}</p>
        <button onclick="vhLaddaSetLista()"
                class="text-sm border border-ads-border rounded px-3 py-1.5 hover:border-ads-blue text-ads-text">
          Försök igen
        </button>
      </div>`;
  }
  if (!_vh.setLista) return vkLaddarKort('Läser model set…');
  if (!_vh.setLista.length) {
    return `<div class="bg-white border border-ads-border rounded p-6 text-sm text-ads-muted">
      Projektet har inga model set i Model Coordination.</div>`;
  }

  return `
    <div class="bg-white border border-ads-border rounded p-4 mb-4 flex items-center gap-3 flex-wrap">
      <label for="vh-set" class="text-sm font-medium text-ads-text">Model set</label>
      <select id="vh-set" onchange="vhValjSet(this.value)"
              class="border border-ads-border rounded px-2.5 py-1.5 text-sm bg-white min-w-64
                     focus:outline-none focus:ring-1 focus:ring-ads-blue">
        <option value="">Välj model set…</option>
        ${_vh.setLista.map(s => `<option value="${vkEsc(s.id)}" ${s.id === _vh.setId ? 'selected' : ''}>${vkEsc(s.namn)}</option>`).join('')}
      </select>
      ${_vh.version != null ? `<span class="text-xs text-ads-muted">Version ${vkEsc(_vh.version)},
        ${_vh.modeller.length} modeller, ${_vh.vyer.length} vyer</span>` : ''}
      ${_vh.setId && !_vh.laddar ? `<button onclick="vhLasOm()"
        class="ml-auto text-sm text-ads-muted hover:text-ads-text">Läs om</button>` : ''}
    </div>
    ${vhSetInnehall()}`;
}

function vhSetInnehall() {
  if (!_vh.setId)  return '';
  if (_vh.laddar)  return vkLaddarKort('Läser modeller och vyer…');
  if (_vh.fel) {
    return `<div class="bg-white border border-ads-border rounded p-6 text-sm text-red-600">
      Kunde inte läsa model settet: ${vkEsc(_vh.fel)}</div>`;
  }

  return `
    <div class="grid gap-4" style="grid-template-columns: minmax(240px, 300px) 1fr">
      <div class="bg-white border border-ads-border rounded p-3 self-start">
        <div class="flex items-center justify-between mb-2">
          <p class="text-sm font-medium text-ads-text">Modeller</p>
          ${_vh.valda.size ? `<button onclick="vhRensaVal()" class="text-xs text-ads-muted hover:text-ads-text">Rensa val</button>` : ''}
        </div>
        <input value="${vkEsc(_vh.sok)}" oninput="vhSok(this.value)" placeholder="Sök modell"
               class="w-full border border-ads-border rounded px-2.5 py-1.5 text-sm mb-2
                      focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
        <div id="vh-modellista" class="max-h-[60vh] overflow-auto">${vhRenderModellrader()}</div>
      </div>
      <div class="min-w-0">${vhRenderTabell()}</div>
    </div>`;
}

function vhRenderModellrader() {
  const sok   = _vh.sok.trim().toLowerCase();
  const rader = _vh.modeller
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !sok || m.namn.toLowerCase().includes(sok));

  if (!rader.length) return `<p class="text-xs text-ads-muted italic py-1">Inga modeller matchar.</p>`;

  return rader.map(({ m, i }) => {
    const vald = _vh.valda.has(m.itemId);
    return `
      <label class="flex items-center gap-2 py-1 px-1 rounded hover:bg-ads-gray cursor-pointer">
        <input type="checkbox" ${vald ? 'checked' : ''} onchange="vhToggleModell(${i})"
               class="w-3.5 h-3.5 accent-ads-blue shrink-0"/>
        <span class="text-sm truncate ${vald ? 'text-ads-blue font-medium' : 'text-ads-text'}" title="${vkEsc(m.namn)}">${vkEsc(m.namn)}</span>
      </label>`;
  }).join('');
}

function vhHarAlla(vy) {
  return [..._vh.valda].every(id => vy.ingar.has(id));
}

function vhSynligaVyer() {
  return _vh.vyer.filter(vy =>
    _vh.filter === 'saknar' ? !vhHarAlla(vy) : _vh.filter === 'har' ? vhHarAlla(vy) : true);
}

function vhRenderTabell() {
  if (!_vh.vyer.length) {
    return `<div class="bg-white border border-ads-border rounded p-6 text-sm text-ads-muted">
      Model settet har inga sparade vyer.</div>`;
  }
  const kolumner = _vh.modeller.filter(m => _vh.valda.has(m.itemId));
  if (!kolumner.length) {
    return `<div class="bg-white border border-ads-border rounded p-6 text-sm text-ads-muted">
      Välj en eller flera modeller till vänster för att se vilka vyer som innehåller dem.</div>`;
  }

  const antalSaknar   = _vh.vyer.filter(vy => !vhHarAlla(vy)).length;
  const synliga       = vhSynligaVyer();
  const allaMarkerade = synliga.length && synliga.every(vy => _vh.markerade.has(vy.viewId));

  const knapp = (f, text) => `
    <button onclick="vhSattFilter('${f}')"
            class="px-3 py-1 rounded-full text-xs font-medium border transition-colors
                   ${_vh.filter === f ? 'bg-ads-blue border-ads-blue text-white'
                     : 'bg-white border-ads-border text-ads-muted hover:border-ads-blue hover:text-ads-blue'}">${text}</button>`;

  const cell = (vy, m) => {
    if (!vy.ingar.has(m.itemId)) {
      return `<td class="px-3 py-2 text-center"><span class="text-red-500 font-semibold" title="Saknas i vyn">✕</span></td>`;
    }
    if (!vy.laddade.has(m.itemId)) {
      return `<td class="px-3 py-2 text-center"><span class="text-amber-500 font-semibold"
        title="Ingår i vyn men kom inte med i senaste model set-versionen">!</span></td>`;
    }
    return `<td class="px-3 py-2 text-center"><span class="text-emerald-600 font-semibold" title="Ingår i vyn">✓</span></td>`;
  };

  return `
    ${vhRenderAtgard()}
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      ${knapp('alla', `Alla vyer (${_vh.vyer.length})`)}
      ${knapp('saknar', `Saknar någon vald modell (${antalSaknar})`)}
      ${knapp('har', `Har alla valda (${_vh.vyer.length - antalSaknar})`)}
    </div>
    <div class="bg-white border border-ads-border rounded overflow-auto">
      <table class="w-full text-sm">
        <thead class="bg-ads-gray text-ads-muted text-xs">
          <tr>
            <th class="text-left font-medium px-3 py-2 sticky left-0 bg-ads-gray">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" ${allaMarkerade ? 'checked' : ''} onchange="vhToggleAllaVyer()"
                       title="Markera alla vyer som syns" class="w-3.5 h-3.5 accent-ads-blue"/>
                Vy
              </label>
            </th>
            ${kolumner.map(m => `<th class="font-medium px-3 py-2 max-w-40 truncate" title="${vkEsc(m.namn)}">${vkEsc(m.namn)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${synliga.map(vy => `
            <tr class="border-t border-ads-border">
              <td class="px-3 py-2 sticky left-0 bg-white">
                <label class="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" ${_vh.markerade.has(vy.viewId) ? 'checked' : ''}
                         onchange="vhToggleVy(${_vh.vyer.indexOf(vy)})" class="w-3.5 h-3.5 accent-ads-blue shrink-0"/>
                  <span class="text-ads-text">${vkEsc(vy.namn)}</span>
                </label>
                ${vy.privat ? `<span class="ml-1 text-[10px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">Privat</span>` : ''}
                ${vy.okanda ? `<span class="ml-1 text-[10px] text-ads-muted"
                  title="Vyn pekar på modeller som inte finns i senaste model set-versionen">+${vy.okanda} okända</span>` : ''}
              </td>
              ${kolumner.map(m => cell(vy, m)).join('')}
            </tr>`).join('')}
          ${!synliga.length ? `<tr><td colspan="${kolumner.length + 1}" class="px-3 py-4 text-ads-muted text-center">Inga vyer i det här urvalet.</td></tr>` : ''}
        </tbody>
      </table>
    </div>
    <p class="text-[11px] text-ads-muted mt-2">
      ✓ ingår i vyn &nbsp; ✕ saknas &nbsp; <span class="text-amber-500 font-semibold">!</span> ingår men kom inte med i senaste versionen
    </p>`;
}

// ── Åtgärdsfältet ─────────────────────────────────────────────────────────────

function vhRenderAtgard() {
  if (_vh.kor)  return vhRenderKor();
  if (_vh.plan) return vhRenderPlan();

  const antal = _vh.markerade.size;
  const knapp = (typ, text) => `
    <button onclick="vhForbered('${typ}')" ${antal ? '' : 'disabled'}
            class="text-sm rounded px-3 py-1.5 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                   ${typ === 'lagg' ? 'bg-ads-blue border-ads-blue text-white hover:bg-ads-blue-dark'
                     : 'bg-white border-ads-border text-ads-text hover:border-red-300 hover:text-red-600'}">${text}</button>`;

  return `
    <div class="bg-white border border-ads-border rounded p-3 mb-3 flex items-center gap-3 flex-wrap">
      <span class="text-sm text-ads-muted">
        ${antal ? `${antal} vy${antal === 1 ? '' : 'er'} markerad${antal === 1 ? '' : 'e'}` : 'Kryssa i de vyer du vill ändra'}
      </span>
      <div class="ml-auto flex items-center gap-2">
        ${knapp('lagg', 'Lägg till valda modeller')}
        ${knapp('ta', 'Ta bort valda modeller')}
      </div>
    </div>`;
}

function vhRenderPlan() {
  const { typ, rader } = _vh.plan;
  const andras = rader.filter(r => r.ny);
  const ovriga = rader.filter(r => !r.ny);
  const verb   = typ === 'lagg' ? 'läggs till' : 'tas bort';

  return `
    <div class="bg-white border border-ads-blue rounded p-4 mb-3">
      <p class="text-sm font-medium text-ads-text mb-2">
        ${typ === 'lagg' ? 'Lägga till modeller i' : 'Ta bort modeller från'} ${andras.length} vy${andras.length === 1 ? '' : 'er'}
      </p>
      ${andras.length ? `
        <ul class="text-sm mb-3 space-y-1">
          ${andras.map(r => `<li><span class="font-medium">${vkEsc(r.namn)}</span>
            <span class="text-ads-muted">– ${verb}: ${r.modeller.map(vkEsc).join(', ')}</span></li>`).join('')}
        </ul>` : `<p class="text-sm text-ads-muted mb-3">Ingen av de markerade vyerna behöver ändras.</p>`}
      ${ovriga.length ? `
        <p class="text-xs text-ads-muted mb-1">Ändras inte:</p>
        <ul class="text-xs text-ads-muted mb-3 space-y-0.5">
          ${ovriga.map(r => `<li>${vkEsc(r.namn)} – ${vkEsc(r.hinder)}</li>`).join('')}
        </ul>` : ''}
      <p class="text-xs text-ads-muted mb-3">Ändringen görs i ditt namn och syns direkt för alla i projektet.</p>
      <div class="flex items-center gap-2">
        ${andras.length ? `<button onclick="vhSpara()"
          class="bg-ads-blue text-white text-sm font-medium rounded px-4 py-1.5 hover:bg-ads-blue-dark">Bekräfta och spara</button>` : ''}
        <button onclick="vhAvbryt()"
          class="text-sm border border-ads-border rounded px-3 py-1.5 hover:border-ads-blue text-ads-text">Avbryt</button>
      </div>
    </div>`;
}

function vhRenderKor() {
  const { klar, rader } = _vh.kor;
  const ikon = {
    vantar: '<span class="text-ads-muted">·</span>',
    pagar:  '<span class="text-ads-blue">…</span>',
    klar:   '<span class="text-emerald-600 font-semibold">✓</span>',
    fel:    '<span class="text-red-500 font-semibold">✕</span>',
  };
  const fel = rader.filter(r => r.status === 'fel').length;
  const n   = rader.length;
  const rubrik = !klar ? 'Sparar…'
    : fel ? `${fel} av ${n} vy${n === 1 ? '' : 'er'} kunde inte ändras`
    : `Klart. ${n} vy${n === 1 ? '' : 'er'} ändrad${n === 1 ? '' : 'e'} och kontrollerad${n === 1 ? '' : 'e'}.`;

  return `
    <div class="bg-white border border-ads-border rounded p-4 mb-3">
      <p class="text-sm font-medium mb-2 ${klar && fel ? 'text-red-600' : 'text-ads-text'}">${rubrik}</p>
      <ul class="text-sm space-y-1">
        ${rader.map(r => `<li class="flex gap-2">${ikon[r.status]}<span>${vkEsc(r.namn)}
          ${r.fel ? `<span class="text-xs text-red-600 block">${vkEsc(r.fel)}</span>` : ''}</span></li>`).join('')}
      </ul>
      ${klar ? `<button onclick="vhStangResultat()"
        class="mt-3 text-sm border border-ads-border rounded px-3 py-1.5 hover:border-ads-blue text-ads-text">Stäng</button>` : ''}
    </div>`;
}
