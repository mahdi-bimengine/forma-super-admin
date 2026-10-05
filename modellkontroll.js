// ── State ─────────────────────────────────────────────────────────────────────

const _mk = {
  step:          1,
  refFile:       null,      // {name, itemId}
  refRaw:        null,      // ArrayBuffer of the shared parameter file as loaded
  refWarnings:   [],
  refParams:     [],        // {name, guid, valueType, group, comment, paramType, selected}[]
  pk:            null,      // ACC file picker state
  fileSource:    'dm',      // 'dm' | 'mc'
  folderState:   {},        // folderId → {items, expanded, loaded, loading}
  itemsById:     {},        // id → item (DM + MC)
  fids:          [],        // numeric index → id (onclick safety)
  filter:        null,      // null | 'rvt' | 'ifc' | 'dwg' | 'nwd'
  search:        '',
  selectedFiles: [],        // {itemId, name, ext, projectId, source}[]
  modelSets:     null,      // Model Coordination model sets
  mcExpanded:    {},        // modelSetId → bool
  results:       [],        // per-model check results
  expanded:      new Set(), // expanded result indices
  paramSearch:   '',        // Step 1 parameter search
  running:       false,
  viewer:        null,
  githubToken:    sessionStorage.getItem('mk_github_token') || null,
  mkClientId:     sessionStorage.getItem('mk_aps_client_id') || null,
  mkClientSecret: sessionStorage.getItem('mk_aps_client_secret') || null,
  mkApsToken:     null,
  mkApsTokenExp:  0,
  _apsCredCallback: null,
};

const MK_CHECKS_PATH = 'saved-checks.json';

// ── Conformity helpers ────────────────────────────────────────────────────────

// A wrong data type means the model holds another parameter under the same name,
// so its values say nothing about the required one; that outranks missing values.
function mkConformityLevel(exists, hasValue, typeMatch) {
  if (!exists)             return 'grey';
  if (typeMatch === false) return 'yellow';
  if (!hasValue)           return 'orange';
  return 'green';
}

function mkOverallLevel(paramResults) {
  const order = { grey: 0, orange: 1, yellow: 2, green: 3 };
  return paramResults.reduce((worst, p) =>
    order[p.level] < order[worst] ? p.level : worst, 'green');
}

// ── Data type helpers ─────────────────────────────────────────────────────────
// The model's property catalogue (see getModelPropertyFields) reports String,
// Boolean, Integer or Double plus a unit. Checked against the sample models:
// TEXT → String, YESNO → Boolean, INTEGER → Integer, NUMBER → Double without
// unit, LENGTH → Double in mm, AREA → Double in m².

const MK_UNIT_SHORT = {
  millimeters: 'mm', centimeters: 'cm', meters: 'm', feet: 'ft', inches: 'in',
  squareMeters: 'm²', squareFeet: 'ft²', cubicMeters: 'm³', cubicFeet: 'ft³',
  liters: 'l', degrees: '°', degreesCelsius: '°C',
};

function mkExpectedType(dataType) {
  const t = String(dataType || '').toUpperCase();
  if (['TEXT', 'MULTILINETEXT', 'URL'].includes(t)) return { type: 'String' };
  if (t === 'YESNO')   return { type: 'Boolean' };
  if (t === 'INTEGER') return { type: 'Integer' };
  if (t === 'NUMBER')  return { type: 'Double', unit: null };
  if (t === 'LENGTH')  return { type: 'Double', unit: 'length' };
  if (t === 'AREA')    return { type: 'Double', unit: 'area' };
  if (t === 'VOLUME')  return { type: 'Double', unit: 'volume' };
  if (t === 'ANGLE')   return { type: 'Double', unit: 'angle' };
  return null; // material, family type and discipline types are not checked
}

function mkUnitName(uom) {
  return String(uom || '').split(':').pop().split('-')[0];
}

function mkUnitKind(uom) {
  const u = mkUnitName(uom).toLowerCase();
  if (!u) return null;
  if (/celsius|fahrenheit|kelvin|rankine/.test(u)) return 'temperature';
  if (/^square|acres|hectares/.test(u))            return 'area';
  if (/^cubic|liters|gallons/.test(u))             return 'volume';
  if (/degrees|radians|gradians/.test(u))          return 'angle';
  if (/meters|feet|inches/.test(u))                return 'length';
  return 'other';
}

// Describes a catalogue field in the shared parameter file's own vocabulary.
function mkDescribeField(f) {
  if (f.type === 'String')  return 'TEXT';
  if (f.type === 'Boolean') return 'YESNO';
  if (f.type === 'Integer') return 'INTEGER';
  if (f.type === 'Double') {
    const unit = MK_UNIT_SHORT[mkUnitName(f.uom)] || mkUnitName(f.uom);
    const name = { length: 'LENGTH', area: 'AREA', volume: 'VOLUME', angle: 'ANGLE' }[mkUnitKind(f.uom)] || 'NUMBER';
    return unit ? `${name} (${unit})` : name;
  }
  return f.type;
}

function mkFieldMatches(f, expected) {
  if (f.type !== expected.type) return false;
  if (expected.type !== 'Double') return true;
  return expected.unit === null ? !f.uom : mkUnitKind(f.uom) === expected.unit;
}

function mkConformityBadge(level) {
  const map    = { green: 'bg-green-100 text-green-700', yellow: 'bg-yellow-100 text-yellow-700', orange: 'bg-orange-100 text-orange-700', grey: 'bg-gray-100 text-gray-500' };
  const labels = { green: 'OK', yellow: 'Fel datatyp', orange: 'Saknar värde', grey: 'Saknar param' };
  return `<span class="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${map[level]}">${labels[level]}</span>`;
}

function mkConformityDot(level) {
  const c = { green: 'bg-green-500', yellow: 'bg-yellow-400', orange: 'bg-orange-400', grey: 'bg-gray-300' };
  return `<span class="inline-block w-2.5 h-2.5 rounded-full shrink-0 ${c[level]}"></span>`;
}

function mkExtBadge(ext) {
  const cls = { rvt: 'bg-blue-50 text-blue-600', ifc: 'bg-emerald-50 text-emerald-600', dwg: 'bg-orange-50 text-orange-600', nwd: 'bg-purple-50 text-purple-600' }[ext];
  if (!cls) return '';
  return `<span class="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls} uppercase">${ext}</span>`;
}

// ── FID helpers (onclick-safe IDs) ────────────────────────────────────────────

function mkFid(id) {
  const i = _mk.fids.indexOf(id);
  if (i !== -1) return i;
  return _mk.fids.push(id) - 1;
}

function mkFidLookup(i) { return _mk.fids[i]; }

// ── Reset (called on project switch) ─────────────────────────────────────────

function mkReset() {
  _mk.step          = 1;
  _mk.refFile       = null;
  _mk.refRaw        = null;
  _mk.refWarnings   = [];
  _mk.refParams     = [];
  _mk.fileSource    = 'dm';
  _mk.folderState   = {};
  _mk.itemsById     = {};
  _mk.fids          = [];
  _mk.filter        = null;
  _mk.search        = '';
  _mk.selectedFiles = [];
  _mk.modelSets     = null;
  _mk.mcExpanded    = {};
  _mk.results       = [];
  _mk.expanded      = new Set();
  _mk.paramSearch   = '';
  _mk.running       = false;
  if (_mk.viewer) { try { _mk.viewer.finish(); } catch {} _mk.viewer = null; }
}

// ── Navigation ────────────────────────────────────────────────────────────────

function mkNav(step) {
  if (step === 2 && !_mk.refParams.some(p => p.selected)) return;
  if (step === 3 && !_mk.selectedFiles.length) return;
  _mk.step = step;
  renderModellkontroll();
}

function mkStartCheck() {
  if (!_mk.mkClientId || !_mk.mkClientSecret) {
    mkShowApsCredentialsPrompt(() => mkStartCheck());
    return;
  }
  _mk.step    = 3;
  _mk.results = [];
  _mk.running = true;
  _mk.expanded = new Set();
  renderModellkontroll();
  mkRunCheck();
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderModellkontroll() {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `
    <div class="max-w-5xl mx-auto px-6 py-8">

      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-lg font-semibold text-ads-text">Modellkontroll</h2>
          <p class="text-ads-muted text-sm mt-0.5">Kontrollera modeller mot en Revit shared parameter-fil.</p>
        </div>
        <button onclick="mkShowSavedChecks()"
                class="text-sm border border-ads-border bg-white rounded px-3 py-1.5 hover:border-ads-blue
                       text-ads-muted hover:text-ads-text transition-colors flex items-center gap-1.5">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 15V5a2 2 0 0 1 2-2h6.586a1 1 0 0 1 .707.293l3.414 3.414A1 1 0 0 1 17 7.414V15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M7 17v-5h6v5M7 5h5"/>
          </svg>
          Sparade kontroller
        </button>
      </div>

      ${mkStepIndicator()}

      <div id="mk-step-content" class="mt-6">
        ${_mk.step === 1 ? mkRenderStep1() : ''}
        ${_mk.step === 2 ? mkRenderStep2() : ''}
        ${_mk.step === 3 ? mkRenderStep3() : ''}
      </div>
    </div>`;

  // Trigger async file-browser load after DOM is set
  setTimeout(() => {
    if (_mk.step === 2) {
      if (_mk.fileSource === 'dm') {
        if (!_mk.folderState['__top__']?.loaded && !_mk.folderState['__top__']?.loading) {
          mkLoadTopFolders();
        } else {
          mkRenderFileBrowser();
        }
      } else {
        if (!_mk.modelSets) mkLoadModelSets();
        else mkRenderMCBrowser();
      }
    }
  }, 0);
}

// ── Step indicator ────────────────────────────────────────────────────────────

function mkStepIndicator() {
  const steps = [
    { n: 1, label: 'Parameterfil' },
    { n: 2, label: 'Välj modeller' },
    { n: 3, label: 'Resultat' },
  ];
  return `
    <div class="flex items-center">
      ${steps.map((s, i) => {
        const active   = _mk.step === s.n;
        const complete = _mk.step > s.n;
        const clickable = complete;
        return `
          ${i > 0 ? `<div class="flex-1 h-px bg-ads-border mx-2"></div>` : ''}
          <button onclick="${clickable ? `mkNav(${s.n})` : ''}"
                  class="flex items-center gap-2 shrink-0 ${!clickable && !active ? 'opacity-40 cursor-default' : ''}">
            <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                        ${active ? 'bg-ads-blue text-white' : complete ? 'bg-green-500 text-white' : 'bg-ads-gray border border-ads-border text-ads-muted'}">
              ${complete ? '✓' : s.n}
            </div>
            <span class="text-sm ${active ? 'font-semibold text-ads-text' : complete ? 'text-ads-text' : 'text-ads-muted'}">${s.label}</span>
          </button>`;
      }).join('')}
    </div>`;
}

// ── Step 1: Shared parameter file ─────────────────────────────────────────────

function mkEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mkRenderStep1() {
  const hasParams = _mk.refParams.length > 0;
  const btn = 'text-xs border border-ads-border bg-white rounded px-2.5 py-1 hover:border-ads-blue hover:text-ads-blue transition-colors text-ads-text';
  const warn = _mk.refWarnings.length ? `
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 mb-4 text-xs text-yellow-800">
        <p class="font-semibold mb-1">${_mk.refWarnings.length} anmärkning${_mk.refWarnings.length === 1 ? '' : 'ar'} på filen</p>
        ${_mk.refWarnings.slice(0, 6).map(w => `<p>${mkEsc(w)}</p>`).join('')}
        ${_mk.refWarnings.length > 6 ? `<p>… och ${_mk.refWarnings.length - 6} till</p>` : ''}
      </div>` : '';
  return `
    <div>
      <div class="bg-white border-2 ${hasParams ? 'border-green-300 bg-green-50' : 'border-dashed border-ads-border'} rounded-lg p-8 text-center mb-4"
           ondragover="event.preventDefault()"
           ondrop="event.preventDefault(); if(event.dataTransfer.files[0]) mkHandleRefFile(event.dataTransfer.files[0])">
        ${hasParams ? `
          <svg class="w-7 h-7 text-green-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p class="text-sm font-medium text-green-700">${mkEsc(_mk.refFile?.name || 'Parameterfil laddad')}</p>
          <p class="text-xs text-green-600 mt-0.5">${_mk.refParams.length} parametrar funna</p>
          <div class="flex items-center gap-2 justify-center mt-3">
            <button onclick="document.getElementById('mk-ref-input').click()" class="${btn}">Byt fil (ladda upp)</button>
            <button onclick="mkOpenPicker('open')" class="${btn}">Byt fil (från ACC)</button>
            <button onclick="mkOpenPicker('save')" class="${btn}">Spara i ACC</button>
          </div>
        ` : `
          <svg class="w-8 h-8 text-ads-muted mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <p class="text-sm text-ads-muted mb-1">Dra och släpp en Revit shared parameter-fil (.txt) hit</p>
          <p class="text-xs text-ads-muted mb-3">Alla parametrar i filen kontrolleras mot modellerna, och varje parameter måste ha ett värde.</p>
          <div class="flex items-center gap-2 justify-center">
            <button onclick="document.getElementById('mk-ref-input').click()"
                    class="text-sm bg-ads-blue text-white px-4 py-1.5 rounded hover:bg-ads-blue-dark transition-colors">
              Ladda upp fil
            </button>
            <button onclick="mkOpenPicker('open')"
                    class="text-sm border border-ads-border bg-white px-4 py-1.5 rounded hover:border-ads-blue hover:text-ads-blue transition-colors text-ads-text">
              Välj från ACC
            </button>
          </div>
        `}
        <input id="mk-ref-input" type="file" accept=".txt" class="hidden"
               onchange="if(this.files[0]) mkHandleRefFile(this.files[0]); this.value=''" />
      </div>

      ${warn}
      ${hasParams ? mkRenderParamTable() : ''}

      ${hasParams && _mk.refParams.some(p => p.selected) ? `
        <div class="flex justify-end mt-4">
          <button onclick="mkNav(2)"
                  class="inline-flex items-center gap-2 bg-ads-blue text-white text-sm px-5 py-2 rounded hover:bg-ads-blue-dark transition-colors">
            Nästa: Välj modeller <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"/></svg>
          </button>
        </div>` : ''}
    </div>`;
}

function mkRenderParamTable() {
  const q        = _mk.paramSearch.trim().toLowerCase();
  const filtered = q ? _mk.refParams.filter(p => p.name.toLowerCase().includes(q)) : _mk.refParams;
  const all      = filtered.length > 0 && filtered.every(p => p.selected);
  const th       = 'py-2.5 px-3 text-left text-xs font-semibold text-ads-muted uppercase tracking-wide';
  return `
    <div class="bg-white border border-ads-border rounded-lg overflow-hidden">
      <div class="px-3 pt-3 pb-2 border-b border-ads-border">
        <div class="relative">
          <svg class="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ads-muted pointer-events-none"
               fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="9" r="5"/><path stroke-linecap="round" d="M16 16l-2-2"/>
          </svg>
          <input type="search" value="${mkEsc(_mk.paramSearch)}" placeholder="Sök parameter…"
                 oninput="mkSetParamSearch(this.value)"
                 class="w-full pl-7 pr-3 py-1.5 text-xs border border-ads-border rounded
                        focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
        </div>
      </div>
      <table class="w-full text-sm">
        <thead class="bg-ads-gray">
          <tr>
            <th class="py-2.5 px-3 w-10">
              <input type="checkbox" ${all ? 'checked' : ''} id="mk-all-cb"
                     onchange="mkToggleAllParams(this.checked)" class="accent-ads-blue" />
            </th>
            <th class="${th}">Parameter</th>
            <th class="${th}">Datatyp</th>
            <th class="${th}">GUID</th>
            <th class="${th}">Grupp</th>
            <th class="${th}">Beskrivning</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0
            ? `<tr><td colspan="6" class="py-6 px-3 text-center text-xs text-ads-muted italic">Inga parametrar matchar sökningen.</td></tr>`
            : filtered.map(p => {
                const actualIdx = _mk.refParams.indexOf(p);
                return `
                  <tr class="border-t border-ads-border hover:bg-ads-gray/40 ${p.selected ? '' : 'opacity-50'}">
                    <td class="py-2 px-3">
                      <input type="checkbox" ${p.selected ? 'checked' : ''} onchange="mkToggleParam(${actualIdx})" class="accent-ads-blue" />
                    </td>
                    <td class="py-2 px-3 font-medium text-ads-text">${mkEsc(p.name)}</td>
                    <td class="py-2 px-3"><span class="text-xs font-mono bg-ads-gray text-ads-text rounded px-1.5 py-0.5">${mkEsc(p.valueType || '—')}</span></td>
                    <td class="py-2 px-3 text-ads-muted text-[11px] font-mono">${mkEsc(p.guid)}</td>
                    <td class="py-2 px-3 text-ads-muted text-xs">${mkEsc(p.group || '—')}</td>
                    <td class="py-2 px-3 text-ads-muted text-xs">${mkEsc(p.comment)}</td>
                  </tr>`;
              }).join('')}
        </tbody>
      </table>
    </div>`;
}

function mkToggleParam(i) {
  _mk.refParams[i].selected = !_mk.refParams[i].selected;
  const content = document.getElementById('mk-step-content');
  if (content) content.innerHTML = mkRenderStep1();
}

function mkToggleAllParams(checked) {
  const q = _mk.paramSearch.trim().toLowerCase();
  const targets = q ? _mk.refParams.filter(p => p.name.toLowerCase().includes(q)) : _mk.refParams;
  targets.forEach(p => { p.selected = checked; });
  const content = document.getElementById('mk-step-content');
  if (content) content.innerHTML = mkRenderStep1();
}

function mkSetParamSearch(q) {
  _mk.paramSearch = q;
  const content = document.getElementById('mk-step-content');
  if (content) content.innerHTML = mkRenderStep1();
}

// ── Shared parameter file parsing ─────────────────────────────────────────────
// Revit saves the file as UTF-16 with a BOM; other editors may save UTF-8 or ANSI.
// Lines are tab separated. GROUP rows give id → name, PARAM rows are
// PARAM  GUID  NAME  DATATYPE  DATACATEGORY  GROUP  VISIBLE  DESCRIPTION  USERMODIFIABLE  HIDEWHENNOVALUE

function mkDecodeSharedParamFile(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
  catch { return new TextDecoder('windows-1252').decode(b); }
}

function mkParseSharedParams(text) {
  const guidRe   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const groups   = {};
  const params   = [];
  const warnings = [];
  const seenGuid = new Set();
  const seenName = new Set();

  text.split(/\r?\n/).forEach((line, n) => {
    if (!line.trim() || line[0] === '#' || line[0] === '*') return;
    const c = line.split('\t');

    if (c[0] === 'GROUP') {
      groups[(c[1] || '').trim()] = (c[2] || '').trim();
    } else if (c[0] === 'PARAM') {
      const guid = (c[1] || '').trim().toLowerCase();
      const name = (c[2] || '').trim();
      if (!guidRe.test(guid) || !name) {
        warnings.push(`Rad ${n + 1}: ogiltig GUID eller saknat namn – hoppades över.`);
        return;
      }
      if (seenGuid.has(guid)) {
        warnings.push(`Rad ${n + 1}: GUID för "${name}" finns redan i filen – hoppades över.`);
        return;
      }
      seenGuid.add(guid);
      if (seenName.has(name.toLowerCase())) {
        warnings.push(`Parameternamnet "${name}" förekommer flera gånger i filen. Matchning sker på namn, så resultatet kan bli osäkert.`);
      }
      seenName.add(name.toLowerCase());
      params.push({
        name,
        guid,
        valueType: (c[3] || '').trim().toUpperCase(),
        group:     (c[5] || '').trim(),
        comment:   (c[7] || '').trim(),
        paramType: '',
        selected:  true,
      });
    }
  });

  params.forEach(p => { p.group = groups[p.group] || p.group; });
  return { params, warnings };
}

function mkApplySharedParams(buffer, name, itemId) {
  const { params, warnings } = mkParseSharedParams(mkDecodeSharedParamFile(buffer));
  if (!params.length) throw new Error('Hittade inga parametrar. Är det en Revit shared parameter-fil?');
  _mk.refRaw      = buffer;
  _mk.refFile     = { name, itemId: itemId || null };
  _mk.refParams   = params;
  _mk.refWarnings = warnings;
  _mk.paramSearch = '';
  renderModellkontroll();
}

async function mkHandleRefFile(file) {
  try {
    mkApplySharedParams(await file.arrayBuffer(), file.name, null);
  } catch (err) {
    mkToast('Kunde inte läsa filen: ' + err.message, 'red');
  }
}

async function mkFetchItemBuffer(projectId, itemId) {
  const { urls } = await getItemDownload(projectId, itemId);
  if (!urls.length) throw new Error('Filen har ingen nedladdningsadress.');
  const res = await fetch(urls[0]);
  if (!res.ok) throw new Error(`Kunde inte hämta filen (${res.status}).`);
  return res.arrayBuffer();
}

// ── ACC file picker (open a .txt / pick a folder to save in) ──────────────────

function mkOpenPicker(mode) {
  _mk.pk = { mode, state: {}, sel: null };
  document.getElementById('mk-picker')?.remove();
  const open = mode === 'open';
  const d = document.createElement('div');
  d.id = 'mk-picker';
  d.className = 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center';
  d.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl w-[560px] max-w-[92vw] flex flex-col" style="max-height:80vh">
      <div class="px-5 pt-4 pb-3 border-b border-ads-border">
        <h3 class="font-semibold text-ads-text">${open ? 'Välj shared parameter-fil i ACC' : 'Spara shared parameter-fil i ACC'}</h3>
        <p class="text-xs text-ads-muted mt-0.5">${open ? 'Öppna mappar och klicka på en .txt-fil.' : 'Välj mappen filen ska sparas i. Finns filen redan läggs en ny version till.'}</p>
      </div>
      <div id="mk-pk-body" class="flex-1 overflow-y-auto py-2" style="min-height:200px"></div>
      <div class="px-5 py-3 border-t border-ads-border">
        ${open ? '' : `
          <input id="mk-pk-name" type="text" value="${mkEsc(_mk.refFile?.name || 'Shared Parameters.txt')}"
                 class="w-full border border-ads-border rounded px-3 py-1.5 text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
          <p id="mk-pk-sel" class="text-xs text-ads-muted mb-3">Ingen mapp vald</p>`}
        <div class="flex justify-end gap-2">
          <button onclick="document.getElementById('mk-picker').remove()" class="text-sm text-ads-muted px-3 py-1.5 hover:text-ads-text">Avbryt</button>
          ${open ? '' : `<button id="mk-pk-save" onclick="mkPkSave()" disabled
                  class="text-sm bg-ads-blue text-white px-4 py-1.5 rounded hover:bg-ads-blue-dark disabled:opacity-40">Spara</button>`}
        </div>
      </div>
    </div>`;
  mkModal(d);
  mkPkLoadTop();
}

async function mkPkLoadTop() {
  const pk = _mk.pk;
  pk.state.__top__ = { loading: true, items: [] };
  mkPkRender();
  try {
    const items = await getTopFolders(_hubs[_hubIdx].id, _currentProject.id);
    items.forEach(item => { _mk.itemsById[item.id] = item; });
    pk.state.__top__ = { loaded: true, items };
  } catch (err) {
    pk.state.__top__ = { error: err.message, items: [] };
  }
  mkPkRender();
}

function mkPkRender() {
  const el = document.getElementById('mk-pk-body');
  if (!el) return;
  const top = _mk.pk.state.__top__;
  if (top.loading) { el.innerHTML = `<p class="text-sm text-ads-muted px-5 py-6">Laddar mappar…</p>`; return; }
  if (top.error)   { el.innerHTML = `<p class="text-sm text-red-600 px-5 py-6">Fel: ${mkEsc(top.error)}</p>`; return; }
  el.innerHTML = mkPkRows(top.items, 0) || `<p class="text-sm text-ads-muted px-5 py-6">Inga mappar hittades.</p>`;
}

function mkPkRows(items, depth) {
  const pk  = _mk.pk;
  const pad = 16 + depth * 20;
  return items.map(item => {
    if (item.attributes?.hidden) return '';
    const name = item.attributes?.displayName || item.attributes?.name || '';
    const i    = mkFid(item.id);

    if (item.type === 'folders') {
      const st  = pk.state[item.id] || {};
      const sel = pk.mode === 'save' && pk.sel === item.id;
      return `
        <div onclick="mkPkToggle(${i})"
             class="flex items-center gap-2 py-1.5 pr-4 cursor-pointer select-none ${sel ? 'bg-blue-50' : 'hover:bg-ads-gray'}"
             style="padding-left:${pad}px">
          <svg class="w-3.5 h-3.5 shrink-0 text-ads-muted transition-transform ${st.expanded ? 'rotate-90' : ''}" fill="none" viewBox="0 0 20 20">
            <path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/>
          </svg>
          <svg class="w-4 h-4 shrink-0 text-amber-400" viewBox="0 0 20 15" fill="currentColor">
            <path d="M0 2.5A1.5 1.5 0 0 1 1.5 1h4.764a1.5 1.5 0 0 1 1.06.44l.94.94A1.5 1.5 0 0 0 9.322 3H18.5A1.5 1.5 0 0 1 20 4.5v8A1.5 1.5 0 0 1 18.5 14H1.5A1.5 1.5 0 0 1 0 12.5v-10z"/>
          </svg>
          <span class="text-sm truncate flex-1 ${sel ? 'text-ads-blue font-medium' : 'text-ads-text'}">${mkEsc(name)}</span>
          ${st.loading ? `<span class="text-xs text-ads-muted">laddar…</span>` : ''}
          ${pk.mode === 'save' ? `<button onclick="event.stopPropagation(); mkPkSelectFolder(${i})"
                  class="text-xs border border-ads-border rounded px-2 py-0.5 hover:border-ads-blue hover:text-ads-blue">${sel ? 'Vald' : 'Välj'}</button>` : ''}
        </div>
        ${st.expanded ? mkPkRows(st.items || [], depth + 1) : ''}`;
    }

    if (item.type === 'items' && pk.mode === 'open' && /\.txt$/i.test(name)) {
      return `
        <div onclick="mkPkPickFile(${i})"
             class="flex items-center gap-2 py-1.5 pr-4 cursor-pointer select-none hover:bg-ads-gray"
             style="padding-left:${pad + 18}px">
          <svg class="w-4 h-4 shrink-0 text-ads-muted" viewBox="0 0 16 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.5 1H3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6.5L9.5 1z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.5 1v5.5H15"/>
          </svg>
          <span class="text-sm text-ads-text truncate flex-1">${mkEsc(name)}</span>
        </div>`;
    }
    return '';
  }).join('');
}

async function mkPkToggle(i) {
  const pk = _mk.pk;
  const id = mkFidLookup(i);
  const st = pk.state[id] || { items: [], expanded: false, loaded: false, loading: false };

  if (!st.loaded) {
    pk.state[id] = { ...st, expanded: true, loading: true };
    mkPkRender();
    try {
      const contents = await getFolderContents(_currentProject.id, id);
      contents.forEach(item => { _mk.itemsById[item.id] = item; });
      pk.state[id] = { items: contents, expanded: true, loaded: true, loading: false };
    } catch {
      pk.state[id] = { ...st, expanded: false, loaded: false, loading: false };
    }
  } else {
    pk.state[id] = { ...st, expanded: !st.expanded };
  }
  mkPkRender();
}

function mkPkSelectFolder(i) {
  const pk = _mk.pk;
  pk.sel = mkFidLookup(i);
  const item = _mk.itemsById[pk.sel];
  const sel  = document.getElementById('mk-pk-sel');
  if (sel) sel.textContent = 'Vald mapp: ' + (item?.attributes?.displayName || item?.attributes?.name || '');
  const save = document.getElementById('mk-pk-save');
  if (save) save.disabled = false;
  mkPkRender();
}

async function mkPkPickFile(i) {
  const item = _mk.itemsById[mkFidLookup(i)];
  if (!item) return;
  const name = item.attributes?.displayName || item.attributes?.name || '';
  const body = document.getElementById('mk-pk-body');
  if (body) body.innerHTML = `<p class="text-sm text-ads-muted px-5 py-6">Läser ${mkEsc(name)}…</p>`;
  try {
    const buffer = await mkFetchItemBuffer(_currentProject.id, item.id);
    mkApplySharedParams(buffer, name, item.id);
    document.getElementById('mk-picker')?.remove();
  } catch (err) {
    mkToast('Kunde inte läsa filen: ' + err.message, 'red');
    mkPkRender();
  }
}

async function mkPkSave() {
  const pk       = _mk.pk;
  const fileName = document.getElementById('mk-pk-name')?.value.trim();
  const save     = document.getElementById('mk-pk-save');
  if (!pk.sel || !fileName || !_mk.refRaw) return;
  if (save) { save.disabled = true; save.textContent = 'Sparar…'; }

  try {
    const st       = pk.state[pk.sel];
    const contents = st?.loaded ? st.items : await getFolderContents(_currentProject.id, pk.sel);
    const existing = contents.find(it => it.type === 'items' &&
      (it.attributes?.displayName || it.attributes?.name) === fileName);

    const itemId = await writeTextFile(_currentProject.id, pk.sel, fileName, new Blob([_mk.refRaw]), existing?.id);
    _mk.refFile = { name: fileName, itemId };
    document.getElementById('mk-picker')?.remove();
    mkToast(existing ? 'Ny version av filen sparad i ACC.' : 'Filen sparad i ACC.', 'green');
    renderModellkontroll();
  } catch (err) {
    mkToast('Kunde inte spara: ' + err.message, 'red');
    if (save) { save.disabled = false; save.textContent = 'Spara'; }
  }
}

// ── Step 2: File selection ────────────────────────────────────────────────────

function mkRenderStep2() {
  const srcTab = (src, label, iconSvg) => {
    const active = _mk.fileSource === src;
    return `<button onclick="mkSetFileSource('${src}')"
                    class="flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors
                           ${active ? 'border-ads-blue text-ads-blue font-medium' : 'border-transparent text-ads-muted hover:text-ads-text'}">
              ${iconSvg} ${label}
            </button>`;
  };

  return `
    <div class="flex gap-5">
      <div class="flex-1 min-w-0">
        <div class="bg-white border border-ads-border rounded-lg overflow-hidden">

          <div class="flex border-b border-ads-border">
            ${srcTab('dm', 'Data Management',
              `<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2 7a2 2 0 0 1 2-2h3.17a2 2 0 0 1 1.42.59l.82.82A2 2 0 0 0 10.83 7H16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7z"/></svg>`)}
            ${srcTab('mc', 'Model Coordination',
              `<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M10 2l7 3.5v9L10 18l-7-3.5v-9L10 2z"/><path stroke-linecap="round" stroke-linejoin="round" d="M10 2v16M3 5.5l7 3.5 7-3.5"/></svg>`)}
          </div>

          <div class="flex items-center gap-2 px-3 py-2 border-b border-ads-border flex-wrap">
            ${['all','rvt','ifc','dwg','nwd'].map(f => {
              const active = f === 'all' ? _mk.filter === null : _mk.filter === f;
              return `<button onclick="mkSetFilter(${f === 'all' ? 'null' : `'${f}'`})"
                             class="px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors
                                    ${active ? 'bg-ads-blue border-ads-blue text-white' : 'bg-white border-ads-border text-ads-muted hover:border-ads-blue hover:text-ads-blue'}">
                       ${f === 'all' ? 'Alla' : f.toUpperCase()}
                     </button>`;
            }).join('')}
            <div class="flex-1 relative min-w-24">
              <svg class="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ads-muted pointer-events-none"
                   fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="2">
                <circle cx="9" cy="9" r="5"/><path stroke-linecap="round" d="M16 16l-2-2"/>
              </svg>
              <input type="search" value="${_mk.search}" placeholder="Sök fil…"
                     oninput="mkSetSearch(this.value)"
                     class="w-full pl-6 pr-2 py-0.5 text-xs border border-ads-border rounded
                            focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
            </div>
          </div>

          <div id="mk-file-browser" class="overflow-auto" style="max-height:52vh">
            <div class="flex items-center gap-2 px-4 py-6 text-ads-muted text-sm">
              <svg class="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
                <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
              </svg>
              Laddar…
            </div>
          </div>
        </div>
      </div>

      <div class="w-52 shrink-0 flex flex-col gap-3">
        <div class="bg-white border border-ads-border rounded-lg p-3">
          <h4 id="mk-selected-count" class="text-xs font-semibold text-ads-muted uppercase tracking-wide mb-2">
            Valda filer (${_mk.selectedFiles.length})
          </h4>
          <div id="mk-selected-files">
            ${_mk.selectedFiles.length === 0
              ? `<p class="text-xs text-ads-muted italic">Välj filer till vänster</p>`
              : _mk.selectedFiles.map((f, i) => `
                  <div class="flex items-center gap-1.5 py-1.5 ${i > 0 ? 'border-t border-ads-border' : ''}">
                    ${mkExtBadge(f.ext)}
                    <span class="text-xs text-ads-text truncate flex-1">${f.name}</span>
                    <button onclick="mkRemoveFile(${i})" class="shrink-0 text-ads-muted hover:text-red-500 transition-colors">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4 4l12 12M16 4L4 16"/></svg>
                    </button>
                  </div>`).join('')}
          </div>
        </div>

        <div class="flex flex-col gap-2" id="mk-step2-actions">
          <button onclick="mkNav(1)"
                  class="inline-flex items-center justify-center gap-2 w-full text-sm border border-ads-border bg-white text-ads-muted rounded py-1.5 hover:text-ads-text transition-colors">
            <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"/></svg> Tillbaka
          </button>
          ${_mk.selectedFiles.length > 0 ? `
            <button onclick="mkStartCheck()"
                    class="inline-flex items-center justify-center gap-2 w-full text-sm bg-ads-blue text-white rounded py-1.5 hover:bg-ads-blue-dark transition-colors">
              Kör kontroll <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"/></svg>
            </button>` : ''}
        </div>
      </div>
    </div>`;
}

function mkFolderMightHaveFiles(folderId) {
  if (!_mk.filter) return true;
  const st = _mk.folderState[folderId];
  if (!st?.loaded) return true; // unloaded — can't rule out matching files
  for (const item of st.items || []) {
    if (item.type === 'items') {
      const name = item.attributes.displayName || item.attributes.name || '';
      const ext  = (name.split('.').pop() || '').toLowerCase();
      if (ext === _mk.filter) return true;
    } else if (item.type === 'folders') {
      if (mkFolderMightHaveFiles(item.id)) return true;
    }
  }
  return false;
}

function mkGetFolderFiles(folderId) {
  const st = _mk.folderState[folderId];
  if (!st?.loaded || !st.items) return [];
  const files = [];
  for (const item of st.items) {
    if (item.type === 'items') {
      const name = item.attributes.displayName || item.attributes.name || '';
      const ext  = (name.split('.').pop() || '').toLowerCase();
      if (['rvt','ifc','dwg','nwd'].includes(ext) && (!_mk.filter || ext === _mk.filter)) files.push(item);
    } else if (item.type === 'folders') {
      files.push(...mkGetFolderFiles(item.id));
    }
  }
  return files;
}

function mkFolderSelectionState(folderId) {
  const files = mkGetFolderFiles(folderId);
  if (!files.length) return 'none';
  const n = files.filter(f => _mk.selectedFiles.some(s => s.itemId === f.id)).length;
  if (n === 0) return 'none';
  if (n === files.length) return 'all';
  return 'some';
}

async function mkToggleFolderSelection(idx) {
  const id = mkFidLookup(idx);
  const st = _mk.folderState[id] || {};

  if (!st.loaded && !st.loading) {
    _mk.folderState[id] = { ...st, expanded: true, loading: true };
    mkRenderFileBrowser();
    try {
      const contents = await getFolderContents(_currentProject.id, id);
      contents.forEach(item => { _mk.itemsById[item.id] = item; });
      _mk.folderState[id] = { items: contents, expanded: true, loaded: true, loading: false };
    } catch {
      _mk.folderState[id] = { ...st, expanded: false, loaded: false, loading: false };
      mkRenderFileBrowser();
      return;
    }
  }

  const files = mkGetFolderFiles(id);
  const state = mkFolderSelectionState(id);

  if (state === 'all') {
    const toRemove = new Set(files.map(f => f.id));
    _mk.selectedFiles = _mk.selectedFiles.filter(s => !toRemove.has(s.itemId));
  } else {
    const already = new Set(_mk.selectedFiles.map(s => s.itemId));
    for (const f of files) {
      if (!already.has(f.id)) {
        const name = f.attributes.displayName || f.attributes.name || '';
        const ext  = (name.split('.').pop() || '').toLowerCase();
        _mk.selectedFiles.push({ itemId: f.id, name, ext, projectId: _currentProject.id, source: 'dm' });
      }
    }
  }

  mkRenderFileBrowser();
  mkUpdateSelectedPanel();
}

function mkRenderFileBrowser() {
  const el = document.getElementById('mk-file-browser');
  if (!el) return;
  const st = _mk.folderState['__top__'];

  if (!st || st.loading) {
    el.innerHTML = `<div class="flex items-center gap-2 px-4 py-6 text-ads-muted text-sm">
      <svg class="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
        <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
      </svg>Laddar mappar…</div>`;
    return;
  }
  if (st.error) {
    el.innerHTML = `<p class="text-sm text-red-600 px-4 py-6">Fel: ${st.error}</p>`;
    return;
  }
  if (!st.items || !st.items.length) {
    el.innerHTML = `<p class="text-ads-muted text-sm px-4 py-6">Inga mappar hittades.</p>`;
    return;
  }
  const treeHtml = mkRenderTreeItems(st.items, 0);
  if (!treeHtml.trim()) {
    el.innerHTML = _mk.filter
      ? `<p class="text-sm text-ads-muted px-4 py-6 italic">Expandera mappar för att se ${_mk.filter.toUpperCase()}-filer, eller välj ett annat filter.</p>`
      : `<p class="text-sm text-ads-muted px-4 py-6">Inga filer hittades.</p>`;
  } else {
    el.innerHTML = treeHtml;
  }
}

function mkRenderTreeItems(items, depth) {
  const base = 12 + depth * 20;
  return items.map(item => {
    if (item.attributes?.hidden) return '';

    if (item.type === 'folders') {
      if (!mkFolderMightHaveFiles(item.id)) return '';
      const st      = _mk.folderState[item.id] || {};
      const exp     = st.expanded || false;
      const loading = st.loading  || false;
      const name    = item.attributes.displayName || item.attributes.name || '';
      const i       = mkFid(item.id);
      const sel     = mkFolderSelectionState(item.id);
      const chk     = sel === 'all'
        ? `<svg class="w-3.5 h-3.5 shrink-0 text-ads-blue" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="currentColor"/><path stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 8l3 3 5-5"/></svg>`
        : sel === 'some'
        ? `<svg class="w-3.5 h-3.5 shrink-0 text-ads-blue" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><line x1="4" y1="8" x2="12" y2="8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
        : `<svg class="w-3.5 h-3.5 shrink-0 text-ads-muted" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>`;
      return `
        <div onclick="mkToggleFolder(${i})"
             class="flex items-center gap-2 py-1.5 pr-4 rounded hover:bg-ads-gray cursor-pointer select-none"
             style="padding-left:${base}px">
          <svg class="w-3.5 h-3.5 shrink-0 text-ads-muted transition-transform ${exp ? 'rotate-90' : ''}"
               fill="none" viewBox="0 0 20 20">
            <path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/>
          </svg>
          <span onclick="event.stopPropagation(); mkToggleFolderSelection(${i})"
                class="flex items-center justify-center p-0.5 rounded hover:bg-ads-border">
            ${chk}
          </span>
          <svg class="w-4 h-4 shrink-0 text-amber-400" viewBox="0 0 20 15" fill="currentColor">
            <path d="M0 2.5A1.5 1.5 0 0 1 1.5 1h4.764a1.5 1.5 0 0 1 1.06.44l.94.94A1.5 1.5 0 0 0 9.322 3H18.5A1.5 1.5 0 0 1 20 4.5v8A1.5 1.5 0 0 1 18.5 14H1.5A1.5 1.5 0 0 1 0 12.5v-10z"/>
          </svg>
          <span class="text-sm text-ads-text truncate flex-1">${name}</span>
          ${loading ? `<span class="text-xs text-ads-muted">laddar…</span>` : ''}
        </div>
        ${exp ? mkRenderTreeItems(st.items || [], depth + 1) : ''}`;
    }

    if (item.type === 'items') {
      const name = item.attributes.displayName || item.attributes.name || '';
      const ext  = (name.split('.').pop() || '').toLowerCase();
      if (!['rvt','ifc','dwg','nwd'].includes(ext)) return '';
      if (_mk.filter && ext !== _mk.filter) return '';
      const q = _mk.search.trim().toLowerCase();
      if (q && !name.toLowerCase().includes(q)) return '';

      const selected = _mk.selectedFiles.some(f => f.itemId === item.id);
      const i        = mkFid(item.id);

      return `
        <div onclick="mkToggleFileSelection(${i})"
             class="flex items-center gap-2 py-1.5 pr-4 rounded cursor-pointer select-none
                    ${selected ? 'bg-blue-50' : 'hover:bg-ads-gray'}"
             style="padding-left:${base + 4}px">
          <input type="checkbox" ${selected ? 'checked' : ''} class="w-3.5 h-3.5 shrink-0 accent-ads-blue pointer-events-none" />
          <svg class="w-4 h-4 shrink-0 ${selected ? 'text-ads-blue' : 'text-ads-muted'}"
               viewBox="0 0 16 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.5 1H3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6.5L9.5 1z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.5 1v5.5H15"/>
          </svg>
          <span class="text-sm ${selected ? 'text-ads-blue font-medium' : 'text-ads-text'} truncate flex-1">${name}</span>
          ${mkExtBadge(ext)}
        </div>`;
    }
    return '';
  }).join('');
}

async function mkLoadTopFolders() {
  _mk.folderState['__top__'] = { loading: true, loaded: false, items: [] };
  mkRenderFileBrowser();
  try {
    const hub   = _hubs[_hubIdx];
    const items = await getTopFolders(hub.id, _currentProject.id);
    items.forEach(item => { _mk.itemsById[item.id] = item; });
    _mk.folderState['__top__'] = { loading: false, loaded: true, items };
  } catch (err) {
    _mk.folderState['__top__'] = { loading: false, loaded: false, items: [], error: err.message };
  }
  mkRenderFileBrowser();
}

async function mkToggleFolder(idx) {
  const id = mkFidLookup(idx);
  const st = _mk.folderState[id] || { items: [], expanded: false, loaded: false, loading: false };

  if (!st.loaded) {
    _mk.folderState[id] = { ...st, expanded: true, loading: true };
    mkRenderFileBrowser();
    try {
      const contents = await getFolderContents(_currentProject.id, id);
      contents.forEach(item => { _mk.itemsById[item.id] = item; });
      _mk.folderState[id] = { items: contents, expanded: true, loaded: true, loading: false };
    } catch {
      _mk.folderState[id] = { ...st, expanded: false, loaded: false, loading: false };
    }
  } else {
    _mk.folderState[id] = { ...st, expanded: !st.expanded };
  }
  mkRenderFileBrowser();
}

function mkToggleFileSelection(idx) {
  const id   = mkFidLookup(idx);
  const item = _mk.itemsById[id];
  if (!item) return;

  const name     = item.attributes.displayName || item.attributes.name || '';
  const ext      = (name.split('.').pop() || '').toLowerCase();
  const existing = _mk.selectedFiles.findIndex(f => f.itemId === id);

  if (existing !== -1) {
    _mk.selectedFiles.splice(existing, 1);
  } else {
    _mk.selectedFiles.push({ itemId: id, name, ext, projectId: _currentProject.id, source: 'dm' });
  }

  mkRenderFileBrowser();
  mkUpdateSelectedPanel();
}

function mkRemoveFile(i) {
  _mk.selectedFiles.splice(i, 1);
  mkRenderFileBrowser();
  mkUpdateSelectedPanel();
}

function mkUpdateSelectedPanel() {
  const countEl = document.getElementById('mk-selected-count');
  if (countEl) countEl.textContent = `Valda filer (${_mk.selectedFiles.length})`;

  const listEl = document.getElementById('mk-selected-files');
  if (listEl) {
    listEl.innerHTML = _mk.selectedFiles.length === 0
      ? `<p class="text-xs text-ads-muted italic">Välj filer till vänster</p>`
      : _mk.selectedFiles.map((f, i) => `
          <div class="flex items-center gap-1.5 py-1.5 ${i > 0 ? 'border-t border-ads-border' : ''}">
            ${mkExtBadge(f.ext)}
            <span class="text-xs text-ads-text truncate flex-1">${f.name}</span>
            <button onclick="mkRemoveFile(${i})" class="shrink-0 text-ads-muted hover:text-red-500 transition-colors">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4 4l12 12M16 4L4 16"/></svg>
            </button>
          </div>`).join('');
  }

  const actEl = document.getElementById('mk-step2-actions');
  if (actEl) {
    actEl.innerHTML = `
      <button onclick="mkNav(1)"
              class="inline-flex items-center justify-center gap-2 w-full text-sm border border-ads-border bg-white text-ads-muted rounded py-1.5 hover:text-ads-text transition-colors">
        <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"/></svg> Tillbaka
      </button>
      ${_mk.selectedFiles.length > 0 ? `
        <button onclick="mkStartCheck()"
                class="inline-flex items-center justify-center gap-2 w-full text-sm bg-ads-blue text-white rounded py-1.5 hover:bg-ads-blue-dark transition-colors">
          Kör kontroll <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"/></svg>
        </button>` : ''}`;
  }
}

function mkSetFileSource(src) {
  _mk.fileSource = src;
  renderModellkontroll();
}

function mkSetFilter(f) {
  _mk.filter = f;
  mkRenderFileBrowser();
  if (_mk.fileSource === 'mc') mkRenderMCBrowser();
}

function mkSetSearch(q) {
  _mk.search = q;
  mkRenderFileBrowser();
  if (_mk.fileSource === 'mc') mkRenderMCBrowser();
}

// ── Model Coordination browser ────────────────────────────────────────────────

async function mkLoadModelSets() {
  const el = document.getElementById('mk-file-browser');
  if (el) el.innerHTML = `<div class="p-4 text-sm text-ads-muted flex items-center gap-2">
    <svg class="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
      <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
    </svg>Laddar model sets…</div>`;
  try {
    _mk.modelSets = await listModelSets(_currentProject.id);
    mkRenderMCBrowser();
  } catch (err) {
    if (el) el.innerHTML = `<p class="p-4 text-sm text-red-600">Fel: ${err.message}</p>`;
  }
}

function mkRenderMCBrowser() {
  const el = document.getElementById('mk-file-browser');
  if (!el) return;
  if (!_mk.modelSets || !_mk.modelSets.length) {
    el.innerHTML = `<p class="text-sm text-ads-muted p-4">Inga model sets hittades.</p>`;
    return;
  }
  el.innerHTML = _mk.modelSets.map(ms => {
    const exp   = _mk.mcExpanded[ms.id];
    const name  = ms.name || ms.id;
    return `
      <div onclick="mkToggleMCSet('${ms.id}')"
           class="flex items-center gap-2 px-3 py-2 hover:bg-ads-gray cursor-pointer select-none">
        <svg class="w-3.5 h-3.5 shrink-0 text-ads-muted transition-transform ${exp ? 'rotate-90' : ''}"
             fill="none" viewBox="0 0 20 20">
          <path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/>
        </svg>
        <svg class="w-4 h-4 text-ads-blue shrink-0" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10 2l7 3.5v9L10 18l-7-3.5v-9L10 2z"/>
          <path stroke-linecap="round" stroke-linejoin="round" d="M10 2v16M3 5.5l7 3.5 7-3.5"/>
        </svg>
        <span class="text-sm text-ads-text">${name}</span>
        ${ms._loading ? `<span class="text-xs text-ads-muted ml-auto">laddar…</span>` : ''}
      </div>
      ${exp && ms._items ? ms._items.map(item => {
        const iname    = item.name || item.itemUrn || '(okänd)';
        const ext      = (iname.split('.').pop() || '').toLowerCase();
        if (_mk.filter && ext !== _mk.filter) return '';
        const q        = _mk.search.trim().toLowerCase();
        if (q && !iname.toLowerCase().includes(q)) return '';
        const key      = 'mc:' + (item.itemUrn || item.id);
        const selected = _mk.selectedFiles.some(f => f.itemId === key);
        const fidx     = mkFid(key);
        return `
          <div onclick="mkToggleMCFile(${fidx})"
               class="flex items-center gap-2 py-1.5 pl-10 pr-4 hover:bg-ads-gray cursor-pointer select-none ${selected ? 'bg-blue-50' : ''}">
            <input type="checkbox" ${selected ? 'checked' : ''} class="w-3.5 h-3.5 shrink-0 accent-ads-blue pointer-events-none" />
            <svg class="w-4 h-4 shrink-0 ${selected ? 'text-ads-blue' : 'text-ads-muted'}"
                 viewBox="0 0 16 20" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9.5 1H3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6.5L9.5 1z"/>
              <path stroke-linecap="round" stroke-linejoin="round" d="M9.5 1v5.5H15"/>
            </svg>
            <span class="text-sm ${selected ? 'text-ads-blue font-medium' : 'text-ads-text'} truncate flex-1">${iname}</span>
            ${mkExtBadge(ext)}
          </div>`;
      }).join('') : ''}`;
  }).join('');
}

async function mkToggleMCSet(id) {
  const ms = _mk.modelSets?.find(s => s.id === id);
  if (!ms) return;

  if (_mk.mcExpanded[id]) {
    _mk.mcExpanded[id] = false;
    mkRenderMCBrowser();
    return;
  }

  _mk.mcExpanded[id] = true;

  if (!ms._items) {
    ms._loading = true;
    mkRenderMCBrowser();
    try {
      const versions = await getModelSetVersions(_currentProject.id, id);
      if (versions.length) {
        const items = await listModelSetItems(_currentProject.id, id, versions[0].id);
        ms._items = items;
        items.forEach(item => {
          _mk.itemsById['mc:' + (item.itemUrn || item.id)] = item;
        });
      } else {
        ms._items = [];
      }
    } catch {
      ms._items = [];
    }
    ms._loading = false;
  }
  mkRenderMCBrowser();
}

function mkToggleMCFile(idx) {
  const key  = mkFidLookup(idx);
  const item = _mk.itemsById[key];
  if (!item) return;

  const name     = item.name || item.itemUrn || '(okänd)';
  const ext      = (name.split('.').pop() || '').toLowerCase();
  const existing = _mk.selectedFiles.findIndex(f => f.itemId === key);

  if (existing !== -1) {
    _mk.selectedFiles.splice(existing, 1);
  } else {
    _mk.selectedFiles.push({ itemId: key, name, ext, projectId: _currentProject.id, source: 'mc' });
  }

  mkRenderMCBrowser();
  mkUpdateSelectedPanel();
}

// ── Step 3: Check execution ───────────────────────────────────────────────────

async function mkRunCheck() {
  const params = _mk.refParams.filter(p => p.selected);

  for (let i = 0; i < _mk.selectedFiles.length; i++) {
    const file   = _mk.selectedFiles[i];
    const result = await mkCheckSingleModel(file, params);
    _mk.results.push(result);

    if (_mk.step === 3) {
      const el = document.getElementById('mk-results');
      if (el) el.innerHTML = _mk.results.map((r, j) => mkResultCard(r, j)).join('');

      const progEl = document.getElementById('mk-progress-text');
      if (progEl) {
        const next = _mk.selectedFiles[i + 1];
        progEl.textContent = next ? `Kontrollerar ${next.name}…` : 'Slutför…';
      }
      const subEl = document.getElementById('mk-progress-sub');
      if (subEl) subEl.textContent = `${i + 1} av ${_mk.selectedFiles.length} klara`;
    }
  }

  _mk.running = false;
  if (_mk.step === 3) {
    const content = document.getElementById('mk-step-content');
    if (content) content.innerHTML = mkRenderStep3();
  }
}

async function mkRerunModel(i) {
  const file = _mk.results[i]?.file;
  if (!file) return;
  if (!_mk.mkClientId || !_mk.mkClientSecret) {
    mkShowApsCredentialsPrompt(() => mkRerunModel(i));
    return;
  }

  _mk.results[i] = { file, status: 'rerunning', error: null, paramResults: [], elementCount: 0, versionUrn: null };
  _mk.expanded.delete(i);
  const el = document.getElementById('mk-results');
  if (el) el.innerHTML = _mk.results.map((r, j) => mkResultCard(r, j)).join('');

  const params = _mk.refParams.filter(p => p.selected);
  const result = await mkCheckSingleModel(file, params);
  _mk.results[i] = result;

  const el2 = document.getElementById('mk-results');
  if (el2) el2.innerHTML = _mk.results.map((r, j) => mkResultCard(r, j)).join('');

  const stripEl = document.getElementById('mk-summary-strip');
  if (stripEl) stripEl.outerHTML = mkRenderSummaryStrip();
}

async function mkGetApsToken() {
  if (_mk.mkApsToken && Date.now() < _mk.mkApsTokenExp - 60000) return _mk.mkApsToken;
  const creds = btoa(`${_mk.mkClientId}:${_mk.mkClientSecret}`);
  const res   = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
    method:  'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    'grant_type=client_credentials&scope=data%3Aread',
  });
  if (!res.ok) throw new Error(`APS auth error ${res.status}: ${await res.text()}`);
  const data        = await res.json();
  _mk.mkApsToken    = data.access_token;
  _mk.mkApsTokenExp = Date.now() + data.expires_in * 1000;
  return _mk.mkApsToken;
}

async function mkDerivativeGet(path) {
  const token  = await mkGetApsToken();
  const base   = 'https://developer.api.autodesk.com';
  let res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });

  // EU accounts store derivatives under /regions/eu/ — retry there on 404
  if (res.status === 404) {
    const euPath = path.replace('/modelderivative/v2/designdata/', '/modelderivative/v2/regions/eu/designdata/');
    if (euPath !== path) {
      res = await fetch(`${base}${euPath}`, { headers: { Authorization: `Bearer ${token}` } });
    }
  }

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`APS error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function mkCheckSingleModel(file, params) {
  const result = { file, status: 'running', error: null, paramResults: [], elementCount: 0, versionUrn: null };

  try {
    // Resolve item ID — MC files use 'mc:...' prefix with actual URN inside
    const rawItemId = file.source === 'mc'
      ? file.itemId.replace(/^mc:/, '')
      : file.itemId;

    const tip        = await getItemTip(file.projectId, rawItemId);
    const versionUrn = tip.id;
    result.versionUrn = versionUrn;

    const encoded  = toSafeBase64(versionUrn);
    const manifest = await mkDerivativeGet(`/modelderivative/v2/designdata/${encoded}/manifest`);
    if (!manifest) { result.status = 'no-derivative'; return result; }

    const metaRes  = await mkDerivativeGet(`/modelderivative/v2/designdata/${encoded}/metadata`);
    const metadata = metaRes?.data?.metadata;
    if (!metadata || !metadata.length) { result.status = 'no-views'; return result; }

    const view = metadata.find(m => m.role === '3d') || metadata.find(m => m.role === '2d') || metadata[0];

    const propsRes       = await mkDerivativeGet(`/modelderivative/v2/designdata/${encoded}/metadata/${view.guid}/properties`);
    const collection     = propsRes?.data?.collection;
    result.elementCount  = collection.length;

    // Data types come from the property catalogue. If it can't be built the
    // check still runs, with the data type left unchecked.
    let fields = null;
    try {
      fields = await getModelPropertyFields(file.projectId, versionUrn);
    } catch (err) {
      result.typeError = err.message;
    }

    for (const param of params) {
      result.paramResults.push(mkCheckParam(param, collection, fields));
    }

    result.status = 'done';
  } catch (err) {
    result.status = 'error';
    result.error  = err.message;
  }

  return result;
}

function mkCheckParam(param, collection, fields) {
  const elements = [];

  for (const obj of collection) {
    if (!obj.properties) continue;
    for (const cat of Object.values(obj.properties)) {
      if (typeof cat !== 'object' || Array.isArray(cat)) continue;
      if (param.name in cat) {
        elements.push({
          dbId:  obj.objectid,
          name:  obj.name || '',
          extId: obj.externalId || '',
          value: cat[param.name],
        });
        break;
      }
    }
  }

  const withValue = elements.filter(e => e.value !== null && e.value !== undefined && String(e.value).trim() !== '');
  const exists    = elements.length > 0;
  const hasValue  = withValue.length > 0;

  // typeMatch: true / false, or null when it couldn't be checked. The same name
  // can sit under several property groups; every one of them must match.
  const expected   = mkExpectedType(param.valueType);
  const matching   = fields ? fields.filter(f => f.name === param.name && !String(f.category).startsWith('__')) : [];
  const modelTypes = [...new Set(matching.map(mkDescribeField))];
  const typeMatch  = expected && matching.length ? matching.every(f => mkFieldMatches(f, expected)) : null;

  return {
    param,
    exists,
    hasValue,
    typeMatch,
    modelTypes,
    level:      mkConformityLevel(exists, hasValue, typeMatch),
    elements,
    totalCount: collection.length,
    existCount: elements.length,
    valueCount: withValue.length,
  };
}

// ── Step 3: Results render ────────────────────────────────────────────────────

function mkRenderSummaryStrip() {
  const done = _mk.results.filter(r => r.status === 'done');
  if (!done.length) return '';

  let green = 0, yellow = 0, orange = 0, grey = 0;
  for (const r of done) {
    for (const p of r.paramResults) {
      if (p.level === 'green')        green++;
      else if (p.level === 'yellow')  yellow++;
      else if (p.level === 'orange')  orange++;
      else                            grey++;
    }
  }
  const total = green + yellow + orange + grey;
  if (!total) return '';

  const pct = n => Math.max(1, Math.round((n / total) * 100));
  const segments = [
    { count: green,  cls: 'bg-green-500',  dot: 'bg-green-500',  label: 'OK' },
    { count: yellow, cls: 'bg-yellow-400', dot: 'bg-yellow-400', label: 'Fel datatyp' },
    { count: orange, cls: 'bg-orange-400', dot: 'bg-orange-400', label: 'Saknar värde' },
    { count: grey,   cls: 'bg-gray-300',   dot: 'bg-gray-300',   label: 'Saknar param' },
  ].filter(s => s.count > 0);

  return `
    <div id="mk-summary-strip" class="bg-white border border-ads-border rounded-lg p-4 mb-4">
      <p class="text-xs font-semibold text-ads-muted uppercase tracking-wide mb-2">Parameterstatus totalt (${total} kontroller)</p>
      <div class="flex rounded overflow-hidden h-3 mb-3">
        ${segments.map(s => `<div class="${s.cls} h-full" style="width:${pct(s.count)}%" title="${s.count} ${s.label}"></div>`).join('')}
      </div>
      <div class="flex gap-4 flex-wrap">
        ${segments.map(s => `
          <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full ${s.dot} shrink-0"></span>
            <span class="text-xs text-ads-muted">${s.label} <span class="font-semibold text-ads-text">${s.count}</span></span>
          </div>`).join('')}
      </div>
    </div>`;
}

function mkRenderStep3() {
  if (_mk.running) {
    const cur = _mk.selectedFiles[_mk.results.length];
    return `
      <div>
        <div class="flex items-center gap-3 mb-5">
          <svg class="animate-spin w-5 h-5 text-ads-blue shrink-0" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
            <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
          </svg>
          <div>
            <p id="mk-progress-text" class="text-sm font-medium text-ads-text">Kontrollerar ${cur?.name || ''}…</p>
            <p id="mk-progress-sub" class="text-xs text-ads-muted">0 av ${_mk.selectedFiles.length} klara</p>
          </div>
        </div>
        <div id="mk-results">${_mk.results.map((r, i) => mkResultCard(r, i)).join('')}</div>
      </div>`;
  }

  const done = _mk.results.filter(r => r.status === 'done');
  const good = done.filter(r => mkOverallLevel(r.paramResults) === 'green').length;

  return `
    <div>
      <div class="flex items-center gap-6 p-4 bg-white border border-ads-border rounded-lg mb-4 flex-wrap gap-y-3">
        <div class="text-center min-w-12">
          <div class="text-2xl font-bold text-ads-text">${_mk.selectedFiles.length}</div>
          <div class="text-xs text-ads-muted">Modeller</div>
        </div>
        <div class="text-center min-w-12">
          <div class="text-2xl font-bold text-green-600">${good}</div>
          <div class="text-xs text-ads-muted">Fullt OK</div>
        </div>
        <div class="text-center min-w-12">
          <div class="text-2xl font-bold text-orange-500">${_mk.selectedFiles.length - good}</div>
          <div class="text-xs text-ads-muted">Avvikelser</div>
        </div>
        <div class="ml-auto flex gap-2 flex-wrap justify-end">
          <button onclick="mkNav(2)"
                  class="inline-flex items-center gap-2 text-sm border border-ads-border bg-white text-ads-muted rounded px-3 py-1.5 hover:text-ads-text transition-colors">
            <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"/></svg> Ändra urval
          </button>
          <button onclick="mkExportReport()"
                  class="inline-flex items-center gap-2 text-sm border border-ads-border bg-white text-ads-muted rounded px-3 py-1.5 hover:text-ads-text transition-colors">
            <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v4.5a.75.75 0 0 1-.75.75H5.25a.75.75 0 0 1-.75-.75v-4.5M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5"/>
            </svg>
            Exportera rapport
          </button>
          <button onclick="mkShowSaveDialog()"
                  class="text-sm bg-ads-blue text-white px-3 py-1.5 rounded hover:bg-ads-blue-dark transition-colors flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 15V5a2 2 0 0 1 2-2h6.586a1 1 0 0 1 .707.293l3.414 3.414A1 1 0 0 1 17 7.414V15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>
              <path stroke-linecap="round" stroke-linejoin="round" d="M7 17v-5h6v5M7 5h5"/>
            </svg>
            Spara kontroll
          </button>
        </div>
      </div>
      ${mkRenderSummaryStrip()}
      <div id="mk-results">${_mk.results.map((r, i) => mkResultCard(r, i)).join('')}</div>
    </div>`;
}

function mkResultCard(result, i) {
  const level = result.status === 'done' ? mkOverallLevel(result.paramResults) : 'grey';
  const borderCls = { green: 'border-green-200', yellow: 'border-yellow-200', orange: 'border-orange-200', grey: 'border-ads-border' };

  const rerunBtn = `<button onclick="mkRerunModel(${i})" class="text-xs text-ads-blue hover:underline inline-flex items-center gap-1">
    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
    Kör om
  </button>`;

  if (result.status === 'rerunning') {
    return `<div class="mb-3 p-3.5 border border-ads-border rounded-lg flex items-center gap-3">
      <svg class="animate-spin w-4 h-4 text-ads-blue shrink-0" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
        <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
      </svg>
      <span class="text-sm text-ads-text">Kontrollerar ${result.file.name}…</span>
    </div>`;
  }

  if (result.status === 'error') {
    return `<div class="mb-3 p-4 border border-red-200 bg-red-50 rounded-lg">
      <div class="flex items-center justify-between">
        <span class="font-medium text-sm text-ads-text">${result.file.name}</span>
        <div class="flex items-center gap-2">
          <span class="text-xs text-red-600 font-medium">Fel</span>
          ${rerunBtn}
        </div>
      </div>
      <p class="text-xs text-red-600 mt-1">${result.error}</p>
    </div>`;
  }

  if (result.status === 'no-derivative') {
    return `<div class="mb-3 p-4 border border-amber-200 bg-amber-50 rounded-lg">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.485 3.495L2.107 14a1 1 0 0 0 .893 1.5h13.8a1 1 0 0 0 .893-1.5L11.515 3.495a1 1 0 0 0-1.73 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M10 8v3M10 14h.01"/>
          </svg>
          <span class="font-medium text-sm text-ads-text">${result.file.name}</span>
        </div>
        ${rerunBtn}
      </div>
      <p class="text-xs text-amber-700 mt-1 ml-6">Ingen derivat hittad. Öppna modellen i ACC-visaren minst en gång för att aktivera parameterläsning.</p>
    </div>`;
  }

  if (result.status === 'no-views') {
    return `<div class="mb-3 p-4 border border-ads-border rounded-lg">
      <div class="flex items-center justify-between">
        <span class="font-medium text-sm text-ads-text">${result.file.name}</span>
        ${rerunBtn}
      </div>
      <p class="text-xs text-ads-muted mt-1">Ingen vy hittades i derivaten.</p>
    </div>`;
  }

  const expanded = _mk.expanded.has(i);
  const dots     = result.paramResults.map(p => mkConformityDot(p.level)).join('');
  const okCount  = result.paramResults.filter(p => p.level === 'green').length;

  return `
    <div class="mb-3 border ${borderCls[level]} rounded-lg overflow-hidden">
      <div class="flex items-center justify-between p-3.5 cursor-pointer hover:bg-ads-gray/30 select-none"
           onclick="mkToggleExpand(${i})">
        <div class="flex items-center gap-3 min-w-0">
          <div class="flex gap-1 flex-wrap max-w-40">${dots}</div>
          <span class="font-medium text-sm text-ads-text truncate">${result.file.name}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0 ml-2">
          ${result.typeError ? `<span class="text-xs text-amber-600" title="${mkEsc(result.typeError)}">Datatyp ej kontrollerad</span>` : ''}
          <span class="text-xs text-ads-muted">${okCount}/${result.paramResults.length} OK</span>
          <span class="text-xs text-ads-muted">${result.elementCount} elem.</span>
          <button onclick="event.stopPropagation(); mkRerunModel(${i})"
                  class="text-ads-muted hover:text-ads-blue transition-colors" title="Kör om">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
            </svg>
          </button>
          <svg class="w-4 h-4 text-ads-muted transition-transform ${expanded ? 'rotate-180' : ''}"
               fill="none" viewBox="0 0 20 20">
            <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M5 8l5 5 5-5"/>
          </svg>
        </div>
      </div>
      ${expanded ? mkResultDetail(result, i) : ''}
    </div>`;
}

// File data type, then what the model reports when it differs or can't be checked.
function mkDataTypeCell(p) {
  const file = `<span class="font-mono">${mkEsc(p.param.valueType || '—')}</span>`;
  if (p.typeMatch === true)  return `${file} <span class="text-green-600">✓</span>`;
  if (p.typeMatch === false) return `${file} <span class="text-red-500 font-semibold">≠ ${mkEsc(p.modelTypes.join(', '))}</span>`;
  if (p.modelTypes?.length)  return `${file} <span class="text-ads-muted">· modell: ${mkEsc(p.modelTypes.join(', '))} (ej kontrollerad)</span>`;
  return file;
}

function mkResultDetail(result, modelIdx) {
  const rows = result.paramResults.map(p => `
    <tr class="border-t border-ads-border">
      <td class="py-2 px-3 text-sm font-medium text-ads-text">${mkEsc(p.param.name)}</td>
      <td class="py-2 px-3 text-center text-sm">${p.exists ? '<span class="text-green-600">✓</span>' : '<span class="text-red-400">✗</span>'}</td>
      <td class="py-2 px-3 text-center text-sm">${p.hasValue ? '<span class="text-green-600">✓</span>' : '<span class="text-ads-muted">—</span>'}</td>
      <td class="py-2 px-3 text-xs">${mkDataTypeCell(p)}</td>
      <td class="py-2 px-3">${mkConformityBadge(p.level)}</td>
      <td class="py-2 px-3 text-xs text-ads-muted">${p.existCount}/${p.totalCount}</td>
    </tr>`).join('');

  return `
    <div class="border-t border-ads-border">
      ${result.typeError ? `
        <p class="px-3 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-200">
          Datatyperna kunde inte kontrolleras: ${mkEsc(result.typeError)}
        </p>` : ''}
      <table class="w-full text-xs">
        <thead>
          <tr class="bg-ads-gray text-ads-muted">
            <th class="py-2 px-3 text-left font-semibold">Parameter</th>
            <th class="py-2 px-3 text-center font-semibold w-16">Finns</th>
            <th class="py-2 px-3 text-center font-semibold w-16">Värde</th>
            <th class="py-2 px-3 text-left font-semibold">Datatyp</th>
            <th class="py-2 px-3 text-left font-semibold w-28">Status</th>
            <th class="py-2 px-3 text-left font-semibold w-20">Täckning</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="flex gap-3 px-3 py-2.5 border-t border-ads-border bg-ads-gray/30">
        ${result.versionUrn ? `
          <button onclick="mkOpenViewer(${modelIdx})"
                  class="text-xs text-ads-blue hover:underline flex items-center gap-1">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
              <path stroke-linecap="round" stroke-linejoin="round" d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"/>
            </svg>
            Visa i visaren
          </button>` : ''}
      </div>
    </div>`;
}

function mkToggleExpand(i) {
  if (_mk.expanded.has(i)) _mk.expanded.delete(i);
  else _mk.expanded.add(i);
  const el = document.getElementById('mk-results');
  if (el) el.innerHTML = _mk.results.map((r, j) => mkResultCard(r, j)).join('');
}

// ── APS Viewer ────────────────────────────────────────────────────────────────

function mkOpenViewer(modelIdx) {
  const result = _mk.results[modelIdx];
  if (!result?.versionUrn) return;

  document.getElementById('mk-viewer-panel')?.remove();

  const overlay = document.createElement('div');
  overlay.id    = 'mk-viewer-panel';
  overlay.className = 'fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6';
  overlay.innerHTML = `
    <div class="bg-white rounded-lg shadow-2xl flex flex-col" style="width:90vw;height:85vh">
      <div class="flex items-center justify-between px-4 py-3 border-b border-ads-border shrink-0">
        <div>
          <span class="font-medium text-sm text-ads-text">${result.file.name}</span>
          <span class="ml-3 text-xs text-ads-muted">Färgkodning: grön = OK · gul = fel datatyp · orange = saknar värde · grå = saknar param</span>
        </div>
        <button onclick="mkCloseViewer()" class="text-ads-muted hover:text-ads-text p-1">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4 4l12 12M16 4L4 16"/></svg>
        </button>
      </div>
      <div id="mk-viewer-container" class="flex-1 relative"></div>
    </div>`;
  // Escape is left to the viewer (it clears the selection there).
  mkModal(overlay, mkCloseViewer, false);

  setTimeout(() => mkInitViewer('mk-viewer-container', result.versionUrn, result), 50);
}

function mkCloseViewer() {
  if (_mk.viewer) { try { _mk.viewer.finish(); } catch {} _mk.viewer = null; }
  document.getElementById('mk-viewer-panel')?.remove();
}

function mkInitViewer(containerId, versionUrn, result) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (typeof Autodesk === 'undefined' || !Autodesk.Viewing) {
    container.innerHTML = `<div class="flex items-center justify-center h-full text-ads-muted text-sm">
      Visaren kunde inte laddas. Kontrollera nätverksanslutningen.</div>`;
    return;
  }

  const urn = 'urn:' + toSafeBase64(versionUrn);

  Autodesk.Viewing.Initializer(
    { env: 'AutodeskProduction', api: 'derivativeV2', getAccessToken: (cb) => cb(sessionStorage.getItem('aps_token'), 3600) },
    () => {
      const viewer = new Autodesk.Viewing.GuiViewer3D(container);
      viewer.start();
      _mk.viewer = viewer;

      Autodesk.Viewing.Document.load(
        urn,
        (doc) => {
          const geom = doc.getRoot().getDefaultGeometry();
          viewer.loadDocumentNode(doc, geom).then(() => {
            viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => {
              mkColorElements(viewer, result);
            }, { once: true });
          });
        },
        (errCode) => {
          container.innerHTML = `<div class="flex items-center justify-center h-full text-ads-muted text-sm">
            Kunde inte ladda modellen (kod ${errCode}).</div>`;
        }
      );
    }
  );
}

function mkColorElements(viewer, result) {
  const order    = { grey: 0, orange: 1, yellow: 2, green: 3 };
  const levelMap = {};

  for (const pr of result.paramResults) {
    for (const el of pr.elements) {
      const existing = levelMap[el.extId];
      if (!existing || order[pr.level] < order[existing]) {
        levelMap[el.extId] = pr.level;
      }
    }
  }

  const THREE = window.THREE;
  if (!THREE) return;

  const palette = {
    green:  new THREE.Vector4(0.13, 0.77, 0.36, 0.7),
    yellow: new THREE.Vector4(1.0,  0.84, 0.0,  0.7),
    orange: new THREE.Vector4(1.0,  0.55, 0.0,  0.7),
    grey:   new THREE.Vector4(0.65, 0.65, 0.65, 0.5),
  };

  viewer.model.getExternalIdMapping((mapping) => {
    for (const [extId, dbId] of Object.entries(mapping)) {
      const level = levelMap[extId] || 'grey';
      viewer.setThemingColor(dbId, palette[level]);
    }
  }, (err) => console.warn('ExternalId mapping error:', err));
}

// ── Save / Load ───────────────────────────────────────────────────────────────

function mkShowSaveDialog() {
  document.getElementById('mk-save-dialog')?.remove();
  const d = document.createElement('div');
  d.id    = 'mk-save-dialog';
  d.className = 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center';
  d.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl p-6 w-80">
      <h3 class="font-semibold text-ads-text mb-3">Spara kontroll</h3>
      <input id="mk-save-name" type="text" placeholder="Namn på kontrollen…"
             value="${_currentProject?.attributes?.name ? _currentProject.attributes.name + ' – kontroll' : ''}"
             class="w-full border border-ads-border rounded px-3 py-2 text-sm mb-4
                    focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
      <div class="flex justify-end gap-2">
        <button onclick="document.getElementById('mk-save-dialog').remove()"
                class="text-sm text-ads-muted px-3 py-1.5 hover:text-ads-text">Avbryt</button>
        <button onclick="mkDoSave()"
                class="text-sm bg-ads-blue text-white px-4 py-1.5 rounded hover:bg-ads-blue-dark">Spara</button>
      </div>
    </div>`;
  mkModal(d);
  setTimeout(() => document.getElementById('mk-save-name')?.focus(), 50);
}

function mkDoSave() {
  const name = document.getElementById('mk-save-name')?.value?.trim();
  if (!name) return;
  document.getElementById('mk-save-dialog')?.remove();
  if (!_mk.githubToken) { mkShowTokenPrompt('save', name); return; }
  mkSaveCheck(name);
}

async function mkSaveCheck(name) {
  const token = _mk.githubToken;
  try {
    const existing = await githubGetFile(token, MK_CHECKS_PATH);
    const checks   = existing
      ? JSON.parse(atob(existing.content.replace(/\n/g, '')))
      : [];

    checks.unshift({
      id:          String(Date.now()),
      name,
      savedAt:     new Date().toISOString(),
      projectId:   _currentProject.id,
      projectName: _currentProject.attributes.name,
      params:      _mk.refParams.filter(p => p.selected),
      files:       _mk.results.map(r => ({ itemId: r.file.itemId, name: r.file.name, versionUrn: r.versionUrn })),
      results:     _mk.results,
    });

    await githubPutFile(token, MK_CHECKS_PATH, JSON.stringify(checks, null, 2), existing?.sha, `Sparar kontroll: ${name}`);
    mkToast('Kontroll sparad!', 'green');
  } catch (err) {
    mkToast('Fel: ' + err.message, 'red');
  }
}

function mkShowSavedChecks() {
  if (!_mk.githubToken) { mkShowTokenPrompt('load', null); return; }
  mkOpenSavedPanel();
}

async function mkOpenSavedPanel() {
  document.getElementById('mk-saved-panel')?.remove();

  const d = document.createElement('div');
  d.id    = 'mk-saved-panel';
  d.className = 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6';
  d.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl flex flex-col" style="width:640px;max-height:80vh">
      <div class="flex items-center justify-between px-5 py-4 border-b border-ads-border shrink-0">
        <h3 class="font-semibold text-ads-text">Sparade kontroller</h3>
        <button onclick="document.getElementById('mk-saved-panel').remove()" class="text-ads-muted hover:text-ads-text">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4 4l12 12M16 4L4 16"/></svg>
        </button>
      </div>
      <div id="mk-saved-list" class="flex-1 overflow-auto p-5">
        <div class="flex items-center gap-2 text-ads-muted text-sm">
          <svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
            <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
          </svg>Hämtar…
        </div>
      </div>
    </div>`;
  mkModal(d);

  try {
    const file = await githubGetFile(_mk.githubToken, MK_CHECKS_PATH);
    const list = file ? JSON.parse(atob(file.content.replace(/\n/g, ''))) : [];
    const listEl = document.getElementById('mk-saved-list');
    if (!listEl) return;

    // Check for version updates in the background
    mkCheckSavedVersions(list, listEl);

    listEl.innerHTML = list.length === 0
      ? `<p class="text-ads-muted text-sm">Inga sparade kontroller ännu.</p>`
      : list.map((c, ci) => `
          <div class="border border-ads-border rounded-lg p-4 mb-3" id="mk-saved-item-${ci}">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="font-medium text-sm text-ads-text truncate">${c.name}</p>
                <p class="text-xs text-ads-muted mt-0.5">${c.projectName || ''} · ${new Date(c.savedAt).toLocaleDateString('sv-SE')}</p>
                <p class="text-xs text-ads-muted">${c.files?.length || 0} modeller · ${c.params?.length || 0} parametrar</p>
              </div>
              <span id="mk-saved-warn-${ci}" class="shrink-0"></span>
            </div>
          </div>`).join('');
  } catch (err) {
    const listEl = document.getElementById('mk-saved-list');
    if (listEl) listEl.innerHTML = `<p class="text-red-600 text-sm">Fel: ${err.message}</p>`;
  }
}

async function mkCheckSavedVersions(checks, listEl) {
  for (let ci = 0; ci < checks.length; ci++) {
    const c = checks[ci];
    if (!c.files || !c.files.length) continue;
    try {
      for (const f of c.files) {
        if (!f.itemId || !f.versionUrn) continue;
        const rawId = f.itemId.replace(/^mc:/, '');
        const tip   = await getItemTip(c.projectId || _currentProject.id, rawId);
        if (tip.id !== f.versionUrn) {
          const warnEl = document.getElementById(`mk-saved-warn-${ci}`);
          if (warnEl) {
            warnEl.innerHTML = `
              <span title="Nyare version tillgänglig" class="flex items-center gap-1 text-amber-500 text-xs">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8.485 3.495L2.107 14a1 1 0 0 0 .893 1.5h13.8a1 1 0 0 0 .893-1.5L11.515 3.495a1 1 0 0 0-1.73 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M10 8v3M10 14h.01"/>
                </svg>
                Ny version
              </span>`;
          }
          break;
        }
      }
    } catch {}
  }
}

function mkShowApsCredentialsPrompt(onConfirm) {
  document.getElementById('mk-aps-cred-prompt')?.remove();
  const d = document.createElement('div');
  d.id        = 'mk-aps-cred-prompt';
  d.className = 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center';
  d.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl p-6 w-96">
      <h3 class="font-semibold text-ads-text mb-1">APS-credentials krävs</h3>
      <p class="text-xs text-ads-muted mb-4">
        Ange Client ID och Client Secret för Server-to-Server-appen med Model Derivative API-åtkomst.<br/>
        Sparas i webbläsarsessionen och rensas när fliken stängs.
      </p>
      <input id="mk-aps-id-input" type="text" placeholder="Client ID"
             class="w-full border border-ads-border rounded px-3 py-2 text-sm mb-2
                    focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
      <input id="mk-aps-secret-input" type="password" placeholder="Client Secret"
             class="w-full border border-ads-border rounded px-3 py-2 text-sm mb-4
                    focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
      <div class="flex justify-end gap-2">
        <button onclick="document.getElementById('mk-aps-cred-prompt').remove()"
                class="text-sm text-ads-muted px-3 py-1.5 hover:text-ads-text">Avbryt</button>
        <button onclick="mkConfirmApsCredentials()"
                class="text-sm bg-ads-blue text-white px-4 py-1.5 rounded hover:bg-ads-blue-dark">Bekräfta</button>
      </div>
    </div>`;
  mkModal(d);
  _mk._apsCredCallback = onConfirm;
  setTimeout(() => document.getElementById('mk-aps-id-input')?.focus(), 50);
}

function mkConfirmApsCredentials() {
  const id     = document.getElementById('mk-aps-id-input')?.value?.trim();
  const secret = document.getElementById('mk-aps-secret-input')?.value?.trim();
  if (!id || !secret) return;
  _mk.mkClientId     = id;
  _mk.mkClientSecret = secret;
  sessionStorage.setItem('mk_aps_client_id',     id);
  sessionStorage.setItem('mk_aps_client_secret', secret);
  document.getElementById('mk-aps-cred-prompt')?.remove();
  if (_mk._apsCredCallback) { _mk._apsCredCallback(); _mk._apsCredCallback = null; }
}

function mkShowTokenPrompt(action, payload) {
  document.getElementById('mk-token-prompt')?.remove();
  const d = document.createElement('div');
  d.id    = 'mk-token-prompt';
  d.className = 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center';
  d.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl p-6 w-96">
      <h3 class="font-semibold text-ads-text mb-1">GitHub-token krävs</h3>
      <p class="text-xs text-ads-muted mb-4">
        Sparade kontroller lagras som <code class="bg-ads-gray px-1 py-0.5 rounded">saved-checks.json</code> i repot.<br/>
        Skapa ett <strong>Fine-grained personal access token</strong> med <code class="bg-ads-gray px-1 py-0.5 rounded">Contents: Read and write</code>-behörighet för <code class="bg-ads-gray px-1 py-0.5 rounded">forma-super-admin</code>.
      </p>
      <input id="mk-token-input" type="password" placeholder="github_pat_…"
             class="w-full border border-ads-border rounded px-3 py-2 text-sm mb-4
                    focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
      <div class="flex justify-end gap-2">
        <button onclick="document.getElementById('mk-token-prompt').remove()"
                class="text-sm text-ads-muted px-3 py-1.5 hover:text-ads-text">Avbryt</button>
        <button onclick="mkConfirmToken('${action}', ${JSON.stringify(payload)})"
                class="text-sm bg-ads-blue text-white px-4 py-1.5 rounded hover:bg-ads-blue-dark">Bekräfta</button>
      </div>
    </div>`;
  mkModal(d);
  setTimeout(() => document.getElementById('mk-token-input')?.focus(), 50);
}

function mkConfirmToken(action, payload) {
  const token = document.getElementById('mk-token-input')?.value?.trim();
  if (!token) return;
  _mk.githubToken = token;
  sessionStorage.setItem('mk_github_token', token);
  document.getElementById('mk-token-prompt')?.remove();
  if (action === 'save') mkSaveCheck(payload);
  if (action === 'load') mkOpenSavedPanel();
}

// ── Dialogs ───────────────────────────────────────────────────────────────────
// Every dialog can be left without doing anything: its own cancel/close button,
// a click on the dimmed background, or Escape (the topmost dialog closes first).

const _mkModals = [];

function mkModal(d, onClose = () => d.remove(), escape = true) {
  _mkModals.push({ d, onClose, escape });
  d.addEventListener('mousedown', e => { if (e.target === d) onClose(); });
  document.body.appendChild(d);
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  while (_mkModals.length && !document.body.contains(_mkModals[_mkModals.length - 1].d)) _mkModals.pop();
  const top = _mkModals[_mkModals.length - 1];
  if (!top?.escape) return;
  _mkModals.pop();
  e.preventDefault();
  top.onClose();
});

// ── Toast ─────────────────────────────────────────────────────────────────────

function mkToast(message, color = 'green') {
  const cls = color === 'green' ? 'bg-green-600' : 'bg-red-600';
  const t   = document.createElement('div');
  t.className = `fixed bottom-5 right-5 z-[60] text-white text-sm px-4 py-2.5 rounded shadow-lg ${cls} transition-opacity`;
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}
