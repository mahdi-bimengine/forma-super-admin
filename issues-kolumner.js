// issues-kolumner.js — tabellens kolumner i "Alla ärenden".
//
// Vilka kolumner som visas och i vilken ordning väljs under "Kolumner" och
// sparas i webbläsaren per konto. Projektens egna fält kan också visas, med
// namnet som nyckel ("eget:Disciplin"), eftersom samma fält har olika id i
// olika projekt.
//
// sok anger filtret under rubriken: text (sökruta), lista (sökruta med förslag),
// typ (rullista med projektens ärendetyper), status och dagar (rullistor).

const IS_KOLUMNER = [
  { k: 'nr',         namn: 'Nr',               fast: true, sok: 'text',  plats: 'Nr', hoger: true },
  { k: 'typ',        namn: 'Ärendetyp',        sok: 'typ' },
  { k: 'rubrik',     namn: 'Rubrik',           fast: true, sok: 'text',  plats: 'Sök rubrik…' },
  { k: 'status',     namn: 'Status',           sok: 'status' },
  { k: 'tilldelad',  namn: 'Tilldelad till',   sok: 'lista', plats: 'Sök tilldelad…' },
  { k: 'foretag',    namn: 'Företag',          sok: 'lista', hjalp: 'Den tilldelade personens företag' },
  { k: 'bevakare',   namn: 'Bevakare',         sok: 'text' },
  { k: 'skapadAv',   namn: 'Skapad av',        sok: 'lista' },
  { k: 'skapat',     namn: 'Skapat',           sok: 'text',  plats: 'ÅÅÅÅ-MM' },
  { k: 'start',      namn: 'Startdatum',       sok: 'text',  plats: 'ÅÅÅÅ-MM' },
  { k: 'forfaller',  namn: 'Förfaller',        sok: 'text',  plats: 'ÅÅÅÅ-MM' },
  { k: 'dagar',      namn: 'Dagar',            sok: 'dagar', hoger: true },
  { k: 'grundorsak', namn: 'Grundorsak',       sok: 'lista' },
  { k: 'location',   namn: 'Location',         sok: 'lista', plats: 'Sök plats…' },
  { k: 'platsText',  namn: 'Platsbeskrivning', sok: 'text' },
  { k: 'projekt',    namn: 'Projekt',          sok: 'lista', plats: 'Sök projekt…' },
];

const IS_STANDARDKOLUMNER = ['nr', 'typ', 'rubrik', 'status', 'tilldelad', 'skapadAv', 'skapat', 'forfaller', 'dagar', 'location', 'projekt'];

// Alla kolumner som går att välja: de fasta och de egna fälten i de inlästa
// projekten.
function isAllaKolumner() {
  const egna = new Set();
  for (const p of _is.projekt.values()) for (const d of p.faltDef || []) if (d.title) egna.add(d.title);
  return [
    ...IS_KOLUMNER,
    ...[...egna].sort((a, b) => a.localeCompare(b, 'sv')).map(t => ({ k: `eget:${t}`, namn: t, sok: 'lista', eget: true })),
  ];
}

function isKolumnval() {
  if (!_is.kolumner) _is.kolumner = isHamtaLagrat('is-kolumner') || [...IS_STANDARDKOLUMNER];
  return _is.kolumner;
}

// De kolumner som visas, i vald ordning. Ett eget fält som inte finns i något
// inläst projekt hoppas över men står kvar i valet.
function isSynligaKolumner() {
  const alla = new Map(isAllaKolumner().map(k => [k.k, k]));
  const val = isKolumnval().filter(k => alla.has(k));
  for (const k of IS_KOLUMNER) if (k.fast && !val.includes(k.k)) val.unshift(k.k);
  return val.map(k => alla.get(k));
}

function isKolumnNamn(k) {
  return isAllaKolumner().find(x => x.k === k)?.namn || k;
}

// Texten en kolumn söks, sorteras och visas med.
function isKolumnText(k, a) {
  if (k.startsWith('eget:')) return a.egnaFalt?.[k.slice(5)] || '';
  switch (k) {
    case 'nr':         return String(a.nr);
    case 'typ':        return `${a.typ} ${a.subtyp}`;
    case 'status':     return isStatusLabel(a.status);
    case 'bevakare':   return (a.bevakare || []).map(isNamnPaId).join(', ');
    case 'dagar':      return String(isDagarKvar(a.forfaller) ?? '');
    case 'location':   return isLocation(a);
    case 'foretag':    return a.tilldeladForetag || '';
    case 'grundorsak': return a.grundorsak || '';
    case 'platsText':  return a.platsText || '';
    default:           return String(a[k] ?? '');
  }
}

// ── Ärendetyper ───────────────────────────────────────────────────────────────

// Ärendetyperna som de är uppsatta i de inlästa projekten, med undertyper.
// Samma namn i flera projekt räknas som en.
function isTypAlternativ() {
  const typer = new Map();
  for (const p of _is.projekt.values()) {
    for (const t of p.typer || []) {
      if (t.isActive === false) continue;
      if (!typer.has(t.title)) typer.set(t.title, new Set());
      for (const s of t.subtypes || []) if (s.isActive !== false) typer.get(t.title).add(s.title);
    }
  }
  return [...typer.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'sv'))
    .map(([typ, under]) => ({ typ, under: [...under].sort((a, b) => a.localeCompare(b, 'sv')) }));
}

// Filtret är en hel typ ("Clash") eller en undertyp ("Clash › Clash"). Ett
// värde utan › kan också komma från ett klick på en undertyp i tabellen.
function isMatcharTyp(a, varde) {
  if (varde.includes(' › ')) return `${a.typ} › ${a.subtyp}` === varde;
  return a.typ === varde || a.subtyp === varde;
}

// ── Kolumnväljaren ────────────────────────────────────────────────────────────

function isVaxlaKolumnmeny() {
  _is.kolMeny = !_is.kolMeny;
  isRita();
}

function isVisaKolumn(k, pa) {
  let val = isKolumnval().filter(x => x !== k);
  if (pa) {
    // En ny kolumn hamnar där den står i standardordningen, annars sist.
    const ordning = isAllaKolumner().map(x => x.k);
    const plats = val.findIndex(x => ordning.indexOf(x) > ordning.indexOf(k));
    if (plats < 0) val.push(k); else val.splice(plats, 0, k);
  } else {
    // Ett filter på en dold kolumn skulle inte synas, så det tas bort.
    delete _is.kolFilter[k];
    if (k === 'tilldelad') { delete _is.kolFilter.tilldeladTyp; delete _is.kolFilter.tilldeladVia; }
    if (_is.sortering.kol === k) _is.sortering = { kol: 'forfaller', upp: true };
  }
  isSparaKolumner(val);
}

function isFlyttaKolumn(k, steg) {
  const val = [...isKolumnval()];
  const i = val.indexOf(k), j = i + steg;
  if (i < 0 || j < 0 || j >= val.length) return;
  [val[i], val[j]] = [val[j], val[i]];
  isSparaKolumner(val);
}

function isStandardKolumner() {
  const tilldelning = ['tilldeladTyp', 'tilldeladVia'];
  for (const k of Object.keys(_is.kolFilter)) if (!IS_STANDARDKOLUMNER.includes(k) && !tilldelning.includes(k)) delete _is.kolFilter[k];
  isSparaKolumner([...IS_STANDARDKOLUMNER]);
}

function isSparaKolumner(val) {
  _is.kolumner = val;
  isLagra('is-kolumner', val);
  isRita();
}

function isKolumnmenyHtml() {
  const val = isKolumnval();
  const alla = isAllaKolumner();
  const synliga = isSynligaKolumner();
  const rad = (k, visas) => {
    const i = synliga.findIndex(x => x.k === k.k);
    const pil = (steg, tecken, av) => `<button onclick="isFlyttaKolumn(_is.ref[${isRef(k.k)}], ${steg})" ${av ? 'disabled' : ''}
        class="px-1 text-ads-muted hover:text-ads-text disabled:opacity-20">${tecken}</button>`;
    return `
      <div class="flex items-center gap-2 px-3 py-1 hover:bg-ads-gray">
        <label class="flex items-center gap-2 flex-1 min-w-0 text-sm ${k.fast ? 'text-ads-muted' : 'cursor-pointer'}">
          <input type="checkbox" ${visas ? 'checked' : ''} ${k.fast ? 'disabled' : ''}
                 onchange="isVisaKolumn(_is.ref[${isRef(k.k)}], this.checked)" class="accent-ads-blue" />
          <span class="truncate">${vkEsc(k.namn)}</span></label>
        ${visas && !k.fast && val.includes(k.k) ? `${pil(-1, '▲', i <= 0)}${pil(1, '▼', i >= synliga.length - 1)}` : ''}
      </div>`;
  };
  const visade = synliga;
  const dolda = alla.filter(k => !synliga.some(x => x.k === k.k));
  return `
    <div class="absolute right-0 top-full mt-1 z-30 w-72 bg-white border border-ads-border rounded shadow-lg text-sm">
      <div class="px-3 pt-2.5 pb-1 flex items-center">
        <span class="font-semibold text-xs uppercase tracking-wider text-ads-muted flex-1">Kolumner</span>
        <button onclick="isVaxlaKolumnmeny()" class="text-ads-muted hover:text-ads-text px-1">✕</button>
      </div>
      <div class="max-h-[420px] overflow-y-auto pb-1">
        <div class="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-ads-muted">Visas, i denna ordning</div>
        ${visade.map(k => rad(k, true)).join('')}
        ${dolda.filter(k => !k.eget).length ? `
          <div class="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-ads-muted border-t border-ads-border mt-1">Fler kolumner</div>
          ${dolda.filter(k => !k.eget).map(k => rad(k, false)).join('')}` : ''}
        ${dolda.filter(k => k.eget).length ? `
          <div class="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-ads-muted border-t border-ads-border mt-1">Egna fält i projekten</div>
          ${dolda.filter(k => k.eget).map(k => rad(k, false)).join('')}` : ''}
      </div>
      <div class="px-3 py-2 border-t border-ads-border bg-ads-gray/50 flex items-center">
        <span class="text-[11px] text-ads-muted flex-1">Valet sparas i den här webbläsaren.</span>
        <button onclick="isStandardKolumner()" class="text-xs text-ads-blue hover:underline">Återställ</button>
      </div>
    </div>`;
}

// ── Tabellens delar per kolumn ────────────────────────────────────────────────

function isKolumnRubrikHtml(k) {
  const { kol, upp } = _is.sortering;
  const th = `
    <th class="px-2 pt-2 pb-1 font-semibold cursor-pointer select-none whitespace-nowrap ${k.hoger ? 'text-right' : ''}"
        onclick="isSortera(_is.ref[${isRef(k.k)}])" ${k.hjalp ? `title="${vkEsc(k.hjalp)}"` : ''}>
      ${vkEsc(k.namn)}${kol === k.k ? (upp ? ' ▲' : ' ▼') : ''}</th>`;
  // Nr följs av en smal kolumn med länken till ACC.
  return k.k === 'nr' ? th + '<th class="px-2"></th>' : th;
}

function isKolumnSokHtml(k, vy) {
  const v = _is.kolFilter[k.k] || '';
  const ram = v ? 'border-ads-blue' : 'border-ads-border';
  const ref = isRef(k.k);
  const valj = (alternativ, extra = '') => `
    <th class="px-1.5 pb-2 font-normal">
      <select onchange="isKolumnSok(_is.ref[${ref}], this.value)"
              class="w-full min-w-[70px] px-1 py-0.5 text-xs font-normal border rounded bg-white ${ram}">
        <option value="">Alla</option>${extra}${alternativ}
      </select>
    </th>`;

  let ut;
  if (k.sok === 'status') {
    ut = valj(IS_STATUS_ORDNING.filter(s => vy.some(a => a.status === s))
      .map(s => `<option value="${s}" ${v === s ? 'selected' : ''}>${isStatusLabel(s)}</option>`).join(''));
  } else if (k.sok === 'dagar') {
    ut = valj(Object.entries(IS_DAGAR_VAL).map(([d, x]) => `<option value="${d}" ${v === d ? 'selected' : ''}>${x.text}</option>`).join(''));
  } else if (k.sok === 'typ') {
    const typer = isTypAlternativ();
    const finns = typer.some(t => t.typ === v || t.under.some(u => `${t.typ} › ${u}` === v));
    ut = valj(typer.map(t => `
      <optgroup label="${vkEsc(t.typ)}">
        <option value="${vkEsc(t.typ)}" ${v === t.typ ? 'selected' : ''}>Alla ${vkEsc(t.typ)}</option>
        ${t.under.map(u => `<option value="${vkEsc(`${t.typ} › ${u}`)}" ${v === `${t.typ} › ${u}` ? 'selected' : ''}>${vkEsc(u)}</option>`).join('')}
      </optgroup>`).join(''), v && !finns ? `<option value="${vkEsc(v)}" selected>${vkEsc(v)}</option>` : '');
  } else if (k.k === 'tilldelad') {
    // Sökning på namn, typ av tilldelning och om en person också ska träffa
    // ärenden på personens roller och företag (isTilldeladViaMatchar).
    const f = _is.kolFilter;
    ut = `
      <th class="px-1.5 pb-2 font-normal align-top">
        <input type="search" value="${vkEsc(v)}" placeholder="${vkEsc(k.plats)}" oninput="isKolumnSok('tilldelad', this.value)"
               list="is-dl-tilldelad"
               class="w-full min-w-[60px] px-1.5 py-0.5 text-xs font-normal border rounded bg-white focus:outline-none focus:ring-1 focus:ring-ads-blue ${ram}" />
        <select onchange="isKolumnSok('tilldeladTyp', this.value)" title="Typ av tilldelning"
                class="mt-1 w-full px-1 py-0.5 text-xs font-normal border rounded bg-white ${f.tilldeladTyp ? 'border-ads-blue' : 'border-ads-border'}">
          <option value="">Alla typer</option>
          ${IS_TILLDELAD_TYP.map(([t, namn]) => `<option value="${t}" ${f.tilldeladTyp === t ? 'selected' : ''}>${namn}</option>`).join('')}
        </select>
        <label class="mt-1 flex items-center gap-1 text-[10px] text-ads-muted whitespace-nowrap cursor-pointer"
               title="En sökning på en person träffar också ärenden som är tilldelade personens roller och företag">
          <input type="checkbox" class="accent-ads-blue" ${f.tilldeladVia ? 'checked' : ''} onchange="isVaxlaTilldeladVia(this.checked)" />
          även via roll och företag</label>
      </th>`;
  } else {
    ut = `
      <th class="px-1.5 pb-2 font-normal">
        <input type="search" value="${vkEsc(v)}" placeholder="${vkEsc(k.plats || 'Sök…')}" oninput="isKolumnSok(_is.ref[${ref}], this.value)"
               ${k.sok === 'lista' ? `list="is-dl-${vkEsc(k.k)}"` : ''}
               class="w-full min-w-[60px] px-1.5 py-0.5 text-xs font-normal border rounded bg-white focus:outline-none focus:ring-1 focus:ring-ads-blue ${ram}" />
      </th>`;
  }
  return k.k === 'nr' ? ut + '<th></th>' : ut;
}

// Förslag i sökfälten: de värden som finns i vyn.
function isKolumnDatalista(k, vy) {
  const varden = k.k === 'bevakare' ? vy.flatMap(a => (a.bevakare || []).map(isNamnPaId)) : vy.map(a => isKolumnText(k.k, a));
  return `
    <datalist id="is-dl-${vkEsc(k.k)}">
      ${[...new Set(varden.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv')).map(x => `<option value="${vkEsc(x)}">`).join('')}
    </datalist>`;
}

function isKolumnCellHtml(k, a, ref, klick) {
  switch (k.k) {
    case 'nr':
      return `<td class="px-2 py-1.5 text-right font-mono text-xs">${a.nr}</td>
              <td class="px-1"><a href="${isLank(a)}" target="_blank" rel="noopener" class="text-ads-blue" title="Öppna i ACC">↗</a></td>`;
    case 'typ': {
      const typ = a.subtyp || a.typ;
      return `<td class="px-2 py-1.5 text-xs">${klick('typ', typ)}${a.subtyp && a.typ && a.subtyp !== a.typ
        ? `<div class="text-[10px] text-ads-muted">${klick('typ', a.typ)}</div>` : ''}</td>`;
    }
    case 'rubrik':
      return `<td class="px-2 py-1.5 max-w-[280px]"><div class="truncate" title="${vkEsc(a.rubrik)}">${vkEsc(a.rubrik)}</div></td>`;
    case 'status':
      return `<td class="px-2 py-1.5">${isStatusCell(a, ref)}</td>`;
    case 'tilldelad':
      return `<td class="px-2 py-1.5 text-xs">${_is.redigera ? isTilldeladCell(a, ref)
        : (isVantande(a) && 'assignedTo' in isVantande(a).efter ? isTilldeladCell(a, ref) : isTilldeladEtikett(a.tilldeladTyp) + klick('tilldelad', a.tilldelad))}</td>`;
    case 'location':
      return `<td class="px-2 py-1.5 text-xs whitespace-nowrap">${klick('location', isLocation(a))}</td>`;
    case 'forfaller':
      return `<td class="px-2 py-1.5 text-xs whitespace-nowrap">${isForfallerCell(a, ref)}</td>`;
    case 'dagar': {
      const dagar = isDagarKvar(a.forfaller);
      const stil = dagar == null || IS_KLARA.has(a.status) ? '' : dagar <= 0 ? 'bg-red-600 text-white' : dagar <= 3 ? 'bg-amber-200' : '';
      return `<td class="px-2 py-1.5 text-right text-xs font-mono"><span class="px-1.5 py-0.5 rounded ${stil}">${dagar ?? ''}</span></td>`;
    }
    case 'bevakare': {
      const namn = (a.bevakare || []).map(isNamnPaId);
      return `<td class="px-2 py-1.5 text-xs max-w-[220px]"><div class="truncate" title="${vkEsc(namn.join(', '))}">${vkEsc(namn.join(', '))}</div></td>`;
    }
    case 'skapat':
    case 'start':
      return `<td class="px-2 py-1.5 text-xs whitespace-nowrap">${vkEsc(isKolumnText(k.k, a))}</td>`;
    default: {
      const text = isKolumnText(k.k, a);
      return `<td class="px-2 py-1.5 text-xs max-w-[220px]">${k.sok === 'lista' ? klick(k.k, text) : `<div class="truncate" title="${vkEsc(text)}">${vkEsc(text)}</div>`}</td>`;
    }
  }
}

// Antal tabellceller per rad, med kryssrutan och länken efter Nr.
function isAntalCeller() {
  return 1 + isSynligaKolumner().reduce((n, k) => n + (k.k === 'nr' ? 2 : 1), 0);
}
