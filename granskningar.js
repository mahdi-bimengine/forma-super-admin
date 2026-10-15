// granskningar.js — fliken Granskningar.
//
// Listar projektets granskningar ur ACC:s granskningsverktyg (Reviews) med
// samma kolumner som i ACC. Allt läses in en gång och söks, sorteras och
// bläddras sedan i webbläsaren. Det är det som gör att filtret i del 2 kan
// kombinera villkor med OCH, ELLER och XOR, vilket ACC:s egna filter inte kan.
//
// Byggs i tre delar: 1 tabellen (klar), 2 filtret, 3 spara filter och export.
// Fliken läser bara, inget ändras i ACC.
//
// Delar vkEsc, vkKortDatum och vkLaddarKort med Veckokontroll.

const _gk = {
  laddad:   false,
  laddar:   false,
  fel:      null,
  hamtade:  0,       // under läsningen: hur många som hämtats ...
  totalt:   0,       // ... av hur många
  rader:    [],      // en per granskning, se gkRad
  floden:   true,    // false om arbetsflödena inte gick att läsa
  sok:      '',
  sortera:  'nr',
  fallande: true,
  sida:     0,
};

const GK_PER_SIDA = 50;

const GK_STATUS = {
  OPEN:   { text: 'Öppen',      farg: 'bg-amber-400' },
  CLOSED: { text: 'Stängd',     farg: 'bg-emerald-500' },
  VOID:   { text: 'Annullerad', farg: 'bg-gray-400' },
  FAILED: { text: 'Misslyckad', farg: 'bg-red-500' },
};

const GK_KOLUMNER = [
  { falt: 'status',      rubrik: 'Status' },
  { falt: 'nr',          rubrik: 'ID' },
  { falt: 'namn',        rubrik: 'Granskningsnamn' },
  { falt: 'arbetsflode', rubrik: 'Arbetsflöde' },
  { falt: 'stegNr',      rubrik: 'Steg' },
  { falt: 'initieradAv', rubrik: 'Initierad av' },
  { falt: 'nastaAtgard', rubrik: 'Nästa åtgärd av' },
  { falt: 'godkantAv',   rubrik: 'Godkänt av' },
  { falt: 'forfaller',   rubrik: 'Förfaller' },
  { falt: 'skapad',      rubrik: 'Skapad' },
  { falt: 'slutford',    rubrik: 'Slutförd' },
];

const GK_AVATARFARGER = [
  'bg-pink-200 text-pink-800',   'bg-lime-200 text-lime-800',     'bg-sky-200 text-sky-800',
  'bg-amber-200 text-amber-800', 'bg-violet-200 text-violet-800', 'bg-teal-200 text-teal-800',
];

const GK_TOM = '<span class="text-ads-muted">–</span>';

function gkReset() {
  _gk.laddad  = false;
  _gk.laddar  = false;
  _gk.fel     = null;
  _gk.hamtade = 0;
  _gk.totalt  = 0;
  _gk.rader   = [];
  _gk.floden  = true;
  _gk.sok     = '';
  _gk.sida    = 0;
}

function gkOppnaFlik() {
  renderGranskningar();
  if (!_gk.laddad && !_gk.laddar) gkLas();
}

// ── Läsning ───────────────────────────────────────────────────────────────────

async function gkLas() {
  const projektId = _currentProject.id;
  _gk.laddar  = true;
  _gk.fel     = null;
  _gk.hamtade = 0;
  _gk.totalt  = 0;
  gkRita();

  try {
    const [granskningar, floden] = await Promise.all([
      listReviews(projektId, (n, totalt) => {
        if (_currentProject?.id !== projektId) return;
        _gk.hamtade = n;
        _gk.totalt  = totalt;
        gkRita();
      }),
      // Utan arbetsflödena blir bara arbetsflöde och steg tomma, så ett fel där
      // får inte stoppa listan.
      listReviewWorkflows(projektId).catch(() => null),
    ]);
    if (_currentProject?.id !== projektId) return;   // användaren hann byta projekt

    // Står det aktuella steget inte i projektets arbetsflöde följer granskningen
    // en ändrad version av det. Den hämtas, men bara för just de granskningarna.
    const perFlode = new Map((floden || []).map(f => [f.id, f]));
    const egna     = floden ? await gkEgnaFloden(projektId, granskningar.filter(g =>
      g.status === 'OPEN' && !(perFlode.get(g.workflowId)?.steps || []).some(s => s.id === g.currentStepId))) : new Map();
    if (_currentProject?.id !== projektId) return;

    _gk.floden = !!floden;
    _gk.rader  = granskningar.map(g => gkRad(g, perFlode.get(g.workflowId), egna.get(g.id)));
    _gk.laddad = true;
  } catch (err) {
    if (_currentProject?.id !== projektId) return;
    _gk.fel = err.message;
  }
  _gk.laddar = false;
  gkRita();
}

async function gkEgnaFloden(projektId, granskningar) {
  const egna = new Map();
  for (let i = 0; i < granskningar.length; i += 8) {
    await Promise.all(granskningar.slice(i, i + 8).map(async g => {
      try { egna.set(g.id, await getReviewWorkflow(projektId, g.id)); }
      catch { /* steget visas som okänt */ }
    }));
  }
  return egna;
}

// En granskning i den form tabellen, och senare filtret, arbetar med.
// eget är granskningens egen version av arbetsflödet, när den behövts.
function gkRad(g, flode, eget) {
  const steg  = (eget || flode)?.steps || [];
  const index = steg.findIndex(s => s.id === g.currentStepId);
  const oppen = g.status === 'OPEN';

  // Har någon tagit steget är det de som ska agera. Annars alla som steget är
  // tilldelat. ACC räknar då upp varje medlem i tilldelade roller och företag,
  // så rollerna och företagen visas först för att inte drunkna bland namnen.
  const nasta = g.nextActionBy || {};
  const kand  = nasta.candidates || {};
  const tagna = (nasta.claimedBy || []).map(p => ({ typ: 'person', namn: p.name }));
  const vem   = tagna.length ? tagna : [
    ...(kand.roles     || []).map(p => ({ typ: 'roll',    namn: p.name })),
    ...(kand.companies || []).map(p => ({ typ: 'foretag', namn: p.name })),
    ...(kand.users     || []).map(p => ({ typ: 'person',  namn: p.name })),
  ];

  return {
    id:          g.id,
    nr:          g.sequenceId,
    namn:        g.name || '',
    status:      g.status,
    arbetsflode: flode?.name || eget?.name || '',
    stegNr:      oppen && index >= 0 ? index + 1 : null,
    stegTotalt:  steg.length || null,
    stegNamn:    oppen && index >= 0 ? steg[index].name || '' : '',
    initieradAv: g.createdBy?.name || '',
    nastaAtgard: oppen ? vem.filter((a, i) => a.namn && vem.findIndex(b => b.typ === a.typ && b.namn === a.namn) === i) : [],
    godkantAv:   g.approvedBy?.name || '',
    forfaller:   oppen ? g.currentStepDueDate || null : null,
    skapad:      g.createdAt || null,
    slutford:    g.finishedAt || null,
  };
}

function gkFelText(text) {
  if (/APS error 403/.test(text))       return 'Du har inte behörighet att läsa granskningarna i projektet.';
  if (/APS error (400|404)/.test(text)) return 'Granskningarna gick inte att läsa. Granskningsverktyget finns bara i ACC-projekt, inte i BIM 360.';
  return text;
}

// ── Sök, sortering och bläddring ──────────────────────────────────────────────

function gkSokta() {
  const sok = _gk.sok.trim().toLowerCase();
  if (!sok) return _gk.rader;
  return _gk.rader.filter(r => r.namn.toLowerCase().includes(sok) || String(r.nr).includes(sok));
}

function gkSorteringsvarde(r, falt) {
  if (falt === 'nastaAtgard') return r.nastaAtgard[0]?.namn || '';
  if (falt === 'status')      return GK_STATUS[r.status]?.text || r.status || '';
  return r[falt] ?? '';
}

function gkSorterade(rader) {
  const { sortera, fallande } = _gk;
  return [...rader].sort((a, b) => {
    const x = gkSorteringsvarde(a, sortera);
    const y = gkSorteringsvarde(b, sortera);
    // Tomma värden hamnar sist, åt båda hållen.
    if (x === '' && y !== '') return 1;
    if (y === '' && x !== '') return -1;
    const j = typeof x === 'number' && typeof y === 'number'
      ? x - y
      : String(x).localeCompare(String(y), 'sv', { numeric: true });
    return fallande ? -j : j;
  });
}

function gkSok(text) {
  _gk.sok  = text;
  _gk.sida = 0;
  gkRitaTabell();
}

function gkSortera(falt) {
  if (_gk.sortera === falt) {
    _gk.fallande = !_gk.fallande;
  } else {
    _gk.sortera  = falt;
    // ID och datum för skapad/slutförd visar nyaste först, resten A till Ö.
    _gk.fallande = ['nr', 'skapad', 'slutford'].includes(falt);
  }
  _gk.sida = 0;
  gkRitaTabell();
}

function gkBladdra(sida) {
  _gk.sida = sida;
  gkRitaTabell();
}

// ── Ritning ───────────────────────────────────────────────────────────────────

function gkRita() {
  const el = document.getElementById('gk-innehall');
  if (el) el.innerHTML = gkKropp();
}

function gkRitaTabell() {
  const el = document.getElementById('gk-tabell');
  if (el) el.innerHTML = gkTabell();
}

function renderGranskningar() {
  document.getElementById('main-content').innerHTML = `
    <div class="max-w-[1600px] mx-auto px-6 py-8">
      <div class="mb-6">
        <h2 class="text-lg font-semibold text-ads-text">Granskningar</h2>
        <p class="text-ads-muted text-sm mt-0.5">
          Projektets granskningar från ACC. Fliken läser bara, inget ändras i ACC.
        </p>
      </div>
      <div id="gk-innehall">${gkKropp()}</div>
    </div>`;
}

function gkKropp() {
  if (_gk.laddar) {
    return vkLaddarKort(_gk.totalt ? `Läser granskningar… ${_gk.hamtade} av ${_gk.totalt}` : 'Läser granskningar…');
  }
  if (_gk.fel) {
    const vanlig = gkFelText(_gk.fel);
    return `
      <div class="bg-white border border-ads-border rounded p-6">
        <p class="text-sm text-red-600 mb-1">${vkEsc(vanlig)}</p>
        ${vanlig !== _gk.fel ? `<p class="text-xs text-ads-muted mb-3 break-all">${vkEsc(_gk.fel)}</p>` : ''}
        <button onclick="gkLas()"
                class="mt-2 text-sm border border-ads-border rounded px-3 py-1.5 hover:border-ads-blue text-ads-text">
          Försök igen
        </button>
      </div>`;
  }
  if (!_gk.laddad) return '';
  if (!_gk.rader.length) {
    return `<div class="bg-white border border-ads-border rounded p-6 text-sm text-ads-muted">
      Projektet har inga aktiva granskningar.</div>`;
  }

  return `
    <div class="flex items-center gap-3 mb-3 flex-wrap">
      <div class="relative w-96 max-w-full">
        <svg class="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ads-muted" viewBox="0 0 20 20" fill="none"
             stroke="currentColor" stroke-width="1.5"><circle cx="8.5" cy="8.5" r="5.5"/><path stroke-linecap="round" d="M13 13l4 4"/></svg>
        <input value="${vkEsc(_gk.sok)}" oninput="gkSok(this.value)" placeholder="Sök efter granskningens namn, ID"
               class="w-full border border-ads-border rounded pl-8 pr-2.5 py-1.5 text-sm bg-white
                      focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
      </div>
      ${!_gk.floden ? `<span class="text-xs text-amber-600">
        Arbetsflödena gick inte att läsa, så kolumnerna Arbetsflöde och Steg är tomma.</span>` : ''}
      <button onclick="gkLas()" class="ml-auto text-sm text-ads-muted hover:text-ads-text">Läs om</button>
    </div>
    <div id="gk-tabell">${gkTabell()}</div>`;
}

function gkTabell() {
  const rader   = gkSorterade(gkSokta());
  const sidor   = Math.max(1, Math.ceil(rader.length / GK_PER_SIDA));
  if (_gk.sida >= sidor) _gk.sida = sidor - 1;
  const fran    = _gk.sida * GK_PER_SIDA;
  const synliga = rader.slice(fran, fran + GK_PER_SIDA);

  const rubrik = k => {
    const aktiv = _gk.sortera === k.falt;
    return `
      <th class="text-left font-medium px-3 py-2 whitespace-nowrap">
        <button onclick="gkSortera('${k.falt}')"
                class="inline-flex items-center gap-1 hover:text-ads-text ${aktiv ? 'text-ads-text' : ''}">
          ${k.rubrik}<span class="w-2 text-[10px]">${aktiv ? (_gk.fallande ? '↓' : '↑') : ''}</span>
        </button>
      </th>`;
  };

  return `
    <div class="bg-white border border-ads-border rounded overflow-auto">
      <table class="w-full text-sm">
        <thead class="bg-ads-gray text-ads-muted text-xs">
          <tr>${GK_KOLUMNER.map(rubrik).join('')}</tr>
        </thead>
        <tbody>
          ${synliga.map(gkRadHtml).join('')}
          ${!synliga.length ? `<tr><td colspan="${GK_KOLUMNER.length}" class="px-3 py-6 text-center text-ads-muted">
            Inga granskningar matchar sökningen.</td></tr>` : ''}
        </tbody>
      </table>
    </div>
    ${gkBladdring(rader.length, fran, synliga.length, sidor)}`;
}

function gkRadHtml(r) {
  const st   = GK_STATUS[r.status] || { text: r.status || '–', farg: 'bg-gray-300' };
  const sen  = r.forfaller && new Date(r.forfaller) < new Date();
  const td   = 'px-3 py-2 whitespace-nowrap';
  const text = (s, bredd) => s
    ? `<span class="block truncate ${bredd}" title="${vkEsc(s)}">${vkEsc(s)}</span>`
    : GK_TOM;
  const datum = iso => iso ? vkEsc(vkKortDatum(iso)) : GK_TOM;

  return `
    <tr class="border-t border-ads-border hover:bg-ads-gray/60">
      <td class="${td}">
        <span class="inline-flex items-center gap-2"><span class="w-1 h-5 rounded-sm ${st.farg}"></span>${vkEsc(st.text)}</span>
      </td>
      <td class="${td} tabular-nums">${vkEsc(r.nr)}</td>
      <td class="${td}">${text(r.namn, 'max-w-80')}</td>
      <td class="${td}">${text(r.arbetsflode, 'max-w-56')}</td>
      <td class="${td} tabular-nums">${r.stegNr
        ? `<span title="${vkEsc(r.stegNamn)}">${r.stegNr} av ${r.stegTotalt}</span>` : GK_TOM}</td>
      <td class="${td}">${text(r.initieradAv, 'max-w-40')}</td>
      <td class="${td}">${gkNastaHtml(r.nastaAtgard)}</td>
      <td class="${td}">${text(r.godkantAv, 'max-w-40')}</td>
      <td class="${td} tabular-nums ${sen ? 'text-red-600 font-medium' : ''}">${datum(r.forfaller)}</td>
      <td class="${td} tabular-nums">${datum(r.skapad)}</td>
      <td class="${td} tabular-nums">${datum(r.slutford)}</td>
    </tr>`;
}

function gkInitialer(namn) {
  return namn.split(/\s+/).filter(Boolean).map(d => d[0]).join('').slice(0, 2).toUpperCase() || '?';
}

// Samma namn får alltid samma färg.
function gkAvatarfarg(namn) {
  let h = 0;
  for (const c of namn) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return GK_AVATARFARGER[h % GK_AVATARFARGER.length];
}

// Personer visas med initialer som i ACC, roller och företag med namn. Hela
// listan står i rutan som visas när musen vilar på cellen.
function gkNastaHtml(lista) {
  if (!lista.length) return GK_TOM;
  const visa = lista.slice(0, 3);
  const rest = lista.length - visa.length;
  const alla = lista.map(a => a.namn + (a.typ === 'roll' ? ' (roll)' : a.typ === 'foretag' ? ' (företag)' : '')).join(', ');

  return `
    <span class="inline-flex items-center gap-1" title="${vkEsc(alla)}">
      ${visa.map(a => a.typ === 'person'
        ? `<span class="w-6 h-6 rounded-full inline-flex items-center justify-center text-[10px] font-semibold
                        ${gkAvatarfarg(a.namn)}">${vkEsc(gkInitialer(a.namn))}</span>`
        : `<span class="max-w-28 truncate rounded bg-gray-100 text-gray-600 text-[11px] px-1.5 py-0.5">${vkEsc(a.namn)}</span>`
      ).join('')}
      ${rest ? `<span class="text-[11px] text-ads-muted">+${rest}</span>` : ''}
    </span>`;
}

function gkBladdring(antal, fran, synliga, sidor) {
  const knapp = (sida, tecken, etikett, aktiv) => `
    <button onclick="gkBladdra(${sida})" ${aktiv ? '' : 'disabled'} aria-label="${etikett}"
            class="px-2 py-1 rounded hover:text-ads-text hover:bg-ads-gray
                   disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed">${tecken}</button>`;
  const forst = _gk.sida > 0;
  const sist  = _gk.sida < sidor - 1;
  const sok   = _gk.sok.trim();

  return `
    <div class="flex items-center justify-between mt-2 text-xs text-ads-muted">
      <span>
        ${antal ? `Visar ${fran + 1}–${fran + synliga} av ${antal}` : 'Visar 0'}
        ${sok ? ` · sökning bland ${_gk.rader.length} granskningar` : ''}
      </span>
      ${sidor > 1 ? `
        <span class="flex items-center gap-1">
          ${knapp(0, '«', 'Första sidan', forst)}
          ${knapp(_gk.sida - 1, '‹', 'Föregående sida', forst)}
          <span class="px-2">${_gk.sida + 1} av ${sidor}</span>
          ${knapp(_gk.sida + 1, '›', 'Nästa sida', sist)}
          ${knapp(sidor - 1, '»', 'Sista sidan', sist)}
        </span>` : ''}
    </div>`;
}
