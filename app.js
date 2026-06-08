const NAV_ITEMS = [
  // { id: 'example', label: 'Example', icon: '...' },
];

const AUTH_URL = 'https://aps-acc-mcp-worker.bim-engine.workers.dev/auth';

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

// Open OAuth in a popup. When the callback lands in the popup, it relays the
// token via localStorage and closes itself; the main tab picks it up below.
function openAuthPopup() {
  const popup = window.open(AUTH_URL, 'aps_auth', 'width=520,height=680,left=200,top=80');
  if (!popup) {
    // Blocked by browser — fall back to same-tab navigation
    window.location.href = AUTH_URL;
  }
}

// Capture token from URL after OAuth callback redirect.
// Supports both ?access_token=... and #access_token=...
function captureTokenFromUrl() {
  const search = new URLSearchParams(window.location.search);
  const hash   = new URLSearchParams(window.location.hash.replace('#', ''));

  const token = search.get('access_token') || hash.get('access_token')
             || search.get('token')        || hash.get('token');

  if (!token) return null;

  // If we're in the OAuth popup, relay the token to the opener and close.
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

function boot() {
  const token = captureTokenFromUrl() || getStoredToken();

  if (!token) {
    document.getElementById('login-page').classList.remove('hidden');
    // Listen for the popup relay
    window.addEventListener('storage', function onRelay(e) {
      if (e.key !== 'aps_token_relay' || !e.newValue) return;
      window.removeEventListener('storage', onRelay);
      localStorage.removeItem('aps_token_relay');
      storeToken(e.newValue);
      setToken(e.newValue);
      showApp();
    });
    return;
  }

  setToken(token);
  showApp();
}

function showApp() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app-header').classList.remove('hidden');
  document.getElementById('sidebar').classList.remove('hidden');

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
  const main = document.getElementById('main-content');
  main.innerHTML = `<div class="p-8 text-ads-muted text-sm">Section "${id}" not yet implemented.</div>`;
}

// ── Start ─────────────────────────────────────────────────────────────────────

boot();
