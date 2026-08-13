// ── Ritningsgranskning ────────────────────────────────────────────────────────
// Maskinell förgranskning av ritningspaket enligt Riktlinjer BIM för granskning
// av bygghandlingar. Allt körs i webbläsaren, ritningarna lämnar aldrig datorn.
//
// Del 1 av 4: flikens skalstruktur och navigering.

// ── Checklistan ───────────────────────────────────────────────────────────────
// Avsnitten Dokument och Ritning. Modellpunkterna hör hemma i Modellkontroll.
// tackning: 'auto' körs helt maskinellt, 'delvis' ger underlag men kräver ögat,
// 'nej' kan bara granskas visuellt och listas som avbockningsbara punkter.

const GR_PUNKTER = [
  { id: 'D1', avsnitt: 'Dokument', text: 'Dokumentnamn har korrekt uppbyggnad', tackning: 'auto',
    hur: 'Filnamnet prövas mot paketets dominerande namnmönster. Dubbletter och oläsbara filer flaggas också här.' },
  { id: 'D2', avsnitt: 'Dokument', text: 'Antal ritningar stämmer överens med PM', tackning: 'auto',
    hur: 'Antal ritningar jämförs mot handlingsförteckningen på bladen, eller mot en förteckning du laddar upp.' },
  { id: 'D3', avsnitt: 'Dokument', text: 'Fullständiga namn angivna på samtliga handlingar', tackning: 'auto',
    hur: 'Fältet Specifikation eller motsvarande ritningsnamn i huvudet måste ha ett värde.' },

  { id: 'R1', avsnitt: 'Ritning', text: 'Ritningsnummer överensstämmer med filnamn', tackning: 'auto',
    hur: 'Dokumentnumret i ritningshuvudet jämförs tecken för tecken mot filnamnet.' },
  { id: 'R2', avsnitt: 'Ritning', text: 'Tomma rutor i ritningshuvud betecknas med bindestreck', tackning: 'auto',
    hur: 'Ett fält som är ifyllt på nästan alla blad men tomt på ett flaggas. Fält som står tomma på samtliga blad hör till mallen och hittas inte.' },
  { id: 'R3', avsnitt: 'Ritning', text: 'Länkade filer är korrekta, aktuella och redovisas i ritningens marginal', tackning: 'delvis',
    hur: 'De modell- och länkreferenser som redovisas på bladet listas. Att de är aktuella måste du bedöma.' },
  { id: 'R4', avsnitt: 'Ritning', text: 'Ritningsslips är korrekt i skala och placering', tackning: 'delvis',
    hur: 'Slipsens och huvudets placering jämförs mellan bladen. Skalan på slipsen kräver ögat.' },
  { id: 'R5', avsnitt: 'Ritning', text: 'Skalangivelse i ritningshuvud stämmer med skalstock och faktisk skala', tackning: 'delvis',
    hur: 'Skalan i huvudet läses ut och alla skalangivelser på bladet listas. Skalstocken måste mätas manuellt.' },
  { id: 'R6', avsnitt: 'Ritning', text: 'Hänvisning till handlingsförteckning finns i ritningsslipsen', tackning: 'auto',
    hur: 'Bladet måste innehålla en handlingsförteckning eller en hänvisning till den.' },
  { id: 'R7', avsnitt: 'Ritning', text: 'Ritningsstämpel följer BIM-standardens anvisningar', tackning: 'delvis',
    hur: 'Fältuppsättning, placering och gemensamma uppgifter jämförs mot paketets egen mall. Att mallen följer standarden kräver ögat en gång per projekt.' },
  { id: 'R8', avsnitt: 'Ritning', text: 'Ritningsindelning, viewportens placering samordnad för alla teknikslag', tackning: 'nej',
    hur: 'Kräver jämförelse av flera teknikslag på samma delplan.' },
  { id: 'R9', avsnitt: 'Ritning', text: 'Delplaner i 16A0 har stomlinjekorsning 1000/1190 mm från ritningsområdets kant', tackning: 'nej',
    hur: 'Kräver mätning mot stomlinjer i geometrin.' },
  { id: 'R10', avsnitt: 'Ritning', text: 'Norrpil finns med på samtliga planer och pekar mot verklig norr', tackning: 'delvis',
    hur: 'Kompassros som text hittas och riktningen jämförs mellan bladen. Verklig norr kräver kontroll mot situationsplan.' },
  { id: 'R11', avsnitt: 'Ritning', text: 'Skala och skalangivelse är korrekt', tackning: 'delvis',
    hur: 'Se R5.' },
  { id: 'R12', avsnitt: 'Ritning', text: 'Orienteringsfigur finns och skraffering på den är korrekt', tackning: 'delvis',
    hur: 'Att orienteringsfiguren finns syns via mallkontrollen. Skrafferingen måste granskas visuellt.' },
  { id: 'R13', avsnitt: 'Ritning', text: 'Ingen dubbelredovisning av information i ritningshuvudet', tackning: 'auto',
    hur: 'Text som står fler gånger i huvudet än vad mallen normalt har flaggas.' },
  { id: 'R14', avsnitt: 'Ritning', text: 'Brandcellsgränser är korrekt redovisade', tackning: 'nej',
    hur: 'Granskas mot brandskyddsdokumentationen.' },
  { id: 'R15', avsnitt: 'Ritning', text: 'Rumsnumrering finns med', tackning: 'nej',
    hur: 'Rumsnummer går inte att skilja från övrig text med säkerhet.' },
  { id: 'R16', avsnitt: 'Ritning', text: 'Systemlinjer i enkel uppsättning, namn och placering mot referensfilen', tackning: 'nej',
    hur: 'Granskas mot referensfilen.' },
  { id: 'R17', avsnitt: 'Ritning', text: 'Skraffering är samordnad mellan ritningsdelar', tackning: 'nej',
    hur: 'Granskas visuellt.' },
];

const GR_STEG = [
  { n: 1, label: 'Välj ritningar' },
  { n: 2, label: 'Kontrollpunkter' },
  { n: 3, label: 'Resultat' },
];

// ── State ─────────────────────────────────────────────────────────────────────

const _gr = {
  step:         1,
  kalla:        'dm',       // 'dm' = Data Management, 'egen' = uppladdad zip eller PDF
  folderState:  {},         // folderId → {items, expanded, loaded, loading}
  itemsById:    {},         // id → item
  fids:         [],         // numeriskt index → id, för säkra onclick-attribut
  sok:          '',
  valdaFiler:   [],         // {itemId, namn, projectId}[] från Data Management
  egnaFiler:    [],         // {namn, paket, mapp, las()}[] från zip eller lösa PDF
  laserZip:     false,
  senasteHoppade: '',       // filer som hoppades över vid uppladdning
  punkter:      GR_PUNKTER.map(p => ({ ...p, aktiv: true })),
  forteckning:  null,       // {namn, nummer[]} från uppladdad handlingsförteckning
  blad:         [],         // utläst bladdata
  nummerRegex:  null,       // namnmönstret som härleddes ur filnamnen
  resultat:     null,       // {avvikelser, grupper, forteckning, statistik}
  korning:      { pagar: false, klara: 0, totalt: 0, fil: '' },
  fel:          null,       // om granskningen kraschade
  expanderade:  new Set(),
  avbockade:    new Set(),  // manuellt avbockade punkter
};

// ── Hjälpare ──────────────────────────────────────────────────────────────────

function grFid(id) {
  const i = _gr.fids.indexOf(id);
  if (i !== -1) return i;
  return _gr.fids.push(id) - 1;
}

function grFidLookup(i) { return _gr.fids[i]; }

function grEsc(v) {
  return String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function grAntalValda() {
  return _gr.kalla === 'dm' ? _gr.valdaFiler.length : _gr.egnaFiler.length;
}

// ── Reset (anropas vid projektbyte) ───────────────────────────────────────────

function grReset() {
  _gr.step        = 1;
  _gr.kalla       = 'dm';
  _gr.folderState = {};
  _gr.itemsById   = {};
  _gr.fids        = [];
  _gr.sok         = '';
  _gr.valdaFiler  = [];
  _gr.egnaFiler   = [];
  _gr.laserZip    = false;
  _gr.senasteHoppade = '';
  _gr.punkter     = GR_PUNKTER.map(p => ({ ...p, aktiv: true }));
  _gr.forteckning = null;
  _gr.blad        = [];
  _gr.nummerRegex = null;
  _gr.resultat    = null;
  _gr.korning     = { pagar: false, klara: 0, totalt: 0, fil: '' };
  _gr.fel         = null;
  _gr.expanderade = new Set();
  _gr.avbockade   = new Set();
}

// ── Navigering ────────────────────────────────────────────────────────────────

function grNav(step) {
  if (step === 2 && !grAntalValda()) return;
  if (step === 3 && !_gr.resultat)   return;
  _gr.step = step;
  renderRitningsgranskning();
}

async function grStartaGranskning() {
  if (!grAntalValda() || _gr.korning.pagar) return;

  const filer = _gr.kalla === 'dm' ? _gr.valdaFiler : _gr.egnaFiler;
  _gr.step     = 3;
  _gr.resultat = null;
  _gr.fel      = null;

  // Är samma blad redan inlästa räcker det att köra om reglerna, till exempel
  // när kontrollpunkter har kryssats av
  const samma = _gr.blad.length === filer.length
    && _gr.blad.every((b, i) => b.fil === filer[i].namn);

  if (!samma) {
    _gr.blad    = [];
    _gr.korning = { pagar: true, klara: 0, totalt: filer.length, fil: '' };
    renderRitningsgranskning();
  }

  try {
    if (!samma) {
      const { blad, nummerRegex } = await grLasPaket(filer, (klara, totalt, fil) => {
        _gr.korning = { pagar: true, klara, totalt, fil };
        grUppdateraKorning();
      });
      _gr.blad        = blad;
      _gr.nummerRegex = nummerRegex;
    }

    _gr.resultat = grKorKontroller(_gr.blad, _gr.nummerRegex, {
      aktivaPunkter: new Set(_gr.punkter.filter(p => p.aktiv).map(p => p.id)),
      forteckning:   _gr.forteckning?.nummer || null,
    });
  } catch (fel) {
    _gr.fel = String(fel.message || fel);
  }

  _gr.korning.pagar = false;
  renderRitningsgranskning();
}

/** Läser om ritningarna från grunden, även om de redan finns i minnet. */
async function grLasOmAllt() {
  _gr.blad = [];
  await grStartaGranskning();
}

function grUppdateraKorning() {
  const el = document.getElementById('gr-korning');
  if (el) el.innerHTML = grKorningsvy();
}

// ── Huvudrendering ────────────────────────────────────────────────────────────

function renderRitningsgranskning() {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `
    <div class="max-w-5xl mx-auto px-6 py-8">

      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-lg font-semibold text-ads-text">Ritningsgranskning</h2>
          <p class="text-ads-muted text-sm mt-0.5">Förgranska ett ritningspaket mot riktlinjerna för bygghandlingar.</p>
        </div>
        <span class="text-[11px] text-ads-muted border border-ads-border bg-white rounded px-2.5 py-1
                     flex items-center gap-1.5" title="Ritningarna läses lokalt i webbläsaren och skickas inte vidare">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10 2l6 2.5v5c0 3.5-2.4 6.6-6 8.5-3.6-1.9-6-5-6-8.5v-5L10 2z"/>
          </svg>
          Körs lokalt i webbläsaren
        </span>
      </div>

      ${grStegIndikator()}

      <div id="gr-step-content" class="mt-6">
        ${_gr.step === 1 ? grRenderSteg1() : ''}
        ${_gr.step === 2 ? grRenderSteg2() : ''}
        ${_gr.step === 3 ? grRenderSteg3() : ''}
      </div>
    </div>`;

  // Mappträdet hämtas först när DOM finns på plats
  setTimeout(() => {
    if (_gr.step !== 1 || _gr.kalla !== 'dm') return;
    const top = _gr.folderState['__top__'];
    if (!top?.loaded && !top?.loading) grLaddaToppmappar();
    else                               grRenderFileBrowser();
  }, 0);
}

// ── Stegindikator ─────────────────────────────────────────────────────────────

function grStegIndikator() {
  return `
    <div class="flex items-center">
      ${GR_STEG.map((s, i) => {
        const aktiv    = _gr.step === s.n;
        const klar     = _gr.step > s.n;
        const klickbar = klar;
        return `
          ${i > 0 ? `<div class="flex-1 h-px bg-ads-border mx-2"></div>` : ''}
          <button onclick="${klickbar ? `grNav(${s.n})` : ''}"
                  class="flex items-center gap-2 shrink-0 ${!klickbar && !aktiv ? 'opacity-40 cursor-default' : ''}">
            <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                        ${aktiv ? 'bg-ads-blue text-white' : klar ? 'bg-green-500 text-white' : 'bg-ads-gray border border-ads-border text-ads-muted'}">
              ${klar ? '✓' : s.n}
            </div>
            <span class="text-sm ${aktiv ? 'font-semibold text-ads-text' : klar ? 'text-ads-text' : 'text-ads-muted'}">${s.label}</span>
          </button>`;
      }).join('')}
    </div>`;
}

// ── Steg 1: Välj ritningar ────────────────────────────────────────────────────

function grRenderSteg1() {
  const flik = (kalla, etikett, ikon) => {
    const aktiv = _gr.kalla === kalla;
    return `<button onclick="grSetKalla('${kalla}')"
                    class="flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors
                           ${aktiv ? 'border-ads-blue text-ads-blue font-medium' : 'border-transparent text-ads-muted hover:text-ads-text'}">
              ${ikon} ${etikett}
            </button>`;
  };

  return `
    <div class="flex gap-5">
      <div class="flex-1 min-w-0">
        <div class="bg-white border border-ads-border rounded-lg overflow-hidden">

          <div class="flex border-b border-ads-border">
            ${flik('dm', 'Data Management',
              `<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2 7a2 2 0 0 1 2-2h3.17a2 2 0 0 1 1.42.59l.82.82A2 2 0 0 0 10.83 7H16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7z"/></svg>`)}
            ${flik('egen', 'Från datorn',
              `<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M3 13v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/></svg>`)}
          </div>

          ${_gr.kalla === 'dm' ? grRenderDmValjare() : grRenderEgnaValjare()}
        </div>
      </div>

      <div class="w-52 shrink-0 flex flex-col gap-3">
        <div class="bg-white border border-ads-border rounded-lg p-3">
          <h4 id="gr-antal-valda" class="text-xs font-semibold text-ads-muted uppercase tracking-wide mb-2">
            Valda ritningar (${grAntalValda()})
          </h4>
          <div id="gr-valda-filer" class="max-h-64 overflow-auto">${grValdaLista()}</div>
        </div>

        <div class="flex flex-col gap-2" id="gr-steg1-knappar">${grSteg1Knappar()}</div>
      </div>
    </div>`;
}

function grRenderDmValjare() {
  return `
    <div class="flex items-center gap-2 px-3 py-2 border-b border-ads-border">
      <span class="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600 uppercase">pdf</span>
      <span class="text-xs text-ads-muted shrink-0">Endast PDF visas</span>
      <div class="flex-1 relative min-w-24">
        <svg class="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ads-muted pointer-events-none"
             fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="2">
          <circle cx="9" cy="9" r="5"/><path stroke-linecap="round" d="M16 16l-2-2"/>
        </svg>
        <input type="search" value="${grEsc(_gr.sok)}" placeholder="Sök ritning…"
               oninput="grSetSok(this.value)"
               class="w-full pl-6 pr-2 py-0.5 text-xs border border-ads-border rounded
                      focus:outline-none focus:ring-1 focus:ring-ads-blue"/>
      </div>
    </div>
    <div id="gr-file-browser" class="overflow-auto" style="max-height:52vh">${grSpinner('Laddar mappar…')}</div>`;
}

function grRenderEgnaValjare() {
  return `
    <div class="p-5">
      <div ondragover="event.preventDefault(); this.classList.add('border-ads-blue','bg-blue-50')"
           ondragleave="this.classList.remove('border-ads-blue','bg-blue-50')"
           ondrop="grSlappFiler(event, this)"
           onclick="document.getElementById('gr-filinput').click()"
           class="border-2 border-dashed border-ads-border rounded-lg py-10 px-4 flex flex-col items-center gap-2
                  text-center cursor-pointer hover:border-ads-blue transition-colors">
        <svg class="w-9 h-9 text-ads-border" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 16V4m0 0L8 8m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>
        </svg>
        <p class="text-sm text-ads-text font-medium">Släpp ritningspaketet här</p>
        <p class="text-xs text-ads-muted">En zip med ritningar, eller lösa PDF-filer. Inget laddas upp, allt läses lokalt.</p>
      </div>
      <input id="gr-filinput" type="file" accept=".zip,.pdf" multiple class="hidden"
             onchange="grValjEgnaFiler(this.files); this.value = ''" />

      <div id="gr-egna-status" class="mt-4">${grEgnaStatus()}</div>
    </div>`;
}

function grEgnaStatus() {
  if (_gr.laserZip) return grSpinner('Öppnar paketet…');
  if (!_gr.egnaFiler.length) return '';

  const kallor = [...new Set(_gr.egnaFiler.map(f => f.paket || 'Lösa filer'))];
  return `
    <div class="border border-ads-border rounded divide-y divide-ads-border">
      ${kallor.map(k => {
        const filer = _gr.egnaFiler.filter(f => (f.paket || 'Lösa filer') === k);
        return `
          <div class="px-3 py-2 flex items-center gap-2">
            <svg class="w-4 h-4 shrink-0 text-ads-muted" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4z"/>
              <path stroke-linecap="round" d="M9 3v3m2-1.5v3M9 8v3m2-1.5v3"/>
            </svg>
            <span class="text-sm text-ads-text truncate flex-1">${grEsc(k)}</span>
            <span class="text-xs text-ads-muted shrink-0">${filer.length} ritningar</span>
            <button onclick="grTaBortPaket('${grEsc(k).replace(/'/g, "\\'")}')"
                    class="shrink-0 text-ads-muted hover:text-red-500 transition-colors" title="Ta bort">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4 4l12 12M16 4L4 16"/></svg>
            </button>
          </div>`;
      }).join('')}
    </div>
    ${_gr.senasteHoppade ? `<p class="text-xs text-ads-muted mt-2">${grEsc(_gr.senasteHoppade)}</p>` : ''}`;
}

function grSpinner(text) {
  return `
    <div class="flex items-center gap-2 px-4 py-6 text-ads-muted text-sm">
      <svg class="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
        <path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M22 12a10 10 0 0 0-10-10" opacity=".75"/>
      </svg>${grEsc(text)}
    </div>`;
}

// ── Valda-panelen ─────────────────────────────────────────────────────────────

function grValdaLista() {
  const filer = _gr.kalla === 'dm' ? _gr.valdaFiler : _gr.egnaFiler;
  if (!filer.length) {
    return `<p class="text-xs text-ads-muted italic">${_gr.kalla === 'dm' ? 'Välj ritningar till vänster' : 'Släpp ett paket till vänster'}</p>`;
  }
  return filer.map((f, i) => `
    <div class="flex items-center gap-1.5 py-1.5 ${i > 0 ? 'border-t border-ads-border' : ''}">
      <span class="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600 uppercase">pdf</span>
      <span class="text-xs text-ads-text truncate flex-1" title="${grEsc(f.namn)}">${grEsc(f.namn)}</span>
      <button onclick="grTaBortFil(${i})" class="shrink-0 text-ads-muted hover:text-red-500 transition-colors">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4 4l12 12M16 4L4 16"/></svg>
      </button>
    </div>`).join('');
}

function grSteg1Knappar() {
  return grAntalValda() > 0
    ? `<button onclick="grNav(2)"
               class="inline-flex items-center justify-center gap-2 w-full text-sm bg-ads-blue text-white rounded py-1.5 hover:bg-ads-blue-dark transition-colors">
         Nästa <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"/></svg>
       </button>`
    : `<p class="text-xs text-ads-muted text-center">Välj minst en ritning</p>`;
}

function grUppdateraValda() {
  // Ändrat urval betyder att tidigare inlästa blad inte längre gäller
  _gr.blad     = [];
  _gr.resultat = null;

  const antalEl = document.getElementById('gr-antal-valda');
  if (antalEl) antalEl.textContent = `Valda ritningar (${grAntalValda()})`;
  const listEl = document.getElementById('gr-valda-filer');
  if (listEl) listEl.innerHTML = grValdaLista();
  const knappEl = document.getElementById('gr-steg1-knappar');
  if (knappEl) knappEl.innerHTML = grSteg1Knappar();
}

function grTaBortFil(i) {
  if (_gr.kalla === 'dm') _gr.valdaFiler.splice(i, 1);
  else                    _gr.egnaFiler.splice(i, 1);
  grUppdateraValda();
  if (_gr.kalla === 'dm') grRenderFileBrowser();
  else                    grUppdateraEgnaStatus();
}

function grSetKalla(kalla) {
  _gr.kalla = kalla;
  renderRitningsgranskning();
}

function grSetSok(q) {
  _gr.sok = q;
  grRenderFileBrowser();
}

// ── Data Management: mappträd med enbart PDF ──────────────────────────────────

function grArPdf(namn) {
  return (namn.split('.').pop() || '').toLowerCase() === 'pdf';
}

function grMappKanHaPdf(folderId) {
  const st = _gr.folderState[folderId];
  if (!st?.loaded) return true; // oladdad mapp kan inte uteslutas
  for (const item of st.items || []) {
    if (item.type === 'items') {
      if (grArPdf(item.attributes.displayName || item.attributes.name || '')) return true;
    } else if (item.type === 'folders' && grMappKanHaPdf(item.id)) {
      return true;
    }
  }
  return false;
}

function grMappensPdfer(folderId) {
  const st = _gr.folderState[folderId];
  if (!st?.loaded || !st.items) return [];
  const filer = [];
  for (const item of st.items) {
    if (item.type === 'items') {
      if (grArPdf(item.attributes.displayName || item.attributes.name || '')) filer.push(item);
    } else if (item.type === 'folders') {
      filer.push(...grMappensPdfer(item.id));
    }
  }
  return filer;
}

function grMappensVal(folderId) {
  const filer = grMappensPdfer(folderId);
  if (!filer.length) return 'inga';
  const n = filer.filter(f => _gr.valdaFiler.some(v => v.itemId === f.id)).length;
  if (n === 0)            return 'inga';
  if (n === filer.length) return 'alla';
  return 'vissa';
}

async function grLaddaToppmappar() {
  _gr.folderState['__top__'] = { loading: true, loaded: false, items: [] };
  grRenderFileBrowser();
  try {
    const hub   = _hubs[_hubIdx];
    const items = await getTopFolders(hub.id, _currentProject.id);
    items.forEach(item => { _gr.itemsById[item.id] = item; });
    _gr.folderState['__top__'] = { loading: false, loaded: true, items };
  } catch (err) {
    _gr.folderState['__top__'] = { loading: false, loaded: false, items: [], error: err.message };
  }
  grRenderFileBrowser();
}

async function grOppnaMapp(idx) {
  const id = grFidLookup(idx);
  const st = _gr.folderState[id] || { items: [], expanded: false, loaded: false, loading: false };

  if (!st.loaded) {
    _gr.folderState[id] = { ...st, expanded: true, loading: true };
    grRenderFileBrowser();
    try {
      const innehall = await getFolderContents(_currentProject.id, id);
      innehall.forEach(item => { _gr.itemsById[item.id] = item; });
      _gr.folderState[id] = { items: innehall, expanded: true, loaded: true, loading: false };
    } catch {
      _gr.folderState[id] = { ...st, expanded: false, loaded: false, loading: false };
    }
  } else {
    _gr.folderState[id] = { ...st, expanded: !st.expanded };
  }
  grRenderFileBrowser();
}

async function grValjHelMapp(idx) {
  const id = grFidLookup(idx);
  const st = _gr.folderState[id] || {};

  if (!st.loaded && !st.loading) {
    _gr.folderState[id] = { ...st, expanded: true, loading: true };
    grRenderFileBrowser();
    try {
      const innehall = await getFolderContents(_currentProject.id, id);
      innehall.forEach(item => { _gr.itemsById[item.id] = item; });
      _gr.folderState[id] = { items: innehall, expanded: true, loaded: true, loading: false };
    } catch {
      _gr.folderState[id] = { ...st, expanded: false, loaded: false, loading: false };
      grRenderFileBrowser();
      return;
    }
  }

  const filer = grMappensPdfer(id);
  if (grMappensVal(id) === 'alla') {
    const bort = new Set(filer.map(f => f.id));
    _gr.valdaFiler = _gr.valdaFiler.filter(v => !bort.has(v.itemId));
  } else {
    const redan = new Set(_gr.valdaFiler.map(v => v.itemId));
    for (const f of filer) {
      if (redan.has(f.id)) continue;
      _gr.valdaFiler.push({
        itemId:    f.id,
        namn:      f.attributes.displayName || f.attributes.name || '',
        projectId: _currentProject.id,
      });
    }
  }

  grRenderFileBrowser();
  grUppdateraValda();
}

function grValjFil(idx) {
  const id   = grFidLookup(idx);
  const item = _gr.itemsById[id];
  if (!item) return;

  const i = _gr.valdaFiler.findIndex(v => v.itemId === id);
  if (i !== -1) {
    _gr.valdaFiler.splice(i, 1);
  } else {
    _gr.valdaFiler.push({
      itemId:    id,
      namn:      item.attributes.displayName || item.attributes.name || '',
      projectId: _currentProject.id,
    });
  }

  grRenderFileBrowser();
  grUppdateraValda();
}

function grRenderFileBrowser() {
  const el = document.getElementById('gr-file-browser');
  if (!el) return;
  const st = _gr.folderState['__top__'];

  if (!st || st.loading)  { el.innerHTML = grSpinner('Laddar mappar…'); return; }
  if (st.error)           { el.innerHTML = `<p class="text-sm text-red-600 px-4 py-6">Fel: ${grEsc(st.error)}</p>`; return; }
  if (!st.items?.length)  { el.innerHTML = `<p class="text-ads-muted text-sm px-4 py-6">Inga mappar hittades.</p>`; return; }

  const trad = grRenderTradposter(st.items, 0);
  el.innerHTML = trad.trim()
    ? trad
    : `<p class="text-sm text-ads-muted px-4 py-6 italic">Expandera mapparna för att hitta ritningarna.</p>`;
}

function grRenderTradposter(items, djup) {
  const bas = 12 + djup * 20;

  return items.map(item => {
    if (item.attributes?.hidden) return '';

    if (item.type === 'folders') {
      if (!grMappKanHaPdf(item.id)) return '';
      const st      = _gr.folderState[item.id] || {};
      const oppen   = st.expanded || false;
      const laddar  = st.loading  || false;
      const namn    = item.attributes.displayName || item.attributes.name || '';
      const i       = grFid(item.id);
      const val     = grMappensVal(item.id);
      const ruta    = val === 'alla'
        ? `<svg class="w-3.5 h-3.5 shrink-0 text-ads-blue" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="currentColor"/><path stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 8l3 3 5-5"/></svg>`
        : val === 'vissa'
        ? `<svg class="w-3.5 h-3.5 shrink-0 text-ads-blue" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><line x1="4" y1="8" x2="12" y2="8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
        : `<svg class="w-3.5 h-3.5 shrink-0 text-ads-muted" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>`;

      return `
        <div onclick="grOppnaMapp(${i})"
             class="flex items-center gap-2 py-1.5 pr-4 rounded hover:bg-ads-gray cursor-pointer select-none"
             style="padding-left:${bas}px">
          <svg class="w-3.5 h-3.5 shrink-0 text-ads-muted transition-transform ${oppen ? 'rotate-90' : ''}"
               fill="none" viewBox="0 0 20 20">
            <path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 5l6 5-6 5"/>
          </svg>
          <span onclick="event.stopPropagation(); grValjHelMapp(${i})"
                class="flex items-center justify-center p-0.5 rounded hover:bg-ads-border">${ruta}</span>
          <svg class="w-4 h-4 shrink-0 text-amber-400" viewBox="0 0 20 15" fill="currentColor">
            <path d="M0 2.5A1.5 1.5 0 0 1 1.5 1h4.764a1.5 1.5 0 0 1 1.06.44l.94.94A1.5 1.5 0 0 0 9.322 3H18.5A1.5 1.5 0 0 1 20 4.5v8A1.5 1.5 0 0 1 18.5 14H1.5A1.5 1.5 0 0 1 0 12.5v-10z"/>
          </svg>
          <span class="text-sm text-ads-text truncate flex-1">${grEsc(namn)}</span>
          ${laddar ? `<span class="text-xs text-ads-muted">laddar…</span>` : ''}
        </div>
        ${oppen ? grRenderTradposter(st.items || [], djup + 1) : ''}`;
    }

    if (item.type === 'items') {
      const namn = item.attributes.displayName || item.attributes.name || '';
      if (!grArPdf(namn)) return '';
      const q = _gr.sok.trim().toLowerCase();
      if (q && !namn.toLowerCase().includes(q)) return '';

      const vald = _gr.valdaFiler.some(v => v.itemId === item.id);
      const i    = grFid(item.id);

      return `
        <div onclick="grValjFil(${i})"
             class="flex items-center gap-2 py-1.5 pr-4 rounded cursor-pointer select-none
                    ${vald ? 'bg-blue-50' : 'hover:bg-ads-gray'}"
             style="padding-left:${bas + 4}px">
          <input type="checkbox" ${vald ? 'checked' : ''} class="w-3.5 h-3.5 shrink-0 accent-ads-blue pointer-events-none" />
          <svg class="w-4 h-4 shrink-0 ${vald ? 'text-ads-blue' : 'text-ads-muted'}"
               viewBox="0 0 16 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.5 1H3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6.5L9.5 1z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.5 1v5.5H15"/>
          </svg>
          <span class="text-sm ${vald ? 'text-ads-blue font-medium' : 'text-ads-text'} truncate flex-1">${grEsc(namn)}</span>
          <span class="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600 uppercase">pdf</span>
        </div>`;
    }

    return '';
  }).join('');
}

// ── Egna filer: zip eller lösa PDF ────────────────────────────────────────────

function grSlappFiler(event, zon) {
  event.preventDefault();
  zon.classList.remove('border-ads-blue', 'bg-blue-50');
  grValjEgnaFiler(event.dataTransfer.files);
}

async function grValjEgnaFiler(fileList) {
  const filer = [...fileList];
  if (!filer.length) return;

  _gr.laserZip = true;
  _gr.senasteHoppade = '';
  grUppdateraEgnaStatus();

  const hoppade = [];

  for (const fil of filer) {
    const namn = fil.name;

    if (/\.pdf$/i.test(namn)) {
      _gr.egnaFiler.push({
        namn,
        paket:    'Lösa filer',
        storlekKb: Math.round(fil.size / 1024),
        las:      () => fil.arrayBuffer(),
      });
      continue;
    }

    if (/\.zip$/i.test(namn)) {
      try {
        const zip     = await JSZip.loadAsync(fil);
        const poster  = Object.values(zip.files).filter(p => !p.dir && /\.pdf$/i.test(p.name));
        if (!poster.length) { hoppade.push(`${namn} innehöll inga PDF-filer`); continue; }
        for (const post of poster) {
          _gr.egnaFiler.push({
            namn:  post.name.split('/').pop(),
            mapp:  post.name.includes('/') ? post.name.split('/').slice(0, -1).join('/') : '',
            paket: namn,
            las:   () => post.async('arraybuffer'),
          });
        }
      } catch (fel) {
        hoppade.push(`${namn} gick inte att öppna: ${fel.message}`);
      }
      continue;
    }

    hoppade.push(`${namn} är varken zip eller PDF`);
  }

  // Samma ritning två gånger hjälper ingen
  const sedda = new Set();
  _gr.egnaFiler = _gr.egnaFiler.filter(f => {
    const nyckel = `${f.paket}/${f.namn}`;
    if (sedda.has(nyckel)) return false;
    sedda.add(nyckel);
    return true;
  });

  _gr.laserZip = false;
  _gr.senasteHoppade = hoppade.join('. ');
  grUppdateraEgnaStatus();
  grUppdateraValda();
}

function grTaBortPaket(paket) {
  _gr.egnaFiler = _gr.egnaFiler.filter(f => (f.paket || 'Lösa filer') !== paket);
  grUppdateraEgnaStatus();
  grUppdateraValda();
}

function grUppdateraEgnaStatus() {
  const el = document.getElementById('gr-egna-status');
  if (el) el.innerHTML = grEgnaStatus();
}

// ── Steg 2: Kontrollpunkter ───────────────────────────────────────────────────

function grRenderSteg2() {
  const grupper = ['Dokument', 'Ritning'];
  const etikett = { auto: 'automatisk', delvis: 'delvis', nej: 'visuell' };
  const farg    = {
    auto:  'bg-green-50 text-green-700',
    delvis:'bg-amber-50 text-amber-700',
    nej:   'bg-slate-100 text-slate-500',
  };

  return `
    <div class="bg-white border border-ads-border rounded-lg p-6">
      <div class="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 class="text-sm font-semibold text-ads-text mb-1">Kontrollpunkter</h3>
          <p class="text-ads-muted text-sm">
            ${_gr.punkter.filter(p => p.aktiv).length} av ${_gr.punkter.length} punkter är valda.
            Punkter märkta <span class="font-medium">visuell</span> går inte att avgöra maskinellt,
            de blir en avbockningslista i rapporten.
          </p>
        </div>
        <button onclick="grValjAllaPunkter(${!_gr.punkter.every(p => p.aktiv)})"
                class="shrink-0 text-sm text-ads-blue hover:underline">
          ${_gr.punkter.every(p => p.aktiv) ? 'Avmarkera alla' : 'Markera alla'}
        </button>
      </div>

      ${grupper.map(avsnitt => `
        <p class="text-[10px] uppercase tracking-widest text-ads-muted mt-5 mb-2">${avsnitt}</p>
        <div class="border border-ads-border rounded divide-y divide-ads-border">
          ${_gr.punkter.filter(p => p.avsnitt === avsnitt).map(p => `
            <label class="flex items-start gap-3 px-3 py-2.5 hover:bg-ads-gray cursor-pointer">
              <input type="checkbox" ${p.aktiv ? 'checked' : ''} onchange="grTogglePunkt('${p.id}')"
                     class="mt-0.5 w-4 h-4 shrink-0 accent-ads-blue" />
              <span class="min-w-0 flex-1">
                <span class="text-sm text-ads-text">
                  <span class="font-mono text-xs text-ads-muted mr-1.5">${p.id}</span>${grEsc(p.text)}
                </span>
                <span class="block text-xs text-ads-muted mt-0.5">${grEsc(p.hur)}</span>
              </span>
              <span class="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${farg[p.tackning]}">
                ${etikett[p.tackning]}
              </span>
            </label>`).join('')}
        </div>`).join('')}

      <div class="flex items-center justify-between mt-6 pt-5 border-t border-ads-border">
        <button onclick="grNav(1)" class="text-sm text-ads-muted hover:text-ads-text">Tillbaka</button>
        <button onclick="grStartaGranskning()"
                class="bg-ads-blue hover:bg-ads-blue-dark text-white text-sm font-medium rounded px-4 py-2 transition-colors">
          Granska ${grAntalValda()} ritningar
        </button>
      </div>
    </div>`;
}

function grTogglePunkt(id) {
  const p = _gr.punkter.find(x => x.id === id);
  if (p) p.aktiv = !p.aktiv;
  renderRitningsgranskning();
}

function grValjAllaPunkter(aktiv) {
  _gr.punkter.forEach(p => { p.aktiv = aktiv; });
  renderRitningsgranskning();
}

// ── Steg 3: Resultat ──────────────────────────────────────────────────────────

function grRenderSteg3() {
  if (_gr.korning.pagar) {
    return `<div class="bg-white border border-ads-border rounded-lg p-6" id="gr-korning">${grKorningsvy()}</div>`;
  }

  if (_gr.fel) {
    return `
      <div class="bg-white border border-ads-border rounded-lg p-6">
        <div class="flex items-start gap-3">
          <svg class="w-5 h-5 shrink-0 text-red-500 mt-0.5" fill="none" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.5">
            <circle cx="10" cy="10" r="8"/><path stroke-linecap="round" d="M10 6v5M10 14h.01"/>
          </svg>
          <div>
            <p class="text-sm font-medium text-ads-text">Granskningen kunde inte slutföras</p>
            <p class="text-sm text-ads-muted mt-1">${grEsc(_gr.fel)}</p>
            <button onclick="grNav(1)" class="text-sm text-ads-blue hover:underline mt-3">Tillbaka till filvalet</button>
          </div>
        </div>
      </div>`;
  }

  if (!_gr.resultat) {
    return `<div class="bg-white border border-ads-border rounded-lg p-6">${grPlatshallare('Ingen granskning körd än.')}</div>`;
  }

  return grRenderResultat();
}

function grKorningsvy() {
  const { klara, totalt, fil } = _gr.korning;
  const andel = totalt ? Math.round((klara / totalt) * 100) : 0;
  return `
    <h3 class="text-sm font-semibold text-ads-text mb-1">Läser ritningarna</h3>
    <p class="text-ads-muted text-sm mb-4">${klara} av ${totalt} blad klara. Allt läses lokalt i din webbläsare.</p>
    <div class="h-2 bg-ads-gray rounded-full overflow-hidden">
      <div class="h-full bg-ads-blue transition-all duration-200" style="width:${andel}%"></div>
    </div>
    <p class="text-xs text-ads-muted mt-2 truncate">${grEsc(fil || '')}</p>`;
}

// ── Platshållare ──────────────────────────────────────────────────────────────

function grPlatshallare(text) {
  return `
    <div class="border border-dashed border-ads-border rounded-lg py-10 flex flex-col items-center gap-2 text-center">
      <svg class="w-8 h-8 text-ads-border" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 5a2 2 0 0 1 2-2h8l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M14 3v6h6"/>
      </svg>
      <p class="text-ads-muted text-sm">${grEsc(text)}</p>
    </div>`;
}
