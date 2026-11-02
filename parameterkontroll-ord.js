// parameterkontroll-ord.js — rapporternas texter på svenska och engelska
// (del 6). Excel och PDF hämtar alla sina texter här, inget skrivs direkt i
// rapportkoden. Fliken själv är på svenska. Modell-, kategori- och
// parameternamn översätts aldrig. Provet i parameterkontroll-test.js kollar att
// båda språken har samma nycklar.

const PK_ORD = {
  sv: {
    sprak: 'sv',
    rapport: 'Parameterkontroll',
    ja: 'Ja', nej: 'Nej',
    info: {
      projekt: 'Projekt', kontroll: 'Kontroll', kord: 'Körd', kordAv: 'Körd av', kravprofil: 'Kravprofil',
      troskel: 'Godkänt vid', ifyllnad: 'Ifyllnadsgrad', klara: 'Klara element', tackning: 'Täckning',
      modeller: 'Modeller som uppfyller kraven', matning: 'Mäter om värden finns, inte om de är korrekta.',
    },
    blad: {
      sammanfattning: 'Sammanfattning', modellKategori: 'Modell–kategori', parametrar: 'Parametrar', atgarder: 'Åtgärdslista',
      element: 'Element', undantag: 'Undantag', varden: 'Värden', krav: 'Krav', om: 'Om kontrollen',
    },
    kol: {
      modell: 'Modell', disciplin: 'Disciplin', version: 'Version', versionsdatum: 'Versionsdatum', elementIModell: 'Element i modellen',
      element: 'Element', undantagna: 'Undantagna', kontrollerade: 'Kontrollerade', krav: 'Krav', kompletta: 'Kompletta krav',
      delvis: 'Delvis', ingetVarde: 'Inget värde', finnsInte: 'Finns inte', kravVarden: 'Krävda värden', ifyllda: 'Ifyllda värden',
      ifyllnad: 'Ifyllnadsgrad', klara: 'Klara element', andelKlara: 'Andel klara', tackning: 'Täckning', bedomning: 'Bedömning',
      kategori: 'Kategori', parameter: 'Parameter', status: 'Status', medVarde: 'Med värde', utanVarde: 'Utan värde', andel: 'Andel',
      instans: 'Från instans', typ: 'Från typ', datatypModell: 'Datatyp i modellen', anmarkning: 'Anmärkning', familj: 'Familj',
      typnamn: 'Typ', elementId: 'ElementId', externtId: 'UniqueId / GlobalId', namn: 'Namn', problem: 'Problem', paverkar: 'Påverkar element',
      varde: 'Värde', antal: 'Antal element', kalla: 'Källa', galler: 'Gäller kategorier', grupp: 'Grupp', guid: 'GUID',
      beskrivning: 'Beskrivning', datatyp: 'Datatyp', regel: 'Regel', skal: 'Skäl',
    },
    status: {
      komplett: 'Komplett', delvis: 'Delvis', ingetVarde: 'Inget värde', tom: 'Tom', finnsInte: 'Finns inte i modellen',
      ingaElement: 'Inga element', ejHamtad: 'Ej hämtad',
    },
    bedomning: {
      'uppfyller': 'Uppfyller kraven', 'uppfyller-inte': 'Uppfyller inte', 'ej-bedomd': 'Ej bedömd',
      'ofullstandig': 'Ofullständig', 'kunde-inte-lasas': 'Kunde inte läsas',
    },
    problem: { saknarVarde: 'Saknar värde', typenSaknar: 'Typen saknar värde', typen: '(typen)' },
    kalla: { fil: 'Parameterfil', lista: 'Lista', regel: 'Regel' },
    allaKategorier: 'Alla valda kategorier',
    fler: n => `+ ${n} andra unika värden`,
    avkortat: n => `Bladet är avkortat efter ${n} rader. Excel rymmer inte fler.`,
    liknande: namn => `Liknande namn i modellen: ${namn}`,
    annanTyp: typ => `Annan datatyp i modellen (${typ})`,
    regelFangar: namn => namn.length ? `Fångar: ${namn.join(', ')}` : 'Matchar inga parametrar',
    undantagRegel: (vad, var_) => `${vad} · ${var_}`,
    familjRegel: m => `Familj ${m}`, typRegel: m => `Typ ${m}`,
    operator: { ar: 'är', innehaller: 'innehåller', borjar: 'börjar med', tom: 'är tom', inteTom: 'är inte tom' },
    allaModeller: 'alla modeller',
    definitioner: [
      'Så räknas siffrorna',
      'Element: ett placerat objekt i modellen med en kategori. Trädets kategori-, familj- och typnoder räknas inte.',
      'Värde: text som inte är tom efter att mellanslag tagits bort, ett tal (0 räknas) eller Ja/Nej (Nej räknas). Värdet läses från elementet och annars från dess typ.',
      'ACC tar inte med tomma värden. "Inget värde" betyder att parametern finns i modellen men inte har värde på något element i kategorin; den kan vara tom eller inte tillagd på kategorin. "Finns inte i modellen" betyder att parametern inte finns i modellen alls.',
      'Ifyllnadsgrad: ifyllda värden delat med krävda värden. Krävda värden är varje kontrollerat element gånger varje krav som gäller dess kategori.',
      'Klara element: element som har värde i alla krav som gäller dem.',
      'Kompletta krav: kategori och parameter där alla element har värde.',
      'Bedömning: en modell uppfyller kraven när varje krav i varje kategori når gränsen för godkänt. En modell utan något att bedöma blir "Ej bedömd", aldrig godkänd.',
      'Procent avrundas nedåt till en decimal, så 100 % visas bara när allt är ifyllt.',
      'Täckning: kontrollerade element delat med elementen i valda kategorier och i kategorier med 3D-geometri.',
    ],
    om: {
      kalla: 'Datakälla: ACC:s egenskapsindex (Model Properties) för modellversionerna nedan.',
      versioner: 'Modellversioner',
      undantagRubrik: 'Undantag',
      tackningRubrik: 'Utanför kontrollen',
      inget: 'Inget.',
      kunde: (m, fel) => `${m} kunde inte läsas: ${fel}`,
      glomda: (m, n, lista) => `Kanske glömda i ${m}: ${n} kategorier har värden i krävda parametrar men ingår inte: ${lista}`,
      glomdKategori: (kat, med, antal) => `${kat} (värden på ${med} av ${antal} element)`,
      ejValda: (m, n, e, lista) => `${m}: ${n} kategorier med 3D-geometri ingår inte (${e} element): ${lista}`,
      tomValda: (kat, m) => `${kat} är vald i ${m} men har inga element i den här versionen.`,
      kravUtan: (k, m) => `Kravet ${k} gäller ingen vald kategori i ${m}.`,
      undantagUtan: (u, m) => `Undantaget "${u}" matchade inga element i ${m}.`,
      stortUndantag: (n, av, kat, m) => `Ett undantag tar bort ${n} av ${av} element i ${kat} i ${m}.`,
      undantagna: (n, m) => `${n} element i ${m} är undantagna.`,
      regelUtan: r => `Regeln ${r} matchade inga parametrar.`,
      saknasOveralt: k => `Kravet ${k} finns inte i någon av modellerna.`,
      regelAntal: (r, skal, n) => `${r}${skal ? ` (skäl: ${skal})` : ''}: ${n} element undantagna`,
    },
    pdf: {
      rubrik: 'Parameterkontroll', perDisciplin: 'Per disciplin', storstaBrister: 'Största bristerna', trend: 'Utveckling',
      ingenTrend: 'Trend visas från nästa sparade mätpunkt.', brist: (p, n, pr) => `${p} saknas på ${n} element (${pr})`,
      ejAngiven: 'Ej angiven', avModeller: (a, b) => `${a} av ${b} modeller uppfyller kraven`, kundeInte: 'kunde inte läsas',
      sedan: d => `sedan ${d}`, brott: 'Urvalet ändrades', sida: (a, b) => `Sida ${a} av ${b}`, fler: n => `+ ${n} modeller till, se Excel`,
      klaraAv: (a, b) => `${a} av ${b} element klara`, element: 'element', modellerVisas: 'De fem svagaste modellerna',
    },
  },

  en: {
    sprak: 'en',
    rapport: 'Parameter check',
    ja: 'Yes', nej: 'No',
    info: {
      projekt: 'Project', kontroll: 'Check', kord: 'Run', kordAv: 'Run by', kravprofil: 'Requirement set',
      troskel: 'Pass threshold', ifyllnad: 'Fill rate', klara: 'Complete elements', tackning: 'Coverage',
      modeller: 'Models meeting the requirements', matning: 'Measures whether values exist, not whether they are correct.',
    },
    blad: {
      sammanfattning: 'Summary', modellKategori: 'Model–category', parametrar: 'Parameters', atgarder: 'Action list',
      element: 'Elements', undantag: 'Exemptions', varden: 'Values', krav: 'Requirements', om: 'About this check',
    },
    kol: {
      modell: 'Model', disciplin: 'Discipline', version: 'Version', versionsdatum: 'Version date', elementIModell: 'Elements in model',
      element: 'Elements', undantagna: 'Exempted', kontrollerade: 'Checked', krav: 'Requirements', kompletta: 'Complete requirements',
      delvis: 'Partial', ingetVarde: 'No value', finnsInte: 'Not in model', kravVarden: 'Required values', ifyllda: 'Filled values',
      ifyllnad: 'Fill rate', klara: 'Complete elements', andelKlara: 'Share complete', tackning: 'Coverage', bedomning: 'Verdict',
      kategori: 'Category', parameter: 'Parameter', status: 'Status', medVarde: 'With value', utanVarde: 'Without value', andel: 'Share',
      instans: 'From instance', typ: 'From type', datatypModell: 'Data type in model', anmarkning: 'Note', familj: 'Family',
      typnamn: 'Type', elementId: 'ElementId', externtId: 'UniqueId / GlobalId', namn: 'Name', problem: 'Problem', paverkar: 'Affects elements',
      varde: 'Value', antal: 'Elements', kalla: 'Source', galler: 'Applies to categories', grupp: 'Group', guid: 'GUID',
      beskrivning: 'Description', datatyp: 'Data type', regel: 'Rule', skal: 'Reason',
    },
    status: {
      komplett: 'Complete', delvis: 'Partial', ingetVarde: 'No value', tom: 'Empty', finnsInte: 'Not in model',
      ingaElement: 'No elements', ejHamtad: 'Not fetched',
    },
    bedomning: {
      'uppfyller': 'Meets requirements', 'uppfyller-inte': 'Does not meet', 'ej-bedomd': 'Not assessed',
      'ofullstandig': 'Incomplete', 'kunde-inte-lasas': 'Could not be read',
    },
    problem: { saknarVarde: 'No value', typenSaknar: 'Type has no value', typen: '(the type)' },
    kalla: { fil: 'Parameter file', lista: 'List', regel: 'Rule' },
    allaKategorier: 'All chosen categories',
    fler: n => `+ ${n} other distinct values`,
    avkortat: n => `This sheet is cut after ${n} rows. Excel cannot hold more.`,
    liknande: namn => `Similar name in the model: ${namn}`,
    annanTyp: typ => `Different data type in the model (${typ})`,
    regelFangar: namn => namn.length ? `Catches: ${namn.join(', ')}` : 'Matches no parameters',
    undantagRegel: (vad, var_) => `${vad} · ${var_}`,
    familjRegel: m => `Family ${m}`, typRegel: m => `Type ${m}`,
    operator: { ar: 'is', innehaller: 'contains', borjar: 'starts with', tom: 'is empty', inteTom: 'is not empty' },
    allaModeller: 'all models',
    definitioner: [
      'How the figures are calculated',
      'Element: a placed object in the model with a category. Category, family and type nodes in the model tree are not counted.',
      'Value: text that is not empty after removing spaces, a number (0 counts) or Yes/No (No counts). The value is read from the element, otherwise from its type.',
      'ACC leaves empty values out. "No value" means the parameter exists in the model but has no value on any element in the category; it may be empty or not added to the category. "Not in model" means the parameter does not exist in the model at all.',
      'Fill rate: filled values divided by required values. Required values are each checked element times each requirement that applies to its category.',
      'Complete elements: elements with a value in every requirement that applies to them.',
      'Complete requirements: category and parameter where every element has a value.',
      'Verdict: a model meets the requirements when every requirement in every category reaches the pass threshold. A model with nothing to assess is "Not assessed", never passed.',
      'Percentages are rounded down to one decimal, so 100% is only shown when everything is filled in.',
      'Coverage: checked elements divided by the elements in chosen categories and in categories with 3D geometry.',
    ],
    om: {
      kalla: 'Data source: the ACC property index (Model Properties) for the model versions below.',
      versioner: 'Model versions',
      undantagRubrik: 'Exemptions',
      tackningRubrik: 'Outside the check',
      inget: 'Nothing.',
      kunde: (m, fel) => `${m} could not be read: ${fel}`,
      glomda: (m, n, lista) => `Possibly forgotten in ${m}: ${n} categories have values in required parameters but are not included: ${lista}`,
      glomdKategori: (kat, med, antal) => `${kat} (values on ${med} of ${antal} elements)`,
      ejValda: (m, n, e, lista) => `${m}: ${n} categories with 3D geometry are not included (${e} elements): ${lista}`,
      tomValda: (kat, m) => `${kat} is chosen in ${m} but has no elements in this version.`,
      kravUtan: (k, m) => `Requirement ${k} applies to no chosen category in ${m}.`,
      undantagUtan: (u, m) => `Exemption "${u}" matched no elements in ${m}.`,
      stortUndantag: (n, av, kat, m) => `An exemption removes ${n} of ${av} elements in ${kat} in ${m}.`,
      undantagna: (n, m) => `${n} elements in ${m} are exempted.`,
      regelUtan: r => `Rule ${r} matched no parameters.`,
      saknasOveralt: k => `Requirement ${k} does not exist in any of the models.`,
      regelAntal: (r, skal, n) => `${r}${skal ? ` (reason: ${skal})` : ''}: ${n} elements exempted`,
    },
    pdf: {
      rubrik: 'Parameter check', perDisciplin: 'By discipline', storstaBrister: 'Largest gaps', trend: 'Progress',
      ingenTrend: 'The trend is shown from the next saved measurement.', brist: (p, n, pr) => `${p} missing on ${n} elements (${pr})`,
      ejAngiven: 'Not specified', avModeller: (a, b) => `${a} of ${b} models meet the requirements`, kundeInte: 'could not be read',
      sedan: d => `since ${d}`, brott: 'Scope changed', sida: (a, b) => `Page ${a} of ${b}`, fler: n => `+ ${n} more models, see Excel`,
      klaraAv: (a, b) => `${a} of ${b} elements complete`, element: 'elements', modellerVisas: 'The five weakest models',
    },
  },
};

// Nycklar som finns i det ena språket men inte i det andra. Tom lista när allt stämmer.
function pkOrdSaknas(a = PK_ORD.sv, b = PK_ORD.en, vag = '') {
  const ut = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k], y = b[k], v = vag ? `${vag}.${k}` : k;
    if (x === undefined || y === undefined) { ut.push(v); continue; }
    if (Array.isArray(x) !== Array.isArray(y) || typeof x !== typeof y) { ut.push(v); continue; }
    if (Array.isArray(x)) { if (x.length !== y.length) ut.push(v); continue; }
    if (typeof x === 'object') ut.push(...pkOrdSaknas(x, y, v));
  }
  return ut;
}

// Procent som tal till Excel: avrundat nedåt till en decimal, som på skärmen.
function pkAndelNed(del, helt) {
  return helt > 0 ? pkPromille(del, helt) / 1000 : null;
}

// Täckningen som vanliga meningar, för Excel och PDF.
function pkTackningText(r, setup, O) {
  const ut = [];
  const tal = n => pkTalText(n, O.sprak);
  for (const m of r.modeller) {
    if (m.status !== 'klar') { ut.push(O.om.kunde(m.namn, m.fel || '')); continue; }
    const t = m.tackning;
    const glomda = t.ejValda.filter(e => e.kanskeGlomd.length);
    if (glomda.length) ut.push(O.om.glomda(m.namn, glomda.length, glomda.map(e => O.om.glomdKategori(e.kategori, tal(e.medVarde ?? 0), tal(e.antal))).join(', ')));
    const ovriga = t.ejValda.filter(e => !e.kanskeGlomd.length);
    if (ovriga.length) ut.push(O.om.ejValda(m.namn, ovriga.length, tal(ovriga.reduce((s, e) => s + e.antal, 0)), ovriga.map(e => e.kategori).join(', ')));
    for (const kat of t.tommaValda) ut.push(O.om.tomValda(kat, m.namn));
    for (const k of t.kravUtanKategori) ut.push(O.om.kravUtan(k, m.namn));
    for (const id of t.undantagUtanTraff) ut.push(O.om.undantagUtan(pkUndantagBeskrivning(setup.undantag.find(u => u.id === id), setup, O), m.namn));
    for (const u of t.storaUndantag) ut.push(O.om.stortUndantag(tal(u.antal), tal(u.av), u.kategori, m.namn));
    const undantagna = m.kategorier.reduce((s, k) => s + k.undantagna, 0);
    if (undantagna) ut.push(O.om.undantagna(tal(undantagna), m.namn));
  }
  for (const monster of r.tackning.reglerUtanTraff) ut.push(O.om.regelUtan(monster));
  for (const namn of r.tackning.saknasOveralt) ut.push(O.om.saknasOveralt(namn));
  return ut;
}

function pkUndantagBeskrivning(u, setup, O) {
  if (!u) return '';
  const vad = u.typ === 'familj' ? O.familjRegel(u.monster) : u.typ === 'typ' ? O.typRegel(u.monster)
    : `${u.parameter} ${O.operator[u.operator] || u.operator}${['tom', 'inteTom'].includes(u.operator) ? '' : ` ${u.varde}`}`;
  const var_ = [
    u.modeller?.length ? u.modeller.map(id => setup.modeller.find(m => m.id === id)?.namn || '?').join(', ') : O.allaModeller,
    u.kategorier?.length ? u.kategorier.join(', ') : O.allaKategorier,
  ].join(' · ');
  return O.undantagRegel(vad, var_);
}
