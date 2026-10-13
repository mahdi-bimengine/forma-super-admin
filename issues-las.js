// issues-las.js — hämtar ärenden från flera projekt till fliken Issues.
//
// Fliken räknar över de projekt man väljer i kontot, inte bara det öppna
// projektet. Per projekt hämtas ärendetyperna, ärendena och det som behövs för
// att översätta id:n till namn:
//   personer  Autodesk-ID → namn via projektets medlemmar (Admin-API:et), och
//             via behörigheterna på toppmapparna för den som inte är admin
//   roller och företag  Autodesk-ID → namn via behörigheterna på toppmapparna.
//             Issues-API:et har inget eget sätt att slå upp dem.
//
// Issues-API:et visar bara de ärenden den inloggade får se i ACC.

const IS_STATUS = {
  draft:        { label: 'Utkast',      farg: '#111111' },
  open:         { label: 'Öppen',       farg: '#F28C0F' },
  pending:      { label: 'Väntande',    farg: '#1D5BD6' },
  in_progress:  { label: 'Pågående',    farg: '#2BA3DB' },
  in_review:    { label: 'Granskas',    farg: '#8B5CF6' },
  completed:    { label: 'Slutförd',    farg: '#B5DC3B' },
  not_approved: { label: 'Ej godkänd',  farg: '#DC2626' },
  in_dispute:   { label: 'Tvist',       farg: '#EC4899' },
  closed:       { label: 'Stängd',      farg: '#9CA3AF' },
};
const IS_STATUS_ORDNING = ['draft', 'open', 'pending', 'in_progress', 'in_review', 'not_approved', 'in_dispute', 'completed', 'closed'];
const IS_KLARA = new Set(['completed', 'closed']);   // räknas inte som förfallna

function isStatusLabel(s) {
  return IS_STATUS[s]?.label || s || '–';
}

// Projektets id i Issues- och Admin-API:et, utan b.-prefix.
function isAccId(projektId) {
  return String(projektId).replace(/^b\./, '');
}

// Bara fälten fliken använder. Utan urval kommer beskrivning, kopplade
// dokument, egna fält med mera med, vilket gör svaren många gånger större.
const IS_FALT_URVAL = [
  'displayId', 'title', 'issueTypeId', 'issueSubtypeId', 'status', 'assignedTo', 'assignedToType',
  'dueDate', 'createdBy', 'createdAt', 'closedAt', 'permittedStatuses', 'permittedAttributes',
].join(',');

// Alla statusar utom stängd. Stängda ärenden hämtas först när de ska visas.
const IS_EJ_STANGDA = IS_STATUS_ORDNING.filter(s => s !== 'closed').join(',');

const IS_PARALLELLA_SIDOR = 4;

// Första sidan ger antalet. Resten av sidorna hämtas sedan parallellt.
async function isListaArenden(accId, statusar) {
  const sida = offset => bhMedOmforsok(() => apsGet(
    `/construction/issues/v1/projects/${accId}/issues?limit=100&offset=${offset}` +
    `&fields=${IS_FALT_URVAL}&filter[status]=${statusar}`));

  const forsta = await sida(0);
  const ut     = [...(forsta.results || [])];
  const totalt = forsta.pagination?.totalResults ?? ut.length;
  const kvar   = [];
  for (let offset = 100; offset < totalt; offset += 100) kvar.push(offset);

  const sidor = new Array(kvar.length);
  let i = 0;
  const arbetare = async () => {
    while (i < kvar.length) {
      const n = i++;
      sidor[n] = (await sida(kvar[n])).results || [];
    }
  };
  await Promise.all(Array.from({ length: Math.min(IS_PARALLELLA_SIDOR, kvar.length) }, arbetare));
  for (const s of sidor) ut.push(...s);
  return ut;
}

// Namn på roller, företag och personer ur behörigheterna på toppmapparna.
async function isNamnFranMappar(hubId, projekt, accId, namn) {
  const toppar = (await getTopFolders(hubId, projekt.id)).filter(f => !f.attributes?.hidden);
  const listor = await Promise.all(toppar.map(f =>
    bhMedOmforsok(() => getFolderPermissions(accId, f.id)).catch(() => [])));
  for (const s of listor.flat()) {
    if (!s.autodeskId) continue;
    const typ = { USER: 'user', ROLE: 'role', COMPANY: 'company' }[s.subjectType];
    if (typ && !namn.has(s.autodeskId)) namn.set(s.autodeskId, { namn: s.name || s.email, typ, email: s.email || '' });
  }
}

// Läser ett projekt. Ärenden, typer och namnuppslag hämtas samtidigt.
// Namnuppslagen är frivilliga: misslyckas de visas id:t.
async function isLasProjekt(hubId, projekt) {
  const accId = isAccId(projekt.id);
  const namn  = new Map();   // Autodesk-ID → { namn, typ, email }
  const varningar = [];

  const [typer, arenden, , medlemmar] = await Promise.all([
    bhMedOmforsok(() => listIssueTypes(projekt.id)),
    isListaArenden(accId, IS_EJ_STANGDA),
    isNamnFranMappar(hubId, projekt, accId, namn).catch(err => {
      varningar.push(`Roller och företag kunde inte slås upp: ${err.message.slice(0, 120)}`);
    }),
    bhMedOmforsok(() => listProjectUsers(accId)).catch(() => {
      varningar.push('Medlemslistan kunde inte läsas (kräver projektadmin). Personer utan mappbehörighet visas med id.');
      return [];
    }),
  ]);

  // Medlemslistan har alla personer, även de utan mappbehörigheter, och går före.
  for (const u of medlemmar) {
    if (u.autodeskId) namn.set(u.autodeskId, { namn: u.name || u.email, typ: 'user', email: u.email || '', foretag: u.companyName || '' });
  }

  const p = {
    id: projekt.id, accId,
    namn: projekt.attributes?.name || accId,
    arenden: [],
    namnRegister: namn,
    typer,
    typNamn: isTypNamnKarta(typer),
    varningar,
    medStangda: false,
  };
  p.arenden = arenden.map(a => isNormalisera(a, projekt, accId, p.typNamn, namn));
  return p;
}

// Hämtar de stängda ärendena till ett redan inläst projekt.
async function isLasStangda(p) {
  const stangda = await isListaArenden(p.accId, 'closed');
  const projekt = { id: p.id, attributes: { name: p.namn } };
  p.arenden.push(...stangda.map(a => isNormalisera(a, projekt, p.accId, p.typNamn, p.namnRegister)));
  p.medStangda = true;
}

function isTypNamnKarta(typer) {
  const karta = new Map();
  for (const t of typer) {
    karta.set(t.id, t.title);
    for (const st of t.subtypes || []) karta.set(st.id, st.title);
  }
  return karta;
}

function isNormalisera(a, projekt, accId, typNamn, namn) {
  const tilldelad = a.assignedTo ? namn.get(a.assignedTo) : null;
  const skapare   = namn.get(a.createdBy);
  return {
    ra:          a,
    id:          a.id,
    nr:          a.displayId,
    projektId:   projekt.id,
    accId,
    projekt:     projekt.attributes?.name || accId,
    rubrik:      a.title || '',
    typ:         typNamn.get(a.issueTypeId) || '',
    subtyp:      typNamn.get(a.issueSubtypeId) || '',
    status:      a.status,
    tilldeladId: a.assignedTo || null,
    tilldeladTyp: a.assignedToType || null,
    tilldelad:   a.assignedTo ? (tilldelad?.namn || `${isTypNamn(a.assignedToType)} ${a.assignedTo}`) : '',
    skapadAv:    skapare?.namn || a.createdBy || '',
    skapat:      (a.createdAt || '').slice(0, 10),
    forfaller:   a.dueDate ? a.dueDate.slice(0, 10) : '',
    stangt:      (a.closedAt || '').slice(0, 10),
    tillatnaStatusar: a.permittedStatuses || [],
    tillatnaFalt:     a.permittedAttributes || [],
    tillatnaHandl:    a.permittedActions || [],
  };
}

function isTypNamn(typ) {
  return { user: 'Person', role: 'Roll', company: 'Företag' }[typ] || '';
}

// Dagar kvar till förfallodatum, negativt om förfallet. null utan datum.
function isDagarKvar(forfaller) {
  if (!forfaller) return null;
  const idag = new Date(); idag.setHours(0, 0, 0, 0);
  return Math.round((new Date(forfaller + 'T00:00:00') - idag) / 86400000);
}

function isArForfallet(a) {
  const d = isDagarKvar(a.forfaller);
  return d != null && d < 0 && !IS_KLARA.has(a.status);
}

// ── Vyer ──────────────────────────────────────────────────────────────────────
// En vy är ett filter: ärendetyp (text som ska finnas i typ eller subtyp),
// tilldelad (text som ska finnas i namnet på den tilldelade) och typ av
// tilldelning. Tomma fält filtrerar inte. Vyerna kan ändras i dashboarden.

const IS_STANDARDVYER = [
  { id: 'koordinator', namn: 'Ärenden till BIM-Koordinator', tilldelad: 'BIM-Koordinator, BIM Engine' },
  { id: 'individuella', namn: 'Individuella ärenden',        tilldeladTyp: 'user' },
  { id: 'andring',     namn: 'Ändring Modell',               typ: 'Ändring Modell' },
  { id: 'onboarding',  namn: 'Onboarding',                   typ: 'Onboarding' },
  { id: 'offboarding', namn: 'Offboarding',                  typ: 'Offboarding' },
  { id: 'granskning',  namn: 'Initiera Granskning',          typ: 'Granskning' },
  { id: 'foretag',     namn: 'Registrering av Nytt Företag', typ: 'Nytt Företag' },
  { id: 'alla',        namn: 'Alla ärenden' },
];

function isDelar(text) {
  return String(text || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function isMatcharVy(a, vy) {
  if (!vy) return true;
  const typer = isDelar(vy.typ);
  if (typer.length && !typer.some(t => `${a.typ} ${a.subtyp}`.toLowerCase().includes(t))) return false;
  const vem = isDelar(vy.tilldelad);
  if (vem.length && !vem.some(t => a.tilldelad.toLowerCase().includes(t))) return false;
  if (vy.tilldeladTyp && a.tilldeladTyp !== vy.tilldeladTyp) return false;
  return true;
}

// ── Sammanställning ───────────────────────────────────────────────────────────

function isSammanstall(arenden) {
  const perStatus = {};
  const perProjekt = new Map();
  let forfallna = 0, ejForfallna = 0;
  for (const a of arenden) {
    perStatus[a.status] = (perStatus[a.status] || 0) + 1;
    if (!perProjekt.has(a.projekt)) perProjekt.set(a.projekt, {});
    const p = perProjekt.get(a.projekt);
    p[a.status] = (p[a.status] || 0) + 1;
    if (isArForfallet(a)) forfallna++; else ejForfallna++;
  }
  return { perStatus, perProjekt, forfallna, ejForfallna, totalt: arenden.length };
}
