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

// ── Val av källa ──────────────────────────────────────────────────────────────
// Värdet i rullistan: auto, plats:<nivå>, falt:<titel> eller text.

function isOmradeVardeFor(inst) {
  if (inst.omradeKalla === 'plats') return `plats:${Number(inst.platsNiva) || 0}`;
  if (inst.omradeKalla === 'falt')  return `falt:${isDelar(inst.omradeFalt)[0] || ''}`;
  return inst.omradeKalla || 'auto';
}

function isOmradeValjare(inst, onchange, klass) {
  const kallor = isOmradeKallor(isAllaArenden().filter(isArClash));
  const valt = isOmradeVardeFor(inst);
  const alternativ = [{ varde: 'auto', text: 'Automatiskt: eget fält Location/Plats/Område, annars platsträdet, annars fritext' },
    ...kallor.map(k => ({
      varde: k.kalla === 'plats' ? `plats:${k.niva}` : k.kalla === 'falt' ? `falt:${k.falt}` : 'text',
      text: `${k.text} (${k.antal} ärenden${k.exempel ? `, t.ex. ${k.exempel}` : ''})`,
    }))];
  // Ett sparat val som inte längre finns i datan visas ändå, så att det syns.
  if (!alternativ.some(a => a.varde.toLowerCase() === valt.toLowerCase())) alternativ.push({ varde: valt, text: `${valt.replace(':', ': ')} (finns inte i datan)` });
  return `
    <select onchange="${onchange}" class="border border-ads-border rounded bg-white ${klass}">
      ${alternativ.map(a => `<option value="${vkEsc(a.varde)}" ${a.varde.toLowerCase() === valt.toLowerCase() ? 'selected' : ''}>${vkEsc(a.text)}</option>`).join('')}
    </select>`;
}

// I Inställningar ändras bara utkastet. I ytan Område sparas valet direkt.
function isValjOmradeKalla(varde, iDialog) {
  const mal = iDialog ? _is.instUtkast : { ...isInst() };
  const [kalla, ...rest] = String(varde).split(':');
  mal.omradeKalla = kalla;
  if (kalla === 'plats') mal.platsNiva = Number(rest[0]) || 0;
  if (kalla === 'falt')  mal.omradeFalt = rest.join(':');
  if (!iDialog) {
    _is.inst = mal;
    isLagra('is-inst', _is.inst);
    _is.omradeVald = null;
    isRita();
  }
}

// ── Tilldela område i bulk ────────────────────────────────────────────────────
// Ärenden utan område får ett förslag ur rubriken: det mest precisa område vars
// alla delar (till exempel "Block A" och "Plan 25") står i rubriken. Området
// skrivs dit den valda källan pekar: platsträdet, det egna fältet eller fritexten.

// Vart området ska skrivas i ett projekt, och vilka områden som finns att välja.
function isOmradeMal(p) {
  const inst = isInst();
  const namn = isDelar(inst.omradeFalt);
  const def = (p.faltDef || []).find(f => namn.includes(String(f.title || '').toLowerCase()));
  const clash = p.arenden.filter(isArClash);

  const faltMal = () => {
    if (!def) return null;
    const val = def.metadata?.list?.options;
    const alternativ = val?.length
      ? val.map(o => ({ varde: o.id, namn: o.value, delar: [o.value] }))
      : [...new Set(clash.map(a => a.egnaFalt?.[def.title]).filter(Boolean))].map(v => ({ varde: v, namn: v, delar: [v] }));
    return { typ: 'falt', nyckel: `ca:${def.id}`, titel: `eget fält ${def.title}`, faltNamn: 'customAttributes', alternativ };
  };
  const platsMal = () => {
    if (!p.platser?.size) return null;
    const alternativ = [];
    for (const [id, n] of p.platser) {
      if (n.typ === 'Root') continue;
      const vag = isPlatsVag(p.platser, id);
      alternativ.push({ varde: id, namn: vag.join(' › '), delar: vag });
    }
    alternativ.sort((a, b) => a.namn.localeCompare(b.namn, 'sv', { numeric: true }));
    return { typ: 'plats', nyckel: 'locationId', titel: 'platsträdet', faltNamn: 'locationId', alternativ };
  };
  const textMal = () => ({
    typ: 'text', nyckel: 'locationDetails', titel: 'platsbeskrivningen', faltNamn: 'locationDetails',
    alternativ: [...new Set(clash.map(a => a.platsText).filter(Boolean))].map(v => ({ varde: v, namn: v, delar: [v] })),
  });

  if (inst.omradeKalla === 'falt')  return faltMal();
  if (inst.omradeKalla === 'plats') return platsMal();
  if (inst.omradeKalla === 'text')  return textMal();
  // Automatiskt: den källa som redan används mest i projektets clashärenden.
  const iFalt  = def ? clash.filter(a => a.egnaFalt?.[def.title]).length : -1;
  const iPlats = p.platser?.size ? clash.filter(a => a.platsVag?.length).length : -1;
  if (iFalt > iPlats) return faltMal();
  if (iPlats >= 0) return platsMal();
  if (def) return faltMal();
  return textMal();
}

function isNormText(s) {
  return ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9åäöéü]+/g, ' ').trim() + ' ';
}

// Det mest precisa området vars alla delar står i rubriken.
function isForeslaOmrade(a, mal) {
  const rubrik = isNormText(a.rubrik);
  let bast = null;
  for (const alt of mal?.alternativ || []) {
    if (!alt.delar.length || !alt.delar.every(d => rubrik.includes(isNormText(d)))) continue;
    const poang = alt.delar.length * 1000 + alt.namn.length;
    if (!bast || poang > bast.poang) bast = { alt, poang };
  }
  return bast?.alt || null;
}

function isUtanOmrade() {
  return isAllaArenden().filter(a => isArClash(a) && (_is.visaStangda || a.status !== 'closed') &&
    (_is.omradeProjekt === 'alla' || a.projektId === _is.omradeProjekt) && isOmrade(a) === IS_UTAN_OMRADE);
}

function isOppnaTilldela() {
  _is.tilldela = new Map();
  _is.tilldelaValda = new Set();
  for (const a of isUtanOmrade()) {
    const forslag = isForeslaOmrade(a, isOmradeMal(_is.projekt.get(a.projektId)));
    _is.tilldela.set(a.id, forslag?.varde || '');
    if (forslag) _is.tilldelaValda.add(a.id);
  }
  _is.dialog = 'omrade';
  isRita();
}

function isTilldelaVal(ref, varde) {
  const id = _is.ref[ref];
  _is.tilldela.set(id, varde);
  if (varde) _is.tilldelaValda.add(id); else _is.tilldelaValda.delete(id);
  const box = document.getElementById(`is-tv-${id}`);
  if (box) box.checked = !!varde;
  isRitaTilldelaKnapp();
}

function isTilldelaMarkera(ref, pa) {
  const id = _is.ref[ref];
  if (pa && _is.tilldela.get(id)) _is.tilldelaValda.add(id); else _is.tilldelaValda.delete(id);
  isRitaTilldelaKnapp();
}

function isTilldelaMarkeraAlla(pa) {
  for (const [id, v] of _is.tilldela) if (pa && v) _is.tilldelaValda.add(id); else _is.tilldelaValda.delete(id);
  isRita();
}

function isRitaTilldelaKnapp() {
  const el = document.getElementById('is-tilldela-knapp');
  if (el) el.textContent = `Lägg i ändringslistan (${_is.tilldelaValda.size})`;
}

// Lägger de markerade i ändringslistan och öppnar granskningen.
function isLaggOmradenIListan() {
  let lagda = 0;
  for (const a of isUtanOmrade().filter(x => _is.tilldelaValda.has(x.id))) {
    const mal = isOmradeMal(_is.projekt.get(a.projektId));
    const varde = _is.tilldela.get(a.id);
    if (!mal || !varde) continue;
    const andring = isHamtaAndring(a);
    andring.fore[mal.nyckel]  = isFore(a, [mal.nyckel])[mal.nyckel];
    andring.efter[mal.nyckel] = varde;
    lagda++;
  }
  _is.dialog = lagda ? 'granska' : null;
  isRita();
}

// Om ACC listar fältet som ändringsbart. Det är osäkert vad platsfälten heter i
// permittedAttributes, så det spärrar inte: nekar ACC syns det som fel efteråt.
function isFarAndraOmrade(a, mal) {
  return !a.tillatnaFalt.length || a.tillatnaFalt.includes(mal.faltNamn);
}

function isTilldelaOmradeHtml() {
  const lista = isUtanOmrade();
  const malPer = new Map([..._is.projekt.values()].map(p => [p.id, isOmradeMal(p)]));
  const medForslag = lista.filter(a => _is.tilldela.get(a.id)).length;
  const malText = [...new Set([...malPer.entries()].filter(([id]) => lista.some(a => a.projektId === id))
    .map(([id, m]) => `${_is.projekt.get(id).namn}: ${m ? m.titel : 'ingen källa att skriva till'}`))];

  return `
    ${isDialogHuvud(`Tilldela område · ${lista.length} ärenden utan område`,
      `Förslagen kommer från rubriken. ${medForslag} av ${lista.length} fick ett förslag. Skrivs till ${malText.join(' · ')}.`)}
    <div class="flex-1 overflow-y-auto px-3 py-2">
      ${lista.length ? `
        <table class="w-full text-sm">
          <thead class="text-[10px] uppercase tracking-wider text-ads-muted text-left sticky top-0 bg-white">
            <tr><th class="w-8 py-1.5"></th><th class="px-2">Ärende</th><th class="px-2">Område</th></tr>
          </thead>
          <tbody>
            ${lista.map(a => {
              const mal = malPer.get(a.projektId);
              const ref = isRef(a.id);
              const varde = _is.tilldela.get(a.id) || '';
              const forslag = isForeslaOmrade(a, mal);
              const far = mal && isFarAndraOmrade(a, mal);
              return `
                <tr class="border-t border-ads-border/60 align-top">
                  <td class="py-2 pl-1"><input id="is-tv-${a.id}" type="checkbox" class="accent-ads-blue"
                      ${_is.tilldelaValda.has(a.id) ? 'checked' : ''} ${mal ? '' : 'disabled'} onchange="isTilldelaMarkera(${ref}, this.checked)" /></td>
                  <td class="px-2 py-2">
                    <a href="${isLank(a)}" target="_blank" rel="noopener" class="font-mono text-xs text-ads-blue hover:underline">#${a.nr} ↗</a>
                    <span class="font-medium">${vkEsc(a.rubrik)}</span>
                    <div class="text-[11px] text-ads-muted">${vkEsc(a.projekt)} · ${isStatusLabel(a.status)}</div></td>
                  <td class="px-2 py-2 min-w-[240px]">
                    ${!mal ? '<span class="text-xs text-ads-muted italic">Ingen källa att skriva till i projektet</span>'
                      : `${far ? '' : '<div class="text-[10px] text-amber-700 mb-0.5" title="ACC listar inte fältet som ändringsbart för dig. Nekas ändringen syns det efter sparandet.">Kan nekas av ACC</div>'}
                         <select onchange="isTilldelaVal(${ref}, this.value)" class="w-full text-xs border border-ads-border rounded px-1.5 py-1 bg-white">
                           <option value="">– välj område –</option>
                           ${mal.alternativ.map(o => `<option value="${vkEsc(o.varde)}" ${o.varde === varde ? 'selected' : ''}>${vkEsc(o.namn)}${forslag?.varde === o.varde ? '  (förslag)' : ''}</option>`).join('')}
                         </select>
                         ${forslag ? '' : '<div class="text-[10px] text-ads-muted mt-0.5">Inget förslag i rubriken</div>'}`}
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>` : '<p class="p-6 text-center text-sm text-ads-muted">Alla clashärenden har ett område.</p>'}
    </div>
    <div class="px-5 py-3 border-t border-ads-border flex items-center gap-3">
      <button onclick="isTilldelaMarkeraAlla(true)" class="text-xs text-ads-blue hover:underline">Markera alla med område</button>
      <button onclick="isTilldelaMarkeraAlla(false)" class="text-xs text-ads-muted hover:text-ads-text">Avmarkera</button>
      <p class="text-[11px] text-ads-muted flex-1 text-right">Inget skrivs förrän du granskat och sparat.</p>
      <button onclick="isStangDialog()" class="text-sm text-ads-muted hover:text-ads-text px-3">Avbryt</button>
      <button id="is-tilldela-knapp" onclick="isLaggOmradenIListan()"
              class="bg-be-charcoal hover:bg-black text-white text-sm font-medium py-2 px-4 rounded">Lägg i ändringslistan (${_is.tilldelaValda.size})</button>
    </div>`;
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
        ${utan ? bhKnapp('isOppnaTilldela()', `Tilldela område (${utan} saknar)`) : ''}
        <label class="text-[11px] text-ads-muted flex items-center gap-1.5">Område från
          ${isOmradeValjare(isInst(), 'isValjOmradeKalla(this.value, false)', 'text-xs px-1.5 py-1 max-w-[420px]')}</label>
        ${bhKnapp('isExporteraOmraden()', 'Excel')}
      </div>
      ${isOmradeDiagnosHtml(utan, rader.reduce((s, r) => s + r.totalt, 0))}
      <div class="bg-white border border-ads-border rounded overflow-x-auto">${tabell}</div>
      <p class="text-[11px] text-ads-muted mt-2">
        Ett område släpar när minst 30 % av de öppna ärendena är förfallna eller äldre än ${isInst().gammalDagar} dagar (minst 3 st),
        eller när det hör till den fjärdedel som har flest öppna. Klicka på ett område för att se dess ärenden.
      </p>
    </div>`;
}

// Visas när en stor del saknar område: vad som finns i datan per projekt.
function isOmradeDiagnosHtml(utan, totalt) {
  if (!totalt || utan / totalt < 0.25) return '';
  const rader = isOmradeDiagnos();
  return `
    <details class="mb-3 p-2.5 rounded border border-amber-200 bg-amber-50 text-xs text-amber-900" ${utan / totalt > 0.5 ? 'open' : ''}>
      <summary class="cursor-pointer font-medium">${utan} av ${totalt} clashärenden saknar område. Varför?</summary>
      <table class="mt-2 w-full">
        <thead class="text-left text-[10px] uppercase tracking-wider text-amber-800">
          <tr><th class="py-1 pr-3">Projekt</th><th class="pr-3">Platsträdet</th><th class="pr-3">Ärenden med plats</th>
              <th class="pr-3">Plats saknas i trädet</th><th class="pr-3">Med fritext</th><th>Med egna fält</th></tr>
        </thead>
        <tbody>
          ${rader.map(d => `
            <tr class="border-t border-amber-200">
              <td class="py-1 pr-3">${vkEsc(d.projekt)}</td>
              <td class="pr-3">${d.platsFel ? `<span class="text-red-700">kunde inte läsas: ${vkEsc(d.platsFel)}</span>` : `${d.platser} platser`}</td>
              <td class="pr-3">${d.medPlatsId} av ${d.clash}</td>
              <td class="pr-3 ${d.utanTraff ? 'text-red-700 font-medium' : ''}">${d.utanTraff}</td>
              <td class="pr-3">${d.medText}</td>
              <td>${d.medFalt}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="mt-2 text-[11px]">Välj en annan källa i rullistan ovan om en annan källa har fler ärenden. Kan platsträdet inte läsas, skicka felet.</p>
    </details>`;
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
