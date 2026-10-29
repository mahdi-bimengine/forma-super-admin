// issues-skriv.js — ändra status, tilldelning och förfallodatum på ärenden.
//
// Samma mönster som Behörigheter: ändringar samlas i en lista, granskas och
// sparas först efter bekräftelse. Varje ärende läses om strax före sparandet,
// så att läget före blir det verkliga, och svaret kontrolleras mot ändringen.
// Sparade omgångar loggas i webbläsaren per konto och kan återställas.
//
// Vad som går att ändra styrs av ACC per ärende: permittedStatuses och
// permittedAttributes i ärendet.

const IS_LOGG_MAX = 50;
const IS_FALT = ['status', 'assignedTo', 'dueDate'];

// Läget för fälten som kan ändras. Plats, platsbeskrivning och egna fält
// (ca:<definitions-id>) tas med när de efterfrågas, så att områden kan sättas.
function isFore(a, nycklar = []) {
  const ut = {
    status:         a.ra.status,
    assignedTo:     a.ra.assignedTo || null,
    assignedToType: a.ra.assignedToType || null,
    dueDate:        a.ra.dueDate ? a.ra.dueDate.slice(0, 10) : null,
    watchers:       isBevakarObjekt(a.ra).map(w => w.id).sort(),
    watcherTyper:   Object.fromEntries(isBevakarObjekt(a.ra).map(w => [w.id, w.type])),
  };
  for (const k of nycklar) {
    if (k === 'issueSubtypeId')  ut.issueSubtypeId = a.ra.issueSubtypeId || null;
    if (k === 'startDate')       ut.startDate = a.ra.startDate ? a.ra.startDate.slice(0, 10) : null;
    if (k === 'rootCauseId')     ut.rootCauseId = a.ra.rootCauseId || null;
    if (k === 'locationId')      ut.locationId = a.ra.locationId || null;
    if (k === 'locationDetails') ut.locationDetails = a.ra.locationDetails || null;
    if (k.startsWith('ca:')) {
      const f = (a.ra.customAttributes || []).find(x => x.attributeDefinitionId === k.slice(3));
      ut[k] = f?.value ?? null;
    }
  }
  return ut;
}

function isFarAndra(a, falt) {
  return a.tillatnaFalt.includes(falt);
}

// Föreslår ett nytt värde för ett fält. Tilldelning anges som "typ:id" eller
// tom sträng för att ta bort tilldelningen.
function isForesla(ref, falt, varde) {
  const a = _is.ref[ref];
  const fore = isFore(a);
  let andring = _is.andringar.find(x => x.id === a.id);
  if (!andring) {
    andring = { id: a.id, nr: a.nr, rubrik: a.rubrik, projekt: a.projekt, projektId: a.projektId, accId: a.accId, fore, efter: {} };
    _is.andringar.push(andring);
  }
  if (falt === 'status') andring.efter.status = varde;
  if (falt === 'dueDate') andring.efter.dueDate = varde || null;
  if (falt === 'assignedTo') {
    const [typ, ...rest] = String(varde || '').split(':');
    andring.efter.assignedTo     = varde ? rest.join(':') : null;
    andring.efter.assignedToType = varde ? typ : null;
  }
  isRensaLika(andring);
  isRensaTom(andring);
  isRita();
}

// Tar bort fält som är tillbaka på sitt ursprungliga värde. Typen av
// tilldelning följer tilldelningen: ACC behöver båda, även när en person byts
// mot en annan person och typen därför är densamma.
function isRensaLika(andring) {
  for (const k of Object.keys(andring.efter)) {
    if (k !== 'assignedToType' && isLika(andring.efter[k], andring.fore[k])) delete andring.efter[k];
  }
  if (!('assignedTo' in andring.efter)) delete andring.efter.assignedToType;
  if (!('watchers' in andring.efter)) { delete andring.bevakarSteg; delete andring.bevakarTyper; }
}

// Bevakarens typ (user, role eller company). Först ur ärendet som det ser ut
// nu eller i loggen, sedan ur namnregistret, där typerna heter likadant.
function isBevakarTyp(id, p, ...kallor) {
  for (const k of kallor) if (k?.[id]) return k[id];
  return p?.namnRegister.get(id)?.typ || 'user';
}

// Listor, som bevakare, är lika när de har samma innehåll i någon ordning.
function isLika(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
  return a === b;
}

// Bevakare ändras i steg (lägg till, ta bort, ersätt) som spelas upp på
// listan. Vid sparandet spelas de upp på ärendet som det ser ut just då, så
// att bevakare som någon annan lagt till under tiden inte försvinner.
function isBevakareEfterSteg(lista, steg) {
  let ut = [...(lista || [])];
  for (const s of steg || []) {
    if (s.lage === 'lagg')   ut = [...new Set([...ut, ...s.ids])];
    if (s.lage === 'tabort') ut = ut.filter(id => !s.ids.includes(id));
    if (s.lage === 'ersatt') ut = [...new Set(s.ids)];
  }
  return ut.sort();
}

function isRensaTom(andring) {
  if (!Object.keys(andring.efter).length && !andring.kommentar) _is.andringar = _is.andringar.filter(x => x !== andring);
}

function isHamtaAndring(a) {
  let andring = _is.andringar.find(x => x.id === a.id);
  if (!andring) {
    andring = { id: a.id, nr: a.nr, rubrik: a.rubrik, projekt: a.projekt, projektId: a.projektId, accId: a.accId, fore: isFore(a), efter: {} };
    _is.andringar.push(andring);
  }
  return andring;
}

// Sätter en status direkt, utan omritning. Används för bulkåtgärder.
function isForeslaStatus(a, status) {
  if (!a.tillatnaStatusar.includes(status) || !isFarAndra(a, 'status')) return false;
  const andring = isHamtaAndring(a);
  andring.efter.status = status;
  return true;
}

// Skickar tillbaka ett slutfört ärende till projektören: ny status och en
// kommentar som förklarar varför. Kommentaren kan inte återställas.
function isSkickaTillbaka(ref) {
  const a = _is.ref[ref];
  const status = ['in_progress', 'open', 'pending'].find(s => a.tillatnaStatusar.includes(s));
  if (!status || !isFarAndra(a, 'status')) { alert('ACC tillåter inte att du öppnar det här ärendet igen.'); return; }
  const text = prompt(`Kommentar till projektören om ärende #${a.nr}:`, '');
  if (text == null) return;
  const andring = isHamtaAndring(a);
  andring.efter.status = status;
  andring.kommentar = text.trim() || null;
  isRita();
}

function isAngra(id) {
  _is.andringar = _is.andringar.filter(x => x.id !== _is.ref[id]);
  isRita();
}

function isTomAndringar() {
  _is.andringar = [];
  _is.hoppade   = [];
  if (_is.dialog === 'granska') _is.dialog = null;
  isRita();
}

function isVantande(a) {
  return _is.andringar.find(x => x.id === a.id) || null;
}

// ── Spara ─────────────────────────────────────────────────────────────────────

async function isSpara() {
  const rader = _is.andringar.map(x => ({ ...x, efter: { ...x.efter }, status: 'väntar' }));
  _is.kor    = { klar: false, rader, klara: 0 };
  _is.dialog = 'kor';
  isRita();

  let index = 0;
  const arbetare = async () => {
    while (index < rader.length) {
      const r = rader[index++];
      try {
        const sokvag = `/construction/issues/v1/projects/${r.accId}/issues/${r.id}`;
        const farsk  = await bhMedOmforsok(() => apsGet(sokvag));
        r.fore = isFore({ ra: farsk }, Object.keys(r.efter));
        if (r.bevakarSteg) r.efter.watchers = isBevakareEfterSteg(r.fore.watchers, r.bevakarSteg);
        const kropp = {};
        if ('watchers' in r.efter && !isLika(r.efter.watchers, r.fore.watchers)) {
          const p = _is.projekt.get(r.projektId);
          kropp.watcherObjects = r.efter.watchers.map(id => ({ id, type: isBevakarTyp(id, p, r.fore.watcherTyper, r.bevakarTyper) }));
        }
        if ('status' in r.efter) kropp.status = r.efter.status;
        if ('dueDate' in r.efter) kropp.dueDate = r.efter.dueDate;
        for (const k of ['issueSubtypeId', 'startDate', 'rootCauseId']) if (k in r.efter) kropp[k] = r.efter[k];
        if ('locationId' in r.efter) kropp.locationId = r.efter.locationId;
        if ('locationDetails' in r.efter) kropp.locationDetails = r.efter.locationDetails;
        const egna = Object.keys(r.efter).filter(k => k.startsWith('ca:'));
        if (egna.length) kropp.customAttributes = egna.map(k => ({ attributeDefinitionId: k.slice(3), value: r.efter[k] }));
        if ('assignedTo' in r.efter) {
          kropp.assignedTo     = r.efter.assignedTo;
          kropp.assignedToType = r.efter.assignedToType;
        }
        let svar = farsk;
        if (Object.keys(kropp).length) svar = await bhMedOmforsok(() => apsSend('PATCH', sokvag, kropp));
        // Kommentaren skrivs efter ändringen, så att den bara hamnar på ärenden
        // som faktiskt ändrades.
        if (r.kommentar) {
          await bhMedOmforsok(() => apsSend('POST', `${sokvag}/comments`, { body: r.kommentar }));
          _is.kommentarer?.delete(r.id);
        }
        r.faktisk = isFore({ ra: svar }, Object.keys(r.efter));
        r.status  = Object.keys(r.efter).every(k => isLika(r.faktisk[k], r.efter[k])) ? 'klar' : 'avviker';
        isUppdateraArende(r.projektId, svar);
      } catch (err) {
        r.status = 'fel';
        r.fel    = bhKortFel(err);
      }
      _is.kor.klara++;
      const el = document.getElementById('is-dialog');
      if (el) el.outerHTML = isDialogHtml();
    }
  };
  await Promise.all([arbetare(), arbetare(), arbetare()]);

  isSparaLogg({
    id:          Date.now(),
    tid:         new Date().toISOString(),
    anvandare:   _profile?.email || '',
    aterstaller: _is.aterstaller || null,
    andringar:   rader,
  });
  _is.aterstaller = null;
  _is.hoppade     = [];
  _is.andringar   = rader.filter(r => r.status === 'fel').map(({ status, fel, faktisk, ...r }) => r);
  _is.kor.klar    = true;
  isRita();
}

// Lägger in det uppdaterade ärendet i den hämtade datan.
function isUppdateraArende(projektId, ra) {
  const p = _is.projekt.get(projektId);
  if (!p) return;
  const i = p.arenden.findIndex(a => a.id === ra.id);
  if (i < 0) return;
  p.arenden[i] = isNormalisera(ra, p);
}

// ── Logg och återställning ────────────────────────────────────────────────────

function isLoggNyckel() {
  return `is-logg:${_is.hubId}`;
}

function isLogg() {
  if (!_is.logg) {
    try { _is.logg = JSON.parse(localStorage.getItem(isLoggNyckel()) || '[]'); }
    catch { _is.logg = []; }
  }
  return _is.logg;
}

function isSparaLogg(post) {
  _is.logg = [post, ...isLogg()].slice(0, IS_LOGG_MAX);
  try { localStorage.setItem(isLoggNyckel(), JSON.stringify(_is.logg)); }
  catch { /* privat läge: loggen finns kvar tills sidan laddas om */ }
}

// Sätter tillbaka fälten som ändrades i omgången till läget före.
function isAterstall(id) {
  const post = isLogg().find(p => p.id === id);
  if (!post) return;
  if (_is.andringar.length && !confirm(`${_is.andringar.length} ändringar väntar och ersätts av återställningen. Fortsätta?`)) return;
  _is.andringar = [];
  for (const r of post.andringar) {
    if (r.status !== 'klar' && r.status !== 'avviker') continue;
    const a = isHittaArende(r.projektId, r.id);
    const efter = {};
    for (const k of Object.keys(r.efter)) {
      efter[k] = r.fore[k];
      if (k === 'assignedTo') efter.assignedToType = r.fore.assignedToType;
    }
    _is.andringar.push({
      id: r.id, nr: r.nr, rubrik: r.rubrik, projekt: r.projekt, projektId: r.projektId, accId: r.accId,
      fore: a ? isFore(a, Object.keys(efter)) : r.faktisk || r.efter, efter,
      // Bevakare som tagits bort finns inte kvar på ärendet, så typen tas ur loggen.
      ...('watchers' in efter ? { bevakarTyper: r.fore.watcherTyper } : {}),
    });
  }
  _is.aterstaller = id;
  _is.dialog = 'granska';
  isRita();
}

function isHittaArende(projektId, id) {
  return _is.projekt.get(projektId)?.arenden.find(a => a.id === id) || null;
}

function isExporteraLogg() {
  const aoa = [['Tid', 'Utförd av', 'Omgång', 'Återställer', 'Projekt', 'Nr', 'Rubrik', 'Fält', 'Före', 'Efter', 'Utfall', 'Status', 'Fel']];
  for (const p of isLogg()) {
    for (const r of p.andringar) {
      for (const k of Object.keys(r.efter).filter(k => k !== 'assignedToType')) {
        aoa.push([
          new Date(p.tid).toLocaleString('sv-SE'), p.anvandare, p.id, p.aterstaller || '',
          r.projekt, r.nr, r.rubrik, isFaltNamn(k),
          isVardeText(k, r.fore), isVardeText(k, r.efter), r.faktisk ? isVardeText(k, r.faktisk) : '',
          r.status, r.fel || '',
        ]);
      }
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 18 }, { wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 6 }, { wch: 40 }, { wch: 12 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 10 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ändringslogg');
  bhLaddaNer(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]), `issues_andringslogg_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function isFaltNamn(k) {
  if (k.startsWith('eget:')) return k.slice(5);
  if (k.startsWith('ca:')) {
    for (const p of _is.projekt.values()) {
      const d = p.faltDef?.find(f => f.id === k.slice(3));
      if (d) return d.title;
    }
    return 'Eget fält';
  }
  if (k === 'locationId') return 'Plats';
  if (k === 'locationDetails') return 'Platsbeskrivning';
  if (k === 'watchers') return 'Bevakare';
  if (k === 'issueSubtypeId') return 'Ärendetyp';
  if (k === 'startDate') return 'Startdatum';
  if (k === 'rootCauseId') return 'Grundorsak';
  return { status: 'Status', assignedTo: 'Tilldelad', dueDate: 'Förfaller' }[k] || k;
}

// Läsbar text för ett fältvärde. Tilldelning slås upp i namnregistren.
function isVardeText(k, v) {
  if (!v) return '–';
  if (k === 'status') return isStatusLabel(v.status);
  if (k === 'dueDate') return v.dueDate || '–';
  if (k === 'locationDetails') return v.locationDetails || 'ingen';
  if (k === 'watchers') return (v.watchers || []).map(isNamnPaId).join(', ') || 'inga';
  if (k === 'startDate') return v.startDate || '–';
  if (k === 'issueSubtypeId') {
    if (!v.issueSubtypeId) return '–';
    for (const p of _is.projekt.values()) {
      const t = p.typer?.find(t => (t.subtypes || []).some(s => s.id === v.issueSubtypeId));
      if (t) return `${t.title} › ${t.subtypes.find(s => s.id === v.issueSubtypeId).title}`;
    }
    return v.issueSubtypeId;
  }
  if (k === 'rootCauseId') {
    if (!v.rootCauseId) return 'ingen';
    for (const p of _is.projekt.values()) {
      const o = p.grundorsaker?.find(o => o.id === v.rootCauseId);
      if (o) return o.namn;
    }
    return v.rootCauseId;
  }
  if (k === 'locationId') {
    if (!v.locationId) return 'ingen';
    for (const p of _is.projekt.values()) {
      const vag = isPlatsVag(p.platser, v.locationId);
      if (vag.length) return vag.join(' › ');
    }
    // Utan platsträdet: namnet som satts i Namnge platser.
    for (const p of _is.projekt.values()) {
      if (p.arenden.some(a => a.platsId === v.locationId)) return isPlatsnamn(p, v.locationId);
    }
    return v.locationId;
  }
  if (k.startsWith('ca:')) {
    if (v[k] == null || v[k] === '') return 'inget';
    for (const p of _is.projekt.values()) if (p.listval?.has(v[k])) return p.listval.get(v[k]);
    return String(v[k]);
  }
  if (k === 'assignedTo') {
    if (!v.assignedTo) return 'ingen';
    for (const p of _is.projekt.values()) {
      const n = p.namnRegister.get(v.assignedTo);
      if (n) return n.namn;
    }
    return `${isTypNamn(v.assignedToType)} ${v.assignedTo}`;
  }
  return '';
}

// Namnet på en person, ett företag eller en roll, i något av de inlästa
// projekten. Ett företag som bara är känt genom en medlem får medlemmens
// företagsnamn.
function isNamnPaId(id) {
  for (const p of _is.projekt.values()) {
    const n = p.namnRegister.get(id);
    if (n) return n.namn;
  }
  for (const p of _is.projekt.values()) {
    for (const n of p.namnRegister.values()) if (n.foretagId === id && n.foretag) return n.foretag;
  }
  return id;
}

// Bevakarändringen som det som läggs till och tas bort.
function isBevakarDiff(fore, efter) {
  const f = fore?.watchers || [], e = efter?.watchers || [];
  const plus  = e.filter(id => !f.includes(id)).map(id => `<span class="text-emerald-700">+ ${vkEsc(isNamnPaId(id))}</span>`);
  const minus = f.filter(id => !e.includes(id)).map(id => `<span class="text-red-700 line-through">${vkEsc(isNamnPaId(id))}</span>`);
  return [...plus, ...minus].join(', ') || '<span class="text-ads-muted">ingen skillnad</span>';
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function isAndringsradHtml() {
  const n = _is.andringar.length;
  const logg = isLogg().length;
  return `
    <div class="shrink-0 border-t border-ads-border px-4 py-2 flex items-center gap-3 ${n ? 'bg-amber-50' : 'bg-white'}">
      ${n ? `
        <span class="text-sm text-amber-900"><b>${n}</b> ärende${n > 1 ? 'n' : ''} med ändringar väntar${_is.hoppade.length ? ` · ${_is.hoppade.length} hoppas över` : ''}</span>
        <button onclick="isOppnaDialog('granska')" class="bg-be-charcoal hover:bg-black text-white text-xs font-medium py-1.5 px-3 rounded">Granska och spara</button>
        <button onclick="isTomAndringar()" class="text-xs text-ads-muted hover:text-ads-text">Töm listan</button>`
        : `<span class="text-xs text-ads-muted">Ändringar samlas här och sparas först när du granskat dem.</span>`}
      <div class="flex-1"></div>
      <button onclick="isOppnaDialog('historik')" class="text-xs text-ads-blue hover:underline">Historik och återställning${logg ? ` (${logg})` : ''}</button>
    </div>`;
}

function isAndringsTabell(rader, medAngra, medStatus) {
  const stil = { klar: 'text-emerald-700', avviker: 'text-amber-700', fel: 'text-red-700', väntar: 'text-ads-muted' };
  return `
    <table class="w-full text-sm">
      <thead class="text-[10px] uppercase tracking-wider text-ads-muted text-left sticky top-0 bg-white">
        <tr><th class="py-1.5 px-2">Ärende</th><th class="px-2">Ändring</th>${medStatus ? '<th class="px-2">Utfall</th>' : ''}${medAngra ? '<th></th>' : ''}</tr>
      </thead>
      <tbody>
        ${rader.map(r => `
          <tr class="border-t border-ads-border/60 align-top">
            <td class="py-1.5 px-2"><div class="font-medium">#${r.nr} ${vkEsc(r.rubrik)}</div><div class="text-[10px] text-ads-muted">${vkEsc(r.projekt)}</div></td>
            <td class="px-2 py-1.5 text-xs">
              ${Object.keys(r.efter).filter(k => k !== 'assignedToType').map(k => k === 'watchers' ? `
                <div><span class="text-ads-muted">${isFaltNamn(k)}:</span> ${isBevakarDiff(r.fore, r.efter)}</div>` : `
                <div><span class="text-ads-muted">${isFaltNamn(k)}:</span> ${vkEsc(isVardeText(k, r.fore))} <span class="text-ads-muted">→</span> <b>${vkEsc(isVardeText(k, r.efter))}</b></div>`).join('')}
              ${r.kommentar ? `<div><span class="text-ads-muted">Kommentar:</span> <i>${vkEsc(r.kommentar)}</i></div>` : ''}
            </td>
            ${medStatus ? `<td class="px-2 py-1.5 text-xs ${stil[r.status] || ''}">${r.status}
                ${r.fel ? `<div class="text-[10px] text-red-700 max-w-[260px]">${vkEsc(r.fel)}</div>` : ''}</td>` : ''}
            ${medAngra ? `<td class="px-2 py-1.5 text-right"><button onclick="isAngra(${isRef(r.id)})" class="text-xs text-ads-muted hover:text-red-700">✕</button></td>` : ''}
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function isDialogRam(inneh) {
  return `
    <div id="is-dialog" class="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
         onclick="if (event.target === this) isStangDialog()">
      <div class="bg-white rounded shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">${inneh}</div>
    </div>`;
}

function isDialogHuvud(titel, under) {
  return `
    <div class="px-5 py-3 border-b border-ads-border flex items-start gap-3">
      <div class="flex-1"><h3 class="font-semibold text-ads-text">${titel}</h3>
        ${under ? `<p class="text-xs text-ads-muted mt-0.5">${under}</p>` : ''}</div>
      <button onclick="isStangDialog()" class="px-1.5 text-ads-muted hover:text-ads-text">✕</button>
    </div>`;
}

function isDialogHtml() {
  if (!_is.dialog) return '<div id="is-dialog"></div>';
  if (_is.dialog === 'vyer') return isDialogRam(isVyRedigerareHtml());
  if (_is.dialog === 'inst') return isDialogRam(isInstHtml());
  if (_is.dialog === 'platser') return isDialogRam(isPlatserHtml());

  if (_is.dialog === 'granska') {
    const a = _is.andringar;
    return isDialogRam(`
      ${isDialogHuvud(_is.aterstaller ? 'Granska återställning' : 'Granska ändringar',
        `${a.length} ärende${a.length === 1 ? '' : 'n'}. Inget har skrivits till ACC än.`)}
      <div class="flex-1 overflow-y-auto px-3 py-2">${a.length ? isAndringsTabell(a, true, false) : '<p class="p-6 text-center text-sm text-ads-muted">Listan är tom.</p>'}${isHoppadeHtml()}</div>
      <div class="px-5 py-3 border-t border-ads-border flex items-center gap-3">
        <p class="text-[11px] text-ads-muted flex-1">Ändringarna syns direkt i ACC, och den som tilldelas kan få ett mejl. Läget före sparas, så omgången kan återställas från Historik.</p>
        <button onclick="isStangDialog()" class="text-sm text-ads-muted hover:text-ads-text px-3">Avbryt</button>
        <button onclick="isSpara()" ${a.length ? '' : 'disabled'} class="bg-be-charcoal hover:bg-black text-white text-sm font-medium py-2 px-4 rounded disabled:opacity-40">
          Spara till ACC</button>
      </div>`);
  }

  if (_is.dialog === 'kor') {
    const k = _is.kor;
    const n = s => k.rader.filter(r => r.status === s).length;
    return isDialogRam(`
      ${isDialogHuvud(k.klar ? 'Ändringarna är sparade' : 'Sparar till ACC',
        k.klar ? `Klart: ${n('klar')} klara, ${n('avviker')} avviker, ${n('fel')} fel.` : `Sparar… ${k.klara} av ${k.rader.length} ärenden.`)}
      <div class="flex-1 overflow-y-auto px-3 py-2">${isAndringsTabell(k.rader, false, true)}</div>
      ${k.klar ? `
        <div class="px-5 py-3 border-t border-ads-border flex items-center gap-3">
          <p class="text-[11px] text-ads-muted flex-1">"Avviker" betyder att ACC svarade med ett annat värde än det som sattes. ${n('fel') ? 'Ärenden med fel ligger kvar i listan.' : ''}</p>
          <button onclick="isStangDialog()" class="bg-be-charcoal hover:bg-black text-white text-sm font-medium py-2 px-4 rounded">Stäng</button>
        </div>` : ''}`);
  }

  const logg = isLogg();
  const aterstallda = new Set(logg.map(p => p.aterstaller).filter(Boolean));
  return isDialogRam(`
    ${isDialogHuvud('Historik och återställning', 'Sparade omgångar i det här kontot, nyast först. Historiken finns i den här webbläsaren.')}
    <div class="flex-1 overflow-y-auto px-5 py-3 space-y-3">
      ${logg.length ? logg.map(p => {
        const andrade = p.andringar.filter(r => r.status === 'klar' || r.status === 'avviker').length;
        return `
          <details class="border border-ads-border rounded">
            <summary class="px-3 py-2 cursor-pointer flex items-center gap-3 text-sm">
              <span class="font-medium">${new Date(p.tid).toLocaleString('sv-SE')}</span>
              <span class="text-ads-muted text-xs">${vkEsc(p.anvandare)}</span>
              ${p.aterstaller ? '<span class="text-[10px] px-1.5 rounded bg-ads-gray text-ads-muted">återställning</span>' : ''}
              ${aterstallda.has(p.id) ? '<span class="text-[10px] px-1.5 rounded bg-emerald-50 text-emerald-700">återställd</span>' : ''}
              <span class="flex-1 text-xs text-ads-muted text-right">${p.andringar.length} ärenden · ${andrade} ändrade</span>
              ${andrade ? `<button onclick="event.preventDefault(); isAterstall(${p.id})" class="text-xs border border-ads-border rounded px-2 py-1 hover:border-ads-blue">Återställ…</button>` : ''}
            </summary>
            <div class="px-2 pb-2">${isAndringsTabell(p.andringar, false, true)}</div>
          </details>`;
      }).join('') : '<p class="p-6 text-center text-sm text-ads-muted">Inga sparade ändringar än.</p>'}
    </div>
    <div class="px-5 py-3 border-t border-ads-border flex items-center gap-3">
      <p class="text-[11px] text-ads-muted flex-1">Återställ bygger en ändringslista tillbaka till läget före. ACC kan neka vissa statusbyten bakåt, och då syns det som fel.</p>
      ${logg.length ? '<button onclick="isExporteraLogg()" class="text-sm text-ads-blue hover:underline px-3">Exportera till Excel</button>' : ''}
      <button onclick="isStangDialog()" class="text-sm border border-ads-border rounded px-3 py-1.5 hover:border-ads-blue">Stäng</button>
    </div>`);
}

// Redigerbara celler i tabellen.
function isStatusCell(a, ref, redigerbar = _is.redigera) {
  const vant = isVantande(a);
  const varde = vant?.efter.status ?? a.status;
  const val = [...new Set([a.status, ...a.tillatnaStatusar])];
  if (!redigerbar || val.length < 2 || !isFarAndra(a, 'status')) return isStatusTagg(varde, !!vant?.efter.status);
  return `<select onchange="isForesla(${ref}, 'status', this.value)"
                  class="text-xs border rounded px-1 py-0.5 ${vant?.efter.status ? 'border-amber-400 bg-amber-50' : 'border-ads-border bg-white'}">
            ${val.map(s => `<option value="${s}" ${s === varde ? 'selected' : ''}>${isStatusLabel(s)}</option>`).join('')}
          </select>`;
}

function isStatusTagg(s, vantar) {
  const f = IS_STATUS[s]?.farg || '#999';
  const morkText = s === 'completed' || s === 'open';
  return `<span class="inline-block text-[11px] px-1.5 py-0.5 rounded ${vantar ? 'ring-2 ring-amber-400' : ''}"
                style="background:${f};color:${morkText ? '#1f2937' : '#fff'}">${isStatusLabel(s)}</span>`;
}

function isTilldeladCell(a, ref, redigerbar = _is.redigera) {
  const vant = isVantande(a);
  const harAndring = vant && 'assignedTo' in vant.efter;
  const id = harAndring ? vant.efter.assignedTo : a.tilldeladId;
  const typ = harAndring ? vant.efter.assignedToType : a.tilldeladTyp;
  if (!redigerbar || !isFarAndra(a, 'assignedTo')) {
    return `<span class="${harAndring ? 'bg-amber-50 px-1 rounded' : ''}">${vkEsc(harAndring ? isVardeText('assignedTo', vant.efter) : a.tilldelad)}</span>`;
  }
  const reg = _is.projekt.get(a.projektId)?.namnRegister || new Map();
  const grupper = { role: [], company: [], user: [] };
  for (const [aid, n] of reg) grupper[n.typ]?.push([aid, n.namn]);
  for (const g of Object.values(grupper)) g.sort((x, y) => x[1].localeCompare(y[1], 'sv'));
  const valt = id ? `${typ}:${id}` : '';
  const finns = !id || reg.has(id);
  return `<select onchange="isForesla(${ref}, 'assignedTo', this.value)"
                  class="text-xs border rounded px-1 py-0.5 max-w-[190px] ${harAndring ? 'border-amber-400 bg-amber-50' : 'border-ads-border bg-white'}">
            <option value="" ${!id ? 'selected' : ''}>– ingen –</option>
            ${finns ? '' : `<option value="${vkEsc(valt)}" selected>${vkEsc(a.tilldelad)}</option>`}
            ${[['role', 'Roller'], ['company', 'Företag'], ['user', 'Personer']].map(([t, rubrik]) => grupper[t].length ? `
              <optgroup label="${rubrik}">
                ${grupper[t].map(([aid, namn]) => `<option value="${t}:${vkEsc(aid)}" ${`${t}:${aid}` === valt ? 'selected' : ''}>${vkEsc(namn)}</option>`).join('')}
              </optgroup>` : '').join('')}
          </select>`;
}

function isForfallerCell(a, ref, redigerbar = _is.redigera) {
  const vant = isVantande(a);
  const harAndring = vant && 'dueDate' in vant.efter;
  const varde = harAndring ? vant.efter.dueDate || '' : a.forfaller;
  if (!redigerbar || !isFarAndra(a, 'dueDate')) return `<span class="${harAndring ? 'bg-amber-50 px-1 rounded' : ''}">${varde || ''}</span>`;
  return `<input type="date" value="${varde}" onchange="isForesla(${ref}, 'dueDate', this.value)"
                 class="text-xs border rounded px-1 py-0.5 ${harAndring ? 'border-amber-400 bg-amber-50' : 'border-ads-border bg-white'}" />`;
}
