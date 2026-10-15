// behorigheter.js — fliken Behörigheter.
//
// Granskar vem som har tillgång till vad i projektets mappar. Datan hämtas
// direkt från ACC eller läses ur ACC:s Excel-rapporter, och visas i tre lägen:
//   Bläddra  välj en person, roll eller ett företag och se mappträdet med nivåer
//   Jämför   skillnaderna i effektiv behörighet mellan två personer
//   Audit    direkta behörigheter som avviker från vad roll och företag ger
//
// Med data från ACC går behörigheterna också att ändra, och sparade ändringar
// kan återställas. Det ligger i behorigheter-skriv.js.
//
// Logiken ligger i behorigheter-modell.js och inläsningen i behorigheter-las.js.

const _bh = {
  perm:   null,   // { data, fel, filnamn } för behörigheterna
  medl:   null,   // { data, fel, filnamn } för medlemslistan
  acc:    null,   // { laddar, klara, kanda, fel } under hämtning från ACC
  data:   null,   // sammanslagen modell när översikten är öppen

  lage:         'browse',   // browse | diff | audit
  flik:         'persons',  // persons | roles | companies
  sokPrincipal: '',
  sokMapp:      '',
  doljTomma:    false,
  vald:         null,       // { kind, id, name, member? }
  valdMapp:     null,
  expanderade:  new Set(),
  visaArvda:    false,

  diffA:         null,
  diffB:         null,
  doljIdentiska: true,
  auditPerson:   null,

  valjare:   null,   // vilken personväljare som är öppen: A | B | audit
  valjarSok: '',
  ref:       [],     // objekt som onclick-attributen pekar på via index

  // Ändringar i ACC, se behorigheter-skriv.js
  andringar:   [],     // väntande ändringar
  dialog:      null,   // granska | kor | historik
  kor:         null,   // pågående eller avslutad skrivning
  logg:        null,   // sparade omgångar, läses från webbläsaren vid behov
  aterstaller: null,   // id för omgången som återställs
  nyTyp:       'ROLE', // vad "Lägg till behörighet" väljer bland
  massandring: false,
  markerade:   new Set(),
};

function bhReset() {
  _bh.perm = null;
  _bh.medl = null;
  _bh.acc  = null;
  bhNollstallAndringar();
  bhStangOversikt();
}

function bhNollstallAndringar() {
  _bh.andringar   = [];
  _bh.dialog      = null;
  _bh.kor         = null;
  _bh.logg        = null;
  _bh.aterstaller = null;
}

function bhStangOversikt() {
  _bh.data          = null;
  _bh.lage          = 'browse';
  _bh.flik          = 'persons';
  _bh.sokPrincipal  = '';
  _bh.sokMapp       = '';
  _bh.doljTomma     = false;
  _bh.vald          = null;
  _bh.valdMapp      = null;
  _bh.expanderade   = new Set();
  _bh.visaArvda     = false;
  _bh.diffA         = null;
  _bh.diffB         = null;
  _bh.doljIdentiska = true;
  _bh.auditPerson   = null;
  _bh.valjare       = null;
  _bh.valjarSok     = '';
  _bh.massandring   = false;
  _bh.markerade     = new Set();
}

// Finns en sparad hämtning för projektet öppnas den direkt.
async function bhOppnaFlik() {
  bhRita();
  if (_bh.perm || _bh.acc?.laddar || !_currentProject) return;
  const projektId = _currentProject.id;
  const post = await bhCacheLas(projektId);
  _bh.sparad = post ? { projektId, hamtad: post.hamtad } : null;
  if (!post || _currentProject?.id !== projektId || _bh.perm || _bh.acc?.laddar) return bhRita();
  bhOppnaSparad(post);
}

async function bhOppnaSparad(post) {
  post = post || await bhCacheLas(_currentProject?.id);
  if (!post) return;
  _bh.perm = { data: bhModellFranCache(post), filnamn: 'ACC' };
  _bh.medl = post.medlemmar ? { data: post.medlemmar, filnamn: 'ACC' } : null;
  _bh.acc  = { laddar: false };
  bhOppnaOversikt();
}

// Ny hämtning från ACC, från översikten.
function bhHamtaOm() {
  if (_bh.andringar.length && !confirm(`${_bh.andringar.length} ändringar väntar och försvinner. Hämta om från ACC ändå?`)) return;
  bhStangOversikt();
  bhHamtaFranAcc();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _bh.dialog) bhStangDialog();
});

function bhRef(obj) {
  return _bh.ref.push(obj) - 1;
}

// ── Inläsning ─────────────────────────────────────────────────────────────────

async function bhHamtaFranAcc() {
  _bh.acc  = { laddar: true, klara: 0, kanda: 0, fel: null };
  _bh.perm = null;
  _bh.medl = null;
  bhNollstallAndringar();
  bhRita();

  try {
    const data = await bhLasFranAcc(_currentProject, _hubs[_hubIdx].id, (klara, kanda) => {
      _bh.acc.klara = klara;
      _bh.acc.kanda = kanda;
      const el = document.getElementById('bh-framsteg');
      if (el) el.innerHTML = bhFramstegHtml();
    });
    _bh.perm = { data, filnamn: 'ACC' };
  } catch (err) {
    _bh.acc = { laddar: false, fel: err.message };
    bhRita();
    return;
  }

  // Medlemslistan är ett eget API med eget scope. Går den inte att läsa visas
  // ändå behörigheterna, och man kan lägga till medlemslistan som Excel.
  try {
    _bh.medl = { data: await bhLasMedlemmarFranAcc(_currentProject), filnamn: 'ACC' };
  } catch (err) {
    _bh.medl = { fel: bhMedlemsfel(err), filnamn: 'ACC' };
  }

  _bh.acc = { laddar: false };
  await bhCacheSpara(_currentProject.id, _bh.perm.data, _bh.medl?.data);
  _bh.sparad = { projektId: _currentProject.id, hamtad: _bh.perm.data.meta.hamtad };
  bhOppnaOversikt();
}

function bhMedlemsfel(err) {
  if (/APS error 403/.test(err.message)) {
    return 'Du saknar behörighet att läsa projektets medlemmar. Det kräver att du är projektadministratör, ' +
           'och om du loggade in före den här versionen behöver du logga ut och in igen.';
  }
  return err.message;
}

async function bhLasFiler(filer) {
  for (const fil of Array.from(filer || [])) {
    let wb;
    try {
      wb = XLSX.read(await fil.arrayBuffer(), { type: 'array' });
    } catch (err) {
      _bh.perm = { ..._bh.perm, fel: `Kunde inte läsa "${fil.name}": ${err.message}` };
      continue;
    }
    const typ = bhKlassaArbetsbok(wb);
    try {
      if (typ === 'permissions') _bh.perm = { data: bhLasBehorighetsrapport(wb), filnamn: fil.name };
      else if (typ === 'members') _bh.medl = { data: bhLasMedlemslista(wb), filnamn: fil.name };
      else _bh.perm = { ..._bh.perm, fel: `Okänd fil "${fil.name}". Hittade varken ett behörighets- eller medlemsblad.` };
    } catch (err) {
      if (typ === 'permissions') _bh.perm = { fel: err.message, filnamn: fil.name };
      else _bh.medl = { fel: err.message, filnamn: fil.name };
    }
  }
  if (_bh.data) bhOppnaOversikt();
  else bhRita();
}

function bhSlapp(event) {
  event.preventDefault();
  bhLasFiler(event.dataTransfer.files);
}

function bhOppnaOversikt() {
  if (!_bh.perm?.data) return;
  const perm = _bh.perm.data;
  const forraLage = _bh.data ? _bh.lage : 'browse';
  bhStangOversikt();
  _bh.data = { ...perm, matchedMembers: bhMatchaMedlemmar(_bh.medl?.data, perm) };
  _bh.lage = _bh.data.matchedMembers ? forraLage : 'browse';
  _bh.expanderade = new Set(perm.rootPaths);
  bhRita();
}

function bhNyInlasning() {
  if (_bh.andringar.length && !confirm(`${_bh.andringar.length} ändringar väntar och försvinner. Läsa in på nytt ändå?`)) return;
  bhReset();
  bhRita();
}

// ── Händelser ─────────────────────────────────────────────────────────────────

function bhSattLage(lage) {
  if (lage !== 'browse' && !_bh.data?.matchedMembers) return;
  _bh.lage    = lage;
  _bh.valjare = null;
  bhRita();
}

function bhSattFlik(flik) {
  _bh.flik = flik;
  _bh.sokPrincipal = '';
  bhRita();
}

function bhSokPrincipal(text) {
  _bh.sokPrincipal = text;
  const el = document.getElementById('bh-principaler');
  if (el) el.innerHTML = bhPrincipalListaHtml();
}

function bhValjPrincipal(ref) {
  _bh.vald = _bh.ref[ref];
  bhRita();
}

function bhAvmarkera() {
  _bh.vald      = null;
  _bh.doljTomma = false;
  bhRita();
}

function bhSokMapp(text) {
  _bh.sokMapp = text;
  bhRitaTrad();
}

function bhVaxla(ref) {
  const path = _bh.ref[ref];
  if (_bh.expanderade.has(path)) _bh.expanderade.delete(path);
  else _bh.expanderade.add(path);
  bhRitaTrad();
}

function bhValjMapp(ref) {
  _bh.valdMapp = _bh.ref[ref];
  bhRita();
}

function bhStangMapp() {
  _bh.valdMapp = null;
  bhRita();
}

function bhExpanderaAllt() {
  _bh.expanderade = new Set(_bh.data.folders.keys());
  bhRitaTrad();
}

function bhFallIhop() {
  _bh.expanderade = new Set(_bh.data.rootPaths);
  bhRitaTrad();
}

function bhVaxlaDoljTomma() {
  _bh.doljTomma = !_bh.doljTomma;
  bhRita();
}

function bhVaxlaArvda() {
  _bh.visaArvda = !_bh.visaArvda;
  bhRita();
}

function bhVaxlaIdentiska() {
  _bh.doljIdentiska = !_bh.doljIdentiska;
  bhRita();
}

function bhOppnaValjare(id) {
  _bh.valjare   = _bh.valjare === id ? null : id;
  _bh.valjarSok = '';
  bhRita();
  document.getElementById('bh-valjare-sok')?.focus();
}

function bhSokValjare(text) {
  _bh.valjarSok = text;
  const el = document.getElementById('bh-valjare-lista');
  if (el) el.innerHTML = bhValjarListaHtml();
}

function bhValjPerson(ref) {
  const m = _bh.ref[ref];
  if (_bh.valjare === 'A') _bh.diffA = m;
  if (_bh.valjare === 'B') _bh.diffB = m;
  if (_bh.valjare === 'audit') _bh.auditPerson = m;
  _bh.valjare = null;
  bhRita();
}

function bhByt() {
  [_bh.diffA, _bh.diffB] = [_bh.diffB, _bh.diffA];
  bhRita();
}

function bhLaggTillMedlemsfil(input) {
  bhLasFiler(input.files);
}

// ── Export ────────────────────────────────────────────────────────────────────

function bhExportera(format) {
  const d = _bh.data;
  if (!d) return;
  const ts      = new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '');
  const projekt = bhBladnamn(d.meta.projectName).slice(0, 40);
  const slug    = s => String(s).replace(/[\\/?*[\]:\s]+/g, '_').slice(0, 40);
  const spara   = (inneh, namn) => format === 'xlsx'
    ? bhLaddaNer(new Blob([XLSX.write(inneh, { type: 'array', bookType: 'xlsx' })]), `${namn}.xlsx`)
    : bhLaddaNer(inneh, `${namn}.md`, 'text/markdown');

  if (_bh.lage === 'browse') {
    const rader = bhSynligaRader();
    const namn  = `${projekt}_behorigheter_${slug(_bh.vald?.name || 'alla')}_${ts}`;
    spara(format === 'xlsx' ? bhExportBladdraXlsx(d, rader, _bh.vald) : bhExportBladdraMd(d, rader, _bh.vald), namn);
  } else if (_bh.lage === 'diff' && _bh.diffA && _bh.diffB) {
    const diff = bhJamfor(d, _bh.diffA, _bh.diffB);
    const namn = `${projekt}_jamfor_${slug(_bh.diffA.name)}_vs_${slug(_bh.diffB.name)}_${ts}`;
    spara(format === 'xlsx' ? bhExportJamforXlsx(d, _bh.diffA, _bh.diffB, diff) : bhExportJamforMd(d, _bh.diffA, _bh.diffB, diff), namn);
  } else if (_bh.lage === 'audit' && _bh.auditPerson) {
    const audit = bhAudit(d, _bh.auditPerson);
    const namn  = `${projekt}_audit_${slug(_bh.auditPerson.name)}_${ts}`;
    spara(format === 'xlsx' ? bhExportAuditXlsx(d, _bh.auditPerson, audit) : bhExportAuditMd(d, _bh.auditPerson, audit), namn);
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function bhRita() {
  _bh.ref = [];
  document.getElementById('main-content').innerHTML = _bh.data ? bhOversiktHtml() : bhStartHtml();
}

function bhRitaTrad() {
  const el = document.getElementById('bh-trad');
  if (el) el.innerHTML = bhTradHtml();
}

function bhBadge(level, dimmad = false, liten = false) {
  if (!level) return '';
  const p = BH_PERM[level];
  const storlek = liten ? 'text-[10px] px-1 min-w-[20px]' : 'text-[11px] px-1.5 py-0.5 min-w-[24px]';
  if (!p) return `<span class="inline-flex justify-center rounded font-mono bg-red-100 text-red-700 ${storlek}" title="Okänd nivå">${vkEsc(level)}</span>`;
  return `<span title="${p.label}"
                class="inline-flex items-center justify-center rounded font-mono font-semibold tracking-tight
                       ${p.bg} ${p.text} ${storlek} ${dimmad ? 'opacity-60' : ''}">${level}</span>`;
}

const BH_VIA_TON = {
  direct:       'text-emerald-700 bg-emerald-50',
  user:         'text-emerald-700 bg-emerald-50',
  role:         'text-blue-700 bg-blue-50',
  company:      'text-violet-700 bg-violet-50',
  everyone:     'text-slate-600 bg-slate-100',
  projectAdmin: 'text-amber-800 bg-amber-50',
};
const BH_VIA_KORT = { role: 'R', company: 'F', everyone: 'A', projectAdmin: '♛' };

function bhViaTagg(via) {
  if (!BH_VIA_KORT[via]) return '';
  return `<span class="inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-semibold ${BH_VIA_TON[via]}"
                title="${BH_VIA[via]}">${BH_VIA_KORT[via]}</span>`;
}

const BH_KRONA = '<span class="text-amber-600 text-xs" title="Projektadministratör">♛</span>';

function bhAktiv(status) {
  return !status || /^(aktiv|active)$/i.test(status);
}

function bhKnapp(onclick, text, extra = '') {
  return `<button onclick="${onclick}" ${extra}
                  class="text-xs border border-ads-border rounded px-2.5 py-1.5 bg-white text-ads-text
                         hover:border-ads-blue transition-colors disabled:opacity-40 disabled:cursor-not-allowed">${text}</button>`;
}

// ── Startvy ───────────────────────────────────────────────────────────────────

function bhFramstegHtml() {
  const { klara = 0, kanda = 0 } = _bh.acc || {};
  const pct = kanda ? Math.round(100 * klara / kanda) : 0;
  return `
    <div class="flex items-center justify-between text-xs text-ads-muted mb-1.5">
      <span>Läser mappar och behörigheter…</span>
      <span class="font-mono">${klara.toLocaleString('sv')} / ${kanda ? kanda.toLocaleString('sv') : '?'}</span>
    </div>
    <div class="h-1.5 bg-ads-gray rounded overflow-hidden">
      <div class="h-full bg-ads-blue transition-all" style="width:${pct}%"></div>
    </div>
    <p class="text-[11px] text-ads-muted mt-2">Antalet mappar växer medan trädet gås igenom.</p>`;
}

function bhFilkort(titel, tillstand, standardtext, antal) {
  const s = tillstand?.fel ? 'fel' : tillstand?.data ? 'klar' : 'tom';
  const stil = {
    tom:  ['border-ads-border bg-white',        '<span class="text-ads-muted text-xs">Väntar</span>'],
    klar: ['border-emerald-300 bg-emerald-50/40', '<span class="text-emerald-700 text-xs">✓ Inläst</span>'],
    fel:  ['border-red-300 bg-red-50',          '<span class="text-red-700 text-xs">Fel</span>'],
  }[s];
  const under = tillstand?.fel ? vkEsc(tillstand.fel)
    : tillstand?.data ? `${vkEsc(tillstand.filnamn)} · ${antal(tillstand.data)}`
    : standardtext;
  return `
    <div class="flex items-center gap-3 p-3 rounded border ${stil[0]}">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-ads-text">${titel}</div>
        <div class="text-[11px] text-ads-muted">${under}</div>
      </div>
      ${stil[1]}
    </div>`;
}

function bhStartHtml() {
  const acc = _bh.acc || {};
  const harExcel = _bh.perm?.data && _bh.perm.filnamn !== 'ACC';

  const accKort = acc.laddar
    ? `<div id="bh-framsteg">${bhFramstegHtml()}</div>`
    : `
      <p class="text-sm text-ads-muted mb-4">
        Läser mappträdet och behörigheterna för varje mapp direkt från projektet, plus medlemmarna
        med roller och företag. Stora projekt kan ta någon minut.
      </p>
      ${acc.fel ? `<p class="text-sm text-red-600 mb-3">Det gick inte att hämta: ${vkEsc(acc.fel)}</p>` : ''}
      <div class="flex items-center gap-3 flex-wrap">
        <button onclick="bhHamtaFranAcc()"
                class="bg-be-charcoal hover:bg-black text-white text-sm font-medium py-2 px-4 rounded transition-colors">
          Hämta från ACC
        </button>
        ${_bh.sparad && _bh.sparad.projektId === _currentProject?.id ? `
          <button onclick="bhOppnaSparad()" class="border border-ads-border bg-white hover:border-ads-blue text-sm py-2 px-4 rounded">
            Öppna sparad, hämtad ${vkEsc(bhHamtadText(_bh.sparad.hamtad))}
          </button>` : ''}
      </div>`;

  return `
    <div class="max-w-5xl mx-auto px-6 py-8">
      <div class="mb-6">
        <h2 class="text-lg font-semibold text-ads-text">Behörigheter</h2>
        <p class="text-ads-muted text-sm mt-0.5">
          Se vem som har tillgång till vad i projektets mappar, jämför två personer och hitta
          direkta behörigheter som avviker från roll och företag.
        </p>
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        <div class="bg-white border border-ads-border rounded p-5">
          <h3 class="text-sm font-semibold text-ads-text mb-2">Direkt från ACC</h3>
          ${accKort}
        </div>

        <div class="bg-white border border-ads-border rounded p-5 ${acc.laddar ? 'opacity-50 pointer-events-none' : ''}">
          <h3 class="text-sm font-semibold text-ads-text mb-2">Från Excel-rapporter</h3>
          <label ondragover="event.preventDefault()" ondrop="bhSlapp(event)"
                 class="block cursor-pointer border-2 border-dashed border-ads-border rounded p-5 text-center mb-3
                        hover:border-ads-blue transition-colors">
            <input type="file" accept=".xlsx,.xls" multiple class="hidden" onchange="bhLasFiler(this.files)" />
            <p class="text-sm font-medium text-ads-text">Släpp filer här</p>
            <p class="text-xs text-ads-muted">eller klicka för att välja · båda filerna går bra samtidigt</p>
          </label>
          <div class="space-y-2 mb-3">
            ${bhFilkort('Behörighetsrapport', harExcel || _bh.perm?.fel ? _bh.perm : null,
                        'Mappbehörigheter / Folder permissions',
                        d => `${d.stats.folders.toLocaleString('sv')} mappar`)}
            ${bhFilkort('Medlemslista', _bh.medl?.filnamn !== 'ACC' ? _bh.medl : null,
                        'Project member summary (valfri men rekommenderad)',
                        d => `${d.members.length} medlemmar`)}
          </div>
          <button onclick="bhOppnaOversikt()" ${harExcel ? '' : 'disabled'}
                  class="w-full text-sm font-medium py-2 rounded transition-colors
                         ${harExcel ? 'bg-be-charcoal hover:bg-black text-white' : 'bg-ads-gray text-ads-muted cursor-not-allowed'}">
            ${!harExcel ? 'Lägg till behörighetsrapporten för att fortsätta'
              : _bh.medl?.data ? 'Öppna med effektiv behörighet →' : 'Öppna (begränsat utan medlemslista) →'}
          </button>
          <p class="text-[11px] text-ads-muted mt-3">
            ACC: Account Admin → Reports → <span class="font-mono">Folder permissions</span> och
            <span class="font-mono">Project member summary</span>.
          </p>
        </div>
      </div>
    </div>`;
}

// ── Översikt ──────────────────────────────────────────────────────────────────

function bhOversiktHtml() {
  const d    = _bh.data;
  const mm   = d.matchedMembers;
  const knapp = (lage, text) => {
    const av    = lage !== 'browse' && !mm;
    const aktiv = _bh.lage === lage;
    return `<button onclick="bhSattLage('${lage}')" ${av ? 'disabled title="Kräver medlemslista"' : ''}
                    class="px-2.5 py-1 text-xs font-medium rounded transition-all
                           ${aktiv ? 'bg-white text-ads-text shadow-sm' : av ? 'text-ads-muted/50 cursor-not-allowed' : 'text-ads-muted hover:text-ads-text'}">${text}</button>`;
  };
  const exportAv = (_bh.lage === 'diff' && !(_bh.diffA && _bh.diffB)) || (_bh.lage === 'audit' && !_bh.auditPerson);

  return `
    <div class="flex flex-col bg-white" style="height: calc(100vh - 3rem)">
      <div class="shrink-0 border-b border-ads-border px-4 py-2.5 flex items-center gap-4 flex-wrap">
        <div class="min-w-0">
          <div class="font-semibold text-sm text-ads-text leading-tight truncate">${vkEsc(d.meta.projectName)}</div>
          <div class="text-[10px] text-ads-muted leading-tight">
            ${d.meta.kalla === 'ACC' && d.meta.hamtad
              ? `Mappstruktur hämtad ${vkEsc(bhHamtadText(d.meta.hamtad))} ·
                 <button onclick="bhHamtaOm()" class="text-ads-blue hover:underline">Hämta om från ACC</button>`
              : `${d.meta.kalla === 'ACC' ? 'Från ACC' : 'Från Excel'}
                 ${d.meta.exportDate ? ` · ${vkEsc(d.meta.exportDate)}` : ''}${d.meta.createdBy && d.meta.kalla !== 'ACC' ? ` · ${vkEsc(d.meta.createdBy)}` : ''}`}
          </div>
        </div>
        <div class="hidden lg:flex items-center gap-3 pl-4 border-l border-ads-border text-xs text-ads-muted">
          <span><b class="font-mono text-ads-text">${d.stats.folders.toLocaleString('sv')}</b> mappar</span>
          ${mm ? `<span><b class="font-mono text-ads-text">${mm.members.length}</b> personer</span>` : ''}
          <span><b class="font-mono text-ads-text">${d.stats.roles}</b> roller</span>
          <span><b class="font-mono text-ads-text">${d.stats.companies}</b> företag</span>
          ${mm?.diagnostics.projectAdmins ? `<span class="text-amber-700">♛ <b class="font-mono">${mm.diagnostics.projectAdmins}</b> projektadmin</span>` : ''}
        </div>
        <div class="flex-1"></div>
        <div class="flex items-center bg-ads-gray rounded p-0.5">
          ${knapp('browse', 'Bläddra')}${knapp('diff', 'Jämför')}${knapp('audit', 'Audit')}
        </div>
        <div class="flex items-center gap-1.5">
          ${bhKnapp("bhExportera('xlsx')", 'Excel', exportAv ? 'disabled' : '')}
          ${bhKnapp("bhExportera('md')", 'Markdown', exportAv ? 'disabled' : '')}
          ${bhKnapp('bhNyInlasning()', 'Ny inläsning')}
        </div>
      </div>

      ${bhBannersHtml()}
      ${_bh.lage === 'browse' ? bhValdRadHtml() : ''}

      <div class="flex-1 flex min-h-0">
        ${_bh.lage === 'browse' ? bhBladdraHtml() : _bh.lage === 'diff' ? bhJamforHtml() : bhAuditHtml()}
      </div>
      ${bhAndringsradHtml()}
    </div>
    ${bhDialogHtml()}`;
}

function bhBannersHtml() {
  const d   = _bh.data;
  const mm  = d.matchedMembers;
  const ut  = [];
  const gul = inneh => `<div class="shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-900">${inneh}</div>`;

  if (!mm) {
    const varfor = _bh.medl?.fel ? `Medlemslistan kunde inte läsas: ${vkEsc(_bh.medl.fel)} ` : 'Utan medlemslista syns bara direkta behörigheter. ';
    ut.push(gul(`
      ${varfor}Lägg till <b>Project member summary</b> (.xlsx) för att få effektiv behörighet via roll, företag och projektadmin.
      <label class="ml-1 underline font-medium cursor-pointer">Välj fil…
        <input type="file" accept=".xlsx,.xls" class="hidden" onchange="bhLaggTillMedlemsfil(this)" />
      </label>`));
  }
  if (d.meta.olasta?.length) {
    ut.push(gul(`
      <details><summary class="cursor-pointer">${d.meta.olasta.length} mappar gick inte att läsa behörigheterna för,
        troligen för att du saknar behörighet att se dem. De visas i trädet utan nivåer.</summary>
        <div class="mt-1 max-h-32 overflow-y-auto font-mono text-[10px] text-ads-text">
          ${d.meta.olasta.slice(0, 100).map(o => `<div>${vkEsc(o.path)}</div>`).join('')}
        </div></details>`));
  }
  if (mm?.diagnostics.unmatchedRoles.length) {
    const lista = mm.diagnostics.unmatchedRoles;
    ut.push(gul(`
      <details><summary class="cursor-pointer">${lista.length} kopplingar mellan medlem och roll matchade inte någon roll
        i behörighetsdatan. Rollen har då inga mappbehörigheter, eller så stavas den olika.</summary>
        <div class="mt-1 max-h-32 overflow-y-auto font-mono text-[10px] text-ads-text">
          ${lista.slice(0, 50).map(u => `<div>${vkEsc(u.member)}: <span class="text-amber-800">${vkEsc(u.role)}</span></div>`).join('')}
          ${lista.length > 50 ? `<div class="text-ads-muted">… och ${lista.length - 50} till</div>` : ''}
        </div></details>`));
  }
  return ut.join('');
}

function bhValdRadHtml() {
  const v = _bh.vald;
  if (!v) return '';
  const m = v.member;
  return `
    <div class="shrink-0 bg-emerald-50 border-b border-emerald-200 px-4 py-2 flex items-center gap-2 text-xs text-emerald-800">
      <span class="font-medium">Visar mappar för:</span>
      <span class="font-semibold text-emerald-900">${vkEsc(v.name)}</span>
      ${m?.company ? `<span class="truncate">· ${vkEsc(m.company)}</span>` : ''}
      ${m?.matchedRoles.length ? `<span class="italic truncate text-emerald-700">· ${vkEsc(m.matchedRoles.map(r => r.name).join(', '))}</span>` : ''}
      ${m?.isProjectAdmin ? '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold text-[10px]">♛ PROJEKTADMIN</span>' : ''}
      <div class="flex-1"></div>
      <button onclick="bhAvmarkera()" class="px-1.5 rounded hover:bg-emerald-100" title="Avmarkera">✕</button>
    </div>`;
}

// ── Bläddra ───────────────────────────────────────────────────────────────────

function bhBladdraHtml() {
  const d  = _bh.data;
  const mm = d.matchedMembers;
  const flikar = [
    ['persons',   'Personer', mm ? mm.members.length : d.users.length],
    ['roles',     'Roller',   d.roles.length],
    ['companies', 'Företag',  d.companies.length],
  ];
  const sokText = { persons: 'person, företag, roll', roles: 'roll', companies: 'företag' }[_bh.flik];

  return `
    <aside class="w-72 shrink-0 border-r border-ads-border flex flex-col">
      <div class="flex border-b border-ads-border">
        ${flikar.map(([id, text, antal]) => `
          <button onclick="bhSattFlik('${id}')"
                  class="flex-1 py-2 text-xs font-medium relative
                         ${_bh.flik === id ? 'text-ads-text' : 'text-ads-muted hover:bg-ads-gray'}">
            ${text} <span class="font-mono text-[10px] ${_bh.flik === id ? 'text-ads-blue' : ''}">${antal}</span>
            ${_bh.flik === id ? '<span class="absolute bottom-0 left-2 right-2 h-0.5 bg-ads-blue rounded"></span>' : ''}
          </button>`).join('')}
      </div>
      <div class="p-2.5 border-b border-ads-border">
        <input type="search" placeholder="Sök ${sokText}…" value="${vkEsc(_bh.sokPrincipal)}"
               oninput="bhSokPrincipal(this.value)"
               class="w-full px-2.5 py-1.5 text-sm border border-ads-border rounded
                      focus:outline-none focus:ring-1 focus:ring-ads-blue" />
      </div>
      <div id="bh-principaler" class="flex-1 overflow-y-auto">${bhPrincipalListaHtml()}</div>
    </aside>

    <main class="flex-1 flex flex-col min-w-0">
      <div class="shrink-0 border-b border-ads-border px-3 py-2 flex items-center gap-2 bg-ads-gray/50">
        <input type="search" placeholder="Sök mapp…" value="${vkEsc(_bh.sokMapp)}" oninput="bhSokMapp(this.value)"
               class="flex-1 max-w-md px-2.5 py-1.5 text-sm border border-ads-border rounded bg-white
                      focus:outline-none focus:ring-1 focus:ring-ads-blue" />
        ${_bh.vald ? bhKnapp('bhVaxlaDoljTomma()', _bh.doljTomma ? 'Visar bara åtkomliga' : 'Dölj utan åtkomst') : ''}
        ${bhKanSkriva() ? bhKnapp('bhVaxlaMassandring()', _bh.massandring ? 'Avsluta massändring' : 'Massändring') : ''}
        <div class="ml-auto flex gap-1">
          <button onclick="bhExpanderaAllt()" class="px-2 py-1 text-[11px] text-ads-muted hover:text-ads-text">Expandera allt</button>
          <button onclick="bhFallIhop()" class="px-2 py-1 text-[11px] text-ads-muted hover:text-ads-text">Fäll ihop</button>
        </div>
      </div>
      ${_bh.massandring ? `<div id="bh-massrad" class="shrink-0 border-b border-ads-border px-3 py-2 flex items-center gap-2 flex-wrap bg-amber-50/60">${bhMassradHtml()}</div>` : ''}
      <div class="flex-1 overflow-y-auto py-1">
        ${_bh.vald ? '' : `
          <div class="m-3 p-3 rounded border border-ads-border bg-ads-gray/50 text-sm text-ads-text">
            <b>Välj en person, roll eller ett företag till vänster</b> för att se vad de har åtkomst till,
            eller <b>klicka på en mapp</b> för att se alla som har åtkomst till just den.
            ${d.matchedMembers ? '<span class="block mt-1 text-xs text-ads-muted">Med medlemslistan visas effektiv behörighet inklusive roller, företag och projektadmin.</span>' : ''}
          </div>`}
        <div id="bh-trad">${bhTradHtml()}</div>
      </div>
      <div class="shrink-0 border-t border-ads-border px-3 py-1.5 flex flex-wrap gap-x-3 gap-y-1">
        ${BH_PERM_ORDER.map(k => `<span class="flex items-center gap-1 text-[10px] text-ads-muted">${bhBadge(k, false, true)} ${BH_PERM[k].label}</span>`).join('')}
      </div>
    </main>

    ${_bh.valdMapp ? `<aside class="w-80 shrink-0 border-l border-ads-border flex flex-col">${bhMappdetaljHtml()}</aside>` : ''}`;
}

function bhPrincipalListaHtml() {
  const d  = _bh.data;
  const mm = d.matchedMembers;
  let poster;
  if (_bh.flik === 'persons' && mm) {
    poster = mm.members.map(m => ({
      p: { kind: 'member', id: m.email || m.name, name: m.name, member: m },
      meta: m.company,
      sub:  m.matchedRoles.map(r => r.name).join(', ') || m.roleNames.join(', '),
      admin: m.isProjectAdmin, status: m.status,
    }));
  } else {
    const [lista, kind] = { persons: [d.users, 'user'], roles: [d.roles, 'role'], companies: [d.companies, 'company'] }[_bh.flik];
    poster = lista.map(e => ({ p: { kind, id: e.id, name: e.name }, meta: e.email, admin: e.isProjectAdmin, status: e.status }));
  }

  const q = _bh.sokPrincipal.trim().toLowerCase();
  if (q) poster = poster.filter(x => [x.p.name, x.meta, x.sub].some(s => (s || '').toLowerCase().includes(q)));

  const ar = p => _bh.vald && _bh.vald.kind === p.kind && _bh.vald.id === p.id;
  const rad = (x, innehall) => `
    <button onclick="bhValjPrincipal(${bhRef(x.p)})"
            class="w-full px-3 py-2 text-left border-b border-ads-border/60 transition-colors
                   ${ar(x.p) ? 'bg-emerald-50 text-emerald-900' : 'text-ads-text hover:bg-ads-gray'}">${innehall}</button>`;

  // "Alla projektmedlemmar" finns bara i Excel-rapporten.
  const alla = d.meta.kalla === 'ACC' ? '' : rad({ p: { kind: 'everyone', id: null, name: 'Alla projektmedlemmar' } },
    '<span class="text-sm italic">Alla projektmedlemmar</span>');

  return alla + (poster.length ? poster.map(x => rad(x, `
      <div class="flex items-center gap-1.5">
        <span class="text-sm truncate ${ar(x.p) ? 'font-medium' : ''}">${vkEsc(x.p.name)}</span>
        ${x.admin ? BH_KRONA : ''}
        ${bhAktiv(x.status) ? '' : `<span class="text-[9px] uppercase px-1 rounded bg-ads-gray text-ads-muted">${vkEsc(x.status)}</span>`}
      </div>
      ${x.meta ? `<div class="text-[11px] text-ads-muted truncate">${vkEsc(x.meta)}</div>` : ''}
      ${x.sub ? `<div class="text-[10px] text-ads-muted/80 truncate italic">${vkEsc(x.sub)}</div>` : ''}`)).join('')
    : '<div class="p-4 text-sm text-ads-muted text-center">Inga träffar</div>');
}

// Mappar som syns i trädet just nu, i visningsordning. Används både för att
// rita trädet och för exporten, så att exporten blir det man ser.
function bhSynligaRader() {
  const d    = _bh.data;
  const vald = _bh.vald;
  const niva = new Map();
  const nivaFor = path => {
    if (!niva.has(path)) niva.set(path, bhNivaFor(d, path, vald));
    return niva.get(path);
  };

  let traffar = null;
  const q = _bh.sokMapp.trim().toLowerCase();
  if (q) {
    traffar = { egna: new Set(), forfader: new Set() };
    for (const [path, node] of d.folders) {
      if (!node.name.toLowerCase().includes(q)) continue;
      traffar.egna.add(path);
      for (let p = node.parentPath; p; p = d.folders.get(p)?.parentPath) traffar.forfader.add(p);
    }
  }

  let atkomliga = null;
  if (_bh.doljTomma && vald) {
    atkomliga = new Set();
    const besok = path => {
      let har = !!nivaFor(path);
      for (const c of d.folders.get(path).children) if (besok(c)) har = true;
      if (har) atkomliga.add(path);
      return har;
    };
    d.rootPaths.forEach(besok);
  }

  const rader = [];
  const ga = (path, depth) => {
    const node = d.folders.get(path);
    if (!node) return;
    if (traffar && !traffar.egna.has(path) && !traffar.forfader.has(path)) return;
    if (atkomliga && !atkomliga.has(path)) return;
    const oppen = _bh.expanderade.has(path) || !!traffar?.forfader.has(path);
    rader.push({ path, name: node.name, depth, perm: nivaFor(path), barn: node.children.length > 0, oppen });
    if (oppen) node.children.forEach(c => ga(c, depth + 1));
  };
  d.rootPaths.forEach(p => ga(p, 0));
  return rader;
}

function bhTradHtml() {
  const rader = bhSynligaRader();
  if (!rader.length) return '<div class="p-6 text-sm text-ads-muted text-center">Inga mappar att visa.</div>';
  return rader.map(r => {
    const ref    = bhRef(r.path);
    const arvd   = r.perm?.source === 'inherited';
    const valdes = _bh.valdMapp === r.path;
    const vantar = _bh.andringar.some(a => a.path === r.path);
    const ruta   = _bh.massandring
      ? `<input type="checkbox" onclick="event.stopPropagation()" onchange="bhMarkera(${ref}, this.checked)"
                ${_bh.markerade.has(r.path) ? 'checked' : ''} class="shrink-0 mr-1 accent-ads-blue" />`
      : '';
    return `
      <div onclick="bhValjMapp(${ref})"
           class="flex items-center gap-1 pr-2 py-1 cursor-pointer border-l-2
                  ${valdes ? 'bg-emerald-50 border-emerald-500' : 'border-transparent hover:bg-ads-gray'}"
           style="padding-left:${r.depth * 14 + 8}px">
        ${ruta}
        ${r.barn
          ? `<button onclick="event.stopPropagation(); bhVaxla(${ref})"
                     class="w-4 h-4 shrink-0 text-ads-muted hover:text-ads-text text-[10px]">${r.oppen ? '▾' : '▸'}</button>`
          : '<span class="w-4 shrink-0"></span>'}
        <svg class="w-4 h-4 shrink-0 ${r.perm || !_bh.vald ? 'text-ads-muted' : 'text-ads-border'}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
          <path stroke-linejoin="round" d="M2 6a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.4.6l.8.8a2 2 0 0 0 1.4.6H16a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/>
        </svg>
        <span class="flex-1 text-sm truncate ${r.perm || !_bh.vald ? 'text-ads-text' : 'text-ads-muted/70'} ${arvd ? 'italic' : ''}">${vkEsc(r.name)}</span>
        ${vantar ? '<span class="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Har väntande ändringar"></span>' : ''}
        ${r.perm ? `<span class="flex items-center gap-1 shrink-0">${r.perm.via !== 'user' ? bhViaTagg(r.perm.via) : ''}${bhBadge(r.perm.level, arvd)}</span>` : ''}
      </div>`;
  }).join('');
}

function bhMappdetaljHtml() {
  const d    = _bh.data;
  const path = _bh.valdMapp;
  const node = d.folders.get(path);
  if (!node) return '';
  const fel  = d.meta.olasta?.find(o => o.path === path);

  return `
    <div class="px-4 py-3 border-b border-ads-border flex items-start gap-2">
      <div class="flex-1 min-w-0">
        <div class="text-[10px] uppercase tracking-wider text-ads-muted font-semibold">Mappdetalj</div>
        <div class="font-semibold text-ads-text truncate">${vkEsc(node.name)}</div>
        <div class="font-mono text-[10px] text-ads-muted break-all leading-snug">${vkEsc(path)}</div>
      </div>
      <button onclick="bhStangMapp()" class="px-1.5 text-ads-muted hover:text-ads-text">✕</button>
    </div>
    <div class="flex-1 overflow-y-auto px-4 py-3">
      ${fel ? `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-3">Behörigheterna för den här mappen gick inte att läsa.</p>` : ''}
      ${_bh.vald?.kind === 'member'
        ? bhMedlemsHarkomstHtml(path, _bh.vald.member) + bhRedigeraPersonHtml(path, _bh.vald.member)
        : bhAllaMedAtkomstHtml(path) + bhLaggTillHtml(path)}
    </div>`;
}

function bhMedlemsHarkomstHtml(path, m) {
  const { effective: e, sources } = bhEffektivForMedlem(_bh.data, path, m);
  const sorterade = [...sources].sort((a, b) => bhRank(b.level) - bhRank(a.level));
  const rubrik = t => `<div class="text-[10px] uppercase tracking-wider text-ads-muted font-semibold mb-1.5">${t}</div>`;

  return `
    <div class="mb-4">
      ${rubrik('Effektiv behörighet')}
      ${e ? `
        <div class="flex items-center gap-2 p-2.5 bg-ads-gray/60 border border-ads-border rounded">
          ${bhBadge(e.level)}
          <div class="min-w-0">
            <div class="text-sm font-medium text-ads-text">${BH_PERM[e.level]?.label ?? `Okänd nivå: ${vkEsc(e.level)}`}</div>
            <div class="text-[11px] text-ads-muted">${BH_VIA[e.via] || e.via}${e.source === 'inherited' ? ` · ärvd från ${vkEsc(e.inheritedFrom.split('/').pop())}` : ''}</div>
          </div>
        </div>`
        : '<div class="p-2.5 bg-ads-gray/60 border border-ads-border rounded text-sm text-ads-muted italic">Ingen åtkomst till mappen</div>'}
    </div>

    <div class="mb-3 p-2.5 rounded bg-stone-50 border border-stone-200">
      ${rubrik('Person')}
      <div class="text-sm font-medium text-ads-text">${vkEsc(m.name)}</div>
      ${m.company ? `<div class="text-[11px] text-ads-muted">${vkEsc(m.company)}</div>` : ''}
      ${m.matchedRoles.length ? `<div class="text-[11px] text-ads-muted italic">${vkEsc(m.matchedRoles.map(r => r.name).join(', '))}</div>` : ''}
      ${m.isProjectAdmin ? '<div class="text-[11px] text-amber-700 font-medium mt-1">♛ Projektadministratör — administratör på alla mappar</div>' : ''}
    </div>

    ${rubrik('Härkomst <span class="normal-case font-normal">· alla källor</span>')}
    ${sorterade.length ? sorterade.map(s => {
      const ar = e && s.level === e.level && s.via === e.via && s.name === e.name;
      return `
        <div class="flex items-center gap-2 p-1.5 rounded ${ar ? 'bg-emerald-50 border border-emerald-200' : ''}">
          <div class="flex-1 min-w-0">
            <div class="text-[11px] text-ads-muted leading-tight">${BH_VIA[s.via] || s.via}</div>
            <div class="text-sm truncate ${ar ? 'font-medium' : ''} ${s.source === 'inherited' ? 'italic' : ''}">${vkEsc(s.name)}</div>
            ${s.source === 'inherited' ? `<div class="text-[10px] text-ads-muted">ärvd från ${vkEsc(s.inheritedFrom.split('/').pop())}</div>` : ''}
          </div>
          ${bhBadge(s.level, !ar)}
        </div>`;
    }).join('') : '<p class="text-xs text-ads-muted italic">Inga åtkomstkällor leder till mappen</p>'}`;
}

function bhAllaMedAtkomstHtml(path) {
  const a     = bhAtkomstTillMapp(_bh.data, path);
  const filtr = lista => _bh.visaArvda ? lista : lista.filter(x => x.source === 'direct');
  const grupp = (titel, lista, vad, kind) => {
    const syns = filtr(lista);
    return `
      <h3 class="text-xs font-semibold uppercase tracking-wider text-ads-muted mt-4 mb-2">
        ${titel} <span class="normal-case font-normal">· ${syns.length}${!_bh.visaArvda && lista.length > syns.length ? ` av ${lista.length}` : ''}</span>
      </h3>
      ${syns.length ? syns.map(x => `
        <div class="flex items-center justify-between gap-2 text-sm py-0.5">
          <div class="min-w-0">
            <div class="truncate ${x.source === 'inherited' ? 'text-ads-muted italic' : 'text-ads-text'}">${vkEsc(x.name)}</div>
            ${x.source === 'inherited' ? `
              <button onclick="bhValjMapp(${bhRef(x.inheritedFrom)})" class="text-[10px] text-ads-blue hover:underline truncate max-w-full"
                      title="Ändras på mappen den ärvs från">ärvd från ${vkEsc(x.inheritedFrom.split('/').pop())}</button>` : ''}
          </div>
          <div class="flex items-center gap-1 shrink-0">
            ${bhKanSkriva() && x.source === 'direct' ? bhRedigeraRadHtml(path, x, kind) : bhBadge(x.level, x.source === 'inherited')}
          </div>
        </div>`).join('')
        : `<p class="text-xs text-ads-muted italic">Inga ${vad} ${_bh.visaArvda ? 'har åtkomst' : 'satta direkt här'}</p>`}`;
  };

  return `
    <div class="flex items-center justify-between">
      <div class="text-[10px] uppercase tracking-wider text-ads-muted font-semibold">Åtkomst till mappen</div>
      <button onclick="bhVaxlaArvda()"
              class="text-[11px] px-2 py-0.5 rounded font-medium ${_bh.visaArvda ? 'bg-be-charcoal text-white' : 'bg-ads-gray text-ads-text'}">
        ${_bh.visaArvda ? 'Visa endast direkta' : 'Inkl. ärvda'}
      </button>
    </div>
    ${a.everyone && (_bh.visaArvda || a.everyone.source === 'direct') ? `
      <h3 class="text-xs font-semibold uppercase tracking-wider text-ads-muted mt-4 mb-2">Alla projektmedlemmar</h3>
      <div class="flex items-center justify-between text-sm">
        <span class="${a.everyone.source === 'inherited' ? 'text-ads-muted italic' : ''}">Alla i projektet</span>
        ${bhBadge(a.everyone.level, a.everyone.source === 'inherited')}
      </div>` : ''}
    ${grupp('Personer (direkt)', a.users, 'personer', 'user')}
    ${grupp('Roller', a.roles, 'roller', 'role')}
    ${grupp('Företag', a.companies, 'företag', 'company')}`;
}

// ── Personväljare (Jämför och Audit) ──────────────────────────────────────────

function bhValjareHtml(id, etikett, valt) {
  const oppen = _bh.valjare === id;
  return `
    <div class="relative flex-1 min-w-0">
      <div class="text-[10px] uppercase tracking-wider text-ads-muted font-semibold mb-1">${etikett}</div>
      <button onclick="bhOppnaValjare('${id}')"
              class="w-full px-3 py-2 text-left text-sm bg-white border rounded
                     ${oppen ? 'border-ads-blue ring-1 ring-ads-blue' : 'border-ads-border hover:border-ads-blue'}">
        ${valt ? `
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate">${vkEsc(valt.name)} ${valt.isProjectAdmin ? BH_KRONA : ''}</div>
              <div class="text-[10px] text-ads-muted truncate">${vkEsc(valt.company)}</div>
            </div>
            <span class="text-ads-muted text-xs">▾</span>
          </div>`
          : '<div class="flex justify-between text-ads-muted"><span>Välj person…</span><span class="text-xs">▾</span></div>'}
      </button>
      ${oppen ? `
        <div class="absolute z-20 mt-1 w-full bg-white border border-ads-border rounded shadow-lg max-h-80 flex flex-col">
          <div class="p-2 border-b border-ads-border">
            <input id="bh-valjare-sok" type="search" placeholder="Sök namn eller företag…" oninput="bhSokValjare(this.value)"
                   class="w-full px-2 py-1.5 text-sm border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue" />
          </div>
          <div id="bh-valjare-lista" class="overflow-y-auto flex-1">${bhValjarListaHtml()}</div>
        </div>` : ''}
    </div>`;
}

function bhValjarListaHtml() {
  const q = _bh.valjarSok.trim().toLowerCase();
  const alla = _bh.data.matchedMembers?.members || [];
  const traffar = (q ? alla.filter(m => m.name.toLowerCase().includes(q) || (m.company || '').toLowerCase().includes(q)) : alla).slice(0, 100);
  if (!traffar.length) return '<div class="p-3 text-sm text-ads-muted text-center">Inga träffar</div>';
  return traffar.map(m => `
    <button onclick="bhValjPerson(${bhRef(m)})" class="w-full px-3 py-1.5 text-left text-sm border-b border-ads-border/60 hover:bg-ads-gray">
      <div class="truncate">${vkEsc(m.name)} ${m.isProjectAdmin ? BH_KRONA : ''}</div>
      ${m.company ? `<div class="text-[10px] text-ads-muted truncate">${vkEsc(m.company)}</div>` : ''}
    </button>`).join('')
    + (traffar.length === 100 ? '<div class="p-2 text-[10px] text-ads-muted text-center italic">Visar de 100 första, sök för att smalna av</div>' : '');
}

function bhTomtLage(text, under = '') {
  return `
    <div class="p-12 text-center text-ads-muted">
      <p class="${under ? 'font-medium text-ads-text' : ''}">${text}</p>
      ${under ? `<p class="text-sm mt-1 max-w-md mx-auto">${under}</p>` : ''}
    </div>`;
}

// ── Jämför ────────────────────────────────────────────────────────────────────

function bhJamforHtml() {
  const a = _bh.diffA, b = _bh.diffB;
  const diff = a && b ? bhJamfor(_bh.data, a, b) : null;
  const stil = { onlyA: 'bg-rose-50 border-rose-400', onlyB: 'bg-sky-50 border-sky-400', different: 'bg-amber-50 border-amber-400' };
  const typ  = k => k === 'onlyA' ? `Endast ${vkEsc(a.name)}` : k === 'onlyB' ? `Endast ${vkEsc(b.name)}` : 'Olika nivå';
  const kolumn = (m, e) => `
    <div class="text-right min-w-[80px]">
      <div class="text-[10px] text-ads-muted uppercase tracking-wider truncate">${vkEsc(m.name.split(' ')[0])}</div>
      ${e ? bhBadge(e.level, e.source === 'inherited') : '<span class="text-ads-muted text-xs">–</span>'}
    </div>`;

  let kropp;
  if (!diff) kropp = bhTomtLage('Välj två personer för att se skillnaderna i deras åtkomst.');
  else if (!diff.rows.length) kropp = bhTomtLage('Identisk åtkomst', `${vkEsc(a.name)} och ${vkEsc(b.name)} har samma effektiva behörighet på alla mappar.`);
  else kropp = diff.rows.map(r => `
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-ads-border/60 border-l-2 ${stil[r.kind]}">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate">${vkEsc(r.path.split('/').pop())}</div>
        <div class="text-[10px] font-mono text-ads-muted truncate">${vkEsc(r.path)}</div>
      </div>
      <div class="text-[10px] uppercase tracking-wider text-ads-muted font-semibold shrink-0">${typ(r.kind)}</div>
      ${kolumn(a, r.a)}${kolumn(b, r.b)}
    </div>`).join('');

  return `
    <div class="flex-1 flex flex-col min-h-0">
      <div class="shrink-0 p-4 border-b border-ads-border">
        <div class="flex items-end gap-2">
          ${bhValjareHtml('A', 'Person A', a)}
          <button onclick="bhByt()" class="p-2 rounded border border-ads-border hover:border-ads-blue text-ads-muted" title="Byt plats">⇄</button>
          ${bhValjareHtml('B', 'Person B', b)}
        </div>
        ${diff ? `
          <div class="flex items-center gap-3 text-xs text-ads-muted pt-3 mt-3 border-t border-ads-border/60">
            <span class="font-medium text-ads-text">Skillnader:</span>
            <span><span class="inline-block w-2 h-2 rounded-full bg-rose-400 mr-1"></span>Endast A: <b class="font-mono">${diff.summary.onlyA}</b></span>
            <span><span class="inline-block w-2 h-2 rounded-full bg-sky-400 mr-1"></span>Endast B: <b class="font-mono">${diff.summary.onlyB}</b></span>
            <span><span class="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1"></span>Olika nivå: <b class="font-mono">${diff.summary.different}</b></span>
            <span>· Identisk: <span class="font-mono">${diff.summary.same}</span></span>
          </div>` : ''}
      </div>
      <div class="flex-1 overflow-y-auto">${kropp}</div>
    </div>`;
}

// ── Audit ─────────────────────────────────────────────────────────────────────

const BH_AUDIT_STIL = {
  upward:     { ram: 'border-rose-300 bg-rose-50',   text: 'text-rose-900',  hjalp: 'Direkta behörigheter som ger mer än vad roll, företag och "Alla" ger.' },
  soloDirect: { ram: 'border-amber-300 bg-amber-50', text: 'text-amber-900', hjalp: 'Personen har bara åtkomst via direkt behörighet, utan täckning från roll eller företag.' },
  downward:   { ram: 'border-slate-300 bg-slate-50', text: 'text-slate-700', hjalp: 'Direkta behörigheter som ligger under baslinjen. Avsiktlig begränsning?' },
};

function bhAuditHtml() {
  const m     = _bh.auditPerson;
  const audit = m ? bhAudit(_bh.data, m) : null;
  const skriv = bhKanSkriva() && !!bhSubjekt(m && { kind: 'member', member: m });

  let kropp;
  if (!m) {
    kropp = bhTomtLage('Välj en person för att granska hens direkta behörigheter.',
      'Auditen jämför personens direkta behörigheter med vad roll, företag och "Alla" ger som baslinje, och flaggar avvikelserna.');
  } else if (!audit.findings.length) {
    kropp = bhTomtLage('Inga avvikelser',
      `${vkEsc(m.name)} har inga direkta behörigheter som avviker från baslinjen.` +
      (m.userId == null ? '<span class="block mt-2 text-amber-700 text-xs">Personen har inga direkta behörigheter alls. All åtkomst kommer från roll och företag.</span>' : ''));
  } else {
    kropp = '<div class="p-3 space-y-4">' + ['upward', 'soloDirect', 'downward'].map(kind => {
      const fynd = audit.findings.filter(f => f.kind === kind);
      if (!fynd.length) return '';
      const s = BH_AUDIT_STIL[kind], t = BH_AUDIT_TYP[kind];
      return `
        <div>
          <div class="px-3 py-2 rounded-t border ${s.ram}">
            <div class="flex items-center">
              <span class="mr-1">${t.ikon}</span><span class="font-semibold text-sm ${s.text}">${t.etikett}</span>
              <span class="font-mono text-xs text-ads-muted ml-1">· ${fynd.length}</span>
              <div class="flex-1"></div>
              ${skriv ? `<button onclick="bhAuditTaBortAlla('${kind}')" class="text-[11px] border border-ads-border bg-white rounded px-2 py-0.5 hover:border-red-400">
                           Ta bort alla ${fynd.length} direkta</button>` : ''}
            </div>
            <p class="text-[11px] text-ads-muted italic mt-0.5">${s.hjalp}</p>
          </div>
          <div class="bg-white border border-t-0 ${s.ram.split(' ')[0]} rounded-b">
            ${fynd.map(f => {
              const dar  = f.directInheritedFrom || f.path;
              const vant = skriv && bhVantandeFor(dar, bhSubjekt({ kind: 'member', member: m }).subjectId);
              return `
              <div class="px-3 py-2 border-b border-ads-border/60 last:border-b-0 flex items-start gap-3">
               <div class="flex-1 min-w-0">
                <div class="font-mono text-[11px] text-ads-text break-all">${vkEsc(f.path)}</div>
                <div class="text-[10px] text-ads-muted mt-0.5">
                  Direkt: ${bhBadge(f.directLevel, false, true)}
                  ${f.directSource === 'inherited' ? `<span class="italic">(ärvd från ${vkEsc(f.directInheritedFrom.split('/').pop())})</span>` : ''}
                  ${f.baselineLevel
                    ? `<span class="mx-1">·</span>Baslinje: ${bhBadge(f.baselineLevel, false, true)} <span class="italic">via ${vkEsc(f.baselineSourceName || BH_VIA[f.baselineVia] || f.baselineVia)}</span>`
                    : '<span class="ml-1 italic text-amber-700">ingen baslinje</span>'}
                </div>
               </div>
               ${!skriv ? '' : vant
                 ? `<span class="shrink-0">${bhVantandeTagg(vant)}</span>`
                 : `<button onclick="bhAuditTaBort(${audit.findings.indexOf(f)})"
                            class="shrink-0 text-[11px] border border-ads-border rounded px-2 py-0.5 hover:border-red-400"
                            title="Tar bort den direkta behörigheten på ${vkEsc(dar.split('/').pop())}. Kvar blir det roll, företag och &quot;Alla&quot; ger.">Ta bort direkt</button>`}
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('') + '</div>';
  }

  return `
    <div class="flex-1 flex flex-col min-h-0">
      <div class="shrink-0 p-4 border-b border-ads-border">
        <div class="max-w-md">${bhValjareHtml('audit', 'Granska person', m)}</div>
        ${audit ? `
          <div class="flex items-center gap-4 mt-3 pt-3 border-t border-ads-border/60 text-xs">
            <span class="font-medium">Resultat:</span>
            <span>🔺 Uppåt: <b class="font-mono">${audit.summary.upward}</b></span>
            <span>🟡 Endast direkt: <b class="font-mono">${audit.summary.soloDirect}</b></span>
            <span>🔻 Nedåt: <b class="font-mono">${audit.summary.downward}</b></span>
            <span class="text-ads-muted">· ${audit.findings.length} flaggor</span>
          </div>` : ''}
      </div>
      <div class="flex-1 overflow-y-auto bg-stone-50">${kropp}</div>
    </div>`;
}
