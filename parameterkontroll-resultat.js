// parameterkontroll-resultat.js — steg 4 i fliken Parameterkontroll:
// resultatet (del 5).
//
// Allt här ritas ur _pk.korning.resultat, som pkBerakna räknat fram. Varje
// siffra går att klicka sig ner till de element den bygger på. Det som inte
// täcks av kontrollen visas lika tydligt som det som gör det.

const PK_STATUS_VISNING = {
  komplett:    { text: 'Komplett',              cls: 'bg-green-100 text-green-800' },
  delvis:      { text: 'Delvis',                cls: 'bg-amber-100 text-amber-800' },
  ingetVarde:  { text: 'Inget värde',           cls: 'bg-orange-100 text-orange-800' },
  tom:         { text: 'Tom',                   cls: 'bg-orange-100 text-orange-800' },
  finnsInte:   { text: 'Finns inte i modellen', cls: 'bg-red-100 text-red-700' },
  ingaElement: { text: 'Inga element',          cls: 'bg-ads-gray text-ads-muted' },
  ejHamtad:    { text: 'Ej hämtad',             cls: 'bg-ads-gray text-ads-muted' },
};

const PK_BEDOMNING_VISNING = {
  'uppfyller':        { text: 'Uppfyller kraven', ikon: '✓', cls: 'bg-green-100 text-green-800' },
  'uppfyller-inte':   { text: 'Uppfyller inte',   ikon: '✗', cls: 'bg-red-100 text-red-700' },
  'ej-bedomd':        { text: 'Ej bedömd',        ikon: '–', cls: 'bg-ads-gray text-ads-muted' },
  'ofullstandig':     { text: 'Ofullständig',     ikon: '!', cls: 'bg-amber-100 text-amber-800' },
  'kunde-inte-lasas': { text: 'Kunde inte läsas', ikon: '!', cls: 'bg-red-100 text-red-700' },
};

function pkResUi() {
  _pk.ui.res ??= { vy: 'modell', baraAvvikelser: false, sok: '', oppnaModeller: new Set(), oppnaKategorier: new Set() };
  return _pk.ui.res;
}

function pkBricka(v, ikon = true) {
  return `<span class="inline-flex items-center gap-1 text-[11px] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap ${v.cls}">${ikon && v.ikon ? `<span aria-hidden="true">${v.ikon}</span>` : ''}${v.text}</span>`;
}

function pkStatusBricka(status) {
  return pkBricka(PK_STATUS_VISNING[status] || { text: status, cls: 'bg-ads-gray text-ads-muted' }, false);
}

function pkStapel(del, helt, bredd = 'w-28') {
  const p = helt ? Math.min(1000, pkPromille(del, helt)) : 0;
  const farg = !helt ? 'bg-ads-border' : del === helt ? 'bg-green-500' : p >= 800 ? 'bg-amber-400' : 'bg-orange-400';
  return `<span class="inline-flex items-center gap-2"><span class="${bredd} h-2 rounded-full bg-ads-gray overflow-hidden inline-block">
    <span class="block h-full ${farg}" style="width:${p / 10}%"></span></span><span class="text-xs text-ads-text tabular-nums w-14">${pkProcentText(del, helt)}</span></span>`;
}

// ── Steget ────────────────────────────────────────────────────────────────────

function pkResultatHtml() {
  const k = _pk.korning;
  if (k?.pagar) return pkKorningHtml(k);
  if (!k?.resultat) {
    const hinder = pkKanInteKora();
    return `
      <div class="bg-white border border-dashed border-ads-border rounded-lg px-6 py-12 text-center">
        <p class="text-sm text-ads-text font-medium">${k?.fel ? 'Körningen misslyckades' : 'Kontrollen är inte körd än'}</p>
        <p class="text-xs ${k?.fel ? 'text-red-600' : 'text-ads-muted'} mt-1">${pkEsc(k?.fel || hinder || 'Värdena hämtas från ACC när du kör kontrollen.')}</p>
        <div class="mt-3">${pkKnapp('Kör kontroll', 'pkKor()', { primar: true, av: !!hinder })}</div>
      </div>`;
  }
  const r = k.resultat;
  const ui = pkResUi();
  const vyKnapp = (v, text) => `<button onclick="pkResVy('${v}')" class="px-3 py-1.5 text-sm ${ui.vy === v ? 'bg-ads-blue text-white' : 'bg-white text-ads-text hover:bg-ads-gray'}">${text}</button>`;
  return `
    ${pkInaktuelltHtml()}
    ${r.sjalvkontroll.length ? `<div class="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
      <p class="font-semibold">Räknefel – kontakta Mahdi</p><p class="text-xs mt-1">Kontrollens egen kontroll av siffrorna stämmer inte, så resultatet ska inte användas.</p>
      <ul class="text-xs mt-1 list-disc pl-5">${r.sjalvkontroll.slice(0, 5).map(f => `<li>${pkEsc(f.modell)} · ${pkEsc(f.kategori)}${f.parameter ? ` · ${pkEsc(f.parameter)}` : ''}: ${pkEsc(f.fel)}</li>`).join('')}</ul></div>` : ''}
    ${pkSammanfattningHtml(k)}
    ${pkForstaKorningHtml(r)}
    <div class="flex items-center gap-3 my-4 flex-wrap">
      <div class="inline-flex border border-ads-border rounded overflow-hidden">${vyKnapp('modell', 'Per modell')}${vyKnapp('parameter', 'Per parameter')}${vyKnapp('disciplin', 'Per disciplin')}</div>
      <input type="search" value="${pkEsc(ui.sok)}" placeholder="Sök modell, kategori eller parameter…" oninput="pkResSok(this.value)"
             class="w-72 px-3 py-1.5 text-sm border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue bg-white"/>
      <label class="flex items-center gap-1.5 text-sm text-ads-text cursor-pointer"><input type="checkbox" ${ui.baraAvvikelser ? 'checked' : ''} onchange="pkResAvvikelser(this.checked)" class="accent-ads-blue"/> Visa bara avvikelser</label>
      <span class="ml-auto flex gap-2 flex-wrap">
        ${pkKnapp('+ Kategori', 'pkSnabbKategori()', { titel: 'Lägg till en kategori utan att gå tillbaka' })}
        ${pkKnapp('+ Parameter', 'pkSnabbParameter()', { titel: 'Lägg till ett krav utan att gå tillbaka' })}
        ${typeof pkExcelKnapp === 'function' ? pkExcelKnapp() : ''}
        ${typeof pkPdfKnapp === 'function' ? pkPdfKnapp() : ''}
        ${typeof pkMatpunktKnapp === 'function' ? pkMatpunktKnapp() : ''}
        ${typeof pkArendenKnapp === 'function' ? pkArendenKnapp() : ''}
      </span>
    </div>
    <div id="pk-res-vy">${pkResVyHtml()}</div>
    <div id="pk-tackning" class="mt-6">${pkTackningHtml(r)}</div>`;
}

function pkResVy(v) { pkResUi().vy = v; pkRitaKropp(); }
function pkResAvvikelser(pa) { pkResUi().baraAvvikelser = pa; pkRitaResVy(); }
function pkResSok(q) { pkResUi().sok = q; pkRitaResVy(); }

function pkRitaResVy() {
  const el = document.getElementById('pk-res-vy');
  if (el) el.innerHTML = pkResVyHtml();
}

function pkResVyHtml() {
  const ui = pkResUi();
  return ui.vy === 'parameter' ? pkPerParameterHtml() : ui.vy === 'disciplin' ? pkPerDisciplinHtml() : pkPerModellHtml();
}

// Under körningen ritas bara förloppet om.
function pkRitaResultatDelar() {
  const k = _pk.korning;
  const el = document.getElementById('pk-kropp');
  if (!el || _pk.steg !== 'resultat') return;
  if (k?.pagar) el.innerHTML = pkKorningHtml(k);
  else pkRitaKropp();
}

function pkEfterResultat() {}

function pkKorningHtml(k) {
  const rad = m => {
    const d = pkModellData(m.id);
    const steg = d?.fel ? { text: d.fel, cls: 'text-red-600' }
      : k.steg[m.id] === 'klar' ? { text: 'Klar', cls: 'text-green-700' }
      : k.steg[m.id] === 'hamtar' ? { text: 'Hämtar värden…', cls: 'text-ads-muted' }
      : d?.status === 'klar' ? { text: m.kategorier.length ? 'Väntar på tur' : 'Inga kategorier valda', cls: 'text-ads-muted' }
      : { text: PK_FORBEREDELSE_TEXT[d?.status] || 'Förbereds…', cls: 'text-ads-muted' };
    return `<li class="px-4 py-2 flex items-center gap-3 text-sm">${pkTypBricka(m.filtyp)}<span class="truncate flex-1 text-ads-text">${pkEsc(m.namn)}</span>
      <span class="text-xs ${steg.cls}">${pkEsc(steg.text)}</span></li>`;
  };
  return `
    <div class="bg-white border border-ads-border rounded-lg">
      <div class="px-4 py-3 border-b border-ads-border flex items-center gap-3">
        <svg class="animate-spin w-4 h-4 text-ads-blue" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/><path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/></svg>
        <p class="text-sm font-medium text-ads-text">Kontrollen körs</p>
        <p class="text-xs text-ads-muted">Du kan byta steg eller flik under tiden. Valen som gäller är de som fanns när du tryckte Kör.</p>
        <span class="ml-auto">${pkKnapp('Avbryt', 'pkAvbryt()')}</span>
      </div>
      <ul class="divide-y divide-ads-border">${k.setup.modeller.map(rad).join('')}</ul>
    </div>`;
}

function pkStorBokstav(s) {
  return s ? s[0].toLocaleUpperCase('sv') + s.slice(1) : s;
}

function pkInaktuelltHtml() {
  if (!pkResultatInaktuellt()) return '';
  const k = _pk.korning, nu = _pk.setup, da = k.setup;
  const delar = [];
  const katNu = nu.modeller.reduce((n, m) => n + m.kategorier.length, 0), katDa = da.modeller.reduce((n, m) => n + m.kategorier.length, 0);
  if (nu.modeller.length !== da.modeller.length) delar.push('modellerna');
  if (katNu !== katDa) delar.push('kategorierna');
  if (JSON.stringify([nu.kravprofil.krav, nu.kravprofil.regler]) !== JSON.stringify([da.kravprofil.krav, da.kravprofil.regler])) delar.push('kraven');
  if (JSON.stringify(nu.undantag) !== JSON.stringify(da.undantag)) delar.push('undantagen');
  if (nu.modeller.some(m => k.versioner[m.id] && pkModellData(m.id)?.version?.urn !== k.versioner[m.id])) delar.push('modellversionerna');
  return `
    <div class="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3 text-sm flex-wrap">
      <span class="text-ads-text"><b>Resultatet är inaktuellt.</b> ${delar.length ? `${pkStorBokstav(delar.join(', ').replace(/, ([^,]*)$/, ' och $1'))} har ändrats` : 'Valen har ändrats'} sedan körningen.
        Bara det som saknas hämtas.</span>
      <span class="ml-auto">${pkKnapp('Uppdatera', 'pkKor()', { primar: true })}</span>
    </div>`;
}

// ── Sammanfattning ────────────────────────────────────────────────────────────

function pkSammanfattningHtml(k) {
  const r = k.resultat, t = r.totalt;
  const bedomda = r.modeller.filter(m => ['uppfyller', 'uppfyller-inte'].includes(m.bedomning));
  const uppfyller = bedomda.filter(m => m.bedomning === 'uppfyller').length;
  const olasbara = r.modeller.filter(m => m.status !== 'klar').length;
  const forra = k.forra?.resultat && k.forra.signatur === k.signatur ? k.forra.resultat.totalt : null;
  const andring = forra && forra.kravVarden && t.kravVarden
    ? (t.ifyllda / t.kravVarden - forra.ifyllda / forra.kravVarden) * 100 : null;
  const kort = (rubrik, varde, under, extra = '') => `
    <div class="bg-white border border-ads-border rounded-lg px-4 py-3">
      <p class="text-[11px] uppercase tracking-wide text-ads-muted font-semibold">${rubrik}</p>
      <p class="text-2xl font-semibold text-ads-text mt-0.5 tabular-nums">${varde}</p>
      <p class="text-xs text-ads-muted mt-0.5">${under}</p>${extra}
    </div>`;
  return `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      ${kort('Ifyllnadsgrad', pkProcentText(t.ifyllda, t.kravVarden), `${pkTalText(t.ifyllda)} av ${pkTalText(t.kravVarden)} krävda värden`,
        andring !== null && Math.abs(andring) >= 0.05 ? `<p class="text-xs mt-1 ${andring > 0 ? 'text-green-700' : 'text-red-600'}">${andring > 0 ? '▲' : '▼'} ${Math.abs(andring).toFixed(1).replace('.', ',')} procentenheter sedan förra körningen</p>` : '')}
      ${kort('Klara element', pkProcentText(t.klara, t.kontrollerade), `${pkTalText(t.klara)} av ${pkTalText(t.kontrollerade)} element har alla värden`)}
      ${kort('Modeller', `${uppfyller} av ${bedomda.length}`, `uppfyller kraven${olasbara ? ` · ${olasbara} kunde inte läsas` : ''}`)}
      ${kort('Täckning', pkProcentText(t.kontrollerade, t.element), `${pkTalText(t.kontrollerade)} av ${pkTalText(t.element)} element kontrollerade <button onclick="document.getElementById('pk-tackning').scrollIntoView({behavior:'smooth'})" class="text-ads-blue hover:underline">Vad ingår inte?</button>`)}
    </div>
    <p class="text-xs text-ads-muted mt-2">Körd ${pkEsc(new Date(k.tid).toLocaleString('sv-SE'))} · kravprofil ${pkEsc(k.setup.kravprofil.namn)} · godkänt vid ${pkEsc(String(r.troskel).replace('.', ','))} % · mäter om värden finns, inte om de är korrekta.</p>`;
}

// En första körning där nästan allt saknas beror oftast på att varje krav
// gäller alla kategorier. Det sägs rakt ut, med vägen till lösningen.
function pkForstaKorningHtml(r) {
  const par = r.modeller.flatMap(m => m.kategorier.flatMap(k => k.parametrar.filter(p => p.antal > 0)));
  const utan = new Set(par.filter(p => ['ingetVarde', 'finnsInte', 'tom'].includes(p.status)).map(p => p.namn));
  const krav = _pk.korning.setup.kravprofil.krav.filter(k => !k.kategorier && utan.has(k.namn));
  if (krav.length < 3 || par.length < 10) return '';
  return `
    <div class="mt-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm flex items-center gap-3 flex-wrap">
      <span class="text-ads-text">${krav.length} krav har inga värden alls i vissa kategorier. Gäller de inte där? Varje krav gäller just nu alla valda kategorier.</span>
      <span class="ml-auto flex gap-3"><button onclick="pkGaTill('parametrar')" class="text-ads-blue hover:underline">Ändra vilka kategorier kraven gäller</button></span>
    </div>`;
}

// ── Per modell ────────────────────────────────────────────────────────────────

function pkResMatch(...texter) {
  const q = pkResUi().sok.trim().toLocaleLowerCase('sv');
  return !q || texter.some(t => String(t || '').toLocaleLowerCase('sv').includes(q));
}

function pkArAvvikelse(p) {
  return !['komplett', 'ingaElement'].includes(p.status);
}

function pkPerModellHtml() {
  const r  = _pk.korning.resultat;
  const ui = pkResUi();
  const kort = r.modeller.filter(m => pkResMatch(m.namn, m.disciplin, ...m.kategorier.flatMap(k => [k.namn, ...k.parametrar.map(p => p.namn)])))
    .filter(m => !ui.baraAvvikelser || m.bedomning !== 'uppfyller');
  if (!kort.length) return `<p class="text-sm text-ads-muted">Inget matchar.</p>`;
  return kort.map(m => {
    const i = pkNod(m.id);
    const oppen = ui.oppnaModeller.has(m.id);
    const n = m.nyckeltal;
    const b = PK_BEDOMNING_VISNING[m.bedomning];
    return `
      <div class="bg-white border border-ads-border rounded-lg mb-3 overflow-hidden">
        <button onclick="pkResModell(${i})" class="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-ads-gray/40 flex-wrap">
          <svg class="w-3.5 h-3.5 shrink-0 text-ads-muted transition-transform ${oppen ? 'rotate-90' : ''}" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/></svg>
          ${pkTypBricka(m.filtyp)}
          <span class="font-medium text-sm text-ads-text truncate min-w-0 flex-1">${pkEsc(m.namn)}</span>
          ${m.disciplin ? `<span class="text-xs text-ads-muted">${pkEsc(m.disciplin)}</span>` : ''}
          ${m.version ? `<span class="text-xs text-ads-muted">v${m.version.nummer ?? '?'}</span>` : ''}
          ${m.status === 'klar' ? `${pkStapel(n.ifyllda, n.kravVarden)}<span class="text-xs text-ads-muted w-36">${pkTalText(n.klara)} av ${pkTalText(n.kontrollerade)} element klara</span>` : ''}
          ${pkBricka(b)}
        </button>
        ${m.status !== 'klar' ? `<p class="px-4 pb-3 text-sm text-red-600">${pkEsc(m.fel || 'Modellen kunde inte läsas.')}</p>` : oppen ? pkModellKategorierHtml(m) : ''}
      </div>`;
  }).join('');
}

function pkResModell(i) {
  const id = pkNodId(i), s = pkResUi().oppnaModeller;
  if (s.has(id)) s.delete(id); else s.add(id);
  pkRitaResVy();
}

function pkResKategori(i, j) {
  const nyckel = `${pkNodId(i)}|${pkNodId(j).slice(4)}`, s = pkResUi().oppnaKategorier;
  if (s.has(nyckel)) s.delete(nyckel); else s.add(nyckel);
  pkRitaResVy();
}

function pkModellKategorierHtml(m) {
  const ui = pkResUi();
  const i = pkNod(m.id);
  const kat = m.kategorier.filter(k => pkResMatch(m.namn, k.namn, ...k.parametrar.map(p => p.namn)))
    .filter(k => !ui.baraAvvikelser || k.parametrar.some(pkArAvvikelse) || k.antal === 0);
  if (!kat.length) return `<p class="px-4 pb-3 text-sm text-ads-muted">Inga kategorier att visa.</p>`;
  return `
    <table class="w-full text-sm border-t border-ads-border">
      <thead><tr class="text-[11px] uppercase tracking-wide text-ads-muted text-left bg-ads-gray/50">
        <th class="px-4 py-2 font-semibold">Kategori</th><th class="px-2 py-2 font-semibold text-right">Element</th>
        <th class="px-2 py-2 font-semibold">Krav</th><th class="px-2 py-2 font-semibold">Ifyllt</th><th class="px-2 py-2 font-semibold">Klara element</th></tr></thead>
      <tbody>${kat.map(k => {
        const j = pkNod(`kat:${k.namn}`);
        const oppen = ui.oppnaKategorier.has(`${m.id}|${k.namn}`);
        const n = k.nyckeltal;
        const krav = k.parametrar.length;
        return `
          <tr class="border-t border-ads-border hover:bg-ads-gray/40 cursor-pointer" onclick="pkResKategori(${i}, ${j})">
            <td class="px-4 py-2"><span class="inline-flex items-center gap-2">
              <svg class="w-3 h-3 text-ads-muted transition-transform ${oppen ? 'rotate-90' : ''}" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/></svg>
              ${pkEsc(k.namn)}</span>${k.undantagna ? `<span class="text-[11px] text-ads-muted ml-1">(${k.undantagna} undantagna)</span>` : ''}</td>
            <td class="px-2 py-2 text-right tabular-nums">${k.antal === 0 ? '<span class="text-amber-700">0</span>' : pkTalText(k.kontrollerade)}</td>
            <td class="px-2 py-2 text-xs">${k.antal === 0 ? '<span class="text-amber-700">Inga element i den här versionen</span>' : `
              <b>${k.kompletta} av ${krav}</b> kompletta${k.delvis ? ` · ${k.delvis} delvis` : ''}${k.tomma ? ` · ${k.tomma} inget värde` : ''}${k.saknade ? ` · <span class="text-red-600">${k.saknade} finns inte</span>` : ''}`}</td>
            <td class="px-2 py-2">${k.antal ? pkStapel(n.ifyllda, n.kravVarden, 'w-24') : ''}</td>
            <td class="px-2 py-2 text-xs tabular-nums">${k.klara === null ? '–' : `${pkTalText(k.klara)} av ${pkTalText(k.kontrollerade)}`}</td>
          </tr>
          ${oppen ? `<tr><td colspan="5" class="px-4 pb-3 pt-1 bg-ads-gray/30">${pkParametrarIKategoriHtml(m, k)}</td></tr>` : ''}`;
      }).join('')}</tbody>
    </table>`;
}

function pkParametrarIKategoriHtml(m, k) {
  const ui = pkResUi();
  const i = pkNod(m.id), j = pkNod(`kat:${k.namn}`);
  const par = k.parametrar.filter(p => !ui.baraAvvikelser || pkArAvvikelse(p));
  return `
    <table class="w-full text-xs bg-white border border-ads-border rounded">
      <thead><tr class="text-left text-ads-muted"><th class="px-3 py-1.5 font-semibold">Parameter</th><th class="px-2 py-1.5 font-semibold">Status</th>
        <th class="px-2 py-1.5 font-semibold">Med värde</th><th class="px-2 py-1.5 font-semibold">Varifrån</th><th class="px-2 py-1.5 font-semibold">Anmärkning</th><th></th></tr></thead>
      <tbody>${par.map(p => {
        const info = m.kravInfo[p.namn] || {};
        const anm = [];
        if (info.liknande?.length) anm.push(`Liknande namn: ${info.liknande.slice(0, 2).join(', ')}`);
        if (info.datatyp?.ok === false) anm.push(`Annan datatyp i modellen (${info.datatyp.modell.join(', ')})`);
        const pi = pkNod(`par:${p.namn}`);
        return `
          <tr class="border-t border-ads-border">
            <td class="px-3 py-1.5 text-ads-text">${pkEsc(p.namn)}</td>
            <td class="px-2 py-1.5">${pkStatusBricka(p.status)}</td>
            <td class="px-2 py-1.5 tabular-nums">${pkTalText(p.medVarde)} av ${pkTalText(p.antal)}</td>
            <td class="px-2 py-1.5 text-ads-muted">${p.instans || p.typ ? [p.instans && `${pkTalText(p.instans)} instans`, p.typ && `${pkTalText(p.typ)} typ`].filter(Boolean).join(' · ') : '–'}</td>
            <td class="px-2 py-1.5 text-amber-700">${pkEsc(anm.join(' · '))}</td>
            <td class="px-2 py-1.5 text-right">${p.medVarde < p.antal ? `<button onclick="pkVisaBrister(${i}, ${j}, ${pi})" class="text-ads-blue hover:underline whitespace-nowrap">Visa element</button>` : ''}</td>
          </tr>`;
      }).join('') || `<tr><td colspan="6" class="px-3 py-2 text-ads-muted">Inga avvikelser.</td></tr>`}</tbody>
    </table>`;
}

// ── Elementen bakom en siffra ─────────────────────────────────────────────────

function pkVisaBrister(i, j, pi) {
  const mid = pkNodId(i), kat = pkNodId(j).slice(4), par = pkNodId(pi).slice(4);
  const m = _pk.korning.resultat.modeller.find(x => x.id === mid);
  const data = _pk.korning.modeller.find(x => x.id === mid);
  if (!m || !data) return;
  const { element, typer } = pkBrister(m, kat, par, data.typer);
  _pk.ui.brister = { element, typer, visas: 200 };
  const ids = element.map(b => b.el.elementId).filter(x => x != null);
  pkDialog({
    titel: `${par} saknar värde · ${kat}`,
    text: `${m.namn}. ${typer.length ? `${typer.length} ${typer.length === 1 ? 'typ' : 'typer'} och ` : ''}${element.length} element utan värde.`,
    bredd: 'w-[760px]',
    html: `
      ${typer.length ? `<p class="text-xs font-semibold text-ads-text mt-1 mb-1">Typparametern saknar värde på typen</p>
        <table class="w-full text-xs border border-ads-border rounded mb-3"><thead><tr class="text-left text-ads-muted bg-ads-gray"><th class="px-2 py-1">Familj</th><th class="px-2 py-1">Typ</th><th class="px-2 py-1 text-right">Påverkar</th></tr></thead>
        <tbody>${typer.map(t => `<tr class="border-t border-ads-border"><td class="px-2 py-1">${pkEsc(t.familj)}</td><td class="px-2 py-1">${pkEsc(t.typ)}</td><td class="px-2 py-1 text-right">${pkTalText(t.antal)} element</td></tr>`).join('')}</tbody></table>` : ''}
      ${element.length ? `<div class="flex items-center gap-2 mb-1">
          <p class="text-xs font-semibold text-ads-text">Element</p>
          ${ids.length ? `<button onclick="navigator.clipboard.writeText('${ids.join(';')}').then(() => vkToast('${ids.length} ElementId kopierade. Klistra in i Revit: Hantera › Välj efter id.'))" class="ml-auto text-xs text-ads-blue hover:underline">Kopiera alla ElementId</button>` : ''}
        </div>
        <div id="pk-brister-lista">${pkBristerListaHtml()}</div>` : ''}`,
    knappar: [{ text: 'Stäng', primar: true }],
  });
}

function pkBristerListaHtml() {
  const b = _pk.ui.brister;
  const visas = b.element.slice(0, b.visas);
  return `
    <div class="border border-ads-border rounded overflow-auto" style="max-height:45vh">
      <table class="w-full text-xs"><thead class="sticky top-0 bg-ads-gray"><tr class="text-left text-ads-muted">
        <th class="px-2 py-1">Familj</th><th class="px-2 py-1">Typ</th><th class="px-2 py-1">Namn</th><th class="px-2 py-1">ElementId / GlobalId</th></tr></thead>
      <tbody>${visas.map(({ el }) => `<tr class="border-t border-ads-border"><td class="px-2 py-1">${pkEsc(el.familj)}</td><td class="px-2 py-1">${pkEsc(el.typ)}</td>
        <td class="px-2 py-1">${pkEsc(el.namn)}</td><td class="px-2 py-1 font-mono">${pkEsc(el.elementId ?? el.extId)}</td></tr>`).join('')}</tbody></table>
    </div>
    ${b.element.length > b.visas ? `<button onclick="_pk.ui.brister.visas += 200; document.getElementById('pk-brister-lista').innerHTML = pkBristerListaHtml()" class="mt-2 text-xs text-ads-blue hover:underline">Visa 200 till (${pkTalText(b.element.length - b.visas)} kvar)</button>` : ''}`;
}

// ── Per parameter och per disciplin ───────────────────────────────────────────

function pkPerParameterHtml() {
  const r = _pk.korning.resultat;
  const ui = pkResUi();
  const modeller = r.modeller.filter(m => m.status === 'klar');
  const korta = pkKortaNamn(modeller.map(m => m.namn));
  const rader = r.krav.map(k => {
    const per = modeller.map(m => {
      let med = 0, antal = 0;
      for (const kat of m.kategorier) for (const p of kat.parametrar) if (p.namn === k.namn && p.status !== 'ejHamtad') { med += p.medVarde; antal += p.antal; }
      return { med, antal };
    });
    const med = per.reduce((s, x) => s + x.med, 0), antal = per.reduce((s, x) => s + x.antal, 0);
    return { namn: k.namn, per, med, antal };
  }).filter(x => pkResMatch(x.namn) && (!ui.baraAvvikelser || x.med < x.antal))
    .sort((a, b) => (a.antal ? a.med / a.antal : 2) - (b.antal ? b.med / b.antal : 2));
  return `
    <div class="bg-white border border-ads-border rounded-lg overflow-auto">
      <table class="text-sm w-full">
        <thead><tr class="text-[11px] uppercase tracking-wide text-ads-muted text-left bg-ads-gray/50">
          <th class="px-4 py-2 font-semibold">Parameter</th><th class="px-2 py-2 font-semibold">Alla modeller</th>
          ${modeller.map((m, i) => `<th class="px-2 py-2 font-semibold normal-case" title="${pkEsc(m.namn)}">${pkEsc(korta[i])}</th>`).join('')}</tr></thead>
        <tbody>${rader.map(x => `
          <tr class="border-t border-ads-border">
            <td class="px-4 py-2 text-ads-text">${pkEsc(x.namn)}</td>
            <td class="px-2 py-2">${pkStapel(x.med, x.antal, 'w-20')}</td>
            ${x.per.map(p => `<td class="px-2 py-2 text-xs tabular-nums ${!p.antal ? 'text-ads-border' : p.med === p.antal ? 'text-green-700' : p.med === 0 ? 'text-red-600' : 'text-amber-700'}">${p.antal ? pkProcentText(p.med, p.antal) : '–'}</td>`).join('')}
          </tr>`).join('') || `<tr><td class="px-4 py-3 text-sm text-ads-muted" colspan="${modeller.length + 2}">Inget matchar.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="text-xs text-ads-muted mt-2">Sorterat med lägst ifyllnadsgrad först. – betyder att parametern inte krävs i någon av modellens valda kategorier.</p>`;
}

function pkPerDisciplinHtml() {
  const r = _pk.korning.resultat;
  return `
    <div class="bg-white border border-ads-border rounded-lg">
      <table class="text-sm w-full">
        <thead><tr class="text-[11px] uppercase tracking-wide text-ads-muted text-left bg-ads-gray/50">
          <th class="px-4 py-2 font-semibold">Disciplin</th><th class="px-2 py-2 font-semibold">Ifyllt</th><th class="px-2 py-2 font-semibold">Klara element</th>
          <th class="px-2 py-2 font-semibold">Uppfyller kraven</th><th class="px-2 py-2 font-semibold">Modeller</th></tr></thead>
        <tbody>${r.discipliner.filter(d => pkResMatch(d.disciplin || 'Ej angiven', ...d.modeller.map(id => r.modeller.find(m => m.id === id)?.namn))).map(d => {
          const n = d.nyckeltal;
          const namn = d.modeller.map(id => r.modeller.find(m => m.id === id)).map(m => `<span class="${m.status === 'klar' ? '' : 'text-red-600'}">${pkEsc(m.namn)}${m.status === 'klar' ? '' : ' (kunde inte läsas)'}</span>`).join(', ');
          return `<tr class="border-t border-ads-border align-top">
            <td class="px-4 py-2 font-medium text-ads-text">${pkEsc(d.disciplin || 'Ej angiven')}</td>
            <td class="px-2 py-2">${pkStapel(n.ifyllda, n.kravVarden)}</td>
            <td class="px-2 py-2 text-xs tabular-nums">${pkTalText(n.klara)} av ${pkTalText(n.kontrollerade)}</td>
            <td class="px-2 py-2 text-xs">${d.bedomda ? `${d.uppfyller} av ${d.bedomda} modeller` : '–'}</td>
            <td class="px-2 py-2 text-xs text-ads-muted">${namn}</td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}

// ── Täckning: det som inte kontrollerades ─────────────────────────────────────

function pkTackningHtml(r) {
  const punkter = [];
  for (const m of r.modeller) {
    const i = pkNod(m.id);
    if (m.status !== 'klar') { punkter.push(`<b>${pkEsc(m.namn)}</b> kunde inte läsas: ${pkEsc(m.fel || '')}`); continue; }
    const t = m.tackning;
    const glomda = t.ejValda.filter(e => e.kanskeGlomd.length);
    for (const e of glomda) punkter.push(`<span class="text-amber-800">Kanske glömd:</span> ${pkEsc(e.kategori)} i <b>${pkEsc(m.namn)}</b> har ${pkTalText(e.antal)} element och värden i ${pkEsc(e.kanskeGlomd.slice(0, 3).join(', '))}${e.kanskeGlomd.length > 3 ? ' …' : ''}, men ingår inte.
      <button onclick="pkLaggTillKategori(${i}, '${encodeURIComponent(e.kategori)}')" class="text-ads-blue hover:underline">Lägg till kategorin</button>`);
    const ovriga = t.ejValda.filter(e => !e.kanskeGlomd.length);
    if (ovriga.length) punkter.push(`<b>${pkEsc(m.namn)}</b>: ${ovriga.length} ${ovriga.length === 1 ? 'kategori' : 'kategorier'} med 3D-geometri ingår inte (${pkTalText(ovriga.reduce((s, e) => s + e.antal, 0))} element): ${pkEsc(ovriga.slice(0, 6).map(e => e.kategori).join(', '))}${ovriga.length > 6 ? ' …' : ''}`);
    for (const kat of t.tommaValda) punkter.push(`${pkEsc(kat)} är vald i <b>${pkEsc(m.namn)}</b> men har inga element i den här versionen.`);
    for (const namn of t.kravUtanKategori) punkter.push(`Kravet ${pkEsc(namn)} gäller ingen vald kategori i <b>${pkEsc(m.namn)}</b> och kontrolleras inte där.`);
    for (const id of t.undantagUtanTraff) punkter.push(`Undantaget "${pkEsc(pkUndantagText(_pk.korning.setup.undantag.find(u => u.id === id) || {}).vad)}" matchade inga element i <b>${pkEsc(m.namn)}</b>. Stämmer stavningen?`);
    for (const u of t.storaUndantag) punkter.push(`<span class="text-amber-800">Stort undantag:</span> en regel tar bort ${pkTalText(u.antal)} av ${pkTalText(u.av)} element i ${pkEsc(u.kategori)} i <b>${pkEsc(m.namn)}</b>.`);
    for (const u of t.uteslutna) punkter.push(`${pkTalText(u.antal)} element i ${pkEsc(u.kategori)} i <b>${pkEsc(m.namn)}</b> togs inte med (${pkEsc(u.orsak)}).`);
    const undantagna = m.kategorier.reduce((s, k) => s + k.undantagna, 0);
    if (undantagna) punkter.push(`${pkTalText(undantagna)} element i <b>${pkEsc(m.namn)}</b> är undantagna enligt reglerna i steg 2.`);
  }
  for (const monster of r.tackning.reglerUtanTraff) punkter.push(`Regeln ${pkEsc(monster)} matchade inga parametrar i någon modell.`);
  for (const namn of r.tackning.saknasOveralt) punkter.push(`<span class="text-red-700">Kravet ${pkEsc(namn)} finns inte i någon av modellerna.</span> Kontrollera stavningen; inbyggda Revitparametrar står på engelska i ACC.`);
  return `
    <div class="bg-white border border-ads-border rounded-lg">
      <div class="px-4 py-2.5 border-b border-ads-border"><h3 class="text-sm font-semibold text-ads-text">Utanför kontrollen</h3>
        <p class="text-xs text-ads-muted">Det här ingår inte i siffrorna ovan. Det står också i Excel-rapporten.</p></div>
      ${punkter.length ? `<ul class="divide-y divide-ads-border text-sm">${punkter.map(p => `<li class="px-4 py-2 text-ads-text">${p}</li>`).join('')}</ul>`
        : `<p class="px-4 py-3 text-sm text-ads-muted">Inget. Alla modellkategorier med element ingår och alla krav gäller någon kategori.</p>`}
    </div>`;
}

function pkLaggTillKategori(i, kat) {
  const id = pkNodId(i), namn = decodeURIComponent(kat);
  pkAndra(`Valde ${namn}`, s => {
    const m = s.modeller.find(x => x.id === id);
    if (m && !m.kategorier.includes(namn)) m.kategorier.push(namn);
  });
}

// ── Snabbval från resultatet ──────────────────────────────────────────────────
// Kategori och parameter kan läggas till härifrån. Resultatet blir då
// inaktuellt och Uppdatera hämtar bara det nya.

function pkSnabbKategori() {
  const s = _pk.setup;
  const alla = new Map();
  for (const m of s.modeller) for (const [kat, a] of Object.entries(pkModellData(m.id)?.kategoriAntal || {})) {
    if (m.kategorier.includes(kat)) continue;
    const r = alla.get(kat) || { antal: 0, modeller: 0, geometri: 0 };
    r.antal += a.antal; r.modeller++; r.geometri += a.geometri ?? 1;
    alla.set(kat, r);
  }
  const lista = [...alla].filter(([, r]) => r.geometri).sort((a, b) => a[0].localeCompare(b[0], 'sv'));
  pkDialog({
    titel: 'Lägg till kategori',
    text: 'Kategorin väljs i alla modeller som har den. Modellkategorier med 3D-geometri visas; övriga finns i steg 2.',
    html: `<div class="border border-ads-border rounded max-h-80 overflow-auto divide-y divide-ads-border">${lista.map(([kat, r]) => `
      <label class="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-ads-gray"><input type="checkbox" value="${pkEsc(kat)}" class="accent-ads-blue pk-snabb"/>
        <span class="flex-1">${pkEsc(kat)}</span><span class="text-xs text-ads-muted">${pkTalText(r.antal)} element i ${r.modeller} ${r.modeller === 1 ? 'modell' : 'modeller'}</span></label>`).join('')
      || '<p class="px-3 py-3 text-sm text-ads-muted">Alla modellkategorier är redan valda.</p>'}</div>`,
    knappar: [{ text: 'Avbryt' }, { text: 'Lägg till', primar: true, gor: d => {
      const valda = [...d.querySelectorAll('.pk-snabb:checked')].map(x => x.value);
      if (!valda.length) return;
      pkAndra(`La till ${valda.length} ${valda.length === 1 ? 'kategori' : 'kategorier'}`, st => {
        for (const m of st.modeller) for (const kat of valda) if (pkModellData(m.id)?.kategoriAntal?.[kat] && !m.kategorier.includes(kat)) m.kategorier.push(kat);
      });
    } }],
  });
}

function pkSnabbParameter() {
  const namn = [...pkKatalogNamn().per.keys()].sort((a, b) => a.localeCompare(b, 'sv'));
  pkDialog({
    titel: 'Lägg till krav',
    text: 'Skriv parameterns namn exakt, eller ett mönster med * för en regel. Kravet gäller alla valda kategorier.',
    html: `<input id="pk-snabb-param" list="pk-snabb-namn" class="w-full px-2 py-1.5 text-sm border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue" placeholder="t.ex. Brandklass"/>
      <datalist id="pk-snabb-namn">${namn.map(n => `<option value="${pkEsc(n)}">`).join('')}</datalist>`,
    knappar: [{ text: 'Avbryt' }, { text: 'Lägg till', primar: true, gor: d => {
      const v = pkNyckel(d.querySelector('#pk-snabb-param').value);
      if (!v) return false;
      pkAndra(`La till ${pkArMonster(v) ? 'regeln' : 'kravet'} ${v}`, s => {
        const p = s.kravprofil;
        if (pkArMonster(v)) { if (!p.regler.some(r => r.monster === v)) p.regler.push({ monster: v, kategorier: null }); }
        else if (!p.krav.some(k => k.namn === v)) p.krav.push({ namn: v, kalla: 'lista', kategorier: null });
      });
    } }],
  });
  setTimeout(() => document.getElementById('pk-snabb-param')?.focus(), 30);
}
