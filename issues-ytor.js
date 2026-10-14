// issues-ytor.js — arbetsytorna i fliken Issues.
//
//   Start   kort per process med det som behöver göras
//   Admin   arbetsorder: öppna adminärenden sorterade efter hur bråttom de är
//   Clash   slutförda clashärenden med senaste kommentaren, för att stänga i
//           bulk eller skicka tillbaka inför samordningsmötet
//
// "Alla ärenden" är den tidigare dashboarden och ligger i issues.js.
// Reglerna för vad som är admin, clash och "vi" står i issues-las.js och kan
// ändras under Inställningar.

const IS_BRADSKA = {
  forfallet: { titel: 'Förfallna',          farg: '#DC2626', bg: 'bg-red-50',    ram: 'border-red-300' },
  snart:     { titel: 'Förfaller snart',    farg: '#EA580C', bg: 'bg-orange-50', ram: 'border-orange-300' },
  vecka:     { titel: 'Denna vecka',        farg: '#CA8A04', bg: 'bg-yellow-50', ram: 'border-yellow-300' },
  senare:    { titel: 'Senare',             farg: '#3d3d3d', bg: 'bg-white',     ram: 'border-ads-border' },
  utan:      { titel: 'Utan förfallodatum', farg: '#757575', bg: 'bg-white',     ram: 'border-ads-border' },
};

const IS_CLASH_LAGE = {
  redo:   { titel: 'Redo att stänga', hjalp: 'Tilldelat er: er roll, ert företag eller en person med e-post på er domän.', farg: 'bg-emerald-100 text-emerald-800' },
  delvis: { titel: 'Kommenterade',    hjalp: 'Projektören har kommenterat men inte tilldelat ärendet till er.', farg: 'bg-amber-100 text-amber-900' },
  ovrigt: { titel: 'Ej markerade',    hjalp: 'Varken tilldelat er eller kommenterat av projektören.', farg: 'bg-ads-gray text-ads-muted' },
};

function isSattYta(yta) {
  _is.yta = yta;
  _is.sok = '';
  isRita();
  if (yta === 'clash') { isLasClashKommentarer(); isKorModellkontroll(); }
}

// ── Urval ─────────────────────────────────────────────────────────────────────

function isAdminOppna() {
  return isAllaArenden().filter(a => isArAdmin(a) && !IS_KLARA.has(a.status));
}

function isClashSlutforda() {
  return isAllaArenden().filter(a => isArClash(a) && a.status === 'completed');
}

// ── Start ─────────────────────────────────────────────────────────────────────

function isStartHtml() {
  const admin = isAdminOppna();
  const oss   = admin.filter(isTilldeladOss);
  const rakna = (lista, b) => lista.filter(a => isBradska(a) === b).length;
  const clash = isClashSlutforda();
  const lasta = clash.every(a => !a.antalKommentarer || _is.kommentarer.has(a.id));
  const redo  = lasta ? clash.filter(a => isClashLage(a) === 'redo').length : null;
  const inst  = isInst();
  const process = text => isAllaArenden().filter(a => isArTyp(a, text) && !IS_KLARA.has(a.status));
  const onb   = process(inst.onboarding);
  const offb  = process(inst.offboarding);

  const kort = (onclick, titel, stor, under, rader, ton = '') => `
    <button onclick="${onclick}" class="bg-white border border-ads-border rounded p-5 text-left hover:border-ads-blue hover:shadow-sm transition-all ${ton}">
      <div class="text-sm font-semibold text-ads-text">${titel}</div>
      <div class="text-4xl font-semibold mt-2 text-ads-text">${stor}</div>
      <div class="text-xs text-ads-muted mt-0.5">${under}</div>
      ${rader ? `<div class="mt-3 pt-3 border-t border-ads-border/60 space-y-1 text-xs">${rader}</div>` : ''}
    </button>`;
  const rad = (farg, text, antal) => `
    <div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full shrink-0" style="background:${farg}"></span>
      <span class="flex-1">${text}</span><b class="font-mono">${antal}</b></div>`;
  const filtreraTyp = text => `isOppnaAllaMedTyp(${isRef(text)})`;

  return `
    <div class="px-5 py-5 grid md:grid-cols-2 xl:grid-cols-4 gap-4">
      ${kort("isSattYta('admin')", 'Admin · arbetsorder', rakna(oss, 'forfallet') + rakna(oss, 'snart'),
        `förfallna eller förfaller inom ${inst.snartDagar} dagar, tilldelat er`,
        rad(IS_BRADSKA.forfallet.farg, 'Förfallna', rakna(oss, 'forfallet')) +
        rad(IS_BRADSKA.snart.farg, `Inom ${inst.snartDagar} dagar`, rakna(oss, 'snart')) +
        rad(IS_BRADSKA.vecka.farg, 'Denna vecka', rakna(oss, 'vecka')) +
        rad('#9CA3AF', 'Öppna adminärenden totalt', admin.length),
        rakna(oss, 'forfallet') ? 'border-l-4 !border-l-red-500' : '')}
      ${kort("isSattYta('clash')", 'Clash · att godkänna', clash.length, 'slutförda clashärenden att gå igenom',
        rad('#10B981', 'Redo att stänga', redo ?? '…') +
        (_is.modellStatus?.klar
          ? rad('#059669', 'Löst i modellen', clash.filter(a => isModellLage(a) === 'lost').length) +
            rad('#DC2626', 'Slutförda men clashen finns kvar', clash.filter(a => isModellLage(a) === 'kvar').length)
          : '') +
        (redo == null ? '<div class="text-[11px] text-ads-muted italic">Räknas när kommentarerna lästs in</div>' : ''))}
      ${kort(filtreraTyp(inst.onboarding), 'Onboarding', onb.length, 'öppna ärenden om nya medlemmar',
        rad(IS_BRADSKA.forfallet.farg, 'Förfallna', onb.filter(isArForfallet).length) +
        '<div class="text-[11px] text-ads-muted italic">Eget arbetskort kommer i fas 3</div>')}
      ${kort(filtreraTyp(inst.offboarding), 'Offboarding', offb.length, 'öppna ärenden om medlemmar som ska bort',
        rad(IS_BRADSKA.forfallet.farg, 'Förfallna', offb.filter(isArForfallet).length) +
        '<div class="text-[11px] text-ads-muted italic">Eget arbetskort kommer i fas 3</div>')}
    </div>
    <p class="px-5 text-[11px] text-ads-muted">
      Vad som räknas som admin, clash och "er" ställs in under Inställningar uppe till höger.
    </p>`;
}

// Öppnar Alla ärenden filtrerat på en ärendetyp.
function isOppnaAllaMedTyp(ref) {
  _is.yta = 'alla';
  _is.vyId = 'alla';
  _is.filter = { status: null, forfallen: null, projekt: null };
  _is.kolFilter = { typ: _is.ref[ref] };
  isRita();
}

// ── Admin ─────────────────────────────────────────────────────────────────────

function isSattAdminVem(vem) {
  _is.adminVem = vem;
  isRita();
}

function isAdminUrval() {
  const alla = isAdminOppna();
  const q = _is.sok.trim().toLowerCase();
  return alla.filter(a =>
    (_is.adminVem === 'alla' || (_is.adminVem === 'oss') === isTilldeladOss(a)) &&
    (!q || [a.rubrik, a.typ, a.subtyp, a.tilldelad, String(a.nr), a.projekt].some(s => (s || '').toLowerCase().includes(q))));
}

function isAdminHtml() {
  const alla = isAdminOppna();
  const lista = isAdminUrval();
  const antalOss = alla.filter(isTilldeladOss).length;
  const chip = (vem, text, n) => `
    <button onclick="isSattAdminVem('${vem}')"
            class="text-xs px-3 py-1 rounded-full border ${_is.adminVem === vem ? 'bg-be-charcoal text-white border-be-charcoal' : 'bg-white border-ads-border hover:border-ads-blue'}">
      ${text} <span class="font-mono opacity-70">${n}</span></button>`;

  const sektioner = Object.keys(IS_BRADSKA).map(b => {
    const rader = lista.filter(a => isBradska(a) === b)
      .sort((x, y) => (x.forfaller || '9').localeCompare(y.forfaller || '9') || x.nr - y.nr);
    if (!rader.length) return '';
    const s = IS_BRADSKA[b];
    return `
      <section class="mb-4">
        <h3 class="text-sm font-semibold mb-1.5 flex items-center gap-2" style="color:${s.farg}">
          ${s.titel} <span class="font-mono text-xs text-ads-muted">${rader.length}</span></h3>
        <div class="bg-white border ${s.ram} rounded overflow-x-auto">
          <table class="w-full text-sm">
            <tbody>${rader.map(a => isAdminRadHtml(a, s)).join('')}</tbody>
          </table>
        </div>
      </section>`;
  }).join('');

  return `
    <div class="px-5 py-4">
      <div class="flex items-center gap-2 flex-wrap mb-4">
        ${chip('oss', 'Tilldelat er', antalOss)}
        ${chip('andra', 'Väntar på andra', alla.length - antalOss)}
        ${chip('alla', 'Alla', alla.length)}
        <div class="flex-1"></div>
        <input type="search" placeholder="Sök…" value="${vkEsc(_is.sok)}" oninput="isSokYta(this.value)"
               class="px-2.5 py-1 text-sm border border-ads-border rounded w-56 focus:outline-none focus:ring-1 focus:ring-ads-blue" />
        ${bhKnapp('isExporteraAdmin()', 'Excel')}
      </div>
      ${sektioner || '<p class="p-8 text-center text-sm text-ads-muted">Inga öppna adminärenden här.</p>'}
      <p class="text-[11px] text-ads-muted">Status, tilldelning och förfallodatum ändras direkt i listan och sparas via Granska och spara längst ner.</p>
    </div>`;
}

function isAdminRadHtml(a, s) {
  const ref = isRef(a);
  const d   = isDagarKvar(a.forfaller);
  const dagText = d == null ? '' : d < 0 ? `${-d} d sen` : d === 0 ? 'idag' : d === 1 ? 'i morgon' : `om ${d} d`;
  return `
    <tr class="border-t border-ads-border/60 first:border-t-0 ${isVantande(a) ? 'bg-amber-50/60' : ''}">
      <td class="pl-3 pr-2 py-2 w-20 whitespace-nowrap text-xs font-semibold" style="color:${s.farg}">${dagText}</td>
      <td class="px-2 py-2 w-16 whitespace-nowrap font-mono text-xs">
        <a href="${isLank(a)}" target="_blank" rel="noopener" class="text-ads-blue hover:underline" title="Öppna i ACC">#${a.nr} ↗</a></td>
      <td class="px-2 py-2 min-w-[220px]">
        <div class="font-medium">${vkEsc(a.rubrik)}</div>
        <div class="text-[11px] text-ads-muted">${vkEsc(a.subtyp || a.typ)} · ${vkEsc(a.projekt)}</div></td>
      <td class="px-2 py-2">${isStatusCell(a, ref, true)}</td>
      <td class="px-2 py-2 text-xs">${isTilldeladCell(a, ref, true)}</td>
      <td class="px-2 py-2 pr-3">${isForfallerCell(a, ref, true)}</td>
    </tr>`;
}

function isSokYta(text) {
  _is.sok = text;
  // Ytorna är enkla nog att ritas om helt, men fokus ska stanna i sökfältet.
  const pos = document.activeElement?.selectionStart;
  isRita();
  const falt = document.querySelector('input[oninput^="isSokYta"]');
  if (falt) { falt.focus(); if (pos != null) falt.setSelectionRange(pos, pos); }
}

function isExporteraAdmin() {
  const aoa = [['Brådska', 'Dagar', 'Nr', 'Rubrik', 'Ärendetyp', 'Status', 'Tilldelad till', 'Förfaller', 'Projekt', 'Länk']];
  for (const b of Object.keys(IS_BRADSKA)) {
    for (const a of isAdminUrval().filter(x => isBradska(x) === b)) {
      aoa.push([IS_BRADSKA[b].titel, isDagarKvar(a.forfaller) ?? '', a.nr, a.rubrik, a.subtyp || a.typ,
                isStatusLabel(a.status), a.tilldelad, a.forfaller, a.projekt, isLank(a)]);
    }
  }
  isSparaXlsx(aoa, 'Arbetsorder', `admin_arbetsorder_${new Date().toISOString().slice(0, 10)}.xlsx`,
    [16, 7, 7, 44, 22, 11, 26, 11, 26, 60]);
}

function isSparaXlsx(aoa, blad, filnamn, bredder) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = bredder.map(wch => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, blad);
  bhLaddaNer(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]), filnamn);
}

// ── Clash ─────────────────────────────────────────────────────────────────────

async function isLasClashKommentarer() {
  const lista = isClashSlutforda();
  if (_is.clashLaddar || lista.every(a => !a.antalKommentarer || _is.kommentarer.get(a.id)?.uppdaterat === a.uppdaterat)) return;
  _is.clashLaddar = { klara: 0, totalt: 0 };
  isRita();
  await isLasKommentarer(lista, (klara, totalt) => {
    _is.clashLaddar = { klara, totalt };
    const el = document.getElementById('is-clash-framsteg');
    if (el) el.textContent = `Läser senaste kommentaren… ${klara} av ${totalt}`;
  });
  _is.clashLaddar = null;
  if (_is.yta === 'clash' || _is.yta === 'start') isRita();
}

function isSattClashLage(lage) {
  _is.clashLage = lage;
  isRita();
}

function isClashUrval() {
  const q = _is.sok.trim().toLowerCase();
  return isClashSlutforda().filter(a =>
    (_is.clashLage === 'alla' || isClashLage(a) === _is.clashLage) &&
    (_is.modellFilter === 'alla' || isModellLage(a) === _is.modellFilter) &&
    (!q || [a.rubrik, a.tilldelad, String(a.nr), a.projekt, isKommentarText(isSenasteKommentar(a)?.text), isSenasteKommentar(a)?.av]
      .some(s => (s || '').toLowerCase().includes(q))));
}

function isMarkeraClash(ref, pa) {
  const id = _is.ref[ref];
  if (pa) _is.clashValda.add(id); else _is.clashValda.delete(id);
  const el = document.getElementById('is-clash-knapp');
  if (el) el.outerHTML = isClashKnappHtml();
}

function isMarkeraAllaClash(pa) {
  for (const a of isClashUrval()) if (pa) _is.clashValda.add(a.id); else _is.clashValda.delete(a.id);
  isRita();
}

// Lägger "Stängd" på de markerade ärendena i ändringslistan och öppnar granskningen.
function isStangValdaClash() {
  let lagda = 0, nekade = 0;
  for (const a of isClashSlutforda().filter(x => _is.clashValda.has(x.id))) {
    if (isForeslaStatus(a, 'closed')) lagda++; else nekade++;
  }
  _is.clashValda = new Set();
  if (nekade) alert(`${nekade} av ärendena kan du inte stänga enligt ACC. De togs inte med.`);
  if (lagda) _is.dialog = 'granska';
  isRita();
}

function isClashKnappHtml() {
  const n = _is.clashValda.size;
  return `<button id="is-clash-knapp" onclick="isStangValdaClash()" ${n ? '' : 'disabled'}
                  class="bg-be-charcoal hover:bg-black text-white text-xs font-medium py-1.5 px-3 rounded disabled:opacity-40">
            Stäng markerade${n ? ` (${n})` : ''}</button>`;
}

function isClashHtml() {
  const alla  = isClashSlutforda();
  const lista = isClashUrval().sort((x, y) => ['redo', 'delvis', 'ovrigt'].indexOf(isClashLage(x)) - ['redo', 'delvis', 'ovrigt'].indexOf(isClashLage(y)) || x.nr - y.nr);
  const antal = l => alla.filter(a => isClashLage(a) === l).length;
  const chip = (lage, text, n) => `
    <button onclick="isSattClashLage('${lage}')" title="${IS_CLASH_LAGE[lage]?.hjalp || ''}"
            class="text-xs px-3 py-1 rounded-full border ${_is.clashLage === lage ? 'bg-be-charcoal text-white border-be-charcoal' : 'bg-white border-ads-border hover:border-ads-blue'}">
      ${text} <span class="font-mono opacity-70">${n}</span></button>`;
  const laddar = _is.clashLaddar
    ? `<div class="mb-3 text-xs text-ads-muted" id="is-clash-framsteg">Läser senaste kommentaren… ${_is.clashLaddar.klara} av ${_is.clashLaddar.totalt || '?'}</div>` : '';

  return `
    <div class="px-5 py-4">
      <div class="flex items-center gap-2 flex-wrap mb-3">
        ${chip('redo', 'Redo att stänga', antal('redo'))}
        ${chip('delvis', 'Kommenterade', antal('delvis'))}
        ${chip('ovrigt', 'Ej markerade', antal('ovrigt'))}
        ${chip('alla', 'Alla slutförda', alla.length)}
        <div class="flex-1"></div>
        <input type="search" placeholder="Sök rubrik, kommentar…" value="${vkEsc(_is.sok)}" oninput="isSokYta(this.value)"
               class="px-2.5 py-1 text-sm border border-ads-border rounded w-56 focus:outline-none focus:ring-1 focus:ring-ads-blue" />
        ${bhKnapp('isExporteraClash()', 'Underlag till möte')}
      </div>
      ${laddar}
      ${isModellFilterHtml(alla)}
      <div class="bg-white border border-ads-border rounded">
        <div class="px-3 py-2 border-b border-ads-border flex items-center gap-3">
          <label class="flex items-center gap-1.5 text-xs cursor-pointer">
            <input type="checkbox" onchange="isMarkeraAllaClash(this.checked)" class="accent-ads-blue"
                   ${lista.length && lista.every(a => _is.clashValda.has(a.id)) ? 'checked' : ''} /> Markera alla i listan</label>
          <div class="flex-1"></div>
          ${isClashKnappHtml()}
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-[11px] text-ads-muted text-left bg-ads-gray/60">
              <tr><th class="w-8"></th><th class="px-2 py-2">Ärende</th><th class="px-2">Läge</th><th class="px-2">Tilldelad till</th>
                  <th class="px-2">Modell</th><th class="px-2">Senaste kommentar</th><th class="px-2"></th></tr>
            </thead>
            <tbody>
              ${lista.length ? lista.map(isClashRadHtml).join('')
                : '<tr><td colspan="7" class="p-8 text-center text-sm text-ads-muted">Inga slutförda clashärenden här.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <p class="text-[11px] text-ads-muted mt-2">
        Stängningar och återöppningar sparas via Granska och spara längst ner, och kan återställas från Historik.
        En kommentar som skickats med "Skicka tillbaka" ligger dock kvar i ACC.
      </p>
    </div>`;
}

function isClashRadHtml(a) {
  const ref  = isRef(a);
  const k    = isSenasteKommentar(a);
  const lage = IS_CLASH_LAGE[isClashLage(a)];
  const vant = isVantande(a);
  const kanStanga = a.tillatnaStatusar.includes('closed') && isFarAndra(a, 'status');
  return `
    <tr class="border-t border-ads-border/60 align-top ${vant ? 'bg-amber-50/60' : ''}">
      <td class="pl-3 py-2">
        <input type="checkbox" ${_is.clashValda.has(a.id) ? 'checked' : ''} ${kanStanga && !vant ? '' : 'disabled'}
               onchange="isMarkeraClash(${isRef(a.id)}, this.checked)" class="accent-ads-blue"
               title="${kanStanga ? '' : 'ACC tillåter inte att du stänger ärendet'}" /></td>
      <td class="px-2 py-2 min-w-[220px]">
        <a href="${isLank(a)}" target="_blank" rel="noopener" class="font-mono text-xs text-ads-blue hover:underline">#${a.nr} ↗</a>
        <span class="font-medium">${vkEsc(a.rubrik)}</span>
        <div class="text-[11px] text-ads-muted">${vkEsc(a.projekt)}${a.forfaller ? ` · förföll ${a.forfaller}` : ''}</div></td>
      <td class="px-2 py-2"><span class="text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${lage.farg}" title="${lage.hjalp}">${lage.titel}</span>
        ${vant ? `<div class="mt-1">${isStatusTagg(vant.efter.status, true)}</div>` : ''}</td>
      <td class="px-2 py-2 text-xs">${vkEsc(a.tilldelad)}</td>
      <td class="px-2 py-2">${isModellCellHtml(a)}</td>
      <td class="px-2 py-2 text-xs max-w-[380px]">
        ${k ? `<div class="text-ads-muted text-[11px]">${vkEsc(k.av)} · ${k.tid}${a.antalKommentarer > 1 ? ` · ${a.antalKommentarer} kommentarer` : ''}</div>
               <div class="line-clamp-2" title="${vkEsc(isKommentarText(k.text))}">${isKommentarHtml(k.text)}</div>`
            : a.antalKommentarer ? '<span class="text-ads-muted italic">läses in…</span>' : '<span class="text-ads-muted italic">Ingen kommentar</span>'}</td>
      <td class="px-2 py-2 pr-3 text-right whitespace-nowrap">
        ${vant ? `<button onclick="isAngra(${isRef(a.id)})" class="text-xs text-ads-muted hover:text-red-700">Ångra</button>`
               : `<button onclick="isSkickaTillbaka(${ref})" class="text-xs border border-ads-border rounded px-2 py-0.5 hover:border-red-400">Skicka tillbaka…</button>`}
      </td>
    </tr>`;
}

function isExporteraClash() {
  const aoa = [['Läge', 'Nr', 'Rubrik', 'Projekt', 'Tilldelad till', 'Modellkontroll', 'Clashar kvar', 'Senaste kommentar av', 'Kommenterat', 'Senaste kommentar', 'Väntande ändring', 'Länk']];
  for (const a of isClashUrval()) {
    const k = isSenasteKommentar(a);
    const v = isVantande(a);
    aoa.push([IS_CLASH_LAGE[isClashLage(a)].titel, a.nr, a.rubrik, a.projekt, a.tilldelad, IS_MODELL_LAGE[isModellLage(a)].titel, isModellResultat(a) ? isModellResultat(a).kvar : '', k?.av || '', k?.tid || '', isKommentarText(k?.text),
              v ? `${isStatusLabel(v.efter.status)}${v.kommentar ? `: ${v.kommentar}` : ''}` : '', isLank(a)]);
  }
  isSparaXlsx(aoa, 'Clash att godkänna', `clash_underlag_${new Date().toISOString().slice(0, 10)}.xlsx`,
    [16, 7, 40, 26, 24, 18, 8, 22, 16, 60, 30, 60]);
}

// Filter på vad modellkontrollen visar, plus status för senaste kontrollen.
function isSattModellFilter(f) {
  _is.modellFilter = f;
  isRita();
}

function isModellFilterHtml(alla) {
  const antal = l => alla.filter(a => isModellLage(a) === l).length;
  const chip = (f, text, n) => `
    <button onclick="isSattModellFilter('${f}')"
            class="text-[11px] px-2.5 py-0.5 rounded-full border ${_is.modellFilter === f ? 'bg-ads-blue text-white border-ads-blue' : 'bg-white border-ads-border hover:border-ads-blue'}">
      ${text}${n != null ? ` <span class="font-mono opacity-70">${n}</span>` : ''}</button>`;
  return `
    <div class="flex items-center gap-1.5 flex-wrap mb-3 text-xs">
      <span class="text-ads-muted mr-1">Modellkontroll:</span>
      ${chip('alla', 'Alla')}
      ${chip('lost', '✓ Löst i modellen', antal('lost'))}
      ${chip('delvis', '◐ Delvis löst', antal('delvis'))}
      ${chip('kvar', '✕ Finns kvar', antal('kvar'))}
      ${chip('ingenNy', 'Ej omkörd', antal('ingenNy'))}
      ${chip('okand', 'Ej kopplad', antal('okand'))}
      <span id="is-modell-status" class="ml-2">${isModellStatusHtml()}</span>
    </div>`;
}

// ── Inställningar ─────────────────────────────────────────────────────────────

function isInstFalt(nyckel, varde) {
  _is.instUtkast[nyckel] = typeof IS_STANDARDINST[nyckel] === 'number' ? Math.max(0, parseInt(varde, 10) || 0) : varde;
}

function isSparaInst() {
  _is.inst = { ..._is.instUtkast };
  isLagra('is-inst', _is.inst);
  _is.dialog = null;
  isRita();
  if (_is.yta === 'clash') isLasClashKommentarer();
}

function isStandardInst() {
  _is.instUtkast = { ...IS_STANDARDINST };
  isRita();
}

function isInstHtml() {
  const u = _is.instUtkast;
  const typer = new Map();
  for (const a of isAllaArenden()) {
    const t = a.subtyp && a.subtyp !== a.typ ? `${a.typ} › ${a.subtyp}` : a.typ;
    if (t) typer.set(t, (typer.get(t) || 0) + 1);
  }
  const falt = (nyckel, etikett, hjalp) => `
    <label class="block mb-3">
      <span class="text-xs font-medium text-ads-text">${etikett}</span>
      <input value="${vkEsc(u[nyckel])}" oninput="isInstFalt('${nyckel}', this.value)"
             class="mt-1 w-full px-2 py-1.5 text-sm border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue" />
      <span class="text-[11px] text-ads-muted">${hjalp}</span>
    </label>`;
  return `
    ${isDialogHuvud('Inställningar för arbetsytorna', 'Delar av namn räcker. Flera värden separeras med komma.')}
    <div class="flex-1 overflow-y-auto px-5 py-4 grid md:grid-cols-2 gap-x-6">
      <div>
        ${falt('oss', 'Vi (roll eller företag)', 'Avgör "Tilldelat er" i Admin och "Redo att stänga" i Clash.')}
        ${falt('ossDomaner', 'Våra e-postdomäner', 'En person med e-post på någon av dessa räknas också som "er".')}
        ${falt('adminTyp', 'Ärendetyper som är admin', 'Matchas mot ärendetyp och subtyp.')}
        ${falt('clashTyp', 'Ärendetyper som är clash', 'Matchas mot ärendetyp och subtyp.')}
      </div>
      <div>
        ${falt('onboarding', 'Ärendetyper för onboarding', '')}
        ${falt('offboarding', 'Ärendetyper för offboarding', '')}
        ${falt('snartDagar', 'Förfaller snart: inom antal dagar', '')}
        ${falt('veckaDagar', 'Denna vecka: inom antal dagar', '')}
      </div>
      ${typer.size ? `
        <div class="md:col-span-2 mt-2 pt-3 border-t border-ads-border">
          <div class="text-[10px] uppercase tracking-wider text-ads-muted mb-1.5">Ärendetyper i de hämtade projekten</div>
          <div class="flex flex-wrap gap-1.5">
            ${[...typer.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) =>
              `<span class="text-[11px] px-2 py-0.5 rounded bg-ads-gray">${vkEsc(t)} <span class="text-ads-muted">${n}</span></span>`).join('')}
          </div>
        </div>` : ''}
    </div>
    <div class="px-5 py-3 border-t border-ads-border flex items-center gap-3">
      <button onclick="isStandardInst()" class="text-xs text-ads-muted hover:text-ads-text">Återställ standard</button>
      <p class="text-[11px] text-ads-muted flex-1">Sparas i den här webbläsaren.</p>
      <button onclick="isStangDialog()" class="text-sm text-ads-muted hover:text-ads-text px-3">Avbryt</button>
      <button onclick="isSparaInst()" class="bg-be-charcoal hover:bg-black text-white text-sm font-medium py-2 px-4 rounded">Spara</button>
    </div>`;
}
