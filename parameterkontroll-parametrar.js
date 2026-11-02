// parameterkontroll-parametrar.js — steg 3 i fliken Parameterkontroll:
// kravprofilen (del 4).
//
// Kraven byggs på tre sätt som kan blandas: en shared parameter-fil från
// Revit, regler med jokertecken mot namnen i modellerna och en inklistrad
// lista. Samma namn från flera källor blir ett krav.
//
// Varje krav jämförs direkt med modellernas egenskapskatalog: i hur många
// modeller det finns, om datatypen stämmer, om ett nästan likadant namn finns
// och om namnet inte finns någonstans. Inget behöver köras för det.

function pkParamUi() {
  _pk.ui.param ??= { kalla: 'fil', fil: null, filSok: '', filGrupp: '', filMarkerade: new Set(), monster: '', klistra: '', sok: '', omfang: null };
  return _pk.ui.param;
}

// ── Shared parameter-filen ────────────────────────────────────────────────────
// Revit sparar filen som UTF-16 med BOM, andra program ibland som UTF-8 eller
// ANSI. Raderna är tabbseparerade: GROUP-rader ger grupp-id → namn, PARAM-rader
// är PARAM, GUID, NAME, DATATYPE, DATACATEGORY, GROUP, VISIBLE, DESCRIPTION ...

function pkAvkodaParameterfil(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
  catch { return new TextDecoder('windows-1252').decode(b); }
}

function pkTolkaParameterfil(text) {
  const guidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const grupper = {}, parametrar = [], varningar = [];
  const guider = new Set(), namn = new Set();
  text.split(/\r?\n/).forEach((rad, n) => {
    if (!rad.trim() || rad[0] === '#' || rad[0] === '*') return;
    const c = rad.split('\t');
    if (c[0] === 'GROUP') { grupper[(c[1] || '').trim()] = (c[2] || '').trim(); return; }
    if (c[0] !== 'PARAM') return;
    const guid = (c[1] || '').trim().toLowerCase();
    const nm   = pkNyckel(c[2]);
    if (!guidRe.test(guid) || !nm) return varningar.push(`Rad ${n + 1}: ogiltig GUID eller saknat namn, hoppades över.`);
    if (guider.has(guid)) return varningar.push(`Rad ${n + 1}: GUID för "${nm}" finns redan i filen, hoppades över.`);
    guider.add(guid);
    if (namn.has(nm)) varningar.push(`"${nm}" finns flera gånger i filen med olika GUID. Kontrollen matchar på namn och kan inte skilja dem åt.`);
    namn.add(nm);
    parametrar.push({ namn: nm, guid, datatyp: (c[3] || '').trim().toUpperCase(), grupp: (c[5] || '').trim(), beskrivning: (c[7] || '').trim() });
  });
  parametrar.forEach(p => { p.grupp = grupper[p.grupp] || p.grupp; });
  return { parametrar, varningar };
}

function pkLaddaParameterfil(buffer, kalla) {
  const { parametrar, varningar } = pkTolkaParameterfil(pkAvkodaParameterfil(buffer));
  if (!parametrar.length) throw new Error('Hittade inga parametrar. Är det en shared parameter-fil från Revit?');
  const ui = pkParamUi();
  const redan = new Set(_pk.setup.kravprofil.krav.map(k => k.namn));
  ui.fil = { ...kalla, parametrar, varningar };
  ui.filMarkerade = new Set(parametrar.filter(p => !redan.has(p.namn)).map(p => p.namn));
  ui.filSok = ''; ui.filGrupp = '';
  pkRitaParamKalla();
}

async function pkParameterfilUpp(fil) {
  try { pkLaddaParameterfil(await fil.arrayBuffer(), { namn: fil.name, itemId: null, version: null }); }
  catch (err) { vkToast(`Kunde inte läsa filen: ${err.message}`, 'red'); }
}

async function pkHamtaFilInnehall(itemId) {
  const { urls } = await getItemDownload(_currentProject.id, itemId);
  if (!urls.length) throw new Error('Filen har ingen nedladdningsadress.');
  const res = await fetch(urls[0]);
  if (!res.ok) throw new Error(`Kunde inte hämta filen (${res.status}).`);
  return res.arrayBuffer();
}

async function pkParameterfilAcc() {
  const val = await pkValjMapp('Välj shared parameter-fil i ACC', 'Öppna mappar och välj en .txt-fil.', { filer: namn => /\.txt$/i.test(namn) });
  if (!val) return;
  try {
    const [buffer, tip] = await Promise.all([pkHamtaFilInnehall(val.id), getItemTip(_currentProject.id, val.id)]);
    pkLaddaParameterfil(buffer, { namn: val.namn, itemId: val.id, version: tip?.attributes?.versionNumber ?? null });
  } catch (err) {
    vkToast(`Kunde inte läsa filen: ${vkFelText(err)}`, 'red');
  }
}

function pkFilFiltrerade() {
  const ui = pkParamUi();
  const q = ui.filSok.trim().toLocaleLowerCase('sv');
  return (ui.fil?.parametrar || []).filter(p => (!ui.filGrupp || p.grupp === ui.filGrupp) && (!q || p.namn.toLocaleLowerCase('sv').includes(q)));
}

function pkFilMarkera(i, pa) {
  const ui = pkParamUi();
  const p  = ui.fil?.parametrar[i];
  if (!p) return;
  if (pa) ui.filMarkerade.add(p.namn); else ui.filMarkerade.delete(p.namn);
  pkRitaParamKallaRakna();
}

function pkFilMarkeraAlla(pa) {
  const ui = pkParamUi();
  for (const p of pkFilFiltrerade()) { if (pa) ui.filMarkerade.add(p.namn); else ui.filMarkerade.delete(p.namn); }
  pkRitaParamKalla();
}

function pkFilLaggTill() {
  const ui = pkParamUi();
  const valda = ui.fil.parametrar.filter(p => ui.filMarkerade.has(p.namn));
  if (!valda.length) return vkToast('Markera minst en parameter.', 'red');
  pkAndra(`La till ${valda.length} krav från ${ui.fil.namn}`, s => {
    const p = s.kravprofil;
    const finns = new Map(p.krav.map(k => [k.namn, k]));
    for (const v of valda) {
      const k = finns.get(v.namn);
      if (k) Object.assign(k, { datatyp: k.datatyp || v.datatyp, guid: v.guid, grupp: v.grupp, beskrivning: k.beskrivning || v.beskrivning });
      else p.krav.push({ namn: v.namn, kalla: 'fil', datatyp: v.datatyp, guid: v.guid, grupp: v.grupp, beskrivning: v.beskrivning, kategorier: null });
    }
    if (ui.fil.itemId) p.parameterfil = { itemId: ui.fil.itemId, namn: ui.fil.namn, version: ui.fil.version, parametrar: ui.fil.parametrar.map(x => x.namn) };
  });
  ui.fil = null;
}

// ── Ny version av parameterfilen ──────────────────────────────────────────────

async function pkKollaParameterfil() {
  const pf = _pk.setup.kravprofil.parameterfil;
  if (!pf?.itemId) return;
  const gen = _pk.generation;
  try {
    const tip = await getItemTip(_currentProject.id, pf.itemId);
    const version = tip?.attributes?.versionNumber ?? null;
    if (gen !== _pk.generation || version === pf.version) return;
    const { parametrar } = pkTolkaParameterfil(pkAvkodaParameterfil(await pkHamtaFilInnehall(pf.itemId)));
    if (gen !== _pk.generation) return;
    const fore = new Set(pf.parametrar || []);
    const nu   = new Set(parametrar.map(p => p.namn));
    pkParamUi().nyFil = {
      version, parametrar,
      tillagda:  parametrar.filter(p => !fore.has(p.namn)),
      borttagna: [...fore].filter(n => !nu.has(n)),
    };
    pkRitaParametrarDelar();
    if (_pk.oppning) _pk.oppning.parameterfil = pkParamUi().nyFil;
    pkRitaUtkast();
  } catch { /* filen gick inte att läsa; kraven står kvar som de är */ }
}

function pkUppdateraFranParameterfil() {
  const ny = pkParamUi().nyFil;
  if (!ny) return;
  const finns = new Set(_pk.setup.kravprofil.krav.map(k => k.namn));
  const bort  = ny.borttagna.filter(n => finns.has(n));
  pkDialog({
    titel: `Uppdatera från parameterfilen (version ${ny.version})`,
    text: `${ny.tillagda.length} nya parametrar läggs till som krav${bort.length ? ` och ${bort.length} som inte längre finns i filen tas bort` : ''}. Du kan ångra efteråt.`,
    lista: [...ny.tillagda.map(p => `+ ${p.namn}`), ...bort.map(n => `− ${n}`)],
    knappar: [{ text: 'Avbryt' }, { text: 'Uppdatera', primar: true, gor: () => {
      pkAndra('Uppdaterade från parameterfilen', s => {
        const p = s.kravprofil;
        const bortSet = new Set(bort);
        p.krav = p.krav.filter(k => !(bortSet.has(k.namn) && k.kalla === 'fil'));
        for (const v of ny.tillagda) if (!p.krav.some(k => k.namn === v.namn)) p.krav.push({ namn: v.namn, kalla: 'fil', datatyp: v.datatyp, guid: v.guid, grupp: v.grupp, beskrivning: v.beskrivning, kategorier: null });
        p.parameterfil = { ...p.parameterfil, version: ny.version, parametrar: ny.parametrar.map(x => x.namn) };
      });
      pkParamUi().nyFil = null;
      if (_pk.oppning) _pk.oppning.parameterfil = null;
    } }],
  });
}

// ── Regler och inklistrat ─────────────────────────────────────────────────────

// Alla parameternamn i de förberedda modellernas kataloger, med i hur många
// modeller de finns.
function pkKatalogNamn() {
  const per = new Map();
  let modeller = 0;
  for (const m of _pk.setup.modeller) {
    const falt = pkModellData(m.id)?.karta?.falt;
    if (!falt) continue;
    modeller++;
    for (const n of new Set(falt.map(f => f.namn))) per.set(n, (per.get(n) || 0) + 1);
  }
  return { per, modeller };
}

function pkMonsterTraffar(monster) {
  if (!monster.trim()) return [];
  const { per } = pkKatalogNamn();
  return [...per.keys()].filter(n => pkMonsterMatchar(monster, n)).sort((a, b) => a.localeCompare(b, 'sv'));
}

function pkSparaRegel() {
  const ui = pkParamUi();
  const monster = ui.monster.trim();
  if (!monster) return vkToast('Skriv ett mönster, t.ex. RDS*.', 'red');
  if (_pk.setup.kravprofil.regler.some(r => r.monster === monster)) return vkToast('Regeln finns redan.', 'red');
  if (!pkArMonster(monster)) {
    // Utan jokertecken är det ett vanligt krav.
    ui.monster = '';
    return pkAndra(`La till kravet ${monster}`, s => { if (!s.kravprofil.krav.some(k => k.namn === pkNyckel(monster))) s.kravprofil.krav.push({ namn: pkNyckel(monster), kalla: 'lista', kategorier: null }); });
  }
  ui.monster = '';
  pkAndra(`La till regeln ${monster}`, s => { s.kravprofil.regler.push({ monster, kategorier: null }); });
}

function pkLaggTillInklistrat() {
  const ui = pkParamUi();
  const rader = ui.klistra.split(/\r?\n/).map(r => pkNyckel(r.split('\t')[0])).filter(Boolean);
  const unika = [...new Set(rader)];
  if (!unika.length) return vkToast('Klistra in minst ett namn.', 'red');
  const regler = unika.filter(pkArMonster), namn = unika.filter(n => !pkArMonster(n));
  ui.klistra = '';
  pkAndra(`La till ${unika.length} krav från en lista`, s => {
    const p = s.kravprofil;
    for (const n of namn) if (!p.krav.some(k => k.namn === n)) p.krav.push({ namn: n, kalla: 'lista', kategorier: null });
    for (const m of regler) if (!p.regler.some(r => r.monster === m)) p.regler.push({ monster: m, kategorier: null });
  });
}

// ── Kraven i kontrollen ───────────────────────────────────────────────────────

// Vad katalogerna säger om ett krav: i hur många modeller namnet finns,
// liknande namn, datatyper som inte stämmer och modeller som saknar det.
function pkKravInfo(k) {
  let finns = 0, modeller = 0;
  const liknande = new Set(), felTyp = [];
  for (const m of _pk.setup.modeller) {
    const falt = pkModellData(m.id)?.karta?.falt;
    if (!falt) continue;
    modeller++;
    const exakta = falt.filter(f => f.namn === k.namn);
    if (exakta.length) finns++;
    for (const f of falt) if (f.namn !== k.namn && pkLos(f.namn) === pkLos(k.namn)) liknande.add(f.namn);
    const dt = pkJamforDatatyp(k.datatyp, exakta);
    if (dt.ok === false) felTyp.push({ modell: m.namn, typ: dt.modell.join(', ') });
  }
  return { finns, modeller, liknande: [...liknande], felTyp };
}

function pkTaBortKrav(i) {
  const k = _pk.setup.kravprofil.krav[i];
  if (k) pkAndra(`Tog bort kravet ${k.namn}`, s => { s.kravprofil.krav.splice(i, 1); });
}

function pkTaBortRegel(i) {
  const r = _pk.setup.kravprofil.regler[i];
  if (r) pkAndra(`Tog bort regeln ${r.monster}`, s => { s.kravprofil.regler.splice(i, 1); });
}

function pkRensaKrav() {
  pkDialog({
    titel: 'Ta bort alla krav?',
    text: `${_pk.setup.kravprofil.krav.length} krav och ${_pk.setup.kravprofil.regler.length} regler tas bort. Du kan ångra efteråt.`,
    knappar: [{ text: 'Avbryt' }, { text: 'Ta bort alla', primar: true, gor: () => pkAndra('Tog bort alla krav', s => { s.kravprofil.krav = []; s.kravprofil.regler = []; }) }],
  });
}

// ── Vilka kategorier kraven gäller ────────────────────────────────────────────

function pkAllaValdaKategorier() {
  return [...new Set(_pk.setup.modeller.flatMap(m => m.kategorier))].sort((a, b) => a.localeCompare(b, 'sv'));
}

function pkOmfangText(kategorier) {
  if (!kategorier) return 'Alla valda kategorier';
  if (!kategorier.length) return 'Ingen kategori';
  return kategorier.length <= 2 ? kategorier.join(', ') : `${kategorier.length} kategorier`;
}

function pkOppnaOmfang(typ, i) {
  const ui = pkParamUi();
  ui.omfang = ui.omfang?.typ === typ && ui.omfang.i === i ? null : { typ, i };
  pkRitaKravlista();
}

function pkSattOmfang(typ, i, kategori, pa) {
  const valda = pkAllaValdaKategorier();
  pkAndra('Ändrade vilka kategorier ett krav gäller', s => {
    const post = typ === 'regel' ? s.kravprofil.regler[i] : s.kravprofil.krav[i];
    let k = post.kategorier ? [...post.kategorier] : [...valda];
    k = pa ? [...new Set([...k, kategori])] : k.filter(x => x !== kategori);
    post.kategorier = valda.every(v => k.includes(v)) ? null : k;
  }, { rita: false });
  pkRitaKravlista();
  pkRitaTopp();
}

function pkOmfangAlla(typ, i) {
  pkAndra('Kravet gäller alla kategorier', s => {
    (typ === 'regel' ? s.kravprofil.regler[i] : s.kravprofil.krav[i]).kategorier = null;
  }, { rita: false });
  pkRitaKravlista();
  pkRitaTopp();
}

// Förslag ur senaste körningen: kategorierna där parametern har värde i någon
// modell. Döljer kategorier där den glömts, och det sägs innan.
function pkForeslaOmfang() {
  const res = _pk.korning?.resultat;
  if (!res) return vkToast('Kör kontrollen en gång först, så att förslaget kan bygga på modellernas värden.', 'red');
  const medVarde = new Map();
  for (const m of res.modeller) for (const k of m.kategorier) for (const p of k.parametrar) {
    if (p.medVarde > 0) { if (!medVarde.has(p.namn)) medVarde.set(p.namn, new Set()); medVarde.get(p.namn).add(k.namn); }
  }
  const valda = pkAllaValdaKategorier();
  const andringar = _pk.setup.kravprofil.krav.map((k, i) => {
    const kat = valda.filter(v => medVarde.get(k.namn)?.has(v));
    return kat.length && kat.length < valda.length ? { i, namn: k.namn, kat } : null;
  }).filter(Boolean);
  if (!andringar.length) return vkToast('Inget förslag: varje krav har värden i alla valda kategorier, eller inga alls.');
  pkDialog({
    titel: 'Begränsa kraven till kategorier där de har värden?',
    text: 'Förslaget bygger på senaste körningen. Det döljer kategorier där en parameter glömts, så gå igenom listan innan du godkänner.',
    lista: andringar.map(a => `${a.namn}: ${a.kat.join(', ')}`),
    knappar: [{ text: 'Avbryt' }, { text: `Begränsa ${andringar.length} krav`, primar: true, gor: () => pkAndra(`Begränsade ${andringar.length} krav till sina kategorier`, s => {
      for (const a of andringar) s.kravprofil.krav[a.i].kategorier = a.kat;
    }) }],
  });
}

// ── Inställningar och kravprofiler ────────────────────────────────────────────

function pkSattTroskel(v) {
  const n = Math.min(100, Math.max(0, Number(String(v).replace(',', '.')) || 0));
  pkAndra('Ändrade gränsen för godkänt', s => { s.kravprofil.troskel = n; });
}

function pkSattTomma(text) {
  const lista = [...new Set(text.split(/[\n,;]/).map(t => t.trim()).filter(Boolean))];
  pkAndra('Ändrade listan över värden som räknas som tomma', s => { s.kravprofil.tomma = lista; }, { rita: false });
  pkRitaTopp();
}

function pkSattProfilnamn(namn) {
  pkAndra('Bytte namn på kravprofilen', s => { s.kravprofil.namn = namn.trim() || 'Kravprofil'; }, { rita: false });
}

async function pkSparaKravprofil() {
  try {
    const l = await pkLasLagring();
    let mapp = null;
    if (!l.itemId) {
      mapp = await pkValjMapp(`Var ska ${PK_FIL} sparas?`, 'Kravprofilen sparas i samma fil som projektets parameterkontroller.');
      if (!mapp) return;
    }
    const post = { ...JSON.parse(JSON.stringify(_pk.setup.kravprofil)), ...pkSparadAv() };
    await pkSkrivFil(d => ({ ...d, kravprofiler: [...d.kravprofiler.filter(k => k.id !== post.id), post] }), mapp);
    vkToast(`Kravprofilen "${post.namn}" är sparad i projektet.`);
  } catch (err) {
    vkToast(`Kunde inte spara kravprofilen: ${vkFelText(err)}`, 'red');
  }
}

async function pkHamtaKravprofil() {
  pkDialog({ titel: 'Kravprofiler i projektet', html: `<div id="pk-profiler">${pkLaddarHtml('Söker i projektet…')}</div>`, knappar: [{ text: 'Stäng' }], bredd: 'w-[560px]' });
  try {
    const l = await pkLasLagring();
    const el = document.getElementById('pk-profiler');
    if (!el) return;
    el.innerHTML = l.data.kravprofiler.length ? `<ul class="border border-ads-border rounded divide-y divide-ads-border">${l.data.kravprofiler.map(k => `
      <li class="px-3 py-2.5 flex items-center gap-3">
        <div class="min-w-0 flex-1"><p class="text-sm font-medium text-ads-text truncate">${pkEsc(k.namn)}</p>
          <p class="text-xs text-ads-muted">${k.krav.length} krav · ${(k.regler || []).length} regler · sparad ${pkEsc(new Date(k.sparad).toLocaleString('sv-SE'))}${k.sparadAv ? ` av ${pkEsc(k.sparadAv)}` : ''}</p></div>
        <button onclick="pkAnvandKravprofil('${pkNod(k.id)}')" class="text-sm text-ads-blue hover:underline shrink-0">Använd</button>
      </li>`).join('')}</ul>` : `<p class="text-sm text-ads-muted">Inga sparade kravprofiler i projektet än.</p>`;
  } catch (err) {
    const el = document.getElementById('pk-profiler');
    if (el) el.innerHTML = `<p class="text-sm text-red-600">${pkEsc(vkFelText(err))}</p>`;
  }
}

function pkAnvandKravprofil(nod) {
  const k = pkLagring().data.kravprofiler.find(x => x.id === pkNodId(Number(nod)));
  if (!k) return;
  document.getElementById('pk-dialog')?.remove();
  pkAndra(`Använder kravprofilen ${k.namn}`, s => { s.kravprofil = pkNormaliseraKravprofil(k); });
}

function pkNormaliseraKravprofil(k) {
  const ny = pkNyUppsattning().kravprofil;
  const p  = { ...ny, ...JSON.parse(JSON.stringify(k)) };
  delete p.sparadAv; delete p.sparadAvEpost; delete p.sparad;
  p.krav   = (p.krav || []).filter(x => x?.namn).map(x => ({ kategorier: null, ...x, namn: pkNyckel(x.namn) }));
  p.regler = (p.regler || []).filter(x => x?.monster);
  p.tomma  = Array.isArray(p.tomma) ? p.tomma : [];
  return p;
}

function pkExporteraKravprofil() {
  const p = _pk.setup.kravprofil;
  const blob = new Blob([JSON.stringify({ typ: 'forma-console-kravprofil', version: 1, kravprofil: p }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Kravprofil_${p.namn.replace(/[\\/:*?"<>|]+/g, '_')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function pkImporteraKravprofil(fil) {
  try {
    const data = JSON.parse(await fil.text());
    if (data?.typ !== 'forma-console-kravprofil' || !data.kravprofil) throw new Error('filen är inte en exporterad kravprofil');
    const p = pkNormaliseraKravprofil(data.kravprofil);
    p.id = pkNyttId();
    pkAndra(`Importerade kravprofilen ${p.namn}`, s => { s.kravprofil = p; });
    vkToast(`Kravprofilen "${p.namn}" är inläst med ${p.krav.length} krav. Kategorier som inte finns i modellerna gäller inte.`);
  } catch (err) {
    vkToast(`Kunde inte läsa filen: ${err.message}`, 'red');
  }
}

// ── Rita ──────────────────────────────────────────────────────────────────────

function pkParametrarHtml() {
  const p = _pk.setup.kravprofil;
  const falt = 'px-2 py-1 text-sm border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue bg-white';
  return `
    <div class="bg-white border border-ads-border rounded-lg px-4 py-3 mb-4 flex items-center gap-x-5 gap-y-2 flex-wrap">
      <label class="flex items-center gap-2 text-sm text-ads-muted">Kravprofil
        <input value="${pkEsc(p.namn)}" onchange="pkSattProfilnamn(this.value)" class="${falt} w-56 text-ads-text font-medium"/></label>
      <label class="flex items-center gap-2 text-sm text-ads-muted" title="Andel av elementen som måste ha värde för att ett krav ska räknas som uppfyllt">Godkänt vid
        <input value="${pkEsc(String(p.troskel).replace('.', ','))}" onchange="pkSattTroskel(this.value)" class="${falt} w-16 text-right"/> %</label>
      <label class="flex items-center gap-2 text-sm text-ads-muted flex-1 min-w-[16rem]" title="Värden som ska räknas som tomma, t.ex. platshållare. Kommatecken mellan.">Räknas som tomt
        <input value="${pkEsc(p.tomma.join(', '))}" placeholder="t.ex. -, ?, TBD" onchange="pkSattTomma(this.value)" class="${falt} flex-1"/></label>
      <span class="flex gap-3 text-sm">
        <button onclick="pkHamtaKravprofil()" class="text-ads-blue hover:underline">Hämta</button>
        <button onclick="pkSparaKravprofil()" class="text-ads-blue hover:underline">Spara i projektet</button>
        <button onclick="pkExporteraKravprofil()" class="text-ads-blue hover:underline">Exportera</button>
        <button onclick="document.getElementById('pk-import').click()" class="text-ads-blue hover:underline">Importera</button>
        <input id="pk-import" type="file" accept=".json" class="hidden" onchange="if(this.files[0]) pkImporteraKravprofil(this.files[0]); this.value=''"/>
      </span>
    </div>
    <div id="pk-param-nyfil"></div>
    <div class="grid grid-cols-1 2xl:grid-cols-5 gap-5 items-start">
      <div class="2xl:col-span-2 bg-white border border-ads-border rounded-lg overflow-hidden" id="pk-param-kalla"></div>
      <div class="2xl:col-span-3" id="pk-kravlista"></div>
    </div>`;
}

function pkRitaParametrarDelar() {
  if (_pk.steg !== 'parametrar') return;
  pkRitaKravlista();
  const el = document.getElementById('pk-param-nyfil');
  const ny = pkParamUi().nyFil;
  if (el) el.innerHTML = !ny ? '' : `
    <div class="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3 text-sm flex-wrap">
      <span class="text-ads-text">Parameterfilen ${pkEsc(_pk.setup.kravprofil.parameterfil?.namn || '')} har en ny version (${ny.version}):
        ${ny.tillagda.length} nya, ${ny.borttagna.length} borttagna parametrar.</span>
      <span class="ml-auto">${pkKnapp('Uppdatera kravprofilen', 'pkUppdateraFranParameterfil()', { primar: true })}</span>
    </div>`;
}

// pkRitaKropp ritar stegets skal och anropar sedan den här.
function pkEfterParametrar() {
  pkRitaParamKalla();
  pkRitaParametrarDelar();
}

function pkValjParamKalla(k) {
  pkParamUi().kalla = k;
  pkRitaParamKalla();
}

function pkRitaParamKalla() {
  const el = document.getElementById('pk-param-kalla');
  if (!el) return;
  const ui = pkParamUi();
  const flik = (k, text) => `<button onclick="pkValjParamKalla('${k}')" class="px-4 py-2.5 text-sm border-b-2 transition-colors ${ui.kalla === k ? 'border-ads-blue text-ads-blue font-medium' : 'border-transparent text-ads-muted hover:text-ads-text'}">${text}</button>`;
  el.innerHTML = `
    <div class="flex border-b border-ads-border">${flik('fil', 'Parameterfil')}${flik('regel', 'Filter i modellerna')}${flik('lista', 'Klistra in')}</div>
    <div class="p-4" id="pk-param-kalla-kropp">${ui.kalla === 'fil' ? pkFilKallaHtml() : ui.kalla === 'regel' ? pkRegelKallaHtml() : pkListaKallaHtml()}</div>`;
}

function pkRitaParamKallaRakna() {
  const el = document.getElementById('pk-fil-rakna');
  if (el) el.textContent = `Lägg till ${pkParamUi().filMarkerade.size} markerade`;
}

function pkFilKallaHtml() {
  const ui = pkParamUi();
  if (!ui.fil) {
    const pf = _pk.setup.kravprofil.parameterfil;
    return `
      <div class="border-2 border-dashed border-ads-border rounded-lg px-4 py-8 text-center"
           ondragover="event.preventDefault()" ondrop="event.preventDefault(); if(event.dataTransfer.files[0]) pkParameterfilUpp(event.dataTransfer.files[0])">
        <p class="text-sm text-ads-text">Dra hit en shared parameter-fil från Revit (.txt)</p>
        <p class="text-xs text-ads-muted mt-1">Du väljer sedan vilka av filens parametrar som ska vara krav.</p>
        <div class="flex gap-2 justify-center mt-3">
          ${pkKnapp('Ladda upp', "document.getElementById('pk-paramfil').click()", { primar: true })}
          ${pkKnapp('Välj i ACC', 'pkParameterfilAcc()')}
        </div>
        <input id="pk-paramfil" type="file" accept=".txt" class="hidden" onchange="if(this.files[0]) pkParameterfilUpp(this.files[0]); this.value=''"/>
        ${pf ? `<p class="text-xs text-ads-muted mt-3">Kraven kommer från ${pkEsc(pf.namn)}${pf.version ? `, version ${pf.version}` : ''}.
          <button onclick="pkKollaParameterfil().then(() => { if (!pkParamUi().nyFil) vkToast('Parameterfilen har ingen nyare version.'); })" class="text-ads-blue hover:underline">Sök ny version</button></p>` : ''}
      </div>`;
  }
  const lista = pkFilFiltrerade();
  const grupper = [...new Set(ui.fil.parametrar.map(p => p.grupp).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
  const redan = new Set(_pk.setup.kravprofil.krav.map(k => k.namn));
  const allaMark = lista.length && lista.every(p => ui.filMarkerade.has(p.namn));
  return `
    <div class="flex items-center gap-2 mb-2">
      <p class="text-sm font-medium text-ads-text truncate flex-1">${pkEsc(ui.fil.namn)} <span class="text-xs text-ads-muted font-normal">· ${ui.fil.parametrar.length} parametrar</span></p>
      <button onclick="pkParamUi().fil = null; pkRitaParamKalla()" class="text-xs text-ads-muted hover:text-ads-text">Stäng</button>
    </div>
    ${ui.fil.varningar.length ? `<div class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 mb-2">${ui.fil.varningar.slice(0, 4).map(v => `<p>${pkEsc(v)}</p>`).join('')}${ui.fil.varningar.length > 4 ? `<p>… och ${ui.fil.varningar.length - 4} till</p>` : ''}</div>` : ''}
    <div class="flex gap-2 mb-2">
      <input type="search" value="${pkEsc(ui.filSok)}" placeholder="Sök parameter…" oninput="pkParamUi().filSok = this.value; pkRitaFilLista()" class="flex-1 px-2 py-1 text-xs border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
      <select onchange="pkParamUi().filGrupp = this.value; pkRitaFilLista()" class="text-xs border border-ads-border rounded px-1.5 bg-white max-w-[10rem]">
        <option value="">Alla grupper</option>${grupper.map(g => `<option value="${pkEsc(g)}" ${ui.filGrupp === g ? 'selected' : ''}>${pkEsc(g)}</option>`).join('')}
      </select>
    </div>
    <div id="pk-fil-lista">${pkFilListaHtml(lista, redan, allaMark)}</div>
    <div class="flex justify-end mt-3"><button id="pk-fil-rakna" onclick="pkFilLaggTill()" class="text-sm bg-ads-blue text-white rounded px-3 py-1.5 hover:bg-ads-blue-dark">Lägg till ${ui.filMarkerade.size} markerade</button></div>`;
}

function pkRitaFilLista() {
  const el = document.getElementById('pk-fil-lista');
  if (!el) return;
  const ui = pkParamUi();
  const lista = pkFilFiltrerade();
  el.innerHTML = pkFilListaHtml(lista, new Set(_pk.setup.kravprofil.krav.map(k => k.namn)), lista.length && lista.every(p => ui.filMarkerade.has(p.namn)));
}

function pkFilListaHtml(lista, redan, allaMark) {
  const ui = pkParamUi();
  return `
    <div class="border border-ads-border rounded overflow-auto" style="max-height:45vh">
      <table class="w-full text-xs">
        <thead class="sticky top-0 bg-ads-gray"><tr class="text-left text-ads-muted">
          <th class="px-2 py-1.5 w-8"><input type="checkbox" ${allaMark ? 'checked' : ''} onchange="pkFilMarkeraAlla(this.checked)" class="accent-ads-blue" aria-label="Markera alla"/></th>
          <th class="px-2 py-1.5 font-semibold">Parameter</th><th class="px-2 py-1.5 font-semibold">Datatyp</th><th class="px-2 py-1.5 font-semibold">Grupp</th></tr></thead>
        <tbody>${lista.map(p => {
          const i = ui.fil.parametrar.indexOf(p);
          return `<tr class="border-t border-ads-border">
            <td class="px-2 py-1"><input type="checkbox" ${ui.filMarkerade.has(p.namn) ? 'checked' : ''} onchange="pkFilMarkera(${i}, this.checked)" class="accent-ads-blue"/></td>
            <td class="px-2 py-1 text-ads-text">${pkEsc(p.namn)}${redan.has(p.namn) ? ' <span class="text-[10px] text-green-700">krav redan</span>' : ''}</td>
            <td class="px-2 py-1 font-mono text-ads-muted">${pkEsc(p.datatyp)}</td>
            <td class="px-2 py-1 text-ads-muted">${pkEsc(p.grupp)}</td></tr>`;
        }).join('') || `<tr><td colspan="4" class="px-2 py-3 text-ads-muted">Inga parametrar matchar.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function pkRegelKallaHtml() {
  const ui = pkParamUi();
  const { per, modeller } = pkKatalogNamn();
  const traffar = pkMonsterTraffar(ui.monster);
  return `
    <p class="text-xs text-ads-muted mb-2">Välj parametrar på namn bland dem som finns i modellerna. * står för vad som helst och ? för ett tecken.
      Regeln sparas, så parametrar som läggs till i modellerna senare kommer med automatiskt.</p>
    <div class="flex gap-2">
      <input value="${pkEsc(ui.monster)}" placeholder="t.ex. RDS* eller *kod" oninput="pkParamUi().monster = this.value; pkRitaRegelTraffar()" onkeydown="if(event.key==='Enter') pkSparaRegel()"
             class="flex-1 px-2 py-1.5 text-sm border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
      ${pkKnapp('Spara som regel', 'pkSparaRegel()', { primar: true })}
    </div>
    <div id="pk-regel-traffar" class="mt-2">${pkRegelTraffarHtml(traffar, per, modeller)}</div>
    <p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 mt-3">Ett filter hittar bara parametrar som finns i minst en
      av de valda modellerna. En parameter som saknas i alla modeller syns aldrig som saknad på det här sättet. Använd en parameterfil eller
      en inklistrad lista för att fånga den.</p>`;
}

function pkRitaRegelTraffar() {
  const el = document.getElementById('pk-regel-traffar');
  if (!el) return;
  const { per, modeller } = pkKatalogNamn();
  el.innerHTML = pkRegelTraffarHtml(pkMonsterTraffar(pkParamUi().monster), per, modeller);
}

function pkRegelTraffarHtml(traffar, per, modeller) {
  const ui = pkParamUi();
  if (!modeller) return `<p class="text-xs text-ads-muted">Modellerna förbereds fortfarande, namnen visas när de är klara.</p>`;
  if (!ui.monster.trim()) return `<p class="text-xs text-ads-muted">${per.size} parameternamn finns i ${modeller} ${modeller === 1 ? 'modell' : 'modeller'}.</p>`;
  if (!traffar.length) return `<p class="text-xs text-ads-muted">Inga parametrar matchar.</p>`;
  return `
    <p class="text-xs text-ads-muted mb-1">${traffar.length} ${traffar.length === 1 ? 'parameter matchar' : 'parametrar matchar'}:</p>
    <ul class="border border-ads-border rounded overflow-auto text-xs divide-y divide-ads-border" style="max-height:35vh">
      ${traffar.slice(0, 300).map(n => `<li class="px-2 py-1 flex justify-between gap-2"><span class="text-ads-text truncate">${pkEsc(n)}</span><span class="text-ads-muted shrink-0">${per.get(n)} av ${modeller} modeller</span></li>`).join('')}
    </ul>`;
}

function pkListaKallaHtml() {
  const ui = pkParamUi();
  return `
    <p class="text-xs text-ads-muted mb-2">Ett namn per rad, till exempel en kolumn kopierad ur Excel. En rad med * eller ? blir en regel.</p>
    <textarea rows="10" oninput="pkParamUi().klistra = this.value" placeholder="RDS-kod&#10;Brandklass&#10;Fabrikat"
              class="w-full px-2 py-1.5 text-sm border border-ads-border rounded font-mono focus:outline-none focus:ring-1 focus:ring-ads-blue">${pkEsc(ui.klistra)}</textarea>
    <div class="flex justify-end mt-2">${pkKnapp('Lägg till', 'pkLaggTillInklistrat()', { primar: true })}</div>`;
}

function pkRitaKravlista() {
  const el = document.getElementById('pk-kravlista');
  if (el) el.innerHTML = pkKravlistaHtml();
}

const PK_KALLA_BRICKA = { fil: 'Fil', lista: 'Lista', regel: 'Regel' };

function pkKravlistaHtml() {
  const p  = _pk.setup.kravprofil;
  const ui = pkParamUi();
  const q  = ui.sok.trim().toLocaleLowerCase('sv');
  const valda = pkAllaValdaKategorier();
  const { per, modeller } = pkKatalogNamn();
  const katalogKlar = modeller > 0;
  if (!p.krav.length && !p.regler.length) {
    return `<div class="bg-white border border-dashed border-ads-border rounded-lg px-6 py-12 text-center">
      <p class="text-sm text-ads-text font-medium">Inga krav än</p>
      <p class="text-xs text-ads-muted mt-1">Lägg till parametrar från en fil, ett filter eller en lista till vänster.</p></div>`;
  }
  const saknasOveralt = [];
  const rader = p.krav.map((k, i) => ({ k, i })).filter(({ k }) => !q || k.namn.toLocaleLowerCase('sv').includes(q)).map(({ k, i }) => {
    const info = pkKravInfo(k);
    if (katalogKlar && !info.finns) saknasOveralt.push(k.namn);
    const notiser = [];
    if (katalogKlar && !info.finns) notiser.push(`<span class="text-red-600">Finns inte i någon modell.</span>`);
    if (info.liknande.length) notiser.push(`<span class="text-amber-700">Liknande namn i modellerna: ${info.liknande.slice(0, 3).map(pkEsc).join(', ')}</span>`);
    if (info.felTyp.length) notiser.push(`<span class="text-amber-700">Annan datatyp i ${info.felTyp.length} ${info.felTyp.length === 1 ? 'modell' : 'modeller'} (${pkEsc(info.felTyp[0].typ)}). Troligen en annan parameter med samma namn.</span>`);
    return pkKravRadHtml('krav', i, k.namn, [k.kalla || 'lista'], k.datatyp, k.kategorier, katalogKlar ? `${info.finns} av ${info.modeller}` : '…', notiser, valda);
  });
  const regler = p.regler.map((r, i) => {
    const traffar = pkMonsterTraffar(r.monster);
    const notiser = [katalogKlar ? (traffar.length
      ? `<span class="text-ads-muted">Fångar ${traffar.length}: ${traffar.slice(0, 5).map(pkEsc).join(', ')}${traffar.length > 5 ? ' …' : ''}</span>`
      : `<span class="text-red-600">Matchar inga parametrar i modellerna.</span>`) : ''];
    return pkKravRadHtml('regel', i, r.monster, ['regel'], '', r.kategorier, '', notiser, valda);
  });

  return `
    <div class="bg-white border border-ads-border rounded-lg">
      <div class="px-4 py-2.5 border-b border-ads-border flex items-center gap-3 flex-wrap">
        <h3 class="text-sm font-semibold text-ads-text">Krav (${p.krav.length}${p.regler.length ? ` + ${p.regler.length} ${p.regler.length === 1 ? 'regel' : 'regler'}` : ''})</h3>
        <input type="search" value="${pkEsc(ui.sok)}" placeholder="Sök krav…" oninput="pkParamUi().sok = this.value; pkRitaKravlista(); const f = document.querySelector('#pk-kravlista input[type=search]'); f.focus(); f.setSelectionRange(f.value.length, f.value.length)"
               class="px-2 py-1 text-xs border border-ads-border rounded focus:outline-none focus:ring-1 focus:ring-ads-blue w-44"/>
        <span class="ml-auto flex gap-3 text-xs">
          <button onclick="pkForeslaOmfang()" class="text-ads-blue hover:underline" title="Begränsa kraven till de kategorier där de har värden i senaste körningen">Föreslå kategorier ur modellerna</button>
          <button onclick="pkRensaKrav()" class="text-ads-muted hover:text-red-600">Ta bort alla</button>
        </span>
      </div>
      ${saknasOveralt.length ? `<p class="px-4 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">${saknasOveralt.length} krav finns inte i någon av modellerna.
        Kontrollera stavningen. Inbyggda Revitparametrar står på engelska i ACC, till exempel Comments och Mark.</p>` : ''}
      <table class="w-full text-sm">
        <thead><tr class="text-[11px] uppercase tracking-wide text-ads-muted text-left">
          <th class="px-4 py-2 font-semibold">Parameter</th><th class="px-2 py-2 font-semibold w-20">Datatyp</th>
          <th class="px-2 py-2 font-semibold w-44">Gäller</th><th class="px-2 py-2 font-semibold w-20" title="I hur många av modellerna parametern finns">Finns i</th><th class="w-8"></th></tr></thead>
        <tbody>${[...regler, ...rader].join('') || `<tr><td colspan="5" class="px-4 py-4 text-sm text-ads-muted">Inga krav matchar sökningen.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function pkKravRadHtml(typ, i, namn, kallor, datatyp, kategorier, finns, notiser, valda) {
  const ui = pkParamUi();
  const oppen = ui.omfang?.typ === typ && ui.omfang.i === i;
  const galler = kategorier ? kategorier.filter(k => valda.includes(k)) : valda;
  const varning = kategorier && !galler.length;
  return `
    <tr class="border-t border-ads-border align-top">
      <td class="px-4 py-2">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="${typ === 'regel' ? 'font-mono' : ''} text-ads-text">${pkEsc(namn)}</span>
          ${kallor.map(k => `<span class="text-[10px] font-semibold rounded px-1.5 py-0.5 ${k === 'regel' ? 'bg-purple-50 text-purple-700' : k === 'fil' ? 'bg-blue-50 text-blue-700' : 'bg-ads-gray text-ads-muted'}">${PK_KALLA_BRICKA[k] || k}</span>`).join('')}
        </div>
        ${notiser.filter(Boolean).map(n => `<p class="text-xs mt-0.5">${n}</p>`).join('')}
      </td>
      <td class="px-2 py-2 text-xs font-mono text-ads-muted">${pkEsc(datatyp || '–')}</td>
      <td class="px-2 py-2 text-xs">
        <button onclick="pkOppnaOmfang('${typ}', ${i})" class="${varning ? 'text-red-600' : 'text-ads-blue'} hover:underline text-left">${pkEsc(varning ? 'Ingen vald kategori' : pkOmfangText(kategorier))}</button>
        ${oppen ? `<div class="mt-1.5 border border-ads-border rounded p-2 bg-white shadow-sm flex flex-col gap-1 max-h-56 overflow-auto">
          <button onclick="pkOmfangAlla('${typ}', ${i})" class="text-left text-ads-blue hover:underline">Alla valda kategorier</button>
          ${valda.map(k => `<label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" ${!kategorier || kategorier.includes(k) ? 'checked' : ''}
            onchange="pkSattOmfang('${typ}', ${i}, decodeURIComponent('${encodeURIComponent(k)}'), this.checked)" class="accent-ads-blue"/>${pkEsc(k)}</label>`).join('') || '<span class="text-ads-muted">Välj kategorier i steg 2 först.</span>'}
        </div>` : ''}
      </td>
      <td class="px-2 py-2 text-xs text-ads-muted">${finns}</td>
      <td class="px-2 py-2 text-right">
        <button onclick="${typ === 'regel' ? 'pkTaBortRegel' : 'pkTaBortKrav'}(${i})" title="Ta bort" class="text-ads-muted hover:text-red-500">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M5 5l10 10M15 5L5 15"/></svg></button>
      </td>
    </tr>`;
}
