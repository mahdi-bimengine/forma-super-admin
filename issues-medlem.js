// issues-medlem.js — arbetsytan Medlemmar: onboarding och offboarding.
//
// Projektörer beställer nya medlemmar (och avslut) via ärenden med egna fält
// som namn, e-post och företag. Här blir varje ärende ett kort med fälten
// utlästa och kontroller av e-post, företag och befintligt medlemskap.
//
// Fyrögonsprincipen: person 1 förbereder (projekt, e-post, företag, roller,
// produkter) och förberedelsen sparas som en kommentar på ärendet i ACC, så att
// alla ser den. Person 2, en annan inloggad, granskar och bekräftar. Först då
// läggs medlemmen till eller tas bort, ärendet kommenteras och sätts till
// Slutförd. Kommentarerna bär data på en rad som börjar med "fc-data:".
//
// Kräver account:write och projektadministratör i målprojektet.

const IS_MARKOR = '[Forma Console]';
const IS_DATA_PREFIX = 'fc-data:';

// Fälten i beställningsformuläret, igenkända på titeln.
const IS_FORM_FALT = [
  ['namn',      /(för.*efternamn|^namn$|^name$|full name)/i],
  ['email',     /(e-?mail|e-?post)/i],
  ['foretag',   /(företag|company)/i],
  ['inom',      /arbeta inom/i],
  ['disciplin', /disciplin/i],
  ['yrke',      /(yrke|befattning|titel)/i],
  ['nda',       /nda/i],
];

const IS_PRODUKTER = {
  docs: 'Docs', build: 'Build', modelCoordination: 'Model Coordination', designCollaboration: 'Design Collaboration',
  projectAdministration: 'Projektadministration', cost: 'Cost', insight: 'Insight', takeoff: 'Takeoff',
  autoSpecs: 'AutoSpecs', cloudWorksharing: 'Cloud Worksharing', capitalPlanning: 'Capital Planning',
};
// Ger administratörsrätt och föreslås aldrig automatiskt.
const IS_ADMIN_PRODUKTER = new Set(['projectAdministration', 'accountAdministration']);

const IS_VANLIGA_DOMANFEL = [/gmial|gmal\.|gamil/, /hotmial|hotmal\./, /outlok|outloo\./, /\.con$/, /\.se\.$/, /\.(cmo|ocm)$/];

// ── Data ──────────────────────────────────────────────────────────────────────

function isArOnboarding(a)  { return isArTyp(a, isInst().onboarding); }
function isArOffboarding(a) { return isArTyp(a, isInst().offboarding); }

function isMedlemArenden(flik) {
  const typ = flik === 'off' ? isArOffboarding : isArOnboarding;
  return isAllaArenden().filter(a => typ(a) && a.status !== 'closed')
    .sort((x, y) => (IS_KLARA.has(x.status) - IS_KLARA.has(y.status)) || (x.forfaller || '9').localeCompare(y.forfaller || '9'));
}

// Formulärets fält ur ärendets egna fält.
function isFormData(a) {
  const ut = {};
  for (const [titel, varde] of Object.entries(a.egnaFalt || {})) {
    for (const [nyckel, monster] of IS_FORM_FALT) if (!ut[nyckel] && monster.test(titel.trim())) ut[nyckel] = varde;
  }
  ut.email = String(ut.email || '').trim().toLowerCase();
  return ut;
}

// Läser kontots företag, och kommentarerna på medlemsärendena.
async function isLasMedlemData(tvinga = false) {
  if (_is.medlem.laddar) return;
  const arenden = [...isMedlemArenden('onb'), ...isMedlemArenden('off')];
  const saknas = arenden.filter(a => tvinga || !_is.medlem.kommentarer.has(a.id));
  if (_is.medlem.foretag && !saknas.length) return;

  _is.medlem.laddar = true;
  _is.medlem.fel = null;
  isRita();
  try {
    if (!_is.medlem.foretag) {
      _is.medlem.foretag = (await bhMedOmforsok(() => listAccountCompanies(String(_is.hubId).replace(/^b\./, ''))))
        .filter(f => f.status !== 'inactive').sort((x, y) => x.name.localeCompare(y.name, 'sv'));
    }
  } catch (err) {
    _is.medlem.fel = `Kontots företag kunde inte läsas: ${bhKortFel(err)}`;
    _is.medlem.foretag = [];
  }
  let i = 0;
  const arbetare = async () => {
    while (i < saknas.length) {
      const a = saknas[i++];
      try {
        const res = await bhMedOmforsok(() => apsGet(`/construction/issues/v1/projects/${a.accId}/issues/${a.id}/comments?sortBy=-createdAt&limit=50`));
        _is.medlem.kommentarer.set(a.id, res.results || []);
      } catch { _is.medlem.kommentarer.set(a.id, []); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, saknas.length) }, arbetare));
  _is.medlem.laddar = false;
  if (_is.yta === 'medlem' || _is.yta === 'start') isRita();
}

// Data i en konsolkommentar, eller null.
function isTolkaMarkor(k) {
  const text = String(k?.body || '');
  if (!text.startsWith(IS_MARKOR)) return null;
  const rad = text.split('\n').find(r => r.startsWith(IS_DATA_PREFIX));
  try { return rad ? { ...JSON.parse(rad.slice(IS_DATA_PREFIX.length)), tid: k.createdAt } : null; } catch { return null; }
}

// Var ärendet står: ny, förberedd (väntar på kontroll) eller klar.
function isMedlemLage(a) {
  const markorer = (_is.medlem.kommentarer.get(a.id) || []).map(isTolkaMarkor).filter(Boolean);
  // Kommentarerna kommer nyast först.
  const klar = markorer.find(m => m.steg === 'klar');
  const prep = markorer.find(m => m.steg === 'forberedd');
  const atertagen = markorer.find(m => m.steg === 'atertagen');
  if (klar && (!atertagen || atertagen.tid < klar.tid)) return { lage: 'klar', klar, prep };
  if (prep && (!atertagen || atertagen.tid < prep.tid)) return { lage: 'forberedd', prep };
  return { lage: 'ny' };
}

function isJag() {
  return String(_profile?.email || '').toLowerCase();
}

// Projektets medlemmar (Admin-API:et). Inlästa projekt har dem redan.
async function isProjektMedlemmar(projektId) {
  const p = _is.projekt.get(projektId);
  if (p?.medlemmar?.length) return p.medlemmar;
  if (_is.medlem.projektMedlemmar.has(projektId)) return _is.medlem.projektMedlemmar.get(projektId);
  const lista = await bhMedOmforsok(() => listProjectUsers(isAccId(projektId)));
  _is.medlem.projektMedlemmar.set(projektId, lista);
  return lista;
}

function isMedlemmarFor(projektId) {
  return _is.projekt.get(projektId)?.medlemmar?.length ? _is.projekt.get(projektId).medlemmar
    : _is.medlem.projektMedlemmar.get(projektId) || [];
}

// ── Kontroller ────────────────────────────────────────────────────────────────

function isOrd(s) {
  return isNormText(s).trim().split(' ').filter(o => o.length >= 4 && !['bygg', 'teknik', 'konsult', 'sverige', 'group', 'gruppen'].includes(o));
}

function isMatchaForetag(namn) {
  const n = isNormText(namn).trim();
  if (!n) return null;
  const lista = _is.medlem.foretag || [];
  return lista.find(f => isNormText(f.name).trim() === n)
      || lista.find(f => isNormText(f.name).includes(` ${n} `) || n.includes(isNormText(f.name).trim()))
      || lista.find(f => isOrd(namn).some(o => isNormText(f.name).includes(` ${o} `)))
      || null;
}

function isKontroller(a, flik, data, projektId) {
  const ut = [];
  const ok = t => ut.push({ niva: 'ok', text: t });
  const varn = t => ut.push({ niva: 'varning', text: t });
  const fel = t => ut.push({ niva: 'fel', text: t });
  const email = data.email;

  if (!email) fel('E-post saknas i ärendet');
  else if (!/^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) fel(`E-postadressen ser felaktig ut: ${email}`);
  else {
    ok(`E-post: ${email}`);
    const doman = email.split('@')[1];
    if (IS_VANLIGA_DOMANFEL.some(m => m.test(doman))) varn(`Domänen "${doman}" ser felstavad ut`);
    if (data.foretag && flik === 'onb') {
      const rot = doman.split('.').slice(0, -1).join('').replace(/[^a-z0-9]/g, '');
      const foretag = isNormText(data.foretag).replace(/\s/g, '');
      const traff = isOrd(data.foretag).some(o => rot.includes(o.replace(/[^a-z0-9]/g, ''))) || (rot.length >= 4 && foretag.includes(rot));
      if (!traff) varn(`Domänen "${doman}" liknar inte företaget "${data.foretag}"`);
    }
  }

  const medlemmar = isMedlemmarFor(projektId);
  const medlem = email && medlemmar.find(m => String(m.email || '').toLowerCase() === email);
  if (flik === 'onb') {
    if (medlem) fel(`Finns redan som medlem i ${_is.projekt.get(projektId)?.namn || 'projektet'}`);
    else if (email && medlemmar.length) ok('Inte medlem ännu');
    if (data.foretag && !isMatchaForetag(data.foretag)) varn(`Företaget "${data.foretag}" hittades inte bland kontots företag`);
  } else {
    if (email && medlemmar.length && !medlem) fel('Hittas inte som medlem i projektet');
    else if (medlem) ok(`Medlem: ${medlem.name || medlem.email}${medlem.companyName ? `, ${medlem.companyName}` : ''}`);
  }

  if (email) {
    const andra = isMedlemArenden(flik).filter(x => x.id !== a.id && isFormData(x).email === email && !IS_KLARA.has(x.status));
    if (andra.length) varn(`Samma e-post finns i ärende ${andra.map(x => `#${x.nr}`).join(', ')}`);
  }
  if (flik === 'onb' && data.nda && /^nej|no$/i.test(String(data.nda).trim())) varn('NDA är inte signerad enligt ärendet');
  return ut;
}

// ── Förslag till förberedelsen ────────────────────────────────────────────────

function isVanligaste(listor) {
  const rakna = new Map();
  for (const l of listor) {
    const nyckel = JSON.stringify(l);
    rakna.set(nyckel, (rakna.get(nyckel) || 0) + 1);
  }
  const bast = [...rakna.entries()].sort((a, b) => b[1] - a[1])[0];
  return bast ? JSON.parse(bast[0]) : null;
}

function isNyttUtkast(a, flik) {
  const data = isFormData(a);
  const projektId = a.projektId;
  const medlemmar = isMedlemmarFor(projektId);
  if (flik === 'off') {
    const m = medlemmar.find(x => String(x.email || '').toLowerCase() === data.email);
    return { projektId, email: data.email, userId: m?.id || null };
  }
  const foretag = isMatchaForetag(data.foretag);
  const sammaForetag = foretag ? medlemmar.filter(m => m.companyId === foretag.id) : [];
  const roller = isVanligaste(sammaForetag.map(m => (m.roles || []).map(r => r.id).sort())) || [];
  const mall = sammaForetag.length ? sammaForetag
    : roller.length ? medlemmar.filter(m => (m.roles || []).some(r => roller.includes(r.id))) : medlemmar;
  const produkter = isVanligaste(mall.map(m => (m.products || [])
    .filter(p => p.access && p.access !== 'none' && !IS_ADMIN_PRODUKTER.has(p.key))
    .map(p => ({ key: p.key, access: p.access === 'administrator' ? 'member' : p.access }))
    .sort((x, y) => x.key.localeCompare(y.key)))) || [];
  return { projektId, email: data.email, companyId: foretag?.id || '', roleIds: roller, products: produkter };
}

// ── Händelser ─────────────────────────────────────────────────────────────────

function isOppnaMedlem(flik) {
  _is.medlem.flik = flik;
  isSattYta('medlem');
}

function isSattMedlemFlik(flik) {
  _is.medlem.flik = flik;
  _is.medlem.oppen = null;
  isRita();
}

async function isBorjaForbered(ref) {
  const a = _is.ref[ref];
  _is.medlem.oppen = a.id;
  _is.medlem.utkast.set(a.id, isNyttUtkast(a, _is.medlem.flik));
  isRita();
}

async function isUtkastProjekt(ref, projektId) {
  const a = _is.ref[ref];
  try { await isProjektMedlemmar(projektId); } catch (err) { alert(`Medlemmarna i projektet kunde inte läsas: ${bhKortFel(err)}`); }
  const ny = isNyttUtkast({ ...a, projektId }, _is.medlem.flik);
  _is.medlem.utkast.set(a.id, { ...ny, email: _is.medlem.utkast.get(a.id)?.email || ny.email });
  isRita();
}

function isUtkastFalt(ref, falt, varde) {
  const u = _is.medlem.utkast.get(_is.ref[ref]);
  if (!u) return;
  if (falt === 'email') u.email = String(varde).trim().toLowerCase();
  if (falt === 'companyId') u.companyId = varde;
  if (falt === 'userId') u.userId = varde;
}

function isUtkastLista(ref, falt, varde, pa) {
  const u = _is.medlem.utkast.get(_is.ref[ref]);
  if (!u) return;
  if (falt === 'roleIds') u.roleIds = pa ? [...new Set([...u.roleIds, varde])] : u.roleIds.filter(x => x !== varde);
  if (falt === 'products') u.products = pa ? [...u.products.filter(p => p.key !== varde), { key: varde, access: 'member' }]
                                           : u.products.filter(p => p.key !== varde);
}

function isAvbrytForbered() {
  _is.medlem.oppen = null;
  isRita();
}

// Sparar förberedelsen som en kommentar på ärendet.
async function isSparaForberedelse(ref) {
  const a = _is.ref[ref];
  const flik = _is.medlem.flik;
  const u = _is.medlem.utkast.get(a.id);
  if (!u?.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email)) return alert('Ange en giltig e-postadress.');
  if (flik === 'onb' && !u.companyId) return alert('Välj företag.');
  if (flik === 'off' && !u.userId) return alert('Välj vilken medlem som ska tas bort.');

  const projekt = _is.projekt.get(u.projektId)?.namn || isProjektNamn(u.projektId);
  const medlemmar = isMedlemmarFor(u.projektId);
  let data, text;
  if (flik === 'onb') {
    const foretag = (_is.medlem.foretag || []).find(f => f.id === u.companyId);
    const roller = isRollNamn(u.projektId, u.roleIds);
    data = { steg: 'forberedd', typ: 'onb', av: isJag(), projektId: u.projektId, email: u.email, companyId: u.companyId, roleIds: u.roleIds, products: u.products };
    text = [`${IS_MARKOR} Onboarding förberedd av ${_profile?.name || isJag()}`,
      `Projekt: ${projekt}`, `E-post: ${u.email}`, `Företag: ${foretag?.name || u.companyId}`,
      `Roller: ${roller.join(', ') || 'inga'}`, `Produkter: ${u.products.map(p => IS_PRODUKTER[p.key] || p.key).join(', ') || 'standard'}`,
      'Väntar på kontroll av en andra person i Forma Console.'];
  } else {
    const m = medlemmar.find(x => x.id === u.userId);
    const ogonblick = m ? { email: m.email, companyId: m.companyId || null, roleIds: (m.roles || []).map(r => r.id),
      products: (m.products || []).filter(p => p.access && p.access !== 'none').map(p => ({ key: p.key, access: p.access })) } : null;
    data = { steg: 'forberedd', typ: 'off', av: isJag(), projektId: u.projektId, email: u.email, userId: u.userId, namn: m?.name || '', ogonblick };
    text = [`${IS_MARKOR} Offboarding förberedd av ${_profile?.name || isJag()}`,
      `Projekt: ${projekt}`, `Tas bort: ${m?.name || ''} (${u.email})${m?.companyName ? `, ${m.companyName}` : ''}`,
      'Väntar på kontroll av en andra person i Forma Console.'];
  }
  try {
    await isKommentera(a, text, data);
    _is.medlem.oppen = null;
    isRita();
  } catch (err) {
    alert(`Förberedelsen kunde inte sparas: ${bhKortFel(err)}`);
  }
}

async function isKommentera(a, rader, data) {
  const body = [...rader, `${IS_DATA_PREFIX}${JSON.stringify(data)}`].join('\n');
  await bhMedOmforsok(() => apsSend('POST', `/construction/issues/v1/projects/${a.accId}/issues/${a.id}/comments`, { body }));
  // Kommentaren läggs först i listan direkt, så att läget syns utan omläsning.
  const lista = _is.medlem.kommentarer.get(a.id) || [];
  _is.medlem.kommentarer.set(a.id, [{ body, createdAt: new Date().toISOString(), createdBy: '' }, ...lista]);
}

// Andra personen bekräftar. Medlemmen läggs till eller tas bort, ärendet
// kommenteras och sätts till Slutförd om ACC tillåter det.
async function isBekrafta(ref) {
  const a = _is.ref[ref];
  const { prep } = isMedlemLage(a);
  if (!prep) return;
  if (prep.av === isJag()) return alert('Förberedelsen måste kontrolleras av någon annan än den som gjorde den.');
  if (!document.getElementById(`is-kontrollerat-${a.id}`)?.checked) return alert('Kryssa i att du har kontrollerat uppgifterna mot ärendet.');

  const acc = isAccId(prep.projektId);
  const projekt = _is.projekt.get(prep.projektId)?.namn || isProjektNamn(prep.projektId);
  _is.medlem.kor = a.id;
  isRita();
  try {
    // Läs om medlemmarna, så att kontrollen görs mot läget just nu.
    _is.medlem.projektMedlemmar.delete(prep.projektId);
    const p = _is.projekt.get(prep.projektId);
    if (p) p.medlemmar = await bhMedOmforsok(() => listProjectUsers(acc));
    const medlemmar = await isProjektMedlemmar(prep.projektId);

    let userId = prep.userId;
    if (prep.typ === 'onb') {
      if (medlemmar.some(m => String(m.email || '').toLowerCase() === prep.email)) throw new Error('Personen är redan medlem i projektet.');
      const svar = await addProjectUser(acc, { email: prep.email, companyId: prep.companyId || null,
        roleIds: prep.roleIds || [], ...(prep.products?.length ? { products: prep.products } : {}) });
      userId = svar?.id || null;
    } else {
      if (!medlemmar.some(m => m.id === prep.userId)) throw new Error('Personen är inte längre medlem i projektet.');
      await removeProjectUser(acc, prep.userId);
    }

    const handling = prep.typ === 'onb' ? `Tillagd i ${projekt}` : `Borttagen ur ${projekt}`;
    await isKommentera(a, [`${IS_MARKOR} ${prep.typ === 'onb' ? 'Onboarding' : 'Offboarding'} genomförd. ${handling}: ${prep.email}`,
      `Förberedd av ${prep.av}, kontrollerad och genomförd av ${isJag()}.`],
      { steg: 'klar', typ: prep.typ, av: isJag(), forberedd: prep.av, projektId: prep.projektId, email: prep.email, userId });

    // Slutför ärendet om det går. Misslyckas det är medlemsändringen ändå gjord.
    let slutfort = false;
    if (a.tillatnaStatusar.includes('completed') && isFarAndra(a, 'status')) {
      try {
        const svar = await bhMedOmforsok(() => apsSend('PATCH', `/construction/issues/v1/projects/${a.accId}/issues/${a.id}`, { status: 'completed' }));
        isUppdateraArende(a.projektId, svar);
        slutfort = true;
      } catch { /* ärendet får slutföras i ACC */ }
    }

    isSparaMedlemLogg({ id: Date.now(), tid: new Date().toISOString(), typ: prep.typ, arendeId: a.id, nr: a.nr, rubrik: a.rubrik,
      arendeProjektId: a.projektId, accId: a.accId, projektId: prep.projektId, email: prep.email, userId,
      ogonblick: prep.typ === 'onb' ? { email: prep.email, companyId: prep.companyId, roleIds: prep.roleIds, products: prep.products } : prep.ogonblick,
      forberedd: prep.av, utford: isJag() });

    // Läs om medlemmarna efteråt.
    if (p) p.medlemmar = await bhMedOmforsok(() => listProjectUsers(acc)).catch(() => p.medlemmar);
    else _is.medlem.projektMedlemmar.delete(prep.projektId);
    _is.medlem.meddelande = { id: a.id, text: `${handling}: ${prep.email}.${slutfort ? ' Ärendet är slutfört.' : ' Slutför ärendet i ACC.'}` };
  } catch (err) {
    _is.medlem.meddelande = { id: a.id, fel: true, text: `Det gick inte: ${bhKortFel(err)}` };
  }
  _is.medlem.kor = null;
  isRita();
}

// Person 1 kan ta tillbaka sin förberedelse innan den bekräftats.
async function isAtertaForberedelse(ref) {
  const a = _is.ref[ref];
  if (!confirm('Ta tillbaka förberedelsen? Den finns kvar som kommentar men räknas inte längre.')) return;
  try {
    await isKommentera(a, [`${IS_MARKOR} Förberedelsen togs tillbaka av ${_profile?.name || isJag()}.`], { steg: 'atertagen', av: isJag() });
    isRita();
  } catch (err) { alert(`Det gick inte: ${bhKortFel(err)}`); }
}

function isProjektNamn(projektId) {
  return (_projCache[_is.hubId] || []).find(p => p.id === projektId)?.attributes?.name || projektId;
}

function isRollNamn(projektId, roleIds) {
  const karta = new Map();
  for (const m of isMedlemmarFor(projektId)) for (const r of m.roles || []) karta.set(r.id, r.name);
  return (roleIds || []).map(id => karta.get(id) || id);
}

function isRollerI(projektId) {
  const karta = new Map();
  for (const m of isMedlemmarFor(projektId)) for (const r of m.roles || []) karta.set(r.id, r.name);
  return [...karta.entries()].sort((a, b) => a[1].localeCompare(b[1], 'sv'));
}

function isProdukterI(projektId) {
  const nycklar = new Set();
  for (const m of isMedlemmarFor(projektId)) for (const p of m.products || []) if (p.access && p.access !== 'none') nycklar.add(p.key);
  return [...nycklar].sort((a, b) => (IS_PRODUKTER[a] || a).localeCompare(IS_PRODUKTER[b] || b, 'sv'));
}

// ── Logg och återställning ────────────────────────────────────────────────────

function isMedlemLoggNyckel() { return `is-medlemslogg:${_is.hubId}`; }

function isMedlemLogg() {
  if (!_is.medlem.logg) {
    try { _is.medlem.logg = JSON.parse(localStorage.getItem(isMedlemLoggNyckel()) || '[]'); } catch { _is.medlem.logg = []; }
  }
  return _is.medlem.logg;
}

function isSparaMedlemLogg(post) {
  _is.medlem.logg = [post, ...isMedlemLogg()].slice(0, 100);
  try { localStorage.setItem(isMedlemLoggNyckel(), JSON.stringify(_is.medlem.logg)); } catch { /* inte kritiskt */ }
}

// Backar en genomförd onboarding (tar bort) eller offboarding (lägger till igen).
async function isAterstallMedlem(id) {
  const post = isMedlemLogg().find(p => p.id === id);
  if (!post || post.aterstalld) return;
  const vad = post.typ === 'onb' ? `ta bort ${post.email} ur projektet igen` : `lägga till ${post.email} i projektet igen med samma företag, roller och produkter`;
  if (!confirm(`Återställ: ${vad}?`)) return;
  const acc = isAccId(post.projektId);
  try {
    if (post.typ === 'onb') {
      let userId = post.userId;
      if (!userId) {
        const m = (await bhMedOmforsok(() => listProjectUsers(acc))).find(x => String(x.email || '').toLowerCase() === post.email);
        userId = m?.id;
      }
      if (!userId) throw new Error('Personen hittades inte i projektet.');
      await removeProjectUser(acc, userId);
    } else {
      const o = post.ogonblick || { email: post.email };
      await addProjectUser(acc, { email: o.email, companyId: o.companyId || null, roleIds: o.roleIds || [], ...(o.products?.length ? { products: o.products } : {}) });
    }
    post.aterstalld = new Date().toISOString();
    try { localStorage.setItem(isMedlemLoggNyckel(), JSON.stringify(_is.medlem.logg)); } catch { /* inte kritiskt */ }
    const a = isHittaArende(post.arendeProjektId, post.arendeId);
    if (a) await isKommentera(a, [`${IS_MARKOR} Återställt av ${_profile?.name || isJag()}: ${vad}.`], { steg: 'atertagen', av: isJag() }).catch(() => {});
    const p = _is.projekt.get(post.projektId);
    if (p) p.medlemmar = await bhMedOmforsok(() => listProjectUsers(acc)).catch(() => p.medlemmar);
    _is.medlem.projektMedlemmar.delete(post.projektId);
    alert('Återställt.');
  } catch (err) {
    alert(`Det gick inte att återställa: ${bhKortFel(err)}`);
  }
  isRita();
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const IS_MEDLEM_LAGE = {
  ny:        { text: 'Att förbereda',        farg: 'bg-ads-gray text-ads-text' },
  forberedd: { text: 'Väntar på kontroll',   farg: 'bg-amber-100 text-amber-900' },
  klar:      { text: 'Genomförd',            farg: 'bg-emerald-100 text-emerald-800' },
};

function isMedlemHtml() {
  const m = _is.medlem;
  const flik = m.flik;
  const lista = isMedlemArenden(flik);
  const antal = f => isMedlemArenden(f).filter(a => !IS_KLARA.has(a.status) && isMedlemLage(a).lage !== 'klar').length;
  const chip = (f, text) => `
    <button onclick="isSattMedlemFlik('${f}')"
            class="text-xs px-3 py-1 rounded-full border ${flik === f ? 'bg-be-charcoal text-white border-be-charcoal' : 'bg-white border-ads-border hover:border-ads-blue'}">
      ${text} <span class="font-mono opacity-70">${antal(f)}</span></button>`;
  const logg = isMedlemLogg().filter(p => p.typ === flik).slice(0, 10);

  return `
    <div class="px-5 py-4 max-w-5xl">
      <div class="flex items-center gap-2 flex-wrap mb-3">
        ${chip('onb', 'Onboarding')}${chip('off', 'Offboarding')}
        <div class="flex-1"></div>
        ${m.laddar ? '<span class="text-xs text-ads-muted">Läser företag och kommentarer…</span>'
          : `<button onclick="isLasMedlemData(true)" class="text-xs text-ads-blue hover:underline">Läs om kommentarer</button>`}
      </div>
      ${m.fel ? `<div class="mb-3 p-2.5 rounded border border-amber-200 bg-amber-50 text-xs text-amber-900">${vkEsc(m.fel)}</div>` : ''}
      <p class="text-[11px] text-ads-muted mb-3">
        Person 1 förbereder, och förberedelsen sparas som kommentar på ärendet. Person 2, en annan inloggad, kontrollerar och bekräftar.
        Först då ${flik === 'onb' ? 'läggs medlemmen till' : 'tas medlemmen bort'}. Kräver att du är projektadministratör.
      </p>
      <div class="space-y-3">
        ${lista.length ? lista.map(a => isMedlemKortHtml(a, flik)).join('')
          : `<p class="p-8 text-center text-sm text-ads-muted bg-white border border-ads-border rounded">Inga öppna ${flik === 'onb' ? 'onboarding' : 'offboarding'}ärenden.</p>`}
      </div>
      ${logg.length ? `
        <details class="mt-5 bg-white border border-ads-border rounded">
          <summary class="px-4 py-2.5 cursor-pointer text-sm font-medium">Genomförda i den här webbläsaren (${logg.length})</summary>
          <table class="w-full text-xs">
            <tbody>
              ${logg.map(p => `
                <tr class="border-t border-ads-border/60">
                  <td class="px-4 py-2 whitespace-nowrap">${new Date(p.tid).toLocaleString('sv-SE')}</td>
                  <td class="px-2">#${p.nr} ${vkEsc(p.email)}</td>
                  <td class="px-2 text-ads-muted">${vkEsc(isProjektNamn(p.projektId))}</td>
                  <td class="px-2 text-ads-muted">förberedd ${vkEsc(p.forberedd)} · utförd ${vkEsc(p.utford)}</td>
                  <td class="px-4 text-right">${p.aterstalld ? '<span class="text-ads-muted">återställd</span>'
                    : `<button onclick="isAterstallMedlem(${p.id})" class="border border-ads-border rounded px-2 py-0.5 hover:border-ads-blue">Återställ…</button>`}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </details>` : ''}
    </div>`;
}

function isMedlemKortHtml(a, flik) {
  const ref = isRef(a);
  const data = isFormData(a);
  const { lage, prep, klar } = isMedlemLage(a);
  const l = IS_MEDLEM_LAGE[lage];
  const d = isDagarKvar(a.forfaller);
  const kontroller = isKontroller(a, flik, data, prep?.projektId || a.projektId);
  const ikon = { ok: '<span class="text-emerald-600">✓</span>', varning: '<span class="text-amber-600">⚠</span>', fel: '<span class="text-red-600">✕</span>' };
  const meddelande = _is.medlem.meddelande?.id === a.id ? _is.medlem.meddelande : null;

  let atgard = '';
  if (_is.medlem.kor === a.id) {
    atgard = '<p class="text-sm text-ads-muted">Genomför…</p>';
  } else if (_is.medlem.oppen === a.id) {
    atgard = isForberedFormHtml(a, ref, flik);
  } else if (lage === 'ny') {
    atgard = `<button onclick="isBorjaForbered(${ref})" class="bg-be-charcoal hover:bg-black text-white text-xs font-medium py-1.5 px-3 rounded">Förbered…</button>`;
  } else if (lage === 'forberedd') {
    atgard = isBekraftaHtml(a, ref, prep);
  } else if (lage === 'klar') {
    atgard = `<p class="text-xs text-emerald-800">Genomförd av ${vkEsc(klar.av)}, förberedd av ${vkEsc(klar.forberedd)} · ${(klar.tid || '').slice(0, 10)}.
      ${IS_KLARA.has(a.status) ? '' : 'Ärendet är inte slutfört i ACC än.'}</p>`;
  }

  return `
    <div class="bg-white border ${lage === 'forberedd' ? 'border-amber-300' : 'border-ads-border'} rounded">
      <div class="px-4 py-2.5 border-b border-ads-border/60 flex items-center gap-3 flex-wrap">
        <a href="${isLank(a)}" target="_blank" rel="noopener" class="font-mono text-xs text-ads-blue hover:underline">#${a.nr} ↗</a>
        <span class="font-semibold">${vkEsc(data.namn || a.rubrik)}</span>
        <span class="text-[11px] px-2 py-0.5 rounded-full ${l.farg}">${l.text}</span>
        <div class="flex-1"></div>
        <span class="text-[11px] text-ads-muted">${vkEsc(a.projekt)}</span>
        ${a.forfaller ? `<span class="text-[11px] ${isArForfallet(a) ? 'text-red-700 font-semibold' : 'text-ads-muted'}">förfaller ${a.forfaller}${d != null && d < 0 && !IS_KLARA.has(a.status) ? ` (${-d} d sen)` : ''}</span>` : ''}
      </div>
      <div class="px-4 py-3 grid md:grid-cols-2 gap-x-6 gap-y-3">
        <dl class="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          ${Object.entries(a.egnaFalt || {}).map(([t, v]) => `<dt class="text-ads-muted">${vkEsc(t)}</dt><dd class="text-ads-text break-all">${vkEsc(v)}</dd>`).join('')
            || '<dt class="text-ads-muted col-span-2 italic">Ärendet har inga ifyllda fält</dt>'}
        </dl>
        <ul class="text-xs space-y-1">${kontroller.map(k => `<li class="flex gap-1.5">${ikon[k.niva]} <span>${vkEsc(k.text)}</span></li>`).join('')}</ul>
      </div>
      <div class="px-4 py-3 border-t border-ads-border/60 bg-ads-gray/30">
        ${meddelande ? `<p class="text-xs mb-2 ${meddelande.fel ? 'text-red-700' : 'text-emerald-800'}">${vkEsc(meddelande.text)}</p>` : ''}
        ${atgard}
      </div>
    </div>`;
}

function isForberedFormHtml(a, ref, flik) {
  const u = _is.medlem.utkast.get(a.id);
  const projekt = (_projCache[_is.hubId] || []).filter(p => !String(p.attributes?.status || '').match(/archived/i));
  const projektVal = `
    <label class="block text-xs mb-2"><span class="text-ads-muted">Projekt</span>
      <select onchange="isUtkastProjekt(${ref}, this.value)" class="mt-0.5 w-full border border-ads-border rounded px-2 py-1 bg-white text-sm">
        ${projekt.map(p => `<option value="${p.id}" ${p.id === u.projektId ? 'selected' : ''}>${vkEsc(p.attributes?.name)}</option>`).join('')}
      </select></label>`;
  const epost = `
    <label class="block text-xs mb-2"><span class="text-ads-muted">E-post</span>
      <input value="${vkEsc(u.email)}" oninput="isUtkastFalt(${ref}, 'email', this.value)"
             class="mt-0.5 w-full border border-ads-border rounded px-2 py-1 text-sm font-mono" /></label>`;
  const knappar = `
    <div class="flex items-center gap-2 mt-3">
      <button onclick="isSparaForberedelse(${ref})" class="bg-be-charcoal hover:bg-black text-white text-xs font-medium py-1.5 px-3 rounded">Spara förberedelse</button>
      <button onclick="isAvbrytForbered()" class="text-xs text-ads-muted hover:text-ads-text px-2">Avbryt</button>
      <span class="text-[11px] text-ads-muted">Sparas som kommentar på ärendet. Inget ändras i projektet förrän en annan person bekräftat.</span>
    </div>`;

  if (flik === 'off') {
    const medlemmar = isMedlemmarFor(u.projektId).slice().sort((x, y) => (x.name || '').localeCompare(y.name || '', 'sv'));
    return `
      <div class="grid md:grid-cols-2 gap-x-6">
        <div>${projektVal}${epost}</div>
        <label class="block text-xs mb-2"><span class="text-ads-muted">Medlem som tas bort</span>
          <select onchange="isUtkastFalt(${ref}, 'userId', this.value)" class="mt-0.5 w-full border border-ads-border rounded px-2 py-1 bg-white text-sm">
            <option value="">– välj medlem –</option>
            ${medlemmar.map(m => `<option value="${m.id}" ${m.id === u.userId ? 'selected' : ''}>${vkEsc(m.name || m.email)} · ${vkEsc(m.email)}${m.companyName ? ` · ${vkEsc(m.companyName)}` : ''}</option>`).join('')}
          </select></label>
      </div>${knappar}`;
  }

  const roller = isRollerI(u.projektId);
  const produkter = isProdukterI(u.projektId);
  return `
    <div class="grid md:grid-cols-2 gap-x-6">
      <div>
        ${projektVal}${epost}
        <label class="block text-xs mb-2"><span class="text-ads-muted">Företag</span>
          <select onchange="isUtkastFalt(${ref}, 'companyId', this.value)" class="mt-0.5 w-full border border-ads-border rounded px-2 py-1 bg-white text-sm">
            <option value="">– välj företag –</option>
            ${(_is.medlem.foretag || []).map(f => `<option value="${f.id}" ${f.id === u.companyId ? 'selected' : ''}>${vkEsc(f.name)}</option>`).join('')}
          </select></label>
      </div>
      <div class="text-xs">
        <div class="text-ads-muted mb-0.5">Roller</div>
        <div class="max-h-28 overflow-y-auto border border-ads-border rounded bg-white px-2 py-1 mb-2">
          ${roller.map(([id, namn]) => `<label class="flex items-center gap-1.5"><input type="checkbox" class="accent-ads-blue"
              ${u.roleIds.includes(id) ? 'checked' : ''} onchange="isUtkastLista(${ref}, 'roleIds', '${id}', this.checked)" /> ${vkEsc(namn)}</label>`).join('')
            || '<span class="text-ads-muted italic">Inga roller hittades i projektet</span>'}
        </div>
        <div class="text-ads-muted mb-0.5">Produkter</div>
        <div class="flex flex-wrap gap-x-3 gap-y-1">
          ${produkter.map(k => `<label class="flex items-center gap-1"><input type="checkbox" class="accent-ads-blue"
              ${u.products.some(p => p.key === k) ? 'checked' : ''} onchange="isUtkastLista(${ref}, 'products', '${k}', this.checked)" />
              ${vkEsc(IS_PRODUKTER[k] || k)}${IS_ADMIN_PRODUKTER.has(k) ? ' <span class="text-amber-700">(admin)</span>' : ''}</label>`).join('')}
        </div>
        <p class="text-[10px] text-ads-muted mt-1">Förifyllt efter befintliga medlemmar från samma företag.</p>
      </div>
    </div>${knappar}`;
}

function isBekraftaHtml(a, ref, prep) {
  const egen = prep.av === isJag();
  const foretag = (_is.medlem.foretag || []).find(f => f.id === prep.companyId);
  const projekt = _is.projekt.get(prep.projektId)?.namn || isProjektNamn(prep.projektId);
  const rad = (t, v) => `<div><span class="text-ads-muted">${t}:</span> <b>${vkEsc(v)}</b></div>`;
  return `
    <div class="text-xs grid md:grid-cols-2 gap-x-6 gap-y-1 mb-2 p-2.5 rounded border border-amber-200 bg-amber-50/60">
      <div class="md:col-span-2 text-amber-900 mb-1">Förberedd av ${vkEsc(prep.av)} · ${(prep.tid || '').slice(0, 16).replace('T', ' ')}</div>
      ${rad('Projekt', projekt)}${rad('E-post', prep.email)}
      ${prep.typ === 'onb'
        ? rad('Företag', foretag?.name || prep.companyId || '–') + rad('Roller', isRollNamn(prep.projektId, prep.roleIds).join(', ') || 'inga') +
          rad('Produkter', (prep.products || []).map(p => IS_PRODUKTER[p.key] || p.key).join(', ') || 'standard')
        : rad('Tas bort', `${prep.namn || ''} (${prep.email})`)}
    </div>
    ${egen ? `
      <div class="flex items-center gap-3">
        <p class="text-xs text-amber-900">Du förberedde detta. En annan person behöver kontrollera och bekräfta.</p>
        <button onclick="isAtertaForberedelse(${ref})" class="text-xs text-ads-muted hover:text-red-700">Ta tillbaka</button>
      </div>` : `
      <div class="flex items-center gap-3 flex-wrap">
        <label class="flex items-center gap-1.5 text-xs cursor-pointer">
          <input id="is-kontrollerat-${a.id}" type="checkbox" class="accent-ads-blue" />
          Jag har kontrollerat e-post${prep.typ === 'onb' ? ', företag och roller' : ' och medlem'} mot ärendet</label>
        <button onclick="isBekrafta(${ref})" class="bg-be-charcoal hover:bg-black text-white text-xs font-medium py-1.5 px-3 rounded">
          ${prep.typ === 'onb' ? 'Bekräfta och lägg till' : 'Bekräfta och ta bort'}</button>
        <button onclick="isBorjaForbered(${ref})" class="text-xs text-ads-muted hover:text-ads-text">Förbered om…</button>
      </div>`}`;
}
