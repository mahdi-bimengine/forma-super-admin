const APS_BASE = 'https://developer.api.autodesk.com';

let _token = null;

function setToken(token) {
  _token = token;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSafeBase64(str) {
  try {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  } catch {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
}

// ── Data Management ───────────────────────────────────────────────────────────

async function listHubs() {
  const res = await apsGet('/project/v1/hubs');
  return res.data;
}

async function listProjects(hubId) {
  const res = await apsGet(`/project/v1/hubs/${hubId}/projects`);
  return res.data;
}

async function getTopFolders(hubId, projectId) {
  const res = await apsGet(`/project/v1/hubs/${hubId}/projects/${projectId}/topFolders`);
  return res.data;
}

async function getFolderContents(projectId, folderId) {
  const res = await apsGet(`/data/v1/projects/${projectId}/folders/${encodeURIComponent(folderId)}/contents`);
  return res.data;
}

async function getItemTip(projectId, itemId) {
  const res = await apsGet(`/data/v1/projects/${projectId}/items/${encodeURIComponent(itemId)}/tip`);
  return res.data;
}

// Signed download links for the file behind an item's tip version.
// Large objects come back as several parts, so this always returns an array.
async function getItemDownload(projectId, itemId) {
  const tip       = await getItemTip(projectId, itemId);
  const storageId = tip?.relationships?.storage?.data?.id;
  if (!storageId) throw new Error('Filen har ingen lagringsplats i ACC.');

  const m = storageId.match(/^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/);
  if (!m) throw new Error(`Okänt lagrings-id: ${storageId}`);

  const res = await apsGet(
    `/oss/v2/buckets/${m[1]}/objects/${encodeURIComponent(m[2])}/signeds3download`
  );
  return { urls: res.urls || (res.url ? [res.url] : []), size: res.size };
}

// ── Model Derivative ──────────────────────────────────────────────────────────

async function getManifest(urn) {
  if (!_token) throw new Error('No APS token set.');
  const encoded = toSafeBase64(urn);
  const res = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${encoded}/manifest`, {
    headers: { Authorization: `Bearer ${_token}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`APS error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getDerivativeMetadata(urn) {
  const encoded = toSafeBase64(urn);
  const res = await apsGet(`/modelderivative/v2/designdata/${encoded}/metadata`);
  return res.data.metadata;
}

async function getDerivativeProperties(urn, guid) {
  const encoded = toSafeBase64(urn);
  const res = await apsGet(`/modelderivative/v2/designdata/${encoded}/metadata/${guid}/properties`);
  return res.data.collection;
}

// ── Model Coordination ────────────────────────────────────────────────────────

async function listModelSets(projectId) {
  const id  = projectId.startsWith('b.') ? projectId.slice(2) : projectId;
  const res = await apsGet(`/construction/model-set/v3/projects/${id}/model-sets`);
  return res.results || [];
}

async function getModelSetVersions(projectId, modelSetId) {
  const id  = projectId.startsWith('b.') ? projectId.slice(2) : projectId;
  const res = await apsGet(`/construction/model-set/v3/projects/${id}/model-sets/${modelSetId}/versions`);
  return res.results || [];
}

async function listModelSetItems(projectId, modelSetId, versionId) {
  const id  = projectId.startsWith('b.') ? projectId.slice(2) : projectId;
  const res = await apsGet(`/construction/model-set/v3/projects/${id}/model-sets/${modelSetId}/versions/${versionId}/model-set-items`);
  return res.results || [];
}

// ── GitHub ────────────────────────────────────────────────────────────────────

// Repot är publikt, så en läsning fungerar utan token. Token skickas när den
// finns, dels för att slippa GitHubs snäva takgräns för anonyma anrop.
async function githubGetFile(token, path) {
  const repo = 'mahdi-bimengine/forma-super-admin';
  const res  = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: {
      ...(token ? { Authorization: `token ${token}` } : {}),
      Accept: 'application/vnd.github.v3+json',
    }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function githubPutFile(token, path, content, sha, message) {
  const repo = 'mahdi-bimengine/forma-super-admin';
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method:  'PUT',
    headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

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
    method:  'POST',
    headers: { Authorization: `Bearer ${_token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`APS error ${res.status}: ${await res.text()}`);
  return res.json();
}
