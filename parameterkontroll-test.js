// parameterkontroll-test.js — prov av beräkningen med påhittade data.
//
// Öppna parameterkontroll-test.html i en lokal kopia. Inget hämtas från ACC.
// Modell A följer testmodellen i PLAN-PARAMETERKONTROLL.md, avsnitt 10, så att
// samma siffror kan jämföras när den riktiga testmodellen finns i
// R&D BIM ENGINE. Varje förväntat tal är uträknat för hand i kommentaren.

const PK_TEST_KRAV = ['PK_Text_Instans', 'PK_Text_Typ', 'PK_Tal', 'PK_JaNej', 'PK_Langd'];

// Osynliga tecken anges med nummer, så att de syns i koden.
const PK_HART_MELLANSLAG = String.fromCharCode(0xa0);
const PK_NOLLBREDD_TEST  = String.fromCharCode(0x200b);
const PK_RING            = String.fromCharCode(0x30a);   // A + ring = Å skrivet i två tecken

function pkTestElement(id, kategori, varden, extra = {}) {
  return {
    id,
    extId:  `60f91daf-3dd7-4283-a86d-24137b73f3da-${id.toString(16).padStart(8, '0')}`,
    kategori,
    familj: 'Familj',
    typ:    'Typ',
    typId:  null,
    namn:   `${kategori} ${id}`,
    nastlad: false,
    varden,
    ...extra,
  };
}

function pkTestModellA() {
  const vagg = (id, varden) => pkTestElement(id, 'Walls', varden, { familj: 'Basic Wall', typ: 'Generic 200', typId: 'tW' });
  const dorr = (id, typId)  => pkTestElement(id, 'Doors', { PK_Text_Instans: ['v'], PK_Tal: [1], PK_JaNej: [true] }, { familj: 'Dörr', typ: typId === 'tA' ? 'Typ A' : 'Typ B', typId });

  return {
    id: 'A', namn: 'A-modell.rvt', filtyp: 'rvt', status: 'klar',
    version: { nummer: 12, datum: '2026-10-29T10:00:00Z', urn: 'urn:test:A?version=12' },
    falt: [
      { namn: 'PK_Text_Instans', grupp: 'Data',          typ: 'String' },
      { namn: 'PK_Text_Typ',     grupp: 'Data',          typ: 'String' },
      { namn: 'PK_Tal',          grupp: 'Data',          typ: 'Double' },
      { namn: 'PK_Tal',          grupp: 'Övrigt',        typ: 'String' },   // samma namn, annan datatyp
      { namn: 'PK_JaNej',        grupp: 'Data',          typ: 'Boolean' },
      { namn: 'PK_Langd',        grupp: 'Data',          typ: 'Double', enhet: 'autodesk.unit.unit:millimeters-1.0.1' },
      { namn: 'PK_Heltal',       grupp: 'Data',          typ: 'Integer' },
      { namn: 'PK Text Instans', grupp: 'Data',          typ: 'String' },   // nästan samma namn
      { namn: 'Comments',        grupp: 'Identity Data', typ: 'String' },
    ],
    kategoriAntal: {
      'Walls':               { antal: 12, nastlade: 0 },
      'Doors':               { antal: 6,  nastlade: 0 },
      'Generic Models':      { antal: 3,  nastlade: 1 },
      'Rooms':               { antal: 3,  nastlade: 0 },
      'Project Information': { antal: 1,  nastlade: 0 },
      'Floors':              { antal: 5,  nastlade: 0 },
      'Cable Trays':         { antal: 3,  nastlade: 0 },
    },
    hamtade: [...PK_TEST_KRAV, 'Comments'],
    narvaro: { 'Cable Trays': { PK_Text_Instans: 1 } },
    uteslutna: [{ kategori: 'Walls', orsak: 'rivna', antal: 1 }, { kategori: 'Floors', orsak: 'rivna', antal: 2 }],
    typer: {
      tW: { namn: 'Generic 200', familj: 'Basic Wall', varden: {} },
      tA: { namn: 'Typ A', familj: 'Dörr', varden: { PK_Text_Typ: ['X'] } },
      tB: { namn: 'Typ B', familj: 'Dörr', varden: { PK_Text_Typ: [''] } },
    },
    element: [
      // Väggar. Text: 4 ifyllda, '-' räknas som ifyllt utan tomlista, 5 tomma.
      // Tal: 0 är ett värde. JaNej: Nej är ett värde. Längd bara på w1–w3.
      vagg(1,  { PK_Text_Instans: ['A'], PK_Tal: [0], PK_JaNej: [true],  PK_Langd: [3000], Comments: ['x'] }),
      vagg(2,  { PK_Text_Instans: ['B'], PK_Tal: [0], PK_JaNej: [true],  PK_Langd: [3000], Comments: ['x'] }),
      vagg(3,  { PK_Text_Instans: ['C'], PK_Tal: [0], PK_JaNej: [true],  PK_Langd: [3000], Comments: ['x'] }),
      vagg(4,  { PK_Text_Instans: ['D'], PK_Tal: [5], PK_JaNej: [false] }),
      vagg(5,  { PK_Text_Instans: [''],  PK_Tal: [5], PK_JaNej: [false] }),
      vagg(6,  { PK_Text_Instans: [''],  PK_Tal: [5], PK_JaNej: [false] }),
      vagg(7,  { PK_Text_Instans: [' '], PK_Tal: [null], PK_JaNej: [null] }),
      vagg(8,  { PK_Text_Instans: ['-'], PK_Tal: [null], PK_JaNej: [null] }),
      vagg(9,  { PK_Text_Instans: [null], PK_Tal: [null], PK_JaNej: [null] }),
      vagg(10, { PK_Text_Instans: [null], PK_Tal: [null], PK_JaNej: [null] }),
      // Undantas av regeln Comments är Befintlig (skiftläge och mellanslag spelar ingen roll).
      vagg(11, { PK_Text_Instans: ['E'], Comments: ['Befintlig'] }),
      vagg(12, { Comments: [' befintlig '] }),

      // Dörrar. Typparametern ifylld på typ A, tom på typ B.
      dorr(21, 'tA'), dorr(22, 'tA'), dorr(23, 'tA'),
      dorr(24, 'tB'), dorr(25, 'tB'), dorr(26, 'tB'),

      // Allmänna modeller. g2 är inbäddad, r1 och r2 undantas av familjeregeln.
      pkTestElement(31, 'Generic Models', { PK_Text_Instans: ['G'], PK_Tal: [2], PK_JaNej: [false], PK_Langd: [100] }, { familj: 'Box' }),
      pkTestElement(32, 'Generic Models', {}, { familj: 'Handtag', nastlad: true }),
      pkTestElement(33, 'Generic Models', {}, { familj: 'Ref Marker' }),
      pkTestElement(34, 'Generic Models', {}, { familj: 'Ref Marker' }),

      // Rum: ett komplett, ett utan parametrarna, ett med tom text.
      pkTestElement(41, 'Rooms', { PK_Text_Instans: ['R1'], PK_Tal: [1], PK_JaNej: [true], PK_Langd: [1] }),
      pkTestElement(42, 'Rooms', {}),
      pkTestElement(43, 'Rooms', { PK_Text_Instans: [null] }),

      pkTestElement(51, 'Project Information', { PK_Text_Instans: ['Testprojekt'] }),
    ],
  };
}

function pkTestModellB() {
  const ifc = (id, text) => ({ ...pkTestElement(id, 'IfcWall', { PK_Text_Instans: [text] }), extId: '2O2Fr$t4X7Zf8NOew3FLOH' });
  return {
    id: 'B', namn: 'A-modell.ifc', filtyp: 'ifc', status: 'klar',
    falt: [{ namn: 'PK_Text_Instans', grupp: 'BIM Engine', typ: 'String' }],
    kategoriAntal: { IfcWall: { antal: 2, nastlade: 0 } },
    hamtade: PK_TEST_KRAV,
    typer: {},
    element: [ifc(61, 'a'), ifc(62, 'b')],
  };
}

function pkTestModeller() {
  return [
    pkTestModellA(),
    pkTestModellB(),
    { id: 'C', namn: 'K-modell.rvt', filtyp: 'rvt', status: 'saknar-3d', fel: 'Versionen saknar 3D-data.' },
    { id: 'D', namn: 'K-modell-2.rvt', filtyp: 'rvt', status: 'klar', falt: [], kategoriAntal: { Walls: { antal: 4, nastlade: 0 } }, hamtade: PK_TEST_KRAV, typer: {}, element: [] },
  ];
}

function pkTestVal(andra = {}) {
  return {
    modeller: [
      { id: 'A', disciplin: 'A', kategorier: ['Walls', 'Doors', 'Generic Models', 'Rooms', 'Project Information'] },
      { id: 'B', disciplin: 'A', kategorier: ['IfcWall'] },
      { id: 'C', disciplin: 'K', kategorier: ['Walls'] },
      { id: 'D', disciplin: 'K', kategorier: ['Doors'] },
    ],
    krav: [
      { namn: 'PK_Text_Instans', kalla: 'fil', datatyp: 'TEXT' },
      { namn: 'PK_Text_Typ',     kalla: 'fil', datatyp: 'TEXT', kategorier: ['Doors'] },
      { namn: 'PK_Tal',          kalla: 'fil', datatyp: 'NUMBER' },
      { namn: 'PK_JaNej',        kalla: 'fil', datatyp: 'YESNO' },
    ],
    regler: [{ monster: 'PK_Lang*' }, { monster: 'XYZ*' }],
    undantag: [
      { id: 'u1', typ: 'familj',    monster: '*ref*', kategorier: ['Generic Models'] },
      { id: 'u2', typ: 'parameter', parameter: 'Comments', operator: 'ar', varde: 'Befintlig', kategorier: ['Walls'] },
      { id: 'u3', typ: 'typ',       monster: 'Finns inte*', modeller: ['A'] },
    ],
    raknaNastlade: false,
    tomma: [],
    troskel: 100,
    ...andra,
  };
}

// ── Provramverk ───────────────────────────────────────────────────────────────

const _pkTester = [];

function pkProv(namn, fn) { _pkTester.push({ namn, fn }); }

function pkLika(fick, vantat, vad) {
  const a = JSON.stringify(fick), b = JSON.stringify(vantat);
  if (a !== b) throw new Error(`${vad}: fick ${a}, väntade ${b}`);
}

function pkKat(res, modellId, kat) {
  return res.modeller.find(m => m.id === modellId).kategorier.find(k => k.namn === kat);
}

function pkPar(res, modellId, kat, param) {
  return pkKat(res, modellId, kat).parametrar.find(p => p.namn === param);
}

function pkRaknaKoder(p) {
  return { med: p.medVarde, instans: p.instans, typ: p.typ, tom: p.tom, saknas: p.saknas, status: p.status };
}

// ── Prov: grunder ─────────────────────────────────────────────────────────────

pkProv('Värde finns: text, tal, ja/nej och tomt', () => {
  const tom = pkTomSet(['-', 'TBD']);
  pkLika([null, undefined, '', ' ', PK_HART_MELLANSLAG, PK_NOLLBREDD_TEST, '\t\n'].map(v => pkHarVarde(v, null)), [false, false, false, false, false, false, false], 'tomma');
  pkLika([0, false, 'x', 'Nej', -1].map(v => pkHarVarde(v, null)), [true, true, true, true, true], 'värden');
  pkLika(pkHarVarde(NaN, null), false, 'NaN');
  pkLika(['-', ' tbd ', 'TBD2', '--'].map(v => pkHarVarde(v, tom)), [false, false, true, true], 'räknas som tomt');
});

pkProv('Procent avrundas nedåt, 100 % bara när allt är ifyllt', () => {
  pkLika(pkProcentText(9996, 10000), '99,9 %', '99,96 %');
  pkLika(pkProcentText(1, 10000), '<0,1 %', 'under 0,1 %');
  pkLika(pkProcentText(10000, 10000), '100 %', '100 %');
  pkLika(pkProcentText(0, 5), '0 %', '0 %');
  pkLika(pkProcentText(643, 1000), '64,3 %', '64,3 %');
  pkLika(pkProcentText(1, 2), '50 %', '50 %');
  pkLika(pkProcentText(57, 100), '57 %', '57 % (flyttal)');
  pkLika(pkProcentText(643, 1000, 'en'), '64.3%', 'engelska');
  pkLika(pkProcentText(0, 0), '–', '0 av 0');
  pkLika(pkPromille(29, 100), 290, 'promille 29 %');
});

pkProv('Jokertecken, utan skiftläge och utan att låsa sig', () => {
  pkLika(pkMonsterMatchar('RDS*', 'RDS-kod'), true, 'RDS*');
  pkLika(pkMonsterMatchar('rds*', 'RDS-kod'), true, 'skiftläge');
  pkLika(pkMonsterMatchar('RDS*', 'XRDS'), false, 'början');
  pkLika(pkMonsterMatchar('*kod', 'RDS-kod'), true, '*kod');
  pkLika(pkMonsterMatchar('RDS?kod', 'RDS-kod'), true, '?');
  pkLika(pkMonsterMatchar('RDS?kod', 'RDS--kod'), false, '? är ett tecken');
  pkLika(pkMonsterMatchar('*', ''), true, '* mot tomt');
  pkLika(pkMonsterMatchar('a', ''), false, 'a mot tomt');
  pkLika(pkMonsterMatchar('Å*', `A${PK_RING}terkoppling`), true, 'å skrivet på två sätt');
  const start = performance.now();
  pkLika(pkMonsterMatchar('*a*a*a*a*a*a*a*a*b', 'a'.repeat(5000)), false, 'elakt mönster');
  const tid = performance.now() - start;
  if (tid > 500) throw new Error(`elakt mönster tog ${Math.round(tid)} ms`);
});

pkProv('Namn: exakt med normaliserat å, lös för liknande', () => {
  pkLika(pkNyckel(`  A${PK_RING}k `) === pkNyckel('Åk'), true, 'NFC och mellanslag');
  pkLika(pkLos('RDS kod') === pkLos('rds-kod') && pkLos('rds-kod') === pkLos('RDS_Kod'), true, 'lös nyckel');
  pkLika(pkLos('RDS kod') === pkLos('RDS-kodx'), false, 'olika namn');
});

pkProv('Revit ElementId ur UniqueId, inte ur GUID eller IFC', () => {
  pkLika(pkElementId('60f91daf-3dd7-4283-a86d-24137b73f3da-0001fd0b'), 130315, 'UniqueId');
  pkLika(pkElementId('60f91daf-3dd7-4283-a86d-24137b73f3da'), null, 'bara GUID');
  pkLika(pkElementId('2O2Fr$t4X7Zf8NOew3FLOH'), null, 'IFC GlobalId');
});

pkProv('Kravlistan: dubbletter slås ihop, regler fångar namn', () => {
  const { krav, reglerUtanTraff } = pkKravLista({
    krav:   [{ namn: ' PK_A ', kalla: 'fil', datatyp: 'TEXT' }, { namn: 'PK_A', kalla: 'lista' }, { namn: 'PK_B', kalla: 'lista' }],
    regler: [{ monster: 'PK_*' }, { monster: 'Ingen*' }],
  }, [{ status: 'klar', falt: [{ namn: 'PK_A' }, { namn: 'PK_C' }] }, { status: 'saknar-3d', falt: [{ namn: 'PK_D' }] }]);
  pkLika(krav.map(k => k.namn), ['PK_A', 'PK_B', 'PK_C'], 'namn');
  pkLika(krav[0].kallor, ['fil', 'lista', 'regel'], 'källor');
  pkLika(krav[0].datatyp, 'TEXT', 'datatyp');
  pkLika(reglerUtanTraff, ['Ingen*'], 'regel utan träff');
});

// ── Prov: hela testuppsättningen ──────────────────────────────────────────────

pkProv('Väggar: tomt, mellanslag, 0, Nej och längd', () => {
  const res = pkBerakna(pkTestModeller(), pkTestVal());
  const k = pkKat(res, 'A', 'Walls');
  pkLika([k.antal, k.undantagna, k.kontrollerade, k.klara], [12, 2, 10, 3], 'antal, undantagna, kontrollerade, klara');
  // Text: A–D och '-' har värde (5). '', '', ' ', null, null är tomma (5).
  pkLika(pkRaknaKoder(pkPar(res, 'A', 'Walls', 'PK_Text_Instans')), { med: 5, instans: 5, typ: 0, tom: 5, saknas: 0, status: 'delvis' }, 'text');
  // Tal: 0, 0, 0, 5, 5, 5 har värde. Fyra tomma.
  pkLika(pkRaknaKoder(pkPar(res, 'A', 'Walls', 'PK_Tal')), { med: 6, instans: 6, typ: 0, tom: 4, saknas: 0, status: 'delvis' }, 'tal');
  // Ja/nej: tre Ja och tre Nej har värde.
  pkLika(pkPar(res, 'A', 'Walls', 'PK_JaNej').medVarde, 6, 'ja/nej');
  // Längd finns bara på w1–w3, saknas på resten.
  pkLika(pkRaknaKoder(pkPar(res, 'A', 'Walls', 'PK_Langd')), { med: 3, instans: 3, typ: 0, tom: 0, saknas: 7, status: 'delvis' }, 'längd');
  // Typparametern gäller bara dörrar.
  pkLika(pkPar(res, 'A', 'Walls', 'PK_Text_Typ'), undefined, 'typparameter ej krav på väggar');
});

pkProv('Dörrar: värde på typen räknas, tom typ blir en rad per typ', () => {
  const modeller = pkTestModeller();
  const res = pkBerakna(modeller, pkTestVal());
  pkLika(pkRaknaKoder(pkPar(res, 'A', 'Doors', 'PK_Text_Typ')), { med: 3, instans: 0, typ: 3, tom: 3, saknas: 0, status: 'delvis' }, 'typparameter');
  pkLika(pkPar(res, 'A', 'Doors', 'PK_Text_Instans').status, 'komplett', 'instans komplett');
  // Längd finns i katalogen men inte på någon dörr: tom eller inte lagd på kategorin.
  pkLika(pkPar(res, 'A', 'Doors', 'PK_Langd').status, 'ingetVarde', 'längd utan värde');
  const brist = pkBrister(res.modeller[0], 'Doors', 'PK_Text_Typ', modeller[0].typer);
  pkLika(brist.element.length, 0, 'inga elementrader');
  pkLika(brist.typer.map(t => [t.typId, t.typ, t.antal]), [['tB', 'Typ B', 3]], 'en rad för typ B');
  const vagg = pkBrister(res.modeller[0], 'Walls', 'PK_Text_Instans', modeller[0].typer);
  pkLika(vagg.element.map(b => b.el.id), [5, 6, 7, 9, 10], 'väggar utan text');
});

pkProv('Allmänna modeller: inbäddad räknas inte, Ref-familjen undantas', () => {
  const res = pkBerakna(pkTestModeller(), pkTestVal());
  const k = pkKat(res, 'A', 'Generic Models');
  pkLika([k.antal, k.nastladeUteslutna, k.undantagna, k.kontrollerade, k.kompletta, k.klara], [3, 1, 2, 1, 4, 1], 'allmänna modeller');
  const m = res.modeller[0];
  pkLika(m.tackning.storaUndantag, [{ id: 'u1', kategori: 'Generic Models', antal: 2, av: 3 }], 'stort undantag');
  pkLika(m.tackning.undantagUtanTraff, ['u3'], 'regel utan träff');
  pkLika(m.undantag, [{ id: 'u1', antal: 2 }, { id: 'u2', antal: 2 }, { id: 'u3', antal: 0 }], 'antal per regel');
});

pkProv('Med inbäddade komponenter påslaget', () => {
  const res = pkBerakna(pkTestModeller(), pkTestVal({ raknaNastlade: true }));
  const k = pkKat(res, 'A', 'Generic Models');
  pkLika([k.antal, k.kontrollerade, k.klara], [4, 2, 1], 'antal, kontrollerade, klara');
  pkLika(res.sjalvkontroll, [], 'självkontroll');
});

pkProv('Rum och projektinformation', () => {
  const res = pkBerakna(pkTestModeller(), pkTestVal());
  pkLika(pkRaknaKoder(pkPar(res, 'A', 'Rooms', 'PK_Text_Instans')), { med: 1, instans: 1, typ: 0, tom: 1, saknas: 1, status: 'delvis' }, 'rum text');
  pkLika(pkKat(res, 'A', 'Rooms').klara, 1, 'rum klara');
  const pi = pkKat(res, 'A', 'Project Information');
  pkLika(pi.parametrar.map(p => p.status), ['komplett', 'ingetVarde', 'ingetVarde', 'ingetVarde'], 'projektinformation');
});

pkProv('Modell A: nyckeltal, bedömning och täckning', () => {
  const res = pkBerakna(pkTestModeller(), pkTestVal());
  const m = res.modeller[0];
  // Krävda värden 40 + 30 + 4 + 12 + 4 = 90, ifyllda 20 + 21 + 4 + 4 + 1 = 50.
  pkLika(m.nyckeltal, { element: 33, kontrollerade: 21, kravVarden: 90, ifyllda: 50, kravPar: 21, kompletta: 8, klara: 5 }, 'nyckeltal');
  pkLika(pkProcentText(m.nyckeltal.ifyllda, m.nyckeltal.kravVarden), '55,5 %', 'ifyllnadsgrad');
  pkLika(pkProcentText(m.nyckeltal.kontrollerade, m.nyckeltal.element), '63,6 %', 'täckning');
  pkLika(m.bedomning, 'uppfyller-inte', 'bedömning');
  pkLika(m.tackning.ejValda, [
    { kategori: 'Cable Trays', antal: 3, kanskeGlomd: ['PK_Text_Instans'], medVarde: 1 },
    { kategori: 'Floors', antal: 5, kanskeGlomd: [], medVarde: 0 },
  ], 'ej valda kategorier');
  pkLika(m.tackning.uteslutna, [{ kategori: 'Walls', orsak: 'rivna', antal: 1 }], 'uteslutna av datadelen');
  pkLika(m.kravInfo.PK_Text_Instans.liknande, ['PK Text Instans'], 'liknande namn');
  pkLika(m.kravInfo.PK_Tal.datatyp, { ok: false, modell: ['NUMBER', 'TEXT'] }, 'fel datatyp');
  pkLika(m.kravInfo.PK_Text_Instans.datatyp.ok, true, 'rätt datatyp');
  pkLika(m.kravInfo.PK_Langd.datatyp.ok, null, 'datatyp okänd för regelparameter');
  pkLika(res.sjalvkontroll, [], 'självkontroll');
});

pkProv('Övriga modeller: IFC, oläsbar och 0 av 0', () => {
  const res = pkBerakna(pkTestModeller(), pkTestVal());
  const [, b, c, d] = res.modeller;
  pkLika([b.nyckeltal.kravVarden, b.nyckeltal.ifyllda, b.bedomning], [8, 2, 'uppfyller-inte'], 'IFC-modellen');
  pkLika(b.tackning.kravUtanKategori, ['PK_Text_Typ'], 'krav som inte gäller någon kategori');
  // IFC-modellens katalog har bara textparametern, så talet finns inte i modellen.
  pkLika(pkKat(res, 'B', 'IfcWall').parametrar.map(p => p.status), ['komplett', 'finnsInte', 'finnsInte', 'finnsInte'], 'IFC-status');
  pkLika([c.bedomning, c.fel], ['kunde-inte-lasas', 'Versionen saknar 3D-data.'], 'oläsbar');
  pkLika([d.bedomning, d.tackning.tommaValda, d.nyckeltal.element], ['ej-bedomd', ['Doors'], 4], '0 av 0 är inte godkänt');
  pkLika(res.tackning.reglerUtanTraff, ['XYZ*'], 'regel utan träff');
  pkLika(res.krav.map(k => k.namn), [...PK_TEST_KRAV], 'kravlista');
});

pkProv('Totalt och per disciplin', () => {
  const res = pkBerakna(pkTestModeller(), pkTestVal());
  pkLika([res.totalt.kravVarden, res.totalt.ifyllda], [98, 52], 'totalt');
  pkLika(res.discipliner.map(d => [d.disciplin, d.modeller, d.nyckeltal.kravVarden, d.nyckeltal.ifyllda, d.bedomda, d.uppfyller, d.olasbara]), [
    ['A', ['A', 'B'], 98, 52, 2, 0, 0],
    ['K', ['C', 'D'], 0, 0, 0, 0, 1],
  ], 'discipliner');
});

pkProv('Räknas som tomt: "-" blir tomt', () => {
  const res = pkBerakna(pkTestModeller(), pkTestVal({ tomma: ['-'] }));
  pkLika(pkPar(res, 'A', 'Walls', 'PK_Text_Instans').medVarde, 4, 'väggar med text');
});

pkProv('Värden som inte hämtats än gör modellen ofullständig', () => {
  const modeller = pkTestModeller();
  modeller[0].hamtade = modeller[0].hamtade.filter(n => n !== 'PK_Tal');
  const res = pkBerakna(modeller, pkTestVal());
  const k = pkKat(res, 'A', 'Walls');
  pkLika(pkPar(res, 'A', 'Walls', 'PK_Tal').status, 'ejHamtad', 'status');
  pkLika([k.klara, k.nyckeltal.kravVarden], [null, 30], 'klara och krävda värden');
  pkLika(res.modeller[0].bedomning, 'ofullstandig', 'bedömning');
});

pkProv('Tröskel: 96 av 100 klarar 95 men inte 100', () => {
  const element = Array.from({ length: 100 }, (_, i) => pkTestElement(i + 1, 'X', { P: [i < 96 ? 'v' : ''] }));
  const modell = { id: 'T', namn: 'T.rvt', status: 'klar', falt: [{ namn: 'P', typ: 'String' }], kategoriAntal: { X: { antal: 100, nastlade: 0 } }, hamtade: ['P'], typer: {}, element };
  const val = t => ({ modeller: [{ id: 'T', kategorier: ['X'] }], krav: [{ namn: 'P' }], troskel: t });
  pkLika(pkBerakna([modell], val(95)).modeller[0].bedomning, 'uppfyller', 'tröskel 95');
  pkLika(pkBerakna([modell], val(96)).modeller[0].bedomning, 'uppfyller', 'tröskel 96, exakt');
  pkLika(pkBerakna([modell], val(100)).modeller[0].bedomning, 'uppfyller-inte', 'tröskel 100');
});

pkProv('Självkontrollen larmar när kategoriantalen inte stämmer', () => {
  const modeller = pkTestModeller();
  modeller[0].kategoriAntal.Walls.antal = 13;
  const res = pkBerakna(modeller, pkTestVal());
  pkLika(res.sjalvkontroll.map(f => [f.kategori, f.fel]), [['Walls', 'kategoriantal']], 'larm');
});

pkProv('Krav som inte finns i någon modell', () => {
  const modell = { id: 'S', namn: 'S.rvt', status: 'klar', falt: [{ namn: 'Comments', typ: 'String' }], kategoriAntal: {}, hamtade: ['Kommentarer'], typer: {}, element: [] };
  const res = pkBerakna([modell], { modeller: [{ id: 'S', kategorier: [] }], krav: [{ namn: 'Kommentarer' }] });
  pkLika(res.tackning.saknasOveralt, ['Kommentarer'], 'saknas överallt');
});

pkProv('Krav skrivet med å på annat sätt hittar parametern', () => {
  const modell = { id: 'N', namn: 'N.rvt', status: 'klar', falt: [{ namn: 'Rumsfunktion Å', typ: 'String' }], kategoriAntal: { Rooms: { antal: 1, nastlade: 0 } }, hamtade: ['Rumsfunktion Å'], typer: {},
    element: [pkTestElement(1, 'Rooms', { 'Rumsfunktion Å': ['Kontor'] })] };
  const res = pkBerakna([modell], { modeller: [{ id: 'N', kategorier: ['Rooms'] }], krav: [{ namn: `Rumsfunktion A${PK_RING}` }] });
  pkLika(pkPar(res, 'N', 'Rooms', 'Rumsfunktion Å').status, 'komplett', 'hittad');
});

pkProv('Täckning räknar bara kategorier med 3D-geometri och de valda', () => {
  const modell = {
    id: 'G', namn: 'G.rvt', status: 'klar', falt: [{ namn: 'P', typ: 'String' }], hamtade: ['P'], typer: {},
    kategoriAntal: {
      Walls:              { antal: 2,   nastlade: 0, geometri: 2 },
      Rooms:              { antal: 2,   nastlade: 0, geometri: 0 },   // vald, utan geometri
      Floors:             { antal: 6,   nastlade: 0, geometri: 6 },   // ej vald modellkategori
      '<Sketch>':         { antal: 500, nastlade: 0, geometri: 0 },   // internt, räknas inte
      'Generic Annotations': { antal: 40, nastlade: 0, geometri: 0 }, // har P-värden: kanske glömd
    },
    narvaro: { 'Generic Annotations': { P: 3 } },
    element: [pkTestElement(1, 'Walls', { P: ['a'] }), pkTestElement(2, 'Walls', {}), pkTestElement(3, 'Rooms', { P: ['b'] }), pkTestElement(4, 'Rooms', {})],
  };
  const m = pkBerakna([modell], { modeller: [{ id: 'G', kategorier: ['Walls', 'Rooms'] }], krav: [{ namn: 'P' }] }).modeller[0];
  // 2 + 2 + 6 element i underlaget, 4 kontrollerade.
  pkLika([m.nyckeltal.kontrollerade, m.nyckeltal.element], [4, 10], 'täckning');
  pkLika(m.tackning.ejValda.map(e => [e.kategori, e.kanskeGlomd]), [['Generic Annotations', ['P']], ['Floors', []]], 'ej valda');
});

pkProv('Data som från ACC: tomma värden saknas helt, typbristen blir en rad per typ', () => {
  // ACC kopierar typvärdet till elementen och tar inte med tomma värden alls.
  const dorr = (id, typId, varden) => pkTestElement(id, 'Doors', varden, { typId });
  const modell = {
    id: 'T2', namn: 'T2.rvt', status: 'klar',
    falt: [{ namn: 'Brandklass', typ: 'String' }, { namn: 'Mark', typ: 'String' }],
    kategoriAntal: { Doors: { antal: 5, nastlade: 0 } },
    hamtade: ['Brandklass', 'Mark', 'Saknas helt'],
    typer: { tA: { namn: 'Typ A', familj: 'Dörr', varden: { Brandklass: ['EI30'] } }, tB: { namn: 'Typ B', familj: 'Dörr', varden: {} } },
    element: [
      dorr(1, 'tA', { Brandklass: ['EI30'], Mark: ['D1'] }),
      dorr(2, 'tA', { Brandklass: ['EI30'] }),
      dorr(3, 'tB', {}), dorr(4, 'tB', {}), dorr(5, 'tB', { Mark: ['D5'] }),
    ],
  };
  const res = pkBerakna([modell], { modeller: [{ id: 'T2', kategorier: ['Doors'] }], krav: [{ namn: 'Brandklass' }, { namn: 'Mark' }, { namn: 'Saknas helt' }] });
  const k = pkKat(res, 'T2', 'Doors');
  pkLika(k.parametrar.map(p => [p.namn, p.status, p.medVarde]), [['Brandklass', 'delvis', 2], ['Mark', 'delvis', 2], ['Saknas helt', 'finnsInte', 0]], 'status');
  const brand = pkBrister(res.modeller[0], 'Doors', 'Brandklass', modell.typer);
  pkLika([brand.element.length, brand.typer.map(t => [t.typId, t.antal])], [0, [['tB', 3]]], 'typparameter grupperas per typ');
  const mark = pkBrister(res.modeller[0], 'Doors', 'Mark', modell.typer);
  pkLika(mark.element.map(b => b.el.id), [2, 3, 4], 'instansparameter per element');
});

pkProv('Rapporttexterna finns på både svenska och engelska', () => {
  pkLika(pkOrdSaknas(), [], 'nycklar som bara finns på ett språk');
  pkLika(pkAndelNed(9996, 10000), 0.999, 'Excel får 99,9 %, inte 100 %');
});

pkProv('Inga modeller och inga val ger ett tomt resultat utan fel', () => {
  const res = pkBerakna([], {});
  pkLika([res.modeller.length, res.totalt.kravVarden, res.discipliner.length], [0, 0, 0], 'tomt');
});

pkProv('Snabbhet: 2 miljoner värden under 0,4 sekunder (mål 0,2 s per miljon)', () => {
  const namn = Array.from({ length: 20 }, (_, i) => `P${i}`);
  const element = Array.from({ length: 100000 }, (_, i) => {
    const varden = {};
    for (const n of namn) varden[n] = [i % 7 === 0 ? '' : 'v'];
    return { id: i, kategori: 'Pipes', typId: null, varden };
  });
  const modell = { id: 'S', namn: 'S.rvt', status: 'klar', falt: namn.map(n => ({ namn: n, typ: 'String' })), kategoriAntal: { Pipes: { antal: 100000, nastlade: 0 } }, hamtade: namn, typer: {}, element };
  const start = performance.now();
  const res = pkBerakna([modell], { modeller: [{ id: 'S', kategorier: ['Pipes'] }], krav: namn.map(n => ({ namn: n })) });
  const tid = performance.now() - start;
  pkLika(res.modeller[0].nyckeltal.kravVarden, 2000000, 'krävda värden');
  // Vart sjunde element har tomma värden, så klara element är de övriga.
  pkLika(res.modeller[0].nyckeltal.klara, 100000 - Math.ceil(100000 / 7), 'klara element');
  if (tid > 400) throw new Error(`tog ${Math.round(tid)} ms`);
});

pkProv('Det som inte räknas: rivna, designalternativ, rum utan yta och inbäddade', () => {
  const rader = [
    { id: 1,  k: 'Revit Walls', riv0a: 'None' },
    { id: 2,  k: 'Revit Walls', riv0a: 'New Construction' },
    { id: 3,  k: 'Revit Walls', riv0b: 'Ingen', opt0a: 'Main Model' },
    { id: 4,  k: 'Revit Walls', opt0a: 'Fasad : Alternativ A (primary)' },
    { id: 5,  k: 'Revit Walls', opt1b: 'Huvudmodell' },
    { id: 6,  k: 'Revit Rooms', yta0a: 0 },
    { id: 7,  k: 'Revit Rooms', yta0a: 12.5 },
    { id: 8,  k: 'Revit Rooms' },
    { id: 9,  k: 'Revit Rooms', yta0b: '8,2' },
    { id: 10, k: 'Revit Doors' },
    { id: 11, k: 'Revit Generic Models', f1: 10 },      // beslag i en dörr
    { id: 12, k: 'Revit Doors', f1: 1 },                // dörr i en glasfasad
    { id: 13, k: 'Revit Curtain Panels', f2: 1 },       // panel i en glasfasad
    { id: 14, k: 'Revit Doors', f1: 999 },              // föräldern är en typnod
    { id: 15, k: 'Revit Generic Models', f1: 2, riv0a: 'Fas 2' },
    { id: 16, k: 'Revit Doors', riv0a: ' none ' },
    { id: 17, k: 'Revit Generic Models', f1: 11 },      // inbäddad i en inbäddad
    { id: 18, k: 'Revit Generic Models', f1: 20 },      // i en modellgrupp
    { id: 20, k: 'Revit Model Groups' },
  ];
  const { bort, nastlade } = pkSorteraElement(rader, pkRevitKategori);
  pkLika([...bort], [[2, 'rivna'], [4, 'designalternativ'], [6, 'utanYta'], [8, 'utanYta'], [15, 'rivna']], 'bortsorterade');
  pkLika([...nastlade], [11, 17], 'inbäddade');
});

pkProv('Täckningen säger vad som inte räknas, bara i valda kategorier', () => {
  const m = pkBerakna(pkTestModeller(), pkTestVal()).modeller[0];
  pkLika(pkEjRaknadeText(m, PK_ORD.sv), '1 rivna element i Väggar (Walls); 1 inbäddade element (delar av andra familjer) i Generiska modeller (Generic Models)', 'svenska');
  pkLika(pkEjRaknadeText(m, PK_ORD.en), '1 demolished elements in Walls; 1 nested elements (parts of other families) in Generic Models', 'engelska');
});

pkProv('Kategorinamn på svenska med det engelska bredvid, IFC och okända på engelska', () => {
  pkLika([pkKatText('Walls'), pkKatText('Walls', 'en'), pkKatText('IfcWall'), pkKatText('Okänd kategori')],
    ['Väggar (Walls)', 'Walls', 'IfcWall', 'Okänd kategori'], 'namn');
  // Varje svenskt namn är unikt, utom Utrymmen som är samma kategori i två versioner av Revit.
  const sv = Object.entries(PK_KATEGORI_SV).filter(([en]) => en !== 'MEP Spaces').map(([, s]) => s);
  pkLika(sv.filter((s, i) => sv.indexOf(s) !== i), [], 'dubbletter');
});

// ── Körning ───────────────────────────────────────────────────────────────────

function pkKorProv() {
  const utfall = _pkTester.map(t => {
    const start = performance.now();
    try { t.fn(); return { namn: t.namn, ok: true, ms: performance.now() - start }; }
    catch (err) { return { namn: t.namn, ok: false, fel: err.message, ms: performance.now() - start }; }
  });
  window.pkProvUtfall = utfall;

  const el = document.getElementById('utfall');
  if (el) {
    const ok = utfall.filter(u => u.ok).length;
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    el.innerHTML = `
      <p class="${ok === utfall.length ? 'ok' : 'fel'} sammanfattning">${ok} av ${utfall.length} prov gick igenom</p>
      ${utfall.map(u => `
        <div class="prov ${u.ok ? 'ok' : 'fel'}">
          <span>${u.ok ? '✓' : '✗'}</span> ${esc(u.namn)} <small>${Math.round(u.ms)} ms</small>
          ${u.ok ? '' : `<pre>${esc(u.fel)}</pre>`}
        </div>`).join('')}`;
  }
  return utfall;
}
