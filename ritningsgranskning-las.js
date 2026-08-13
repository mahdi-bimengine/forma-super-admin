// ── Ritningsgranskning: läsning av blad ───────────────────────────────────────
// Plockar ut allt som går att läsa maskinellt ur en PDF: sidformat, textlager
// med koordinater, handlingsförteckning, modellreferenser, skalangivelser och
// kompassros. Var ritningshuvudet börjar och slutar avgörs inte här utan i
// ritningsgranskning-regler.js, eftersom det kräver att blad jämförs med varandra.
//
// pdfjs hämtas från CDN först när en granskning startas, så att fliken inte
// kostar något att öppna.

const GR_PDFJS_VERSION = '5.7.284';
let _grPdfjs = null;

async function grPdfjs() {
  if (_grPdfjs) return _grPdfjs;
  const bas = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${GR_PDFJS_VERSION}`;
  const lib = await import(`${bas}/build/pdf.min.mjs`);
  lib.GlobalWorkerOptions.workerSrc = `${bas}/build/pdf.worker.min.mjs`;
  _grPdfjs = { lib, standardFontDataUrl: `${bas}/standard_fonts/` };
  return _grPdfjs;
}

// ── Sidformat ─────────────────────────────────────────────────────────────────

const GR_A_SERIE = [
  ['A0', 841, 1189], ['A1', 594, 841], ['A2', 420, 594],
  ['A3', 297, 420],  ['A4', 210, 297], ['A5', 148, 210],
];

const GR_PT_PER_MM = 72 / 25.4;

/** Sidstorlek i mm till formatnamn, till exempel A1, 16A0 eller "A0 förlängt". */
function grFormatnamn(breddMm, hojdMm) {
  const kort = Math.min(breddMm, hojdMm);
  const lang = Math.max(breddMm, hojdMm);
  const nara = (a, b) => Math.abs(a - b) <= 3;

  for (const [namn, k, l] of GR_A_SERIE) {
    if (nara(kort, k) && nara(lang, l)) return namn;
  }
  // Jämna multiplar av A0 i båda led, till exempel 4 x 4 A0 = 16A0
  const fk = kort / 841;
  const fl = lang / 1189;
  if (Math.abs(fk - fl) < 0.03 && Math.abs(fk - Math.round(fk)) < 0.03 && Math.round(fk) > 1) {
    const n = Math.round(fk);
    return `${n * n}A0`;
  }
  for (const [namn, k, l] of GR_A_SERIE) {
    if (nara(kort, k) && lang > l) return `${namn} förlängt`;
    if (nara(lang, l) && kort > k) return `${namn} förlängt`;
  }
  return `special ${Math.round(kort)}x${Math.round(lang)}`;
}

// ── Textlager ─────────────────────────────────────────────────────────────────

/**
 * Text med normaliserade koordinater, 0,0 = sidans nedre vänstra hörn.
 * PDF-filer delar ofta upp en och samma text i flera bitar, till exempel vid
 * fontbyte. Bitar som sitter ihop på samma rad slås därför samman igen, annars
 * skulle jämförelsen mellan blad tro att texten skiljer sig åt.
 */
function grLasTexter(view, innehall) {
  const [x0, y0] = view;
  const bitar = [];
  for (const post of innehall.items) {
    if (!post.str) continue;
    bitar.push({
      x: post.transform[4] - x0,
      y: post.transform[5] - y0,
      w: post.width || 0,
      h: Math.abs(post.transform[3]) || 10,
      s: post.str,
    });
  }
  bitar.sort((a, b) => b.y - a.y || a.x - b.x);

  const texter = [];
  let aktuell = null;
  const knuff = () => {
    if (aktuell && aktuell.s.trim()) {
      texter.push({
        x: Math.round(aktuell.x), y: Math.round(aktuell.y),
        h: Math.round(aktuell.h * 10) / 10, s: aktuell.s.trim(),
      });
    }
  };
  for (const bit of bitar) {
    const glapp = aktuell ? bit.x - (aktuell.x + aktuell.w) : Infinity;
    if (aktuell && Math.abs(bit.y - aktuell.y) <= 1 && glapp <= aktuell.h * 0.35 && glapp > -aktuell.h) {
      aktuell.s += bit.s;
      aktuell.w = Math.max(aktuell.w, bit.x + bit.w - aktuell.x);
      continue;
    }
    knuff();
    aktuell = { ...bit };
  }
  knuff();
  return texter;
}

/** Delar upp texter i rader, texter vars baslinje ligger inom några enheter hör ihop. */
function grRadindela(texter, tolerans = 6) {
  const rader = [];
  for (const t of [...texter].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const rad = rader[rader.length - 1];
    if (rad && rad.y - t.y <= tolerans) rad.poster.push(t);
    else rader.push({ y: t.y, poster: [t] });
  }
  for (const r of rader) r.poster.sort((a, b) => a.x - b.x);
  return rader;
}

/**
 * Parar ihop etikett och värde i ritningshuvudet. Värdet står på raden under
 * etiketten, men ofta indraget, så nästa etikett åt höger på samma rad får
 * bestämma var kolumnen slutar. Kolon efter etiketten betyder i stället att
 * värdet står bredvid.
 */
function grParahopFalt(huvudtexter, arEtikett, arVarde = (t) => !arEtikett(t)) {
  const rader = grRadindela(huvudtexter);
  const falt = [];

  for (let i = 0; i < rader.length; i++) {
    const rad = rader[i];
    for (let j = 0; j < rad.poster.length; j++) {
      const etikett = rad.poster[j];
      if (!arEtikett(etikett)) continue;

      const nastaEtikett = rad.poster.slice(j + 1).find(arEtikett);
      const hogerkant    = nastaEtikett ? nastaEtikett.x : Infinity;
      const kolon        = /:$/.test(etikett.s);

      const bredvid = rad.poster.slice(j + 1).filter(t => arVarde(t) && t.x < hogerkant);
      const narhet  = kolon ? 400 : 120;
      const bredvidVarde = bredvid.length && bredvid[0].x - etikett.x <= narhet
        ? bredvid.map(t => t.s).join(' ').trim() || null
        : null;

      const under = rader[i + 1];
      let underVarde = null;
      if (under && rad.y - under.y <= 45) {
        const traffar = under.poster.filter(t => arVarde(t) && t.x >= etikett.x - 15 && t.x < hogerkant - 15);
        if (traffar.length) underVarde = traffar.map(t => t.s).join(' ').trim() || null;
      }

      falt.push({
        etikett: etikett.s.replace(/:$/, '').trim(),
        x: etikett.x, y: etikett.y,
        varde: kolon ? (bredvidVarde || underVarde) : (underVarde || bredvidVarde),
      });
    }
  }
  return falt;
}

// ── Handlingsförteckning och kompassros ───────────────────────────────────────

/** En sammanhängande kolumn av ritningsnummer med jämna radavstånd. */
function grHittaForteckning(texter, nummerRegex) {
  const rubrik = texter.find(t => /HANDLINGSFÖRTECKNING/i.test(t.s));
  const kandidater = texter.filter(t => nummerRegex.test(t.s));
  if (!kandidater.length) return { rubrik: rubrik ? rubrik.s : null, nummer: [] };

  const kolumner = new Map();
  for (const t of kandidater) {
    const nyckel = Math.round(t.x / 3);
    if (!kolumner.has(nyckel)) kolumner.set(nyckel, []);
    kolumner.get(nyckel).push(t);
  }

  let basta = null;
  for (const post of kolumner.values()) {
    if (post.length < 5) continue;
    post.sort((a, b) => b.y - a.y);
    const luckor = post.slice(1).map((t, i) => post[i].y - t.y).filter(d => d > 0);
    if (!luckor.length) continue;
    const median = luckor.slice().sort((a, b) => a - b)[Math.floor(luckor.length / 2)];
    // Förteckningen har jämna radavstånd, ritningshänvisningar ute i bladet har det inte
    const jamna = luckor.filter(d => Math.abs(d - median) <= 3).length / luckor.length;
    if (median > 40 || jamna < 0.6) continue;
    const narRubrik = rubrik && Math.abs(rubrik.x - post[0].x) < 30;
    const poang = post.length + (narRubrik ? 1000 : 0);
    if (!basta || poang > basta.poang) basta = { poang, post };
  }

  return {
    rubrik: rubrik ? rubrik.s : null,
    nummer: basta ? [...new Set(basta.post.map(t => t.s))] : [],
  };
}

/** Kompassros utlagd som fristående bokstäver N/S/Ö/V. Ger norrpilens riktning i grader. */
function grHittaKompass(texter) {
  const bokstaver = texter.filter(t => /^[NSÖOV]$/.test(t.s));
  if (!bokstaver.length) return null;

  const kluster = [];
  for (const b of bokstaver) {
    const traff = kluster.find(k => k.some(p => Math.hypot(p.x - b.x, p.y - b.y) < 400));
    if (traff) traff.push(b); else kluster.push([b]);
  }
  const rosett = kluster
    .filter(k => new Set(k.map(p => p.s)).size >= 3)
    .sort((a, b) => b.length - a.length)[0];
  if (!rosett) return { antalBokstaver: bokstaver.length, riktningGrader: null };

  const cx = rosett.reduce((s, p) => s + p.x, 0) / rosett.length;
  const cy = rosett.reduce((s, p) => s + p.y, 0) / rosett.length;
  const n  = rosett.find(p => p.s === 'N');
  if (!n) return { antalBokstaver: bokstaver.length, riktningGrader: null };
  // 0 grader = norr rakt upp på bladet, växande vinkel medurs
  const grader = (450 - (Math.atan2(n.y - cy, n.x - cx) * 180) / Math.PI) % 360;
  return { antalBokstaver: bokstaver.length, riktningGrader: Math.round(grader) };
}

// ── Namnmönster ───────────────────────────────────────────────────────────────

/**
 * Bygger ett regexmönster ur paketets egna filnamn, så att granskningen klarar
 * vilken namnstandard som helst utan konfiguration.
 */
function grHarledNummermonster(stammar) {
  if (!stammar.length) return /^$/;

  // Utgå från den vanligaste namnformen, så att enstaka avvikare faktiskt fastnar
  const perAntal = new Map();
  for (const s of stammar) {
    const n = s.split('-').length;
    perAntal.set(n, (perAntal.get(n) || 0) + 1);
  }
  const antal = [...perAntal.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const delar = stammar.map(s => s.split('-')).filter(d => d.length === antal);

  const segment = [];
  for (let i = 0; i < antal; i++) {
    const varden  = delar.map(d => d[i]);
    const langder = [...new Set(varden.map(v => v.length))].sort((a, b) => a - b);
    const bara    = re => varden.every(v => re.test(v));
    const klass   = bara(/^\d+$/) ? '\\d' : bara(/^[A-ZÅÄÖ]+$/) ? '[A-ZÅÄÖ]' : '[A-ZÅÄÖ0-9]';
    const kvant   = langder.length === 1 ? `{${langder[0]}}` : `{${langder[0]},${langder[langder.length - 1]}}`;
    segment.push(klass + kvant);
  }
  return new RegExp(`^${segment.join('-')}$`);
}

// ── Ett blad ──────────────────────────────────────────────────────────────────

async function grLasBlad(buffert, filnamn, nummerRegex) {
  const { lib, standardFontDataUrl } = await grPdfjs();

  const dok = await lib.getDocument({
    data: new Uint8Array(buffert),
    standardFontDataUrl,
    useSystemFonts: true,
    verbosity: 0,
    isEvalSupported: false,
  }).promise;

  try {
    const sida   = await dok.getPage(1);
    const vy     = sida.getViewport({ scale: 1 });
    const texter = grLasTexter(sida.view, await sida.getTextContent());
    const annotationer = (await sida.getAnnotations().catch(() => []))
      .filter(a => a.subtype !== 'Link' && a.subtype !== 'Widget')
      .map(a => a.subtype);

    const breddMm = Math.round(vy.width  / GR_PT_PER_MM);
    const hojdMm  = Math.round(vy.height / GR_PT_PER_MM);

    return {
      fil:   filnamn,
      stam:  filnamn.replace(/\.pdf$/i, ''),
      sidor: dok.numPages,
      breddPt: vy.width,
      hojdPt:  vy.height,
      breddMm, hojdMm,
      format: grFormatnamn(breddMm, hojdMm),
      annotationer,
      antalTexter: texter.length,
      texter,
      skalor: [...new Set(texter.map(t => (t.s.match(/1\s*:\s*(\d{1,5})/) || [])[0]).filter(Boolean))]
        .map(s => s.replace(/\s/g, '')),
      modellreferenser: [...new Set(texter
        .filter(t => /\.(rvt|ifc|dwg|nwd|nwc)\b/i.test(t.s) || /Autodesk Docs:\/\//i.test(t.s))
        .map(t => t.s))],
      kompass:     grHittaKompass(texter),
      forteckning: grHittaForteckning(texter, nummerRegex),
    };
  } finally {
    await dok.destroy();
  }
}

// ── Handlingsförteckning som egen fil ─────────────────────────────────────────

/** Alla textsnuttar ur en fil, oavsett om den är txt, csv, xlsx eller pdf. */
async function grTextsnuttarUrFil(fil) {
  const namn = fil.name.toLowerCase();

  if (/\.(xlsx|xlsm|xlsb|xls)$/.test(namn)) {
    if (typeof XLSX === 'undefined') throw new Error('Kan inte läsa Excel-filer här.');
    const bok = XLSX.read(new Uint8Array(await fil.arrayBuffer()), { type: 'array' });
    const ut = [];
    for (const bladnamn of bok.SheetNames) {
      const rader = XLSX.utils.sheet_to_json(bok.Sheets[bladnamn], { header: 1, blankrows: false });
      for (const rad of rader) for (const cell of rad) if (cell != null) ut.push(String(cell));
    }
    return ut;
  }

  if (/\.pdf$/.test(namn)) {
    const { lib, standardFontDataUrl } = await grPdfjs();
    const dok = await lib.getDocument({
      data: new Uint8Array(await fil.arrayBuffer()),
      standardFontDataUrl, useSystemFonts: true, verbosity: 0, isEvalSupported: false,
    }).promise;
    try {
      const ut = [];
      const sidor = Math.min(dok.numPages, 50);
      for (let i = 1; i <= sidor; i++) {
        const sida = await dok.getPage(i);
        for (const t of grLasTexter(sida.view, await sida.getTextContent())) ut.push(t.s);
      }
      return ut;
    } finally {
      await dok.destroy();
    }
  }

  // txt, csv och allt annat som går att läsa som text
  return (await fil.text()).split(/[\r\n\t;,"|]+/);
}

// Tre eller fler segment skilda med bindestreck täcker de flesta namnstandarder
const GR_GENERISKT_NUMMER = /^[A-ZÅÄÖ0-9]{1,12}(-[A-ZÅÄÖ0-9]{1,12}){2,}$/;

/**
 * Plockar ut ritningsnummer ur en handlingsförteckning. I första hand de som
 * följer paketets eget namnmönster. Hittas inga tas allt som ser ut som ett
 * ritningsnummer, så att en förteckning som spänner över flera discipliner
 * också går att använda mot ett paket från en av dem.
 */
async function grLasForteckning(fil, nummerRegex) {
  const snuttar = (await grTextsnuttarUrFil(fil))
    .map(s => String(s).trim().replace(/\.pdf$/i, ''))
    .filter(Boolean);

  let nummer   = [...new Set(snuttar.filter(s => nummerRegex.test(s)))];
  let strategi = 'paketets namnmönster';

  if (!nummer.length) {
    nummer   = [...new Set(snuttar.filter(s => GR_GENERISKT_NUMMER.test(s)))];
    strategi = 'generell ritningsnummerform';
  }

  return {
    namn: fil.name,
    nummer: nummer.sort(),
    antalSnuttar: snuttar.length,
    strategi: nummer.length ? strategi : 'inget hittat',
  };
}

// ── Hämta bytes ───────────────────────────────────────────────────────────────

/** Laddar ner en ritning från ACC via signerad länk. */
async function grHamtaFranAcc(fil) {
  const { urls } = await getItemDownload(fil.projectId, fil.itemId);
  if (!urls.length) throw new Error('Ingen nedladdningslänk');

  const delar = [];
  for (const url of urls) {
    const res = await fetch(url); // signerad länk, ska inte ha Authorization-header
    if (!res.ok) throw new Error(`Nedladdning misslyckades (${res.status})`);
    delar.push(new Uint8Array(await res.arrayBuffer()));
  }
  if (delar.length === 1) return delar[0].buffer;

  const total = delar.reduce((n, d) => n + d.length, 0);
  const hel   = new Uint8Array(total);
  let pos = 0;
  for (const d of delar) { hel.set(d, pos); pos += d.length; }
  return hel.buffer;
}

// ── Hela paketet ──────────────────────────────────────────────────────────────

/**
 * Läser alla valda ritningar. Några i taget, annars står nätverket still medan
 * pdfjs räknar och tvärtom.
 */
async function grLasPaket(filer, onProgress, samtidigt = 4) {
  const stammar     = filer.map(f => f.namn.replace(/\.pdf$/i, ''));
  const nummerRegex = grHarledNummermonster(stammar);
  const sokRegex    = new RegExp(nummerRegex.source.replace(/^\^/, '').replace(/\$$/, ''));

  const blad = new Array(filer.length);
  let nasta  = 0;
  let klara  = 0;

  async function arbeta() {
    while (true) {
      const i = nasta++;
      if (i >= filer.length) return;
      const fil = filer[i];
      try {
        const buffert = fil.las ? await fil.las() : await grHamtaFranAcc(fil);
        blad[i] = await grLasBlad(buffert, fil.namn, sokRegex);
        blad[i].mapp = fil.mapp || '';
      } catch (fel) {
        blad[i] = {
          fil: fil.namn, mapp: fil.mapp || '', stam: fil.namn.replace(/\.pdf$/i, ''),
          lasfel: String(fel.message || fel),
          texter: [], skalor: [], modellreferenser: [], annotationer: [],
          forteckning: { nummer: [] },
        };
      }
      onProgress?.(++klara, filer.length, fil.namn);
    }
  }

  await Promise.all(Array.from({ length: Math.min(samtidigt, filer.length) }, arbeta));
  return { blad, nummerRegex };
}
