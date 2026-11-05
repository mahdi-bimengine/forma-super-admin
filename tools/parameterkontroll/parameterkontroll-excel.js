// parameterkontroll-excel.js — Excel-rapporten (del 6).
//
// Byggs ur senaste körningen: _pk.korning.resultat för siffrorna och
// _pk.korning.modeller för elementen och deras värden. ExcelJS laddas först
// när någon exporterar, eftersom SheetJS i appen inte kan skriva färger.
//
// Modellernas värden skrivs alltid som text. RDS-koder börjar med =, -, + eller
// ++ och skulle annars läsas som formler. Procent skrivs avrundade nedåt, som
// på skärmen, eftersom Excel annars visar 99,96 % som 100,0 %.

const PK_EXCELJS     = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const PK_EXCEL_RADER = 1000000;   // Excel rymmer 1 048 576 rader per blad
const PK_VARDEN_MAX  = 50;        // mest förekommande värden per parameter

const PK_EXCEL_STATUSFARG = {
  komplett: 'FFDCF2E3', delvis: 'FFFDF0D2', ingetVarde: 'FFFDE5D3', tom: 'FFFDE5D3', finnsInte: 'FFFADBD8', ingaElement: 'FFF0F0F0', ejHamtad: 'FFF0F0F0',
  'uppfyller': 'FFDCF2E3', 'uppfyller-inte': 'FFFADBD8', 'ej-bedomd': 'FFF0F0F0', 'ofullstandig': 'FFFDF0D2', 'kunde-inte-lasas': 'FFFADBD8',
};

function pkLaddaSkript(url, finns) {
  if (finns()) return Promise.resolve();
  return new Promise((klar, fel) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => finns() ? klar() : fel(new Error(`${url} laddades men fungerar inte`));
    s.onerror = () => fel(new Error(`kunde inte ladda ${url}. Är du ansluten till internet?`));
    document.head.appendChild(s);
  });
}

function pkFilnamnsdel(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'okant';
}

function pkTidstampel(iso) {
  const d = new Date(iso), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// Värdet på ett element som text: från elementet, annars från typen.
function pkVardeText(el, typ, namn, O) {
  const text = varden => [...new Set(pkLista(varden).flat().filter(v => pkHarVarde(v, null))
    .map(v => typeof v === 'boolean' ? (v ? O.ja : O.nej) : String(v)))].join(' | ');
  return text(el.varden?.[namn]) || text(typ?.varden?.[namn]);
}

// ── Knappen och dialogen ──────────────────────────────────────────────────────

function pkExcelKnapp() {
  return pkKnapp('Exportera Excel', 'pkExcelDialog()', { titel: 'Ladda ner granskningsrapporten som Excel' });
}

function pkExcelUppskattning(baraBrister) {
  const k = _pk.korning, r = k.resultat;
  let rader = 0;
  for (const m of r.modeller) for (const kat of m.kategorier) {
    const brister = new Set();
    for (const p of kat.parametrar) {
      rader += 1 + (p.antal - p.medVarde);
      if (p.koder) p.koder.forEach((kod, i) => { if (kod !== PK_INSTANS && kod !== PK_TYP) brister.add(i); });
    }
    rader += baraBrister ? brister.size : kat.kontrollerade;
  }
  return rader;
}

function pkExcelDialog() {
  if (!_pk.korning?.resultat) return;
  const sprak = _pk.setup.sprak || 'sv';
  const d = pkDialog({
    titel: 'Exportera Excel',
    text: 'Granskningsrapporten med sammanfattning, åtgärdslista, ett blad per modell och vad som inte ingår.',
    bredd: 'w-[520px]',
    html: `
      <div class="flex flex-col gap-2.5 text-sm">
        <label class="flex items-center gap-2"><input type="radio" name="pk-x-element" value="brister" checked class="accent-ads-blue" onchange="pkExcelRakna()"/> Bara element med brister på modellbladen</label>
        <label class="flex items-center gap-2"><input type="radio" name="pk-x-element" value="alla" class="accent-ads-blue" onchange="pkExcelRakna()"/> Alla kontrollerade element</label>
        <label class="flex items-center gap-2 mt-1"><input type="checkbox" id="pk-x-varden" checked class="accent-ads-blue"/> Ta med värdeförteckningen (vanligaste värdena per parameter)</label>
        <label class="flex items-center gap-2">Språk
          <select id="pk-x-sprak" class="border border-ads-border rounded px-2 py-1 bg-white">
            <option value="sv" ${sprak === 'sv' ? 'selected' : ''}>Svenska</option><option value="en" ${sprak === 'en' ? 'selected' : ''}>English</option></select></label>
        <label class="flex items-center gap-2"><input type="checkbox" id="pk-x-acc" class="accent-ads-blue"/> Spara även i ACC, som ny version av kontrollens rapportfil</label>
        <p id="pk-x-storlek" class="text-xs text-ads-muted"></p>
      </div>`,
    knappar: [{ text: 'Avbryt' }, { text: 'Skapa Excel', primar: true, gor: dlg => {
      const val = {
        baraBrister: dlg.querySelector('input[name=pk-x-element]:checked').value === 'brister',
        varden: dlg.querySelector('#pk-x-varden').checked,
        sprak: dlg.querySelector('#pk-x-sprak').value,
        acc: dlg.querySelector('#pk-x-acc').checked,
      };
      if (val.sprak !== _pk.setup.sprak) pkAndra('Bytte rapportspråk', s => { s.sprak = val.sprak; }, { rita: false });
      pkExporteraExcel(val);
    } }],
  });
  pkExcelRakna();
  return d;
}

function pkExcelRakna() {
  const el = document.getElementById('pk-x-storlek');
  if (!el) return;
  const bara = document.querySelector('input[name=pk-x-element]:checked')?.value !== 'alla';
  const rader = pkExcelUppskattning(bara);
  el.textContent = `Ungefär ${pkTalText(rader)} rader.${rader > 300000 ? ' En stor fil – det kan ta en stund att skapa och öppna den.' : ''}`;
  el.className = `text-xs ${rader > 300000 ? 'text-amber-700' : 'text-ads-muted'}`;
}

async function pkExporteraExcel(val) {
  vkToast('Skapar Excel-filen…');
  try {
    const { blob, filnamn } = await pkByggExcel(val);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filnamn;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    if (val.acc && await pkSparaRapportIAcc(blob, 'xlsx') && typeof pkSparaMatpunkt === 'function' && !pkMatpunktSparad()) {
      // Rapporter som sparas i projektet ska alltid stämma med trenden.
      await pkSparaMatpunkt({ tyst: true });
    }
  } catch (err) {
    vkToast(`Kunde inte skapa Excel-filen: ${vkFelText(err)}`, 'red');
  }
}

// ── Arbetsboken ───────────────────────────────────────────────────────────────

async function pkByggExcel({ baraBrister = true, varden = true, sprak = 'sv' } = {}) {
  await pkLaddaSkript(PK_EXCELJS, () => window.ExcelJS);
  const O = PK_ORD[sprak] || PK_ORD.sv;
  const k = _pk.korning, r = k.resultat, setup = k.setup;
  const data = new Map(k.modeller.map(m => [m.id, m]));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Forma Console – Parameterkontroll';
  wb.created = new Date(k.tid);

  const bladnamn = new Set();
  const nyttBlad = namn => {
    let n = namn.replace(/[\\/?*[\]:]/g, '_').slice(0, 31), i = 2;
    while (bladnamn.has(n.toLowerCase())) n = `${namn.slice(0, 27)} (${i++})`;
    bladnamn.add(n.toLowerCase());
    return wb.addWorksheet(n);
  };
  const tabell = (ws, kolumner, rader, { fran = 1 } = {}) => {
    ws.columns = kolumner.map(([, nyckel, bredd, fmt]) => ({ key: nyckel, width: bredd, style: fmt ? { numFmt: fmt } : {} }));
    const rubrik = ws.getRow(fran);
    kolumner.forEach(([text], i) => { rubrik.getCell(i + 1).value = text; });
    rubrik.font = { bold: true };
    rubrik.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; c.border = { bottom: { style: 'thin', color: { argb: 'FFBDBDBD' } } }; });
    let n = 0;
    for (const rad of rader) {
      if (n >= PK_EXCEL_RADER) { ws.addRow([O.avkortat(PK_EXCEL_RADER)]).font = { italic: true, color: { argb: 'FFB45309' } }; break; }
      const wr = ws.addRow(rad.varden);
      rad.stil?.(wr);
      n++;
    }
    ws.views = [{ state: 'frozen', ySplit: fran }];
    ws.autoFilter = { from: { row: fran, column: 1 }, to: { row: fran, column: kolumner.length } };
  };
  const fyll = (cell, argb) => { if (argb) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; };
  const datum = iso => iso ? new Date(iso) : null;
  const PROCENT = '0.0%', DATUM = 'yyyy-mm-dd hh:mm', HELTAL = '#,##0';

  // 1. Sammanfattning
  const ws1 = nyttBlad(O.blad.sammanfattning);
  const t = r.totalt;
  const bedomda = r.modeller.filter(m => ['uppfyller', 'uppfyller-inte'].includes(m.bedomning));
  const info = [
    [O.info.projekt, _currentProject?.attributes?.name || ''],
    [O.info.kontroll, setup.namn],
    [O.info.kord, datum(k.tid)],
    [O.info.kordAv, _profile?.name || _profile?.email || ''],
    [O.info.kravprofil, setup.kravprofil.namn],
    [O.info.troskel, r.troskel / 100],
    [O.info.ifyllnad, pkAndelNed(t.ifyllda, t.kravVarden)],
    [O.info.klara, pkAndelNed(t.klara, t.kontrollerade)],
    [O.info.tackning, pkAndelNed(t.kontrollerade, t.element)],
    [O.info.modeller, `${bedomda.filter(m => m.bedomning === 'uppfyller').length} / ${bedomda.length}`],
    [O.info.matning, ''],
  ];
  info.forEach(([a, b], i) => {
    const rad = ws1.getRow(i + 1);
    rad.getCell(1).value = a; rad.getCell(1).font = { bold: true };
    rad.getCell(2).value = b;
    if (b instanceof Date) rad.getCell(2).numFmt = DATUM;
    if (typeof b === 'number') rad.getCell(2).numFmt = PROCENT;
  });
  ws1.getRow(1).getCell(2).font = { bold: true, size: 13 };
  const start = info.length + 2;
  const kol1 = [
    [O.kol.modell, 'modell', 42], [O.kol.disciplin, 'disciplin', 11], [O.kol.version, 'version', 9], [O.kol.versionsdatum, 'datum', 17, DATUM],
    [O.kol.elementIModell, 'element', 12, HELTAL], [O.kol.kontrollerade, 'kontrollerade', 13, HELTAL], [O.kol.kravVarden, 'krav', 13, HELTAL],
    [O.kol.ifyllda, 'ifyllda', 13, HELTAL], [O.kol.ifyllnad, 'ifyllnad', 12, PROCENT], [O.kol.klara, 'klara', 12, HELTAL],
    [O.kol.andelKlara, 'andelKlara', 12, PROCENT], [O.kol.tackning, 'tackning', 11, PROCENT], [O.kol.bedomning, 'bedomning', 20],
  ];
  tabell(ws1, kol1, r.modeller.map(m => {
    const n = m.nyckeltal;
    return {
      varden: { modell: m.namn, disciplin: m.disciplin || '', version: m.version?.nummer ?? '', datum: datum(m.version?.datum), element: n.element, kontrollerade: n.kontrollerade,
        krav: n.kravVarden, ifyllda: n.ifyllda, ifyllnad: pkAndelNed(n.ifyllda, n.kravVarden), klara: n.klara, andelKlara: pkAndelNed(n.klara, n.kontrollerade),
        tackning: pkAndelNed(n.kontrollerade, n.element), bedomning: O.bedomning[m.bedomning] || m.bedomning },
      stil: wr => fyll(wr.getCell('bedomning'), PK_EXCEL_STATUSFARG[m.bedomning]),
    };
  }), { fran: start });
  ws1.autoFilter = undefined;
  ws1.views = [];
  const defStart = start + r.modeller.length + 3;
  O.definitioner.forEach((rad, i) => {
    const c = ws1.getRow(defStart + i).getCell(1);
    c.value = rad;
    c.font = i === 0 ? { bold: true } : { color: { argb: 'FF555555' } };
  });

  // 2. Modell–kategori
  const rader2 = [];
  for (const m of r.modeller) for (const kat of m.kategorier) {
    const n = kat.nyckeltal;
    rader2.push({ varden: { modell: m.namn, disciplin: m.disciplin || '', kategori: pkKatText(kat.namn, O.sprak), element: kat.antal, undantagna: kat.undantagna, kontrollerade: kat.kontrollerade,
      krav: kat.parametrar.length, kompletta: kat.kompletta, delvis: kat.delvis, ingetVarde: kat.tomma, finnsInte: kat.saknade, kravVarden: n.kravVarden, ifyllda: n.ifyllda,
      ifyllnad: pkAndelNed(n.ifyllda, n.kravVarden), klara: kat.klara ?? '' } });
  }
  tabell(nyttBlad(O.blad.modellKategori), [
    [O.kol.modell, 'modell', 40], [O.kol.disciplin, 'disciplin', 11], [O.kol.kategori, 'kategori', 30], [O.kol.element, 'element', 10, HELTAL],
    [O.kol.undantagna, 'undantagna', 11, HELTAL], [O.kol.kontrollerade, 'kontrollerade', 13, HELTAL], [O.kol.krav, 'krav', 8], [O.kol.kompletta, 'kompletta', 15],
    [O.kol.delvis, 'delvis', 9], [O.kol.ingetVarde, 'ingetVarde', 12], [O.kol.finnsInte, 'finnsInte', 11], [O.kol.kravVarden, 'kravVarden', 13, HELTAL],
    [O.kol.ifyllda, 'ifyllda', 13, HELTAL], [O.kol.ifyllnad, 'ifyllnad', 12, PROCENT], [O.kol.klara, 'klara', 12, HELTAL],
  ], rader2);

  // 3. Parametrar
  const rader3 = [];
  for (const m of r.modeller) for (const kat of m.kategorier) for (const p of kat.parametrar) {
    const info = m.kravInfo[p.namn] || {};
    const anm = [info.liknande?.length && O.liknande(info.liknande.join(', ')), info.datatyp?.ok === false && O.annanTyp(info.datatyp.modell.join(', '))].filter(Boolean).join(' · ');
    rader3.push({
      varden: { modell: m.namn, kategori: pkKatText(kat.namn, O.sprak), parameter: p.namn, status: O.status[p.status] || p.status, med: p.medVarde, utan: p.antal - p.medVarde, antal: p.antal,
        andel: pkAndelNed(p.medVarde, p.antal), instans: p.instans, typ: p.typ, datatyp: (info.datatyp?.modell || []).join(', '), anm },
      stil: wr => fyll(wr.getCell('status'), PK_EXCEL_STATUSFARG[p.status]),
    });
  }
  tabell(nyttBlad(O.blad.parametrar), [
    [O.kol.modell, 'modell', 40], [O.kol.kategori, 'kategori', 30], [O.kol.parameter, 'parameter', 28], [O.kol.status, 'status', 20],
    [O.kol.medVarde, 'med', 11, HELTAL], [O.kol.utanVarde, 'utan', 11, HELTAL], [O.kol.kontrollerade, 'antal', 13, HELTAL], [O.kol.andel, 'andel', 9, PROCENT],
    [O.kol.instans, 'instans', 12, HELTAL], [O.kol.typ, 'typ', 10, HELTAL], [O.kol.datatypModell, 'datatyp', 18], [O.kol.anmarkning, 'anm', 50],
  ], rader3);

  // 4. Åtgärdslista: en rad per brist, en rad per typ för typparametrar.
  const rader4 = [];
  for (const m of r.modeller) {
    const md = data.get(m.id);
    if (!md) continue;
    for (const kat of m.kategorier) for (const p of kat.parametrar) {
      if (!p.koder || p.medVarde === p.antal) continue;
      const { element, typer } = pkBrister(m, kat.namn, p.namn, md.typer);
      for (const ty of typer) rader4.push({ varden: { modell: m.namn, kategori: pkKatText(kat.namn, O.sprak), familj: ty.familj, typ: ty.typ, eid: '', ext: '', namn: O.problem.typen, parameter: p.namn, problem: O.problem.typenSaknar, paverkar: ty.antal } });
      for (const { el } of element) rader4.push({ varden: { modell: m.namn, kategori: pkKatText(kat.namn, O.sprak), familj: el.familj, typ: el.typ, eid: el.elementId ?? '', ext: el.extId || '', namn: el.namn, parameter: p.namn, problem: O.problem.saknarVarde, paverkar: 1 } });
    }
  }
  tabell(nyttBlad(O.blad.atgarder), [
    [O.kol.modell, 'modell', 34], [O.kol.kategori, 'kategori', 30], [O.kol.familj, 'familj', 26], [O.kol.typnamn, 'typ', 26], [O.kol.elementId, 'eid', 11],
    [O.kol.externtId, 'ext', 40], [O.kol.namn, 'namn', 30], [O.kol.parameter, 'parameter', 24], [O.kol.problem, 'problem', 18], [O.kol.paverkar, 'paverkar', 15, HELTAL],
  ], rader4);

  // 5. Ett blad per modell med elementen och deras värden.
  const korta = pkKortaNamn(r.modeller.map(m => m.namn));
  r.modeller.forEach((m, mi) => {
    const md = data.get(m.id);
    if (m.status !== 'klar' || !md) return;
    const krav = [...new Set(m.kategorier.flatMap(kat => kat.parametrar.map(p => p.namn)))];
    const rader = [];
    for (const kat of m.kategorier) {
      const galler = new Set(kat.parametrar.map(p => p.namn));
      kat.element.forEach((el, i) => {
        const brist = kat.parametrar.some(p => p.koder && p.koder[i] !== PK_INSTANS && p.koder[i] !== PK_TYP);
        if (baraBrister && !brist) return;
        const typ = md.typer[el.typId];
        const v = { kategori: pkKatText(kat.namn, O.sprak), familj: el.familj, typ: el.typ, namn: el.namn, eid: el.elementId ?? '', ext: el.extId || '' };
        const saknas = [];
        krav.forEach((namn, j) => {
          if (!galler.has(namn)) { v[`p${j}`] = '–'; return; }
          const text = pkVardeText(el, typ, namn, O);
          v[`p${j}`] = text;
          if (!text) saknas.push(j);
        });
        rader.push({ varden: v, stil: wr => {
          krav.forEach((namn, j) => {
            const c = wr.getCell(`p${j}`);
            c.numFmt = '@';
            if (!galler.has(namn)) { fyll(c, 'FFF0F0F0'); c.font = { color: { argb: 'FF9E9E9E' } }; }
          });
          for (const j of saknas) fyll(wr.getCell(`p${j}`), 'FFFADBD8');
        } });
      });
    }
    tabell(nyttBlad(`${O.blad.element} – ${korta[mi]}`), [
      [O.kol.kategori, 'kategori', 30], [O.kol.familj, 'familj', 24], [O.kol.typnamn, 'typ', 24], [O.kol.namn, 'namn', 28], [O.kol.elementId, 'eid', 11], [O.kol.externtId, 'ext', 38],
      ...krav.map((namn, j) => [namn, `p${j}`, Math.min(40, Math.max(12, namn.length + 4))]),
    ], rader);
  });

  // 6. Undantag
  const rader6 = [];
  for (const m of r.modeller) for (const kat of m.kategorier) for (const { el, regel } of kat.undantagnaElement) {
    const u = setup.undantag.find(x => x.id === regel);
    rader6.push({ varden: { modell: m.namn, kategori: pkKatText(kat.namn, O.sprak), familj: el.familj, typ: el.typ, eid: el.elementId ?? '', namn: el.namn, regel: pkUndantagBeskrivning(u, setup, O), skal: u?.skal || '' } });
  }
  if (setup.undantag.length) {
    tabell(nyttBlad(O.blad.undantag), [
      [O.kol.modell, 'modell', 34], [O.kol.kategori, 'kategori', 30], [O.kol.familj, 'familj', 26], [O.kol.typnamn, 'typ', 26], [O.kol.elementId, 'eid', 11],
      [O.kol.namn, 'namn', 30], [O.kol.regel, 'regel', 46], [O.kol.skal, 'skal', 30],
    ], rader6);
  }

  // 7. Värden: de vanligaste per modell, kategori och parameter.
  if (varden) {
    const rader7 = [];
    for (const m of r.modeller) {
      const md = data.get(m.id);
      if (!md) continue;
      for (const kat of m.kategorier) for (const p of kat.parametrar) {
        if (!p.medVarde) continue;
        const antal = new Map();
        for (const el of kat.element) {
          const text = pkVardeText(el, md.typer[el.typId], p.namn, O);
          if (text) antal.set(text, (antal.get(text) || 0) + 1);
        }
        const sorterade = [...antal].sort((a, b) => b[1] - a[1]);
        for (const [text, n] of sorterade.slice(0, PK_VARDEN_MAX)) rader7.push({ varden: { modell: m.namn, kategori: pkKatText(kat.namn, O.sprak), parameter: p.namn, varde: text, antal: n }, stil: wr => { wr.getCell('varde').numFmt = '@'; } });
        if (sorterade.length > PK_VARDEN_MAX) rader7.push({ varden: { modell: m.namn, kategori: pkKatText(kat.namn, O.sprak), parameter: p.namn, varde: O.fler(sorterade.length - PK_VARDEN_MAX), antal: '' }, stil: wr => { wr.getCell('varde').font = { italic: true }; } });
      }
    }
    tabell(nyttBlad(O.blad.varden), [
      [O.kol.modell, 'modell', 34], [O.kol.kategori, 'kategori', 30], [O.kol.parameter, 'parameter', 26], [O.kol.varde, 'varde', 44], [O.kol.antal, 'antal', 13, HELTAL],
    ], rader7);
  }

  // 8. Krav
  const rader8 = [
    ...r.krav.map(kr => ({ varden: { parameter: kr.namn, kalla: kr.kallor.map(x => O.kalla[x] || x).join(', '), datatyp: kr.datatyp, grupp: kr.grupp, guid: kr.guid,
      galler: kr.kategorier ? kr.kategorier.map(x => pkKatText(x, O.sprak)).join(', ') : O.allaKategorier, beskrivning: kr.regel ? `${O.kol.regel}: ${kr.regel}` : kr.beskrivning } })),
    ...setup.kravprofil.regler.map(rg => ({ varden: { parameter: rg.monster, kalla: O.kalla.regel, galler: rg.kategorier ? rg.kategorier.map(x => pkKatText(x, O.sprak)).join(', ') : O.allaKategorier,
      beskrivning: O.regelFangar(r.krav.filter(kr => kr.regel === rg.monster).map(kr => kr.namn)) } })),
  ];
  tabell(nyttBlad(O.blad.krav), [
    [O.kol.parameter, 'parameter', 30], [O.kol.kalla, 'kalla', 16], [O.kol.datatyp, 'datatyp', 12], [O.kol.grupp, 'grupp', 18], [O.kol.guid, 'guid', 38],
    [O.kol.galler, 'galler', 34], [O.kol.beskrivning, 'beskrivning', 50],
  ], rader8);

  // 9. Om kontrollen
  const ws9 = nyttBlad(O.blad.om);
  ws9.getColumn(1).width = 120;
  const om = [
    { text: O.om.kalla },
    { text: '' },
    { text: O.om.versioner, fet: true },
    ...r.modeller.map(m => ({ text: `${m.namn}: ${m.version ? `v${m.version.nummer ?? '?'} · ${String(m.version.datum || '').slice(0, 16).replace('T', ' ')}` : O.bedomning[m.bedomning]}` })),
    { text: '' },
    { text: O.om.tackningRubrik, fet: true },
    ...(pkTackningText(r, setup, O).map(text => ({ text })) || []),
    { text: '' },
    { text: O.om.undantagRubrik, fet: true },
    ...(setup.undantag.length ? setup.undantag.map(u => ({ text: O.om.regelAntal(pkUndantagBeskrivning(u, setup, O), u.skal, r.modeller.reduce((s, m) => s + (m.undantag.find(x => x.id === u.id)?.antal || 0), 0)) }))
      : [{ text: O.om.inget }]),
    { text: '' },
    ...O.definitioner.map((text, i) => ({ text, fet: i === 0 })),
  ];
  if (!pkTackningText(r, setup, O).length) om.splice(om.findIndex(x => x.text === O.om.tackningRubrik) + 1, 0, { text: O.om.inget });
  om.forEach(({ text, fet }, i) => {
    const c = ws9.getRow(i + 1).getCell(1);
    c.value = text;
    c.alignment = { wrapText: true, vertical: 'top' };
    if (fet) c.font = { bold: true };
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const filnamn = `${pkFilnamnsdel(O.rapport)}_${pkFilnamnsdel(_currentProject?.attributes?.name)}_${pkTidstampel(k.tid)}.xlsx`;
  return { blob, filnamn };
}

// ── Spara rapporter i ACC ─────────────────────────────────────────────────────
// Rapporterna sparas under ett fast namn per kontroll i samma mapp som
// parameterkontroll.json. Varje sparning blir en ny version av samma fil, så
// ACC:s versionshistorik blir arkivet.

async function pkSparaRapportIAcc(blob, ext) {
  try {
    const l = await pkLasLagring();
    let mapp = l.mapp;
    if (!mapp) {
      mapp = await pkValjMapp('Var ska rapporterna sparas?', 'Rapporterna sparas med ett fast namn per kontroll. Varje ny sparning blir en ny version av samma fil.');
      if (!mapp) return null;
    }
    const namn = `Parameterkontroll – ${pkFilnamnsdel(_pk.korning.setup.namn)}.${ext}`;
    const innehall = await getFolderContents(_currentProject.id, mapp.id);
    const fanns = innehall.find(it => it.type === 'items' && vkMappNamnAv(it) === namn);
    await writeTextFile(_currentProject.id, mapp.id, namn, blob, fanns?.id);
    vkToast(`Sparad i ACC: ${mapp.sokvag} / ${namn}${fanns ? ' (ny version)' : ''}`);
    return { mapp, namn };
  } catch (err) {
    vkToast(`Kunde inte spara i ACC: ${vkFelText(err)}`, 'red');
    return null;
  }
}
