// ── Ritningsgranskning: reglerna ──────────────────────────────────────────────
// Två sorters kontroller:
//   1. Hårda regler där kravet är entydigt: filnamn mot dokumentnummer,
//      sidformat, dubbletter, textlager, kvarlämnade annotationer.
//   2. Majoritetsregler där paketet är sitt eget facit. Det som ser likadant ut
//      på nästan alla blad är mallen, och bladet som avviker är avvikelsen.
// Regel 2 gör att granskningen fungerar även på projekt med en annan
// ritningsmall, utan att någon behöver konfigurera hur mallen ser ut.

const GR_RUTNAT        = 8;    // upplösning när positioner i huvudet jämförs mellan blad
const GR_MALLGRANS     = 0.85; // andel blad som måste dela något för att det ska höra till mallen
const GR_DOMINANSGRANS = 0.8;  // andel blad som måste dela ett värde för att avvikare ska flaggas
const GR_MIN_BLAD      = 3;    // färre blad än så ger inget statistiskt underlag
const GR_HUVUDHOJD     = 0.4;  // ritningshuvudet söks i bladets nedersta del

// Fält som normalt varierar mellan blad utan att det är fel
const GR_FAR_VARIERA = [/^SKALA/i, /^FORMAT/i, /^RITNINGSKATEGORI/i, /^SYSTEM/i, /^SPECIFIKATION/i,
  /^VÅNING/i, /^DELOMRÅDE/i, /^DOKUMENTNUMMER/i, /^ÄNDRING/i, /^REVISION/i, /^SHEET/i, /^SCALE/i];

// Ett fältnamn är ett ord, inte en kod: minst fyra bokstäver i rad skiljer
// PLUSHÖJD (RH 2000) från byggnadsbeteckningar som L1C2.
const grArFaltnamn = s => /[A-ZÅÄÖ]{4}/.test(s) && /^[A-ZÅÄÖ][A-ZÅÄÖ0-9 ()/.:-]{2,40}$/.test(s);

const grNyckel = t => `${Math.round(t.x / GR_RUTNAT)}:${Math.round(t.y / GR_RUTNAT)}`;
const grMedian = v => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function grAvvikelse(lista, allvar, punkt, rubrik, fil, detalj) {
  lista.push({ allvar, punkt, rubrik, fil, detalj: detalj || '' });
}

/** Delar upp bladen i mallgrupper, en per sidformat. */
function grGruppera(blad) {
  const grupper = new Map();
  for (const b of blad) {
    const g = b.format || 'okänt';
    if (!grupper.has(g)) grupper.set(g, []);
    grupper.get(g).push(b);
  }
  return grupper;
}

/**
 * Låter bladen definiera var ritningshuvudet ligger. Positioner som har exakt
 * samma text på nästan alla blad är mallens fasta text, och den täta klungan
 * längst ned till höger är ritningshuvudet.
 */
function grBeredGrupp(gruppblad) {
  const n = gruppblad.length;
  const fallback = b => b.texter.filter(t => t.x > b.breddPt * 0.55 && t.y < b.hojdPt * GR_HUVUDHOJD);

  if (n < GR_MIN_BLAD) {
    for (const b of gruppblad) b.huvudtexter = fallback(b);
    return { statiska: [], vardepositioner: [] };
  }

  const positioner = new Map();
  for (const b of gruppblad) {
    const sedda = new Set();
    for (const t of b.texter) {
      if (t.x < b.breddPt * 0.5 || t.y > b.hojdPt * GR_HUVUDHOJD) continue;
      const k = grNyckel(t);
      if (sedda.has(k)) continue;
      sedda.add(k);
      if (!positioner.has(k)) positioner.set(k, { antal: 0, varden: new Map(), x: t.x, y: t.y });
      const p = positioner.get(k);
      p.antal++;
      p.varden.set(t.s, (p.varden.get(t.s) || 0) + 1);
    }
  }

  const krav = Math.max(GR_MIN_BLAD, Math.floor(n * GR_MALLGRANS));
  const statiska = [];
  const vardepositioner = [];
  for (const [k, p] of positioner) {
    if (p.antal < krav) continue;
    const topp = [...p.varden.values()].sort((a, b) => b - a)[0];
    const post = { k, x: p.x, y: p.y, antal: p.antal, varden: p.varden, text: [...p.varden.keys()][0] };
    if (topp / p.antal >= 0.95 && p.varden.size <= 2) statiska.push(post);
    else vardepositioner.push(post);
  }

  if (statiska.length < 8) {
    for (const b of gruppblad) b.huvudtexter = fallback(b);
    return { statiska, vardepositioner };
  }

  // Fasta texter längre in på bladet hör till ritningen och ska inte dra ut rutan
  const xVarden = statiska.map(s => s.x).sort((a, b) => a - b);
  let x0 = xVarden[xVarden.length - 1];
  for (let i = xVarden.length - 1; i > 0; i--) {
    if (xVarden[i] - xVarden[i - 1] > 400) break;
    x0 = xVarden[i - 1];
  }
  const iRutan   = statiska.filter(s => s.x >= x0);
  const marginal = 12;
  const ruta = {
    x0: x0 - marginal,
    y0: Math.min(...iRutan.map(s => s.y)) - marginal,
    y1: Math.max(...iRutan.map(s => s.y)) + marginal,
  };
  for (const b of gruppblad) {
    b.huvudtexter = b.texter.filter(t => t.x >= ruta.x0 && t.y >= ruta.y0 && t.y <= ruta.y1);
  }
  return {
    statiska: iRutan,
    vardepositioner: vardepositioner.filter(p => p.x >= ruta.x0 && p.y >= ruta.y0 && p.y <= ruta.y1),
    ruta,
  };
}

/**
 * Ritningsmallar sätter etiketterna i mindre stil än värdena. Finns en tydlig
 * skillnad i teckenstorlek i huvudet används den för att skilja etikett från
 * värde, annars faller vi tillbaka på att ett värde inte kan vara en etikett.
 */
function grEtikettstorlek(huvudtexter) {
  const antalPerHojd = new Map();
  for (const t of huvudtexter) if (t.h) antalPerHojd.set(t.h, (antalPerHojd.get(t.h) || 0) + 1);
  const grans   = Math.max(3, huvudtexter.length * 0.1);
  const vanliga = [...antalPerHojd.entries()].filter(([, n]) => n >= grans).map(([h]) => h).sort((a, b) => a - b);
  const minsta  = vanliga[0];
  const storsta = Math.max(0, ...huvudtexter.map(t => t.h || 0));
  return minsta && storsta > minsta * 1.3 ? minsta * 1.35 : Infinity;
}

/** Plockar fram de fält som kontrollerna frågar efter vid namn. */
function grBeredBlad(b, statiska) {
  const fastaTexter = new Set(statiska.map(s => s.text));
  const maxHojd   = grEtikettstorlek(b.huvudtexter);
  const arEtikett = t => (t.h || 0) <= maxHojd && grArFaltnamn(t.s) && !/\.$/.test(t.s)
    && (!statiska.length || fastaTexter.has(t.s));
  const arVarde   = maxHojd === Infinity ? t => !arEtikett(t) : t => (t.h || 0) > maxHojd;

  b.falt = grParahopFalt(b.huvudtexter, arEtikett, arVarde);

  if (maxHojd === Infinity) {
    // Utan storleksskillnad ser ett projektnamn ut som mallens fasta text.
    // Det som är någon annans värde kan i alla fall inte vara en etikett.
    const varden = new Set(b.falt.map(f => f.varde).filter(Boolean));
    b.falt = b.falt.filter(f => !varden.has(f.etikett));
  }

  const varde = (...namn) => {
    for (const n of namn) {
      const f = b.falt.find(p => p.etikett.toUpperCase().replace(/:$/, '') === n);
      if (f && f.varde) return f.varde;
    }
    for (const n of namn) {
      const f = b.falt.find(p => p.etikett.toUpperCase().startsWith(n));
      if (f && f.varde) return f.varde;
    }
    return null;
  };

  b.faltDokumentnummer = varde('DOKUMENTNUMMER', 'RITNINGSNUMMER', 'SHEET NUMBER', 'DRAWING NUMBER');
  b.faltSpecifikation  = varde('SPECIFIKATION', 'RITNINGSNAMN', 'TITLE', 'DRAWING TITLE');
  b.faltFormat         = varde('FORMAT', 'SHEET SIZE');
  b.faltStatus         = varde('STATUS');
  b.faltHandling       = varde('HANDLING');
  b.faltAndring        = varde('ÄNDRING', 'REVISION', 'REV');

  const datumtext = varde('DATUM', 'DATE')
    || (b.huvudtexter.find(t => /^\d{4}-\d{2}-\d{2}/.test(t.s)) || {}).s || '';
  b.faltDatum = (datumtext.match(/\d{4}-\d{2}-\d{2}/) || [null])[0];

  b.skalaHuvud = (varde('SKALA', 'SCALE') || '').match(/1\s*:\s*\d{1,5}/)?.[0]?.replace(/\s/g, '')
    || b.huvudtexter.map(t => (t.s.match(/^1\s*:\s*\d{1,5}$/) || [])[0]).filter(Boolean)[0]?.replace(/\s/g, '')
    || null;
  b.nummerIHuvud = b.huvudtexter.some(t => t.s === b.stam) ? [b.stam] : [];
}

// ── Kontrollerna ──────────────────────────────────────────────────────────────

/**
 * @param blad        utläst bladdata från grLasPaket
 * @param nummerRegex namnmönstret som härleddes ur filnamnen
 * @param val         { aktivaPunkter: Set, forteckning: string[] | null }
 */
function grKorKontroller(blad, nummerRegex, val = {}) {
  const avvikelser = [];
  const riktiga    = blad.filter(b => !b.lasfel);

  // ── Förbered: låt varje mallgrupp definiera sitt eget ritningshuvud ──
  const gruppinfo = [];
  for (const [format, gruppblad] of grGruppera(riktiga)) {
    const { statiska, vardepositioner, ruta } = grBeredGrupp(gruppblad);
    for (const b of gruppblad) grBeredBlad(b, statiska);
    gruppinfo.push({ format, gruppblad, statiska, vardepositioner, ruta });
  }

  // ── Paketnivå ──
  for (const b of blad) {
    if (b.lasfel) grAvvikelse(avvikelser, 'fel', 'D1', 'PDF gick inte att läsa', b.fil, b.lasfel);
  }

  for (const b of riktiga) {
    if (!nummerRegex.test(b.stam)) {
      grAvvikelse(avvikelser, 'fel', 'D1', 'Filnamnet följer inte paketets namnmönster', b.fil,
        `Mönster i övriga filnamn: ${nummerRegex.source}`);
    }
  }

  const perStam = new Map();
  for (const b of blad) {
    if (!perStam.has(b.stam)) perStam.set(b.stam, []);
    perStam.get(b.stam).push(b.mapp ? `${b.mapp}/${b.fil}` : b.fil);
  }
  for (const [stam, filer] of perStam) {
    if (filer.length > 1) {
      grAvvikelse(avvikelser, 'fel', 'D1', 'Samma ritningsnummer förekommer flera gånger i paketet', stam, filer.join(', '));
    }
  }

  // D2 antal ritningar mot handlingsförteckningen
  const listade = new Set();
  for (const b of riktiga) for (const n of b.forteckning.nummer) listade.add(n);
  const ipaketet = new Set(riktiga.map(b => b.stam));
  const saknas   = [...listade].filter(n => !ipaketet.has(n)).sort();
  const extra    = listade.size ? [...ipaketet].filter(n => !listade.has(n)).sort() : [];

  let angiven = null;
  if (val.forteckning?.length) {
    const forvantade = new Set(val.forteckning);
    angiven = {
      antal:  forvantade.size,
      saknas: [...forvantade].filter(x => !ipaketet.has(x)).sort(),
      extra:  [...ipaketet].filter(x => !forvantade.has(x)).sort(),
    };
    for (const n of angiven.saknas) {
      grAvvikelse(avvikelser, 'fel', 'D2', 'Ritning saknas i paketet enligt angiven förteckning', n);
    }
    for (const n of angiven.extra) {
      grAvvikelse(avvikelser, 'varning', 'D2', 'Ritning i paketet saknas i angiven förteckning', n);
    }
  }

  // ── Bladnivå ──
  for (const b of riktiga) {
    if (b.sidor !== 1) {
      grAvvikelse(avvikelser, 'varning', 'D1', 'PDF har fler än en sida', b.fil, `${b.sidor} sidor`);
    }
    if (b.antalTexter < 20) {
      grAvvikelse(avvikelser, 'fel', 'D1', 'Inget läsbart textlager, bladet verkar vara rastrerat', b.fil,
        `${b.antalTexter} textobjekt`);
    }
    if (b.annotationer.length) {
      grAvvikelse(avvikelser, 'varning', 'D1', 'Kvarlämnade annotationer i PDF-filen', b.fil, b.annotationer.join(', '));
    }

    const iHuvud = b.faltDokumentnummer || b.nummerIHuvud[0] || null;
    if (!iHuvud) {
      grAvvikelse(avvikelser, 'varning', 'R1', 'Hittar inget dokumentnummer i ritningshuvudet', b.fil, 'Kontrollera manuellt');
    } else if (iHuvud !== b.stam) {
      grAvvikelse(avvikelser, 'fel', 'R1', 'Ritningsnumret i huvudet stämmer inte med filnamnet', b.fil, `Huvud: ${iHuvud}`);
    }

    if (!b.faltSpecifikation) {
      grAvvikelse(avvikelser, 'varning', 'D3', 'Ritningsnamn saknas i ritningshuvudet', b.fil,
        'Fältet Specifikation eller motsvarande är tomt');
    }

    if (b.faltFormat) {
      const rensa = s => String(s).toUpperCase().replace(/[\s.]/g, '');
      if (rensa(b.faltFormat) !== rensa(b.format)) {
        grAvvikelse(avvikelser, 'varning', 'R7', 'Formatfältet stämmer inte med sidans verkliga storlek', b.fil,
          `Huvud: ${b.faltFormat}, uppmätt: ${b.format} (${b.breddMm} x ${b.hojdMm} mm)`);
      }
    }

    if (!b.skalaHuvud) {
      grAvvikelse(avvikelser, 'varning', 'R5', 'Ingen skalangivelse hittad i ritningshuvudet', b.fil,
        b.skalor.length ? `Skalor som står någonstans på bladet: ${b.skalor.join(', ')}` : '');
    }

    if (!b.forteckning.nummer.length && !b.forteckning.rubrik) {
      grAvvikelse(avvikelser, 'varning', 'R6', 'Ingen hänvisning till handlingsförteckning på bladet', b.fil);
    }

    if (!b.modellreferenser.length) {
      grAvvikelse(avvikelser, 'varning', 'R3', 'Inga länkade filer eller modellreferenser redovisade på bladet', b.fil);
    }
  }

  // ── Majoritetsregler per mallgrupp ──
  for (const { gruppblad, statiska, ruta } of gruppinfo) {
    if (gruppblad.length < GR_MIN_BLAD || !statiska.length) continue;

    for (const b of gruppblad) {
      const tappade = statiska.filter(m =>
        !b.huvudtexter.some(t => Math.abs(t.x - m.x) <= GR_RUTNAT && Math.abs(t.y - m.y) <= GR_RUTNAT)).length;
      if (tappade > statiska.length * 0.5) {
        grAvvikelse(avvikelser, 'varning', 'R7', 'Ritningshuvudet ligger inte på samma plats som på övriga blad', b.fil,
          `${tappade} av ${statiska.length} fasta punkter i mallen saknas på sin plats`);
      }
    }

    // Jämförelsen görs på fält och inte på exakta koordinater, eftersom ett
    // centrerat värde flyttar sig när texten byter längd.
    const faltStat = new Map();
    for (const b of gruppblad) {
      for (const f of b.falt) {
        if (!faltStat.has(f.etikett)) faltStat.set(f.etikett, { total: 0, medVarde: 0, varden: new Map() });
        const s = faltStat.get(f.etikett);
        s.total++;
        if (f.varde) {
          s.medVarde++;
          s.varden.set(f.varde, (s.varden.get(f.varde) || 0) + 1);
        }
      }
    }

    for (const [etikett, s] of faltStat) {
      if (s.total < gruppblad.length * GR_MALLGRANS) continue; // fältet hör inte till mallen

      // R2 tom ruta: fältet är ifyllt på nästan alla blad men tomt här
      if (s.medVarde < s.total && s.medVarde / s.total >= GR_MALLGRANS) {
        for (const b of gruppblad) {
          const f = b.falt.find(p => p.etikett === etikett);
          if (f && !f.varde) {
            grAvvikelse(avvikelser, 'fel', 'R2', 'Tom ruta i ritningshuvudet, varken värde eller bindestreck', b.fil,
              `Fält: ${etikett}, ifyllt på ${s.medVarde} av ${s.total} blad`);
          }
        }
      }

      // R7 gemensamma uppgifter som ska vara lika på alla blad
      if (GR_FAR_VARIERA.some(re => re.test(etikett))) continue;
      if (s.varden.size < 2 || s.varden.size > 4 || s.medVarde < GR_MIN_BLAD) continue;
      const [toppvarde, toppantal] = [...s.varden.entries()].sort((a, b) => b[1] - a[1])[0];
      if (toppantal / s.medVarde < GR_DOMINANSGRANS) continue;
      for (const b of gruppblad) {
        const f = b.falt.find(p => p.etikett === etikett);
        if (f?.varde && f.varde !== toppvarde) {
          grAvvikelse(avvikelser, 'varning', 'R7', `Fältet ${etikett} avviker från övriga blad`, b.fil,
            `Bladet: ${f.varde}, övriga ${toppantal} av ${s.medVarde} blad: ${toppvarde}`);
        }
      }
    }

    // R13 dubbelredovisning. Kräver att ritningshuvudet gick att avgränsa,
    // annars räknas ritningens egen text med och varje blad ser ut att dubblera.
    if (ruta) {
      const antalPerText = new Map();
      const rakningar    = new Map();
      for (const b of gruppblad) {
        const eget = new Map();
        for (const t of b.huvudtexter) {
          if (t.s.length < 5 || /^[-\d.,:+ ]+$/.test(t.s)) continue;
          eget.set(t.s, (eget.get(t.s) || 0) + 1);
        }
        rakningar.set(b, eget);
        for (const [s, n] of eget) {
          if (!antalPerText.has(s)) antalPerText.set(s, []);
          antalPerText.get(s).push(n);
        }
      }
      for (const b of gruppblad) {
        const dubbla = [];
        for (const [s, n] of rakningar.get(b)) {
          const alla     = antalPerText.get(s);
          const komplett = [...alla, ...Array(gruppblad.length - alla.length).fill(0)];
          const normal   = grMedian(komplett);
          if (n > Math.max(normal, 1)) dubbla.push(`${s} (${n} ggr, normalt ${normal})`);
        }
        if (dubbla.length) {
          grAvvikelse(avvikelser, 'varning', 'R13', 'Samma uppgift står fler gånger i ritningshuvudet än på övriga blad',
            b.fil, dubbla.slice(0, 8).join(' | '));
        }
      }
    }

    // R10 norrpilen. Bara blad med läsbar kompassros jämförs, en norrpil ritad
    // som ren geometri syns inte i textlagret.
    const medKompass = gruppblad.filter(b => b.kompass?.riktningGrader != null);
    if (medKompass.length >= GR_MIN_BLAD) {
      const riktningar = new Map();
      for (const b of medKompass) {
        const g = b.kompass.riktningGrader;
        riktningar.set(g, (riktningar.get(g) || 0) + 1);
      }
      const [topp, antal] = [...riktningar.entries()].sort((a, b) => b[1] - a[1])[0];
      if (antal / medKompass.length >= GR_DOMINANSGRANS) {
        for (const b of medKompass) {
          if (b.kompass.riktningGrader !== topp) {
            grAvvikelse(avvikelser, 'varning', 'R10', 'Norrpilen pekar åt annat håll än på övriga blad', b.fil,
              `Bladet: ${b.kompass.riktningGrader} grader, övriga ${antal} blad: ${topp} grader`);
          }
        }
        if (medKompass.length / gruppblad.length >= GR_DOMINANSGRANS) {
          for (const b of gruppblad) {
            if (b.kompass?.riktningGrader == null) {
              grAvvikelse(avvikelser, 'varning', 'R10', 'Ingen norrpil hittad, till skillnad från övriga blad i gruppen',
                b.fil, `${medKompass.length} av ${gruppblad.length} blad har en läsbar norrpil`);
            }
          }
        }
      }
    }
  }

  // ── Städa listan ──
  let kvar = avvikelser;

  // Bara de punkter användaren valt i steg 2
  if (val.aktivaPunkter) kvar = kvar.filter(a => val.aktivaPunkter.has(a.punkt));

  // Flera träffar av samma slag på samma blad blir en rad
  const samlade = new Map();
  for (const a of kvar) {
    const k = `${a.allvar}|${a.punkt}|${a.rubrik}|${a.fil}`;
    if (samlade.has(k)) {
      const f = samlade.get(k);
      if (a.detalj && !f.detalj.includes(a.detalj)) f.detalj += ` | ${a.detalj}`;
    } else samlade.set(k, { ...a });
  }

  // En anmärkning som gäller i stort sett alla blad är en fråga om mallen eller
  // om leveransen som helhet. Den blir en rad i stället för hundra.
  const perTyp = new Map();
  for (const a of samlade.values()) {
    const k = `${a.punkt}|${a.rubrik}`;
    if (!perTyp.has(k)) perTyp.set(k, []);
    perTyp.get(k).push(a);
  }
  const slutliga = [];
  for (const lista of perTyp.values()) {
    if (lista.length >= 5 && lista.length >= riktiga.length * 0.9) {
      slutliga.push({
        ...lista[0],
        fil: `samtliga blad (${lista.length} st)`,
        detalj: 'Gäller hela leveransen. Kontrollera mallen eller leveransrutinen en gång i stället för blad för blad.',
      });
    } else slutliga.push(...lista);
  }

  const ordning = { fel: 0, varning: 1, info: 2 };
  slutliga.sort((a, b) => ordning[a.allvar] - ordning[b.allvar]
    || a.punkt.localeCompare(b.punkt, 'sv')
    || String(a.fil).localeCompare(String(b.fil), 'sv'));

  const medAnmarkning = new Set(slutliga.filter(a => a.allvar !== 'info').map(a => a.fil));

  return {
    avvikelser: slutliga,
    grupper: gruppinfo.map(g => ({
      format: g.format,
      antalBlad: g.gruppblad.length,
      antalMallpunkter: g.statiska.length,
      mallHarledd: !!g.ruta,
      antalFalt: new Set(g.gruppblad.flatMap(b => b.falt.filter(f => f.varde).map(f => f.etikett))).size,
    })),
    forteckning: { listade: [...listade].sort(), saknas, extra, harForteckning: listade.size > 0, angiven },
    statistik: {
      antalPdf: blad.length,
      antalLasta: riktiga.length,
      antalFel: slutliga.filter(a => a.allvar === 'fel').length,
      antalVarningar: slutliga.filter(a => a.allvar === 'varning').length,
      bladUtanAnmarkning: riktiga.filter(b => !medAnmarkning.has(b.fil)).length,
      format: [...grGruppera(riktiga).entries()].map(([f, g]) => `${f}: ${g.length}`).join(', '),
    },
  };
}
