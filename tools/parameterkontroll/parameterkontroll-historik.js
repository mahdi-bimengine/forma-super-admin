// parameterkontroll-historik.js — mätpunkter och trend (del 7).
//
// En mätpunkt är en sammanfattning av en körning: siffror per modell ×
// kategori och modell × parameter, versionerna, vem som körde och en kopia av
// valen. Inga elementdata. Punkterna sparas per uppsättning i
// parameterkontroll-historik-<id>.json, i samma mapp som parameterkontroll.json.
//
// En punkt sparas när användaren trycker Spara mätpunkt, och av sig själv när
// PDF:en skapas eller rapporterna sparas i ACC, så att en rapport till
// ledningen alltid stämmer med trenden.

function pkHistorikFil(setupId) {
  return `parameterkontroll-historik-${setupId}.json`;
}

function pkMatpunktAv(k) {
  const r = k.resultat;
  return {
    id:        k.id,
    tid:       k.tid,
    kalla:     k.kalla || 'parameterkontroll',
    kordAv:    _profile?.name || _profile?.email || '',
    signatur:  k.signatur,
    setup:     JSON.parse(JSON.stringify(k.setup)),
    totalt:    r.totalt,
    modeller:  r.modeller.map(m => ({
      id: m.id, namn: m.namn, disciplin: m.disciplin, status: m.status, bedomning: m.bedomning,
      version: m.version ? { nummer: m.version.nummer, urn: m.version.urn, datum: m.version.datum } : null,
      nyckeltal: m.nyckeltal,
      kategorier: m.kategorier.map(kat => ({ namn: kat.namn, kontrollerade: kat.kontrollerade, kravVarden: kat.nyckeltal.kravVarden, ifyllda: kat.nyckeltal.ifyllda, klara: kat.klara })),
      parametrar: [...m.kategorier.flatMap(kat => kat.parametrar).reduce((per, p) => {
        const x = per.get(p.namn) || { namn: p.namn, antal: 0, medVarde: 0 };
        x.antal += p.antal; x.medVarde += p.medVarde;
        return per.set(p.namn, x);
      }, new Map()).values()],
    })),
  };
}

async function pkLasHistorik(setupId = _pk.sparatId) {
  if (!setupId) return { poster: [], itemId: null };
  if (_pk.historik?.setupId === setupId) return _pk.historik;
  const pid = _currentProject.id;
  const l = await pkLasLagring();
  let poster = [], itemId = null;
  if (l.mapp) {
    const innehall = await getFolderContents(pid, l.mapp.id);
    const fil = innehall.find(it => it.type === 'items' && vkMappNamnAv(it) === pkHistorikFil(setupId));
    if (fil) {
      itemId = fil.id;
      try { poster = JSON.parse(await readTextFile(pid, fil.id)).poster || []; }
      catch { throw new Error(`${pkHistorikFil(setupId)} går inte att läsa.`); }
    }
  }
  _pk.historik = { setupId, poster: poster.sort((a, b) => String(a.tid).localeCompare(String(b.tid))), itemId };
  return _pk.historik;
}

function pkMatpunktSparad() {
  return !!_pk.historik?.poster?.some(p => p.id === _pk.korning?.id);
}

function pkMatpunktKnapp() {
  const sparad = pkMatpunktSparad();
  return pkKnapp(sparad ? 'Mätpunkt sparad' : 'Spara mätpunkt', 'pkSparaMatpunkt()', {
    av: sparad || !!_pk.sparaMatpunkt,
    titel: sparad ? 'Körningen finns i historiken' : 'Spara körningens siffror i kontrollens historik, för trenden',
  });
}

// Sparar senaste körningen som mätpunkt. Kontrollen måste vara sparad, eftersom
// historiken hör till den. Med tyst visas inga dialoger.
async function pkSparaMatpunkt({ tyst = false } = {}) {
  const k = _pk.korning;
  if (!k?.resultat || _pk.sparaMatpunkt) return false;
  if (pkResultatInaktuellt()) {
    if (!tyst) vkToast('Resultatet är inaktuellt. Uppdatera först, så att mätpunkten stämmer med valen.', 'red');
    return false;
  }
  if (!_pk.sparatId || _pk.sparatId !== _pk.setup.id) {
    if (tyst) return false;
    return pkDialog({
      titel: 'Spara kontrollen först',
      text: 'Historiken hör till en sparad kontroll. Spara kontrollen i projektet, sedan sparas mätpunkten.',
      knappar: [{ text: 'Avbryt' }, { text: 'Spara kontrollen', primar: true, gor: () => { pkSpara().then(() => { if (_pk.sparatId) pkSparaMatpunkt(); }); } }],
    }), false;
  }
  _pk.sparaMatpunkt = true;
  if (pkSynlig()) pkRitaKropp();
  try {
    const pid = _currentProject.id;
    const setupId = _pk.sparatId;
    _pk.historik = null;   // läs om, någon annan kan ha sparat under tiden
    const h = await pkLasHistorik(setupId);
    const poster = [...h.poster.filter(p => p.id !== k.id), pkMatpunktAv(k)].sort((a, b) => String(a.tid).localeCompare(String(b.tid)));
    const mapp = pkLagring().mapp;
    const itemId = await writeTextFile(pid, mapp.id, pkHistorikFil(setupId), JSON.stringify({ typ: 'forma-console-parameterkontroll-historik', version: 1, setupId, poster }, null, 2), h.itemId);
    _pk.historik = { setupId, poster, itemId };
    if (!tyst) vkToast(`Mätpunkten är sparad. Historiken har ${poster.length} ${poster.length === 1 ? 'punkt' : 'punkter'}.`);
    return true;
  } catch (err) {
    vkToast(`Kunde inte spara mätpunkten: ${vkFelText(err)}`, 'red');
    return false;
  } finally {
    _pk.sparaMatpunkt = false;
    if (pkSynlig() && _pk.steg === 'resultat') pkRitaKropp();
  }
}

// ── Trend ─────────────────────────────────────────────────────────────────────
// Punkterna i tidsordning, en per dag (den senaste den dagen). Punkten som
// visas nu räknas med även om den inte är sparad än. brott är sant när urvalet
// (modeller, kategorier, krav) ändrats sedan förra punkten, så att ett hopp i
// kurvan inte läses som framsteg.

function pkTrendPunkter(poster, nu) {
  const alla = [...poster.filter(p => !p.dold && p.id !== nu?.id), ...(nu ? [nu] : [])].sort((a, b) => String(a.tid).localeCompare(String(b.tid)));
  const perDag = new Map();
  for (const p of alla) perDag.set(String(p.tid).slice(0, 10), p);
  const punkter = [...perDag.values()];
  return punkter.map((p, i) => ({ ...p, brott: i > 0 && p.signatur !== punkter[i - 1].signatur }));
}

function pkDisciplinSerie(punkter) {
  const discipliner = [...new Set(punkter.flatMap(p => p.modeller.map(m => m.disciplin || '')))].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'sv'));
  return discipliner.map(d => ({
    disciplin: d,
    varden: punkter.map(p => {
      const ms = p.modeller.filter(m => (m.disciplin || '') === d && m.status === 'klar');
      const kr = ms.reduce((s, m) => s + m.nyckeltal.kravVarden, 0), if_ = ms.reduce((s, m) => s + m.nyckeltal.ifyllda, 0);
      return { andel: kr ? if_ / kr : null, ofullstandig: p.modeller.some(m => (m.disciplin || '') === d && m.status !== 'klar') };
    }),
  }));
}

// Förändring per modell mellan de två senaste jämförbara punkterna: fler
// ifyllda värden skiljs från fler element, så att en växande modell inte ser
// ut att gå bakåt.
function pkForandringar(punkter, O) {
  if (punkter.length < 2) return [];
  const nu = punkter.at(-1), fore = punkter.at(-2);
  if (nu.brott) return [];
  return nu.modeller.filter(m => m.status === 'klar').map(m => {
    const f = fore.modeller.find(x => x.id === m.id && x.status === 'klar');
    if (!f) return null;
    const dIfyllda = m.nyckeltal.ifyllda - f.nyckeltal.ifyllda;
    const dElement = m.nyckeltal.kontrollerade - f.nyckeltal.kontrollerade;
    if (!dIfyllda && !dElement) return null;
    const tal = n => `${n > 0 ? '+' : ''}${pkTalText(n, O.sprak)}`;
    return O.sprak === 'en'
      ? `${m.namn}: ${tal(dIfyllda)} filled values${dElement ? `, ${tal(dElement)} elements` : ''}`
      : `${m.namn}: ${tal(dIfyllda)} ifyllda värden${dElement ? `, ${tal(dElement)} element` : ''}`;
  }).filter(Boolean);
}
