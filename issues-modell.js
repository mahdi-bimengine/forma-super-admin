// issues-modell.js — kontrollerar slutförda clashärenden mot modellen.
//
// Clashärenden skapas från clashgrupper i Model Coordination. Per projekt och
// model set hämtas grupperna som är kopplade till ärenden, och de jämförs med
// den senaste lyckade clashkörningen. Svaret säger per grupp vilka av gruppens
// clashar som finns kvar och vilka som är lösta, och det räknas ihop per ärende.
//
// Kontrollen blir aldrig färskare än senaste uppladdningen till model setet.

const IS_MODELL_LAGE = {
  lost:    { titel: 'Löst i modellen',   kort: '✓ Löst',      farg: 'bg-emerald-100 text-emerald-800' },
  delvis:  { titel: 'Delvis löst',       kort: '◐ Delvis',    farg: 'bg-amber-100 text-amber-900' },
  kvar:    { titel: 'Finns kvar',        kort: '✕ Kvar',      farg: 'bg-red-100 text-red-800' },
  ingenNy: { titel: 'Ingen ny körning',  kort: '– Ej omkörd', farg: 'bg-ads-gray text-ads-muted' },
  okand:   { titel: 'Ej kopplad',        kort: '–',           farg: 'text-ads-muted' },
};

const IS_MAX_VERSIONER = 5;   // så många versioner bakåt som letas efter en lyckad körning

function isModellResultat(a) {
  return _is.modell.get(a.id) || null;
}

function isModellLage(a) {
  return isModellResultat(a)?.lage || 'okand';
}

// Kör kontrollen för alla valda projekt med slutförda clashärenden.
async function isKorModellkontroll(tvinga = false) {
  if (_is.modellStatus?.laddar) return;
  if (!tvinga && _is.modellStatus?.klar) return;

  const arenden = isClashSlutforda();
  const perProjekt = new Map();
  for (const a of arenden) {
    if (!perProjekt.has(a.projektId)) perProjekt.set(a.projektId, new Set());
    perProjekt.get(a.projektId).add(a.id);
  }

  _is.modellStatus = { laddar: true, klara: 0, totalt: perProjekt.size, fel: [], text: 'Kontrollerar mot Model Coordination…' };
  isRitaModellStatus();

  const nya = new Map();
  await Promise.all([...perProjekt.entries()].map(async ([projektId, ids]) => {
    try {
      await isKontrolleraProjekt(projektId, ids, nya);
    } catch (err) {
      _is.modellStatus.fel.push(`${_is.projekt.get(projektId)?.namn || projektId}: ${bhKortFel(err)}`);
    }
    _is.modellStatus.klara++;
    isRitaModellStatus();
  }));

  _is.modell = nya;
  _is.modellStatus = { ..._is.modellStatus, laddar: false, klar: true, tid: new Date() };
  if (_is.yta === 'clash') isRita();
}

async function isKontrolleraProjekt(projektId, ids, ut) {
  const set = await bhMedOmforsok(() => listModelSets(projektId));
  for (const ms of set) {
    const grupper = (await bhMedOmforsok(() => listAssignedClashGroups(projektId, ms.id)))
      .filter(g => ids.has(g.issueId));
    if (!grupper.length) continue;

    const test = await isSenasteLyckadeKorning(projektId, ms.id);
    if (!test) {
      for (const g of grupper) isLaggTill(ut, g.issueId, { ingenKorning: true, modelSet: ms.name });
      continue;
    }

    const lage = new Map((await bhMedOmforsok(() => getAssignedClashState(projektId, test.id))).map(g => [g.id, g]));
    for (const g of grupper) {
      const s = lage.get(g.id);
      const totalt = (g.clashes || []).length;
      if (!s) {
        isLaggTill(ut, g.issueId, { okandGrupp: true, modelSet: ms.name, version: test.modelSetVersion });
        continue;
      }
      // Har ingen ny körning gjorts sedan gruppen skapades säger svaret inget.
      const ingenNy = s.createdAtVersion != null && test.modelSetVersion <= s.createdAtVersion;
      isLaggTill(ut, g.issueId, {
        kvar:   ingenNy ? 0 : (s.existing || []).length,
        lost:   ingenNy ? 0 : (s.resolved || []).length,
        totalt: totalt || (s.existing || []).length + (s.resolved || []).length,
        ingenNy,
        modelSet: ms.name,
        version:  test.modelSetVersion,
      });
    }
  }
}

// Senaste model set-versionen som har en lyckad clashkörning.
async function isSenasteLyckadeKorning(projektId, modelSetId) {
  const versioner = await bhMedOmforsok(() => getModelSetVersions(projektId, modelSetId));
  for (const v of versioner.slice(0, IS_MAX_VERSIONER)) {
    const tester = await bhMedOmforsok(() => listClashTests(projektId, modelSetId, v.version));
    const ok = tester.find(t => /^succe/i.test(t.status || ''));
    if (ok) return { ...ok, modelSetVersion: ok.modelSetVersion ?? v.version };
  }
  return null;
}

// Ett ärende kan ha flera clashgrupper, även i olika model set.
function isLaggTill(ut, issueId, del) {
  const r = ut.get(issueId) || { kvar: 0, lost: 0, totalt: 0, grupper: 0, ingenNy: 0, ingenKorning: 0, modelSet: new Set(), version: null };
  r.grupper++;
  r.kvar   += del.kvar || 0;
  r.lost   += del.lost || 0;
  r.totalt += del.totalt || 0;
  if (del.ingenNy) r.ingenNy++;
  if (del.ingenKorning || del.okandGrupp) r.ingenKorning++;
  if (del.modelSet) r.modelSet.add(del.modelSet);
  if (del.version != null) r.version = Math.max(r.version ?? 0, del.version);

  // Läget avgörs av grupperna som faktiskt kunde jämföras.
  const jamforda = r.grupper - r.ingenNy - r.ingenKorning;
  r.lage = jamforda <= 0 ? (r.ingenNy ? 'ingenNy' : 'okand')
         : r.kvar === 0 ? 'lost'
         : r.lost === 0 ? 'kvar'
         : 'delvis';
  ut.set(issueId, r);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function isRitaModellStatus() {
  const el = document.getElementById('is-modell-status');
  if (el) el.innerHTML = isModellStatusHtml();
}

function isModellStatusHtml() {
  const s = _is.modellStatus;
  if (!s) return '';
  if (s.laddar) return `<span class="text-ads-muted">${s.text} ${s.klara} av ${s.totalt} projekt</span>`;
  const fel = s.fel?.length
    ? `<details class="inline"><summary class="cursor-pointer text-amber-700 inline">${s.fel.length} projekt kunde inte kontrolleras</summary>
         <div class="text-[11px] text-amber-800">${s.fel.map(f => `<div>${vkEsc(f)}</div>`).join('')}</div></details>` : '';
  return `
    <span class="text-ads-muted">Modellkontroll mot senaste clashkörningen, ${s.tid?.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) || ''}.</span>
    <button onclick="isKorModellkontroll(true)" class="text-ads-blue hover:underline ml-1">Kör igen</button>
    ${fel}`;
}

function isModellCellHtml(a) {
  const r = isModellResultat(a);
  if (_is.modellStatus?.laddar && !r) return '<span class="text-[11px] text-ads-muted italic">kontrolleras…</span>';
  const lage = IS_MODELL_LAGE[r?.lage || 'okand'];
  if (!r) return `<span class="text-[11px] text-ads-muted" title="Ärendet är inte kopplat till någon clashgrupp i Model Coordination">–</span>`;
  const detalj = r.lage === 'lost' || r.lage === 'delvis' || r.lage === 'kvar'
    ? `${r.kvar} av ${r.kvar + r.lost} kvar` : r.lage === 'ingenNy' ? 'Ingen körning sedan ärendet skapades' : '';
  const titel = [lage.titel, detalj, [...r.modelSet].join(', '), r.version != null ? `model set-version ${r.version}` : ''].filter(Boolean).join(' · ');
  return `<span class="text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${lage.farg}" title="${vkEsc(titel)}">${lage.kort}</span>
          ${r.lage === 'delvis' ? `<div class="text-[10px] text-ads-muted mt-0.5">${r.kvar} av ${r.kvar + r.lost} kvar</div>` : ''}`;
}
