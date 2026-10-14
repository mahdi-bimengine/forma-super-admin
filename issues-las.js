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
  'commentCount', 'updatedAt', 'customAttributes', 'locationId', 'locationDetails',
].join(',');

// Alla statusar utom stängd. Stängda ärenden hämtas först när de ska visas.
const IS_EJ_STANGDA = IS_STATUS_ORDNING.filter(s => s !== 'closed').join(',');

const IS_PARALLELLA_SIDOR = 4;

// Första sidan ger antalet. Resten av sidorna hämtas sedan parallellt.
// extra är ytterligare filter, till exempel &filter[assignedTo]=<Autodesk-ID>.
async function isListaArenden(accId, statusar, extra = '') {
  const sida = offset => bhMedOmforsok(() => apsGet(
    `/construction/issues/v1/projects/${accId}/issues?limit=100&offset=${offset}` +
    `&fields=${IS_FALT_URVAL}&filter[status]=${statusar}${extra}`));

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
  let platsFel = null;

  const [typer, arenden, , medlemmar, faltDef, platser] = await Promise.all([
    bhMedOmforsok(() => listIssueTypes(projekt.id)),
    isListaArenden(accId, IS_EJ_STANGDA),
    isNamnFranMappar(hubId, projekt, accId, namn).catch(err => {
      varningar.push(`Roller och företag kunde inte slås upp: ${err.message.slice(0, 120)}`);
    }),
    bhMedOmforsok(() => listProjectUsers(accId)).catch(() => {
      varningar.push('Medlemslistan kunde inte läsas (kräver projektadmin). Personer utan mappbehörighet visas med id.');
      return [];
    }),
    // Egna fält och platsträdet behövs för område per ärende. Båda är frivilliga.
    isLasFaltDef(accId).catch(() => []),
    // Felet sparas, så att Område kan visa varför platserna saknas.
    isLasPlatser(accId).catch(err => { platsFel = String(err.message || err).slice(0, 200); return new Map(); }),
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
    listval:  isListvalKarta(faltDef),
    medlemmar,                       // rå lista från Admin-API:et, används vid onboarding
    faltDef,
    platsFel,
    platser,
  };
  p.arenden = arenden.map(a => isNormalisera(a, p));
  return p;
}

// Hämtar de stängda ärendena till ett redan inläst projekt.
async function isLasStangda(p) {
  const stangda = await isListaArenden(p.accId, 'closed');
  p.arenden.push(...stangda.map(a => isNormalisera(a, p)));
  p.medStangda = true;
}

// Definitionerna för ärendenas egna fält. Behövs för att översätta valet i en
// rullista från id till text.
async function isLasFaltDef(accId) {
  const ut = [];
  for (let offset = 0; ; offset += 200) {
    const res = await bhMedOmforsok(() => apsGet(
      `/construction/issues/v1/projects/${accId}/issue-attribute-definitions?limit=200&offset=${offset}`));
    ut.push(...(res.results || []));
    if (ut.length >= (res.pagination?.totalResults ?? 0) || !(res.results || []).length) return ut;
  }
}

function isListvalKarta(faltDef) {
  const karta = new Map();
  for (const f of faltDef) for (const o of f.metadata?.list?.options || []) karta.set(o.id, o.value);
  return karta;
}

// ACC:s platsträd (Locations): id → { namn, foralder, typ }.
async function isLasPlatser(accId) {
  const karta = new Map();
  for (let offset = 0; ; offset += 1000) {
    const res = await bhMedOmforsok(() => apsGet(
      `/construction/locations/v2/projects/${accId}/trees/default/nodes?limit=1000&offset=${offset}`));
    for (const n of res.results || []) karta.set(n.id, { namn: n.name, foralder: n.parentId, typ: n.type });
    if (karta.size >= (res.pagination?.totalResults ?? 0) || !(res.results || []).length) return karta;
  }
}

// ── Platsnamn utan platsträdet ─────────────────────────────────────────────────
// Autodesks Locations-API saknar CORS och kan inte anropas från webbläsaren.
// Ärendena har ändå platsens id, så de grupperas på det, och namnet härleds ur
// rubrikerna: den fras som står i de flesta av platsens rubriker men sällan hos
// andra platser. Ett eget namn som satts i Område går före.

function isPlatsnamn(p, id) {
  if (!id) return '';
  const eget = _is.platsNamn?.[p.id]?.[id];
  if (eget) return eget;
  return isHarleddaPlatsnamn(p).get(id) || `Plats ${String(id).slice(0, 8)}`;
}

function isHarleddaPlatsnamn(p) {
  if (p._harledda?.antal === p.arenden.length) return p._harledda.karta;

  const ordAv = rubrik => isNormText(rubrik).trim().split(' ').filter(Boolean);
  const fraser = rubrik => {
    const ord = ordAv(rubrik);
    const ut = new Set();
    for (let n = 1; n <= 4; n++) for (let i = 0; i + n <= ord.length; i++) ut.add(ord.slice(i, i + n).join(' '));
    return ut;
  };

  const grupper = new Map();   // plats-id → rubriker
  for (const a of p.arenden) {
    if (!a.platsId) continue;
    if (!grupper.has(a.platsId)) grupper.set(a.platsId, []);
    grupper.get(a.platsId).push(a.rubrik);
  }
  const allaRubriker = [...grupper.values()].flat();
  const totaltPerFras = new Map();
  const ordTackning = new Map();   // ord → andel av alla rubriker som har ordet
  for (const r of allaRubriker) {
    for (const f of fraser(r)) totaltPerFras.set(f, (totaltPerFras.get(f) || 0) + 1);
    for (const o of new Set(ordAv(r))) ordTackning.set(o, (ordTackning.get(o) || 0) + 1 / allaRubriker.length);
  }

  const karta = new Map();
  for (const [id, rubriker] of grupper) {
    const iGruppen = new Map();
    for (const r of rubriker) for (const f of fraser(r)) iGruppen.set(f, (iGruppen.get(f) || 0) + 1);
    const ovriga = allaRubriker.length - rubriker.length;
    let bast = null;
    for (const [f, antal] of iGruppen) {
      const inne = antal / rubriker.length;
      if (inne < 0.5) continue;
      const ute = ovriga ? (totaltPerFras.get(f) - antal) / ovriga : 0;
      const poang = inne - ute;
      const ord = f.split(' ').length;
      if (!bast || poang > bast.poang + 1e-9 || (Math.abs(poang - bast.poang) < 1e-9 && ord > bast.ord)) bast = { f, poang, ord };
    }
    if (!bast || bast.poang < 0.2) continue;
    // Ord som står i de flesta rubrikerna i hela projektet (som "L1B1") skalas bort
    // i kanterna, men bara så länge det som blir kvar är mer än en ensam bokstav
    // eller siffra. Annars blir "Block E" bara "E".
    const ord = bast.f.split(' ');
    const kvarDuger = rest => rest.length > 1 || rest[0].length > 2;
    while (ord.length > 1 && (ordTackning.get(ord[0]) || 0) > 0.5 && kvarDuger(ord.slice(1))) ord.shift();
    while (ord.length > 1 && (ordTackning.get(ord[ord.length - 1]) || 0) > 0.5 && kvarDuger(ord.slice(0, -1))) ord.pop();
    karta.set(id, isOriginalSkrivning(ord, rubriker) || ord.join(' '));
  }
  p._harledda = { antal: p.arenden.length, karta };
  return karta;
}

// Frasen som den står skriven i en av rubrikerna, till exempel "Block E".
function isOriginalSkrivning(ord, rubriker) {
  const monster = new RegExp(ord.map(o => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-z0-9åäöéü]+'), 'i');
  for (const r of rubriker) { const m = String(r).match(monster); if (m) return m[0]; }
  return null;
}

function isNormText(s) {
  return ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9åäöéü]+/g, ' ').trim() + ' ';
}

// Platsens sökväg från toppen, utan trädets rot.
function isPlatsVag(platser, id) {
  const vag = [];
  for (let n = platser?.get(id), varv = 0; n && varv < 50; n = platser.get(n.foralder), varv++) {
    if (n.typ !== 'Root') vag.unshift(n.namn);
  }
  return vag;
}

// Ärendets egna fält som titel → text. Val i rullistor översätts till text.
function isEgnaFalt(a, listval) {
  const ut = {};
  for (const f of a.customAttributes || []) {
    if (!f.title) continue;
    const v = Array.isArray(f.value) ? f.value.map(x => listval?.get(x) ?? x).join(', ') : (listval?.get(f.value) ?? f.value);
    if (v != null && v !== '') ut[f.title] = String(v);
  }
  return ut;
}

function isTypNamnKarta(typer) {
  const karta = new Map();
  for (const t of typer) {
    karta.set(t.id, t.title);
    for (const st of t.subtypes || []) karta.set(st.id, st.title);
  }
  return karta;
}

// Ett ärende från API:et i den form fliken använder. p är det inlästa projektet.
function isNormalisera(a, p) {
  const tilldelad = a.assignedTo ? p.namnRegister.get(a.assignedTo) : null;
  const skapare   = p.namnRegister.get(a.createdBy);
  return {
    ra:          a,
    id:          a.id,
    nr:          a.displayId,
    projektId:   p.id,
    accId:       p.accId,
    projekt:     p.namn,
    rubrik:      a.title || '',
    typ:         p.typNamn.get(a.issueTypeId) || '',
    subtyp:      p.typNamn.get(a.issueSubtypeId) || '',
    egnaFalt:    isEgnaFalt(a, p.listval),
    platsId:     a.locationId || null,
    platsVag:    a.locationId ? isPlatsVag(p.platser, a.locationId) : [],
    platsText:   a.locationDetails || '',
    status:      a.status,
    tilldeladId: a.assignedTo || null,
    tilldeladTyp: a.assignedToType || null,
    tilldelad:   a.assignedTo ? (tilldelad?.namn || `${isTypNamn(a.assignedToType)} ${a.assignedTo}`) : '',
    tilldeladEmail: tilldelad?.email || '',
    skapadAv:    skapare?.namn || a.createdBy || '',
    skapat:      (a.createdAt || '').slice(0, 10),
    forfaller:   a.dueDate ? a.dueDate.slice(0, 10) : '',
    stangt:      (a.closedAt || '').slice(0, 10),
    uppdaterat:  a.updatedAt || '',
    antalKommentarer: a.commentCount || 0,
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

// ── Inställningar för arbetsytorna ────────────────────────────────────────────
// Vilka som är "vi", och vilka ärendetyper som är admin respektive clash.
// Textfälten matchas som delar av namn, flera värden separerade med komma.

const IS_STANDARDINST = {
  oss:         'BIM-Koordinator, BIM Engine',
  ossDomaner:  'bimengine.se',
  adminTyp:    'Admin',
  clashTyp:    'Clash',
  onboarding:  'Onboarding',
  offboarding: 'Offboarding',
  snartDagar:  2,
  veckaDagar:  7,
  omradeKalla: 'auto',                     // auto | falt | plats | text
  omradeFalt:  'Location, Plats, Område',  // namnet på det egna fältet
  platsNiva:   0,                          // 0 = hela sökvägen, 1 = översta nivån osv.
  gammalDagar: 30,                         // öppna ärenden äldre än så räknas som gamla
};

const IS_UTAN_OMRADE = '(utan område)';

// Ärendets område. Det egna fältet går före platsträdet i läget auto, och
// platsens fritext används om inget annat finns.
function isOmrade(a) {
  const inst = isInst();
  const falt = () => {
    const namn = isDelar(inst.omradeFalt);
    const traff = Object.keys(a.egnaFalt || {}).find(t => namn.includes(t.toLowerCase()));
    return traff ? a.egnaFalt[traff] : '';
  };
  const plats = () => {
    if (!a.platsVag?.length) return a.platsId ? isPlatsnamn(_is.projekt.get(a.projektId), a.platsId) : '';
    const n = Number(inst.platsNiva) || 0;
    return (n > 0 ? a.platsVag.slice(0, n) : a.platsVag).join(' › ');
  };
  const varde = inst.omradeKalla === 'falt' ? falt()
              : inst.omradeKalla === 'plats' ? plats()
              : inst.omradeKalla === 'text' ? a.platsText
              : falt() || plats() || a.platsText;
  return varde || IS_UTAN_OMRADE;
}

// Källorna för område som faktiskt finns i ärendena, med antal och exempel.
// Används i Inställningar så att man väljer bland det som finns.
function isOmradeKallor(arenden) {
  const kallor = [];
  const exempel = lista => [...new Set(lista.filter(Boolean))].slice(0, 3).join(', ');

  const djup = Math.max(0, ...arenden.map(a => a.platsVag?.length || 0));
  const medPlats = arenden.filter(a => a.platsVag?.length);
  // Utan platsträdet: platsfältets id med härledda eller egna namn.
  const medBaraId = arenden.filter(a => a.platsId && !a.platsVag?.length);
  if (medBaraId.length) {
    kallor.push({ kalla: 'plats', niva: 0, antal: medBaraId.length, text: 'Platsfältet (Location)',
      exempel: exempel(medBaraId.map(a => isPlatsnamn(_is.projekt.get(a.projektId), a.platsId))) });
  }
  for (let n = 1; n <= djup; n++) {
    kallor.push({ kalla: 'plats', niva: n, antal: medPlats.length,
      text: `Platsträdet, nivå ${n}`, exempel: exempel(medPlats.map(a => a.platsVag.slice(0, n).join(' › '))) });
  }
  if (djup > 1 && !medBaraId.length) {
    kallor.push({ kalla: 'plats', niva: 0, antal: medPlats.length,
      text: 'Platsträdet, hela sökvägen', exempel: exempel(medPlats.map(a => a.platsVag.join(' › '))) });
  }

  const titlar = new Map();
  for (const a of arenden) for (const [t, v] of Object.entries(a.egnaFalt || {})) {
    if (!titlar.has(t)) titlar.set(t, []);
    titlar.get(t).push(v);
  }
  for (const [t, varden] of [...titlar.entries()].sort((a, b) => b[1].length - a[1].length)) {
    kallor.push({ kalla: 'falt', falt: t, antal: varden.length, text: `Eget fält: ${t}`, exempel: exempel(varden) });
  }

  const medText = arenden.filter(a => a.platsText);
  if (medText.length) kallor.push({ kalla: 'text', antal: medText.length, text: 'Platsbeskrivning (fritext)', exempel: exempel(medText.map(a => a.platsText)) });
  return kallor;
}

// Varför ärenden saknar område: per projekt vad som finns i datan.
function isOmradeDiagnos() {
  return [..._is.projekt.values()].map(p => {
    const clash = p.arenden.filter(isArClash);
    return {
      projekt:    p.namn,
      clash:      clash.length,
      platser:    p.platser?.size || 0,
      platsFel:   p.platsFel,
      medPlatsId: clash.filter(a => a.platsId).length,
      utanTraff:  clash.filter(a => a.platsId && !a.platsVag.length).length,
      medText:    clash.filter(a => a.platsText).length,
      medFalt:    clash.filter(a => Object.keys(a.egnaFalt || {}).length).length,
    };
  });
}

function isInst() {
  return _is.inst || IS_STANDARDINST;
}

function isArTyp(a, text) {
  const delar = isDelar(text);
  return delar.length > 0 && delar.some(t => `${a.typ} ${a.subtyp}`.toLowerCase().includes(t));
}

function isArOss(text) {
  const t = String(text || '').toLowerCase();
  return isDelar(isInst().oss).some(d => t.includes(d));
}

// Tilldelat oss: en roll eller ett företag som matchar "vi", eller en person
// med e-post på någon av våra domäner.
function isTilldeladOss(a) {
  if (isArOss(a.tilldelad)) return true;
  const email = String(a.tilldeladEmail || '').toLowerCase();
  return a.tilldeladTyp === 'user' && !!email &&
    isDelar(isInst().ossDomaner).some(d => email.endsWith('@' + d.replace(/^@/, '')));
}

const isArAdmin = a => isArTyp(a, isInst().adminTyp);
const isArClash = a => isArTyp(a, isInst().clashTyp);

// Hur bråttom ett ärende är, utifrån förfallodatum.
function isBradska(a) {
  const d = isDagarKvar(a.forfaller);
  const inst = isInst();
  if (d == null) return 'utan';
  if (d < 0) return 'forfallet';
  if (d <= inst.snartDagar) return 'snart';
  if (d <= inst.veckaDagar) return 'vecka';
  return 'senare';
}

// ── Kommentarer ───────────────────────────────────────────────────────────────
// Bara den senaste kommentaren hämtas, ett anrop per ärende. Den sparas per
// ärende och uppdateringstid, så att den inte hämtas igen i onödan.

async function isLasSenasteKommentar(a) {
  const res = await bhMedOmforsok(() => apsGet(
    `/construction/issues/v1/projects/${a.accId}/issues/${a.id}/comments?sortBy=-createdAt&limit=1`));
  const k = (res.results || [])[0];
  if (!k) return null;
  const reg  = _is.projekt.get(a.projektId)?.namnRegister;
  const namn = reg?.get(k.createdBy);
  return {
    text:    k.body || '',
    avId:    k.createdBy,
    av:      namn?.namn || k.createdBy || '',
    foretag: namn?.foretag || '',
    email:   namn?.email || '',
    tid:     (k.createdAt || '').slice(0, 16).replace('T', ' '),
  };
}

// Läser senaste kommentaren för ärendena som saknar den. framsteg(klara, totalt).
async function isLasKommentarer(arenden, framsteg) {
  const saknas = arenden.filter(a => a.antalKommentarer > 0 && _is.kommentarer.get(a.id)?.uppdaterat !== a.uppdaterat);
  let i = 0, klara = 0;
  const arbetare = async () => {
    while (i < saknas.length) {
      const a = saknas[i++];
      try { _is.kommentarer.set(a.id, { uppdaterat: a.uppdaterat, senaste: await isLasSenasteKommentar(a) }); }
      catch { /* ärendet visas utan kommentar */ }
      framsteg?.(++klara, saknas.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, saknas.length) }, arbetare));
}

function isSenasteKommentar(a) {
  return _is.kommentarer.get(a.id)?.senaste || null;
}

// En kommentar räknas som från projektören om den inte är från den inloggade
// och inte från någon vars namn eller företag matchar "vi" i inställningarna.
function isKommentarFranProjektor(k) {
  if (!k) return false;
  if (k.email && k.email.toLowerCase() === String(_profile?.email || '').toLowerCase()) return false;
  return !isArOss(k.av) && !isArOss(k.foretag);
}

// Slutförda clashärenden: redo att stänga när projektören tilldelat ärendet
// till oss. Delvis när projektören kommenterat men inte tilldelat oss.
function isClashLage(a) {
  if (isTilldeladOss(a)) return 'redo';
  if (isKommentarFranProjektor(isSenasteKommentar(a))) return 'delvis';
  return 'ovrigt';
}

// Taggningar i kommentarer lagras som @{"type": "user", "id": "…", "name": "…"}.
// De visas som @Namn och resten av koden döljs.
const IS_TAGG = /@\{[^{}]*\}/g;

function isTaggNamn(tagg) {
  try { return JSON.parse(tagg.slice(1)).name || null; } catch { return null; }
}

function isKommentarText(text) {
  return String(text || '').replace(IS_TAGG, t => { const n = isTaggNamn(t); return n ? `@${n}` : t; });
}

function isKommentarHtml(text) {
  return String(text || '').split(/(@\{[^{}]*\})/).map(del => {
    const n = /^@\{[^{}]*\}$/.test(del) && isTaggNamn(del);
    return n ? `<b>@${vkEsc(n)}</b>` : vkEsc(del);
  }).join('');
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
