// ── Veckokontroll: baspunkten ─────────────────────────────────────────────────
// Kontrollerar att varje modell innehåller baspunktsfamiljen och att den sitter
// på projektets koordinat.
//
// Familjen bär inga koordinatparametrar, så läget måste läsas ur geometrin.
// Modellen laddas i APS-visaren utanför skärmen, familjen letas upp på namn,
// och elementets omslutande låda ger mittpunkten. Tre saker måste hanteras för
// att siffrorna ska bli samma som ACC visar:
//
//   globalOffset  visaren flyttar stora koordinater nära origo för att inte
//                 tappa precision, så förskjutningen måste läggas tillbaka
//   enhetsskala   geometrin ligger i modellens egen enhet, oftast fot för Revit
//   flera träffar finns familjen i flera exemplar rapporteras alla
//
// Del 4 av 5.

const VK_BP_TIMEOUT = 180000;   // en modell får ta tre minuter att ladda

// ── Läget för en modell ───────────────────────────────────────────────────────

function vkBaspunktBehallare() {
  let el = document.getElementById('vk-bp-visare');
  if (!el) {
    el = document.createElement('div');
    el.id = 'vk-bp-visare';
    // Visaren behöver en yta med storlek för att ladda geometri, men den ska
    // inte synas. Utanför skärmen i stället för display:none.
    el.style.cssText = 'position:fixed;left:-4000px;top:0;width:800px;height:600px;overflow:hidden;';
    document.body.appendChild(el);
  }
  return el;
}

let _vkVisareStartad = false;

function vkStartaVisare() {
  if (_vkVisareStartad) return Promise.resolve();
  return new Promise((klar, fel) => {
    if (typeof Autodesk === 'undefined' || !Autodesk.Viewing) {
      fel(new Error('APS-visaren kunde inte laddas.'));
      return;
    }
    Autodesk.Viewing.Initializer({
      env: 'AutodeskProduction',
      api: 'derivativeV2',
      getAccessToken: cb => cb(sessionStorage.getItem('aps_token'), 3600),
    }, () => { _vkVisareStartad = true; klar(); });
  });
}

// Laddar en modellversion, letar upp familjen och returnerar dess läge i mm.
async function vkLasBaspunkt(versionUrn, familj) {
  await vkStartaVisare();

  const viewer = new Autodesk.Viewing.Viewer3D(vkBaspunktBehallare());
  viewer.start();

  try {
    const doc  = await vkLaddaDokument('urn:' + toSafeBase64(versionUrn));
    const geom = doc.getRoot().getDefaultGeometry();
    if (!geom) throw new Error('Modellen har ingen 3D-vy att läsa.');

    await vkMedTidsgrans(viewer.loadDocumentNode(doc, geom), 'Modellen tog för lång tid att ladda.');
    await vkMedTidsgrans(vkVantaPa(viewer, Autodesk.Viewing.GEOMETRY_LOADED_EVENT), 'Geometrin tog för lång tid.');
    await vkMedTidsgrans(vkVantaPaTrad(viewer), 'Objektträdet tog för lång tid.');

    return vkPositionerIModell(viewer, familj);
  } finally {
    try { viewer.finish(); } catch {}
  }
}

function vkLaddaDokument(urn) {
  return new Promise((klar, fel) => {
    Autodesk.Viewing.Document.load(urn, klar,
      kod => fel(new Error(kod === 4 ? 'Modellen är inte översatt i ACC ännu.' : `Visaren nekade modellen (kod ${kod}).`)));
  });
}

function vkVantaPa(viewer, handelse) {
  return new Promise(klar => viewer.addEventListener(handelse, klar, { once: true }));
}

function vkVantaPaTrad(viewer) {
  if (viewer.model?.getInstanceTree()) return Promise.resolve();
  return vkVantaPa(viewer, Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT);
}

function vkMedTidsgrans(uppgift, meddelande) {
  return Promise.race([
    Promise.resolve(uppgift),
    new Promise((_, fel) => setTimeout(() => fel(new Error(meddelande)), VK_BP_TIMEOUT)),
  ]);
}

// ── Från geometri till koordinat ──────────────────────────────────────────────

function vkSokDbIds(viewer, text) {
  return new Promise(klar => {
    viewer.search(text, klar, () => klar([]));
  });
}

async function vkPositionerIModell(viewer, familj) {
  const model = viewer.model;
  const tree  = model?.getInstanceTree();
  const frags = model?.getFragmentList();
  if (!tree || !frags) throw new Error('Modellens objektträd gick inte att läsa.');

  const sokt = String(familj).trim();
  const traffar = await vkSokDbIds(viewer, sokt);

  // Sökningen träffar på alla egenskaper, så behåll bara de element vars namn
  // verkligen innehåller familjenamnet.
  const nyckel = sokt.toLowerCase();
  const dbIds  = [...new Set(traffar)].filter(id => {
    const namn = tree.getNodeName(id, true) || '';
    return namn.toLowerCase().includes(nyckel);
  });

  const skala  = vkEnhetTillMm(model);
  const offset = vkGlobalOffset(model);

  const positioner = dbIds.map(dbId => {
    const mitt = vkMittpunkt(tree, frags, dbId);
    if (!mitt) return null;
    return {
      dbId,
      namn: tree.getNodeName(dbId, true) || '',
      x: (mitt.x + offset.x) * skala,
      y: (mitt.y + offset.y) * skala,
      z: (mitt.z + offset.z) * skala,
    };
  }).filter(Boolean);

  return {
    positioner,
    teknik: {
      enhet:  model.getUnitString?.() || model.getData?.()?.unit || 'okänd',
      skala,
      offset,
      antalTraffar: traffar.length,
    },
  };
}

function vkMittpunkt(tree, frags, dbId) {
  let min = null, max = null;

  tree.enumNodeFragments(dbId, fragId => {
    const box = new THREE.Box3();
    frags.getWorldBounds(fragId, box);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return;
    min = min ? { x: Math.min(min.x, box.min.x), y: Math.min(min.y, box.min.y), z: Math.min(min.z, box.min.z) }
              : { x: box.min.x, y: box.min.y, z: box.min.z };
    max = max ? { x: Math.max(max.x, box.max.x), y: Math.max(max.y, box.max.y), z: Math.max(max.z, box.max.z) }
              : { x: box.max.x, y: box.max.y, z: box.max.z };
  }, true);

  if (!min || !max) return null;
  return { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
}

// Visaren flyttar modeller med stora koordinater nära origo. Förskjutningen
// måste tillbaka, annars blir svaret några meter från origo i stället för en
// SWEREF-koordinat.
function vkGlobalOffset(model) {
  const o = model.getGlobalOffset?.() || model.getData?.()?.globalOffset || { x: 0, y: 0, z: 0 };
  return { x: o.x || 0, y: o.y || 0, z: o.z || 0 };
}

// Millimeter per intern enhet. Revit-modeller ligger normalt i fot.
function vkEnhetTillMm(model) {
  const meterPerEnhet = model.getUnitScale?.();
  if (typeof meterPerEnhet === 'number' && meterPerEnhet > 0) return meterPerEnhet * 1000;

  const enhet = String(model.getUnitString?.() || model.getData?.()?.unit || '').toLowerCase();
  if (enhet.includes('milli')) return 1;
  if (enhet.includes('centi')) return 10;
  if (enhet.includes('deci'))  return 100;
  if (enhet.includes('foot') || enhet.includes('feet') || enhet === 'ft') return 304.8;
  if (enhet.includes('inch'))  return 25.4;
  return 1000;   // meter
}

// ── Körningen ─────────────────────────────────────────────────────────────────

async function vkKorBaspunkt() {
  const res  = _vk.kor.resultat;
  const inst = _vk.installningar;
  if (!res || !inst?.baspunkt?.aktiv || _vk.bp.pagar) return;

  const modeller = res.rader.filter(r => ['rvt', 'ifc'].includes(r.ext));
  if (!modeller.length) {
    vkToast('Inga RVT- eller IFC-modeller att läsa baspunkten i.', 'red');
    return;
  }

  _vk.bp = { pagar: true, avbryt: false, klara: 0, totalt: modeller.length, rader: [], steg: '' };
  vkRitaBaspunkt();

  const forvantat = vkForvantadPunkt(inst.baspunkt);
  const tolerans  = Number(inst.baspunkt.tolerans) || 0;

  for (const m of modeller) {
    if (_vk.bp.avbryt) break;

    _vk.bp.steg = m.namn;
    vkRitaBaspunkt();

    let rad;
    try {
      const svar = await vkLasBaspunkt(m.versionId, inst.baspunkt.familj);
      rad = vkBedomBaspunkt(m, svar, forvantat, tolerans);
    } catch (err) {
      rad = { namn: m.namn, sokvag: m.sokvag, status: 'fel', fel: err.message };
    }

    _vk.bp.rader.push(rad);
    _vk.bp.klara++;
    vkRitaBaspunkt();
  }

  _vk.bp.pagar = false;
  _vk.bp.steg  = '';
  vkRitaBaspunkt();
}

function vkAvbrytBaspunkt() {
  _vk.bp.avbryt = true;
  _vk.bp.steg   = 'Avbryter efter modellen som läses nu';
  vkRitaBaspunkt();
}

function vkForvantadPunkt(bp) {
  const tal = v => {
    const n = parseFloat(String(v ?? '').replace(',', '.').replace(/\s/g, ''));
    return isFinite(n) ? n : null;
  };
  return { x: tal(bp.forvantat?.ost), y: tal(bp.forvantat?.nord), z: tal(bp.forvantat?.hojd) };
}

function vkBedomBaspunkt(m, svar, forvantat, tolerans) {
  const bas = { namn: m.namn, sokvag: m.sokvag, teknik: svar.teknik, antal: svar.positioner.length };

  if (!svar.positioner.length) return { ...bas, status: 'saknas' };

  // Finns familjen i flera exemplar är det ett fel i sig, men den som ligger
  // närmast förväntat läge är den intressanta att visa.
  const harForvantat = ['x', 'y', 'z'].some(a => forvantat[a] != null);
  const med = svar.positioner.map(p => ({
    ...p,
    avvikelse: {
      x: forvantat.x == null ? null : p.x - forvantat.x,
      y: forvantat.y == null ? null : p.y - forvantat.y,
      z: forvantat.z == null ? null : p.z - forvantat.z,
    },
  }));
  med.sort((a, b) => vkStorstaAvvikelse(a) - vkStorstaAvvikelse(b));
  const bast = med[0];

  if (!harForvantat) return { ...bas, status: 'ingen-referens', position: bast, alla: med };

  const varsta = vkStorstaAvvikelse(bast);
  return {
    ...bas,
    status: varsta <= tolerans ? 'ok' : 'fel-lage',
    position: bast,
    alla: med,
    varsta,
  };
}

function vkStorstaAvvikelse(p) {
  const v = ['x', 'y', 'z'].map(a => (p.avvikelse?.[a] == null ? 0 : Math.abs(p.avvikelse[a])));
  return Math.max(...v);
}

// ── Kortet ────────────────────────────────────────────────────────────────────

function vkRitaBaspunkt() {
  const el = document.getElementById('vk-baspunkt-kort');
  if (el) el.innerHTML = vkRenderBaspunktInnehall();
}

function vkRenderBaspunkt(res) {
  const bp = _vk.installningar?.baspunkt;
  if (!bp?.aktiv) return '';
  if (!res.rader.length) return '';

  return `
    <div class="bg-white border border-ads-border rounded p-5">
      <h3 class="text-sm font-semibold text-ads-text mb-1">Baspunkt</h3>
      <p class="text-xs text-ads-muted mb-3 max-w-2xl">
        Letar efter <strong>${vkEsc(bp.familj)}</strong> i varje RVT- och IFC-modell och läser var den
        sitter. Läget hämtas ur geometrin, vilket kräver att modellen laddas, så det här steget tar
        betydligt längre tid än resten av kontrollen.
      </p>
      <div id="vk-baspunkt-kort">${vkRenderBaspunktInnehall()}</div>
    </div>`;
}

function vkRenderBaspunktInnehall() {
  const bp   = _vk.bp;
  const inst = _vk.installningar.baspunkt;
  const res  = _vk.kor.resultat;
  const antal = res.rader.filter(r => ['rvt', 'ifc'].includes(r.ext)).length;

  const forvantat = vkForvantadPunkt(inst);
  const referens = ['x', 'y', 'z'].some(a => forvantat[a] != null)
    ? `Förväntat läge X ${vkMm(forvantat.x)}, Y ${vkMm(forvantat.y)}, Z ${vkMm(forvantat.z)} mm,
       tolerans ${Number(inst.tolerans) || 0} mm.`
    : `Ingen förväntad koordinat är angiven, så läget redovisas utan bedömning.`;

  if (bp.pagar) {
    return `
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div class="flex items-center gap-2.5 text-sm text-ads-text">
          <svg class="animate-spin w-4 h-4 shrink-0 text-ads-blue" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
            <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
          </svg>
          <span>Läser modell ${bp.klara + 1} av ${bp.totalt}${bp.steg ? `: ${vkEsc(bp.steg)}` : ''}</span>
        </div>
        <button onclick="vkAvbrytBaspunkt()"
                class="text-sm border border-ads-border rounded px-3 py-1.5 text-ads-muted hover:text-ads-text">
          Avbryt
        </button>
      </div>
      ${bp.rader.length ? `<div class="mt-3">${bp.rader.map(vkBaspunktRad).join('')}</div>` : ''}`;
  }

  if (!bp.rader.length) {
    return `
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <p class="text-xs text-ads-muted">${referens}</p>
        <button onclick="vkKorBaspunkt()"
                class="shrink-0 text-sm font-medium rounded px-4 py-2 bg-be-charcoal text-white hover:bg-black transition-colors">
          Kontrollera baspunkten i ${antal} modell${antal === 1 ? '' : 'er'}
        </button>
      </div>`;
  }

  const raknare = {
    ok:      bp.rader.filter(r => r.status === 'ok').length,
    felLage: bp.rader.filter(r => r.status === 'fel-lage').length,
    saknas:  bp.rader.filter(r => r.status === 'saknas').length,
    fel:     bp.rader.filter(r => r.status === 'fel').length,
  };

  return `
    <div class="flex items-center justify-between gap-4 flex-wrap mb-3">
      <p class="text-xs text-ads-muted">
        ${bp.rader.length} av ${bp.totalt} lästa.
        ${raknare.ok} rätt, ${raknare.felLage} fel läge, ${raknare.saknas} saknar familjen,
        ${raknare.fel} kunde inte läsas.
      </p>
      <button onclick="vkKorBaspunkt()"
              class="shrink-0 text-sm border border-ads-border rounded px-3 py-1.5 text-ads-muted hover:text-ads-text">
        Läs om
      </button>
    </div>
    ${bp.rader.map(vkBaspunktRad).join('')}
    <p class="text-[11px] text-ads-muted mt-3 border-t border-dashed border-ads-border pt-2.5">
      Stämmer alla modeller överens med varandra men avviker lika mycket mot förväntat läge, titta på
      den tekniska raden. Då är det troligen enheten eller nollpunktsförskjutningen som skiljer, inte
      modellerna.
    </p>`;
}

function vkBaspunktRad(r) {
  const marke = {
    ok:               vkMarke('Rätt läge', 'gron'),
    'fel-lage':       vkMarke('Fel läge', 'rod'),
    saknas:           vkMarke('Familjen saknas', 'rod'),
    'ingen-referens': vkMarke('Läge inläst', 'bla'),
    fel:              vkMarke('Kunde inte läsas', 'orange'),
  }[r.status];

  const p = r.position;

  return `
    <div class="border-t border-ads-border py-2.5">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-sm text-ads-text font-medium">${vkEsc(r.namn)}</span>
        ${marke}
        ${r.antal > 1 ? vkMarke(`${r.antal} exemplar av familjen`, 'orange') : ''}
      </div>
      ${r.fel ? `<p class="text-[11px] text-orange-700 mt-0.5">${vkEsc(r.fel)}</p>` : ''}
      ${p ? `
        <div class="text-[11px] text-ads-muted mt-1 font-mono">
          X ${vkMm(p.x)} &nbsp; Y ${vkMm(p.y)} &nbsp; Z ${vkMm(p.z)} mm
          ${p.avvikelse.x != null ? `<br/>Avvikelse
            X ${vkAvvikelse(p.avvikelse.x)} &nbsp; Y ${vkAvvikelse(p.avvikelse.y)} &nbsp; Z ${vkAvvikelse(p.avvikelse.z)} mm` : ''}
        </div>` : ''}
      ${r.alla?.length > 1 ? `
        <div class="text-[11px] text-ads-muted mt-1">
          Övriga exemplar:
          ${r.alla.slice(1).map(o => `X ${vkMm(o.x)}, Y ${vkMm(o.y)}, Z ${vkMm(o.z)}`).join(' &nbsp;|&nbsp; ')}
        </div>` : ''}
      ${r.teknik ? `
        <p class="text-[10px] text-ads-muted mt-1">
          Enhet ${vkEsc(r.teknik.enhet)}, ${r.teknik.skala} mm per enhet,
          nollpunktsförskjutning ${vkMm(r.teknik.offset.x)}, ${vkMm(r.teknik.offset.y)}, ${vkMm(r.teknik.offset.z)}
        </p>` : ''}
    </div>`;
}

function vkMm(v) {
  if (v == null || !isFinite(v)) return '–';
  return Number(v).toLocaleString('sv-SE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function vkAvvikelse(v) {
  if (v == null || !isFinite(v)) return '–';
  const t = vkMm(Math.abs(v));
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${t}`;
}
