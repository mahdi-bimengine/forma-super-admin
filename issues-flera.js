// issues-flera.js — ändra många ärenden samtidigt i "Alla ärenden".
//
// Ärenden markeras med en kryssruta per rad, eller alla som syns med rutan i
// rubriken. Då visas en rad med de vanligaste fälten som knappar. Varje knapp
// öppnar en liten ruta där värdet väljs, och ändringen läggs i samma lista som
// ändringar gjorda rad för rad. Inget skrivs till ACC förrän listan granskats.
//
// Ärenden som ACC inte låter ändras (behörighet eller status) hoppas över och
// visas med skäl i granskningen.

// ── Urval ─────────────────────────────────────────────────────────────────────

// Alla ärenden som syns med vy, sök och filter, även de som inte ritats ut än.
function isMarkerbara() {
  return isSorterade(isFiltrerade(isVyArenden()));
}

function isMarkerade() {
  return isMarkerbara().filter(a => _is.markerade.has(a.id));
}

// Markerade ärenden som filtreras bort avmarkeras, så att en ändring aldrig
// träffar något som inte syns.
function isRensaDoldaMarkeringar() {
  if (!_is.markerade.size) return;
  const syns = new Set(isMarkerbara().map(a => a.id));
  for (const id of _is.markerade) if (!syns.has(id)) _is.markerade.delete(id);
  if (!_is.markerade.size) _is.flera.meny = null;
}

function isMarkeraRad(ref, pa) {
  const id = _is.ref[ref].id;
  if (pa) _is.markerade.add(id); else _is.markerade.delete(id);
  if (!_is.markerade.size) _is.flera.meny = null;
  isRitaMarkering();
}

function isMarkeraAlla(pa) {
  _is.markerade = pa ? new Set(isMarkerbara().map(a => a.id)) : new Set();
  if (!pa) _is.flera.meny = null;
  isRitaRader();
}

// Ritar om raden med knapparna, rubrikens kryssruta och radernas färg utan att
// röra sökfälten.
function isRitaMarkering() {
  const rad = document.getElementById('is-markrad');
  if (rad) rad.innerHTML = isMarkradHtml();
  isVisaMarkeraAlla();
  for (const tr of document.querySelectorAll('#is-tbody tr[data-id]')) {
    tr.classList.toggle('bg-ads-blue/5', _is.markerade.has(tr.dataset.id));
  }
}

// Rutan i rubriken är ifylld när alla är markerade och halvfylld när några är.
function isVisaMarkeraAlla() {
  const alla = document.getElementById('is-markera-alla');
  if (!alla) return;
  const n = _is.markerade.size, totalt = isMarkerbara().length;
  alla.checked = n > 0 && n === totalt;
  alla.indeterminate = n > 0 && n < totalt;
}

// ── Rutorna ───────────────────────────────────────────────────────────────────

function isOppnaFlera(meny) {
  _is.flera = { ..._is.flera, meny: _is.flera.meny === meny ? null : meny, status: null, tilldela: null, sok: '',
                bevValda: [], bevPerson: false, bevForetag: false };
  isRitaMarkering();
  document.getElementById('is-flera-sok')?.focus();
}

function isFleraVal(nyckel, varde) {
  _is.flera[nyckel] = varde;
  isRitaMarkering();
}

function isFleraSok(text) {
  _is.flera.sok = text;
  const el = document.getElementById('is-flera-lista');
  if (el) el.innerHTML = isPersonListaHtml(isMarkerade(), _is.flera.meny);
}

function isFleraVaxlaBevakare(id) {
  const valda = _is.flera.bevValda;
  _is.flera.bevValda = valda.includes(id) ? valda.filter(x => x !== id) : [...valda, id];
  _is.flera.sok = '';
  isRitaMarkering();
  document.getElementById('is-flera-sok')?.focus();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _is.flera?.meny && !_is.dialog) isOppnaFlera(null);
});

// ── Ändringar ─────────────────────────────────────────────────────────────────

// Kör en ändring på alla markerade ärenden. gor returnerar ett skäl om ärendet
// ska hoppas över, annars ett objekt med de nya värdena (eller null om inget
// ändras). Tidigare överhoppade för samma fält ersätts.
function isFleraTillampa(falt, gor) {
  const markerade = isMarkerade();
  const ids = new Set(markerade.map(a => a.id));
  _is.hoppade = _is.hoppade.filter(h => !(ids.has(h.id) && h.falt === falt));
  for (const a of markerade) {
    const svar = gor(a);
    if (typeof svar === 'string') {
      _is.hoppade.push({ id: a.id, nr: a.nr, rubrik: a.rubrik, projekt: a.projekt, falt, varfor: svar });
    } else if (svar) {
      const andring = isHamtaAndring(a);
      const { bevakarSteg, bevakarTyper, ...efter } = svar;
      if (bevakarTyper) andring.bevakarTyper = { ...andring.bevakarTyper, ...bevakarTyper };
      // Läget före behövs för fält utanför de vanliga, så att granskningen kan
      // visa det och ändringen kan återställas.
      const saknas = Object.keys(efter).filter(k => !(k in andring.fore));
      if (saknas.length) {
        const fore = isFore(a, saknas);
        for (const k of saknas) andring.fore[k] = fore[k] ?? null;
      }
      Object.assign(andring.efter, efter);
      if (bevakarSteg) andring.bevakarSteg = [...(andring.bevakarSteg || []), bevakarSteg];
      isRensaLika(andring);
      isRensaTom(andring);
    }
  }
  _is.flera.meny = null;
  isRita();
}

function isFleraStatus() {
  const s = _is.flera.status;
  isFleraTillampa('status', a => {
    if (a.status === s) return null;
    if (!isFarAndra(a, 'status')) return 'Du får inte ändra status på ärendet';
    if (!a.tillatnaStatusar.includes(s)) return `ACC tillåter inte ${isStatusLabel(s)} från ${isStatusLabel(a.status)}`;
    return { status: s };
  });
}

// varde är "typ:id", eller tom sträng för att ta bort tilldelningen.
function isFleraTilldela(varde) {
  const [typ, ...rest] = String(varde || '').split(':');
  const id = varde ? rest.join(':') : null;
  isFleraTillampa('assignedTo', a => {
    if (!isFarAndra(a, 'assignedTo')) return 'Du får inte ändra tilldelningen på ärendet';
    if (id && !_is.projekt.get(a.projektId)?.namnRegister.has(id)) return 'Finns inte i ärendets projekt';
    return { assignedTo: id, assignedToType: id ? typ : null };
  });
}

function isFleraForfaller() {
  const { datumLage, datum, dagar } = _is.flera;
  const plus = (fran, n) => {
    const d = new Date(fran + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  isFleraTillampa('dueDate', a => {
    if (!isFarAndra(a, 'dueDate')) return 'Du får inte ändra förfallodatum på ärendet';
    if (datumLage === 'satt')   return { dueDate: datum };
    if (datumLage === 'rensa')  return { dueDate: null };
    if (datumLage === 'flytta') {
      const nu = isVantande(a)?.efter.dueDate ?? a.forfaller;
      return nu ? { dueDate: plus(nu, Number(dagar)) } : 'Har inget förfallodatum att flytta';
    }
    if (datumLage === 'efter')  return a.skapat ? { dueDate: plus(a.skapat, Number(dagar)) } : 'Saknar skapat-datum';
    return null;
  });
}

// ── Fler fält ─────────────────────────────────────────────────────────────────
// Fälten under "Fler fält". Typer, grundorsaker och egna fält finns per
// projekt i ACC, så de väljs med namn och slås upp i varje ärendes projekt.
// Ett ärende vars projekt saknar namnet hoppas över.

function isFlerFalt(markerade) {
  const projekt = [...new Set(markerade.map(a => a.projektId))].map(id => _is.projekt.get(id)).filter(Boolean);
  const unika = lista => [...new Set(lista)].sort((a, b) => a.localeCompare(b, 'sv', { numeric: true }));
  const falt = [
    { k: 'issueSubtypeId', namn: 'Ärendetyp', slag: 'val', rensa: false,
      val: unika(projekt.flatMap(p => (p.typer || []).flatMap(t => (t.subtypes || []).map(s => `${t.title} › ${s.title}`)))) },
    { k: 'startDate', namn: 'Startdatum', slag: 'datum' },
    { k: 'rootCauseId', namn: 'Grundorsak', slag: 'val', val: unika(projekt.flatMap(p => (p.grundorsaker || []).map(o => o.namn))) },
    { k: 'locationDetails', namn: 'Platsbeskrivning', slag: 'text' },
  ].filter(f => f.slag !== 'val' || f.val.length);
  // Egna fält med samma namn i flera projekt räknas som ett.
  const egna = new Map();
  for (const p of projekt) {
    for (const d of p.faltDef || []) {
      if (!d.title || d.isReadOnly) continue;
      const lista = d.dataType === 'list';
      if (!egna.has(d.title)) egna.set(d.title, { k: `eget:${d.title}`, namn: d.title, eget: true, slag: lista ? 'val' : d.dataType === 'numeric' ? 'tal' : 'text', val: [] });
      if (lista) egna.get(d.title).val.push(...(d.metadata?.list?.options || []).map(o => o.value));
    }
  }
  for (const f of egna.values()) f.val = unika(f.val);
  return [...falt, ...[...egna.values()].sort((a, b) => a.namn.localeCompare(b.namn, 'sv'))];
}

function isFlerFaltMenyHtml(markerade) {
  const falt = isFlerFalt(markerade);
  const rad = f => `
    <button onclick="isValjFlerFalt(_is.ref[${isRef(f.k)}])" class="w-full text-left px-3 py-1.5 text-sm hover:bg-ads-gray">${vkEsc(f.namn)}</button>`;
  const egna = falt.filter(f => f.eget);
  return `
    <div class="absolute left-0 top-full mt-1 z-30 w-60 bg-white border border-ads-border rounded shadow-lg py-1 max-h-96 overflow-y-auto">
      ${falt.filter(f => !f.eget).map(rad).join('')}
      ${egna.length ? `
        <div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-ads-muted border-t border-ads-border mt-1">Egna fält</div>
        ${egna.map(rad).join('')}` : ''}
    </div>`;
}

function isValjFlerFalt(k) {
  _is.flera = { ..._is.flera, meny: 'falt', falt: k, faltLage: 'satt', faltVarde: '' };
  isRitaMarkering();
}

// Ärendets fält-id och ACC:s värde för det valda namnet, eller ett skäl att
// hoppa över ärendet.
function isFlerFaltVarde(a, f, varde) {
  const p = _is.projekt.get(a.projektId);
  if (f.k === 'issueSubtypeId') {
    for (const t of p?.typer || []) for (const s of t.subtypes || []) if (`${t.title} › ${s.title}` === varde) return { nyckel: f.k, varde: s.id };
    return 'Ärendetypen finns inte i ärendets projekt';
  }
  if (f.k === 'rootCauseId') {
    if (varde == null) return { nyckel: f.k, varde: null };
    const o = (p?.grundorsaker || []).find(o => o.namn === varde);
    return o ? { nyckel: f.k, varde: o.id } : 'Grundorsaken finns inte i ärendets projekt';
  }
  if (f.k === 'startDate' || f.k === 'locationDetails') return { nyckel: f.k, varde: varde || null };
  const d = (p?.faltDef || []).find(d => d.title === f.namn && !d.isReadOnly);
  if (!d) return 'Fältet finns inte i ärendets projekt';
  if (varde == null || varde === '') return { nyckel: `ca:${d.id}`, varde: null };
  if (f.slag === 'val') {
    const o = (d.metadata?.list?.options || []).find(o => o.value === varde);
    return o ? { nyckel: `ca:${d.id}`, varde: o.id } : 'Värdet finns inte i fältet i ärendets projekt';
  }
  if (f.slag === 'tal') return Number.isFinite(Number(varde)) ? { nyckel: `ca:${d.id}`, varde: Number(varde) } : 'Inte ett tal';
  return { nyckel: `ca:${d.id}`, varde };
}

function isFleraFlerFalt() {
  const markerade = isMarkerade();
  const f = isFlerFalt(markerade).find(x => x.k === _is.flera.falt);
  if (!f) return;
  const varde = _is.flera.faltLage === 'rensa' ? null : _is.flera.faltVarde;
  // Egna fält kan ha olika id i olika projekt, så de hoppas över per fältnamn.
  isFleraTillampa(f.eget ? `eget:${f.namn}` : f.k, a => {
    const behorighet = f.eget ? 'customAttributes' : f.k;
    if (!isFarAndra(a, behorighet)) return `Du får inte ändra ${f.namn.toLowerCase()} på ärendet`;
    const svar = isFlerFaltVarde(a, f, varde);
    if (typeof svar === 'string') return svar;
    const nu = isVantande(a)?.efter[svar.nyckel] ?? isFore(a, [svar.nyckel])[svar.nyckel] ?? null;
    return isLika(nu, svar.varde) ? null : { [svar.nyckel]: svar.varde };
  });
}

// Lägger till, tar bort eller ersätter bevakare. De valda gäller alla ärenden.
// "Från varje ärende" lägger till den tilldelade personen eller personens
// företag, som skiljer sig mellan ärendena.
function isFleraBevakare() {
  const { bevLage, bevValda, bevPerson, bevForetag } = _is.flera;
  isFleraTillampa('watchers', a => {
    if (!isFarAndra(a, 'watchers')) return 'Du får inte ändra bevakare på ärendet';
    const ids = [...bevValda];
    // Typen skickas med till ACC. De valda har den i namnregistret; den
    // tilldelade är en person och personens företag ett företag.
    const reg = _is.projekt.get(a.projektId)?.namnRegister;
    const typer = Object.fromEntries(bevValda.map(id => [id, reg?.get(id)?.typ || 'user']));
    if (bevPerson || bevForetag) {
      const vem = isVantande(a)?.efter.assignedTo !== undefined ? isVantande(a).efter : { assignedTo: a.tilldeladId, assignedToType: a.tilldeladTyp };
      if (vem.assignedToType !== 'user') {
        if (!ids.length) return !vem.assignedTo ? 'Inte tilldelat någon'
          : `Tilldelat ${vem.assignedToType === 'role' ? 'en roll' : 'ett företag'}, inte en person`;
      } else {
        if (bevPerson) { ids.push(vem.assignedTo); typer[vem.assignedTo] = 'user'; }
        if (bevForetag) {
          const foretag = reg?.get(vem.assignedTo)?.foretagId;
          if (foretag) { ids.push(foretag); typer[foretag] = 'company'; }
          else if (!ids.length) return 'Den tilldelade personens företag är okänt (medlemslistan kunde inte läsas)';
        }
      }
    }
    const steg = { lage: bevLage, ids: [...new Set(ids)] };
    const nu = isVantande(a)?.efter.watchers ?? [...a.bevakare].sort();
    const efter = isBevakareEfterSteg(nu, [steg]);
    if (isLika(efter, nu)) return null;
    return { watchers: efter, bevakarSteg: steg, bevakarTyper: typer };
  });
}

// ── Rendering ─────────────────────────────────────────────────────────────────

// Sektionen "Redigera ärenden" ovanför tabellen. Med markerade ärenden visas
// knapparna för att ändra dem samtidigt. Redigera gör i stället cellerna för
// status, tilldelad och förfallodatum ändringsbara rad för rad.
function isMarkradHtml() {
  const markerade = isMarkerade();
  const n = markerade.length;
  const rubrik = '<span class="w-36 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ads-text">Redigera ärenden</span>';
  const redigera = `
    <button onclick="isVaxlaRedigera()" title="Gör status, tilldelad och förfallodatum ändringsbara direkt i tabellen, rad för rad."
            class="text-xs border rounded px-2.5 py-1.5 transition-colors
                   ${_is.redigera ? 'border-ads-blue bg-ads-blue text-white' : 'border-ads-border bg-white text-ads-text hover:border-ads-blue'}">
      ${_is.redigera ? 'Klar med redigering' : 'Redigera'}</button>`;
  if (!n) {
    return `
      <div class="px-4 py-2 border-b border-ads-border flex items-center gap-3 flex-wrap">
        ${rubrik}
        <span class="text-xs text-ads-muted">${_is.redigera
          ? 'Ändra status, tilldelad och förfallodatum direkt i tabellen. Ändringarna samlas längst ner.'
          : 'Markera ärenden med rutorna till vänster för att ändra flera samtidigt, eller slå på Redigera för att ändra rad för rad.'}</span>
        <div class="flex-1"></div>
        ${redigera}
      </div>`;
  }
  const knapp = (k, text) => `
    <div class="relative">
      <button onclick="isOppnaFlera('${k}')"
              class="text-xs border rounded px-2.5 py-1.5 bg-white transition-colors
                     ${_is.flera.meny === k ? 'border-ads-blue text-ads-blue' : 'border-ads-border text-ads-text hover:border-ads-blue'}">${text} ▾</button>
      ${_is.flera.meny === k ? isFleraRutaHtml(k, markerade) : ''}
    </div>`;
  return `
    <div class="px-4 py-2 border-b border-ads-blue/30 bg-ads-blue/5 flex items-center gap-2 flex-wrap">
      ${rubrik}
      <span class="text-sm font-medium text-ads-blue mr-2">${n} markerade</span>
      ${knapp('status', 'Status')}${knapp('tilldela', 'Tilldela')}${knapp('forfaller', 'Förfaller')}${knapp('bevakare', 'Bevakare')}
      <div class="relative">
        <button onclick="isOppnaFlera('flerfalt')"
                class="text-xs border rounded px-2.5 py-1.5 bg-white transition-colors
                       ${_is.flera.meny === 'flerfalt' || _is.flera.meny === 'falt' ? 'border-ads-blue text-ads-blue' : 'border-ads-border text-ads-text hover:border-ads-blue'}">Fler fält ▾</button>
        ${_is.flera.meny === 'flerfalt' ? isFlerFaltMenyHtml(markerade) : ''}
        ${_is.flera.meny === 'falt' ? isFleraRutaHtml('falt', markerade) : ''}
      </div>
      <div class="flex-1"></div>
      <button onclick="isMarkeraAlla(false)" class="text-xs text-ads-muted hover:text-ads-text mr-2">Avmarkera</button>
      ${redigera}
    </div>`;
}

function isFleraRam(titel, inneh, fot, bredd = 'w-80') {
  return `
    <div class="absolute left-0 top-full mt-1 z-30 ${bredd} bg-white border border-ads-border rounded shadow-lg text-sm">
      <div class="px-3 pt-2.5 pb-1 flex items-center">
        <span class="font-semibold text-xs uppercase tracking-wider text-ads-muted flex-1">${titel}</span>
        <button onclick="isOppnaFlera(null)" class="text-ads-muted hover:text-ads-text px-1">✕</button>
      </div>
      <div class="px-3 pb-3 space-y-2.5">${inneh}</div>
      <div class="px-3 py-2 border-t border-ads-border bg-ads-gray/50 flex items-center gap-2">${fot}</div>
    </div>`;
}

function isFleraKnapp(onclick, text, av = false) {
  return `<button onclick="${onclick}" ${av ? 'disabled' : ''}
                  class="bg-be-charcoal hover:bg-black text-white text-xs font-medium py-1.5 px-3 rounded disabled:opacity-40">${text}</button>`;
}

function isArendenText(n) {
  return `${n} ärende${n === 1 ? '' : 'n'}`;
}

function isFleraRutaHtml(k, markerade) {
  const f = _is.flera;
  const n = markerade.length;

  if (k === 'status') {
    // Hur många av de markerade som kan få statusen, så att det syns innan.
    const kan = s => markerade.filter(a => a.status === s || (isFarAndra(a, 'status') && a.tillatnaStatusar.includes(s))).length;
    const val = IS_STATUS_ORDNING.map(s => ({ s, kan: kan(s) })).filter(x => x.kan);
    const vald = val.find(x => x.s === f.status);
    return isFleraRam('Sätt status', `
      <div class="space-y-0.5">
        ${val.map(({ s, kan }) => `
          <label class="flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer hover:bg-ads-gray ${f.status === s ? 'bg-ads-blue/10' : ''}">
            <input type="radio" name="is-flera-status" ${f.status === s ? 'checked' : ''} onchange="isFleraVal('status', '${s}')" class="accent-ads-blue" />
            ${isStatusTagg(s)}
            ${kan < n ? `<span class="ml-auto text-[11px] text-ads-muted">${kan} av ${n}</span>` : ''}
          </label>`).join('')}
      </div>
      ${vald && vald.kan < n ? `<p class="text-[11px] text-amber-800">${isArendenText(n - vald.kan)} hoppas över: ACC tillåter inte statusen därifrån, eller så saknar du behörighet.</p>` : ''}`,
      `<div class="flex-1"></div>${isFleraKnapp('isFleraStatus()', `Sätt på ${isArendenText(n)}`, !f.status)}`);
  }

  if (k === 'tilldela') {
    return isFleraRam('Tilldela', `
      <input id="is-flera-sok" type="search" value="${vkEsc(f.sok)}" oninput="isFleraSok(this.value)" placeholder="Sök person, företag, roll…"
             class="w-full px-2 py-1 text-sm border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue" />
      <div id="is-flera-lista" class="max-h-60 overflow-y-auto border border-ads-border rounded">${isPersonListaHtml(markerade, 'tilldela')}</div>`,
      `<button onclick="isFleraTilldela('')" class="text-xs text-ads-muted hover:text-red-700">Ta bort tilldelning</button>
       <div class="flex-1"></div>
       ${isFleraKnapp(`isFleraTilldela(_is.flera.tilldela)`, `Tilldela ${isArendenText(n)}`, !f.tilldela)}`, 'w-96');
  }

  if (k === 'forfaller') {
    const lagen = [['satt', 'Sätt datum'], ['flytta', 'Flytta'], ['efter', 'Efter skapat'], ['rensa', 'Rensa']];
    const dagarFalt = text => `
      <div class="flex items-center gap-2">
        <input type="number" value="${f.dagar}" oninput="_is.flera.dagar = this.value"
               class="w-20 px-2 py-1 border border-ads-border rounded" />
        <span class="text-xs text-ads-muted">${text}</span>
      </div>`;
    return isFleraRam('Förfallodatum', `
      <div class="flex bg-ads-gray rounded p-0.5 text-xs">
        ${lagen.map(([l, t]) => `<button onclick="isFleraVal('datumLage', '${l}')"
            class="flex-1 px-2 py-1 rounded ${f.datumLage === l ? 'bg-white shadow-sm font-medium' : 'text-ads-muted hover:text-ads-text'}">${t}</button>`).join('')}
      </div>
      ${f.datumLage === 'satt'   ? `<input type="date" value="${f.datum}" onchange="isFleraVal('datum', this.value)" class="w-full px-2 py-1 border border-ads-border rounded" />` : ''}
      ${f.datumLage === 'flytta' ? dagarFalt('dagar framåt från nuvarande datum (minus för bakåt)') : ''}
      ${f.datumLage === 'efter'  ? dagarFalt('dagar efter att ärendet skapades') : ''}
      ${f.datumLage === 'rensa'  ? '<p class="text-xs text-ads-muted">Tar bort förfallodatumet.</p>' : ''}`,
      `<div class="flex-1"></div>${isFleraKnapp('isFleraForfaller()', `Ändra ${isArendenText(n)}`, f.datumLage === 'satt' && !f.datum)}`);
  }

  if (k === 'falt') {
    const falt = isFlerFalt(markerade).find(x => x.k === f.falt);
    if (!falt) return '';
    const lagen = falt.rensa === false ? [['satt', 'Sätt till']] : [['satt', 'Sätt till'], ['rensa', 'Rensa']];
    const inmatning = falt.slag === 'val'
      ? `<select onchange="isFleraVal('faltVarde', this.value)" class="w-full px-2 py-1 border border-ads-border rounded bg-white">
           <option value="">Välj…</option>
           ${falt.val.map(v => `<option value="${vkEsc(v)}" ${f.faltVarde === v ? 'selected' : ''}>${vkEsc(v)}</option>`).join('')}
         </select>`
      : `<input type="${falt.slag === 'datum' ? 'date' : falt.slag === 'tal' ? 'number' : 'text'}" value="${vkEsc(f.faltVarde)}"
                oninput="_is.flera.faltVarde = this.value; document.getElementById('is-flera-utfor').disabled = !this.value"
                class="w-full px-2 py-1 border border-ads-border rounded" />`;
    return isFleraRam(vkEsc(falt.namn) + (falt.eget ? ' · eget fält' : ''), `
      ${lagen.length > 1 ? `
        <div class="flex bg-ads-gray rounded p-0.5 text-xs">
          ${lagen.map(([l, t]) => `<button onclick="isFleraVal('faltLage', '${l}')"
              class="flex-1 px-2 py-1 rounded ${f.faltLage === l ? 'bg-white shadow-sm font-medium' : 'text-ads-muted hover:text-ads-text'}">${t}</button>`).join('')}
        </div>` : ''}
      ${f.faltLage === 'satt' ? inmatning : '<p class="text-xs text-ads-muted">Tömmer fältet.</p>'}
      ${falt.slag === 'val' && falt.k !== 'startDate' ? '<p class="text-[11px] text-ads-muted">Matchas på namn i varje ärendes projekt. Ärenden i projekt som saknar värdet hoppas över.</p>' : ''}`,
      `<button onclick="isOppnaFlera('flerfalt')" class="text-xs text-ads-muted hover:text-ads-text">‹ Fler fält</button>
       <div class="flex-1"></div>
       <button id="is-flera-utfor" onclick="isFleraFlerFalt()" ${f.faltLage === 'satt' && !f.faltVarde ? 'disabled' : ''}
               class="bg-be-charcoal hover:bg-black text-white text-xs font-medium py-1.5 px-3 rounded disabled:opacity-40">Ändra ${isArendenText(n)}</button>`);
  }

  if (k === 'bevakare') {
    const lagen = [['lagg', 'Lägg till'], ['tabort', 'Ta bort'], ['ersatt', 'Ersätt']];
    const hjalp = {
      lagg:   'Läggs till. Nuvarande bevakare behålls.',
      tabort: 'Bara de valda tas bort. Övriga bevakare behålls.',
      ersatt: 'Alla nuvarande bevakare tas bort och ersätts med de valda.',
    }[f.bevLage];
    const verb = { lagg: 'Lägg till på', tabort: 'Ta bort från', ersatt: 'Ersätt på' }[f.bevLage];
    const ejPerson = markerade.filter(a => a.tilldeladTyp !== 'user').length;
    const ruta = (nyckel, text) => `
      <label class="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" ${f[nyckel] ? 'checked' : ''} onchange="isFleraVal('${nyckel}', this.checked)" class="accent-ads-blue" /> ${text}</label>`;
    return isFleraRam('Bevakare', `
      <div class="flex bg-ads-gray rounded p-0.5 text-xs">
        ${lagen.map(([l, t]) => `<button onclick="isFleraVal('bevLage', '${l}')"
            class="flex-1 px-2 py-1 rounded ${f.bevLage === l ? 'bg-white shadow-sm font-medium' : 'text-ads-muted hover:text-ads-text'}">${t}</button>`).join('')}
      </div>
      <p class="text-[11px] ${f.bevLage === 'ersatt' ? 'text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1' : 'text-ads-muted'}">${hjalp}</p>
      ${f.bevValda.length ? `
        <div class="flex flex-wrap gap-1">
          ${f.bevValda.map(id => `
            <span class="text-xs bg-ads-blue/10 text-ads-blue rounded-full pl-2 pr-1 py-0.5">${vkEsc(isNamnPaId(id))}
              <button onclick="isFleraVaxlaBevakare(_is.ref[${isRef(id)}])" class="ml-0.5 hover:text-red-700">✕</button></span>`).join('')}
        </div>` : ''}
      <input id="is-flera-sok" type="search" value="${vkEsc(f.sok)}" oninput="isFleraSok(this.value)" placeholder="Sök person, företag, roll…"
             class="w-full px-2 py-1 text-sm border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue" />
      <div id="is-flera-lista" class="max-h-44 overflow-y-auto border border-ads-border rounded">${isPersonListaHtml(markerade, 'bevakare')}</div>
      <div class="border-t border-ads-border pt-2 space-y-0.5">
        <div class="text-[11px] font-semibold text-ads-muted mb-1">Från varje ärende</div>
        ${ruta('bevPerson', 'Den tilldelade personen')}
        ${ruta('bevForetag', 'Den tilldelade personens företag')}
        ${(f.bevPerson || f.bevForetag) && ejPerson ? `<p class="text-[11px] text-amber-800 mt-1">${isArendenText(ejPerson)} är tilldelade en roll, ett företag eller ingen. De får inget härifrån.</p>` : ''}
      </div>`,
      `<div class="flex-1"></div>${isFleraKnapp('isFleraBevakare()', `${verb} ${isArendenText(n)}`, !f.bevValda.length && !f.bevPerson && !f.bevForetag)}`, 'w-96');
  }
  return '';
}

// Personer, företag och roller i de markerade ärendenas projekt. Står någon
// bara i några av projekten syns det, eftersom de andra ärendena då hoppas över.
// meny är 'tilldela' (ett val) eller 'bevakare' (flera val, valda göms).
function isPersonListaHtml(markerade, meny) {
  const projekt = [...new Set(markerade.map(a => a.projektId))].map(id => _is.projekt.get(id)).filter(Boolean);
  const alla = new Map();   // id → { typ, namn, foretag, antal }
  for (const p of projekt) {
    for (const [id, n] of p.namnRegister) {
      if (!alla.has(id)) alla.set(id, { typ: n.typ, namn: n.namn, foretag: n.foretag || '', antal: 0 });
      alla.get(id).antal++;
    }
  }
  const q = _is.flera.sok.trim().toLowerCase();
  const grupper = [['user', 'Personer'], ['company', 'Företag'], ['role', 'Roller']].map(([typ, rubrik]) => {
    const lista = [...alla.entries()]
      .filter(([id, x]) => x.typ === typ && (!q || `${x.namn} ${x.foretag}`.toLowerCase().includes(q)))
      .filter(([id]) => meny !== 'bevakare' || !_is.flera.bevValda.includes(id))
      .sort((a, b) => a[1].namn.localeCompare(b[1].namn, 'sv'));
    if (!lista.length) return '';
    return `
      <div class="px-2 pt-1.5 text-[10px] uppercase tracking-wider text-ads-muted">${rubrik}</div>
      ${lista.map(([id, x]) => {
        const varde = `${typ}:${id}`;
        const klick = meny === 'bevakare' ? `isFleraVaxlaBevakare(_is.ref[${isRef(id)}])` : `isFleraVal('tilldela', _is.ref[${isRef(varde)}])`;
        return `
          <button onclick="${klick}"
                  class="w-full text-left px-2 py-1 text-sm hover:bg-ads-gray flex items-center gap-2 ${_is.flera.tilldela === varde ? 'bg-ads-blue/10 font-medium' : ''}">
            <span class="truncate">${vkEsc(x.namn)}${x.foretag ? `<span class="text-[11px] text-ads-muted"> · ${vkEsc(x.foretag)}</span>` : ''}</span>
            ${x.antal < projekt.length ? `<span class="ml-auto shrink-0 text-[10px] text-amber-800">${x.antal} av ${projekt.length} projekt</span>` : ''}
          </button>`;
      }).join('')}`;
  }).join('');
  return grupper || '<p class="p-2 text-xs text-ads-muted">Inga träffar</p>';
}

// Ärenden som hoppas över, med skäl. Visas i granskningen.
function isHoppadeHtml() {
  if (!_is.hoppade.length) return '';
  return `
    <details class="mt-3 mx-2 p-2.5 rounded border border-amber-200 bg-amber-50 text-xs text-amber-900" open>
      <summary class="cursor-pointer font-medium">${isArendenText(_is.hoppade.length)} hoppas över</summary>
      <div class="mt-1 space-y-0.5">
        ${_is.hoppade.map(h => `<div>#${h.nr} ${vkEsc(h.rubrik)} <span class="text-amber-700">(${vkEsc(h.projekt)})</span> – ${isFaltNamn(h.falt)}: ${vkEsc(h.varfor)}</div>`).join('')}
      </div>
    </details>`;
}
