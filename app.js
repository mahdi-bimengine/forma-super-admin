const CLIENT_ID     = 'F2lSjFPEgbJyvjCS9xFOwel7EFEbs98ayGAjnnc6lVOVvmtO';
const REDIRECT_URI  = 'https://mahdi-bimengine.github.io/forma-super-admin/';
const APS_AUTH_URL  = 'https://developer.api.autodesk.com/authentication/v2/authorize';
const APS_TOKEN_URL = 'https://developer.api.autodesk.com/authentication/v2/token';
const SCOPES        = 'openid data:read user-profile:read';

// ── Project picker state ───────────────────────────────────────────────────────

let _hubs      = [];
let _hubIdx    = 0;
let _projCache = {};  // hubId → project[]

// ── Auth ───────────────────────────────────────────────────────────────────────

function getStoredToken() {
  return sessionStorage.getItem('aps_token');
}

function storeToken(token) {
  sessionStorage.setItem('aps_token', token);
}

function logout() {
  sessionStorage.removeItem('aps_token');
  sessionStorage.removeItem('aps_id_token');
  window.location.href = window.location.pathname;
}

function decodeIdToken(idToken) {
  if (!idToken) return {};
  try {
    const p = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      email: p.email || p.preferred_username || '',
      name:  p.name  || p.given_name         || '',
    };
  } catch {
    return {};
  }
}

function base64urlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function login() {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier  = base64urlEncode(verifierBytes);
  const challenge = base64urlEncode(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  );

  localStorage.setItem('pkce_verifier', verifier);

  window.location.href = `${APS_AUTH_URL}?` + new URLSearchParams({
    response_type:         'code',
    client_id:             CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    scope:                 SCOPES,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });
}

async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem('pkce_verifier');
  if (!verifier) throw new Error('PKCE verifier missing — please try signing in again.');
  localStorage.removeItem('pkce_verifier');

  const res = await fetch(APS_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     CLIENT_ID,
      code,
      redirect_uri:  REDIRECT_URI,
      code_verifier: verifier,
    }).toString(),
  });

  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (data.id_token) sessionStorage.setItem('aps_id_token', data.id_token);
  return data.access_token;
}

async function captureTokenFromUrl() {
  const search = new URLSearchParams(window.location.search);

  const code = search.get('code');
  if (code) {
    window.history.replaceState({}, '', window.location.pathname);
    const token = await exchangeCodeForToken(code);
    storeToken(token);
    return token;
  }

  return null;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function boot() {
  const hasCode = new URLSearchParams(window.location.search).has('code');

  let token;
  try {
    token = await captureTokenFromUrl();
  } catch (err) {
    showAccessDenied(err.message);
    return;
  }

  if (!hasCode) token = token || getStoredToken();

  if (!token) {
    document.getElementById('login-page').classList.remove('hidden');
    return;
  }

  setToken(token);

  const profile = decodeIdToken(sessionStorage.getItem('aps_id_token'));
  showApp(profile);
}

function showAccessDenied(message) {
  const page = document.getElementById('login-page');
  page.classList.remove('hidden');
  page.innerHTML = `
    <div class="bg-white rounded shadow-sm border border-ads-border w-full max-w-sm p-8 flex flex-col items-center gap-5 text-center">
      <img src="logo.png" alt="BIM Engine" class="h-14 w-auto" />
      <div>
        <div class="font-semibold text-ads-text">Access denied</div>
        <p class="text-ads-muted text-xs mt-1">${message}</p>
      </div>
      <button onclick="logout()" class="text-xs text-ads-blue hover:underline">Sign in with a different account</button>
    </div>`;
}

let _profile = {};

function showApp(profile) {
  _profile = profile;
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app-header').classList.remove('hidden');
  document.getElementById('sidebar').classList.add('hidden');

  const email = profile?.email || '';
  document.getElementById('user-label').textContent = email;

  showProjectPicker();
}

// ── Project picker ─────────────────────────────────────────────────────────────

async function showProjectPicker() {
  document.getElementById('sidebar').classList.add('hidden');

  document.getElementById('main-content').innerHTML = `
    <div class="max-w-5xl mx-auto px-6 py-8">

      <div class="flex items-center gap-3.5 mb-7">
        <span class="text-ads-muted text-sm">Konto</span>
        <div class="relative">
          <button
            id="account-switcher-btn"
            onclick="toggleAccountMenu(event)"
            class="inline-flex items-center gap-1.5 bg-white border border-ads-border rounded px-3 py-1.5
                   text-sm font-medium text-ads-text hover:border-ads-blue transition-colors"
          >
            <span id="account-name">Laddar…</span>
            <svg class="w-3.5 h-3.5 text-ads-muted" fill="none" viewBox="0 0 20 20">
              <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M5 8l5 5 5-5"/>
            </svg>
          </button>
          <ul id="account-menu"
              class="hidden absolute left-0 top-full mt-1 bg-white border border-ads-border
                     rounded shadow-lg z-50 min-w-[200px] py-1"
              role="menu">
          </ul>
        </div>
      </div>

      <div class="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h2 class="text-lg font-semibold text-ads-text">Välj projekt</h2>
        <div class="relative">
          <label for="project-search" class="sr-only">Sök projekt</label>
          <svg class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ads-muted"
               fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="6"/><path stroke-linecap="round" d="M20 20l-3-3"/>
          </svg>
          <input
            id="project-search"
            type="search"
            placeholder="sök projekt…"
            oninput="filterProjects()"
            class="pl-8 pr-3 py-1.5 border border-ads-border rounded text-sm w-52
                   focus:outline-none focus:ring-1 focus:ring-ads-blue focus:border-ads-blue"
          />
        </div>
      </div>

      <div id="project-grid"></div>
    </div>`;

  await loadPickerData();
}

async function loadPickerData(hubIdx) {
  if (hubIdx !== undefined) _hubIdx = hubIdx;

  const gridEl = document.getElementById('project-grid');
  if (!gridEl) return;

  renderSkeletons(gridEl);

  try {
    if (_hubs.length === 0) {
      _hubs = await listHubs();
    }

    if (_hubs.length === 0) {
      gridEl.innerHTML = centeredMsg('Inga projekt i det här kontot.');
      return;
    }

    const hub = _hubs[_hubIdx];

    const nameEl = document.getElementById('account-name');
    if (nameEl) nameEl.textContent = hub.attributes.name;

    if (!_projCache[hub.id]) {
      _projCache[hub.id] = await listProjects(hub.id);
    }

    renderProjectGrid(_projCache[hub.id]);

  } catch (err) {
    const idx = _hubIdx;
    if (gridEl) gridEl.innerHTML = `
      <div class="text-center py-16">
        <p class="text-ads-muted text-sm mb-3">Det gick inte att hämta projekten.</p>
        <button onclick="loadPickerData(${idx})" class="text-ads-blue text-sm hover:underline">Försök igen</button>
      </div>`;
  }
}

function filterProjects() {
  const hub = _hubs[_hubIdx];
  if (!hub || !_projCache[hub.id]) return;
  renderProjectGrid(_projCache[hub.id], document.getElementById('project-search')?.value || '');
}

function renderSkeletons(container) {
  container.innerHTML = `
    <div class="grid gap-4" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
      ${Array.from({ length: 6 }, () => `
        <div class="bg-white border border-ads-border rounded-lg p-5 animate-pulse">
          <div class="h-4 bg-slate-200 rounded w-3/4 mb-2.5"></div>
          <div class="h-3 bg-slate-200 rounded w-2/5 mb-5"></div>
          <div class="flex gap-1.5">
            <div class="h-5 bg-slate-200 rounded-full w-14"></div>
            <div class="h-5 bg-slate-200 rounded-full w-10"></div>
          </div>
        </div>`).join('')}
    </div>`;
}

function centeredMsg(text) {
  return `<p class="text-center text-ads-muted text-sm py-16">${text}</p>`;
}

function renderProjectGrid(projects, query = '') {
  const gridEl = document.getElementById('project-grid');
  if (!gridEl) return;

  const q = query.trim().toLowerCase();
  const visible = q
    ? projects.filter(p => (p.attributes.name || '').toLowerCase().includes(q))
    : projects;

  if (!visible.length) {
    gridEl.innerHTML = centeredMsg(q ? 'Inga projekt matchar din sökning.' : 'Inga projekt i det här kontot.');
    return;
  }

  gridEl.innerHTML = `
    <div class="grid gap-4" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
      ${visible.map(projectCard).join('')}
    </div>`;
}

const STATUS_MAP = {
  active:   { label: 'Aktivt',    dot: 'bg-green-500', pill: 'bg-green-50 text-green-700'   },
  planning: { label: 'Planering', dot: 'bg-amber-400', pill: 'bg-amber-50 text-amber-700'   },
  dormant:  { label: 'Vilande',   dot: 'bg-gray-400',  pill: 'bg-slate-100 text-slate-500'  },
};

function normalizeStatus(raw) {
  const r = (raw || '').toLowerCase();
  if (r === 'active') return 'active';
  if (r === 'planning' || r === 'creating') return 'planning';
  return 'dormant';
}

function inferModules(p) {
  const ext = (p?.attributes?.extension?.type || '').toLowerCase();
  if (ext.includes('acc')) return ['Docs', 'Build', 'Model'];
  if (ext.includes('bim360')) return ['Docs', 'Build'];
  return [];
}

function projectCard(p) {
  const name   = p.attributes.name || '(namnlöst)';
  const status = normalizeStatus(p.attributes.status);
  const { label, dot, pill } = STATUS_MAP[status];
  const tags   = inferModules(p);
  const safeId = p.id.replace(/'/g, "\\'");

  return `
    <button
      onclick="selectProject('${safeId}')"
      class="group w-full bg-white border border-ads-border rounded-lg p-5 text-left
             hover:-translate-y-0.5 hover:shadow-md transition-all duration-150
             focus:outline-none focus:ring-2 focus:ring-ads-blue focus:ring-offset-1"
      aria-label="${name}"
    >
      <h3 class="font-semibold text-ads-text text-sm leading-snug mb-2 line-clamp-2">${name}</h3>
      <div class="mb-3">
        <span class="inline-flex items-center gap-1.5 ${pill} text-xs px-2 py-0.5 rounded-full font-medium">
          <span class="${dot} w-1.5 h-1.5 rounded-full shrink-0"></span>${label}
        </span>
      </div>
      <div class="flex flex-wrap gap-1 min-h-[22px] mb-4">
        ${tags.map(t => `<span class="bg-ads-gray text-ads-muted text-xs px-2 py-0.5 rounded-full">${t}</span>`).join('')}
      </div>
      <div class="flex justify-end border-t border-ads-border pt-3">
        <span class="inline-flex items-center gap-1 text-ads-blue text-xs font-medium group-hover:underline">Öppna <svg class="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"/></svg></span>
      </div>
    </button>`;
}

function toggleAccountMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('account-menu');
  if (!menu || _hubs.length <= 1) return;

  const isOpen = !menu.classList.contains('hidden');

  if (isOpen) {
    menu.classList.add('hidden');
    return;
  }

  menu.innerHTML = _hubs.map((h, i) => `
    <li role="menuitem">
      <button
        onclick="switchHub(${i})"
        class="w-full text-left px-4 py-2 text-sm hover:bg-ads-gray transition-colors ${
          i === _hubIdx ? 'font-semibold text-ads-blue' : 'text-ads-text'
        }"
      >${h.attributes.name}</button>
    </li>`).join('');

  menu.classList.remove('hidden');

  setTimeout(() => {
    document.addEventListener('click', function closeMenu() {
      document.getElementById('account-menu')?.classList.add('hidden');
      document.removeEventListener('click', closeMenu);
    });
  }, 0);
}

function switchHub(idx) {
  document.getElementById('account-menu')?.classList.add('hidden');
  const searchEl = document.getElementById('project-search');
  if (searchEl) searchEl.value = '';
  loadPickerData(idx);
}

let _currentProject = null;

// ── Modellkontroll state ───────────────────────────────────────────────────────

let _folderState  = {};   // folderId | '__top__' → { items, expanded, loaded, loading }
let _itemsById    = {};   // item.id → item
let _modelFilter  = null; // null | 'rvt' | 'ifc' | 'dwg'
let _selectedFile = null;
let _fids         = [];   // numeric index → original ID (for onclick safety)

function fid(id) {
  const i = _fids.indexOf(id);
  if (i !== -1) return i;
  return _fids.push(id) - 1;
}

function fidLookup(i) { return _fids[i]; }

// ──────────────────────────────────────────────────────────────────────────────

function selectProject(projectId) {
  const hub     = _hubs[_hubIdx];
  const project = _projCache[hub?.id]?.find(p => p.id === projectId);
  renderProjectView(project);
}

function renderProjectView(project) {
  _currentProject = project;
  _folderState    = {};
  _itemsById      = {};
  _selectedFile   = null;
  _fids           = [];
  mkReset();
  grReset();
  vkReset();
  renderSidebar('overview');
  renderOverview();
}

function renderSidebar(activeTab) {
  const sidebar  = document.getElementById('sidebar');
  sidebar.classList.remove('hidden');

  const hubName  = _hubs[_hubIdx]?.attributes?.name || 'BIM Engine';
  const projName = _currentProject?.attributes?.name || 'Projekt';
  const email    = _profile?.email || '';
  const name     = _profile?.name  || email.split('@')[0] || '?';
  const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';

  const ICONS = {
    grid:   `<svg class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="7" height="7" rx="1"/><rect x="11" y="2" width="7" height="7" rx="1"/><rect x="2" y="11" width="7" height="7" rx="1"/><rect x="11" y="11" width="7" height="7" rx="1"/></svg>`,
    folder: `<svg class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2 7a2 2 0 0 1 2-2h3.17a2 2 0 0 1 1.42.59l.82.82A2 2 0 0 0 10.83 7H16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7z"/></svg>`,
    clock:  `<svg class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="8"/><path stroke-linecap="round" stroke-linejoin="round" d="M10 6v4l2.5 2.5"/></svg>`,
    cube:   `<svg class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M10 2l7 3.5v9L10 18l-7-3.5v-9L10 2z"/><path stroke-linecap="round" stroke-linejoin="round" d="M10 2v16M3 5.5l7 3.5 7-3.5"/></svg>`,
    layers: `<svg class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2 7l8-4 8 4-8 4-8-4z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2 11l8 4 8-4"/><path stroke-linecap="round" stroke-linejoin="round" d="M2 15l8 4 8-4"/></svg>`,
    sheet:  `<svg class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="3" width="15" height="14" rx="1.5"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.5 13.5h9v3.5M11.5 13.5h6"/><path stroke-linecap="round" stroke-linejoin="round" d="M13 6.5h3M13 9h3"/></svg>`,
    week:   `<svg class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="4" width="15" height="13.5" rx="1.5"/><path stroke-linecap="round" d="M2.5 8h15M6.5 2.5v3M13.5 2.5v3"/><path stroke-linecap="round" stroke-linejoin="round" d="M7 12.5l1.8 1.8L13 10"/></svg>`,
  };

  const navItem = (tab, label, icon) => {
    const active = activeTab === tab;
    return `
      <button onclick="showTab('${tab}')"
              class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-sm transition-colors
                     ${active
                       ? 'border border-ads-border bg-white shadow-sm text-ads-text font-medium'
                       : 'border border-transparent text-ads-muted hover:bg-ads-gray'}">
        <span class="${active ? 'text-ads-blue' : ''}">${icon}</span>
        ${label}
      </button>`;
  };

  sidebar.innerHTML = `
    <div class="px-4 pt-3 pb-3 border-b border-dashed border-ads-border shrink-0">
      <p class="text-[10px] font-semibold uppercase tracking-widest text-orange-400 mb-0.5">${hubName}</p>
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-semibold text-be-charcoal truncate">${projName}</p>
        <button onclick="showProjectPicker()" title="Byt projekt"
                class="shrink-0 text-ads-muted hover:text-ads-text transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-auto px-2 pt-3 pb-2">
      <p class="text-[10px] uppercase tracking-widest text-ads-muted px-2.5 mb-1.5">Verktyg</p>
      ${navItem('overview',        'Översikt',        ICONS.grid)}
      ${navItem('data-management', 'Data Management', ICONS.folder)}
      ${navItem('issues',          'Issues',          ICONS.clock)}
      ${navItem('modelldata',      'Modellkontroll',  ICONS.cube)}
      ${navItem('ritningsgranskning', 'Ritningsgranskning', ICONS.sheet)}
      ${navItem('veckokontroll',   'Veckokontroll',   ICONS.week)}
      ${navItem('assets',          'Assets',          ICONS.layers)}
    </div>

    <div class="border-t border-ads-border px-3 py-2.5 flex items-center gap-2.5 shrink-0">
      <div class="w-7 h-7 rounded-full bg-be-charcoal text-white flex items-center justify-center
                  text-xs font-bold shrink-0">${initials}</div>
      <div class="min-w-0">
        <p class="text-xs font-medium text-ads-text truncate">${name}</p>
        <p class="text-[10px] text-ads-muted truncate">${email}</p>
      </div>
    </div>`;
}

function showTab(tab) {
  renderSidebar(tab);
  if (tab === 'overview')        renderOverview();
  if (tab === 'modelldata')      renderModelldata();
  if (tab === 'ritningsgranskning') renderRitningsgranskning();
  if (tab === 'veckokontroll')   vkOppnaFlik();
  if (tab === 'data-management') renderPlaceholder('Data Management');
  if (tab === 'issues')          renderPlaceholder('Issues');
  if (tab === 'assets')          renderPlaceholder('Assets');
}

function renderPlaceholder(label) {
  document.getElementById('main-content').innerHTML = `
    <div class="p-8">
      <h2 class="text-lg font-semibold text-ads-text mb-1">${label}</h2>
      <p class="text-ads-muted text-sm">Kommer snart.</p>
    </div>`;
}

function renderOverview() {
  const name = _currentProject?.attributes?.name || 'Projekt';
  document.getElementById('main-content').innerHTML = `
    <div class="p-8">
      <h1 class="text-base font-semibold text-ads-text mb-2">${name}</h1>
      <p class="text-ads-muted text-sm">Projektverktyg kommer snart.</p>
    </div>`;
}

// ── Modelldata ─────────────────────────────────────────────────────────────────

const EXT_BADGE = {
  rvt: 'bg-blue-50 text-blue-600',
  ifc: 'bg-emerald-50 text-emerald-600',
  dwg: 'bg-orange-50 text-orange-600',
};

function fileExt(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

function extBadge(ext) {
  const cls = EXT_BADGE[ext];
  if (!cls) return '';
  return `<span class="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls} uppercase tracking-wide">${ext}</span>`;
}

function renderChips() {
  return [
    { value: null,  label: 'Alla' },
    { value: 'rvt', label: 'RVT'  },
    { value: 'ifc', label: 'IFC'  },
    { value: 'dwg', label: 'DWG'  },
  ].map(({ value, label }) => {
    const active  = _modelFilter === value;
    const onclick = value === null ? `setModelFilter(null)` : `setModelFilter('${value}')`;
    return `<button onclick="${onclick}"
      class="px-3 py-1 rounded-full text-xs font-medium border transition-colors
             ${active
               ? 'bg-ads-blue border-ads-blue text-white'
               : 'bg-white border-ads-border text-ads-muted hover:border-ads-blue hover:text-ads-blue'}"
    >${label}</button>`;
  }).join('');
}

function renderTreeItems(items, depth) {
  const base = 12 + depth * 20;

  return items.map(item => {
    if (item.attributes?.hidden) return '';

    if (item.type === 'folders') {
      const st      = _folderState[item.id] || {};
      const exp     = st.expanded  || false;
      const loading = st.loading   || false;
      const name    = item.attributes.displayName || item.attributes.name || '';
      const i       = fid(item.id);

      return `
        <div onclick="toggleFolder(${i})"
             class="flex items-center gap-2 py-1.5 pr-4 rounded hover:bg-ads-gray cursor-pointer select-none"
             style="padding-left:${base}px">
          <svg class="w-3.5 h-3.5 shrink-0 text-ads-muted transition-transform duration-150 ${exp ? 'rotate-90' : ''}"
               fill="none" viewBox="0 0 20 20">
            <path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/>
          </svg>
          <svg class="w-4 h-4 shrink-0 text-amber-400" viewBox="0 0 20 15" fill="currentColor">
            <path d="M0 2.5A1.5 1.5 0 0 1 1.5 1h4.764a1.5 1.5 0 0 1 1.06.44l.94.94A1.5 1.5 0 0 0 9.322 3H18.5A1.5 1.5 0 0 1 20 4.5v8A1.5 1.5 0 0 1 18.5 14H1.5A1.5 1.5 0 0 1 0 12.5v-10z"/>
          </svg>
          <span class="text-sm text-ads-text truncate flex-1">${name}</span>
          ${loading ? `<span class="text-xs text-ads-muted">laddar…</span>` : ''}
        </div>
        ${exp ? renderTreeItems(st.items || [], depth + 1) : ''}`;
    }

    if (item.type === 'items') {
      const name = item.attributes.displayName || item.attributes.name || '';
      const ext  = fileExt(name);
      if (_modelFilter && ext !== _modelFilter) return '';

      const selected = _selectedFile?.id === item.id;
      const i        = fid(item.id);

      return `
        <div onclick="selectFile(${i})"
             class="flex items-center gap-2 py-1.5 pr-4 rounded cursor-pointer select-none
                    ${selected ? 'bg-blue-50' : 'hover:bg-ads-gray'}"
             style="padding-left:${base + 23}px">
          <svg class="w-4 h-4 shrink-0 ${selected ? 'text-ads-blue' : 'text-ads-muted'}"
               viewBox="0 0 16 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round"
                  d="M9.5 1H3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6.5L9.5 1z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.5 1v5.5H15"/>
          </svg>
          <span class="text-sm ${selected ? 'text-ads-blue font-medium' : 'text-ads-text'} truncate flex-1">${name}</span>
          ${extBadge(ext)}
        </div>`;
    }

    return '';
  }).join('');
}

function refreshFileBrowser() {
  const el = document.getElementById('file-browser');
  if (!el) return;
  const st = _folderState['__top__'];

  if (!st || st.loading) {
    el.innerHTML = `
      <div class="flex items-center gap-2 px-4 py-6 text-ads-muted text-sm">
        <svg class="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
          <path stroke="currentColor" stroke-width="3" stroke-linecap="round"
                d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
        </svg>
        Laddar mappar…
      </div>`;
    return;
  }

  if (!st.items.length) {
    el.innerHTML = `<p class="text-ads-muted text-sm px-4 py-6">Inga mappar hittades.</p>`;
    return;
  }

  el.innerHTML = renderTreeItems(st.items, 0);
}

function setModelFilter(f) {
  _modelFilter = f;
  const chipsEl = document.getElementById('filter-chips');
  if (chipsEl) chipsEl.innerHTML = renderChips();
  refreshFileBrowser();
}

async function toggleFolder(idx) {
  const id = fidLookup(idx);
  const st = _folderState[id] || { items: [], expanded: false, loaded: false, loading: false };

  if (!st.loaded) {
    _folderState[id] = { ...st, expanded: true, loading: true };
    refreshFileBrowser();
    try {
      const contents = await getFolderContents(_currentProject.id, id);
      contents.forEach(item => { _itemsById[item.id] = item; });
      _folderState[id] = { items: contents, expanded: true, loaded: true, loading: false };
    } catch {
      _folderState[id] = { ...st, expanded: false, loaded: false, loading: false };
    }
  } else {
    _folderState[id] = { ...st, expanded: !st.expanded };
  }

  refreshFileBrowser();
}

function selectFile(idx) {
  const id = fidLookup(idx);
  _selectedFile = _selectedFile?.id === id ? null : (_itemsById[id] || { id });
  refreshFileBrowser();
}

async function loadTopFolders() {
  _folderState['__top__'] = { loading: true, loaded: false, items: [] };
  refreshFileBrowser();
  try {
    const hub   = _hubs[_hubIdx];
    const items = await getTopFolders(hub.id, _currentProject.id);
    items.forEach(item => { _itemsById[item.id] = item; });
    _folderState['__top__'] = { loading: false, loaded: true, items };
  } catch (err) {
    const el = document.getElementById('file-browser');
    if (el) el.innerHTML = `<p class="text-ads-muted text-sm px-4 py-6">Fel: ${err.message}</p>`;
    return;
  }
  refreshFileBrowser();
}

function renderModelldata() {
  renderModellkontroll();
}

boot();
