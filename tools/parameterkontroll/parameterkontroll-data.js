// parameterkontroll-data.js — hämtar modelldata ur ACC till beräkningen (del 1).
//
// Allt läses ur ACC:s egenskapsindex (Model Properties API). Indexet byggs en
// gång per filversion och ändras sedan inte. Prövat mot Autodesks
// exempelmodeller i R&D BIM ENGINE 2026-11-02, se docs/PLAN-PARAMETERKONTROLL.md
// avsnitt 10:
//
//   - Tomma värden finns inte alls i indexet, varken som "" eller null. En
//     fråga utelämnar likaså tomma kolumner. Katalogen (fälten) listar däremot
//     parametrar som saknar värde överallt.
//   - Länkarna till typ och förälder pekar på lmvId och ligger oftast i
//     propsIgnored, inte i props. Dit flyttar ACC också GUID, sökvägar,
//     ElementId och enstaka vanliga parametrar, så värden läses från båda.
//   - Typvärden finns kopierade på elementen, men inte alltid. Därför läses
//     typobjekten också.
//   - Revit: ett element har CategoryId. Trädets kategori-, familj- och
//     typnoder har det inte.
//   - IFC: klassen står i Element/IfcClass. Trädets klass- och typnoder
//     (Item/Type Category och Family) bär kopior av våningens värden och hoppas
//     över, och samma GlobalId räknas bara en gång.
//
// Resultatet följer formatet överst i parameterkontroll-berakna.js.

const PK_MAX_VANTAN   = 10 * 60 * 1000;   // index och frågor, innan vi ger upp
const PK_KOLUMNER     = 40;               // parameterkolumner per fråga
const PK_ID_PER_FRAGA = 500;              // typobjekt per fråga

function pkIndexBas(projectId) {
  return `/construction/index/v2/projects/${mcContainer(projectId)}`;
}

function pkAvbruten(signal) {
  if (signal?.aborted) throw new DOMException('Avbruten', 'AbortError');
}

function pkVanta(ms, signal) {
  return new Promise((klar, fel) => {
    const t = setTimeout(klar, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); fel(new DOMException('Avbruten', 'AbortError')); }, { once: true });
  });
}

// ACC föreslår när det är lönt att fråga igen. Mellan 3 och 15 sekunder.
function pkNastaFraga(svar) {
  const t = Date.parse(svar?.retryAt || '') - Date.now();
  return Math.min(15000, Math.max(3000, isNaN(t) ? 5000 : t));
}

// Värden i frågor skrivs inom enkelfnuttar. En fnutt i värdet dubbleras.
function pkCitera(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

// ── Index ─────────────────────────────────────────────────────────────────────

// Bygger eller hämtar index för flera versioner i samma anrop. Svarar per
// version med ACC:s indexpost, eller { state: 'SAKNAS' }.
async function pkIndexera(projectId, versionUrns, { signal, onProgress } = {}) {
  const bas   = pkIndexBas(projectId);
  const start = Date.now();
  let indexes = [];
  for (;;) {
    pkAvbruten(signal);
    const res = await apsPost(`${bas}/indexes:batch-status`, { versions: versionUrns.map(versionUrn => ({ versionUrn })) });
    indexes = res.indexes || [];
    onProgress?.(indexes);
    const pagar = indexes.filter(x => x.state === 'PROCESSING');
    if (!pagar.length || Date.now() - start > PK_MAX_VANTAN) break;
    await pkVanta(pkNastaFraga(pagar[0]), signal);
  }
  return Object.fromEntries(versionUrns.map(urn => [urn, indexes.find(x => (x.versionUrns || []).includes(urn)) || { state: 'SAKNAS' }]));
}

// ── Läsa svar ─────────────────────────────────────────────────────────────────
// Svaren är en JSON-post per rad och kan vara tiotals megabyte. De läses i
// bitar och delas upp efter hand, så att hela texten aldrig ligger i minnet.

async function pkLasRader(url, signal) {
  const res = await apsFetch(url, { signal });
  if (!res.ok) throw new Error(`APS error ${res.status}: ${await res.text()}`);
  const lasare = res.body.getReader();
  const avkod  = new TextDecoder();
  const rader  = [];
  let rest = '';
  for (;;) {
    const { done, value } = await lasare.read();
    if (done) break;
    const delar = (rest + avkod.decode(value, { stream: true })).split('\n');
    rest = delar.pop();
    for (const l of delar) if (l.trim()) rader.push(JSON.parse(l));
  }
  rest += avkod.decode();
  if (rest.trim()) rader.push(JSON.parse(rest));
  return rader;
}

// En fråga mot indexet: filter och utvalda kolumner. ACC svarar med ett jobb
// som blir klart efter några sekunder.
async function pkFraga(projectId, indexId, query, columns, signal) {
  const bas   = pkIndexBas(projectId);
  const start = Date.now();
  let q = await apsPost(`${bas}/indexes/${indexId}/queries`, { query, columns });
  while (q.state === 'PROCESSING') {
    if (Date.now() - start > PK_MAX_VANTAN) throw new Error('ACC blev inte klar med frågan i tid.');
    await pkVanta(1500, signal);
    q = await apsGet(`${bas}/indexes/${indexId}/queries/${q.queryId}`);
  }
  if (q.state !== 'FINISHED') throw new Error(`ACC kunde inte svara på frågan (${q.state}).`);
  return pkLasRader(q.queryResultsUrl, signal);
}

// ── Katalogen ─────────────────────────────────────────────────────────────────

function pkFaltKarta(falt) {
  const hitta = (kategori, namn) => falt.find(f => f.category === kategori && f.name === namn)?.key || null;
  const s = {
    kategori:   hitta('__category__', 'Category'),
    kategoriId: hitta('__categoryId__', 'CategoryId'),
    namn:       hitta('__name__', 'name'),
    typ:        hitta('__instanceof__', 'instanceof_objid'),
    forald:     hitta('__parent__', 'parent'),
    elementId:  hitta('__revit__', 'ElementId'),
    familj:     hitta('__category__', '_RFN'),
    typnamn:    hitta('__category__', '_RFT'),
    ifcKlass:   hitta('Element', 'IfcClass'),
    ifcGuid:    hitta('Element', 'IfcGUID'),
    ifcTyp:     hitta('IFC Type', 'IfcElementType'),
    itemTyp:    hitta('Item', 'Type'),
  };

  const vanliga = falt.filter(f => !String(f.category).startsWith('__'));
  const perNamn = new Map();
  for (const f of vanliga) {
    const n = pkNyckel(f.name);
    if (!perNamn.has(n)) perNamn.set(n, []);
    perNamn.get(n).push(f.key);
  }

  return {
    sort: s.kategoriId ? 'revit' : s.ifcKlass ? 'ifc' : 'okand',
    s,
    perNamn,
    falt: vanliga.map(f => ({ namn: pkNyckel(f.name), grupp: f.category, typ: f.type, enhet: f.uom || null })),
  };
}

async function pkLasKatalog(index, signal) {
  return pkFaltKarta(await pkLasRader(index.fieldsUrl, signal));
}

// ── Kategorier ────────────────────────────────────────────────────────────────

function pkRevitKategori(ra) {
  return pkNyckel(String(ra || '').replace(/^Revit /, ''));
}

// Elementfiltret och kategorin per modelltyp. ra är kategorin som den står i
// ACC, namn som den visas och sparas.
function pkElementFilter(karta) {
  const { s } = karta;
  if (karta.sort === 'revit') {
    return {
      filter:   { $notnull: `s.props.${s.kategoriId}` },
      kolumn:   `s.props.${s.kategori}`,
      namn:     ra => pkRevitKategori(ra),
      behall:   () => true,
    };
  }
  if (karta.sort === 'ifc') {
    return {
      filter:   { $notnull: `s.props.${s.ifcKlass}` },
      kolumn:   `s.props.${s.ifcKlass}`,
      namn:     ra => pkNyckel(ra),
      behall:   rad => !['Category', 'Family'].includes(rad.it),
    };
  }
  return null;
}

// ── Det som inte räknas ───────────────────────────────────────────────────────
// Bestämt av Mahdi 2026-11-02: inbäddade element räknas inte, och inte heller
// rivna element, element i designalternativ eller oplacerade rum. Gäller
// Revit; IFC har inte de begreppen i ACC:s data.
//
// Inbäddat är ett element vars förälder i trädet är ett annat element, till
// exempel beslag i en dörr eller en del i ett fönster. Delar av systemfamiljer
// är däremot egna element och räknas: fasadpaneler och profiler i en
// glasfasad, dörrar i en glasfasad, trapplopp och räckesdelar. Detsamma gäller
// element i grupper, sammanställningar, balksystem och fackverk.
const PK_SYSTEMVARDAR = new Set(['Walls', 'Curtain Systems', 'Stairs', 'Multistory Stairs', 'Railings', 'Ramps', 'Roofs', 'Floors', 'Ceilings',
  'Model Groups', 'Assemblies', 'Structural Beam Systems', 'Structural Trusses']);

// Rum utan yta är oplacerade (eller inte omslutna) och räknas inte.
const PK_RUMSKATEGORIER = new Set(['Rooms', 'Spaces', 'Areas']);

// Kolumnerna som behövs för att sortera bort element. Varje parameter läses
// ur både props och propsIgnored, och kan finnas i flera egenskapsgrupper.
function pkUtelamningsKolumner(karta) {
  if (karta.sort !== 'revit') return {};
  const kol = { id: 's.lmvId' };
  if (karta.s.forald) Object.assign(kol, { f1: `s.propsIgnored.${karta.s.forald}`, f2: `s.props.${karta.s.forald}` });
  const lagg = (prefix, namn) => (karta.perNamn.get(namn) || []).forEach((nyckel, j) => {
    kol[`${prefix}${j}a`] = `s.props.${nyckel}`;
    kol[`${prefix}${j}b`] = `s.propsIgnored.${nyckel}`;
  });
  lagg('riv', 'Phase Demolished');
  lagg('opt', 'Design Option');
  lagg('yta', 'Area');
  return kol;
}

function pkKolumnVarden(rad, prefix) {
  return Object.entries(rad).filter(([k]) => k.startsWith(prefix)).flatMap(([, v]) => Array.isArray(v) ? v : [v])
    .filter(v => v !== undefined && v !== null && String(v).trim() !== '');
}

// Sorterar kategoriläsningens rader. bort: id → orsak ('rivna',
// 'designalternativ', 'utanYta'); nastlade: id:n för inbäddade element.
// En ren funktion, så att reglerna kan provas med påhittade rader.
function pkSorteraElement(rader, namnAv) {
  const katPerId = new Map(rader.filter(r => r.id != null).map(r => [r.id, namnAv(r.k)]));
  const bort = new Map(), nastlade = new Set();
  for (const r of rader) {
    const kat = namnAv(r.k);
    let orsak = null;
    if (pkKolumnVarden(r, 'riv').some(v => !/^(none|ingen)$/i.test(String(v).trim()))) orsak = 'rivna';
    else if (pkKolumnVarden(r, 'opt').some(v => !/^(main model|huvudmodell)$/i.test(String(v).trim()))) orsak = 'designalternativ';
    else if (PK_RUMSKATEGORIER.has(kat) && !pkKolumnVarden(r, 'yta').some(v => parseFloat(String(v).replace(',', '.')) > 0)) orsak = 'utanYta';
    if (orsak) { bort.set(r.id, orsak); continue; }
    const forald = pkLank(r, 'f');
    if (forald != null && katPerId.has(forald) && !PK_SYSTEMVARDAR.has(katPerId.get(forald))) nastlade.add(r.id);
  }
  return { bort, nastlade };
}

// Antal element per kategori, och hur många av dem som har 3D-geometri. Det
// senare skiljer modellkategorier från taggar, mått och vyer i kategoristeget.
// Inbäddade räknas för sig, och det som inte räknas alls redovisas per orsak.
async function pkLasKategorier(projectId, index, karta, signal) {
  const ef = pkElementFilter(karta);
  if (!ef) throw new Error('Modellen är varken Revit eller IFC enligt ACC:s egenskapsindex.');

  const kolumner = { k: ef.kolumn, g: 's.geomHash', ...pkUtelamningsKolumner(karta) };
  if (karta.sort === 'ifc') Object.assign(kolumner, pkIfcKolumner(karta));
  const sedda = new Set();
  const rader = (await pkFraga(projectId, index.indexId, ef.filter, kolumner, signal)).filter(r => {
    if (!ef.behall(r) || !ef.namn(r.k)) return false;
    const guid = pkLank(r, 'guid');
    if (guid) { if (sedda.has(guid)) return false; sedda.add(guid); }
    return true;
  });
  const utelamnade = karta.sort === 'revit' ? pkSorteraElement(rader, ef.namn) : { bort: new Map(), nastlade: new Set() };

  const antal = {}, raNamn = {}, perOrsak = new Map();
  for (const r of rader) {
    const namn = ef.namn(r.k);
    raNamn[namn] = r.k;
    antal[namn] ??= { antal: 0, nastlade: 0, geometri: 0 };
    const orsak = utelamnade.bort.get(r.id);
    if (orsak) {
      const nyckel = `${namn}|${orsak}`;
      perOrsak.set(nyckel, (perOrsak.get(nyckel) || 0) + 1);
      continue;
    }
    if (utelamnade.nastlade.has(r.id)) antal[namn].nastlade++;
    else antal[namn].antal++;
    if (r.g) antal[namn].geometri++;
  }
  // En kategori där allt sorterades bort ska inte synas som en kategori med element.
  for (const [namn, a] of Object.entries(antal)) if (!a.antal && !a.nastlade) delete antal[namn];
  const uteslutna = [...perOrsak].map(([nyckel, n]) => { const [kategori, orsak] = nyckel.split('|'); return { kategori, orsak, antal: n }; });
  return { kategoriAntal: antal, raNamn, uteslutna, utelamnade };
}

// IFC: elementtyp i trädet och GlobalId, som ACC lägger i propsIgnored.
function pkIfcKolumner(karta) {
  return { it: `s.props.${karta.s.itemTyp}`, guid1: `s.propsIgnored.${karta.s.ifcGuid}`, guid2: `s.props.${karta.s.ifcGuid}` };
}

// ── Värden ────────────────────────────────────────────────────────────────────

// Kolumnerna för parametrarna, i omgångar om PK_KOLUMNER. En parameter kan
// finnas i flera egenskapsgrupper och får då en kolumn per grupp, och varje
// grupp läses både ur props och propsIgnored.
function pkParameterKolumner(karta, parametrar) {
  const lista = [];
  parametrar.forEach((namn, i) => {
    (karta.perNamn.get(pkNyckel(namn)) || []).forEach((nyckel, j) => {
      lista.push({ namn: pkNyckel(namn), kolumn: `p${i}_${j}a`, falt: `s.props.${nyckel}` });
      lista.push({ namn: pkNyckel(namn), kolumn: `p${i}_${j}b`, falt: `s.propsIgnored.${nyckel}` });
    });
  });
  const omgangar = [];
  for (let i = 0; i < lista.length; i += PK_KOLUMNER) omgangar.push(lista.slice(i, i + PK_KOLUMNER));
  return omgangar.length ? omgangar : [[]];
}

function pkLaggVarden(mal, rad, omgang) {
  for (const p of omgang) {
    const v = rad[p.kolumn];
    if (v === undefined) continue;
    (mal[p.namn] ??= []).push(...(Array.isArray(v) ? v : [v]));
  }
}

// Länkarna står ibland i props och ibland i propsIgnored, så båda frågas efter.
function pkLank(rad, namn) {
  return rad[`${namn}1`] ?? rad[`${namn}2`] ?? null;
}

// Elementen i de valda kategorierna med de valda parametrarnas värden, och de
// typobjekt elementen hänvisar till. utelamnade kommer från kategoriläsningen:
// det som inte räknas hoppas över och inbäddade element märks.
async function pkLasVarden(projectId, index, karta, raNamn, kategorier, parametrar, signal, utelamnade = null) {
  const ef = pkElementFilter(karta);
  const { s } = karta;
  const raVarden = kategorier.map(k => raNamn[k]).filter(Boolean);
  if (!raVarden.length) return { element: [], typer: {} };

  const filter = { $and: [ef.filter, { $in: [ef.kolumn, ...raVarden.map(pkCitera)] }] };
  const bas = { id: 's.lmvId', ext: 's.externalId', k: ef.kolumn };
  if (s.namn) bas.namn = `s.props.${s.namn}`;
  if (karta.sort === 'revit') {
    Object.assign(bas, {
      typ1: `s.propsIgnored.${s.typ}`, typ2: `s.props.${s.typ}`,
      eid1: `s.props.${s.elementId}`,  eid2: `s.propsIgnored.${s.elementId}`,
      fam:  `s.props.${s.familj}`,     tn:   `s.props.${s.typnamn}`,
    });
  } else {
    Object.assign(bas, pkIfcKolumner(karta));
    if (s.ifcTyp) bas.tn = `s.props.${s.ifcTyp}`;
  }

  const omgangar = pkParameterKolumner(karta, parametrar);
  const perId = new Map();
  const sedda = new Set();
  for (const [i, omgang] of omgangar.entries()) {
    const kolumner = { ...bas, ...Object.fromEntries(omgang.map(p => [p.kolumn, p.falt])) };
    for (const r of await pkFraga(projectId, index.indexId, filter, kolumner, signal)) {
      if (!ef.behall(r) || utelamnade?.bort.has(r.id)) continue;
      let el = perId.get(r.id);
      if (!el) {
        if (i > 0) continue;   // finns inte i första omgången: hoppades över där
        const guid = pkLank(r, 'guid');
        if (guid) { if (sedda.has(guid)) continue; sedda.add(guid); }
        const eid = pkLank(r, 'eid');
        el = {
          id:        r.id,
          extId:     karta.sort === 'ifc' ? guid || r.ext : r.ext,
          kategori:  ef.namn(r.k),
          familj:    karta.sort === 'ifc' ? ef.namn(r.k) : r.fam || '',
          typ:       r.tn || '',
          namn:      r.namn || '',
          typId:     karta.sort === 'revit' ? pkLank(r, 'typ') : null,
          elementId: eid != null ? Number(eid) : pkElementId(r.ext),
          nastlad:   !!utelamnade?.nastlade.has(r.id),
          varden:    {},
        };
        perId.set(r.id, el);
      }
      pkLaggVarden(el.varden, r, omgang);
    }
  }
  const element = [...perId.values()];

  // Typobjekten, för värden som bara står på typen.
  const typer = {};
  const typIds = [...new Set(element.map(e => e.typId).filter(id => id != null))];
  for (let i = 0; i < typIds.length; i += PK_ID_PER_FRAGA) {
    const del = typIds.slice(i, i + PK_ID_PER_FRAGA);
    for (const omgang of omgangar) {
      const kolumner = { id: 's.lmvId', namn: `s.props.${s.namn}`, ...Object.fromEntries(omgang.map(p => [p.kolumn, p.falt])) };
      for (const r of await pkFraga(projectId, index.indexId, { $in: ['s.lmvId', ...del] }, kolumner, signal)) {
        typer[r.id] ??= { namn: r.namn || '', familj: '', varden: {} };
        pkLaggVarden(typer[r.id].varden, r, omgang);
      }
    }
  }
  return { element, typer };
}

// Hur många element i ej valda kategorier som har värde i någon krävd
// parameter. Ger "Kanske glömd" i täckningen. Det som inte räknas, och
// inbäddade element, räknas inte här heller.
async function pkLasNarvaro(projectId, index, karta, valda, parametrar, signal, utelamnade = null) {
  const ef = pkElementFilter(karta);
  const omgangar = pkParameterKolumner(karta, parametrar).filter(o => o.length);
  const valdaSet = new Set(valda);
  const narvaro  = {};
  const sedda    = new Set();
  for (const omgang of omgangar) {
    const filter   = { $and: [ef.filter, { $or: omgang.map(p => ({ $notnull: p.falt })) }] };
    const kolumner = { id: 's.lmvId', k: ef.kolumn, ...Object.fromEntries(omgang.map(p => [p.kolumn, p.falt])) };
    if (karta.sort === 'ifc') Object.assign(kolumner, { it: `s.props.${karta.s.itemTyp}` });
    for (const r of await pkFraga(projectId, index.indexId, filter, kolumner, signal)) {
      if (!ef.behall(r) || utelamnade?.bort.has(r.id) || utelamnade?.nastlade.has(r.id)) continue;
      const kat = ef.namn(r.k);
      if (valdaSet.has(kat)) continue;
      const harVarde = new Set(omgang.filter(p => r[p.kolumn] !== undefined && pkNagotVarde(r[p.kolumn], null)).map(p => p.namn));
      for (const namn of harVarde) {
        const nyckel = `${r.id}|${namn}`;
        if (sedda.has(nyckel)) continue;
        sedda.add(nyckel);
        narvaro[kat] ??= {};
        narvaro[kat][namn] = (narvaro[kat][namn] || 0) + 1;
      }
    }
  }
  return narvaro;
}

// ── En modell ─────────────────────────────────────────────────────────────────
// modell: { id, namn, filtyp, version: { nummer, datum, urn } }
// Svarar alltid med en modell i beräkningens format. Går något fel blir status
// något annat än 'klar' och fel säger vad.

async function pkHamtaModell(projectId, modell, kategorier, parametrar, { index, signal, onSteg } = {}) {
  const ut = { ...modell, status: 'klar', falt: [], kategoriAntal: {}, hamtade: [], element: [], typer: {}, narvaro: {}, uteslutna: [] };
  try {
    onSteg?.('index');
    index ??= (await pkIndexera(projectId, [modell.version.urn], { signal }))[modell.version.urn];
    if (index.state !== 'FINISHED') {
      return { ...ut, status: 'index-fel', fel: index.state === 'PROCESSING'
        ? 'ACC har inte byggt klart egenskapsindexet. Försök igen om en stund.'
        : `ACC kunde inte bygga egenskapsindexet (${index.state}). Saknar versionen 3D-data? Öppna filen i ACC en gång och försök igen.` };
    }

    onSteg?.('katalog');
    const karta = await pkLasKatalog(index, signal);
    if (karta.sort === 'okand') return { ...ut, status: 'okand-modell', fel: 'Varken Revit eller IFC enligt ACC:s egenskapsindex.' };
    ut.falt = karta.falt;

    onSteg?.('kategorier');
    const { kategoriAntal, raNamn, uteslutna, utelamnade } = await pkLasKategorier(projectId, index, karta, signal);
    ut.kategoriAntal = kategoriAntal;
    ut.uteslutna = uteslutna;

    if (kategorier.length && parametrar.length) {
      onSteg?.('varden');
      Object.assign(ut, await pkLasVarden(projectId, index, karta, raNamn, kategorier, parametrar, signal, utelamnade));
      onSteg?.('narvaro');
      ut.narvaro = await pkLasNarvaro(projectId, index, karta, kategorier, parametrar, signal, utelamnade);
    }
    ut.hamtade = parametrar.map(pkNyckel);
    return ut;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return { ...ut, status: 'fel', fel: err.message };
  }
}
