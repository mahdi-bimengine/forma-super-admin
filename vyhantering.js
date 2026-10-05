// vyhantering.js — fliken Vyhantering.
//
// Visar vilka vyer i ett model set som innehåller de modeller man väljer, så att
// man efter att en ny modell lagts till kan se vilka vyer som saknar den.
// Del 1 läser bara. Del 2 lägger till och tar bort modeller i flera vyer på en gång.
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
  modeller:   [],      // { itemId, namn, ext }
  vyer:       [],      // { viewId, namn, privat, ingar: Set, laddade: Set, okanda }
  valda:      new Set(), // itemId för de modeller som granskas
  sok:        '',
  filter:     'alla',  // alla | saknar | har
};

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
  _vh.valda    = new Set();
  _vh.sok      = '';
  _vh.filter   = 'alla';
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
      .map(d => ({ itemId: d.itemId, namn: d.namn, ext: vkFilandelse(d.namn) }))
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
  // Behåll valda modeller när samma set läses om.
  const valda = _vh.valda;
  vhValjSet(_vh.setId).then(() => {
    _vh.valda = new Set([...valda].filter(id => _vh.modeller.some(m => m.itemId === id)));
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

  const harAlla = vy => kolumner.every(m => vy.ingar.has(m.itemId));
  const antalSaknar = _vh.vyer.filter(vy => !harAlla(vy)).length;
  const synliga = _vh.vyer.filter(vy =>
    _vh.filter === 'saknar' ? !harAlla(vy) : _vh.filter === 'har' ? harAlla(vy) : true);

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
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      ${knapp('alla', `Alla vyer (${_vh.vyer.length})`)}
      ${knapp('saknar', `Saknar någon vald modell (${antalSaknar})`)}
      ${knapp('har', `Har alla valda (${_vh.vyer.length - antalSaknar})`)}
    </div>
    <div class="bg-white border border-ads-border rounded overflow-auto">
      <table class="w-full text-sm">
        <thead class="bg-ads-gray text-ads-muted text-xs">
          <tr>
            <th class="text-left font-medium px-3 py-2 sticky left-0 bg-ads-gray">Vy</th>
            ${kolumner.map(m => `<th class="font-medium px-3 py-2 max-w-40 truncate" title="${vkEsc(m.namn)}">${vkEsc(m.namn)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${synliga.map(vy => `
            <tr class="border-t border-ads-border">
              <td class="px-3 py-2 sticky left-0 bg-white">
                <span class="text-ads-text">${vkEsc(vy.namn)}</span>
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
