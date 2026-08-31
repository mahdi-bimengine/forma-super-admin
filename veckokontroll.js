// ── Veckokontroll ─────────────────────────────────────────────────────────────
// Veckovis kontroll av projektets modeller: har alla uppdaterats sedan förra
// veckan, har nya modeller tillkommit, ligger Model Coordination i fas med
// senaste versionerna, och finns baspunkten på rätt plats.
//
// Del 1 av 5: flikens skal, projektinställningar och lagring i ACC-projektet.

// ── Konstanter ────────────────────────────────────────────────────────────────

const VK_FILTYPER = ['rvt', 'ifc', 'nwc', 'nwd', 'dwg'];

// Inställningar och veckologg ligger i projektet självt, i den mapp du väljer.
// Filnamnet är däremot fast: fliken letar upp filen med ACC:s sökning genom
// projektets mappar, så vem som helst i projektet hittar den utan att veta var
// någon annan lade den.
const VK_INST_FIL = 'veckokontroll-installningar.json';

// ── State ─────────────────────────────────────────────────────────────────────

const _vk = {
  vy:            'kor',     // 'kor' | 'installningar'
  laddar:        true,      // letar upp och läser inställningarna i projektet
  fel:           null,
  installningar: null,      // sparade inställningar för aktivt projekt
  utkast:        null,      // inställningar som redigeras just nu

  // Var i ACC filerna ligger
  lagring: {
    mapp:     null,         // {id, namn, sokvag} mappen filen ligger i
    itemId:   null,         // inställningsfilen, null om den inte finns än
    dubletter: 0,           // antal extra träffar på filnamnet i projektet
  },

  // Mappväljaren. Innehållet cachas per mapp och delas av båda träden, men
  // varje träd har sina egna utfällda grenar.
  folderState:   {},        // folderId → {items, loaded, loading}
  folderPath:    {},        // folderId → 'Project Files / Modeller'
  oppna:         { bevakade: new Set(), lagring: new Set() },
  itemsById:     {},
  fids:          [],

  // Model Coordination
  modellSet:     null,      // model sets i projektet
  modellSetFel:  null,
};

// ── Små hjälpare ──────────────────────────────────────────────────────────────

function vkEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function vkFid(id) {
  const i = _vk.fids.indexOf(id);
  return i !== -1 ? i : _vk.fids.push(id) - 1;
}

function vkFidLookup(i) { return _vk.fids[i]; }

// Sökvägen som visas i gränssnittet. Utkastets val går före det som gäller nu.
function vkLagringsSokvag() {
  const mapp = _vk.utkast?.lagringMapp || _vk.lagring.mapp;
  return mapp ? `${mapp.sokvag || mapp.namn} / ${VK_INST_FIL}` : VK_INST_FIL;
}

function vkNyaInstallningar() {
  return {
    version:  1,
    projekt:  { id: _currentProject?.id || '', namn: _currentProject?.attributes?.name || '' },
    lagringMapp: null,                  // {id, namn, sokvag} där filen sparas
    mappar:   [],                       // {id, namn, sokvag}[]
    undermappar: true,
    filtyper: ['rvt', 'ifc'],
    modellSet: [],                      // {id, namn}[]
    vyer:     [],                       // {namn, notering}[]
    baspunkt: {
      aktiv:      true,
      familj:     '',
      parametrar: { ost: '', nord: '', hojd: '' },
      forvantat:  { ost: '', nord: '', hojd: '' },
      tolerans:   5,                    // mm
    },
    grans:    { dagar: 7 },
    andrad:   null,                     // {tid, av}
  };
}

// ── Reset (körs vid projektbyte) ──────────────────────────────────────────────

function vkReset() {
  _vk.vy            = 'kor';
  _vk.laddar        = true;
  _vk.fel           = null;
  _vk.installningar = null;
  _vk.utkast        = null;
  _vk.lagring       = { mapp: null, itemId: null, dubletter: 0 };
  _vk.folderState   = {};
  _vk.folderPath    = {};
  _vk.oppna         = { bevakade: new Set(), lagring: new Set() };
  _vk.itemsById     = {};
  _vk.fids          = [];
  _vk.modellSet     = null;
  _vk.modellSetFel  = null;
}

// ── Lagring i projektet ───────────────────────────────────────────────────────

function vkMappNamnAv(f) {
  return f?.attributes?.displayName || f?.attributes?.name || '';
}

// Söker igenom projektets mappar efter inställningsfilen. Filen får ligga var
// som helst, så länge namnet stämmer. Ligger den på flera ställen används den
// senast ändrade och de övriga rapporteras.
async function vkHittaLagring() {
  const hub    = _hubs[_hubIdx];
  const toppar = await getTopFolders(hub.id, _currentProject.id);
  if (!toppar.length) throw new Error('Hittade inga mappar i projektet. Har du behörighet till Docs?');

  _vk.lagring = { mapp: null, itemId: null, dubletter: 0 };

  const traffar = [];
  for (const topp of toppar) {
    try {
      traffar.push(...await searchFolder(_currentProject.id, topp.id, VK_INST_FIL));
    } catch {
      // En toppmapp som inte går att söka i, till exempel Plans utan behörighet,
      // ska inte stoppa resten.
    }
  }
  if (!traffar.length) return;

  traffar.sort((a, b) => String(b.andrad || '').localeCompare(String(a.andrad || '')));
  _vk.lagring.itemId    = traffar[0].itemId;
  _vk.lagring.dubletter = traffar.length - 1;

  // Mappen filen ligger i, för att kunna visa var och för att spara vidare dit.
  try {
    const mapp = await getItemParent(_currentProject.id, traffar[0].itemId);
    _vk.lagring.mapp = { id: mapp.id, namn: vkMappNamnAv(mapp), sokvag: vkMappNamnAv(mapp) };
  } catch {
    _vk.lagring.mapp = null;
  }
}

async function vkLaddaInstallningar() {
  _vk.laddar = true;
  _vk.fel    = null;
  renderVeckokontroll();
  try {
    await vkHittaLagring();
    _vk.installningar = _vk.lagring.itemId
      ? JSON.parse(await readTextFile(_currentProject.id, _vk.lagring.itemId))
      : null;

    // Filen bär själv med sig var den skulle ligga. Står den i en annan mapp än
    // sökningen hittade den i, är det sökningen som gäller.
    const sagd = _vk.installningar?.lagringMapp;
    if (sagd && _vk.lagring.mapp && sagd.id === _vk.lagring.mapp.id && sagd.sokvag) {
      _vk.lagring.mapp.sokvag = sagd.sokvag;
    }
  } catch (err) {
    _vk.fel = err.message;
  }
  _vk.laddar = false;
  renderVeckokontroll();
}

async function vkSparaInstallningar() {
  vkHarvestaUtkast();
  const fel = vkValideraUtkast();
  if (fel) { vkToast(fel, 'red'); return; }

  const utkast = _vk.utkast;
  utkast.andrad = { tid: new Date().toISOString(), av: _profile?.email || '' };

  const knapp = document.getElementById('vk-spara-btn');
  const sattKnapp = (text, av) => {
    if (!knapp) return;
    knapp.disabled = av;
    knapp.textContent = text;
  };
  sattKnapp('Sparar…', true);

  try {
    // Byter man mapp går den gamla filen inte att lägga en ny version på, då
    // måste en ny fil skapas på den nya platsen.
    const sammaMapp = _vk.lagring.mapp && _vk.lagring.mapp.id === utkast.lagringMapp.id;

    _vk.lagring.itemId = await writeTextFile(
      _currentProject.id,
      utkast.lagringMapp.id,
      VK_INST_FIL,
      JSON.stringify(utkast, null, 2),
      sammaMapp ? _vk.lagring.itemId : null
    );
    const flyttad = !sammaMapp && !!_vk.lagring.mapp;
    _vk.lagring.mapp  = { ...utkast.lagringMapp };
    _vk.installningar = utkast;
    if (flyttad) _vk.lagring.dubletter += 1;
    _vk.utkast        = null;
    _vk.vy            = 'kor';
    renderVeckokontroll();
    vkToast(`Sparat i projektet: ${vkLagringsSokvag()}`);
  } catch (err) {
    sattKnapp('Spara inställningar', false);
    vkToast(`Kunde inte spara: ${vkFelText(err)}`, 'red');
  }
}

// APS svarar med hela felkroppen. Plocka fram det som betyder något för den
// som står vid skärmen.
function vkFelText(err) {
  const text = String(err?.message || err);
  if (/\b(401|403)\b/.test(text))
    return 'du saknar behörighet att skapa filer i projektets mappar, eller behöver logga in på nytt';
  if (/\b409\b/.test(text))
    return 'filen håller på att uppdateras av någon annan, försök igen om en stund';
  return text.length > 200 ? text.slice(0, 200) + '…' : text;
}

function vkValideraUtkast() {
  const u = _vk.utkast;
  if (!u.lagringMapp)
    return 'Välj vilken mapp i projektet inställningarna ska sparas i.';
  if (!u.mappar.length && !u.modellSet.length)
    return 'Välj minst en mapp eller ett model set som ska följas.';
  if (!u.filtyper.length)
    return 'Välj minst en filtyp.';
  if (u.baspunkt.aktiv && !u.baspunkt.familj.trim())
    return 'Ange familjenamnet för baspunkten, eller stäng av baspunktskontrollen.';
  return null;
}

// ── Skal ──────────────────────────────────────────────────────────────────────

// Ingången från sidomenyn. Inställningarna läses en gång per projekt, sedan
// ritas fliken om från minnet.
function vkOppnaFlik() {
  if (_vk.laddar && !_vk.installningar && !_vk.fel) vkLaddaInstallningar();
  else renderVeckokontroll();
}

function renderVeckokontroll() {
  const mc = document.getElementById('main-content');

  mc.innerHTML = `
    <div class="max-w-5xl mx-auto px-6 py-8">

      <div class="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 class="text-lg font-semibold text-ads-text">Veckokontroll</h2>
          <p class="text-ads-muted text-sm mt-0.5">
            Veckans genomgång av projektets modeller: uppdaterade, nya, i fas med samordningen och rätt baspunkt.
          </p>
        </div>
        ${_vk.installningar && _vk.vy === 'kor' ? `
          <button onclick="vkOppnaInstallningar()"
                  class="shrink-0 text-sm border border-ads-border bg-white rounded px-3 py-1.5 hover:border-ads-blue
                         text-ads-muted hover:text-ads-text transition-colors flex items-center gap-1.5">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
              <circle cx="10" cy="10" r="2.5"/>
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4"/>
            </svg>
            Inställningar
          </button>` : ''}
      </div>

      <div id="vk-innehall">${vkKropp()}</div>
    </div>`;

  if (_vk.vy === 'installningar') {
    setTimeout(() => {
      if (!_vk.folderState['__top__']?.loaded && !_vk.folderState['__top__']?.loading) vkLaddaToppmappar();
      else vkRitaAllaTrad();
      if (!_vk.modellSet && !_vk.modellSetFel) vkLaddaModellSet();
      else vkRitaModellSet();
    }, 0);
  }
}

function vkKropp() {
  if (_vk.laddar)                  return vkLaddarKort('Läser inställningar för projektet…');
  if (_vk.fel)                     return vkFelKort(_vk.fel);
  if (_vk.vy === 'installningar')  return vkRenderInstallningar();
  if (!_vk.installningar)          return vkRenderKomIgang();
  return vkRenderKorvy();
}

function vkLaddarKort(text) {
  return `
    <div class="bg-white border border-ads-border rounded p-6 flex items-center gap-2.5 text-sm text-ads-muted">
      <svg class="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
        <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
      </svg>${vkEsc(text)}
    </div>`;
}

function vkFelKort(text) {
  return `
    <div class="bg-white border border-ads-border rounded p-6">
      <p class="text-sm text-red-600 mb-3">Kunde inte läsa inställningarna: ${vkEsc(text)}</p>
      <button onclick="vkLaddaInstallningar()"
              class="text-sm border border-ads-border rounded px-3 py-1.5 hover:border-ads-blue text-ads-text">
        Försök igen
      </button>
    </div>`;
}

// ── Kom igång ─────────────────────────────────────────────────────────────────

function vkRenderKomIgang() {
  return `
    <div class="bg-white border border-ads-border rounded p-8 text-center">
      <div class="w-11 h-11 rounded-full bg-ads-gray flex items-center justify-center mx-auto mb-4">
        <svg class="w-5 h-5 text-ads-blue" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
          <rect x="2.5" y="4" width="15" height="13.5" rx="1.5"/>
          <path stroke-linecap="round" d="M2.5 8h15M6.5 2.5v3M13.5 2.5v3"/>
          <path stroke-linecap="round" stroke-linejoin="round" d="M7 12.5l1.8 1.8L13 10"/>
        </svg>
      </div>
      <h3 class="text-sm font-semibold text-ads-text mb-1">Veckokontrollen är inte inställd för det här projektet</h3>
      <p class="text-ads-muted text-sm max-w-md mx-auto mb-5">
        Peka ut vilka mappar och model set som räknas som projektets modeller, vilka vyer du går igenom
        och hur baspunkten ska sitta. Inställningarna sparas i repot och gäller alla som kör kontrollen.
      </p>
      <button onclick="vkOppnaInstallningar()"
              class="bg-ads-blue text-white text-sm font-medium rounded px-4 py-2 hover:bg-ads-blue-dark transition-colors">
        Ställ in veckokontrollen
      </button>
    </div>`;
}

// ── Körvyn ────────────────────────────────────────────────────────────────────

function vkRenderKorvy() {
  const i  = _vk.installningar;
  const bp = i.baspunkt || {};

  const rad = (etikett, varde) => `
    <div class="flex items-baseline gap-3 py-2 border-t border-ads-border first:border-t-0">
      <span class="text-xs text-ads-muted w-40 shrink-0">${etikett}</span>
      <span class="text-sm text-ads-text">${varde}</span>
    </div>`;

  const mappar = i.mappar.length
    ? i.mappar.map(m => vkEsc(m.sokvag || m.namn)).join('<br/>')
    : '<span class="text-ads-muted italic">ingen</span>';

  const set = i.modellSet.length
    ? i.modellSet.map(s => vkEsc(s.namn)).join('<br/>')
    : '<span class="text-ads-muted italic">inget</span>';

  const vyer = i.vyer.length
    ? i.vyer.map(v => vkEsc(v.namn)).join('<br/>')
    : '<span class="text-ads-muted italic">inga</span>';

  const andrad = i.andrad
    ? `${vkDatum(i.andrad.tid)}${i.andrad.av ? ` av ${vkEsc(i.andrad.av)}` : ''}`
    : 'okänt';

  return `
    <div class="bg-white border border-ads-border rounded p-5 mb-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-ads-text">Så är kontrollen inställd</h3>
        <span class="text-[11px] text-ads-muted">Ändrad ${andrad}</span>
      </div>
      ${rad('Mappar', mappar)}
      ${rad('Undermappar', i.undermappar ? 'räknas med' : 'räknas inte med')}
      ${rad('Filtyper', i.filtyper.map(f => f.toUpperCase()).join(', '))}
      ${rad('Model set', set)}
      ${rad('Vyer att bekräfta', vyer)}
      ${rad('Baspunkt', bp.aktiv
          ? `${vkEsc(bp.familj)} &nbsp;<span class="text-ads-muted">tolerans ${vkEsc(bp.tolerans)} mm</span>`
          : '<span class="text-ads-muted italic">avstängd</span>')}
      ${rad('Åldersgräns', `${vkEsc(i.grans?.dagar ?? 7)} dagar`)}
      ${rad('Sparad i projektet', vkEsc(vkLagringsSokvag()) +
          (_vk.lagring.dubletter > 0
            ? ` <span class="text-orange-700">(${_vk.lagring.dubletter} fil${_vk.lagring.dubletter === 1 ? '' : 'er'} med samma namn finns också)</span>`
            : ''))}
    </div>

    <div class="bg-white border border-ads-border rounded p-5">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h3 class="text-sm font-semibold text-ads-text">Kör veckans kontroll</h3>
          <p class="text-xs text-ads-muted mt-0.5">
            Läser senaste versionen av varje modell och jämför med förra veckans avläsning.
          </p>
        </div>
        <button disabled
                class="shrink-0 bg-ads-border text-ads-muted text-sm font-medium rounded px-4 py-2 cursor-not-allowed">
          Kör veckokontroll
        </button>
      </div>
      <p class="text-[11px] text-ads-muted mt-3 border-t border-dashed border-ads-border pt-3">
        Kontrollstegen byggs härnäst. Inställningarna ovan är det som körningen kommer att utgå från.
      </p>
    </div>`;
}

function vkDatum(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return vkEsc(iso);
  return d.toLocaleString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── Inställningar ─────────────────────────────────────────────────────────────

function vkOppnaInstallningar() {
  _vk.utkast = _vk.installningar
    ? JSON.parse(JSON.stringify(_vk.installningar))
    : vkNyaInstallningar();

  // Den plats filen verkligen ligger på väger tyngre än vad filen påstår.
  if (_vk.lagring.mapp) _vk.utkast.lagringMapp = { ..._vk.lagring.mapp };

  _vk.vy = 'installningar';
  renderVeckokontroll();
}

function vkAvbrytInstallningar() {
  _vk.utkast = null;
  _vk.vy     = 'kor';
  renderVeckokontroll();
}

// Läser in fritextfälten från DOM till utkastet, så att de inte tappas när en
// dellista ritas om.
function vkHarvestaUtkast() {
  const u = _vk.utkast;
  if (!u) return;

  const v = id => document.getElementById(id)?.value ?? null;

  const dagar = v('vk-grans-dagar');
  if (dagar !== null) u.grans.dagar = Math.max(1, parseInt(dagar, 10) || 7);

  const familj = v('vk-bp-familj');
  if (familj !== null) u.baspunkt.familj = familj.trim();

  ['ost', 'nord', 'hojd'].forEach(k => {
    const p = v(`vk-bp-param-${k}`);
    if (p !== null) u.baspunkt.parametrar[k] = p.trim();
    const f = v(`vk-bp-forv-${k}`);
    if (f !== null) u.baspunkt.forvantat[k] = f.trim();
  });

  const tol = v('vk-bp-tolerans');
  if (tol !== null) u.baspunkt.tolerans = Math.max(0, parseFloat(tol) || 0);

  const bpAktiv = document.getElementById('vk-bp-aktiv');
  if (bpAktiv) u.baspunkt.aktiv = bpAktiv.checked;

  const under = document.getElementById('vk-undermappar');
  if (under) u.undermappar = under.checked;

  u.vyer.forEach((vy, i) => {
    const namn = v(`vk-vy-namn-${i}`);
    if (namn !== null) vy.namn = namn;
    const not = v(`vk-vy-not-${i}`);
    if (not !== null) vy.notering = not;
  });
}

function vkRenderInstallningar() {
  const u = _vk.utkast;

  return `
    <div class="space-y-5">

      ${vkKort('1. Projektets modeller', `
        Modellerna hämtas både från mapparna i Data Management och från model set i Model Coordination.
        Kontrollen jämför sedan de två listorna mot varandra, så att en fil som ligger i mappen men aldrig
        lagts in i samordningen syns.`, `
        <p class="text-xs font-medium text-ads-text mb-1.5">Mappar som följs</p>
        <div id="vk-valda-mappar" class="mb-3">${vkRenderValdaMappar()}</div>
        <div class="border border-ads-border rounded max-h-72 overflow-auto bg-white">
          <div id="vk-mapptrad-bevakade"></div>
        </div>
        <label class="flex items-center gap-2 mt-3 text-xs text-ads-text cursor-pointer">
          <input type="checkbox" id="vk-undermappar" ${u.undermappar ? 'checked' : ''}
                 class="w-3.5 h-3.5 accent-ads-blue"/>
          Räkna med undermappar till de valda mapparna
        </label>

        <p class="text-xs font-medium text-ads-text mt-4 mb-1.5">Filtyper som räknas som modeller</p>
        <div id="vk-filtyper" class="flex flex-wrap gap-1.5">${vkRenderFiltyper()}</div>

        <p class="text-xs font-medium text-ads-text mt-4 mb-1.5">Model set i Model Coordination</p>
        <div id="vk-modellset" class="border border-ads-border rounded bg-white max-h-48 overflow-auto"></div>
      `)}

      ${vkKort('2. Vyer du bekräftar varje vecka', `
        Autodesk erbjuder inget API för de sparade vyerna i Model Coordination, så listan hålls här.
        När ett model set har fått en ny version flaggas vyerna som "behöver bekräftas igen", och din
        avbockning följer med i veckans logg.`, `
        <div id="vk-vyer">${vkRenderVyer()}</div>
      `)}

      ${vkKort('3. Baspunkt', `
        Varje modell ska innehålla den obligatoriska baspunktsfamiljen, och den ska sitta på projektets
        koordinat. Ange familjenamnet, vilka parametrar som bär koordinaterna och vad de ska vara.`, `
        <label class="flex items-center gap-2 mb-4 text-xs text-ads-text cursor-pointer">
          <input type="checkbox" id="vk-bp-aktiv" ${u.baspunkt.aktiv ? 'checked' : ''}
                 onchange="vkToggleBaspunkt(this.checked)" class="w-3.5 h-3.5 accent-ads-blue"/>
          Kontrollera baspunkten
        </label>
        <div id="vk-bp-falt" class="${u.baspunkt.aktiv ? '' : 'opacity-40 pointer-events-none'}">
          ${vkRenderBaspunktFalt()}
        </div>
      `)}

      ${vkKort('4. Åldersgräns', `
        En modell räknas som gammal när dess senaste version är äldre än så här många dagar. Kontrollen
        visar både detta och om versionen är oförändrad sedan förra körningen.`, `
        <div class="flex items-center gap-2">
          <input type="number" id="vk-grans-dagar" min="1" value="${vkEsc(u.grans?.dagar ?? 7)}"
                 class="w-20 border border-ads-border rounded px-2.5 py-1.5 text-sm
                        focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
          <span class="text-sm text-ads-muted">dagar</span>
        </div>
      `)}

      ${vkKort('5. Var inställningarna sparas', `
        Filen läggs i den mapp du väljer här, i projektet. Filnamnet
        <code class="bg-ads-gray px-1 py-0.5 rounded">${VK_INST_FIL}</code> är däremot fast, för det är på
        namnet fliken hittar filen igen, var i projektet den än ligger. Samma mapp används sedan för
        veckologgen.`, `
        <div id="vk-lagringsval" class="mb-3">${vkRenderLagringsval()}</div>
        <div class="border border-ads-border rounded max-h-72 overflow-auto bg-white">
          <div id="vk-mapptrad-lagring"></div>
        </div>
      `)}

      <div class="flex items-center justify-between gap-4 pb-2">
        <p class="text-[11px] text-ads-muted">
          Sparas som
          <code class="bg-white border border-ads-border rounded px-1 py-0.5">${vkEsc(vkLagringsSokvag())}</code>
        </p>
        <div class="flex items-center gap-2 shrink-0">
        <button onclick="vkAvbrytInstallningar()"
                class="text-sm text-ads-muted px-3 py-2 hover:text-ads-text">Avbryt</button>
        <button id="vk-spara-btn" onclick="vkSparaInstallningar()"
                class="bg-ads-blue text-white text-sm font-medium rounded px-4 py-2 hover:bg-ads-blue-dark transition-colors">
          Spara inställningar
        </button>
        </div>
      </div>
    </div>`;
}

function vkKort(rubrik, hjalp, innehall) {
  return `
    <div class="bg-white border border-ads-border rounded p-5">
      <h3 class="text-sm font-semibold text-ads-text mb-1">${rubrik}</h3>
      <p class="text-xs text-ads-muted mb-4 max-w-2xl">${hjalp}</p>
      ${innehall}
    </div>`;
}

// ── Filtyper ──────────────────────────────────────────────────────────────────

function vkRenderFiltyper() {
  return VK_FILTYPER.map(ft => {
    const pa = _vk.utkast.filtyper.includes(ft);
    return `
      <button onclick="vkToggleFiltyp('${ft}')"
              class="px-3 py-1 rounded-full text-xs font-medium border transition-colors
                     ${pa ? 'bg-ads-blue border-ads-blue text-white'
                          : 'bg-white border-ads-border text-ads-muted hover:border-ads-blue hover:text-ads-blue'}">
        ${ft.toUpperCase()}
      </button>`;
  }).join('');
}

function vkToggleFiltyp(ft) {
  const lista = _vk.utkast.filtyper;
  const i     = lista.indexOf(ft);
  if (i === -1) lista.push(ft); else lista.splice(i, 1);
  document.getElementById('vk-filtyper').innerHTML = vkRenderFiltyper();
  vkRitaMapptrad('bevakade');
}

// ── Mappväljaren ──────────────────────────────────────────────────────────────
// Samma träd används två gånger: 'bevakade' väljer flera mappar med modeller,
// 'lagring' väljer den enda mappen som filerna sparas i. Mappinnehållet delas,
// men träden fälls ut oberoende av varandra.

function vkRenderValdaMappar() {
  const valda = _vk.utkast.mappar;
  if (!valda.length)
    return `<p class="text-xs text-ads-muted italic">Ingen mapp vald ännu, markera i trädet nedan.</p>`;

  return `<div class="flex flex-wrap gap-1.5">${valda.map((m, i) => `
    <span class="inline-flex items-center gap-1.5 bg-blue-50 text-ads-blue text-xs rounded px-2 py-1">
      ${vkEsc(m.sokvag || m.namn)}
      <button onclick="vkTaBortMapp(${i})" class="hover:text-ads-blue-dark" title="Ta bort">×</button>
    </span>`).join('')}</div>`;
}

function vkTaBortMapp(i) {
  _vk.utkast.mappar.splice(i, 1);
  document.getElementById('vk-valda-mappar').innerHTML = vkRenderValdaMappar();
  vkRitaMapptrad('bevakade');
}

async function vkLaddaToppmappar() {
  _vk.folderState['__top__'] = { loading: true, loaded: false, items: [] };
  vkRitaAllaTrad();
  try {
    const hub   = _hubs[_hubIdx];
    const items = await getTopFolders(hub.id, _currentProject.id);
    items.forEach(it => {
      _vk.itemsById[it.id]  = it;
      _vk.folderPath[it.id] = vkMappNamn(it);
    });
    _vk.folderState['__top__'] = { loading: false, loaded: true, items };
  } catch (err) {
    _vk.folderState['__top__'] = { loading: false, loaded: false, items: [], error: err.message };
  }
  vkRitaAllaTrad();
}

function vkMappNamn(item) {
  return item?.attributes?.displayName || item?.attributes?.name || '';
}

function vkRitaAllaTrad() {
  vkRitaMapptrad('bevakade');
  vkRitaMapptrad('lagring');
}

function vkRitaMapptrad(mal) {
  const el = document.getElementById(`vk-mapptrad-${mal}`);
  if (!el) return;
  const st = _vk.folderState['__top__'];

  if (!st || st.loading) {
    el.innerHTML = `<div class="flex items-center gap-2 px-4 py-6 text-ads-muted text-sm">
      <svg class="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
        <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
      </svg>Laddar mappar…</div>`;
    return;
  }
  if (st.error) {
    el.innerHTML = `<p class="text-sm text-red-600 px-4 py-6">Fel: ${vkEsc(st.error)}</p>`;
    return;
  }
  if (!st.items?.length) {
    el.innerHTML = `<p class="text-ads-muted text-sm px-4 py-6">Inga mappar hittades.</p>`;
    return;
  }
  el.innerHTML = vkRitaMappnoder(st.items, 0, mal);
}

function vkMappVald(mal, id) {
  return mal === 'lagring'
    ? _vk.utkast.lagringMapp?.id === id
    : _vk.utkast.mappar.some(m => m.id === id);
}

function vkRitaMappnoder(items, djup, mal) {
  const bas = 12 + djup * 20;

  return items.map(item => {
    if (item.type !== 'folders' || item.attributes?.hidden) return '';

    const st    = _vk.folderState[item.id] || {};
    const oppen = _vk.oppna[mal].has(item.id);
    const namn  = vkMappNamn(item);
    const i     = vkFid(item.id);
    const vald  = vkMappVald(mal, item.id);
    const antal = (st.items || []).filter(it => it.type === 'items' && vkArModellfil(vkMappNamn(it))).length;

    const ruta = mal === 'lagring'
      ? (vald
        ? `<svg class="w-3.5 h-3.5 shrink-0 text-ads-blue" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="3.5" fill="currentColor"/></svg>`
        : `<svg class="w-3.5 h-3.5 shrink-0 text-ads-muted" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/></svg>`)
      : (vald
        ? `<svg class="w-3.5 h-3.5 shrink-0 text-ads-blue" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="currentColor"/><path stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 8l3 3 5-5"/></svg>`
        : `<svg class="w-3.5 h-3.5 shrink-0 text-ads-muted" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>`);

    return `
      <div onclick="vkToggleMapp('${mal}', ${i})"
           class="flex items-center gap-2 py-1.5 pr-4 rounded hover:bg-ads-gray cursor-pointer select-none"
           style="padding-left:${bas}px">
        <svg class="w-3.5 h-3.5 shrink-0 text-ads-muted transition-transform ${oppen ? 'rotate-90' : ''}"
             fill="none" viewBox="0 0 20 20">
          <path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/>
        </svg>
        <span onclick="event.stopPropagation(); vkToggleMappval('${mal}', ${i})"
              class="flex items-center justify-center p-0.5 rounded hover:bg-ads-border">${ruta}</span>
        <svg class="w-4 h-4 shrink-0 text-amber-400" viewBox="0 0 20 15" fill="currentColor">
          <path d="M0 2.5A1.5 1.5 0 0 1 1.5 1h4.764a1.5 1.5 0 0 1 1.06.44l.94.94A1.5 1.5 0 0 0 9.322 3H18.5A1.5 1.5 0 0 1 20 4.5v8A1.5 1.5 0 0 1 18.5 14H1.5A1.5 1.5 0 0 1 0 12.5v-10z"/>
        </svg>
        <span class="text-sm ${vald ? 'text-ads-blue font-medium' : 'text-ads-text'} truncate flex-1">${vkEsc(namn)}</span>
        ${mal === 'bevakade' && st.loaded && antal ? `<span class="text-[11px] text-ads-muted shrink-0">${antal} modeller</span>` : ''}
        ${st.loading ? `<span class="text-xs text-ads-muted shrink-0">laddar…</span>` : ''}
      </div>
      ${oppen ? vkRitaMappnoder(st.items || [], djup + 1, mal) : ''}`;
  }).join('');
}

function vkArModellfil(namn) {
  const ext = (namn.split('.').pop() || '').toLowerCase();
  return _vk.utkast.filtyper.includes(ext);
}

async function vkToggleMapp(mal, idx) {
  const id = vkFidLookup(idx);
  const st = _vk.folderState[id] || { items: [], loaded: false, loading: false };

  if (_vk.oppna[mal].has(id)) {
    _vk.oppna[mal].delete(id);
    vkRitaMapptrad(mal);
    return;
  }

  _vk.oppna[mal].add(id);

  if (!st.loaded) {
    _vk.folderState[id] = { ...st, loading: true };
    vkRitaMapptrad(mal);
    try {
      const innehall = await getFolderContents(_currentProject.id, id);
      innehall.forEach(it => {
        _vk.itemsById[it.id] = it;
        if (it.type === 'folders') {
          const foralder = _vk.folderPath[id] || '';
          _vk.folderPath[it.id] = foralder ? `${foralder} / ${vkMappNamn(it)}` : vkMappNamn(it);
        }
      });
      _vk.folderState[id] = { items: innehall, loaded: true, loading: false };
    } catch (err) {
      _vk.folderState[id] = { ...st, loaded: false, loading: false };
      _vk.oppna[mal].delete(id);
      vkToast(`Kunde inte läsa mappen: ${err.message}`, 'red');
    }
  }
  vkRitaMapptrad(mal);
}

function vkToggleMappval(mal, idx) {
  const id   = vkFidLookup(idx);
  const item = _vk.itemsById[id];
  if (!item) return;

  const mapp = { id, namn: vkMappNamn(item), sokvag: _vk.folderPath[id] || vkMappNamn(item) };

  if (mal === 'lagring') {
    // Bara en mapp åt gången, och att klicka på den valda tar bort valet.
    _vk.utkast.lagringMapp = _vk.utkast.lagringMapp?.id === id ? null : mapp;
    vkRitaMapptrad('lagring');
    vkRitaLagringsval();
    return;
  }

  const lista = _vk.utkast.mappar;
  const i     = lista.findIndex(m => m.id === id);
  if (i !== -1) lista.splice(i, 1);
  else lista.push(mapp);

  document.getElementById('vk-valda-mappar').innerHTML = vkRenderValdaMappar();
  vkRitaMapptrad('bevakade');
}

// ── Var filerna sparas ────────────────────────────────────────────────────────

function vkRenderLagringsval() {
  const vald    = _vk.utkast.lagringMapp;
  const nuvarande = _vk.lagring.mapp;
  const flyttas = vald && nuvarande && vald.id !== nuvarande.id;

  return `
    <div class="flex items-center gap-2 flex-wrap mb-1">
      ${vald
        ? `<span class="inline-flex items-center gap-1.5 bg-blue-50 text-ads-blue text-xs rounded px-2 py-1">
             ${vkEsc(vald.sokvag || vald.namn)} / ${VK_INST_FIL}
           </span>`
        : `<span class="text-xs text-ads-muted italic">Ingen mapp vald, markera en i trädet nedan.</span>`}
      ${vald ? `<button onclick="vkSkapaUndermapp()"
                  class="text-xs text-ads-blue hover:underline">+ Skapa undermapp här</button>` : ''}
    </div>
    ${flyttas ? `
      <p class="text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1.5 mb-1">
        Filen ligger i dag i ${vkEsc(nuvarande.sokvag || nuvarande.namn)}. När du sparar skapas en ny fil i
        den nya mappen, och den gamla lämnas kvar. Ta bort den i ACC så att sökningen inte hittar två.
      </p>` : ''}
    ${_vk.lagring.dubletter > 0 ? `
      <p class="text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1.5">
        ${_vk.lagring.dubletter === 1 ? 'Det finns en till fil' : `Det finns ${_vk.lagring.dubletter} till filer`}
        med samma namn i projektet. Den senast ändrade används.
      </p>` : ''}`;
}

function vkRitaLagringsval() {
  const el = document.getElementById('vk-lagringsval');
  if (el) el.innerHTML = vkRenderLagringsval();
}

// Skapar en undermapp i den valda mappen och väljer den direkt, så att en egen
// mapp för veckokontrollen inte behöver ordnas i ACC först.
async function vkSkapaUndermapp() {
  const foralder = _vk.utkast.lagringMapp;
  if (!foralder) return;

  const namn = (window.prompt('Namn på den nya mappen:', 'Veckokontroll') || '').trim();
  if (!namn) return;

  vkToast(`Skapar mappen ${namn}…`);
  try {
    const id = await createFolder(_currentProject.id, foralder.id, namn);
    _vk.folderPath[id]     = `${foralder.sokvag || foralder.namn} / ${namn}`;
    _vk.itemsById[id]      = { id, type: 'folders', attributes: { displayName: namn } };
    _vk.utkast.lagringMapp = { id, namn, sokvag: _vk.folderPath[id] };

    // Töm mappens cache så att den nya undermappen syns när trädet fälls ut.
    delete _vk.folderState[foralder.id];
    _vk.oppna.lagring.delete(foralder.id);

    vkRitaLagringsval();
    vkRitaAllaTrad();
    vkToast(`Mappen ${namn} är skapad och vald.`);
  } catch (err) {
    vkToast(`Kunde inte skapa mappen: ${vkFelText(err)}`, 'red');
  }
}

// ── Model set ─────────────────────────────────────────────────────────────────

async function vkLaddaModellSet() {
  const el = document.getElementById('vk-modellset');
  if (el) el.innerHTML = `<div class="flex items-center gap-2 px-4 py-4 text-sm text-ads-muted">
    <svg class="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
      <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
    </svg>Laddar model set…</div>`;
  try {
    _vk.modellSet = await listModelSets(_currentProject.id);
  } catch (err) {
    _vk.modellSetFel = err.message;
  }
  vkRitaModellSet();
}

function vkRitaModellSet() {
  const el = document.getElementById('vk-modellset');
  if (!el) return;

  if (_vk.modellSetFel) {
    el.innerHTML = `<p class="text-sm text-red-600 px-4 py-4">Kunde inte läsa model set: ${vkEsc(_vk.modellSetFel)}</p>`;
    return;
  }
  if (!_vk.modellSet?.length) {
    el.innerHTML = `<p class="text-sm text-ads-muted px-4 py-4">Inga model set hittades i projektet.</p>`;
    return;
  }

  el.innerHTML = _vk.modellSet.map(ms => {
    const namn = ms.name || ms.id;
    const vald = _vk.utkast.modellSet.some(s => s.id === ms.id);
    const i    = vkFid('ms:' + ms.id);
    return `
      <div onclick="vkToggleModellSet(${i})"
           class="flex items-center gap-2 px-3 py-2 cursor-pointer select-none ${vald ? 'bg-blue-50' : 'hover:bg-ads-gray'}">
        <input type="checkbox" ${vald ? 'checked' : ''} class="w-3.5 h-3.5 shrink-0 accent-ads-blue pointer-events-none"/>
        <svg class="w-4 h-4 shrink-0 ${vald ? 'text-ads-blue' : 'text-ads-muted'}" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10 2l7 3.5v9L10 18l-7-3.5v-9L10 2z"/>
          <path stroke-linecap="round" stroke-linejoin="round" d="M10 2v16M3 5.5l7 3.5 7-3.5"/>
        </svg>
        <span class="text-sm ${vald ? 'text-ads-blue font-medium' : 'text-ads-text'} truncate">${vkEsc(namn)}</span>
      </div>`;
  }).join('');
}

function vkToggleModellSet(idx) {
  const id = String(vkFidLookup(idx)).replace(/^ms:/, '');
  const ms = _vk.modellSet?.find(s => s.id === id);
  if (!ms) return;

  const lista = _vk.utkast.modellSet;
  const i     = lista.findIndex(s => s.id === id);
  if (i !== -1) lista.splice(i, 1);
  else lista.push({ id, namn: ms.name || id });

  vkRitaModellSet();
}

// ── Vyer ──────────────────────────────────────────────────────────────────────

function vkRenderVyer() {
  const vyer = _vk.utkast.vyer;

  const rader = vyer.map((v, i) => `
    <div class="flex items-center gap-2 mb-2">
      <input id="vk-vy-namn-${i}" value="${vkEsc(v.namn)}" placeholder="Vyns namn i Model Coordination"
             class="flex-1 border border-ads-border rounded px-2.5 py-1.5 text-sm
                    focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
      <input id="vk-vy-not-${i}" value="${vkEsc(v.notering || '')}" placeholder="Vad du tittar efter (valfritt)"
             class="flex-1 border border-ads-border rounded px-2.5 py-1.5 text-sm text-ads-muted
                    focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
      <button onclick="vkTaBortVy(${i})" title="Ta bort"
              class="shrink-0 w-8 h-8 rounded border border-ads-border text-ads-muted hover:text-red-600 hover:border-red-300">×</button>
    </div>`).join('');

  return `
    ${vyer.length ? rader : `<p class="text-xs text-ads-muted italic mb-2">Ingen vy tillagd ännu.</p>`}
    <button onclick="vkLaggTillVy()"
            class="text-sm text-ads-blue hover:underline">+ Lägg till vy</button>`;
}

function vkLaggTillVy() {
  vkHarvestaUtkast();
  _vk.utkast.vyer.push({ namn: '', notering: '' });
  document.getElementById('vk-vyer').innerHTML = vkRenderVyer();
}

function vkTaBortVy(i) {
  vkHarvestaUtkast();
  _vk.utkast.vyer.splice(i, 1);
  document.getElementById('vk-vyer').innerHTML = vkRenderVyer();
}

// ── Baspunktsfält ─────────────────────────────────────────────────────────────

function vkRenderBaspunktFalt() {
  const bp = _vk.utkast.baspunkt;

  const koordrad = (nyckel, etikett) => `
    <div>
      <label class="block text-[11px] text-ads-muted mb-1">${etikett}</label>
      <input id="vk-bp-param-${nyckel}" value="${vkEsc(bp.parametrar[nyckel] || '')}"
             placeholder="parameterns namn"
             class="w-full border border-ads-border rounded px-2.5 py-1.5 text-sm mb-1.5
                    focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
      <input id="vk-bp-forv-${nyckel}" value="${vkEsc(bp.forvantat[nyckel] ?? '')}"
             placeholder="förväntat värde"
             class="w-full border border-ads-border rounded px-2.5 py-1.5 text-sm
                    focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
    </div>`;

  return `
    <div class="mb-4">
      <label class="block text-[11px] text-ads-muted mb-1">Familjenamn, eller en del av det</label>
      <input id="vk-bp-familj" value="${vkEsc(bp.familj)}" placeholder="t.ex. BASPUNKT"
             class="w-full max-w-sm border border-ads-border rounded px-2.5 py-1.5 text-sm
                    focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
      <p class="text-[11px] text-ads-muted mt-1">Matchas fritt mot familj- och typnamn, stora och små bokstäver spelar ingen roll.</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
      ${koordrad('ost',  'Öst / X')}
      ${koordrad('nord', 'Nord / Y')}
      ${koordrad('hojd', 'Höjd / Z')}
    </div>

    <div>
      <label class="block text-[11px] text-ads-muted mb-1">Tolerans</label>
      <div class="flex items-center gap-2">
        <input type="number" id="vk-bp-tolerans" min="0" step="1" value="${vkEsc(bp.tolerans)}"
               class="w-24 border border-ads-border rounded px-2.5 py-1.5 text-sm
                      focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
        <span class="text-sm text-ads-muted">mm</span>
      </div>
    </div>`;
}

function vkToggleBaspunkt(pa) {
  vkHarvestaUtkast();
  _vk.utkast.baspunkt.aktiv = pa;
  const falt = document.getElementById('vk-bp-falt');
  if (falt) falt.className = pa ? '' : 'opacity-40 pointer-events-none';
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function vkToast(text, farg = 'green') {
  const cls = farg === 'green' ? 'bg-green-600' : 'bg-red-600';
  const t   = document.createElement('div');
  t.className = `fixed bottom-5 right-5 z-[60] text-white text-sm px-4 py-2.5 rounded shadow-lg ${cls} transition-opacity`;
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}
