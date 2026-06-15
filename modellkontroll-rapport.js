// ── Modellkontroll: Rapportexport ─────────────────────────────────────────────
// Genererar en utskriftsklar granskningsrapport (A4) från _mk.results.
// Fristående modul — ladda efter modellkontroll.js:
//   <script src="modellkontroll-rapport.js"></script>
// Anropas via mkExportReport() (knapp i steg 3, se HANDOFF.md).
//
// Design: "A+B Kombinerad" — 5 sidor:
//   1. Översikt (metadata + total uppfyllnad)
//   2. Visuell översikt (fördelning + uppfyllnad per modell)
//   3. Resultat per modell
//   4. Parameter × modell-matris
//   5. Kravställda parametrar
//
// mkBuildReportHtml(data) är ren (ingen global state) och kan enhetstestas.

// ── Konstanter ────────────────────────────────────────────────────────────────

const MK_RAPPORT_LEVELS = {
  green:  { label: 'OK',           color: '#1f9d57', soft: '#e7f5ec', dot: '#22a35c' },
  yellow: { label: 'Typfel',       color: '#b7791f', soft: '#fbf3da', dot: '#e0b13b' },
  orange: { label: 'Saknar värde', color: '#c2570f', soft: '#fcebdd', dot: '#ee7e3a' },
  grey:   { label: 'Saknar param', color: '#6b7280', soft: '#eef0f2', dot: '#aab1b9' },
};
const MK_RAPPORT_ORDER = ['green', 'yellow', 'orange', 'grey'];

const MK_RAPPORT_LEVEL_DESC = {
  green:  'Parameter finns och har giltigt värde av rätt typ.',
  yellow: 'Värde finns men matchar inte förväntad värdetyp.',
  orange: 'Parametern finns men saknar värde på elementen.',
  grey:   'Parametern saknas helt i modellen.',
};

const MK_RAPPORT_EXT = {
  rvt: { bg: '#e7f0fb', fg: '#2563a8' },
  ifc: { bg: '#e6f4ec', fg: '#1f8a52' },
  dwg: { bg: '#fdeede', fg: '#bd5d12' },
  nwd: { bg: '#efe9f8', fg: '#6b4ba8' },
};

const MK_MATRIX_CHUNK = 8; // max models per matrix page

// ── Hjälpare ──────────────────────────────────────────────────────────────────

function mkRapEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mkRapFmt(n) { return n == null ? '–' : Number(n).toLocaleString('sv-SE'); }
function mkRapPct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
function mkRapTruncName(s, max) {
  const n = s.replace(/\.(rvt|ifc|dwg|nwd)$/i, '');
  return n.length > max ? n.slice(0, max - 1) + '…' : n;
}

function mkRapDot(level, size = 8) {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:${size}px;background:${MK_RAPPORT_LEVELS[level].dot};flex:0 0 auto"></span>`;
}

function mkRapBadge(level) {
  const L = MK_RAPPORT_LEVELS[level];
  return `<span class="mkr-badge" style="background:${L.soft};color:${L.color}">${mkRapDot(level, 6)}${L.label}</span>`;
}

function mkRapExtBadge(ext) {
  const c = MK_RAPPORT_EXT[ext] || { bg: '#eee', fg: '#666' };
  return `<span class="mkr-ext" style="background:${c.bg};color:${c.fg}">${mkRapEsc(ext)}</span>`;
}

function mkRapStackedBar(counts, total, height, radius) {
  const segs = MK_RAPPORT_ORDER.filter((k) => counts[k]).map((k) =>
    `<div style="width:${mkRapPct(counts[k], total)}%;background:${MK_RAPPORT_LEVELS[k].dot}"></div>`).join('');
  return `<div style="display:flex;width:100%;height:${height}px;border-radius:${radius}px;overflow:hidden;background:#eef0f2">${segs}</div>`;
}

// Ring (enfärgad procentindikator)
function mkRapRing(value, size, stroke, color, innerHtml) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `
    <div style="position:relative;width:${size}px;height:${size}px;flex:0 0 auto">
      <svg width="${size}" height="${size}" style="transform:rotate(-90deg)">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#eef0f2" stroke-width="${stroke}"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
                stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - value / 100)}" stroke-linecap="round"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">${innerHtml}</div>
    </div>`;
}

// Donut (flersegment)
function mkRapDonut(counts, total, size, stroke) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let acc = 0;
  const segs = MK_RAPPORT_ORDER.filter((k) => counts[k]).map((k) => {
    const frac = counts[k] / total;
    const seg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${MK_RAPPORT_LEVELS[k].dot}"
      stroke-width="${stroke}" stroke-dasharray="${c * frac} ${c}" stroke-dashoffset="${-c * acc}"/>`;
    acc += frac;
    return seg;
  }).join('');
  return `<svg width="${size}" height="${size}" style="transform:rotate(-90deg)">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#eef0f2" stroke-width="${stroke}"/>${segs}</svg>`;
}

// ── Datainsamling från _mk ────────────────────────────────────────────────────

function mkCollectReportData() {
  const params  = _mk.refParams.filter((p) => p.selected);
  const doneRes = _mk.results.filter((r) => r.status === 'done');
  const skipped = _mk.results.filter((r) => r.status !== 'done');

  const emptyCounts = () => ({ green: 0, yellow: 0, orange: 0, grey: 0 });

  const models = doneRes.map((r) => {
    const counts = emptyCounts();
    const cells = params.map((p) => {
      const pr = r.paramResults.find((x) => x.param.name === p.name);
      const level = pr ? pr.level : 'grey';
      counts[level]++;
      return { level, existCount: pr?.existCount ?? 0, totalCount: pr?.totalCount ?? 0 };
    });
    return {
      name: r.file.name, ext: r.file.ext, elements: r.elementCount,
      cells, counts,
      okCount:  counts.green,
      overall:  mkOverallLevel(r.paramResults),
      passRate: mkRapPct(counts.green, params.length),
    };
  });

  const perParam = params.map((p, i) => {
    const counts = emptyCounts();
    models.forEach((m) => counts[m.cells[i].level]++);
    return { ...p, counts, modelsOk: counts.green };
  });

  const totals = emptyCounts();
  models.forEach((m) => MK_RAPPORT_ORDER.forEach((k) => (totals[k] += m.counts[k])));
  const totalChecks = models.length * params.length;

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');

  // Split the parameter × model matrix into pages of at most MK_MATRIX_CHUNK models
  const matrixChunks = [];
  for (let i = 0; i < models.length; i += MK_MATRIX_CHUNK) {
    matrixChunks.push(models.slice(i, i + MK_MATRIX_CHUNK));
  }
  if (!matrixChunks.length) matrixChunks.push([]);

  // Pages 1–3 fixed + one page per matrix chunk + page for kravställda parametrar
  const totalPages = 3 + matrixChunks.length + 1;

  return {
    meta: {
      project: _currentProject?.attributes?.name || _currentProject?.name || 'Okänt projekt',
      hub:     (typeof _hubs !== 'undefined' && _hubs[_hubIdx]?.attributes?.name) || '',
      refFile: _mk.refFile?.name || '',
      author:  document.getElementById('user-label')?.textContent?.trim() || '',
      date:    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
      checkId: `MK-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`,
      logoUrl: new URL('logo.png', location.href).href,
    },
    params: perParam, models, skipped, totals, totalChecks,
    matrixChunks, totalPages,
    passRate: mkRapPct(totals.green, totalChecks),
    fullyOk:  models.filter((m) => m.overall === 'green').length,
  };
}

// ── Sidbyggstenar ─────────────────────────────────────────────────────────────

function mkRapFullHeader(meta) {
  return `
    <div class="mkr-hdr">
      <div style="display:flex;align-items:center;gap:18px">
        <img src="${mkRapEsc(meta.logoUrl)}" alt="" style="height:48px;filter:brightness(0) invert(1)"/>
        <div style="border-left:1px solid rgba(255,255,255,.2);padding-left:18px">
          <div style="font-size:10.5px;font-weight:700;letter-spacing:.16em;color:rgba(255,255,255,.55);text-transform:uppercase">Rapport av modellkontroll</div>
          <div style="font-size:22px;font-weight:700;margin-top:3px;letter-spacing:-.01em">${mkRapEsc(meta.project)}</div>
        </div>
      </div>
      <div style="text-align:right;font-size:10.5px;color:rgba(255,255,255,.7);line-height:1.7">
        <div>${mkRapEsc(meta.date)}</div>
        ${meta.author ? `<div style="color:rgba(255,255,255,.5)">${mkRapEsc(meta.author)}</div>` : ''}
      </div>
    </div>`;
}

function mkRapSlimHeader(meta, section) {
  return `
    <div class="mkr-hdr-slim">
      <div style="display:flex;align-items:center;gap:12px">
        <img src="${mkRapEsc(meta.logoUrl)}" alt="" style="height:26px;filter:brightness(0) invert(1)"/>
        <span style="font-size:12px;font-weight:600;color:rgba(255,255,255,.85)">${mkRapEsc(meta.project)}</span>
        <span style="font-size:11px;color:rgba(255,255,255,.4)">· ${section}</span>
      </div>
      <span style="font-size:10.5px;color:rgba(255,255,255,.5)">${mkRapEsc(meta.checkId)}</span>
    </div>`;
}

function mkRapSectionHead(kicker, title, note) {
  return `
    <div style="padding-top:34px;margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.16em;color:#0696D7;text-transform:uppercase">${kicker}</div>
      <h2 style="margin:7px 0 0;font-size:23px;font-weight:700;color:#2D2926;letter-spacing:-.01em">${title}</h2>
      ${note ? `<p style="margin:6px 0 0;font-size:12.5px;color:#7c7b77;max-width:580px">${note}</p>` : ''}
    </div>`;
}

function mkRapFooter(meta, n, total) {
  return `
    <div class="mkr-foot">
      <span>BIM&nbsp;Engine · Modellkontroll</span>
      <span style="color:#a9a8a3">${mkRapEsc(meta.checkId)}</span>
      <span>Sida ${n} / ${total}</span>
    </div>`;
}

function mkRapLegendCards() {
  return `
    <div style="margin-top:18px;display:flex;gap:12px">
      ${MK_RAPPORT_ORDER.map((k) => `
        <div style="flex:1;border:1px solid #e3e3e1;border-radius:8px;padding:12px 14px">
          <div style="display:flex;align-items:center;gap:7px">
            ${mkRapDot(k, 9)}
            <span style="font-size:11.5px;font-weight:600;color:#2D2926">${MK_RAPPORT_LEVELS[k].label}</span>
          </div>
          <div style="font-size:10.5px;color:#7c7b77;margin-top:6px;line-height:1.45">${MK_RAPPORT_LEVEL_DESC[k]}</div>
        </div>`).join('')}
    </div>`;
}

// ── Sidor ─────────────────────────────────────────────────────────────────────

function mkRapPage1(d) {
  const { meta, models, params, totals, totalChecks, passRate, fullyOk } = d;
  const chips = models.map((m) => `
    <span style="display:inline-flex;align-items:center;gap:6px;border:1px solid #e3e3e1;border-radius:5px;padding:3px 8px;font-size:11.5px;font-weight:600;color:#2D2926">
      ${mkRapExtBadge(m.ext)}${mkRapEsc(m.name.replace(/\.(rvt|ifc|dwg|nwd)$/i, ''))}
    </span>`).join('');

  const metaItems = [
    ['Referensfil', meta.refFile], ['Kontroll-ID', meta.checkId],
    ['Antal kravparametrar', `${params.length} st`], ['Antal modeller', `${models.length} st`],
    ['Konto / hub', meta.hub], ['Genererad', meta.date],
  ].filter(([, v]) => v).map(([l, v]) => `
    <div style="border-top:1px solid #e3e3e1;padding:9px 0">
      <div style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#7c7b77;text-transform:uppercase">${l}</div>
      <div style="font-size:13px;font-weight:500;color:#2D2926;margin-top:3px">${mkRapEsc(v)}</div>
    </div>`).join('');

  const legend = MK_RAPPORT_ORDER.map((k) => `
    <div style="display:flex;align-items:center;gap:6px;font-size:11.5px">
      ${mkRapDot(k)}
      <span style="font-weight:600;color:#2D2926">${MK_RAPPORT_LEVELS[k].label}</span>
      <span style="color:#7c7b77">${totals[k]}</span>
    </div>`).join('');

  const tiles = [
    [models.length, 'Kontrollerade modeller', '#2D2926'],
    [fullyOk, 'Fullt godkända', '#1f9d57'],
    [models.length - fullyOk, 'Modeller med avvikelse', '#c2570f'],
  ].map(([v, l, c]) => `
    <div style="flex:1;border:1px solid #e3e3e1;border-radius:8px;padding:16px 18px">
      <div style="font-size:34px;font-weight:750;line-height:1;color:${c};letter-spacing:-.02em">${v}</div>
      <div style="font-size:11.5px;color:#7c7b77;margin-top:6px">${l}</div>
    </div>`).join('');

  return `
    <div class="mkr-page">
      <div class="mkr-body">
        ${mkRapFullHeader(meta)}
        <div style="padding-top:28px">
          <p style="margin:0;font-size:16.5px;font-weight:600;color:#2D2926;max-width:620px;line-height:1.4">
            ${models.length} modeller har kontrollerats mot beställarens kravställda egenskaper.
          </p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">${chips}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;column-gap:44px;margin-top:24px">${metaItems}</div>
        <div style="margin-top:30px;border:1px solid #e3e3e1;border-radius:12px;padding:26px;display:flex;gap:30px;align-items:center;background:#fcfcfb">
          ${mkRapRing(passRate, 140, 13, '#1f9d57', `
            <div style="font-size:34px;font-weight:750;color:#2D2926;letter-spacing:-.02em">${passRate}%</div>
            <div style="font-size:9.5px;font-weight:600;letter-spacing:.08em;color:#7c7b77;text-transform:uppercase">godkänt</div>`)}
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:#2D2926">Total parameteruppfyllnad</div>
            <div style="font-size:12px;color:#7c7b77;margin-top:2px">${mkRapFmt(totals.green)} av ${totalChecks} parameterkontroller godkända över samtliga modeller.</div>
            <div style="margin-top:14px">${mkRapStackedBar(totals, totalChecks, 12, 6)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:12px">${legend}</div>
          </div>
        </div>
        <div style="display:flex;gap:14px;margin-top:16px">${tiles}</div>
      </div>
      ${mkRapFooter(meta, 1, d.totalPages)}
    </div>`;
}

function mkRapPage2(d) {
  const { meta, models, params, totals, totalChecks } = d;

  const donutLegend = MK_RAPPORT_ORDER.map((k) => `
    <div style="display:flex;align-items:center;gap:8px;font-size:11.5px">
      <span style="width:9px;height:9px;border-radius:2px;background:${MK_RAPPORT_LEVELS[k].dot}"></span>
      <span style="flex:1;color:#2D2926">${MK_RAPPORT_LEVELS[k].label}</span>
      <span style="font-weight:700;color:#2D2926">${totals[k]}</span>
      <span style="width:36px;text-align:right;color:#7c7b77">${mkRapPct(totals[k], totalChecks)}%</span>
    </div>`).join('');

  const bars = models.map((m) => `
    <div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        ${mkRapExtBadge(m.ext)}
        <span style="font-size:12px;font-weight:600;color:#2D2926;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${mkRapEsc(m.name)}</span>
        <span style="font-size:11.5px;font-weight:700;color:${m.passRate === 100 ? '#1f9d57' : '#2D2926'}">${m.passRate}%</span>
      </div>
      ${mkRapStackedBar(m.counts, params.length, 14, 4)}
    </div>`).join('');

  return `
    <div class="mkr-page">
      <div class="mkr-body">
        ${mkRapSlimHeader(meta, 'Visuell översikt')}
        ${mkRapSectionHead('Översikt', 'Fördelning och uppfyllnad',
          'Utfallet för samtliga parameterkontroller, samt andel godkända kontroller per modell.')}
        <div style="display:flex;gap:18px">
          <div style="width:246px;border:1px solid #e3e3e1;border-radius:10px;padding:18px;flex:0 0 auto">
            <div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#2D2926;text-transform:uppercase">Fördelning av kontroller</div>
            <div style="display:flex;justify-content:center;position:relative;margin:12px 0 4px">
              ${mkRapDonut(totals, totalChecks, 150, 24)}
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
                <div style="font-size:26px;font-weight:750;color:#2D2926">${totalChecks}</div>
                <div style="font-size:9.5px;color:#7c7b77;letter-spacing:.05em">KONTROLLER</div>
              </div>
            </div>
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:7px">${donutLegend}</div>
          </div>
          <div style="flex:1;border:1px solid #e3e3e1;border-radius:10px;padding:18px">
            <div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#2D2926;text-transform:uppercase;margin-bottom:14px">Uppfyllnad per modell</div>
            <div style="display:flex;flex-direction:column;gap:15px">${bars}</div>
          </div>
        </div>
        ${mkRapLegendCards()}
      </div>
      ${mkRapFooter(meta, 2, d.totalPages)}
    </div>`;
}

function mkRapPage3(d) {
  const { meta, models, params, skipped } = d;

  const rows = models.map((m) => `
    <tr>
      <td class="mkr-td">
        <div style="display:flex;align-items:center;gap:9px">
          ${mkRapExtBadge(m.ext)}
          <div style="font-weight:600;color:#2D2926">${mkRapEsc(m.name)}</div>
        </div>
      </td>
      <td class="mkr-td" style="text-align:right;color:#7c7b77">${mkRapFmt(m.elements)}</td>
      <td class="mkr-td" style="padding-left:16px">
        ${mkRapStackedBar(m.counts, params.length, 9, 5)}
        <div style="display:flex;gap:10px;margin-top:6px;font-size:10px;color:#7c7b77">
          ${MK_RAPPORT_ORDER.filter((k) => m.counts[k]).map((k) =>
            `<span style="display:flex;align-items:center;gap:4px">${mkRapDot(k, 6)}${m.counts[k]}</span>`).join('')}
        </div>
      </td>
      <td class="mkr-td" style="text-align:center;font-weight:600;color:#2D2926">${m.okCount}/${params.length}</td>
      <td class="mkr-td" style="text-align:right">${mkRapBadge(m.overall)}</td>
    </tr>`).join('');

  const skippedBlock = !skipped.length ? '' : `
    <div style="margin-top:24px;border:1px solid #ecd9a0;background:#fbf3da;border-radius:8px;padding:12px 16px">
      <div style="font-size:11.5px;font-weight:700;color:#b7791f;margin-bottom:6px">Ej kontrollerade modeller (${skipped.length})</div>
      ${skipped.map((r) => `
        <div style="font-size:11px;color:#7c7b77;padding:2px 0">
          <span style="font-weight:600;color:#2D2926">${mkRapEsc(r.file.name)}</span> —
          ${r.status === 'error' ? mkRapEsc(r.error || 'Fel vid kontroll')
            : r.status === 'no-derivative' ? 'Ingen derivat hittad (öppna modellen i ACC-visaren först)'
            : 'Ingen vy hittades i derivaten'}
        </div>`).join('')}
    </div>`;

  return `
    <div class="mkr-page">
      <div class="mkr-body">
        ${mkRapSlimHeader(meta, 'Resultat per modell')}
        ${mkRapSectionHead('Sammanställning', 'Resultat per modell',
          'Varje modell har kontrollerats mot samtliga kravställda parametrar. Statusfördelningen visar utfallet per parameter.')}
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th class="mkr-th" style="width:34%">Modell</th>
            <th class="mkr-th" style="text-align:right;width:70px">Element</th>
            <th class="mkr-th" style="width:30%;padding-left:16px">Statusfördelning</th>
            <th class="mkr-th" style="text-align:center;width:60px">Godkända</th>
            <th class="mkr-th" style="text-align:right;width:92px">Status</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${skippedBlock}
      </div>
      ${mkRapFooter(meta, 3, d.totalPages)}
    </div>`;
}

function mkRapPage4(d, chunkModels, pageNum) {
  const { meta, params } = d;
  const colW = 36, gap = 4, labelW = 234, summaryW = 88;
  const isLastChunk = chunkModels[chunkModels.length - 1] === d.models[d.models.length - 1];
  const chunkStart  = d.models.indexOf(chunkModels[0]) + 1;
  const chunkEnd    = d.models.indexOf(chunkModels[chunkModels.length - 1]) + 1;
  const rangeNote   = d.models.length > MK_MATRIX_CHUNK
    ? ` — modeller ${chunkStart}–${chunkEnd} av ${d.models.length}`
    : '';

  const headerCells = chunkModels.map((m) => `
    <div style="width:${colW}px;display:flex;justify-content:center;flex:0 0 auto">
      <div style="transform:rotate(-90deg);white-space:nowrap;font-size:10px;font-weight:600;color:#2D2926;
                  width:116px;text-align:left;overflow:hidden;text-overflow:ellipsis">${mkRapEsc(mkRapTruncName(m.name, 22))}</div>
    </div>`).join('');

  const cell = (level) => {
    const bg     = level === 'grey'   ? '#eef0f2' : MK_RAPPORT_LEVELS[level].dot;
    const border = level === 'grey'   ? '1.5px dashed #c5cdd6' : 'none';
    const color  = level === 'grey'   ? '#9aa3ad' : '#fff';
    const glyph  = level === 'green'  ? '✓' : level === 'yellow' ? '!' : level === 'orange' ? '–' : '';
    return `<div style="width:${colW}px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;
      background:${bg};border:${border};color:${color};font-size:13px;font-weight:700;line-height:1">${glyph}</div>`;
  };

  const rows = params.map((p, i) => `
    <div style="display:flex;align-items:center;gap:${gap}px;padding:5px 0;${i ? 'border-top:1px solid #e3e3e1' : ''}">
      <div style="width:${labelW}px;padding-right:12px;flex:0 0 auto">
        <div style="font-size:11.5px;font-weight:600;color:#2D2926;font-family:ui-monospace,Menlo,monospace">${mkRapEsc(p.name)}</div>
        <div style="font-size:10px;color:#7c7b77;margin-top:1px">${mkRapEsc(p.valueType || 'text')}${p.paramType ? ' · ' + mkRapEsc(p.paramType) : ''}</div>
      </div>
      ${chunkModels.map((m) => `<div style="width:${colW}px;display:flex;justify-content:center;flex:0 0 auto">${cell(m.cells[i].level)}</div>`).join('')}
      <div style="width:1px;background:#e3e3e1;align-self:stretch;margin:0 6px;flex:0 0 auto"></div>
      <div style="width:${summaryW}px;display:flex;align-items:center;gap:6px;flex:0 0 auto">
        <div style="flex:1">${mkRapStackedBar(p.counts, d.models.length, 7, 4)}</div>
        <span style="font-size:11px;font-weight:600;color:${p.modelsOk === d.models.length ? '#1f9d57' : '#2D2926'};width:30px;text-align:right;flex:0 0 auto">${p.modelsOk}/${d.models.length}</span>
      </div>
    </div>`).join('');

  const footRow = `
    <div style="display:flex;align-items:center;gap:${gap}px;padding-top:10px;margin-top:4px;border-top:2px solid #2D2926">
      <div style="width:${labelW}px;font-size:10px;font-weight:700;letter-spacing:.05em;color:#2D2926;text-transform:uppercase;flex:0 0 auto">Godkända / modell</div>
      ${chunkModels.map((m) => `<div style="width:${colW}px;text-align:center;font-size:10.5px;font-weight:700;flex:0 0 auto;color:${m.okCount === params.length ? '#1f9d57' : '#2D2926'}">${m.okCount}</div>`).join('')}
      <div style="width:1px;margin:0 6px;flex:0 0 auto"></div>
      <div style="width:${summaryW}px;flex:0 0 auto"></div>
    </div>`;

  const legend = isLastChunk ? `
    <div style="margin-top:24px;display:flex;gap:18px;flex-wrap:wrap;border:1px solid #e3e3e1;border-radius:10px;padding:14px 18px">
      ${MK_RAPPORT_ORDER.map((k) => `
        <div style="display:flex;align-items:center;gap:9px">
          ${cell(k)}
          <div>
            <div style="font-size:11.5px;font-weight:600;color:#2D2926">${MK_RAPPORT_LEVELS[k].label}</div>
            <div style="font-size:10px;color:#7c7b77">${MK_RAPPORT_LEVEL_DESC[k]}</div>
          </div>
        </div>`).join('')}
    </div>` : '';

  return `
    <div class="mkr-page">
      <div class="mkr-body">
        ${mkRapSlimHeader(meta, 'Parameter × modell')}
        ${mkRapSectionHead('Detaljerad matris', 'Parameter × modell',
          `Status för varje kravställd parameter i respektive modell${mkRapEsc(rangeNote)}.`)}
        <div style="display:flex;align-items:flex-end;gap:${gap}px;padding-left:${labelW}px;height:120px;margin-bottom:4px">
          ${headerCells}
          <div style="width:1px;margin:0 6px;flex:0 0 auto"></div>
          <div style="width:${summaryW}px;text-align:right;font-size:9.5px;font-weight:700;letter-spacing:.06em;
                      color:#7c7b77;text-transform:uppercase;padding-bottom:2px;flex:0 0 auto">Modeller OK</div>
        </div>
        ${rows}
        ${footRow}
        ${legend}
      </div>
      ${mkRapFooter(meta, pageNum, d.totalPages)}
    </div>`;
}

function mkRapPage5(d) {
  const { meta, models, params } = d;

  const rows = params.map((p) => `
    <tr>
      <td class="mkr-td" style="font-weight:600;color:#2D2926;font-family:ui-monospace,Menlo,monospace;font-size:11.5px">${mkRapEsc(p.name)}</td>
      <td class="mkr-td" style="color:#7c7b77;padding-right:24px">${mkRapEsc(p.valueType || 'text')}</td>
      <td class="mkr-td" style="color:#7c7b77">${mkRapEsc(p.paramType || '–')}</td>
      <td class="mkr-td" style="color:#7c7b77;font-size:11.5px;padding-right:16px">${mkRapEsc(p.comment || '')}</td>
      <td class="mkr-td">
        <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
          <div style="width:54px">${mkRapStackedBar(p.counts, models.length, 7, 4)}</div>
          <span style="font-size:11.5px;font-weight:600;color:${p.modelsOk === models.length ? '#1f9d57' : '#2D2926'};width:32px;text-align:right">${p.modelsOk}/${models.length}</span>
        </div>
      </td>
    </tr>`).join('');

  return `
    <div class="mkr-page">
      <div class="mkr-body">
        ${mkRapSlimHeader(meta, 'Kravställda parametrar')}
        ${mkRapSectionHead('Underlag', 'Kravställda parametrar',
          `Referenslista: ${mkRapEsc(meta.refFile)}. Kolumnen längst till höger visar hur många av ${models.length} modeller som uppfyller kravet fullt ut.`)}
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th class="mkr-th" style="width:26%">Parameter</th>
            <th class="mkr-th" style="width:88px;padding-right:24px">Värdetyp</th>
            <th class="mkr-th" style="width:64px">Nivå</th>
            <th class="mkr-th">Kommentar</th>
            <th class="mkr-th" style="width:116px;text-align:right">Modeller OK</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:auto;padding-top:24px">
          <div style="border-top:2px solid #2D2926;padding-top:16px;display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:28px">
            <div style="font-size:11px;color:#7c7b77;max-width:440px;line-height:1.5">
              Rapporten är maskinellt genererad av BIM&nbsp;Engine Modellkontroll baserat på modellernas senaste publicerade version${meta.hub ? ' i ' + mkRapEsc(meta.hub) : ''}.
            </div>
            <img src="${mkRapEsc(meta.logoUrl)}" alt="" style="height:40px;opacity:.9"/>
          </div>
        </div>
      </div>
      ${mkRapFooter(meta, d.totalPages, d.totalPages)}
    </div>`;
}

// ── Dokument ──────────────────────────────────────────────────────────────────

function mkBuildReportHtml(d) {
  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8"/>
<title>Modellkontroll — ${mkRapEsc(d.meta.project)} — ${mkRapEsc(d.meta.checkId)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;750&display=swap" rel="stylesheet"/>
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { background: #eceeef; }
  body { font-family: Inter, system-ui, sans-serif; color: #3d3d3d; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .mkr-page { width: 794px; min-height: 1123px; background: #fff; margin: 28px auto;
              box-shadow: 0 1px 4px rgba(0,0,0,.10); display: flex; flex-direction: column; }
  .mkr-body { flex: 1; padding: 0 56px; display: flex; flex-direction: column; }
  .mkr-hdr { margin: 0 -56px; background: #2D2926; color: #fff; padding: 26px 56px;
             display: flex; justify-content: space-between; align-items: center; }
  .mkr-hdr-slim { margin: 0 -56px; background: #2D2926; color: #fff; padding: 13px 56px;
                  display: flex; justify-content: space-between; align-items: center; }
  .mkr-foot { display: flex; justify-content: space-between; padding: 12px 56px;
              border-top: 1px solid #e3e3e1; font-size: 10.5px; color: #7c7b77; }
  .mkr-th { padding: 0 0 9px; font-size: 10px; font-weight: 700; letter-spacing: .07em;
            color: #7c7b77; text-transform: uppercase; text-align: left; }
  .mkr-td { padding: 13px 0; border-top: 1px solid #e3e3e1; vertical-align: middle; font-size: 12.5px; }
  .mkr-badge { display: inline-flex; align-items: center; gap: 5px; border-radius: 4px;
               font-size: 11px; font-weight: 600; padding: 2px 7px; white-space: nowrap; }
  .mkr-ext { display: inline-block; border-radius: 3px; font-size: 9.5px; font-weight: 700;
             letter-spacing: .04em; padding: 2px 5px; text-transform: uppercase; }
  .mkr-toolbar { position: fixed; top: 16px; right: 16px; display: flex; gap: 8px; z-index: 10; }
  .mkr-toolbar button { font: 600 13px Inter, system-ui, sans-serif; padding: 9px 16px; border-radius: 6px;
                        border: none; cursor: pointer; background: #2D2926; color: #fff;
                        box-shadow: 0 2px 8px rgba(0,0,0,.25); }
  .mkr-toolbar button:hover { background: #000; }
  @media print {
    html, body { background: #fff; }
    .mkr-toolbar { display: none; }
    .mkr-page { margin: 0 auto; box-shadow: none; break-after: page; }
    .mkr-page:last-child { break-after: auto; }
    tr, .mkr-td { break-inside: avoid; }
  }
  @page { size: A4; margin: 0; }
</style>
</head>
<body>
<div class="mkr-toolbar"><button onclick="window.print()">Skriv ut / Spara som PDF</button></div>
${mkRapPage1(d)}
${mkRapPage2(d)}
${mkRapPage3(d)}
${d.matrixChunks.map((chunk, ci) => mkRapPage4(d, chunk, 4 + ci)).join('')}
${mkRapPage5(d)}
</body>
</html>`;
}

// ── Publik entry point ────────────────────────────────────────────────────────

function mkExportReport() {
  const done = _mk.results.filter((r) => r.status === 'done');
  if (!done.length) {
    mkToast('Inga slutförda kontroller att exportera.', 'red');
    return;
  }
  const html = mkBuildReportHtml(mkCollectReportData());
  const win = window.open('', '_blank');
  if (!win) {
    mkToast('Popup blockerades — tillåt popups för att exportera rapporten.', 'red');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
