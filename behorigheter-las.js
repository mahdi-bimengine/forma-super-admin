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
  const dmId  = projekt.id;
  const accId = String(dmId).replace(/^b\./, '');

  const toppar = (await getTopFolders(hubId, dmId)).filter(f => !f.attributes?.hidden);
  const ko     = toppar.map(f => ({ id: f.id, path: bhMappnamn(f) }));
  const klara  = [];
  let aktiva   = 0;

  await new Promise((resolve, reject) => {
    let avbruten = false;
    const behandla = async m => {
      const [under, beh] = await Promise.all([
        bhMedOmforsok(() => getSubfolders(dmId, m.id)),
        // Mappar man inte får se behörigheterna för räknas upp i stället för
        // att stoppa hela läsningen.
        bhMedOmforsok(() => getFolderPermissions(accId, m.id)).catch(err => { m.fel = err.message; return []; }),
      ]);
      m.beh = beh;
      for (const u of under) ko.push({ id: u.id, path: `${m.path}/${bhMappnamn(u)}` });
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

  return bhModellFranAcc(projekt.attributes?.name || 'Projekt', klara);
}

function bhMappnamn(f) {
  return String(f.attributes?.displayName || f.attributes?.name || '?').replace(/\//g, '∕');
}

function bhModellFranAcc(projektNamn, mappar) {
  const principaler = { USER: new Map(), ROLE: new Map(), COMPANY: new Map() };
  const folders     = new Map();
  const permissions = new Map();

  for (const m of mappar) {
    folders.set(m.path, bhNyMapp(m.path));
    const byId = new Map();
    for (const s of m.beh || []) {
      const lista = principaler[s.subjectType];
      if (!lista || !s.subjectId) continue;
      if (!lista.has(s.subjectId)) {
        lista.set(s.subjectId, {
          id:     s.subjectId,
          name:   s.name || s.email || s.subjectId,
          email:  s.email || '',
          status: s.subjectStatus || '',
          isProjectAdmin: s.userType === 'PROJECT_ADMIN',
        });
      }
      // Bara behörigheter satta på just den här mappen. Ärvda (inheritActions)
      // räknas fram ur trädet på samma sätt som för Excel-rapporten.
      const niva = bhNivaFranActions(s.actions);
      if (niva) byId.set(s.subjectId, niva);
    }
    permissions.set(m.path, { everyone: null, byId });
  }

  const meta = {
    projectName: projektNamn,
    kalla:       'ACC',
    exportDate:  new Date().toLocaleString('sv-SE'),
    createdBy:   'Hämtat direkt från ACC',
    olasta:      mappar.filter(m => m.fel).map(m => ({ path: m.path, fel: m.fel })),
  };
  return bhFardigModell(meta,
    [...principaler.USER.values()], [...principaler.ROLE.values()], [...principaler.COMPANY.values()],
    folders, permissions);
}

// Medlemmar med roller, företag och projektadmin-flagga från Admin-API:et.
// Kräver scopet account:read och att den inloggade får läsa projektets användare.
async function bhLasMedlemmarFranAcc(projekt) {
  const accId = String(projekt.id).replace(/^b\./, '');
  const users = await bhMedOmforsok(() => listProjectUsers(accId));
  return {
    members: users.map(u => ({
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
