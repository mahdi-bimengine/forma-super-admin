// parameterkontroll-stub.js — påhittade modeller för att prova fliken lokalt.
//
// Laddas bara för hand i en lokal kopia, aldrig i index.html. Byter ut
// ACC-anropen mot påhittade data och öppnar fliken:
//
//   const s = document.createElement('script'); s.src = 'tools/parameterkontroll/test/parameterkontroll-stub.js'; document.head.appendChild(s);
//
// Inget hämtas från ACC och inget sparas där.

(function () {
  const FILER = [
    { id: 'urn:test:A', namn: 'B1-A-400-V-ZZ-001.rvt', mapp: 'f-arkitekt' },
    { id: 'urn:test:K', namn: 'B1-K-200-V-ZZ-001.rvt', mapp: 'f-konstruktion' },
    { id: 'urn:test:V', namn: 'B1-V-500-V-ZZ-001.rvt', mapp: 'f-installation' },
    { id: 'urn:test:I', namn: 'B1-E-600-V-ZZ-001.ifc', mapp: 'f-installation' },
  ];

  // Ett deterministiskt slumptal, så att siffrorna blir samma varje gång.
  let fro = 7;
  const slump = () => ((fro = (fro * 16807) % 2147483647) / 2147483647);

  function bygg(fil) {
    const ifc = fil.namn.endsWith('.ifc');
    const kat = ifc
      ? { IfcWall: 30, IfcDoor: 10, IfcSpace: 6, IfcBuildingStorey: 2 }
      : { Walls: 40, Doors: 12, Rooms: 8, 'Generic Models': 6, Floors: 10, 'Project Information': 1, '<Sketch>': 120, 'Cable Trays': 4 };
    const geometri = k => !['Rooms', 'Project Information', '<Sketch>', 'IfcSpace', 'IfcBuildingStorey'].includes(k);
    const typer = { 1: { namn: 'Typ A', familj: 'Dörr', varden: { Brandklass: ['EI30'] } }, 2: { namn: 'Typ B', familj: 'Dörr', varden: {} } };
    const element = [];
    let id = 100;
    for (const [k, n] of Object.entries(kat)) {
      for (let i = 0; i < n; i++) {
        const varden = {};
        if (k !== '<Sketch>') {
          if (slump() < 0.72) varden['RDS-kod'] = [`=A1-${k.slice(0, 2).toUpperCase()}${i}`];
          if (slump() < 0.5) varden.Mark = [`M${i}`];
          if (slump() < 0.9) varden.IfcGUID = [`guid${id}`];
          if (k === 'Cable Trays' && i === 0) varden['RDS-kod'] = ['=E1'];
        }
        const dorr = k === 'Doors' || k === 'IfcDoor';
        const typId = dorr ? (i % 2 ? 1 : 2) : null;
        if (dorr && typId === 1) varden.Brandklass = ['EI30'];
        element.push({
          id, extId: ifc ? `3Gq${id}x` : `60f91daf-3dd7-4283-a86d-24137b73f3da-${id.toString(16).padStart(8, '0')}`,
          kategori: k, familj: dorr ? 'Dörr' : k === 'Generic Models' && i < 2 ? 'Ref Marker' : k, typ: dorr ? typer[typId].namn : 'Standard',
          namn: `${k} ${i + 1}`, typId, elementId: ifc ? null : id, nastlad: false, varden,
        });
        id++;
      }
    }
    const falt = ['RDS-kod', 'Mark', 'IfcGUID', 'Brandklass', 'RDS kod', 'Comments'].map(namn => ({ namn, grupp: 'Data', typ: 'String', enhet: null }));
    const kategoriAntal = {};
    for (const [k, n] of Object.entries(kat)) kategoriAntal[k] = { antal: n, nastlade: 0, geometri: geometri(k) ? n : 0 };
    return { ifc, element, typer, falt, kategoriAntal };
  }

  const MODELLER = Object.fromEntries(FILER.map(f => [f.id, bygg(f)]));
  const vanta = ms => new Promise(r => setTimeout(r, ms));

  const mapp = (id, namn) => ({ type: 'folders', id, attributes: { displayName: namn } });
  const fil  = f => ({ type: 'items', id: f.id, attributes: { displayName: f.namn } });
  const MAPPAR = {
    __topp__: [mapp('f-projekt', 'Project Files')],
    'f-projekt': [mapp('f-arkitekt', 'A – Arkitekt'), mapp('f-konstruktion', 'K – Konstruktion'), mapp('f-installation', 'Installation')],
  };
  for (const f of FILER) (MAPPAR[f.mapp] ??= []).push(fil(f));
  MAPPAR['f-arkitekt'].push({ type: 'items', id: 'urn:test:pdf', attributes: { displayName: 'Ritning.pdf' } });

  // Filer som "sparas i ACC" hamnar här, per namn.
  const ACC = window.pkStubFiler = {};
  const MAPPNAMN = { 'f-projekt': 'Project Files', 'f-arkitekt': 'A – Arkitekt', 'f-konstruktion': 'K – Konstruktion', 'f-installation': 'Installation' };

  Object.assign(window, {
    searchFolder:       async (_, __, namn) => { await vanta(100); const f = ACC[namn]; return f ? [{ itemId: f.itemId, namn, andrad: f.andrad }] : []; },
    readTextFile:       async (_, itemId) => { await vanta(100); return Object.values(ACC).find(f => f.itemId === itemId)?.text || ''; },
    getItemParent:      async (_, itemId) => { const f = Object.values(ACC).find(x => x.itemId === itemId); return { id: f.mapp, attributes: { displayName: MAPPNAMN[f.mapp] || f.mapp } }; },
    writeTextFile:      async (_, mapp, namn, innehall, fanns) => {
      await vanta(200);
      const text = typeof innehall === 'string' ? innehall : await innehall.text();
      const itemId = fanns || `urn:stub:${namn}`;
      ACC[namn] = { itemId, text, mapp, andrad: new Date().toISOString(), versioner: (ACC[namn]?.versioner || 0) + 1 };
      return itemId;
    },
    getTopFolders:      async () => { await vanta(150); return MAPPAR.__topp__; },
    getFolderContents:  async (_, id) => {
      await vanta(150);
      const sparade = Object.entries(ACC).filter(([, f]) => f.mapp === id).map(([namn, f]) => ({ type: 'items', id: f.itemId, attributes: { displayName: namn } }));
      return [...(MAPPAR[id] || []), ...sparade];
    },
    getItemTip:         async (_, id) => { await vanta(200); return { id: `${id}?version=3`, attributes: { versionNumber: 3, lastModifiedTime: '2026-10-29T10:00:00Z' } }; },
    listModelSets:      async () => { await vanta(150); return [{ id: 'ms1', name: 'Samordning B1' }]; },
    getModelSetVersions: async () => [{ id: 4 }],
    listModelSetItems:  async () => FILER.map(f => ({ itemUrn: f.id, versionUrn: `${f.id}?version=3`, name: f.namn, isTipVersion: f.id !== 'urn:test:K' })),
    pkIndexera:         async (_, urns) => { await vanta(600); return Object.fromEntries(urns.map(u => [u, { state: 'FINISHED', indexId: u }])); },
    pkLasKatalog:       async index => { await vanta(200); const m = MODELLER[index.indexId.split('?')[0]]; return { sort: m.ifc ? 'ifc' : 'revit', falt: m.falt, perNamn: new Map() }; },
    pkLasKategorier:    async (_, index) => { await vanta(300); const m = MODELLER[index.indexId.split('?')[0]]; return { kategoriAntal: m.kategoriAntal, raNamn: Object.fromEntries(Object.keys(m.kategoriAntal).map(k => [k, k])),
      uteslutna: m.ifc ? [] : [{ kategori: 'Walls', orsak: 'rivna', antal: 3 }, { kategori: 'Walls', orsak: 'designalternativ', antal: 2 }, { kategori: 'Rooms', orsak: 'utanYta', antal: 1 }] }; },
    pkLasVarden:        async (_, index, __, ___, kategorier, parametrar) => {
      await vanta(500);
      const m = MODELLER[index.indexId.split('?')[0]];
      const element = m.element.filter(e => kategorier.includes(e.kategori)).map(e => ({ ...e, varden: Object.fromEntries(Object.entries(e.varden).filter(([k]) => parametrar.includes(k))) }));
      const typer = Object.fromEntries(Object.entries(m.typer).map(([id, t]) => [id, { ...t, varden: Object.fromEntries(Object.entries(t.varden).filter(([k]) => parametrar.includes(k))) }]));
      return { element, typer };
    },
    pkLasNarvaro:       async (_, index, __, valda, parametrar) => {
      await vanta(200);
      const m = MODELLER[index.indexId.split('?')[0]];
      const ut = {};
      for (const e of m.element) {
        if (valda.includes(e.kategori)) continue;
        for (const p of parametrar) if (e.varden[p]) { ut[e.kategori] ??= {}; ut[e.kategori][p] = (ut[e.kategori][p] || 0) + 1; }
      }
      return ut;
    },
  });

  setToken('test');
  _hubs = [{ id: 'b.hub', attributes: { name: 'Testhub' } }];
  _hubIdx = 0;
  _profile = { email: 'test@exempel.se', name: 'Test Testsson' };
  document.getElementById('app-header')?.classList.remove('hidden');
  document.getElementById('login-page')?.remove();
  renderProjectView({ id: 'b.test-projekt', attributes: { name: 'Testprojekt (påhittat)' } });
  showTab('parameterkontroll');
})();
