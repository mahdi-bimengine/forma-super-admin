const NAV_ITEMS = [
  { id: 'projects', label: 'Projects' },
];

const ALLOWLIST = ['mahdi@bimengine.se', 'adrian@bimengine.se', 'edmon@bimengine.se'];

const CLIENT_ID     = 'F2lSjFPEgbJyvjCS9xFOwel7EFEbs98ayGAjnnc6lVOVvmtO';
const REDIRECT_URI  = 'https://mahdi-bimengine.github.io/forma-super-admin/';
const APS_AUTH_URL  = 'https://developer.api.autodesk.com/authentication/v2/authorize';
const APS_TOKEN_URL = 'https://developer.api.autodesk.com/authentication/v2/token';
const SCOPES        = 'data:read';

// ── Auth ──────────────────────────────────────────────────────────────────────

function getStoredToken() {
  return sessionStorage.getItem('aps_token');
}

function storeToken(token) {
  sessionStorage.setItem('aps_token', token);
}

function logout() {
  sessionStorage.removeItem('aps_token');
  window.location.href = window.location.pathname;
}

function base64urlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function openAuthPopup() {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier  = base64urlEncode(verifierBytes);
  const challenge = base64urlEncode(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  );

  localStorage.setItem('pkce_verifier', verifier);

  const url = `${APS_AUTH_URL}?` + new URLSearchParams({
    response_type:         'code',
    client_id:             CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    scope:                 SCOPES,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });

  const popup = window.open(url, 'aps_auth', 'width=520,height=680,left=200,top=80');
  if (!popup) window.location.href = url;
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
  return (await res.json()).access_token;
}

async function captureTokenFromUrl() {
  const search = new URLSearchParams(window.location.search);

  const code = search.get('code');
  if (code) {
    window.history.replaceState({}, '', window.location.pathname);
    const token = await exchangeCodeForToken(code);
    if (window.opener) {
      localStorage.setItem('aps_token_relay', token);
      window.close();
      return null;
    }
    storeToken(token);
    return token;
  }

  // Fallback: direct access_token in URL (legacy)
  const hash  = new URLSearchParams(window.location.hash.replace('#', ''));
  const token = search.get('access_token') || hash.get('access_token')
             || search.get('token')        || hash.get('token');

  if (!token) return null;

  if (window.opener) {
    localStorage.setItem('aps_token_relay', token);
    window.close();
    return null;
  }

  storeToken(token);
  window.history.replaceState({}, '', window.location.pathname);
  return token;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function boot() {
  let token;
  try {
    token = await captureTokenFromUrl();
  } catch (err) {
    console.error('Auth error:', err);
  }
  token = token || getStoredToken();

  if (!token) {
    document.getElementById('login-page').classList.remove('hidden');
    window.addEventListener('storage', async function onRelay(e) {
      if (e.key !== 'aps_token_relay' || !e.newValue) return;
      window.removeEventListener('storage', onRelay);
      localStorage.removeItem('aps_token_relay');
      storeToken(e.newValue);
      setToken(e.newValue);
      let profile;
      try { profile = await getUserProfile(); } catch { showAccessDenied('Could not verify your account.'); return; }
      const email = (profile.emailId || profile.email || '').toLowerCase();
      if (!ALLOWLIST.includes(email)) { sessionStorage.removeItem('aps_token'); showAccessDenied(`${email || 'This account'} is not authorised.`); return; }
      showApp(profile);
    });
    return;
  }

  setToken(token);

  let profile;
  try {
    profile = await getUserProfile();
  } catch (err) {
    console.error('Failed to fetch user profile:', err);
    showAccessDenied('Could not verify your account. Please try again.');
    return;
  }

  const email = (profile.emailId || profile.email || '').toLowerCase();
  if (!ALLOWLIST.includes(email)) {
    sessionStorage.removeItem('aps_token');
    showAccessDenied(`${email || 'This account'} is not authorised to access this tool.`);
    return;
  }

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
  document.getElementById('sidebar').classList.remove('hidden');

  const email = profile?.emailId || profile?.email || '';
  document.getElementById('user-label').textContent = email;

  renderSidebar();

  if (NAV_ITEMS.length > 0) {
    navigate(NAV_ITEMS[0].id);
  } else {
    document.getElementById('main-content').innerHTML =
      '<div class="p-8 text-ads-muted text-sm">No sections configured yet.</div>';
  }
}

// ── Sidebar & navigation ──────────────────────────────────────────────────────

function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = NAV_ITEMS.map(item => `
    <button
      onclick="navigate('${item.id}')"
      id="nav-${item.id}"
      class="text-left w-full px-3 py-2 rounded text-sm text-ads-text hover:bg-ads-gray transition-colors"
    >
      ${item.label}
    </button>
  `).join('');
}

function navigate(id) {
  document.querySelectorAll('#sidebar button').forEach(btn => {
    btn.classList.remove('bg-ads-gray', 'text-ads-blue', 'font-medium');
  });
  const active = document.getElementById(`nav-${id}`);
  if (active) active.classList.add('bg-ads-gray', 'text-ads-blue', 'font-medium');
  renderSection(id);
}

function renderSection(id) {
  if (id === 'projects') { renderProjects(); return; }
  const main = document.getElementById('main-content');
  main.innerHTML = `<div class="p-8 text-ads-muted text-sm">Section "${id}" not yet implemented.</div>`;
}

// ── Projects ──────────────────────────────────────────────────────────────────

async function renderProjects() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="p-8">
      <h1 class="text-base font-semibold text-ads-text mb-6">Projects</h1>
      <div id="projects-body" class="text-ads-muted text-sm">Loading…</div>
    </div>`;

  try {
    const hubs = await listHubs();
    if (!hubs.length) {
      document.getElementById('projects-body').textContent = 'No hubs found for this account.';
      return;
    }

    const rows = await Promise.all(hubs.map(async hub => {
      const projects = await listProjects(hub.id);
      return projects.map(p => ({ hub: hub.attributes.name, project: p }));
    }));

    const all = rows.flat();

    if (!all.length) {
      document.getElementById('projects-body').textContent = 'No projects found.';
      return;
    }

    document.getElementById('projects-body').innerHTML = `
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="border-b border-ads-border text-ads-muted text-xs uppercase tracking-wide">
            <th class="text-left py-2 pr-6 font-medium">Project</th>
            <th class="text-left py-2 pr-6 font-medium">Hub</th>
            <th class="text-left py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          ${all.map(({ hub, project: p }) => `
            <tr class="border-b border-ads-border hover:bg-ads-gray transition-colors">
              <td class="py-2.5 pr-6 font-medium text-ads-text">${p.attributes.name}</td>
              <td class="py-2.5 pr-6 text-ads-muted">${hub}</td>
              <td class="py-2.5">
                <span class="px-2 py-0.5 rounded-full text-xs font-medium ${
                  p.attributes.status === 'active'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-ads-gray text-ads-muted'
                }">${p.attributes.status ?? '—'}</span>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    document.getElementById('projects-body').innerHTML =
      `<span class="text-red-500">Failed to load projects: ${err.message}</span>`;
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

boot();
