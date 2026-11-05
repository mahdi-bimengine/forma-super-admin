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
      _is.modellStatus.fel.push(`${_is.projekt.get(projektId)?.namn || projektId}: ${String(err.message || err).slice(0, 300)}`);
    }
    _is.modellStatus.klara++;
    isRitaModellStatus();
  }));

  _is.modell = nya;
  _is.modellStatus = { ..._is.modellStatus, laddar: false, klar: true, tid: new Date() };
  if (_is.yta === 'clash') isRita();
}

// Model Coordination svarar ibland 502/503/504 när ett anrop tar för lång tid.
// Läsningar görs därför om även vid serverfel, inte bara vid 429.
async function isMcLas(steg, fn) {
  for (let forsok = 0; ; forsok++) {
    try {
      return await fn();
    } catch (err) {
      const status = Number(String(err.message).match(/APS error (\d+)/)?.[1]);
      const igen = status === 429 || (status >= 500 && status <= 504);
      if (!igen || forsok >= 3) {
        const forklaring = { 403: 'ingen åtkomst till Model Coordination', 404: 'hittades inte', 429: 'för många anrop',
                             500: 'serverfel', 502: 'serverfel', 503: 'tjänsten är inte tillgänglig', 504: 'tog för lång tid' }[status];
        const detalj = String(err.message).replace(/^APS error \d+:\s*/, '').slice(0, 140);
        throw new Error(`${steg}: ${forklaring ? `${forklaring} (${status}) ` : ''}${detalj}`);
      }
      await new Promise(r => setTimeout(r, 1500 * 2 ** forsok));
    }
  }
}

async function isKontrolleraProjekt(projektId, ids, ut) {
  const set = await isMcLas('Läsa model set', () => listModelSets(projektId));
  for (const ms of set) {
    _is.modellStatus.text = `Kontrollerar ${ms.name || 'model set'}…`;
    isRitaModellStatus();
    const grupper = (await isMcLas(`Läsa ärendekopplade clashgrupper i "${ms.name}"`, () => listAssignedClashGroups(projektId, ms.id)))
      .filter(g => ids.has(g.issueId));
    if (!grupper.length) continue;

    const test = await isSenasteLyckadeKorning(projektId, ms);
    if (!test) {
      for (const g of grupper) isLaggTill(ut, g.issueId, { ingenKorning: true, modelSet: ms.name });
      continue;
    }

    // Jämför bara grupperna som hör till de slutförda ärendena, 20 åt gången.
    // Att jämföra alla grupper i model setet på en gång tar för lång tid i stora
    // projekt och ger 504.
    const lage = new Map();
    const omgangar = [];
    for (let i = 0; i < grupper.length; i += 20) omgangar.push(grupper.slice(i, i + 20).map(g => g.id));
    let klara = 0;
    let n = 0;
    const arbetare = async () => {
      while (n < omgangar.length) {
        const omgang = omgangar[n++];
        const svar = await isMcLas(`Jämföra med körningen i "${ms.name}" (version ${test.modelSetVersion})`,
          () => postAssignedClashState(projektId, test.id, omgang));
        for (const s of svar) lage.set(s.id, s);
        klara += omgang.length;
        _is.modellStatus.text = `Jämför ${ms.name}: ${klara} av ${grupper.length} clashgrupper`;
        isRitaModellStatus();
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, omgangar.length) }, arbetare));

    for (const g of grupper) {
      const s = lage.get(g.id);
      if (!s) {
        isLaggTill(ut, g.issueId, { okandGrupp: true, modelSet: ms.name, version: test.modelSetVersion });
        continue;
      }
      // Skapades gruppen från just den här körningen har ingen ny körning gjorts.
      const ingenNy = g.clashTestId === test.id || (s.createdAtVersion != null && test.modelSetVersion <= s.createdAtVersion);
      const { kvar, lost, totalt } = isRaknaClashar(g, s);
      isLaggTill(ut, g.issueId, {
        kvar:   ingenNy ? 0 : kvar,
        lost:   ingenNy ? 0 : lost,
        totalt,
        ingenNy,
        modelSet: ms.name,
        version:  test.modelSetVersion,
      });
    }
  }
}

// Hur många av gruppens clashar som finns kvar i körningen. Svaret kan komma
// i två former: existing/resolved (GET-varianten) eller clashData.clashes med
// de clashar som finns i körningen (POST-varianten), som jämförs med gruppens
// ursprungliga clashar.
function isRaknaClashar(g, s) {
  if (s.existing || s.resolved) {
    const kvar = (s.existing || []).length, lost = (s.resolved || []).length;
    return { kvar, lost, totalt: (g.clashes || []).length || kvar + lost };
  }
  const iKorningen = (s.clashData?.clashes || []).filter(c => !/resolv|closed/i.test(c.status || ''));
  const ids = new Set(iKorningen.map(c => c.id));
  const ursprung = g.clashes || [];
  if (!ursprung.length) return { kvar: iKorningen.length, lost: 0, totalt: iKorningen.length };
  let kvar = ursprung.filter(id => ids.has(id)).length;
  // Matchar inga id alls men körningen har clashar i gruppen räknas de som kvar,
  // hellre än att visa allt som löst.
  if (!kvar && iKorningen.length) kvar = Math.min(iKorningen.length, ursprung.length);
  return { kvar, lost: ursprung.length - kvar, totalt: ursprung.length };
}

// Senaste model set-versionen som har en lyckad clashkörning.
async function isSenasteLyckadeKorning(projektId, ms) {
  const versioner = await isMcLas(`Läsa versioner i "${ms.name}"`, () => getModelSetVersions(projektId, ms.id));
  for (const v of versioner.slice(0, IS_MAX_VERSIONER)) {
    const tester = await isMcLas(`Läsa clashkörningar för version ${v.version} i "${ms.name}"`, () => listClashTests(projektId, ms.id, v.version));
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
    ? `<div class="mt-1 text-[11px] text-amber-800">${s.fel.length} projekt kunde inte kontrolleras:
         ${s.fel.map(f => `<div class="font-mono">${vkEsc(f)}</div>`).join('')}</div>` : '';
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
