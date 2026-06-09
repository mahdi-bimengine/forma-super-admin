// ── State ─────────────────────────────────────────────────────────────────────

const _mk = {
  step:          1,
  refFile:       null,
  refParams:     [],        // {name, valueType, comment, paramType, selected}[]
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
  running:       false,
  viewer:        null,
  githubToken:   sessionStorage.getItem('mk_github_token') || null,
};

const MK_CHECKS_PATH = 'saved-checks.json';

// ── Conformity helpers ────────────────────────────────────────────────────────

function mkConformityLevel(exists, hasValue, conforms) {
  if (!exists)   return 'grey';
  if (!hasValue) return 'orange';
  if (!conforms) return 'yellow';
  return 'green';
}

function mkOverallLevel(paramResults) {
  const order = { grey: 0, orange: 1, yellow: 2, green: 3 };
  return paramResults.reduce((worst, p) =>
    order[p.level] < order[worst] ? p.level : worst, 'green');
}

function mkValueConforms(value, valueType) {
  if (value === null || value === undefined) return false;
  const str  = String(value).trim();
  if (!str)  return false;
  const type = (valueType || '').toLowerCase().trim();
  if (type === 'numeric' || type === 'number') return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(str);
  return true; // text / string / alphanumeric — non-empty is sufficient
}

function mkConformityBadge(level) {
  const map    = { green: 'bg-green-100 text-green-700', yellow: 'bg-yellow-100 text-yellow-700', orange: 'bg-orange-100 text-orange-700', grey: 'bg-gray-100 text-gray-500' };
  const labels = { green: 'OK', yellow: 'Typfel', orange: 'Saknar värde', grey: 'Saknar param' };
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
          <p class="text-ads-muted text-sm mt-0.5">Kontrollera modeller mot kravlista för parametrar.</p>
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
    { n: 1, label: 'Referensfil' },
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

// ── Step 1: Reference file ────────────────────────────────────────────────────

function mkRenderStep1() {
  const hasParams = _mk.refParams.length > 0;
  return `
    <div>
      <div class="bg-white border-2 ${hasParams ? 'border-green-300 bg-green-50' : 'border-dashed border-ads-border'} rounded-lg p-8 text-center mb-4"
           ondragover="event.preventDefault()"
           ondrop="event.preventDefault(); if(event.dataTransfer.files[0]) mkHandleRefFile(event.dataTransfer.files[0])">
        ${hasParams ? `
          <svg class="w-7 h-7 text-green-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p class="text-sm font-medium text-green-700">${_mk.refFile?.name || 'Referensfil laddad'}</p>
          <p class="text-xs text-green-600 mt-0.5">${_mk.refParams.length} parametrar funna</p>
          <button onclick="document.getElementById('mk-ref-input').click()" class="mt-2 text-xs text-ads-blue hover:underline">Byt fil</button>
        ` : `
          <svg class="w-8 h-8 text-ads-muted mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <p class="text-sm text-ads-muted mb-1">Dra och släpp CSV eller XLSX-fil hit</p>
          <p class="text-xs text-ads-muted mb-3">Kolumner: Parameternamn, Värdetyp, Kommentar, Instans/Typ/Projekt</p>
          <button onclick="document.getElementById('mk-ref-input').click()"
                  class="text-sm bg-ads-blue text-white px-4 py-1.5 rounded hover:bg-ads-blue-dark transition-colors">
            Välj fil
          </button>
        `}
        <input id="mk-ref-input" type="file" accept=".csv,.xlsx,.xls" class="hidden"
               onchange="if(this.files[0]) mkHandleRefFile(this.files[0])" />
      </div>

      ${hasParams ? mkRenderParamTable() : ''}

      ${hasParams && _mk.refParams.some(p => p.selected) ? `
        <div class="flex justify-end mt-4">
          <button onclick="mkNav(2)"
                  class="bg-ads-blue text-white text-sm px-5 py-2 rounded hover:bg-ads-blue-dark transition-colors">
            Nästa: Välj modeller →
          </button>
        </div>` : ''}
    </div>`;
}

function mkRenderParamTable() {
  const all     = _mk.refParams.every(p => p.selected);
  const partial = !all && _mk.refParams.some(p => p.selected);
  return `
    <div class="bg-white border border-ads-border rounded-lg overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-ads-gray">
          <tr>
            <th class="py-2.5 px-3 w-10">
              <input type="checkbox" ${all ? 'checked' : ''} id="mk-all-cb"
                     onchange="mkToggleAllParams(this.checked)" class="accent-ads-blue" />
            </th>
            <th class="py-2.5 px-3 text-left text-xs font-semibold text-ads-muted uppercase tracking-wide">Parameter</th>
            <th class="py-2.5 px-3 text-left text-xs font-semibold text-ads-muted uppercase tracking-wide">Värdetyp</th>
            <th class="py-2.5 px-3 text-left text-xs font-semibold text-ads-muted uppercase tracking-wide">Param-typ</th>
            <th class="py-2.5 px-3 text-left text-xs font-semibold text-ads-muted uppercase tracking-wide">Kommentar</th>
          </tr>
        </thead>
        <tbody>
          ${_mk.refParams.map((p, i) => `
            <tr class="border-t border-ads-border hover:bg-ads-gray/40 ${p.selected ? '' : 'opacity-50'}">
              <td class="py-2 px-3">
                <input type="checkbox" ${p.selected ? 'checked' : ''} onchange="mkToggleParam(${i})" class="accent-ads-blue" />
              </td>
              <td class="py-2 px-3 font-medium text-ads-text">${p.name}</td>
              <td class="py-2 px-3 text-ads-muted">${p.valueType || '—'}</td>
              <td class="py-2 px-3 text-ads-muted">${p.paramType || '—'}</td>
              <td class="py-2 px-3 text-ads-muted text-xs">${p.comment || ''}</td>
            </tr>`).join('')}
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
  _mk.refParams.forEach(p => { p.selected = checked; });
  const content = document.getElementById('mk-step-content');
  if (content) content.innerHTML = mkRenderStep1();
}

// ── Reference file parsing ────────────────────────────────────────────────────

function mkHandleRefFile(file) {
  _mk.refFile = file;
  const ext   = (file.name.split('.').pop() || '').toLowerCase();
  const reader = new FileReader();

  if (ext === 'csv') {
    reader.onload = e => {
      try {
        _mk.refParams = mkParseCSV(e.target.result);
        renderModellkontroll();
      } catch (err) {
        alert('Kunde inte läsa CSV-fil: ' + err.message);
      }
    };
    reader.readAsText(file, 'UTF-8');
  } else if (ext === 'xlsx' || ext === 'xls') {
    reader.onload = e => {
      try {
        if (typeof XLSX === 'undefined') throw new Error('XLSX-biblioteket laddades inte.');
        const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        _mk.refParams = mkRowsToParams(rows);
        renderModellkontroll();
      } catch (err) {
        alert('Kunde inte läsa XLSX-fil: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    alert('Endast CSV och XLSX stöds.');
  }
}

function mkParseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const rows  = lines.map(line => mkParseCsvLine(line, delim));
  return mkRowsToParams(rows);
}

function mkParseCsvLine(line, delim) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQ = !inQ; }
    else if (line[i] === delim && !inQ) { result.push(cur.trim()); cur = ''; }
    else { cur += line[i]; }
  }
  result.push(cur.trim());
  return result;
}

function mkRowsToParams(rows) {
  if (!rows.length) return [];
  const firstCell = String(rows[0][0] || '').toLowerCase().trim();
  const isHeader  = ['parameter', 'name', 'param', 'property', 'namn', 'parametrar'].some(h => firstCell.includes(h));
  return (isHeader ? rows.slice(1) : rows)
    .filter(row => row[0] && String(row[0]).trim())
    .map(row => ({
      name:      String(row[0] || '').trim(),
      valueType: String(row[1] || 'text').trim() || 'text',
      comment:   String(row[2] || '').trim(),
      paramType: String(row[3] || '').trim(),
      selected:  true,
    }));
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
                  class="w-full text-sm border border-ads-border bg-white text-ads-muted rounded py-1.5 hover:text-ads-text transition-colors">
            ← Tillbaka
          </button>
          ${_mk.selectedFiles.length > 0 ? `
            <button onclick="mkStartCheck()"
                    class="w-full text-sm bg-ads-blue text-white rounded py-1.5 hover:bg-ads-blue-dark transition-colors">
              Kör kontroll →
            </button>` : ''}
        </div>
      </div>
    </div>`;
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
  el.innerHTML = mkRenderTreeItems(st.items, 0);
}

function mkRenderTreeItems(items, depth) {
  const base = 12 + depth * 20;
  return items.map(item => {
    if (item.attributes?.hidden) return '';

    if (item.type === 'folders') {
      const st      = _mk.folderState[item.id] || {};
      const exp     = st.expanded || false;
      const loading = st.loading  || false;
      const name    = item.attributes.displayName || item.attributes.name || '';
      const i       = mkFid(item.id);
      return `
        <div onclick="mkToggleFolder(${i})"
             class="flex items-center gap-2 py-1.5 pr-4 rounded hover:bg-ads-gray cursor-pointer select-none"
             style="padding-left:${base}px">
          <svg class="w-3.5 h-3.5 shrink-0 text-ads-muted transition-transform ${exp ? 'rotate-90' : ''}"
               fill="none" viewBox="0 0 20 20">
            <path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/>
          </svg>
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
              class="w-full text-sm border border-ads-border bg-white text-ads-muted rounded py-1.5 hover:text-ads-text transition-colors">
        ← Tillbaka
      </button>
      ${_mk.selectedFiles.length > 0 ? `
        <button onclick="mkStartCheck()"
                class="w-full text-sm bg-ads-blue text-white rounded py-1.5 hover:bg-ads-blue-dark transition-colors">
          Kör kontroll →
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

    const manifest = await getManifest(versionUrn);
    if (!manifest) { result.status = 'no-derivative'; return result; }

    const metadata = await getDerivativeMetadata(versionUrn);
    if (!metadata || !metadata.length) { result.status = 'no-views'; return result; }

    const view = metadata.find(m => m.role === '3d') || metadata.find(m => m.role === '2d') || metadata[0];

    const collection     = await getDerivativeProperties(versionUrn, view.guid);
    result.elementCount  = collection.length;

    for (const param of params) {
      result.paramResults.push(mkCheckParam(param, collection));
    }

    result.status = 'done';
  } catch (err) {
    result.status = 'error';
    result.error  = err.message;
  }

  return result;
}

function mkCheckParam(param, collection) {
  const elements = [];

  for (const obj of collection) {
    if (!obj.properties) continue;
    for (const cat of Object.values(obj.properties)) {
      if (typeof cat !== 'object' || Array.isArray(cat)) continue;
      if (param.name in cat) {
        const value = cat[param.name];
        elements.push({
          dbId:     obj.objectid,
          name:     obj.name || '',
          extId:    obj.externalId || '',
          value,
          conforms: mkValueConforms(value, param.valueType),
        });
        break;
      }
    }
  }

  const withValue   = elements.filter(e => e.value !== null && e.value !== undefined && String(e.value).trim() !== '');
  const conforming  = withValue.filter(e => e.conforms);
  const exists      = elements.length > 0;
  const hasValue    = withValue.length > 0;
  const conforms    = hasValue && conforming.length === withValue.length;

  return {
    param,
    exists,
    hasValue,
    conforms,
    level:        mkConformityLevel(exists, hasValue, conforms),
    elements,
    totalCount:   collection.length,
    existCount:   elements.length,
    valueCount:   withValue.length,
    conformCount: conforming.length,
  };
}

// ── Step 3: Results render ────────────────────────────────────────────────────

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
                  class="text-sm border border-ads-border bg-white text-ads-muted rounded px-3 py-1.5 hover:text-ads-text transition-colors">
            ← Ändra urval
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
      <div id="mk-results">${_mk.results.map((r, i) => mkResultCard(r, i)).join('')}</div>
    </div>`;
}

function mkResultCard(result, i) {
  const level = result.status === 'done' ? mkOverallLevel(result.paramResults) : 'grey';
  const borderCls = { green: 'border-green-200', yellow: 'border-yellow-200', orange: 'border-orange-200', grey: 'border-ads-border' };

  if (result.status === 'error') {
    return `<div class="mb-3 p-4 border border-red-200 bg-red-50 rounded-lg">
      <div class="flex items-center justify-between">
        <span class="font-medium text-sm text-ads-text">${result.file.name}</span>
        <span class="text-xs text-red-600 font-medium">Fel</span>
      </div>
      <p class="text-xs text-red-600 mt-1">${result.error}</p>
    </div>`;
  }

  if (result.status === 'no-derivative') {
    return `<div class="mb-3 p-4 border border-amber-200 bg-amber-50 rounded-lg">
      <div class="flex items-center gap-2">
        <svg class="w-4 h-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.485 3.495L2.107 14a1 1 0 0 0 .893 1.5h13.8a1 1 0 0 0 .893-1.5L11.515 3.495a1 1 0 0 0-1.73 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M10 8v3M10 14h.01"/>
        </svg>
        <span class="font-medium text-sm text-ads-text">${result.file.name}</span>
      </div>
      <p class="text-xs text-amber-700 mt-1 ml-6">Ingen derivat hittad. Öppna modellen i ACC-visaren minst en gång för att aktivera parameterläsning.</p>
    </div>`;
  }

  if (result.status === 'no-views') {
    return `<div class="mb-3 p-4 border border-ads-border rounded-lg">
      <span class="font-medium text-sm text-ads-text">${result.file.name}</span>
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
          <span class="text-xs text-ads-muted">${okCount}/${result.paramResults.length} OK</span>
          <span class="text-xs text-ads-muted">${result.elementCount} elem.</span>
          <svg class="w-4 h-4 text-ads-muted transition-transform ${expanded ? 'rotate-180' : ''}"
               fill="none" viewBox="0 0 20 20">
            <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M5 8l5 5 5-5"/>
          </svg>
        </div>
      </div>
      ${expanded ? mkResultDetail(result, i) : ''}
    </div>`;
}

function mkResultDetail(result, modelIdx) {
  const rows = result.paramResults.map(p => `
    <tr class="border-t border-ads-border">
      <td class="py-2 px-3 text-sm font-medium text-ads-text">${p.param.name}</td>
      <td class="py-2 px-3 text-center text-sm">${p.exists ? '<span class="text-green-600">✓</span>' : '<span class="text-red-400">✗</span>'}</td>
      <td class="py-2 px-3 text-center text-sm">${p.hasValue ? '<span class="text-green-600">✓</span>' : '<span class="text-ads-muted">—</span>'}</td>
      <td class="py-2 px-3 text-center text-sm">${p.hasValue ? (p.conforms ? '<span class="text-green-600">✓</span>' : '<span class="text-red-400">✗</span>') : '<span class="text-ads-muted">—</span>'}</td>
      <td class="py-2 px-3">${mkConformityBadge(p.level)}</td>
      <td class="py-2 px-3 text-xs text-ads-muted">${p.existCount}/${p.totalCount}</td>
    </tr>`).join('');

  return `
    <div class="border-t border-ads-border">
      <table class="w-full text-xs">
        <thead>
          <tr class="bg-ads-gray text-ads-muted">
            <th class="py-2 px-3 text-left font-semibold">Parameter</th>
            <th class="py-2 px-3 text-center font-semibold w-16">Finns</th>
            <th class="py-2 px-3 text-center font-semibold w-16">Värde</th>
            <th class="py-2 px-3 text-center font-semibold w-16">Typkrav</th>
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
          <span class="ml-3 text-xs text-ads-muted">Färgkodning: grön = OK · gul = typfel · orange = saknar värde · grå = saknar param</span>
        </div>
        <button onclick="mkCloseViewer()" class="text-ads-muted hover:text-ads-text p-1">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4 4l12 12M16 4L4 16"/></svg>
        </button>
      </div>
      <div id="mk-viewer-container" class="flex-1 relative"></div>
    </div>`;
  document.body.appendChild(overlay);

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
  document.body.appendChild(d);
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
  document.body.appendChild(d);

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
  document.body.appendChild(d);
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

// ── Toast ─────────────────────────────────────────────────────────────────────

function mkToast(message, color = 'green') {
  const cls = color === 'green' ? 'bg-green-600' : 'bg-red-600';
  const t   = document.createElement('div');
  t.className = `fixed bottom-5 right-5 z-[60] text-white text-sm px-4 py-2.5 rounded shadow-lg ${cls} transition-opacity`;
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}
