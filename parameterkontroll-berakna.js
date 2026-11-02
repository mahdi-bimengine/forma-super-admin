// parameterkontroll-berakna.js — beräkningen i fliken Parameterkontroll (del 1).
//
// Allt här är rena funktioner: modelldata och val in, resultat ut. Inget hämtas
// och inget ritas. Skärmen, Excel, PDF och historiken räknar från samma
// resultat, så siffrorna kan inte skilja sig mellan dem. Definitionerna står i
// PLAN-PARAMETERKONTROLL.md, avsnitt 4.
//
// Modelldata kommer från datadelen och ser ut så här per modell:
//
//   id, namn, filtyp ('rvt' | 'ifc'), version { nummer, datum, urn }, disciplin
//   status          'klar', eller varför modellen inte kunde läsas
//   fel             text till användaren när status inte är 'klar'
//   falt            [{ namn, grupp, typ, enhet }]  egenskapskatalogen
//   kategoriAntal   { kategori: { antal, nastlade } }  från kategoriläsningen.
//                   antal räknar element utan inbäddade komponenter.
//   hamtade         [parameternamn] vars värden finns i element och typer
//   element         [{ id, extId, kategori, familj, typ, namn, typId, nastlad,
//                      varden: { parameternamn: [värden] } }]
//   typer           { typId: { namn, familj, varden: { parameternamn: [värden] } } }
//   narvaro         { kategori: { parameternamn: antal } }  för ej valda kategorier
//   uteslutna       [{ kategori, orsak, antal }]  objekt som datadelen inte tog med
//
// Nycklarna i varden är redan normaliserade med pkNyckel. En nyckel med bara
// tomma värden betyder att parametern finns men saknar värde. ACC tar aldrig med
// tomma värden, så från ACC saknas nyckeln helt när värdet är tomt. Om
// parametern alls finns i modellen avgörs då av katalogen (falt), och det går
// inte att skilja en tom parameter från en som inte lagts på kategorin.

// Hur en parameter står till på ett element.
const PK_INSTANS = 1;   // värde på elementet
const PK_TYP     = 2;   // värde på elementets typ
const PK_TOM     = 3;   // parametern finns på elementet men har inget värde
const PK_SAKNAS  = 4;   // inget värde och ingen tom parameter heller

// Andel av en kategori som en undantagsregel får ta bort innan den varnar.
const PK_STORT_UNDANTAG = 0.25;

// ── Namn och värden ───────────────────────────────────────────────────────────

// Exakt jämförelse. Å kan skrivas som ett tecken eller som A plus ring, och
// NFC gör dem lika. Mellanslag i kanterna räknas inte.
function pkNyckel(namn) {
  return String(namn ?? '').normalize('NFC').trim();
}

// Lös jämförelse för "liknande namn": utan skiftläge, mellanslag, bindestreck,
// understreck och punkter. RDS kod, rds-kod och RDS_Kod blir samma.
function pkLos(namn) {
  return pkNyckel(namn).toLocaleLowerCase('sv').replace(/[\s\-_.]+/g, '');
}

// \s fångar alla sorters mellanslag, även hårda, men inte nollbreddsmellanslag.
const PK_NOLLBREDD = String.fromCharCode(0x200b);

function pkTvatta(s) {
  return String(s).split(PK_NOLLBREDD).join('').replace(/\s+/g, ' ').trim();
}

function pkTomSet(tomma) {
  const s = new Set();
  for (const t of tomma || []) {
    const v = pkTvatta(t).normalize('NFC').toLocaleLowerCase('sv');
    if (v) s.add(v);
  }
  return s;
}

// Ett värde finns om det inte är tomt efter att blanktecken tagits bort, och
// inte står på listan "räknas som tomt". 0 och Nej är värden.
function pkHarVarde(v, tomSet) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number')  return Number.isFinite(v);
  if (typeof v === 'boolean') return true;
  // trim är snabb och tar alla mellanslag utom nollbredd. Hela tvätten görs
  // bara när den behövs, eftersom det här körs en gång per värde.
  let s = String(v).trim();
  if (s.includes(PK_NOLLBREDD)) s = pkTvatta(s);
  if (!s) return false;
  return !(tomSet && tomSet.size && tomSet.has(pkTvatta(s).normalize('NFC').toLocaleLowerCase('sv')));
}

function pkLista(v) {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function pkNagotVarde(varden, tomSet) {
  if (!Array.isArray(varden)) return pkHarVarde(varden, tomSet);
  for (let i = 0; i < varden.length; i++) if (pkHarVarde(varden[i], tomSet)) return true;
  return false;
}

// Värdet läses från elementet först, sedan från dess typ.
function pkLasParameter(el, typ, namn, tomSet) {
  const iv = el.varden?.[namn];
  if (iv !== undefined && pkNagotVarde(iv, tomSet)) return PK_INSTANS;
  const tv = typ?.varden?.[namn];
  if (tv !== undefined && pkNagotVarde(tv, tomSet)) return PK_TYP;
  if (iv !== undefined || tv !== undefined) return PK_TOM;
  return PK_SAKNAS;
}

// ── Jokertecken ───────────────────────────────────────────────────────────────
// * står för vad som helst, ? för ett tecken. Inget skiftläge. Jämförelsen går
// tecken för tecken utan reguljära uttryck, så ett illa skrivet mönster kan
// inte låsa webbläsaren.

function pkArMonster(s) {
  return /[*?]/.test(String(s ?? ''));
}

function pkMonsterMatchar(monster, text) {
  const p = pkNyckel(monster).toLocaleLowerCase('sv');
  const t = pkNyckel(text).toLocaleLowerCase('sv');
  let i = 0, j = 0, stjarna = -1, spar = 0;
  while (j < t.length) {
    if (i < p.length && (p[i] === '?' || p[i] === t[j])) { i++; j++; }
    else if (i < p.length && p[i] === '*') { stjarna = i++; spar = j; }
    else if (stjarna !== -1) { i = stjarna + 1; j = ++spar; }
    else return false;
  }
  while (i < p.length && p[i] === '*') i++;
  return i === p.length;
}

// ── Datatyper ─────────────────────────────────────────────────────────────────
// Egenskapskatalogen anger String, Boolean, Integer eller Double plus enhet.
// Prövat mot exempelmodeller i Modellkontroll: TEXT → String, YESNO → Boolean,
// INTEGER → Integer, NUMBER → Double utan enhet, LENGTH → Double i mm,
// AREA → Double i m².

const PK_ENHET_KORT = {
  millimeters: 'mm', centimeters: 'cm', meters: 'm', feet: 'ft', inches: 'in',
  squareMeters: 'm²', squareFeet: 'ft²', cubicMeters: 'm³', cubicFeet: 'ft³',
  liters: 'l', degrees: '°', degreesCelsius: '°C',
};

function pkForvantadTyp(datatyp) {
  const t = String(datatyp || '').toUpperCase();
  if (['TEXT', 'MULTILINETEXT', 'URL'].includes(t)) return { typ: 'String' };
  if (t === 'YESNO')   return { typ: 'Boolean' };
  if (t === 'INTEGER') return { typ: 'Integer' };
  if (t === 'NUMBER')  return { typ: 'Double', enhet: null };
  if (t === 'LENGTH')  return { typ: 'Double', enhet: 'length' };
  if (t === 'AREA')    return { typ: 'Double', enhet: 'area' };
  if (t === 'VOLUME')  return { typ: 'Double', enhet: 'volume' };
  if (t === 'ANGLE')   return { typ: 'Double', enhet: 'angle' };
  return null; // material, familjetyp och disciplintyper kontrolleras inte
}

function pkEnhetNamn(uom) {
  return String(uom || '').split(':').pop().split('-')[0];
}

function pkEnhetSort(uom) {
  const u = pkEnhetNamn(uom).toLowerCase();
  if (!u) return null;
  if (/celsius|fahrenheit|kelvin|rankine/.test(u)) return 'temperature';
  if (/^square|acres|hectares/.test(u))            return 'area';
  if (/^cubic|liters|gallons/.test(u))             return 'volume';
  if (/degrees|radians|gradians/.test(u))          return 'angle';
  if (/meters|feet|inches/.test(u))                return 'length';
  return 'other';
}

// Ett katalogfält beskrivet med parameterfilens ord.
function pkBeskrivFalt(f) {
  if (f.typ === 'String')  return 'TEXT';
  if (f.typ === 'Boolean') return 'YESNO';
  if (f.typ === 'Integer') return 'INTEGER';
  if (f.typ === 'Double') {
    const enhet = PK_ENHET_KORT[pkEnhetNamn(f.enhet)] || pkEnhetNamn(f.enhet);
    const namn  = { length: 'LENGTH', area: 'AREA', volume: 'VOLUME', angle: 'ANGLE' }[pkEnhetSort(f.enhet)] || 'NUMBER';
    return enhet ? `${namn} (${enhet})` : namn;
  }
  return String(f.typ || '');
}

function pkFaltMatchar(f, forvantad) {
  if (f.typ !== forvantad.typ) return false;
  if (forvantad.typ !== 'Double') return true;
  return forvantad.enhet === null ? !f.enhet : pkEnhetSort(f.enhet) === forvantad.enhet;
}

// ok: true eller false, null när det inte gick att pröva. Samma namn kan finnas
// i flera egenskapsgrupper, och alla måste stämma.
function pkJamforDatatyp(datatyp, falt) {
  const forvantad = pkForvantadTyp(datatyp);
  const modell    = [...new Set(falt.map(pkBeskrivFalt))];
  if (!forvantad || !falt.length) return { ok: null, modell };
  return { ok: falt.every(f => pkFaltMatchar(f, forvantad)), modell };
}

// ── Kravlistan ────────────────────────────────────────────────────────────────
// Namn ur parameterfil och inklistrad lista, plus de namn i modellerna som en
// regel med jokertecken fångar. Samma namn från flera källor blir ett krav,
// där den först angivna avgränsningen gäller.

function pkKravLista(val, modeller) {
  const krav = new Map();

  const lagg = (k, kalla) => {
    const namn = pkNyckel(k.namn);
    if (!namn) return;
    const fanns = krav.get(namn);
    if (fanns) {
      if (!fanns.kallor.includes(kalla)) fanns.kallor.push(kalla);
      for (const f of ['datatyp', 'grupp', 'beskrivning', 'guid']) if (!fanns[f] && k[f]) fanns[f] = k[f];
      return;
    }
    krav.set(namn, {
      namn,
      datatyp:     k.datatyp || '',
      grupp:       k.grupp || '',
      beskrivning: k.beskrivning || '',
      guid:        k.guid || '',
      kategorier:  k.kategorier ? [...new Set(k.kategorier.map(pkNyckel))] : null,
      kallor:      [kalla],
      regel:       k.regel || null,
    });
  };

  for (const k of val.krav || []) lagg(k, k.kalla || 'lista');

  const iModellerna = new Set();
  for (const m of modeller) {
    if (m.status !== 'klar') continue;
    for (const f of m.falt || []) iModellerna.add(pkNyckel(f.namn));
  }

  const reglerUtanTraff = [];
  for (const r of val.regler || []) {
    let traffar = 0;
    for (const namn of [...iModellerna].sort((a, b) => a.localeCompare(b, 'sv'))) {
      if (!pkMonsterMatchar(r.monster, namn)) continue;
      traffar++;
      lagg({ namn, kategorier: r.kategorier, regel: r.monster }, 'regel');
    }
    if (!traffar) reglerUtanTraff.push(r.monster);
  }

  return { krav: [...krav.values()], reglerUtanTraff };
}

// ── Undantag ──────────────────────────────────────────────────────────────────
// En regel tar bort element med avsikt: på familje- eller typnamn med
// jokertecken, eller på ett parametervärde. Det första regeln som träffar räknas.

function pkForberedUndantag(regler) {
  return (regler || []).map((r, i) => ({
    ...r,
    id:         r.id ?? `u${i + 1}`,
    parameter:  r.parameter ? pkNyckel(r.parameter) : '',
    sok:        pkNyckel(r.varde).toLocaleLowerCase('sv'),
    modeller:   r.modeller ? new Set(r.modeller) : null,
    kategorier: r.kategorier ? new Set(r.kategorier.map(pkNyckel)) : null,
  }));
}

function pkUndantagGaller(r, modellId, kategori) {
  return (!r.modeller || r.modeller.has(modellId)) && (!r.kategorier || r.kategorier.has(kategori));
}

function pkUndantagMatchar(r, el, typ) {
  if (r.typ === 'familj') return pkMonsterMatchar(r.monster, el.familj || typ?.familj || '');
  if (r.typ === 'typ')    return pkMonsterMatchar(r.monster, el.typ || typ?.namn || '');
  if (r.typ !== 'parameter') return false;

  const texter = [...pkLista(el.varden?.[r.parameter]), ...pkLista(typ?.varden?.[r.parameter])]
    .filter(v => pkHarVarde(v, null))
    .map(v => pkNyckel(String(v)).toLocaleLowerCase('sv'));

  switch (r.operator) {
    case 'ar':         return texter.some(t => t === r.sok);
    case 'innehaller': return texter.some(t => t.includes(r.sok));
    case 'borjar':     return texter.some(t => t.startsWith(r.sok));
    case 'tom':        return texter.length === 0;
    case 'inteTom':    return texter.length > 0;
    default:           return false;
  }
}

// ── Siffror ───────────────────────────────────────────────────────────────────

// Promille avrundat nedåt, så att 100 % bara visas när allt är ifyllt.
// Heltal in ger exakt kvot, så golvet blir rätt även för jämna procent.
function pkPromille(del, helt) {
  return helt > 0 ? Math.floor((del * 1000) / helt) : null;
}

function pkProcentText(del, helt, sprak = 'sv') {
  if (!helt) return '–';
  const p = pkPromille(del, helt);
  const sv = sprak === 'sv';
  if (p === 0 && del > 0) return sv ? '<0,1 %' : '<0.1%';
  const tal = p % 10 === 0 ? String(p / 10) : (p / 10).toFixed(1);
  return sv ? `${tal.replace('.', ',')} %` : `${tal}%`;
}

function pkTalText(n, sprak = 'sv') {
  return Number(n || 0).toLocaleString(sprak === 'sv' ? 'sv-SE' : 'en-GB');
}

function pkTommaNyckeltal() {
  return { element: 0, kontrollerade: 0, kravVarden: 0, ifyllda: 0, kravPar: 0, kompletta: 0, klara: 0 };
}

function pkLaggTill(summa, del) {
  for (const k of Object.keys(summa)) summa[k] += del[k] || 0;
  return summa;
}

// ── Beräkningen ───────────────────────────────────────────────────────────────

// modeller: modelldata enligt överst i filen.
// val:      { modeller: [{ id, kategorier, disciplin }], krav, regler, undantag,
//             raknaNastlade, tomma, troskel }
function pkBerakna(modeller, val) {
  const tomSet   = pkTomSet(val.tomma);
  const troskel  = Math.min(100, Math.max(0, Number(val.troskel ?? 100)));
  const undantag = pkForberedUndantag(val.undantag);
  const valPer   = new Map((val.modeller || []).map(v => [v.id, v]));
  const { krav, reglerUtanTraff } = pkKravLista(val, modeller);

  const res = {
    krav,
    troskel,
    modeller: [],
    sjalvkontroll: [],
    tackning: {
      reglerUtanTraff,
      saknasOveralt: [],
    },
  };

  for (const m of modeller) {
    res.modeller.push(pkBeraknaModell(m, valPer.get(m.id) || {}, krav, undantag, !!val.raknaNastlade, tomSet, troskel, res.sjalvkontroll));
  }

  // Krav som inte finns i någon läsbar modells katalog. Inbyggda Revitparametrar
  // kan stå på engelska i ACC, och det får användaren en ledtråd om.
  const lasbara = res.modeller.filter(m => m.status === 'klar');
  res.tackning.saknasOveralt = lasbara.length
    ? krav.filter(k => lasbara.every(m => !m.kravInfo[k.namn]?.iKatalog)).map(k => k.namn)
    : [];

  res.totalt      = pkLaggTill(pkTommaNyckeltal(), {});
  for (const m of lasbara) pkLaggTill(res.totalt, m.nyckeltal);
  res.discipliner = pkPerDisciplin(res.modeller);
  return res;
}

function pkBeraknaModell(m, mv, krav, undantag, raknaNastlade, tomSet, troskel, sjalvkontroll) {
  const ut = {
    id:        m.id,
    namn:      m.namn,
    filtyp:    m.filtyp,
    version:   m.version || null,
    disciplin: pkNyckel(mv.disciplin ?? m.disciplin ?? ''),
    status:    m.status,
    fel:       m.fel || null,
    kategorier: [],
    kravInfo:  {},
    nyckeltal: pkTommaNyckeltal(),
    tackning:  { ejValda: [], tommaValda: [], kravUtanKategori: [], undantagUtanTraff: [], storaUndantag: [], uteslutna: [] },
    undantag:  [],
    ofullstandig: false,
  };

  if (m.status !== 'klar') {
    ut.bedomning = 'kunde-inte-lasas';
    return ut;
  }

  const hamtade = new Set((m.hamtade || []).map(pkNyckel));
  const typer   = m.typer || {};
  const antal   = m.kategoriAntal || {};

  // Katalogen: exakta namn, och lösa namn för liknande-kontrollen.
  const faltPerNamn = new Map();
  const losPerNamn  = new Map();
  for (const f of m.falt || []) {
    const namn = pkNyckel(f.namn);
    if (!faltPerNamn.has(namn)) faltPerNamn.set(namn, []);
    faltPerNamn.get(namn).push(f);
    const los = pkLos(namn);
    if (!losPerNamn.has(los)) losPerNamn.set(los, new Set());
    losPerNamn.get(los).add(namn);
  }
  for (const k of krav) {
    const falt = faltPerNamn.get(k.namn) || [];
    ut.kravInfo[k.namn] = {
      iKatalog: falt.length > 0,
      liknande: [...(losPerNamn.get(pkLos(k.namn)) || [])].filter(n => n !== k.namn),
      datatyp:  pkJamforDatatyp(k.datatyp, falt),
      hamtad:   hamtade.has(k.namn),
    };
  }

  // Elementen per vald kategori.
  const valda = [...new Set((mv.kategorier || []).map(pkNyckel))].filter(Boolean);
  const perKategori = new Map(valda.map(k => [k, []]));
  for (const el of m.element || []) {
    const lista = perKategori.get(pkNyckel(el.kategori));
    if (lista) lista.push(el);
  }

  const undantagRaknare = new Map(undantag.map(r => [r.id, { regel: r, antal: 0, galler: false }]));

  // Utan katalog går det inte att säga att en parameter saknas i modellen.
  const harKatalog = faltPerNamn.size > 0;

  for (const kat of valda) {
    const kr = pkBeraknaKategori(m, kat, perKategori.get(kat), krav, hamtade, typer, undantag, undantagRaknare, raknaNastlade, tomSet, troskel,
      namn => harKatalog ? ut.kravInfo[namn].iKatalog : null);
    ut.kategorier.push(kr);

    // Självkontroll: samma antal element från kategoriläsningen som från
    // värdeläsningen, och varje parameter ska gå jämnt upp.
    const census = antal[kat] || { antal: 0, nastlade: 0 };
    if ((census.antal || 0) !== kr.vanliga || (census.nastlade || 0) !== kr.nastlade) {
      sjalvkontroll.push({ modell: m.namn, kategori: kat, fel: 'kategoriantal', vantat: census, fick: { antal: kr.vanliga, nastlade: kr.nastlade } });
    }
    if (kr.kontrollerade + kr.undantagna + kr.nastladeUteslutna !== kr.vanliga + kr.nastlade) {
      sjalvkontroll.push({ modell: m.namn, kategori: kat, fel: 'kategorisumma' });
    }
    for (const p of kr.parametrar) {
      if (p.status === 'ejHamtad') continue;
      if (p.instans + p.typ + p.tom + p.saknas !== kr.kontrollerade) {
        sjalvkontroll.push({ modell: m.namn, kategori: kat, parameter: p.namn, fel: 'parametersumma' });
      }
    }

    if (kr.antal === 0) ut.tackning.tommaValda.push(kat);
    pkLaggTill(ut.nyckeltal, kr.nyckeltal);
    if (kr.ofullstandig) ut.ofullstandig = true;
  }

  // Täckning: element i valda kategorier och i kategorier med 3D-geometri.
  // Revit räknar också skisslinjer, referensplan och material som element,
  // och de skulle annars dränka täckningen. Saknas uppgiften om geometri
  // räknas kategorin med.
  let allaElement = 0;
  for (const [kat, a] of Object.entries(antal)) {
    const n      = (a.antal || 0) + (raknaNastlade ? a.nastlade || 0 : 0);
    const vald   = perKategori.has(pkNyckel(kat));
    const modell = a.geometri === undefined || a.geometri > 0;
    if (vald || modell) allaElement += n;
    if (vald || n === 0) continue;
    const narvaro = m.narvaro?.[kat] || {};
    const glomda  = krav.filter(k => (narvaro[k.namn] || 0) > 0).map(k => k.namn);
    // Hur många element som mest har värde i något krav, så att användaren
    // kan skilja en glömd kategori från en där bara enstaka element har värden.
    const medVarde = Math.min(n, Math.max(0, ...glomda.map(namn => narvaro[namn])));
    if (modell || glomda.length) ut.tackning.ejValda.push({ kategori: kat, antal: n, kanskeGlomd: glomda, medVarde });
  }
  ut.tackning.ejValda.sort((a, b) => (b.kanskeGlomd.length - a.kanskeGlomd.length) || (b.medVarde - a.medVarde) || (b.antal - a.antal));
  ut.nyckeltal.element = allaElement;
  // Det datadelen inte tog med, i de valda kategorierna.
  ut.tackning.uteslutna = (m.uteslutna || []).filter(u => u.antal > 0 && perKategori.has(pkNyckel(u.kategori)));

  // Krav som inte gäller någon vald kategori som har element i modellen.
  const medElement = ut.kategorier.filter(k => k.antal > 0).map(k => k.namn);
  if (medElement.length) {
    ut.tackning.kravUtanKategori = krav
      .filter(k => k.kategorier && !medElement.some(kat => k.kategorier.includes(kat)))
      .map(k => k.namn);
  }

  // Undantagsregler som inte träffade något där de gällde.
  for (const { regel, antal: n, galler } of undantagRaknare.values()) {
    if (galler) ut.undantag.push({ id: regel.id, antal: n });
    if (galler && n === 0) ut.tackning.undantagUtanTraff.push(regel.id);
  }
  for (const k of ut.kategorier) {
    for (const u of k.undantag) {
      if (u.antal > 0 && u.antal / k.antal > PK_STORT_UNDANTAG) {
        ut.tackning.storaUndantag.push({ id: u.id, kategori: k.namn, antal: u.antal, av: k.antal });
      }
    }
  }

  // Bedömningen. 0 av 0 blir aldrig godkänt.
  const par = ut.kategorier.flatMap(k => k.parametrar.filter(p => p.antal > 0 && p.status !== 'ejHamtad'));
  if (ut.ofullstandig)      ut.bedomning = 'ofullstandig';
  else if (!par.length)     ut.bedomning = 'ej-bedomd';
  else if (par.every(p => p.uppfyller)) ut.bedomning = 'uppfyller';
  else                      ut.bedomning = 'uppfyller-inte';

  return ut;
}

function pkBeraknaKategori(m, kat, element, krav, hamtade, typer, undantag, undantagRaknare, raknaNastlade, tomSet, troskel, iKatalog) {
  const nastlade = element.filter(e => e.nastlad).length;
  const raknade  = raknaNastlade ? element : element.filter(e => !e.nastlad);

  const tillampliga = undantag.filter(r => pkUndantagGaller(r, m.id, kat));
  for (const r of tillampliga) if (raknade.length) undantagRaknare.get(r.id).galler = true;

  const kontrollerade = [];
  const undantagna    = [];
  const perRegel      = new Map();
  for (const el of raknade) {
    const typ = typer[el.typId];
    const r   = tillampliga.find(r => pkUndantagMatchar(r, el, typ));
    if (r) {
      undantagna.push({ el, regel: r.id });
      perRegel.set(r.id, (perRegel.get(r.id) || 0) + 1);
      undantagRaknare.get(r.id).antal++;
    } else {
      kontrollerade.push(el);
    }
  }

  // fyllda räknar per element hur många krav som har värde, för klara element.
  const n      = kontrollerade.length;
  const fyllda = new Uint16Array(n);
  const parametrar = krav
    .filter(k => !k.kategorier || k.kategorier.includes(kat))
    .map(k => pkBeraknaParameter(k, kontrollerade, typer, hamtade, tomSet, troskel, fyllda, iKatalog(k.namn)));

  const hamtadeP = parametrar.filter(p => p.status !== 'ejHamtad');
  let klara = null;
  if (hamtadeP.length === parametrar.length) {
    klara = 0;
    for (let i = 0; i < n; i++) if (fyllda[i] === hamtadeP.length) klara++;
  }

  const nyckeltal = {
    element:       raknade.length,
    kontrollerade: n,
    kravVarden:    n * hamtadeP.length,
    ifyllda:       hamtadeP.reduce((s, p) => s + p.medVarde, 0),
    kravPar:       n > 0 ? hamtadeP.length : 0,
    kompletta:     n > 0 ? hamtadeP.filter(p => p.status === 'komplett').length : 0,
    klara:         klara || 0,
  };

  return {
    namn:     kat,
    antal:    raknade.length,
    vanliga:  element.length - nastlade,
    nastlade,
    nastladeUteslutna: element.length - raknade.length,
    undantagna: undantagna.length,
    undantag:   [...perRegel].map(([id, antal]) => ({ id, antal })),
    undantagnaElement: undantagna,
    kontrollerade: n,
    element:  kontrollerade,
    parametrar,
    kompletta: parametrar.filter(p => p.status === 'komplett').length,
    delvis:    parametrar.filter(p => p.status === 'delvis').length,
    tomma:     parametrar.filter(p => p.status === 'tom' || p.status === 'ingetVarde').length,
    saknade:   parametrar.filter(p => p.status === 'finnsInte').length,
    klara,
    ofullstandig: n > 0 && hamtadeP.length < parametrar.length,
    nyckeltal,
  };
}

// Status när inget element har värde: tom om tomma parametrar syns (andra
// källor än ACC), finnsInte om katalogen säger att parametern inte finns i
// modellen, annars ingetVarde (tom eller inte lagd på kategorin, ACC skiljer
// inte på dem).
function pkBeraknaParameter(k, element, typer, hamtade, tomSet, troskel, fyllda, iKatalog) {
  const n  = element.length;
  const ut = { namn: k.namn, antal: n, medVarde: 0, instans: 0, typ: 0, tom: 0, saknas: 0, koder: null, uppfyller: null };

  if (!hamtade.has(k.namn)) {
    ut.status = 'ejHamtad';
    return ut;
  }

  const koder = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const el = element[i];
    const kod = pkLasParameter(el, typer[el.typId], k.namn, tomSet);
    koder[i] = kod;
    if (kod === PK_INSTANS) { ut.instans++; fyllda[i]++; }
    else if (kod === PK_TYP) { ut.typ++; fyllda[i]++; }
    else if (kod === PK_TOM) ut.tom++;
    else ut.saknas++;
  }
  ut.koder    = koder;
  ut.medVarde = ut.instans + ut.typ;

  if (n === 0)                 ut.status = 'ingaElement';
  else if (ut.medVarde === n)  ut.status = 'komplett';
  else if (ut.medVarde > 0)    ut.status = 'delvis';
  else if (ut.tom > 0)         ut.status = 'tom';
  else if (iKatalog === false) ut.status = 'finnsInte';
  else                         ut.status = 'ingetVarde';

  ut.promille  = pkPromille(ut.medVarde, n);
  ut.uppfyller = n > 0 ? ut.medVarde * 100 >= troskel * n : null;
  return ut;
}

// ── Per disciplin ─────────────────────────────────────────────────────────────
// En modell som inte kunde läsas räknas inte in i disciplinens siffror, men
// står med så att den inte försvinner tyst.

function pkPerDisciplin(modeller) {
  const per = new Map();
  for (const m of modeller) {
    const d = m.disciplin || '';
    if (!per.has(d)) per.set(d, { disciplin: d, modeller: [], nyckeltal: pkTommaNyckeltal(), uppfyller: 0, bedomda: 0, olasbara: 0 });
    const g = per.get(d);
    g.modeller.push(m.id);
    if (m.status !== 'klar') { g.olasbara++; continue; }
    pkLaggTill(g.nyckeltal, m.nyckeltal);
    if (m.bedomning === 'uppfyller' || m.bedomning === 'uppfyller-inte') g.bedomda++;
    if (m.bedomning === 'uppfyller') g.uppfyller++;
  }
  // Ej angiven sist, resten i svensk ordning.
  return [...per.values()].sort((a, b) =>
    (a.disciplin === '') - (b.disciplin === '') || a.disciplin.localeCompare(b.disciplin, 'sv'));
}

// ── Elementen bakom en siffra ─────────────────────────────────────────────────
// Brister för en parameter i en kategori. Saknas värdet på en typparameter
// blir det en rad per typ, eftersom det åtgärdas på typen. En parameter räknas
// som typparameter när någon typ i kategorin har den; ACC tar inte med tomma
// värden, så en typ utan värde syns inte själv.

function pkBrister(modellRes, kategori, parameter, typer = {}) {
  const k = modellRes.kategorier.find(k => k.namn === pkNyckel(kategori));
  const p = k?.parametrar.find(p => p.namn === pkNyckel(parameter));
  if (!p || !p.koder) return { element: [], typer: [] };

  const typParameter = k.element.some(el => typer[el.typId]?.varden?.[p.namn] !== undefined);
  const element = [];
  const perTyp  = new Map();
  for (let i = 0; i < k.element.length; i++) {
    const kod = p.koder[i];
    if (kod === PK_INSTANS || kod === PK_TYP) continue;
    const el  = k.element[i];
    const typ = typer[el.typId];
    const paTypen = typ && el.varden?.[p.namn] === undefined && (typ.varden?.[p.namn] !== undefined || typParameter);
    if (paTypen) {
      if (!perTyp.has(el.typId)) perTyp.set(el.typId, { typId: el.typId, typ: typ.namn || el.typ || '', familj: typ.familj || el.familj || '', kod, antal: 0 });
      perTyp.get(el.typId).antal++;
    } else {
      element.push({ el, kod });
    }
  }
  return { element, typer: [...perTyp.values()] };
}

// Revits UniqueId är ett GUID följt av ElementId skrivet hexadecimalt. Ett
// vanligt GUID eller en IFC GlobalId ger inget ElementId.
function pkElementId(extId) {
  const m = String(extId || '').match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-([0-9a-f]{8,16})$/i);
  return m ? parseInt(m[1], 16) : null;
}
