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
    const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return { email: payload.email || payload.preferred_username || '' };
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

function showApp(profile) {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app-header').classList.remove('hidden');
  document.getElementById('sidebar').classList.add('hidden');

  const email = profile?.emailId || profile?.email || '';
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
        <span class="text-ads-blue text-xs font-medium group-hover:underline">Öppna →</span>
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

function selectProject(projectId) {
  const hub     = _hubs[_hubIdx];
  const project = _projCache[hub?.id]?.find(p => p.id === projectId);
  renderProjectView(project);
}

function renderProjectView(project) {
  const name    = project?.attributes?.name || 'Projekt';
  const sidebar = document.getElementById('sidebar');
  const main    = document.getElementById('main-content');

  sidebar.classList.remove('hidden');
  sidebar.innerHTML = `
    <button
      onclick="showProjectPicker()"
      class="w-full text-left px-3 py-2 rounded text-sm text-ads-muted hover:bg-ads-gray
             transition-colors flex items-center gap-1.5 mb-1"
    >← Projekt</button>
    <div class="border-t border-ads-border my-1.5 mx-1"></div>
    <button class="w-full text-left px-3 py-2 rounded text-sm bg-ads-gray text-ads-blue font-medium">
      Översikt
    </button>`;

  main.innerHTML = `
    <div class="p-8">
      <button onclick="showProjectPicker()"
              class="flex items-center gap-1 text-ads-blue text-sm hover:underline mb-6">
        ← Alla projekt
      </button>
      <h1 class="text-base font-semibold text-ads-text mb-2">${name}</h1>
      <p class="text-ads-muted text-sm">Projektverktyg kommer snart.</p>
    </div>`;
}

boot();
