// ── Ritningsgranskning: rapporten ─────────────────────────────────────────────
// Resultatvyn i steg 3, en utskriftsvänlig rapport i eget fönster och CSV för
// vidare hantering i Excel eller som underlag till ärenden.

const GR_PILL = {
  fel:     'bg-red-50 text-red-700',
  varning: 'bg-amber-50 text-amber-700',
  info:    'bg-slate-100 text-slate-500',
};

const GR_TACKNING = {
  auto:   { text: 'automatisk', klass: 'bg-green-50 text-green-700' },
  delvis: { text: 'delvis',     klass: 'bg-amber-50 text-amber-700' },
  nej:    { text: 'visuell',    klass: 'bg-slate-100 text-slate-500' },
};

// ── Resultatvyn ───────────────────────────────────────────────────────────────

function grRenderResultat() {
  const { statistik } = _gr.resultat;

  const kort = (varde, etikett, klass) => `
    <div class="flex-1 border border-ads-border rounded-lg px-4 py-3 bg-white">
      <div class="text-2xl font-semibold ${klass || 'text-ads-text'}">${varde}</div>
      <div class="text-xs text-ads-muted">${etikett}</div>
    </div>`;

  return `
    <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
      <p class="text-sm text-ads-muted">
        ${statistik.antalPdf} blad, ${grEsc(statistik.format)}.
        ${_gr.kalla === 'dm' ? 'Hämtade från Data Management.' : 'Lästa från ditt eget paket.'}
      </p>
      <div class="flex gap-2">
        <button onclick="grExporteraRapport()"
                class="text-sm bg-ads-blue text-white rounded px-3 py-1.5 hover:bg-ads-blue-dark transition-colors
                       inline-flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 8V4h8v4M6 15h8v3H6v-3z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 8h12a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M6 15H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1"/>
          </svg>
          Rapport
        </button>
        <button onclick="grLaddaNerCsv('avvikelser')"
                class="text-sm border border-ads-border bg-white rounded px-3 py-1.5 text-ads-muted hover:text-ads-text transition-colors">
          Avvikelser som CSV
        </button>
        <button onclick="grLaddaNerCsv('blad')"
                class="text-sm border border-ads-border bg-white rounded px-3 py-1.5 text-ads-muted hover:text-ads-text transition-colors">
          Bladdata som CSV
        </button>
      </div>
    </div>

    <div class="flex gap-3 mb-5">
      ${kort(statistik.antalFel, 'fel', 'text-red-600')}
      ${kort(statistik.antalVarningar, 'varningar', 'text-amber-600')}
      ${kort(statistik.bladUtanAnmarkning, 'blad utan anmärkning', 'text-green-600')}
      ${kort(statistik.antalPdf, 'blad totalt')}
    </div>

    ${grVyPunkter()}
    ${grVyAvvikelser()}
    ${grVyForteckning()}
    ${grVyBlad()}
    ${grVyManuellt()}
    ${grVyUnderlag()}

    <div class="flex gap-2 mt-5">
      <button onclick="grNav(1)" class="text-sm border border-ads-border bg-white rounded px-3 py-1.5 text-ads-muted hover:text-ads-text transition-colors">
        Ny granskning
      </button>
      <button onclick="grNav(2)" class="text-sm border border-ads-border bg-white rounded px-3 py-1.5 text-ads-muted hover:text-ads-text transition-colors">
        Ändra kontrollpunkter
      </button>
      <button onclick="grLasOmAllt()" class="text-sm border border-ads-border bg-white rounded px-3 py-1.5 text-ads-muted hover:text-ads-text transition-colors">
        Läs om ritningarna
      </button>
    </div>`;
}

/** Utfallet per punkt i riktlinjerna. */
function grUtfallForPunkt(id) {
  const punkt = _gr.punkter.find(p => p.id === id);
  if (!punkt?.aktiv) return { text: 'ej vald', klass: 'bg-slate-100 text-slate-400' };
  if (punkt.tackning === 'nej') return { text: 'granskas visuellt', klass: 'bg-slate-100 text-slate-500' };

  const traffar = _gr.resultat.avvikelser.filter(a => a.punkt === id);
  const fel     = traffar.filter(a => a.allvar === 'fel').length;
  const varn    = traffar.filter(a => a.allvar === 'varning').length;
  if (fel)  return { text: `${fel} fel${varn ? ` + ${varn} varn` : ''}`, klass: GR_PILL.fel };
  if (varn) return { text: `${varn} varningar`, klass: GR_PILL.varning };
  return { text: 'utan anmärkning', klass: 'bg-green-50 text-green-700' };
}

function grVyPunkter() {
  return `
    <div class="bg-white border border-ads-border rounded-lg overflow-hidden mb-5">
      <div class="px-4 py-3 border-b border-ads-border">
        <h3 class="text-sm font-semibold text-ads-text">Resultat per punkt i riktlinjerna</h3>
      </div>
      <table class="w-full text-sm">
        <tbody>
          ${_gr.punkter.map(p => {
            const u = grUtfallForPunkt(p.id);
            const t = GR_TACKNING[p.tackning];
            return `
              <tr class="border-t border-ads-border ${p.aktiv ? '' : 'opacity-50'}">
                <td class="px-4 py-2 font-mono text-xs text-ads-muted align-top w-12">${p.id}</td>
                <td class="py-2 pr-3">
                  <div class="text-ads-text">${grEsc(p.text)}</div>
                  <div class="text-xs text-ads-muted mt-0.5">${grEsc(p.hur)}</div>
                </td>
                <td class="py-2 pr-3 align-top whitespace-nowrap">
                  <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${t.klass}">${t.text}</span>
                </td>
                <td class="py-2 pr-4 align-top whitespace-nowrap">
                  <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${u.klass}">${u.text}</span>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function grVyAvvikelser() {
  const avvikelser = _gr.resultat.avvikelser;
  if (!avvikelser.length) {
    return `
      <div class="bg-white border border-ads-border rounded-lg px-4 py-6 mb-5">
        <p class="text-sm text-ads-muted">Inga avvikelser hittades av de valda kontrollerna.</p>
      </div>`;
  }

  const perPunkt = new Map();
  for (const a of avvikelser) {
    if (!perPunkt.has(a.punkt)) perPunkt.set(a.punkt, []);
    perPunkt.get(a.punkt).push(a);
  }

  return `
    <div class="bg-white border border-ads-border rounded-lg overflow-hidden mb-5">
      <div class="px-4 py-3 border-b border-ads-border">
        <h3 class="text-sm font-semibold text-ads-text">Avvikelser (${avvikelser.length})</h3>
      </div>
      <div class="max-h-[60vh] overflow-auto">
        ${[...perPunkt.entries()].map(([id, lista]) => {
          const punkt = _gr.punkter.find(p => p.id === id);
          return `
            <div class="px-4 py-2 bg-ads-gray border-t border-ads-border flex items-center gap-2">
              <span class="font-mono text-xs font-semibold text-ads-text">${id}</span>
              <span class="text-xs text-ads-muted truncate">${grEsc(punkt?.text || '')}</span>
              <span class="text-xs text-ads-muted ml-auto shrink-0">${lista.length}</span>
            </div>
            ${lista.map(a => `
              <div class="px-4 py-2.5 flex items-start gap-3 border-t border-ads-border">
                <span class="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${GR_PILL[a.allvar]} uppercase">${a.allvar}</span>
                <div class="min-w-0 flex-1">
                  <p class="text-sm text-ads-text">${grEsc(a.rubrik)}</p>
                  ${a.detalj ? `<p class="text-xs text-ads-muted mt-0.5">${grEsc(a.detalj)}</p>` : ''}
                </div>
                <span class="shrink-0 text-xs text-ads-muted max-w-56 truncate" title="${grEsc(a.fil)}">${grEsc(a.fil)}</span>
              </div>`).join('')}`;
        }).join('')}
      </div>
    </div>`;
}

function grVyForteckning() {
  const f = _gr.resultat.forteckning;
  if (!f.harForteckning) return '';

  return `
    <div class="bg-white border border-ads-border rounded-lg p-4 mb-5">
      <h3 class="text-sm font-semibold text-ads-text mb-1">Handlingsförteckning</h3>
      <p class="text-sm text-ads-muted mb-3">
        Bladen redovisar tillsammans ${f.listade.length} ritningsnummer.
        Paketet innehåller ${_gr.resultat.statistik.antalLasta} blad.
      </p>
      <div class="grid grid-cols-2 gap-4 text-xs">
        <div>
          <p class="font-medium text-ads-text mb-1">Listade på bladen men saknas i paketet (${f.saknas.length})</p>
          <p class="text-ads-muted max-h-32 overflow-auto">${f.saknas.length ? f.saknas.map(grEsc).join('<br>') : 'inga'}</p>
        </div>
        <div>
          <p class="font-medium text-ads-text mb-1">Finns i paketet men saknas i förteckningen (${f.extra.length})</p>
          <p class="text-ads-muted max-h-32 overflow-auto">${f.extra.length ? f.extra.map(grEsc).join('<br>') : 'inga'}</p>
        </div>
      </div>
      <p class="text-xs text-ads-muted mt-3">
        Ett granskningspaket är ofta ett urval ur den fulla förteckningen, så vänsterkolumnen är normalt inte tom.
      </p>
    </div>`;
}

function grVyBlad() {
  const rader = _gr.blad.map(b => ({
    b,
    antal: _gr.resultat.avvikelser.filter(a => a.fil === b.fil && a.allvar !== 'info').length,
    harFel: _gr.resultat.avvikelser.some(a => a.fil === b.fil && a.allvar === 'fel'),
  }));

  return `
    <div class="bg-white border border-ads-border rounded-lg overflow-hidden mb-5">
      <div class="px-4 py-3 border-b border-ads-border">
        <h3 class="text-sm font-semibold text-ads-text">Blad i paketet (${rader.length})</h3>
      </div>
      <div class="max-h-[50vh] overflow-auto">
        <table class="w-full text-xs">
          <thead class="bg-ads-gray sticky top-0">
            <tr class="text-left text-ads-muted">
              <th class="font-medium px-4 py-2">Fil</th><th class="font-medium">Format</th>
              <th class="font-medium">Skala</th><th class="font-medium">Ändring</th>
              <th class="font-medium">Ritningsnamn</th><th class="font-medium">Status</th>
              <th class="font-medium">Handling</th><th class="font-medium">Datum</th>
              <th class="font-medium">Norr</th><th class="font-medium pr-4">Anm.</th>
            </tr>
          </thead>
          <tbody>
            ${rader.map(({ b, antal, harFel }) => `
              <tr class="border-t border-ads-border">
                <td class="px-4 py-1.5 whitespace-nowrap">${grEsc(b.fil)}</td>
                <td class="whitespace-nowrap">${grEsc(b.format || '')}</td>
                <td class="whitespace-nowrap">${grEsc(b.skalaHuvud || '')}</td>
                <td class="whitespace-nowrap">${grEsc(b.faltAndring || '')}</td>
                <td class="max-w-48 truncate" title="${grEsc(b.faltSpecifikation || '')}">${grEsc(b.faltSpecifikation || '')}</td>
                <td class="whitespace-nowrap">${grEsc(b.faltStatus || '')}</td>
                <td class="whitespace-nowrap">${grEsc(b.faltHandling || '')}</td>
                <td class="whitespace-nowrap">${grEsc(b.faltDatum || '')}</td>
                <td class="whitespace-nowrap">${b.kompass?.riktningGrader != null ? b.kompass.riktningGrader + '&deg;' : ''}</td>
                <td class="pr-4">${antal ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${harFel ? GR_PILL.fel : GR_PILL.varning}">${antal}</span>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function grManuellaPunkter() {
  return _gr.punkter.filter(p => p.aktiv && p.tackning !== 'auto');
}

function grVyManuellt() {
  const punkter = grManuellaPunkter();
  if (!punkter.length) return '';
  const klara = punkter.filter(p => _gr.avbockade.has(p.id)).length;

  return `
    <div class="bg-white border border-ads-border rounded-lg p-4 mb-5">
      <div class="flex items-center justify-between mb-1">
        <h3 class="text-sm font-semibold text-ads-text">Kvar att granska visuellt</h3>
        <span id="gr-avbockat" class="text-xs text-ads-muted">${klara} av ${punkter.length} avbockade</span>
      </div>
      <p class="text-sm text-ads-muted mb-3">
        Punkterna nedan går inte att avgöra ur textlagret. Bocka av dem här, de följer med till rapporten.
      </p>
      <div class="border border-ads-border rounded divide-y divide-ads-border">
        ${punkter.map(p => `
          <label class="flex items-start gap-3 px-3 py-2.5 hover:bg-ads-gray cursor-pointer">
            <input type="checkbox" ${_gr.avbockade.has(p.id) ? 'checked' : ''}
                   onchange="grToggleAvbockad('${p.id}', this.checked)"
                   class="mt-0.5 w-4 h-4 shrink-0 accent-ads-blue" />
            <span class="min-w-0 flex-1">
              <span class="text-sm text-ads-text"><span class="font-mono text-xs text-ads-muted mr-1.5">${p.id}</span>${grEsc(p.text)}</span>
              <span class="block text-xs text-ads-muted mt-0.5">${grEsc(p.hur)}</span>
            </span>
          </label>`).join('')}
      </div>
    </div>`;
}

function grToggleAvbockad(id, kryssad) {
  if (kryssad) _gr.avbockade.add(id);
  else         _gr.avbockade.delete(id);
  const el = document.getElementById('gr-avbockat');
  if (el) {
    const punkter = grManuellaPunkter();
    el.textContent = `${punkter.filter(p => _gr.avbockade.has(p.id)).length} av ${punkter.length} avbockade`;
  }
}

function grVyUnderlag() {
  return `
    <div class="bg-white border border-ads-border rounded-lg p-4">
      <h3 class="text-sm font-semibold text-ads-text mb-1">Underlag som lästes ur paketet</h3>
      <p class="text-sm text-ads-muted mb-3">
        Bladen delas i grupper efter sidformat och varje grupp definierar sin egen ritningsmall: positioner
        som har samma text på nästan alla blad är mallens fasta text. Grupper där mallen inte gick att härleda
        jämförs inte mot varandra, där gäller bara kontrollerna per blad.
      </p>
      <table class="w-full text-xs">
        <tr class="text-ads-muted text-left">
          <th class="font-medium py-1">Formatgrupp</th><th class="font-medium">Blad</th>
          <th class="font-medium">Mall härledd</th><th class="font-medium">Fasta punkter i huvudet</th>
          <th class="font-medium">Fält som lästes ut</th>
        </tr>
        ${_gr.resultat.grupper.map(g => `
          <tr class="border-t border-ads-border">
            <td class="py-1">${grEsc(g.format)}</td>
            <td>${g.antalBlad}</td>
            <td>${g.mallHarledd ? 'ja' : 'nej, för få blad'}</td>
            <td>${g.antalMallpunkter}</td>
            <td>${g.antalFalt}</td>
          </tr>`).join('')}
      </table>
    </div>`;
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function grCsv(rader) {
  const cell = v => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rader.map(r => r.map(cell).join(';')).join('\r\n');
}

function grLaddaNer(namn, innehall, typ) {
  const blob = new Blob([innehall], { type: typ });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = namn;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function grPaketnamn() {
  if (_gr.kalla === 'egen' && _gr.egnaFiler.length) {
    return (_gr.egnaFiler[0].paket || 'Ritningar').replace(/\.zip$/i, '');
  }
  return _currentProject?.attributes?.name || 'Ritningsgranskning';
}

function grLaddaNerCsv(typ) {
  if (!_gr.resultat) return;
  const bas = `${grPaketnamn()} granskning`;

  if (typ === 'avvikelser') {
    const rader = [['Allvar', 'Punkt', 'Kontroll', 'Anmärkning', 'Fil', 'Detalj'],
      ..._gr.resultat.avvikelser.map(a => [
        a.allvar, a.punkt, _gr.punkter.find(p => p.id === a.punkt)?.text || '', a.rubrik, a.fil, a.detalj,
      ])];
    grLaddaNer(`${bas} avvikelser.csv`, grCsv(rader), 'text/csv;charset=utf-8');
    return;
  }

  const rader = [['Fil', 'Format', 'Bredd mm', 'Höjd mm', 'Sidor', 'Dokumentnummer i huvud', 'Ritningsnamn',
    'Skala', 'Ändring', 'Status', 'Handling', 'Datum', 'Norrpil grader', 'Modellreferens', 'Antal avvikelser'],
    ..._gr.blad.map(b => [
      b.fil, b.format, b.breddMm, b.hojdMm, b.sidor,
      b.faltDokumentnummer || '', b.faltSpecifikation || '', b.skalaHuvud || '', b.faltAndring || '',
      b.faltStatus || '', b.faltHandling || '', b.faltDatum || '',
      b.kompass?.riktningGrader ?? '', (b.modellreferenser || []).join(' | '),
      _gr.resultat.avvikelser.filter(a => a.fil === b.fil && a.allvar !== 'info').length,
    ])];
  grLaddaNer(`${bas} blad.csv`, grCsv(rader), 'text/csv;charset=utf-8');
}

// ── Utskriftsvänlig rapport i eget fönster ────────────────────────────────────

const GR_RAPPORT_STIL = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 40px 80px; font: 13px/1.5 "Segoe UI", system-ui, sans-serif; color: #1b1f24; background: #fff; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 32px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #e6e8eb; }
  h3 { font-size: 13px; margin: 20px 0 6px; }
  .sub { color: #5b6570; margin: 0 0 20px; }
  .kort { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
  .kort div { flex: 1 1 130px; border: 1px solid #e6e8eb; border-radius: 8px; padding: 12px 14px; }
  .kort b { display: block; font-size: 24px; line-height: 1.1; }
  .kort span { color: #5b6570; font-size: 11px; }
  .fel b { color: #b3261e; } .varning b { color: #a86400; } .ok b { color: #1a7f37; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 8px; }
  th { text-align: left; background: #f4f6f8; font-weight: 600; }
  th, td { border: 1px solid #e6e8eb; padding: 5px 8px; vertical-align: top; }
  td.smal, th.smal { white-space: nowrap; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 10px; font-weight: 600; }
  .p-fel { background: #fce8e6; color: #b3261e; }
  .p-varning { background: #fdf3e0; color: #8a5200; }
  .p-info { background: #eef1f4; color: #4a5560; }
  .p-ok { background: #e6f4ea; color: #1a7f37; }
  .punkt { font-family: Consolas, monospace; font-weight: 600; }
  ul.manuell { list-style: none; padding: 0; }
  ul.manuell li { border: 1px solid #e6e8eb; border-radius: 8px; padding: 9px 12px; margin-bottom: 7px; display: flex; gap: 10px; }
  ul.manuell .ruta { width: 15px; height: 15px; border: 1.5px solid #9aa3ac; border-radius: 3px; flex: none; margin-top: 2px; text-align: center; line-height: 13px; font-size: 12px; }
  ul.manuell .ruta.i { background: #1a7f37; border-color: #1a7f37; color: #fff; }
  ul.manuell .hur { color: #5b6570; font-size: 11.5px; margin-top: 3px; }
  .knapp { border: 1px solid #c9ced4; background: #fff; border-radius: 6px; padding: 6px 12px; font: inherit; cursor: pointer; }
  @media print {
    body { padding: 0; font-size: 10.5px; }
    h2 { page-break-after: avoid; } tr { page-break-inside: avoid; }
    .knapp { display: none; }
  }
`;

function grExporteraRapport() {
  if (!_gr.resultat) return;

  const { statistik, avvikelser, grupper, forteckning } = _gr.resultat;
  const paket    = grPaketnamn();
  const tidpunkt = new Date().toLocaleString('sv-SE');
  const projekt  = _currentProject?.attributes?.name || '';

  const perPunkt = new Map();
  for (const a of avvikelser) {
    if (!perPunkt.has(a.punkt)) perPunkt.set(a.punkt, []);
    perPunkt.get(a.punkt).push(a);
  }

  const avvikelseTabell = lista => `
    <table>
      <tr><th class="smal">Allvar</th><th class="smal">Fil</th><th>Anmärkning</th><th>Detalj</th></tr>
      ${lista.map(a => `<tr>
        <td class="smal"><span class="pill p-${a.allvar}">${a.allvar}</span></td>
        <td class="smal">${grEsc(a.fil)}</td>
        <td>${grEsc(a.rubrik)}</td>
        <td>${grEsc(a.detalj)}</td>
      </tr>`).join('')}
    </table>`;

  const manuella = grManuellaPunkter();

  const html = `<!doctype html>
<html lang="sv"><head><meta charset="utf-8">
<title>Ritningsgranskning ${grEsc(paket)}</title>
<style>${GR_RAPPORT_STIL}</style></head><body>

<h1>Granskning av ritningspaket</h1>
<p class="sub">
  Paket: <b>${grEsc(paket)}</b>${projekt ? ` | Projekt: ${grEsc(projekt)}` : ''}<br>
  Granskat: ${grEsc(tidpunkt)} | ${statistik.antalPdf} blad | Format: ${grEsc(statistik.format)}<br>
  Regelverk: Riktlinjer BIM för granskning av bygghandlingar, avsnitten Dokument och Ritning
</p>

<div class="kort">
  <div class="fel"><b>${statistik.antalFel}</b><span>fel</span></div>
  <div class="varning"><b>${statistik.antalVarningar}</b><span>varningar</span></div>
  <div class="ok"><b>${statistik.bladUtanAnmarkning}</b><span>blad utan anmärkning</span></div>
  <div><b>${statistik.antalPdf}</b><span>blad totalt</span></div>
</div>

<h2>Resultat per punkt i riktlinjerna</h2>
<table>
  <tr><th class="smal">Punkt</th><th>Kontroll</th><th class="smal">Täckning</th><th class="smal">Utfall</th></tr>
  ${_gr.punkter.map(p => {
    const u = grUtfallForPunkt(p.id);
    const klass = u.klass.includes('red') ? 'p-fel' : u.klass.includes('amber') ? 'p-varning'
                : u.klass.includes('green') ? 'p-ok' : 'p-info';
    return `<tr>
      <td class="punkt smal">${p.id}</td>
      <td>${grEsc(p.text)}<div style="color:#5b6570;font-size:11px">${grEsc(p.hur)}</div></td>
      <td class="smal">${GR_TACKNING[p.tackning].text}</td>
      <td class="smal"><span class="pill ${klass}">${u.text}</span></td>
    </tr>`;
  }).join('')}
</table>

<h2>Avvikelser</h2>
${avvikelser.length === 0
  ? '<p>Inga avvikelser hittades av de valda kontrollerna.</p>'
  : [...perPunkt.entries()].map(([id, lista]) => `
      <h3><span class="punkt">${id}</span> ${grEsc(_gr.punkter.find(p => p.id === id)?.text || '')} (${lista.length})</h3>
      ${avvikelseTabell(lista)}`).join('')}

${forteckning.harForteckning ? `
<h2>Handlingsförteckning</h2>
<p>Bladen redovisar tillsammans <b>${forteckning.listade.length}</b> ritningsnummer. Paketet innehåller <b>${statistik.antalLasta}</b> blad.</p>
<table>
  <tr><th>Listade på bladen men saknas i paketet (${forteckning.saknas.length})</th>
      <th>Finns i paketet men saknas i förteckningen (${forteckning.extra.length})</th></tr>
  <tr><td>${forteckning.saknas.map(grEsc).join('<br>') || 'inga'}</td>
      <td>${forteckning.extra.map(grEsc).join('<br>') || 'inga'}</td></tr>
</table>
<p style="color:#5b6570;font-size:11.5px">Ett granskningspaket är ofta ett urval ur den fulla förteckningen, så vänsterkolumnen är normalt inte tom.</p>` : ''}

<h2>Blad i paketet</h2>
<table>
  <tr><th>Fil</th><th class="smal">Format</th><th class="smal">Skala</th><th class="smal">Ändring</th>
      <th>Ritningsnamn</th><th class="smal">Status</th><th class="smal">Handling</th>
      <th class="smal">Datum</th><th class="smal">Norr</th><th class="smal">Anm.</th></tr>
  ${_gr.blad.map(b => {
    const antal  = avvikelser.filter(a => a.fil === b.fil && a.allvar !== 'info').length;
    const harFel = avvikelser.some(a => a.fil === b.fil && a.allvar === 'fel');
    return `<tr>
      <td class="smal">${grEsc(b.fil)}</td>
      <td class="smal">${grEsc(b.format || '')}</td>
      <td class="smal">${grEsc(b.skalaHuvud || '')}</td>
      <td class="smal">${grEsc(b.faltAndring || '')}</td>
      <td>${grEsc(b.faltSpecifikation || '')}</td>
      <td class="smal">${grEsc(b.faltStatus || '')}</td>
      <td class="smal">${grEsc(b.faltHandling || '')}</td>
      <td class="smal">${grEsc(b.faltDatum || '')}</td>
      <td class="smal">${b.kompass?.riktningGrader != null ? b.kompass.riktningGrader + '&deg;' : ''}</td>
      <td class="smal">${antal ? `<span class="pill p-${harFel ? 'fel' : 'varning'}">${antal}</span>` : ''}</td>
    </tr>`;
  }).join('')}
</table>

${manuella.length ? `
<h2>Kvar att granska visuellt</h2>
<ul class="manuell">
  ${manuella.map(p => `
    <li>
      <span class="ruta ${_gr.avbockade.has(p.id) ? 'i' : ''}">${_gr.avbockade.has(p.id) ? '&#10003;' : ''}</span>
      <span><span class="punkt">${p.id}</span> ${grEsc(p.text)}<div class="hur">${grEsc(p.hur)}</div></span>
    </li>`).join('')}
</ul>` : ''}

<h2>Underlag som lästes ur paketet</h2>
<p class="sub">Bladen delas i grupper efter sidformat och varje grupp definierar sin egen ritningsmall: positioner som har
samma text på nästan alla blad är mallens fasta text, och deras utbredning nere till höger är ritningshuvudet.
Grupper där mallen inte gick att härleda jämförs inte mot varandra.</p>
<table>
  <tr><th class="smal">Formatgrupp</th><th class="smal">Blad</th><th class="smal">Mall härledd</th>
      <th class="smal">Fasta punkter i huvudet</th><th class="smal">Fält som lästes ut</th></tr>
  ${grupper.map(g => `<tr>
    <td class="smal">${grEsc(g.format)}</td><td class="smal">${g.antalBlad}</td>
    <td class="smal">${g.mallHarledd ? 'ja' : 'nej, för få blad'}</td>
    <td class="smal">${g.antalMallpunkter}</td><td class="smal">${g.antalFalt}</td>
  </tr>`).join('')}
</table>

<p style="margin-top:28px"><button class="knapp" onclick="window.print()">Skriv ut eller spara som PDF</button></p>
</body></html>`;

  const fonster = window.open('', '_blank');
  if (!fonster) {
    alert('Popup blockerades. Tillåt popup-fönster för att öppna rapporten.');
    return;
  }
  fonster.document.open();
  fonster.document.write(html);
  fonster.document.close();
}
