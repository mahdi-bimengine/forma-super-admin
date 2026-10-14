// issues-omrade.js — arbetsytan Område: clashärenden per område i huset.
//
// Området tas från ärendets eget fält (till exempel "Location") eller ACC:s
// platsträd, se isOmrade i issues-las.js. Per område räknas öppna, förfallna och
// slutförda ärenden och hur gamla de öppna är. Ett område flaggas som släpande
// när förfallna eller gamla ärenden dominerar, eller när det har flest öppna.

const IS_OPPNA_STATUSAR = new Set(['draft', 'open', 'pending', 'in_progress', 'in_review', 'not_approved', 'in_dispute']);

function isDagarSedan(datum) {
  if (!datum) return null;
  return Math.max(0, Math.round((Date.now() - new Date(datum + 'T00:00:00')) / 86400000));
}

// Clashärendena per område och projekt, med nyckeltal och släpflaggor.
function isOmradesTabell() {
  const inst = isInst();
  const flera = _is.projekt.size > 1;
  const grupper = new Map();
  for (const a of isAllaArenden()) {
    if (!isArClash(a) || (!_is.visaStangda && a.status === 'closed')) continue;
    if (_is.omradeProjekt !== 'alla' && a.projektId !== _is.omradeProjekt) continue;
    const omrade = isOmrade(a);
    const nyckel = `${a.projektId}|${omrade}`;
    if (!grupper.has(nyckel)) grupper.set(nyckel, { nyckel, omrade, projekt: a.projekt, visaProjekt: flera, arenden: [] });
    grupper.get(nyckel).arenden.push(a);
  }

  const rader = [...grupper.values()].map(g => {
    const oppna = g.arenden.filter(a => IS_OPPNA_STATUSAR.has(a.status));
    const aldrar = oppna.map(a => isDagarSedan(a.skapat)).filter(d => d != null);
    const perStatus = {};
    for (const a of g.arenden) perStatus[a.status] = (perStatus[a.status] || 0) + 1;
    return {
      ...g,
      perStatus,
      totalt:    g.arenden.length,
      oppna:     oppna.length,
      forfallna: oppna.filter(isArForfallet).length,
      slutforda: perStatus.completed || 0,
      stangda:   perStatus.closed || 0,
      gamla:     aldrar.filter(d => d > inst.gammalDagar).length,
      medelalder: aldrar.length ? Math.round(aldrar.reduce((s, d) => s + d, 0) / aldrar.length) : null,
      aldsta:    aldrar.length ? Math.max(...aldrar) : null,
    };
  });

  // Släpflaggor. Flest öppna = översta fjärdedelen bland områden med öppna ärenden.
  const medOppna = rader.filter(r => r.oppna > 0).map(r => r.oppna).sort((a, b) => b - a);
  const toppGrans = medOppna.length >= 4 ? medOppna[Math.floor(medOppna.length / 4) - 1] : Infinity;
  for (const r of rader) {
    r.orsaker = [];
    if (r.forfallna >= 3 && r.forfallna / r.oppna >= 0.3) r.orsaker.push(`${r.forfallna} förfallna`);
    if (r.gamla >= 3 && r.gamla / r.oppna >= 0.3) r.orsaker.push(`${r.gamla} äldre än ${inst.gammalDagar} d`);
    if (r.oppna >= toppGrans && r.oppna >= 5) r.orsaker.push('bland flest öppna');
    r.slapar = r.orsaker.length > 0;
    r.poang = r.forfallna * 3 + r.gamla * 2 + r.oppna;
  }
  return rader.sort((a, b) => (b.slapar - a.slapar) || (b.poang - a.poang) || a.omrade.localeCompare(b.omrade, 'sv', { numeric: true }));
}

// ── Händelser ─────────────────────────────────────────────────────────────────

function isValjOmrade(ref) {
  const nyckel = _is.ref[ref];
  _is.omradeVald = _is.omradeVald === nyckel ? null : nyckel;
  isRita();
}

function isSattOmradeProjekt(id) {
  _is.omradeProjekt = id;
  _is.omradeVald = null;
  isRita();
}

function isExporteraOmraden() {
  const aoa = [['Område', 'Projekt', 'Släpar', 'Orsak', 'Öppna', 'Förfallna', 'Slutförda', 'Stängda', 'Totalt', 'Medelålder öppna (d)', 'Äldsta öppna (d)']];
  for (const r of isOmradesTabell()) {
    aoa.push([r.omrade, r.projekt, r.slapar ? 'Ja' : '', r.orsaker.join(', '), r.oppna, r.forfallna, r.slutforda, r.stangda, r.totalt, r.medelalder ?? '', r.aldsta ?? '']);
  }
  isSparaXlsx(aoa, 'Clash per område', `clash_per_omrade_${new Date().toISOString().slice(0, 10)}.xlsx`,
    [30, 26, 8, 36, 8, 10, 10, 9, 8, 18, 16]);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function isOmradeHtml() {
  const rader = isOmradesTabell();
  const max = Math.max(1, ...rader.map(r => r.oppna));
  const slapande = rader.filter(r => r.slapar).length;
  const utan = rader.filter(r => r.omrade === IS_UTAN_OMRADE).reduce((s, r) => s + r.totalt, 0);
  const projekt = [..._is.projekt.values()];

  const varmeFarg = r => {
    if (!r.oppna) return '';
    const t = r.oppna / max;
    return t > 0.66 ? 'bg-red-100' : t > 0.33 ? 'bg-orange-50' : 'bg-yellow-50/60';
  };

  const tabell = rader.length ? `
    <table class="w-full text-sm">
      <thead class="text-[11px] text-ads-muted text-left bg-ads-gray/60">
        <tr>
          <th class="px-3 py-2">Område</th><th class="px-2">Status</th>
          <th class="px-2 text-right">Öppna</th><th class="px-2 text-right">Förfallna</th>
          <th class="px-2 text-right">Slutförda</th><th class="px-2 text-right">Totalt</th>
          <th class="px-2 text-right">Medelålder</th><th class="px-2 text-right">Äldsta</th><th class="px-2">Släpar</th>
        </tr>
      </thead>
      <tbody>
        ${rader.map(r => {
          const ref = isRef(r.nyckel);
          const vald = _is.omradeVald === r.nyckel;
          return `
            <tr onclick="isValjOmrade(${ref})" class="border-t border-ads-border/60 cursor-pointer hover:bg-ads-gray/40 ${vald ? 'bg-ads-blue/5' : ''}">
              <td class="px-3 py-2">
                <span class="text-ads-muted text-xs mr-1">${vald ? '▾' : '▸'}</span>
                <span class="font-medium ${r.omrade === IS_UTAN_OMRADE ? 'italic text-ads-muted' : ''}">${vkEsc(r.omrade)}</span>
                ${r.visaProjekt ? `<div class="text-[10px] text-ads-muted ml-4">${vkEsc(r.projekt)}</div>` : ''}</td>
              <td class="px-2 py-2 w-48">
                <div class="flex h-3 rounded overflow-hidden bg-ads-gray">
                  ${IS_STATUS_ORDNING.filter(k => r.perStatus[k]).map(k =>
                    `<div title="${isStatusLabel(k)}: ${r.perStatus[k]}" style="width:${100 * r.perStatus[k] / r.totalt}%;background:${IS_STATUS[k].farg}"></div>`).join('')}
                </div></td>
              <td class="px-2 py-2 text-right font-mono font-semibold ${varmeFarg(r)}">${r.oppna}</td>
              <td class="px-2 py-2 text-right font-mono ${r.forfallna ? 'text-red-700 font-semibold' : 'text-ads-muted'}">${r.forfallna}</td>
              <td class="px-2 py-2 text-right font-mono">${r.slutforda}</td>
              <td class="px-2 py-2 text-right font-mono text-ads-muted">${r.totalt}</td>
              <td class="px-2 py-2 text-right text-xs ${r.medelalder > isInst().gammalDagar ? 'text-orange-700 font-semibold' : ''}">${r.medelalder != null ? `${r.medelalder} d` : ''}</td>
              <td class="px-2 py-2 text-right text-xs">${r.aldsta != null ? `${r.aldsta} d` : ''}</td>
              <td class="px-2 py-2 text-xs">${r.slapar ? `<span class="text-red-700 font-medium">⚠ ${vkEsc(r.orsaker.join(', '))}</span>` : ''}</td>
            </tr>
            ${vald ? `<tr><td colspan="9" class="bg-ads-gray/40 px-3 py-2">${isOmradeArendenHtml(r)}</td></tr>` : ''}`;
        }).join('')}
      </tbody>
    </table>` : '<p class="p-8 text-center text-sm text-ads-muted">Inga clashärenden i de valda projekten.</p>';

  return `
    <div class="px-5 py-4">
      <div class="flex items-center gap-3 flex-wrap mb-3">
        <div class="text-sm">
          <b class="${slapande ? 'text-red-700' : 'text-ads-text'}">${slapande} släpande område${slapande === 1 ? '' : 'n'}</b>
          <span class="text-ads-muted">av ${rader.length}</span>
        </div>
        ${projekt.length > 1 ? `
          <select onchange="isSattOmradeProjekt(this.value)" class="text-xs border border-ads-border rounded px-2 py-1 bg-white">
            <option value="alla" ${_is.omradeProjekt === 'alla' ? 'selected' : ''}>Alla projekt</option>
            ${projekt.map(p => `<option value="${p.id}" ${_is.omradeProjekt === p.id ? 'selected' : ''}>${vkEsc(p.namn)}</option>`).join('')}
          </select>` : ''}
        <label class="flex items-center gap-1.5 text-xs text-ads-muted cursor-pointer">
          <input type="checkbox" ${_is.visaStangda ? 'checked' : ''} onchange="isVaxlaStangda()" class="accent-ads-blue" /> Räkna med stängda</label>
        <div class="flex-1"></div>
        <span class="text-[11px] text-ads-muted">Område från: ${vkEsc(isOmradeKallaText())}</span>
        ${bhKnapp('isExporteraOmraden()', 'Excel')}
      </div>
      ${utan && utan === rader.reduce((s, r) => s + r.totalt, 0) && rader.length ? `
        <div class="mb-3 p-2.5 rounded border border-amber-200 bg-amber-50 text-xs text-amber-900">
          Inget ärende har något område. Kontrollera under Inställningar vad fältet heter, eller om området ligger i ACC:s platsträd.
        </div>` : ''}
      <div class="bg-white border border-ads-border rounded overflow-x-auto">${tabell}</div>
      <p class="text-[11px] text-ads-muted mt-2">
        Ett område släpar när minst 30 % av de öppna ärendena är förfallna eller äldre än ${isInst().gammalDagar} dagar (minst 3 st),
        eller när det hör till den fjärdedel som har flest öppna. Klicka på ett område för att se dess ärenden.
      </p>
    </div>`;
}

function isOmradeKallaText() {
  const inst = isInst();
  if (inst.omradeKalla === 'falt') return `eget fält (${inst.omradeFalt})`;
  if (inst.omradeKalla === 'plats') return `platsträdet${Number(inst.platsNiva) ? `, nivå ${inst.platsNiva}` : ''}`;
  return `eget fält (${inst.omradeFalt}), annars platsträdet`;
}

function isOmradeArendenHtml(r) {
  const lista = [...r.arenden].sort((a, b) =>
    (IS_OPPNA_STATUSAR.has(b.status) - IS_OPPNA_STATUSAR.has(a.status)) || (isArForfallet(b) - isArForfallet(a)) || a.nr - b.nr);
  return `
    <table class="w-full text-xs bg-white border border-ads-border rounded">
      <tbody>
        ${lista.map(a => {
          const d = isDagarKvar(a.forfaller);
          return `
            <tr class="border-t border-ads-border/60 first:border-t-0">
              <td class="px-2 py-1.5 whitespace-nowrap"><a href="${isLank(a)}" target="_blank" rel="noopener" class="font-mono text-ads-blue hover:underline">#${a.nr} ↗</a></td>
              <td class="px-2 py-1.5">${vkEsc(a.rubrik)}</td>
              <td class="px-2 py-1.5">${isStatusTagg(a.status, false)}</td>
              <td class="px-2 py-1.5">${vkEsc(a.tilldelad)}</td>
              <td class="px-2 py-1.5 whitespace-nowrap">${a.forfaller}</td>
              <td class="px-2 py-1.5 whitespace-nowrap ${isArForfallet(a) ? 'text-red-700 font-semibold' : 'text-ads-muted'}">
                ${d == null || IS_KLARA.has(a.status) ? '' : d < 0 ? `${-d} d sen` : `om ${d} d`}</td>
              <td class="px-2 py-1.5 text-ads-muted whitespace-nowrap">skapad ${a.skapat}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}
