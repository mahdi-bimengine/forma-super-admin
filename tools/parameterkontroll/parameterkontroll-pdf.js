// parameterkontroll-pdf.js — infografiken till ledningen (del 7).
//
// Sidorna ritas som SVG i millimeter (A4 liggande, 297 × 210), visas som
// förhandsvisning och blir sedan PDF med jsPDF och svg2pdf. Båda laddas först
// när de behövs. Grafiken hålls enkel (raka former, inga skuggor) eftersom det
// är vad som blir rätt i en vektor-PDF. Typsnittet är Helvetica, som finns i
// alla PDF-läsare och klarar å, ä och ö. Symboler som ✓ och ▲ finns inte i det
// typsnittet och ritas därför som former.

const PK_JSPDF   = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
const PK_SVG2PDF = 'https://cdn.jsdelivr.net/npm/svg2pdf.js@2.2.4/dist/svg2pdf.umd.min.js';

const PK_PDF = {
  bredd: 297, hojd: 210, marg: 12,
  kol: '#2D2926', mjuk: '#6B7280', linje: '#E5E7EB', bakgrund: '#F6F7F8', accent: '#82B891',
  gron: '#3A9E6F', rod: '#C2484F', gul: '#D99A2B', gra: '#9CA3AF',
  serier: ['#2E6DB4', '#E07B39', '#3A9E6F', '#8E5BB5', '#C2484F', '#2A9DB0', '#B58B2E', '#6B7280'],
};

let _pkMatt = null;

// Textbredd i millimeter för Helvetica i given storlek.
function pkTextBredd(text, storlek, fet = false) {
  _pkMatt ??= document.createElement('canvas').getContext('2d');
  _pkMatt.font = `${fet ? 'bold ' : ''}${storlek * 10}px Helvetica, Arial, sans-serif`;
  return _pkMatt.measureText(String(text)).width / 10;
}

function pkKorta(text, storlek, max, fet = false) {
  text = String(text ?? '');
  if (pkTextBredd(text, storlek, fet) <= max) return text;
  while (text.length > 1 && pkTextBredd(`${text}…`, storlek, fet) > max) text = text.slice(0, -1);
  return `${text}…`;
}

function pkT(x, y, text, { storlek = 3, fet = false, farg = PK_PDF.kol, ankare = 'start', max = null } = {}) {
  const t = max ? pkKorta(text, storlek, max, fet) : String(text ?? '');
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="helvetica" font-size="${storlek}" ${fet ? 'font-weight="bold"' : ''} fill="${farg}" text-anchor="${ankare}">${pkEsc(t)}</text>`;
}

// Bedömningen som en färgad rund symbol med bock, kryss eller streck.
function pkSymbol(x, y, bedomning, r = 1.9) {
  const farg = { 'uppfyller': PK_PDF.gron, 'uppfyller-inte': PK_PDF.rod, 'kunde-inte-lasas': PK_PDF.rod, 'ofullstandig': PK_PDF.gul }[bedomning] || PK_PDF.gra;
  const tecken = bedomning === 'uppfyller'
    ? `<path d="M${x - r * 0.45} ${y} L${x - r * 0.1} ${y + r * 0.4} L${x + r * 0.5} ${y - r * 0.4}" stroke="#fff" stroke-width="${r * 0.32}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    : ['uppfyller-inte', 'kunde-inte-lasas'].includes(bedomning)
      ? `<path d="M${x - r * 0.4} ${y - r * 0.4} L${x + r * 0.4} ${y + r * 0.4} M${x + r * 0.4} ${y - r * 0.4} L${x - r * 0.4} ${y + r * 0.4}" stroke="#fff" stroke-width="${r * 0.3}" stroke-linecap="round"/>`
      : `<path d="M${x - r * 0.45} ${y} L${x + r * 0.45} ${y}" stroke="#fff" stroke-width="${r * 0.3}" stroke-linecap="round"/>`;
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${farg}"/>${tecken}`;
}

function pkTriangel(x, y, upp, farg) {
  const s = 1.4;
  return upp ? `<path d="M${x} ${y - s} L${x + s} ${y + s * 0.7} L${x - s} ${y + s * 0.7} Z" fill="${farg}"/>`
    : `<path d="M${x} ${y + s} L${x + s} ${y - s * 0.7} L${x - s} ${y - s * 0.7} Z" fill="${farg}"/>`;
}

function pkRing(cx, cy, r, andel, farg) {
  const bas = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${PK_PDF.linje}" stroke-width="${r * 0.28}"/>`;
  if (andel === null || andel <= 0) return bas;
  if (andel >= 1) return `${bas}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${farg}" stroke-width="${r * 0.28}"/>`;
  const v = andel * 2 * Math.PI - Math.PI / 2;
  const x2 = cx + r * Math.cos(v), y2 = cy + r * Math.sin(v);
  return `${bas}<path d="M${cx} ${cy - r} A${r} ${r} 0 ${andel > 0.5 ? 1 : 0} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}" fill="none" stroke="${farg}" stroke-width="${r * 0.28}" stroke-linecap="round"/>`;
}

function pkAndelFarg(del, helt) {
  if (!helt) return PK_PDF.gra;
  return del === helt ? PK_PDF.gron : del / helt >= 0.8 ? PK_PDF.gul : PK_PDF.rod;
}

// ── Sidorna ───────────────────────────────────────────────────────────────────

function pkPdfSidor(sprak, historik) {
  const O = PK_ORD[sprak] || PK_ORD.sv;
  const P = PK_PDF;
  const k = _pk.korning, r = k.resultat, t = r.totalt;
  const pct = (a, b) => pkProcentText(a, b, sprak);
  const tal = n => pkTalText(n, sprak);
  const datum = new Date(k.tid).toLocaleString(sprak === 'sv' ? 'sv-SE' : 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const projekt = _currentProject?.attributes?.name || '';
  const punkter = pkTrendPunkter(historik?.poster || [], pkMatpunktAv(k));
  const forra = punkter.length >= 2 && !punkter.at(-1).brott ? punkter.at(-2) : null;

  const bedomda = r.modeller.filter(m => ['uppfyller', 'uppfyller-inte'].includes(m.bedomning));
  const uppfyller = bedomda.filter(m => m.bedomning === 'uppfyller').length;
  const undantagna = r.modeller.reduce((s, m) => s + m.kategorier.reduce((x, kat) => x + kat.undantagna, 0), 0);

  const huvud = (rubrik) => `
    <rect x="0" y="0" width="${P.bredd}" height="${P.hojd}" fill="#FFFFFF"/>
    ${pkT(P.marg, 15, O.pdf.rubrik.toUpperCase(), { storlek: 2.6, fet: true, farg: P.accent })}
    ${pkT(P.marg, 23, rubrik, { storlek: 6, fet: true, max: 175 })}
    ${pkT(P.marg, 29.5, [projekt, `${O.info.kravprofil}: ${k.setup.kravprofil.namn}`, datum].filter(Boolean).join('  ·  '), { storlek: 2.9, farg: P.mjuk, max: 180 })}
    <rect x="${P.marg}" y="33" width="${P.bredd - P.marg * 2}" height="0.6" fill="${P.accent}"/>`;

  const fot = (sida, antal) => `
    <rect x="${P.marg}" y="${P.hojd - 14}" width="${P.bredd - P.marg * 2}" height="0.3" fill="${P.linje}"/>
    ${pkT(P.marg, P.hojd - 9, [O.info.matning, `${O.info.tackning} ${pct(t.kontrollerade, t.element)}`, undantagna ? `${tal(undantagna)} ${O.kol.undantagna.toLowerCase()}` : '', `${O.info.troskel} ${String(r.troskel).replace('.', sprak === 'sv' ? ',' : '.')} %`].filter(Boolean).join('  ·  '), { storlek: 2.3, farg: P.mjuk, max: 240 })}
    ${pkT(P.bredd - P.marg, P.hojd - 9, O.pdf.sida(sida, antal), { storlek: 2.3, farg: P.mjuk, ankare: 'end' })}`;

  // Nyckeltalen överst till höger.
  const andring = forra && forra.totalt.kravVarden && t.kravVarden ? (t.ifyllda / t.kravVarden - forra.totalt.ifyllda / forra.totalt.kravVarden) * 100 : null;
  const nyckeltal = `
    ${pkT(P.bredd - P.marg, 22, pct(t.ifyllda, t.kravVarden), { storlek: 11, fet: true, ankare: 'end' })}
    ${pkT(P.bredd - P.marg, 28, `${O.info.ifyllnad}${andring !== null && Math.abs(andring) >= 0.05 ? '' : ''}`, { storlek: 2.8, farg: P.mjuk, ankare: 'end' })}
    ${andring !== null && Math.abs(andring) >= 0.05 ? `${pkTriangel(P.bredd - P.marg - pkTextBredd(pct(t.ifyllda, t.kravVarden), 11, true) - 18, 18.5, andring > 0, andring > 0 ? P.gron : P.rod)}
      ${pkT(P.bredd - P.marg - pkTextBredd(pct(t.ifyllda, t.kravVarden), 11, true) - 16, 19.6, `${andring > 0 ? '+' : ''}${andring.toFixed(1).replace('.', sprak === 'sv' ? ',' : '.')}`, { storlek: 3, fet: true, farg: andring > 0 ? P.gron : P.rod })}` : ''}`;

  const kortStatistik = (x, y, varde, text) => `
    <rect x="${x}" y="${y}" width="62" height="16" rx="1.5" fill="${P.bakgrund}"/>
    ${pkT(x + 4, y + 7.5, varde, { storlek: 5, fet: true })}
    ${pkT(x + 4, y + 12.5, text, { storlek: 2.4, farg: P.mjuk, max: 55 })}`;

  // Disciplinkort, två kolumner, flödar vidare till nästa sida vid behov.
  const MAX_MODELLER = 6;
  const kortH = d => 22 + Math.min(d.modeller.length, MAX_MODELLER) * 6.2 + (d.modeller.length > MAX_MODELLER ? 5 : 0);
  const kortHtml = (d, x, y, w) => {
    const n = d.nyckeltal;
    const andel = n.kravVarden ? pkPromille(n.ifyllda, n.kravVarden) / 1000 : null;
    const farg = pkAndelFarg(n.ifyllda, n.kravVarden);
    const modeller = d.modeller.map(id => r.modeller.find(m => m.id === id))
      .sort((a, b) => (a.status !== 'klar') - (b.status !== 'klar') || (a.nyckeltal.kravVarden ? a.nyckeltal.ifyllda / a.nyckeltal.kravVarden : 2) - (b.nyckeltal.kravVarden ? b.nyckeltal.ifyllda / b.nyckeltal.kravVarden : 2));
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${kortH(d)}" rx="1.8" fill="#FFFFFF" stroke="${P.linje}" stroke-width="0.35"/>
      ${pkRing(x + 9, y + 9.5, 5.2, andel, farg)}
      ${pkT(x + 9, y + 10.6, n.kravVarden ? pct(n.ifyllda, n.kravVarden) : '–', { storlek: 2.3, fet: true, ankare: 'middle' })}
      ${pkT(x + 18, y + 8.5, d.disciplin || O.pdf.ejAngiven, { storlek: 4, fet: true, max: w - 22 })}
      ${pkT(x + 18, y + 13.5, d.bedomda ? O.pdf.avModeller(d.uppfyller, d.bedomda) : O.bedomning['ej-bedomd'], { storlek: 2.5, farg: P.mjuk, max: w - 22 })}`;
    modeller.slice(0, MAX_MODELLER).forEach((m, i) => {
      const yy = y + 22 + i * 6.2;
      const mn = m.nyckeltal;
      s += pkSymbol(x + 5, yy - 1, m.bedomning, 1.6);
      s += pkT(x + 8.5, yy, m.namn.replace(/\.[^.]+$/, ''), { storlek: 2.5, max: w * 0.42 });
      if (m.status !== 'klar') { s += pkT(x + w * 0.52, yy, O.pdf.kundeInte, { storlek: 2.4, farg: P.rod }); return; }
      const bx = x + w * 0.52, bw = w * 0.27, a = mn.kravVarden ? pkPromille(mn.ifyllda, mn.kravVarden) / 1000 : 0;
      s += `<rect x="${bx}" y="${yy - 2.2}" width="${bw}" height="2.4" rx="1.2" fill="${P.linje}"/>`;
      if (a > 0) s += `<rect x="${bx}" y="${yy - 2.2}" width="${(bw * a).toFixed(2)}" height="2.4" rx="1.2" fill="${pkAndelFarg(mn.ifyllda, mn.kravVarden)}"/>`;
      s += pkT(x + w - 4, yy, mn.kravVarden ? pct(mn.ifyllda, mn.kravVarden) : '–', { storlek: 2.5, fet: true, ankare: 'end' });
      const f = forra?.modeller.find(x2 => x2.id === m.id && x2.status === 'klar');
      if (f && f.nyckeltal.kravVarden && mn.kravVarden) {
        const dd = (mn.ifyllda / mn.kravVarden - f.nyckeltal.ifyllda / f.nyckeltal.kravVarden) * 100;
        if (Math.abs(dd) >= 0.05) s += pkTriangel(x + w * 0.52 - 3, yy - 1, dd > 0, dd > 0 ? P.gron : P.rod);
      }
    });
    if (d.modeller.length > MAX_MODELLER) s += pkT(x + 8.5, y + 22 + MAX_MODELLER * 6.2, O.pdf.fler(d.modeller.length - MAX_MODELLER), { storlek: 2.3, farg: P.mjuk });
    return s;
  };

  // De fem största bristerna, räknat över alla modeller.
  const perParam = new Map();
  for (const m of r.modeller) for (const kat of m.kategorier) for (const p of kat.parametrar) {
    if (p.status === 'ejHamtad') continue;
    const x = perParam.get(p.namn) || { saknas: 0, antal: 0 };
    x.saknas += p.antal - p.medVarde; x.antal += p.antal;
    perParam.set(p.namn, x);
  }
  const brister = [...perParam].filter(([, x]) => x.saknas > 0).sort((a, b) => b[1].saknas - a[1].saknas).slice(0, 5);
  const panelX = 208, panelW = P.bredd - P.marg - panelX;
  const panel = `
    <rect x="${panelX}" y="68" width="${panelW}" height="${18 + Math.max(1, brister.length) * 13}" rx="1.8" fill="${P.bakgrund}"/>
    ${pkT(panelX + 5, 76, O.pdf.storstaBrister, { storlek: 3.4, fet: true })}
    ${brister.map(([namn, x], i) => {
      const y = 85 + i * 13;
      return `${pkT(panelX + 5, y, namn, { storlek: 2.9, fet: true, max: panelW - 10 })}
        ${pkT(panelX + 5, y + 4.6, O.pdf.brist('', tal(x.saknas), pct(x.saknas, x.antal)).trim(), { storlek: 2.4, farg: P.mjuk, max: panelW - 10 })}
        <rect x="${panelX + 5}" y="${y + 6.3}" width="${panelW - 10}" height="1.4" rx="0.7" fill="${P.linje}"/>
        <rect x="${panelX + 5}" y="${y + 6.3}" width="${((panelW - 10) * Math.min(1, x.saknas / x.antal)).toFixed(2)}" height="1.4" rx="0.7" fill="${P.rod}"/>`;
    }).join('') || pkT(panelX + 5, 85, O.om.inget, { storlek: 2.6, farg: P.mjuk })}
    ${punkter.length < 2 ? pkT(panelX + 5, 68 + 18 + Math.max(1, brister.length) * 13 + 8, O.pdf.ingenTrend, { storlek: 2.3, farg: P.mjuk, max: panelW - 6 }) : ''}`;

  // Sida 1 och eventuella fortsättningssidor med disciplinkort.
  const sidor = [];
  const discipliner = r.discipliner;
  let i = 0;
  while (i < discipliner.length || !sidor.length) {
    const forsta = !sidor.length;
    const y0 = forsta ? 68 : 46, xKol = [P.marg, P.marg + 98], w = 94, maxY = P.hojd - 18;
    const yKol = [y0, y0];
    let innehall = '';
    while (i < discipliner.length) {
      const d = discipliner[i];
      const kolumn = yKol[0] <= yKol[1] ? 0 : 1;
      if (yKol[kolumn] + kortH(d) > maxY && (yKol[0] > y0 || yKol[1] > y0)) break;
      innehall += kortHtml(d, xKol[kolumn], yKol[kolumn], w);
      yKol[kolumn] += kortH(d) + 4;
      i++;
    }
    sidor.push({
      forsta,
      innehall: forsta ? `
        ${nyckeltal}
        ${kortStatistik(P.marg, 40, `${uppfyller} / ${bedomda.length}`, O.info.modeller)}
        ${kortStatistik(P.marg + 66, 40, pct(t.klara, t.kontrollerade), `${O.info.klara} · ${O.pdf.klaraAv(tal(t.klara), tal(t.kontrollerade))}`)}
        ${kortStatistik(P.marg + 132, 40, pct(t.kontrollerade, t.element), `${O.info.tackning} · ${tal(t.kontrollerade)} ${O.pdf.element}`)}
        ${pkT(P.marg, 64, O.pdf.perDisciplin, { storlek: 3.4, fet: true })}
        ${innehall}${panel}` : `${pkT(P.marg, 42, O.pdf.perDisciplin, { storlek: 3.4, fet: true })}${innehall}`,
    });
    if (sidor.length > 20) break;
  }

  // Trendsida när det finns minst två punkter.
  if (punkter.length >= 2) {
    const serier = pkDisciplinSerie(punkter);
    const gx = P.marg + 10, gy = 48, gw = 175, gh = 120;
    const xAv = j => gx + (punkter.length === 1 ? gw / 2 : (j * gw) / (punkter.length - 1));
    const yAv = a => gy + gh - a * gh;
    let g = '';
    for (let s = 0; s <= 4; s++) {
      const y = yAv(s / 4);
      g += `<rect x="${gx}" y="${y}" width="${gw}" height="0.25" fill="${P.linje}"/>${pkT(gx - 2, y + 1, `${s * 25} %`, { storlek: 2.3, farg: P.mjuk, ankare: 'end' })}`;
    }
    punkter.forEach((p, j) => {
      g += pkT(xAv(j), gy + gh + 6, new Date(p.tid).toLocaleDateString(sprak === 'sv' ? 'sv-SE' : 'en-GB'), { storlek: 2.2, farg: P.mjuk, ankare: 'middle' });
      if (p.brott) g += `<path d="M${xAv(j) - (xAv(j) - xAv(j - 1)) / 2} ${gy} L${xAv(j) - (xAv(j) - xAv(j - 1)) / 2} ${gy + gh}" stroke="${P.gra}" stroke-width="0.4" stroke-dasharray="1.5 1.2"/>
        ${pkT(xAv(j) - (xAv(j) - xAv(j - 1)) / 2 + 1, gy + 4, O.pdf.brott, { storlek: 2.2, farg: P.mjuk })}`;
    });
    serier.forEach((s, si) => {
      const farg = P.serier[si % P.serier.length];
      let bit = [];
      const ritaBit = () => { if (bit.length > 1) g += `<polyline points="${bit.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')}" fill="none" stroke="${farg}" stroke-width="0.7"/>`; bit = []; };
      s.varden.forEach((v, j) => {
        if (punkter[j].brott) ritaBit();
        if (v.andel === null) { ritaBit(); return; }
        bit.push([xAv(j), yAv(v.andel)]);
        g += v.ofullstandig
          ? `<circle cx="${xAv(j)}" cy="${yAv(v.andel)}" r="1.1" fill="#FFFFFF" stroke="${farg}" stroke-width="0.5"/>`
          : `<circle cx="${xAv(j)}" cy="${yAv(v.andel)}" r="1.1" fill="${farg}"/>`;
      });
      ritaBit();
      g += `<rect x="${gx + gw + 8}" y="${gy + si * 7 - 2}" width="3" height="3" rx="0.5" fill="${farg}"/>${pkT(gx + gw + 13, gy + si * 7 + 0.6, s.disciplin || O.pdf.ejAngiven, { storlek: 2.7, max: 60 })}`;
    });
    const forandringar = pkForandringar(punkter, O);
    g += forandringar.slice(0, 10).map((text, j) => pkT(gx + gw + 8, gy + serier.length * 7 + 8 + j * 5, text, { storlek: 2.3, farg: P.mjuk, max: 75 })).join('');
    sidor.push({ forsta: false, innehall: `${pkT(P.marg, 42, O.pdf.trend, { storlek: 3.4, fet: true })}${g}` });
  }

  return sidor.map((s, j) => `<svg xmlns="http://www.w3.org/2000/svg" width="${P.bredd}mm" height="${P.hojd}mm" viewBox="0 0 ${P.bredd} ${P.hojd}">
    ${huvud(k.setup.namn)}${s.innehall}${fot(j + 1, sidor.length)}</svg>`);
}

// ── Förhandsvisning och nedladdning ───────────────────────────────────────────

function pkPdfKnapp() {
  return pkKnapp('Skapa PDF', 'pkPdfDialog()', { titel: 'Infografik till ledningen' });
}

async function pkPdfDialog(sprak = _pk.setup.sprak || 'sv') {
  if (!_pk.korning?.resultat) return;
  let historik = null;
  try { historik = await pkLasHistorik(); } catch { /* utan historik blir det ingen trend */ }
  const sidor = pkPdfSidor(sprak, historik);
  _pk.ui.pdf = { sprak, sidor };
  pkDialog({
    titel: 'Infografik',
    text: `${sidor.length} ${sidor.length === 1 ? 'sida' : 'sidor'}, A4 liggande.${_pk.sparatId === _pk.setup.id ? ' Körningen sparas som mätpunkt när PDF:en skapas.' : ' Spara kontrollen för att få med trenden nästa gång.'}`,
    bredd: 'w-[820px]',
    html: `
      <div class="flex items-center gap-2 mb-2 text-sm">Språk
        <select onchange="pkPdfDialog(this.value)" class="border border-ads-border rounded px-2 py-1 bg-white">
          <option value="sv" ${sprak === 'sv' ? 'selected' : ''}>Svenska</option><option value="en" ${sprak === 'en' ? 'selected' : ''}>English</option></select></div>
      <div class="flex flex-col gap-3 bg-ads-gray p-3 rounded">${sidor.map(s => `<div class="bg-white shadow-sm">${s.replace(/width="297mm" height="210mm"/, 'width="100%"')}</div>`).join('')}</div>`,
    knappar: [
      { text: 'Stäng' },
      { text: 'Spara i ACC', gor: () => { pkSkapaPdf({ acc: true }); } },
      { text: 'Ladda ner PDF', primar: true, gor: () => { pkSkapaPdf({}); } },
    ],
  });
}

async function pkPdfBlob(sidor) {
  await pkLaddaSkript(PK_JSPDF, () => window.jspdf?.jsPDF);
  await pkLaddaSkript(PK_SVG2PDF, () => window.jspdf?.jsPDF?.API?.svg || window.svg2pdf);
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const hallare = document.createElement('div');
  hallare.style.cssText = 'position:fixed;left:-10000px;top:0;width:1123px;height:794px;';
  document.body.appendChild(hallare);
  try {
    for (const [i, svg] of sidor.entries()) {
      if (i) doc.addPage();
      hallare.innerHTML = svg;
      const el = hallare.firstElementChild;
      if (doc.svg) await doc.svg(el, { x: 0, y: 0, width: PK_PDF.bredd, height: PK_PDF.hojd });
      else await window.svg2pdf.svg2pdf(el, doc, { x: 0, y: 0, width: PK_PDF.bredd, height: PK_PDF.hojd });
    }
  } finally {
    hallare.remove();
  }
  return doc.output('blob');
}

async function pkSkapaPdf({ acc = false } = {}) {
  const ui = _pk.ui.pdf;
  if (!ui) return;
  vkToast('Skapar PDF…');
  try {
    const blob = await pkPdfBlob(ui.sidor);
    const O = PK_ORD[ui.sprak] || PK_ORD.sv;
    if (acc) await pkSparaRapportIAcc(blob, 'pdf');
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${pkFilnamnsdel(O.rapport)}_${pkFilnamnsdel(_currentProject?.attributes?.name)}_${pkTidstampel(_pk.korning.tid)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    // En rapport till ledningen ska alltid stämma med trenden.
    if (!pkMatpunktSparad() && await pkSparaMatpunkt({ tyst: true })) vkToast('PDF:en är skapad och körningen sparad som mätpunkt.');
  } catch (err) {
    vkToast(`Kunde inte skapa PDF:en: ${vkFelText(err)}`, 'red');
  }
}
