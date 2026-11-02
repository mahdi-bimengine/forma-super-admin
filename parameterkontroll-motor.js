// parameterkontroll-motor.js — kör en sparad uppsättning utan fliken (del 10).
//
// Används av Veckokontroll. Allt hålls lokalt i anropet, inget läses från eller
// skrivs till fliken Parameterkontrolls tillstånd (_pk). Resultatet har samma
// form som en körning i fliken, så att mätpunkter, Excel och PDF fungerar likadant.

async function pkKorUppsattning(projectId, setup, { signal, onSteg } = {}) {
  const data = {};
  onSteg?.('läser versioner');
  await pkParallellt(setup.modeller, PK_SAMTIDIGA, async m => {
    try { data[m.id] = { version: pkVersionAv(await getItemTip(projectId, m.id)) }; }
    catch (err) { data[m.id] = { fel: `Kunde inte läsa filen: ${vkFelText(err)}` }; }
  });

  const redo = setup.modeller.filter(m => !data[m.id].fel);
  if (redo.length) {
    onSteg?.('väntar på egenskapsindex');
    const index = await pkIndexera(projectId, redo.map(m => data[m.id].version.urn), { signal });
    let klara = 0;
    await pkParallellt(redo, PK_SAMTIDIGA, async m => {
      const d = data[m.id];
      const idx = index[d.version.urn];
      if (idx?.state !== 'FINISHED') {
        d.fel = `ACC kunde inte bygga egenskapsindex (${idx?.state || 'inget svar'}).`;
        return;
      }
      try {
        d.karta = await pkLasKatalog(idx, signal);
        if (d.karta.sort === 'okand') { d.fel = 'ACC:s data för filen är varken Revit eller IFC.'; return; }
        Object.assign(d, await pkLasKategorier(projectId, idx, d.karta, signal));
        d.parametrar = pkBehovdaParametrar(setup, d);
        const kategorier = m.kategorier.filter(k => d.kategoriAntal[k]);
        Object.assign(d, kategorier.length
          ? await pkLasVarden(projectId, idx, d.karta, d.raNamn, kategorier, d.parametrar, signal, d.utelamnade)
          : { element: [], typer: {} });
        d.narvaro = kategorier.length && d.parametrar.length
          ? await pkLasNarvaro(projectId, idx, d.karta, kategorier, d.parametrar, signal, d.utelamnade) : {};
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        d.fel = `Kunde inte läsa modellen: ${vkFelText(err)}`;
      }
      onSteg?.(`${++klara} av ${redo.length} modeller lästa`);
    });
  }

  const modeller = setup.modeller.map(m => {
    const d = data[m.id];
    const bas = { id: m.id, namn: m.namn, filtyp: m.filtyp, version: d.version || null, disciplin: m.disciplin };
    if (d.fel) return { ...bas, status: 'fel', fel: d.fel };
    return { ...bas, status: 'klar', falt: d.karta.falt, kategoriAntal: d.kategoriAntal, hamtade: d.parametrar,
      element: d.element, typer: d.typer, narvaro: d.narvaro, uteslutna: d.uteslutna || [] };
  });
  return {
    id: pkNyttId(), tid: new Date().toISOString(), kalla: 'veckokontroll', pagar: false,
    setup, signatur: pkValSignatur(setup), modeller, resultat: pkBerakna(modeller, pkBerakningsVal(setup)),
    versioner: Object.fromEntries(modeller.map(m => [m.id, m.version?.urn || null])), steg: {}, forra: null,
  };
}

// Lägger en mätpunkt i en uppsättnings historik. Filen ligger i samma mapp
// som parameterkontroll.json och hittas där, inte med sökningen, som är
// långsam för nya filer.
async function pkSparaPunktI(projectId, mappId, setupId, punkt) {
  const namn = pkHistorikFil(setupId);
  const fil = (await getFolderContents(projectId, mappId)).find(it => it.type === 'items' && vkMappNamnAv(it) === namn);
  let poster = [];
  if (fil) {
    try { poster = JSON.parse(await readTextFile(projectId, fil.id)).poster || []; }
    catch { throw new Error(`${namn} går inte att läsa.`); }
  }
  poster = [...poster.filter(p => p.id !== punkt.id), punkt].sort((a, b) => String(a.tid).localeCompare(String(b.tid)));
  await writeTextFile(projectId, mappId, namn, JSON.stringify({ typ: 'forma-console-parameterkontroll-historik', version: 1, setupId, poster }, null, 2), fil?.id);
  return poster;
}
