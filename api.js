const APS_BASE = 'https://developer.api.autodesk.com';

let _token = null;

function setToken(token) {
  _token = token;
}

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
