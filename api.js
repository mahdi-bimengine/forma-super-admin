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

// Mappens innehåll tillsammans med senaste versionen av varje fil. ACC lägger
// tip-versionerna i included, så ett anrop per mapp räcker i stället för ett
// anrop per fil. Följer sidbrytningen så att stora mappar kommer med i sin helhet.
async function getFolderContentsWithTips(projectId, folderId) {
  let url = `${APS_BASE}/data/v1/projects/${projectId}/folders/${encodeURIComponent(folderId)}/contents`;
  const poster = [];
  const tips   = {};
  let sidor    = 0;

  while (url && sidor < 20) {
    const res = await apsGetUrl(url);
    poster.push(...(res.data || []));
    (res.included || []).forEach(v => { tips[v.id] = v; });
    url = res.links?.next?.href || null;
    sidor++;
  }
  return { poster, tips, fleraSidor: sidor > 1 };
}

// Senaste versionen av en fil ur tip-listan. Relationen är det säkra spåret,
// men version-urn och item-urn delar nyckel, så den duger som reserv.
function tipVersionOf(item, tips) {
  const viaRelation = item?.relationships?.tip?.data?.id;
  if (viaRelation && tips[viaRelation]) return tips[viaRelation];

  const nyckel = String(item?.id || '').split(':').pop();
  if (!nyckel) return null;
  return Object.values(tips).find(v => String(v.id).includes(nyckel)) || null;
}

// Söker rekursivt genom en mapp och alla undermappar. Svaret är senaste
// versionen av varje träff, så filens item-id plockas ur relationen.
async function searchFolder(projectId, folderId, displayName) {
  const res = await apsGet(
    `/data/v1/projects/${projectId}/folders/${encodeURIComponent(folderId)}/search` +
    `?filter[attributes.displayName]=${encodeURIComponent(displayName)}`
  );
  return (res.data || [])
    .map(v => ({
      itemId: v.relationships?.item?.data?.id,
      namn:   v.attributes?.displayName || v.attributes?.name || '',
      andrad: v.attributes?.lastModifiedTime || null,
    }))
    .filter(t => t.itemId);
}

async function getItemParent(projectId, itemId) {
  const res = await apsGet(`/data/v1/projects/${projectId}/items/${encodeURIComponent(itemId)}/parent`);
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

// ── Skriva filer till ACC ─────────────────────────────────────────────────────
// Uppladdning i ACC sker i fem steg: skapa en lagringsplats, hämta en signerad
// S3-adress, lägga upp innehållet där, kvittera uppladdningen och till sist
// koppla objektet till en fil (nytt item) eller till en ny version av en fil.

function parseStorageId(storageId) {
  const m = String(storageId).match(/^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/);
  if (!m) throw new Error(`Okänt lagrings-id: ${storageId}`);
  return { bucket: m[1], key: m[2] };
}

// ACC- och BIM 360-projekt (id inleds med b.) har egna typnamn för filer och
// mappar. Övriga hubbar använder autodesk.core.
function accExtType(projectId, kind) {
  const bim = String(projectId).startsWith('b.');
  return `${kind}:autodesk.${bim ? 'bim360' : 'core'}:${kind === 'folders' ? 'Folder' : 'File'}`;
}

async function createStorage(projectId, folderId, fileName) {
  const res = await apsPostJsonApi(`/data/v1/projects/${projectId}/storage`, {
    jsonapi: { version: '1.0' },
    data: {
      type: 'objects',
      attributes: { name: fileName },
      relationships: { target: { data: { type: 'folders', id: folderId } } },
    },
  });
  return res.data.id;
}

async function uploadToStorage(storageId, content) {
  const { bucket, key } = parseStorageId(storageId);
  const base = `/oss/v2/buckets/${bucket}/objects/${encodeURIComponent(key)}/signeds3upload`;

  const signed = await apsGet(base);
  const url    = signed.urls?.[0];
  if (!url) throw new Error('APS lämnade ingen uppladdningsadress.');

  // Går direkt till S3 och ska inte ha någon Authorization-header.
  const put = await fetch(url, { method: 'PUT', body: content });
  if (!put.ok) throw new Error(`Uppladdningen misslyckades (${put.status}).`);

  return apsPost(base, { uploadKey: signed.uploadKey });
}

async function createItem(projectId, folderId, fileName, storageId) {
  const res = await apsPostJsonApi(`/data/v1/projects/${projectId}/items`, {
    jsonapi: { version: '1.0' },
    data: {
      type: 'items',
      attributes: {
        displayName: fileName,
        extension:   { type: accExtType(projectId, 'items'), version: '1.0' },
      },
      relationships: {
        tip:    { data: { type: 'versions', id: '1' } },
        parent: { data: { type: 'folders',  id: folderId } },
      },
    },
    included: [{
      type: 'versions',
      id:   '1',
      attributes: {
        name:      fileName,
        extension: { type: accExtType(projectId, 'versions'), version: '1.0' },
      },
      relationships: { storage: { data: { type: 'objects', id: storageId } } },
    }],
  });
  return res.data.id;
}

async function createVersion(projectId, itemId, fileName, storageId) {
  const res = await apsPostJsonApi(`/data/v1/projects/${projectId}/versions`, {
    jsonapi: { version: '1.0' },
    data: {
      type: 'versions',
      attributes: {
        name:      fileName,
        extension: { type: accExtType(projectId, 'versions'), version: '1.0' },
      },
      relationships: {
        item:    { data: { type: 'items',   id: itemId } },
        storage: { data: { type: 'objects', id: storageId } },
      },
    },
  });
  return res.data.id;
}

async function createFolder(projectId, parentFolderId, name) {
  const res = await apsPostJsonApi(`/data/v1/projects/${projectId}/folders`, {
    jsonapi: { version: '1.0' },
    data: {
      type: 'folders',
      attributes: {
        name,
        extension: { type: accExtType(projectId, 'folders'), version: '1.0' },
      },
      relationships: { parent: { data: { type: 'folders', id: parentFolderId } } },
    },
  });
  return res.data.id;
}

// Skriver text till en fil i ACC. Finns filen redan läggs den upp som en ny
// version, annars skapas den. Returnerar filens item-id.
async function writeTextFile(projectId, folderId, fileName, text, existingItemId) {
  const storageId = await createStorage(projectId, folderId, fileName);
  await uploadToStorage(storageId, text);
  return existingItemId
    ? (await createVersion(projectId, existingItemId, fileName, storageId), existingItemId)
    : createItem(projectId, folderId, fileName, storageId);
}

async function readTextFile(projectId, itemId) {
  const { urls } = await getItemDownload(projectId, itemId);
  if (!urls.length) throw new Error('Filen har ingen nedladdningsadress.');
  const res = await fetch(urls[0]);
  if (!res.ok) throw new Error(`Kunde inte hämta filen (${res.status}).`);
  return res.text();
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
// Adressen är /bim360/modelset/v3/containers/... även för ACC-projekt. Den
// tidigare varianten under /construction/model-set/v3/projects/... finns inte,
// och gav "Failed to fetch" i webbläsaren eftersom svaret kom utan CORS-huvuden.
//
// Container-id är projektets id utan b.-prefix. Svaren sidbryts med
// continuationToken och listorna heter modelSets, modelSetVersions,
// modelSetViews och modelSetViewVersions.

const MC_BASE = '/bim360/modelset/v3/containers';

function mcContainer(projectId) {
  return projectId.startsWith('b.') ? projectId.slice(2) : projectId;
}

async function listModelSets(projectId) {
  const set = await mcSidor(`${MC_BASE}/${mcContainer(projectId)}/modelsets`, res => res.modelSets || []);
  // id är kvar som alias, eftersom Modellkontroll läser ms.id.
  return set.map(s => ({ ...s, id: s.modelSetId || s.id }));
}

async function getModelSetVersions(projectId, modelSetId) {
  const versioner = await mcSidor(
    `${MC_BASE}/${mcContainer(projectId)}/modelsets/${modelSetId}/versions`,
    res => res.modelSetVersions || []
  );
  // Nyaste först, och id som alias för äldre anropare.
  return versioner
    .map(v => ({ ...v, id: v.version ?? v.id }))
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
}

// Innehållet i en model set-version: vilken filversion som ingår, vilken som är
// den senaste, och om samordningen ligger i fas (isTipVersion).
async function getModelSetVersion(projectId, modelSetId, version) {
  return apsGet(`${MC_BASE}/${mcContainer(projectId)}/modelsets/${modelSetId}/versions/${version}`);
}

// De sparade vyerna i ett model set, med namn och vilka modeller vyn består av.
async function listModelSetViews(projectId, modelSetId) {
  return mcSidor(
    `${MC_BASE}/${mcContainer(projectId)}/modelsets/${modelSetId}/views`,
    res => res.modelSetViews || []
  );
}

// Vad vyerna faktiskt innehöll i en bestämd model set-version, per vy.
async function listModelSetViewVersions(projectId, modelSetId, version) {
  return mcSidor(
    `${MC_BASE}/${mcContainer(projectId)}/modelsets/${modelSetId}/versions/${version}/views`,
    res => res.modelSetViewVersions || []
  );
}

// Model Coordination sidbryter med continuationToken. Samma token två gånger,
// eller för många sidor, betyder att vi slutar hellre än att snurra vidare.
async function mcSidor(path, plocka) {
  const alla   = [];
  const sedda  = new Set();
  let   token  = null;

  for (let sida = 0; sida < 20; sida++) {
    const q = new URLSearchParams({ pageLimit: '200', ...(token ? { continuationToken: token } : {}) });
    const res = await apsGet(`${path}?${q}`);
    alla.push(...plocka(res));

    token = res.page?.continuationToken || null;
    if (!token || sedda.has(token)) break;
    sedda.add(token);
  }
  return alla;
}

// Filerna i en model set-version. Det finns ingen egen items-adress, listan
// ligger i versionen. En Revitfil ger en post per 3D-vy, så de slås ihop till
// en per modell. Fälten name och itemUrn behålls för Modellkontroll.
async function listModelSetItems(projectId, modelSetId, version) {
  const detalj   = await getModelSetVersion(projectId, modelSetId, version);
  const perModell = new Map();

  for (const d of detalj.documentVersions || []) {
    const itemUrn = String(d.documentLineage?.lineageUrn || '').split('#')[0];
    if (!itemUrn || perModell.has(itemUrn)) continue;

    perModell.set(itemUrn, {
      itemUrn,
      versionUrn: d.versionUrn,
      name: d.originalSeedFileVersionName
         || String(d.displayName || '').replace(/^\{[^}]*\}_?/, '')
         || d.displayName || '',
      isTipVersion:   d.isTipVersion,
      documentStatus: d.documentStatus,
    });
  }
  return [...perModell.values()];
}

// ── Issues ────────────────────────────────────────────────────────────────────
// Issues-API:t vill ha projekt-id utan b.-prefix, till skillnad från Data
// Management. En issue måste ha en subtyp, så typerna hämtas först.

function issuesProjektId(projectId) {
  return projectId.startsWith('b.') ? projectId.slice(2) : projectId;
}

async function listIssueTypes(projectId) {
  const res = await apsGet(
    `/construction/issues/v1/projects/${issuesProjektId(projectId)}/issue-types?include=subtypes&limit=100`
  );
  return res.results || [];
}

async function createIssue(projectId, payload) {
  return apsPost(`/construction/issues/v1/projects/${issuesProjektId(projectId)}/issues`, payload);
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
  return apsGetUrl(`${APS_BASE}${path}`);
}

// Samma som apsGet men med absolut adress, för att kunna följa next-länkar.
async function apsGetUrl(url) {
  if (!_token) throw new Error('No APS token set. Call setToken() first.');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${_token}` }
  });
  if (!res.ok) throw new Error(`APS error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Data Management kräver Content-Type application/vnd.api+json för sina
// POST-anrop, till skillnad från OSS som vill ha vanlig application/json.
async function apsPostJsonApi(path, body) {
  if (!_token) throw new Error('No APS token set. Call setToken() first.');
  const res = await fetch(`${APS_BASE}${path}`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${_token}`, 'Content-Type': 'application/vnd.api+json' },
    body:    JSON.stringify(body)
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
