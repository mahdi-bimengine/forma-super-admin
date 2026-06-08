const APS_BASE = 'https://developer.api.autodesk.com';

let _token = null;

function setToken(token) {
  _token = token;
  document.getElementById('auth-status').textContent = 'Connected';
  document.getElementById('auth-status').className = 'text-xs text-green-400';
}

async function apsGet(path) {
  if (!_token) throw new Error('No APS token set. Call setToken() first.');
  const res = await fetch(`${APS_BASE}${path}`, {
    headers: { Authorization: `Bearer ${_token}` }
  });
  if (!res.ok) throw new Error(`APS error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apsPost(path, body) {
  if (!_token) throw new Error('No APS token set. Call setToken() first.');
  const res = await fetch(`${APS_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`APS error ${res.status}: ${await res.text()}`);
  return res.json();
}
