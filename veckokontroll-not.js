// ── Veckokontroll: notering och issue ─────────────────────────────────────────
// Skriver ihop veckans avvikelser till en text som går att lämna vidare till
// projektgruppen, och kan lägga upp en issue i ACC.
//
// Texten är redigerbar innan den används. Det som skickas är alltid det som
// står i rutan, inte den ursprungliga texten.
//
// Del 5 av 5.

// Issues-API:t tillåter 100 tecken i rubriken och 1000 i beskrivningen.
const VK_ISSUE_RUBRIK_MAX = 100;
const VK_ISSUE_TEXT_MAX   = 1000;

// ── Texten ────────────────────────────────────────────────────────────────────

function vkByggNot(res, inst) {
  const s     = res.summering;
  const rader = [];
  const bp    = _vk.bp.rader || [];

  const avsnitt = (rubrik, poster) => {
    if (!poster.length) return;
    rader.push('', rubrik.toUpperCase(), ...poster.map(p => `- ${p}`));
  };

  rader.push(`VECKOKONTROLL MODELLER, ${inst.projekt?.namn || _currentProject?.attributes?.name || 'projektet'}`);
  rader.push(`Avläst ${vkDatum(res.tid)}${_profile?.email ? ` av ${_profile.email}` : ''}`);
  rader.push(res.forsta
    ? 'Första avläsningen i projektet, så allt räknas som nytt.'
    : `Jämfört med avläsningen ${vkDatum(res.forraTid)}. Åldersgräns ${res.grans} dagar.`);

  const ord = (n, en, fler) => `${n} ${n === 1 ? en : fler}`;

  rader.push('', 'SAMMANFATTNING');
  rader.push(`${ord(s.totalt, 'modell', 'modeller')} bevakas. ` +
    `${ord(s.uppdaterade, 'uppdaterad', 'uppdaterade')}, ` +
    `${ord(s.ovanforandrade, 'oförändrad', 'oförändrade')}, ` +
    `${ord(s.nya, 'ny', 'nya')}.`);
  const noter = [];
  if (s.gamla)      noter.push(`${s.gamla} äldre än ${res.grans} dagar`);
  if (s.saknasISet) noter.push(`${s.saknasISet} saknas i samordningen`);
  if (s.setEfter)   noter.push(`${s.setEfter} där samordningen ligger efter`);
  if (s.borttagna)  noter.push(`${ord(s.borttagna, 'försvunnen', 'försvunna')} sedan förra avläsningen`);
  if (s.utanfor)    noter.push(`${s.utanfor} i samordningen men utanför bevakade mappar`);
  rader.push(noter.length ? `Att åtgärda: ${noter.join(', ')}.` : 'Inga avvikelser att åtgärda.');

  avsnitt('Ej uppdaterade sedan förra avläsningen',
    res.rader.filter(r => r.ovanforandrad).map(r =>
      `${r.namn}, v${r.version}, senast uppladdad ${vkKortDatum(r.andrad)}${r.av ? ` av ${r.av}` : ''}` +
      `${r.alder != null ? `, ${r.alder} dagar gammal` : ''}`));

  avsnitt(`Äldre än ${res.grans} dagar`,
    res.rader.filter(r => r.gammal && !r.ovanforandrad).map(r =>
      `${r.namn}, v${r.version}, ${r.alder} dagar gammal`));

  avsnitt('Nya modeller',
    res.rader.filter(r => r.ny).map(r =>
      `${r.namn}, v${r.version}, uppladdad ${vkKortDatum(r.andrad)}${r.av ? ` av ${r.av}` : ''}` +
      `${r.forstaGangen ? ' (första uppladdningen)' : ''}`));

  avsnitt('Saknas i samordningen',
    res.rader.filter(r => r.saknasISet).map(r => `${r.namn}, v${r.version}, ligger i ${r.sokvag}`));

  avsnitt('Samordningen ligger efter',
    res.rader.filter(r => r.setEfter).map(r => {
      const efter = r.set.filter(x => x.arTip === false).map(x => `${x.namn} har v${x.version ?? '?'}`);
      return `${r.namn}: senaste versionen är v${r.version}, ${efter.join(', ')}`;
    }));

  avsnitt('Fel vid bearbetning i samordningen',
    res.rader.filter(r => r.setFel).map(r => `${r.namn}: modellen kunde inte bearbetas i model settet`));

  avsnitt('Försvunna sedan förra avläsningen',
    res.borttagna.map(m => `${m.namn}, senast v${m.version ?? '?'}${m.sokvag ? `, låg i ${m.sokvag}` : ''}`));

  avsnitt('I samordningen men utanför bevakade mappar',
    res.utanfor.map(m => `${m.namn} (${m.set.join(', ')})`));

  avsnitt('Vyer',
    res.vyer.rader.map(v => {
      if (!v.iFas && v.efter.length)
        return `${v.namn}: ${v.efter.map(d => `${d.namn} v${d.versionISet ?? '?'} av v${d.tipVersion ?? '?'}`).join(', ')}`;
      if (!v.iFas)
        return `${v.namn}: ${v.saknade.length} modeller saknas i vyn`;
      if (v.behoverBekraftas && !v.bekraftad)
        return `${v.namn}: i fas, men inte genomgången för v${v.setVersion}`;
      return `${v.namn}: i fas och genomgången`;
    }));

  avsnitt('Vyer som inte hittades', res.vyer.hittadeInte.map(v => v.namn));

  avsnitt('Baspunkt', bp.filter(r => r.status !== 'ok').map(r => {
    if (r.status === 'saknas')  return `${r.namn}: baspunktsfamiljen saknas i modellen`;
    if (r.status === 'fel')     return `${r.namn}: kunde inte läsas. ${r.fel}`;
    if (r.status === 'fel-lage') {
      const a = r.position?.avvikelse || {};
      const delar = ['x', 'y', 'z'].filter(k => a[k] != null && Math.abs(a[k]) > 0.001)
        .map(k => `${k.toUpperCase()} ${a[k] > 0 ? '+' : '-'}${vkMm(Math.abs(a[k]))} mm`);
      return `${r.namn}: baspunkten sitter fel, avvikelse ${delar.join(', ') || 'okänd'}`;
    }
    return `${r.namn}: ${r.status}`;
  }));

  if (bp.length && bp.every(r => r.status === 'ok')) {
    rader.push('', 'BASPUNKT', `- Rätt läge i samtliga ${bp.length} lästa modeller.`);
  }
  if (!bp.length && inst.baspunkt?.aktiv) {
    rader.push('', 'BASPUNKT', '- Inte kontrollerad i den här körningen.');
  }

  return rader.join('\n');
}

// Kort version som ryms i en issue-beskrivning.
function vkIssueBeskrivning(res) {
  const s = res.summering;
  const bp = _vk.bp.rader || [];
  const punkter = [];

  const lista = (rubrik, namn) => {
    if (!namn.length) return;
    punkter.push(`${rubrik}: ${namn.join(', ')}`);
  };

  lista('Ej uppdaterade', res.rader.filter(r => r.ovanforandrad).map(r => `${r.namn} (v${r.version}, ${r.alder} d)`));
  lista('Saknas i samordningen', res.rader.filter(r => r.saknasISet).map(r => r.namn));
  lista('Samordningen ligger efter', res.rader.filter(r => r.setEfter).map(r => r.namn));
  lista('Försvunna', res.borttagna.map(m => m.namn));
  lista('Vyer ur fas', res.vyer.rader.filter(v => !v.iFas).map(v => v.namn));
  lista('Baspunkt fel eller saknas', bp.filter(r => ['saknas', 'fel-lage'].includes(r.status)).map(r => r.namn));

  const ord = (n, en, fler) => `${n} ${n === 1 ? en : fler}`;
  const huvud = `Veckokontroll ${vkKortDatum(res.tid)}. ${ord(s.totalt, 'modell', 'modeller')}: ` +
    `${ord(s.uppdaterade, 'uppdaterad', 'uppdaterade')}, ` +
    `${ord(s.ovanforandrade, 'oförändrad', 'oförändrade')}, ${ord(s.nya, 'ny', 'nya')}.`;

  const text = [huvud, ...punkter].join('\n');
  return text.length > VK_ISSUE_TEXT_MAX
    ? text.slice(0, VK_ISSUE_TEXT_MAX - 40).trimEnd() + '\n(fortsättning i noteringen)'
    : text;
}

function vkIssueRubrik(res) {
  const s = res.summering;
  const antal = s.ovanforandrade + s.saknasISet + s.setEfter + s.borttagna + s.gamla;
  const bas = `Veckokontroll modeller ${vkKortDatum(res.tid)}`;
  const full = antal ? `${bas}: ${antal} avvikelser` : `${bas}: inga avvikelser`;
  return full.slice(0, VK_ISSUE_RUBRIK_MAX);
}

// ── Kortet ────────────────────────────────────────────────────────────────────

function vkRenderNot(res) {
  if (!res.rader.length && !res.borttagna.length) return '';

  const text = _vk.not.text ?? vkByggNot(res, _vk.installningar);

  return `
    <div class="bg-white border border-ads-border rounded p-5">
      <div class="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div>
          <h3 class="text-sm font-semibold text-ads-text">Notering till projektgruppen</h3>
          <p class="text-xs text-ads-muted mt-0.5 max-w-2xl">
            Sammanställd ur veckans avläsning. Ändra fritt innan du använder den, det som står i rutan
            är det som kopieras, sparas och hamnar i issuen.
          </p>
        </div>
        <button onclick="vkAterstallNot()"
                class="shrink-0 text-xs text-ads-muted hover:text-ads-text underline">Återställ texten</button>
      </div>

      <textarea id="vk-not-text" rows="14" oninput="vkNotAndrad(this.value)"
                class="w-full border border-ads-border rounded px-3 py-2 text-xs font-mono leading-relaxed
                       focus:outline-none focus:ring-1 focus:ring-ads-blue">${vkEsc(text)}</textarea>

      <div class="flex items-center gap-2 flex-wrap mt-3">
        <button onclick="vkKopieraNot()"
                class="text-sm border border-ads-border rounded px-3 py-1.5 hover:border-ads-blue text-ads-text">
          Kopiera
        </button>
        <button onclick="vkLaddaNerNot()"
                class="text-sm border border-ads-border rounded px-3 py-1.5 hover:border-ads-blue text-ads-text">
          Ladda ner
        </button>
        <button onclick="vkSparaNot()" ${_vk.not.sparar ? 'disabled' : ''}
                class="text-sm border border-ads-border rounded px-3 py-1.5 hover:border-ads-blue text-ads-text">
          ${_vk.not.sparar ? 'Sparar…' : 'Spara i projektet'}
        </button>
        <button onclick="vkVisaIssueRuta()"
                class="text-sm bg-ads-blue text-white rounded px-4 py-1.5 hover:bg-ads-blue-dark">
          Skapa issue i ACC
        </button>
      </div>

      ${_vk.not.sparadSom ? `
        <p class="text-[11px] text-green-700 mt-2">Sparad i projektet som ${vkEsc(_vk.not.sparadSom)}.</p>` : ''}
      ${_vk.not.issue ? `
        <p class="text-[11px] text-green-700 mt-2">Issue skapad: ${vkEsc(
          (_vk.not.issue.displayId ? `#${_vk.not.issue.displayId}` : _vk.not.issue.id) +
          (_vk.not.issue.title ? `, ${_vk.not.issue.title}` : ''))}</p>` : ''}
    </div>`;
}

function vkNotAndrad(text) {
  _vk.not.text = text;
}

function vkAterstallNot() {
  _vk.not.text = null;
  const el = document.getElementById('vk-not-text');
  if (el) el.value = vkByggNot(_vk.kor.resultat, _vk.installningar);
}

function vkNotTextNu() {
  return document.getElementById('vk-not-text')?.value
      ?? _vk.not.text
      ?? vkByggNot(_vk.kor.resultat, _vk.installningar);
}

async function vkKopieraNot() {
  const text = vkNotTextNu();
  try {
    await navigator.clipboard.writeText(text);
    vkToast('Noteringen är kopierad.');
  } catch {
    // Utan behörighet till urklipp får markering duga.
    const el = document.getElementById('vk-not-text');
    el?.select();
    vkToast('Kunde inte kopiera automatiskt. Texten är markerad, kopiera med Ctrl+C.', 'red');
  }
}

function vkNotFilnamn() {
  const d = new Date(_vk.kor.resultat?.tid || Date.now());
  const p = n => String(n).padStart(2, '0');
  return `veckokontroll-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.txt`;
}

function vkLaddaNerNot() {
  const blob = new Blob([vkNotTextNu()], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = vkNotFilnamn();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function vkSparaNot() {
  if (_vk.not.sparar) return;
  if (!_vk.lagring.mapp) { vkToast('Ingen mapp att spara i. Öppna inställningarna först.', 'red'); return; }

  _vk.not.sparar = true;
  vkRitaResultat();
  try {
    const namn = vkNotFilnamn();
    await writeTextFile(_currentProject.id, _vk.lagring.mapp.id, namn, vkNotTextNu(), null);
    _vk.not.sparadSom = `${_vk.lagring.mapp.sokvag || _vk.lagring.mapp.namn} / ${namn}`;
    vkToast('Noteringen är sparad i projektet.');
  } catch (err) {
    vkToast(`Kunde inte spara noteringen: ${vkFelText(err)}`, 'red');
  }
  _vk.not.sparar = false;
  vkRitaResultat();
}

// ── Issue ─────────────────────────────────────────────────────────────────────

async function vkVisaIssueRuta() {
  document.getElementById('vk-issue-ruta')?.remove();

  const d = document.createElement('div');
  d.id = 'vk-issue-ruta';
  d.className = 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4';
  d.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg">
      <h3 class="font-semibold text-ads-text mb-1">Skapa issue i ACC</h3>
      <p class="text-xs text-ads-muted mb-4">
        Issuen läggs upp i projektet och blir synlig för dem som har tillgång till Issues.
      </p>
      <div id="vk-issue-innehall" class="flex items-center gap-2 text-sm text-ads-muted py-6">
        <svg class="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
          <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
        </svg>Läser issuetyper från projektet…
      </div>
    </div>`;
  document.body.appendChild(d);

  try {
    const typer = await listIssueTypes(_currentProject.id);
    const val   = [];
    typer.filter(t => t.isActive !== false).forEach(t =>
      (t.subtypes || []).filter(st => st.isActive !== false).forEach(st =>
        val.push({ id: st.id, etikett: `${t.title} / ${st.title}` })));

    if (!val.length) {
      vkIssueInnehall(`<p class="text-sm text-red-600">Projektet har inga aktiva issuetyper att välja.</p>
        ${vkIssueKnappar(false)}`);
      return;
    }

    // Samordning är den rimliga typen för det här, om den finns.
    const forval = val.find(v => /samordn|coordinat/i.test(v.etikett))?.id || val[0].id;

    vkIssueInnehall(`
      <div class="space-y-3">
        <div>
          <label class="block text-[11px] text-ads-muted mb-1">Typ och subtyp</label>
          <select id="vk-issue-typ" class="w-full border border-ads-border rounded px-2.5 py-1.5 text-sm">
            ${val.map(v => `<option value="${vkEsc(v.id)}" ${v.id === forval ? 'selected' : ''}>${vkEsc(v.etikett)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-[11px] text-ads-muted mb-1">Rubrik, högst ${VK_ISSUE_RUBRIK_MAX} tecken</label>
          <input id="vk-issue-rubrik" maxlength="${VK_ISSUE_RUBRIK_MAX}"
                 value="${vkEsc(vkIssueRubrik(_vk.kor.resultat))}"
                 class="w-full border border-ads-border rounded px-2.5 py-1.5 text-sm"/>
        </div>
        <div>
          <label class="block text-[11px] text-ads-muted mb-1">
            Beskrivning, högst ${VK_ISSUE_TEXT_MAX} tecken
          </label>
          <textarea id="vk-issue-text" rows="7"
                    class="w-full border border-ads-border rounded px-2.5 py-1.5 text-xs font-mono"
                    >${vkEsc(vkIssueBeskrivning(_vk.kor.resultat))}</textarea>
          <p class="text-[10px] text-ads-muted mt-1">
            Kortfattad version. Hela noteringen är längre än vad en issue rymmer, spara den i projektet
            om den behövs i sin helhet.
          </p>
        </div>
      </div>
      ${vkIssueKnappar(true)}`);
  } catch (err) {
    vkIssueInnehall(`<p class="text-sm text-red-600">Kunde inte läsa issuetyper: ${vkEsc(vkFelText(err))}</p>
      ${vkIssueKnappar(false)}`);
  }
}

function vkIssueInnehall(html) {
  const el = document.getElementById('vk-issue-innehall');
  if (el) {
    el.className = '';
    el.innerHTML = html;
  }
}

function vkIssueKnappar(kanSkapa) {
  return `
    <div class="flex justify-end gap-2 mt-5">
      <button onclick="document.getElementById('vk-issue-ruta').remove()"
              class="text-sm text-ads-muted px-3 py-1.5 hover:text-ads-text">Avbryt</button>
      ${kanSkapa ? `
        <button id="vk-issue-btn" onclick="vkSkapaIssue()"
                class="text-sm bg-ads-blue text-white px-4 py-1.5 rounded hover:bg-ads-blue-dark">
          Skapa issue
        </button>` : ''}
    </div>`;
}

async function vkSkapaIssue() {
  const subtyp  = document.getElementById('vk-issue-typ')?.value;
  const rubrik  = document.getElementById('vk-issue-rubrik')?.value?.trim();
  const text    = document.getElementById('vk-issue-text')?.value?.trim();
  const knapp   = document.getElementById('vk-issue-btn');

  if (!subtyp || !rubrik) { vkToast('Rubrik och typ måste vara ifyllda.', 'red'); return; }

  if (knapp) { knapp.disabled = true; knapp.textContent = 'Skapar…'; }

  try {
    const issue = await createIssue(_currentProject.id, {
      title:          rubrik.slice(0, VK_ISSUE_RUBRIK_MAX),
      description:    (text || '').slice(0, VK_ISSUE_TEXT_MAX),
      issueSubtypeId: subtyp,
      status:         'open',
    });
    _vk.not.issue = issue;
    document.getElementById('vk-issue-ruta')?.remove();
    vkRitaResultat();
    vkToast('Issuen är skapad i ACC.');
  } catch (err) {
    if (knapp) { knapp.disabled = false; knapp.textContent = 'Skapa issue'; }
    vkToast(`Kunde inte skapa issuen: ${vkFelText(err)}`, 'red');
  }
}
