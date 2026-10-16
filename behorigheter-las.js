// behorigheter-las.js — läser in behörigheter till modellen i behorigheter-modell.js.
//
// Två källor ger samma modell:
//   Excel  ACC:s rapporter "Folder permissions" och "Project member summary"
//          (Account Admin → Reports), svenska eller engelska.
//   ACC    Mappträdet via Data Management, behörigheterna per mapp via Docs-
//          API:et och medlemmarna via Admin-API:et.
//
// API:et har ingen motsvarighet till Excel-rapportens kolumn "Alla"
// (alla projektmedlemmar), så den blir tom när datan kommer från ACC.

const BH_CAT_USERS     = ['användare', 'users'];
const BH_CAT_ROLES     = ['roller', 'roles'];
const BH_CAT_COMPANIES = ['företag', 'companies', 'companys'];

const BH_BLAD_BEH   = /mappbeh|folder.?perm/i;
const BH_BLAD_MEDL  = /medlem|members|project.?member/i;
const BH_BLAD_OVERS = /översikt|overview/i;

const BH_PROJEKTADMIN = ['projektadministratör', 'project administrator', 'project admin'];

// ── Excel ─────────────────────────────────────────────────────────────────────

// Avgör om en arbetsbok är behörighetsrapporten eller medlemslistan, så att
// filerna kan släppas i valfri ordning.
function bhKlassaArbetsbok(wb) {
  if (wb.SheetNames.some(s => BH_BLAD_BEH.test(s)))  return 'permissions';
  if (wb.SheetNames.some(s => BH_BLAD_MEDL.test(s))) return 'members';
  return 'unknown';
}

function bhLasBehorighetsrapport(wb) {
  const dataNamn = wb.SheetNames.find(s => BH_BLAD_BEH.test(s));
  if (!dataNamn) throw new Error('Hittade inget behörighetsblad (Mappbehörigheter / Folder permissions)');

  // Översiktsbladet har projektnamnet ensamt på en rad och nyckel/värde-par därunder.
  const oversNamn = wb.SheetNames.find(s => BH_BLAD_OVERS.test(s)) || wb.SheetNames[0];
  const meta = { projectName: 'Okänt projekt', kalla: 'Excel' };
  let harProjekt = false;
  for (const row of XLSX.utils.sheet_to_json(wb.Sheets[oversNamn], { header: 1, defval: null })) {
    const celler = (row || []).filter(c => c != null && c !== '').map(String);
    if (celler.length === 1 && !harProjekt) { meta.projectName = celler[0]; harProjekt = true; continue; }
    if (celler.length < 2) continue;
    const k = celler[0].toLowerCase();
    if ((k.includes('skapat') || k.includes('created') || k.includes('exported')) && !k.includes('av') && !k.includes('by'))
      meta.exportDate = celler[1];
    if (k.includes('skapad av') || k.includes('created by') || k.includes('exported by'))
      meta.createdBy = celler[1];
  }

  // Läses cell för cell eftersom sheet_to_json hoppar över tomma kolumner i
  // rubrikraderna, och kolumnindex är det som binder ihop rubrik och värde.
  const blad = wb.Sheets[dataNamn];
  const omr  = XLSX.utils.decode_range(blad['!ref']);
  const rows = [];
  for (let R = omr.s.r; R <= omr.e.r; ++R) {
    const row = [];
    for (let C = omr.s.c; C <= omr.e.c; ++C) row.push(blad[XLSX.utils.encode_cell({ r: R, c: C })]?.v ?? null);
    rows.push(row);
  }
  if (rows.length < 3) throw new Error('Otillräcklig data i behörighetsbladet');

  // Rad 1 har kategorin (Användare/Roller/Företag) bara i första kolumnen av
  // varje grupp, rad 2 har namnen. Kolumnindex blir principalens id.
  const kategorier = [];
  let aktuell = null;
  for (const c of rows[0]) {
    if (c != null && c !== '') aktuell = String(c).trim().toLowerCase();
    kategorier.push(aktuell);
  }

  const users = [], roles = [], companies = [];
  const kolumner = new Set();
  rows[1].forEach((namn, i) => {
    if (i < 2 || namn == null || namn === '') return;
    const e = { id: i, name: String(namn).trim() };
    const kat = kategorier[i];
    if      (BH_CAT_USERS.includes(kat))     users.push(e);
    else if (BH_CAT_ROLES.includes(kat))     roles.push(e);
    else if (BH_CAT_COMPANIES.includes(kat)) companies.push(e);
    else return;
    kolumner.add(i);
  });

  const folders     = new Map();
  const permissions = new Map();
  for (const row of rows.slice(2)) {
    const path = row[0];
    if (!path || typeof path !== 'string') continue;
    folders.set(path, bhNyMapp(path));
    const byId = new Map();
    for (let c = 2; c < row.length; c++) {
      if (row[c] != null && row[c] !== '' && kolumner.has(c)) byId.set(c, String(row[c]).trim());
    }
    permissions.set(path, { everyone: row[1] ? String(row[1]).trim() : null, byId });
  }

  return bhFardigModell(meta, users, roles, companies, folders, permissions);
}

function bhLasMedlemslista(wb) {
  const bladNamn = wb.SheetNames.find(s => BH_BLAD_MEDL.test(s));
  if (!bladNamn) throw new Error('Hittade inget medlemsblad (Medlemmar / Members)');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[bladNamn], { header: 1, defval: null });
  if (rows.length < 2) throw new Error('Tom medlemslista');

  const rubrik = rows[0].map(h => String(h || '').trim().toLowerCase());
  const idx = {
    name:    rubrik.findIndex(h => h === 'namn' || h === 'name'),
    email:   rubrik.findIndex(h => h.includes('post') || h.includes('mail')),
    company: rubrik.findIndex(h => h === 'företag' || h === 'company'),
    role:    rubrik.findIndex(h => h === 'roll' || h === 'role' || h === 'roles'),
    access:  rubrik.findIndex(h => h.includes('åtkomst') || h.includes('access')),
    status:  rubrik.findIndex(h => h === 'status'),
    added:   rubrik.findIndex(h => h.includes('tillagd') || h.includes('added')),
  };
  if (idx.name < 0) throw new Error('Kolumnen "Namn" / "Name" saknas i medlemslistan');

  const cell = (row, i) => i >= 0 ? String(row[i] ?? '').trim() : '';
  const members = [];
  for (const row of rows.slice(1)) {
    if (!row || !row[idx.name]) continue;
    const atkomst = cell(row, idx.access);
    members.push({
      name:           cell(row, idx.name),
      email:          cell(row, idx.email),
      company:        cell(row, idx.company),
      roleNames:      cell(row, idx.role).split(',').map(r => r.trim()).filter(Boolean),
      accessLevel:    atkomst,
      status:         cell(row, idx.status),
      addedDate:      cell(row, idx.added),
      isProjectAdmin: BH_PROJEKTADMIN.some(a => atkomst.toLowerCase().includes(a)),
    });
  }
  return { members };
}

// ── ACC ───────────────────────────────────────────────────────────────────────

const BH_PARALLELLT = 6;   // samtidiga mappar under genomgången

// APS svarar 429 när man går för fort. Då väntar vi och försöker igen.
async function bhMedOmforsok(fn) {
  for (let forsok = 0; ; forsok++) {
    try {
      return await fn();
    } catch (err) {
      if (!/APS error 429/.test(err.message) || forsok >= 5) throw err;
      await new Promise(r => setTimeout(r, 1000 * 2 ** forsok));
    }
  }
}

// Går igenom alla synliga mappar i projektet och hämtar behörigheterna för
// varje. framsteg(klara, kanda) anropas efter varje mapp.
async function bhLasFranAcc(projekt, hubId, framsteg) {
  const mappar = await bhGaIgenomMappar(projekt, hubId, framsteg, null);
  return bhModellFranAcc(projekt.attributes?.name || 'Projekt', mappar);
}

// Själva genomgången. Behörigheterna läses alltid för varje mapp. Med en
// tidigare genomgång (lista med id, path, andrad, foralder) listas en mapps
// undermappar bara om mappens ändringstid har ändrats; annars återanvänds de
// sparade undermapparna. Det halverar ungefär antalet anrop, men en ny mapp
// djupt ner under en oförändrad mapp kan missas. "Hämta allt om" fångar den.
async function bhGaIgenomMappar(projekt, hubId, framsteg, tidigare) {
  const dmId  = projekt.id;
  const accId = String(dmId).replace(/^b\./, '');

  // Äldre sparade hämtningar saknar ändringstider och föräldrar. Då listas allt.
  const kanAteranvanda = !!tidigare?.length && tidigare.every(m => 'andrad' in m && 'foralder' in m);
  const forut = new Map((kanAteranvanda ? tidigare : []).map(m => [m.id, m]));
  const barnAv = new Map();
  for (const m of forut.values()) {
    if (!m.foralder) continue;
    if (!barnAv.has(m.foralder)) barnAv.set(m.foralder, []);
    barnAv.get(m.foralder).push(m);
  }
  const sistaLed = path => path.split('/').pop();

  const toppar = (await getTopFolders(hubId, dmId)).filter(f => !f.attributes?.hidden);
  const ko     = toppar.map(f => ({ id: f.id, path: bhMappnamn(f), andrad: f.attributes?.lastModifiedTime || null, foralder: null }));
  const klara  = [];
  let aktiva   = 0;

  await new Promise((resolve, reject) => {
    let avbruten = false;
    const behandla = async m => {
      const fore = forut.get(m.id);
      const listaOm = !fore || !m.andrad || fore.andrad !== m.andrad;
      const [under, beh] = await Promise.all([
        listaOm
          ? bhMedOmforsok(() => getSubfolders(dmId, m.id)).then(lista => lista.map(u => ({
              id: u.id, path: `${m.path}/${bhMappnamn(u)}`, andrad: u.attributes?.lastModifiedTime || null, foralder: m.id })))
          : Promise.resolve((barnAv.get(m.id) || []).map(c => ({ id: c.id, path: `${m.path}/${sistaLed(c.path)}`, andrad: c.andrad, foralder: m.id }))),
        // Mappar man inte får se behörigheterna för räknas upp i stället för
        // att stoppa hela läsningen.
        bhMedOmforsok(() => getFolderPermissions(accId, m.id)).catch(err => { m.fel = err.message; return []; }),
      ]);
      m.beh = beh;
      ko.push(...under);
      klara.push(m);
    };
    const nasta = () => {
      if (avbruten) return;
      if (!ko.length && !aktiva) return resolve();
      while (aktiva < BH_PARALLELLT && ko.length) {
        const m = ko.shift();
        aktiva++;
        behandla(m).then(() => {
          aktiva--;
          framsteg?.(klara.length, klara.length + ko.length + aktiva);
          nasta();
        }, err => { avbruten = true; reject(err); });
      }
    };
    nasta();
  });

  return klara;
}

function bhMappnamn(f) {
  return String(f.attributes?.displayName || f.attributes?.name || '?').replace(/\//g, '∕');
}

// ── Sparad hämtning ───────────────────────────────────────────────────────────
// Mappträdet med behörigheter och medlemslistan sparas per projekt i
// webbläsarens IndexedDB, så att fliken öppnas direkt nästa gång. En ny
// hämtning från ACC görs bara när man ber om det.

const BH_CACHE_DB = 'forma-console';
const BH_CACHE_STORE = 'bh-mappar';

function bhCacheDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BH_CACHE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(BH_CACHE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function bhCacheGor(lage, fn) {
  const db = await bhCacheDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = fn(db.transaction(BH_CACHE_STORE, lage).objectStore(BH_CACHE_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  } finally { db.close(); }
}

// { hamtad, projektNamn, mappar, medlemmar } eller null.
async function bhCacheLas(projektId) {
  try { return (await bhCacheGor('readonly', s => s.get(projektId))) || null; } catch { return null; }
}

// Sparar modellen som den ser ut nu. Efter en ändring är de ändrade mapparna
// redan omlästa, så hämtningstiden behålls.
async function bhCacheSpara(projektId, data, medlemmar) {
  if (data?.meta?.kalla !== 'ACC' || !data.mappId) return;
  const post = {
    hamtad:      data.meta.hamtad,
    kontrollerad: data.meta.kontrollerad || null,
    projektNamn: data.meta.projectName,
    mappar:      bhMapparFranData(data),
    medlemmar:   medlemmar || null,
  };
  try { await bhCacheGor('readwrite', s => s.put(post, projektId)); } catch { /* inte kritiskt */ }
}

// Modellens mappar i samma form som genomgången ger.
function bhMapparFranData(data) {
  const olasta = new Map((data.meta.olasta || []).map(o => [o.path, o.fel]));
  return [...data.mappId].map(([path, id]) => {
    const t = data.mappTrad?.get(path);
    return { id, path, beh: data.ra.get(path) || [], ...(t ? { andrad: t.andrad, foralder: t.foralder } : {}),
             ...(olasta.has(path) ? { fel: olasta.get(path) } : {}) };
  });
}

// ── Ändringar sedan förra hämtningen ──────────────────────────────────────────

// Mappens direkta behörigheter per subjekt: id → { namn, typ, actions }.
function bhDirektaPerSubjekt(beh) {
  const ut = new Map();
  for (const s of beh || []) {
    if (!s.subjectId || !(s.actions || []).length) continue;
    ut.set(s.subjectId, { namn: s.name || s.email || s.subjectId, typ: s.subjectType, actions: [...s.actions].sort() });
  }
  return ut;
}

// Jämför två genomgångar. Bara direkta behörigheter räknas, eftersom ärvda
// ändringar redan syns på mappen där de sattes.
function bhJamforMappar(fore, efter) {
  const f = new Map(fore.map(m => [m.id, m]));
  const e = new Map(efter.map(m => [m.id, m]));
  const nya = efter.filter(m => !f.has(m.id)).map(m => m.path);
  const borttagna = fore.filter(m => !e.has(m.id)).map(m => m.path);
  const flyttade = efter.filter(m => f.has(m.id) && f.get(m.id).path !== m.path).map(m => ({ fran: f.get(m.id).path, till: m.path }));
  const andrade = [];
  for (const m of efter) {
    const gammal = f.get(m.id);
    const fa = bhDirektaPerSubjekt(gammal ? gammal.beh : []);
    const ea = bhDirektaPerSubjekt(m.beh);
    const rader = [];
    for (const id of new Set([...fa.keys(), ...ea.keys()])) {
      const a = fa.get(id), b = ea.get(id);
      if (a && b && a.actions.join() === b.actions.join()) continue;
      rader.push({ namn: (b || a).namn, typ: (b || a).typ,
                   fore: a ? bhNivaFranActions(a.actions) || 'egen' : null,
                   efter: b ? bhNivaFranActions(b.actions) || 'egen' : null });
    }
    // En ny mapp räknas för sig. Dess behörigheter visas inte som ändringar.
    if (rader.length && gammal) andrade.push({ path: m.path, rader: rader.sort((x, y) => x.namn.localeCompare(y.namn, 'sv')) });
  }
  return { nya, borttagna, flyttade, andrade };
}

// Medlemmar som tillkommit eller försvunnit, jämfört på e-post.
function bhJamforMedlemmar(fore, efter) {
  if (!fore?.members || !efter?.members) return null;
  const nyckel = m => String(m.email || m.accId || '').toLowerCase();
  const f = new Set(fore.members.map(nyckel));
  const e = new Set(efter.members.map(nyckel));
  return {
    nya:       efter.members.filter(m => !f.has(nyckel(m))).map(m => m.name || m.email),
    borttagna: fore.members.filter(m => !e.has(nyckel(m))).map(m => m.name || m.email),
  };
}

function bhModellFranCache(post) {
  const data = bhModellFranAcc(post.projektNamn, post.mappar, post.hamtad);
  data.meta.kontrollerad = post.kontrollerad || null;
  return data;
}

function bhHamtadText(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' })} kl. ${d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
}

function bhModellFranAcc(projektNamn, mappar, hamtad = new Date().toISOString()) {
  const folders = new Map();
  for (const m of mappar) folders.set(m.path, bhNyMapp(m.path));

  const meta = {
    projectName: projektNamn,
    kalla:       'ACC',
    hamtad,
    exportDate:  new Date(hamtad).toLocaleString('sv-SE'),
    createdBy:   'Hämtat direkt från ACC',
    olasta:      mappar.filter(m => m.fel).map(m => ({ path: m.path, fel: m.fel })),
  };
  const data = bhFardigModell(meta, [], [], [], folders, new Map());

  // Mappens id och de råa behörigheterna behövs för att kunna skriva
  // ändringar och återställa dem exakt som de var.
  data.mappId = new Map(mappar.map(m => [m.path, m.id]));
  // Ändringstid och förälder, så att nästa sökning efter ändringar kan
  // återanvända trädet.
  data.mappTrad = new Map(mappar.filter(m => 'andrad' in m).map(m => [m.path, { andrad: m.andrad, foralder: m.foralder }]));
  data.ra     = new Map();
  for (const m of mappar) bhSattMappBeh(data, m.path, m.beh || [], false);
  for (const lista of [data.users, data.roles, data.companies]) lista.sort(bhSv);
  bhRaknaOm(data);
  return data;
}

const BH_LISTA_FOR = { USER: 'users', ROLE: 'roles', COMPANY: 'companies' };

// Lägger in behörigheterna från ACC för en mapp. Används både vid första
// läsningen och när en mapp läses om efter en ändring.
function bhSattMappBeh(data, path, beh, sortera = true) {
  data.ra.set(path, beh);
  const byId = new Map();
  for (const s of beh) {
    const lista = data[BH_LISTA_FOR[s.subjectType]];
    if (!lista || !s.subjectId) continue;
    if (!lista.some(e => e.id === s.subjectId)) {
      lista.push({
        id:     s.subjectId,
        name:   s.name || s.email || s.subjectId,
        email:  s.email || '',
        status: s.subjectStatus || '',
        isProjectAdmin: s.userType === 'PROJECT_ADMIN',
      });
      if (sortera) lista.sort(bhSv);
    }
    // Bara behörigheter satta på just den här mappen. Ärvda (inheritActions)
    // räknas fram ur trädet på samma sätt som för Excel-rapporten.
    const niva = bhNivaFranActions(s.actions);
    if (niva) byId.set(s.subjectId, niva);
  }
  data.permissions.set(path, { everyone: null, byId });
}

function bhRaknaOm(data) {
  data.stats = { folders: data.folders.size, users: data.users.length, roles: data.roles.length, companies: data.companies.length };
}

// Medlemmar med roller, företag och projektadmin-flagga från Admin-API:et.
// Kräver scopet account:read och att den inloggade får läsa projektets användare.
async function bhLasMedlemmarFranAcc(projekt) {
  const accId = String(projekt.id).replace(/^b\./, '');
  const users = await bhMedOmforsok(() => listProjectUsers(accId));
  return {
    members: users.map(u => ({
      accId:          u.id || null,   // samma id som subjectId i behörighets-API:et
      name:           u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
      email:          u.email || '',
      company:        u.companyName || '',
      companyKey:     u.companyId || null,
      roleNames:      (u.roles || []).map(r => r.name),
      roleKeys:       (u.roles || []).map(r => r.id),
      accessLevel:    u.accessLevels?.projectAdmin ? 'Projektadministratör' : '',
      status:         u.status || '',
      addedDate:      u.addedOn ? u.addedOn.slice(0, 10) : '',
      isProjectAdmin: !!u.accessLevels?.projectAdmin,
    })),
  };
}

function bhFardigModell(meta, users, roles, companies, folders, permissions) {
  const rootPaths = bhLankaTrad(folders);
  return {
    meta,
    users:     users.sort(bhSv),
    roles:     roles.sort(bhSv),
    companies: companies.sort(bhSv),
    folders, rootPaths, permissions,
    stats: { folders: folders.size, users: users.length, roles: roles.length, companies: companies.length },
  };
}
