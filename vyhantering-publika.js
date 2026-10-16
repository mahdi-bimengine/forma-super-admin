// vyhantering-publika.js — läget "Alla publika vyer" i fliken Vyhantering.
//
// Listar de publika vyerna i alla model set i projektet, med hur många av
// model settets modeller varje vy innehåller och vilka den saknar. En vy kan
// med flit bara visa en del av modellerna (till exempel bara EL), så "saknar"
// är information och inget fel. Väljer man en modell visas vilka vyer som
// saknar just den, vilket är vad man vill veta när en ny modell tillkommit.
// Själva ändringen görs i läget Per model set (vyhantering.js).
//
// "Visa API-svar" visar vyn precis som Model Coordinations API returnerar den.
// Det används för att ta reda på om vyns färginställningar finns i API:et.
//
// State: _vp. Prefix vp.

const _vp = {
  lage:     'set',    // set | publika
  laddar:   false,
  framsteg: '',
  fel:      null,
  rader:    null,     // en per publik vy
  setFel:   [],       // model set som inte gick att läsa
  sok:      '',
  modell:   '',       // itemId: visa bara vyer som saknar den
  setFilter: '',
  api:      null,     // { namn, lista, enskild, fel, laddar }
};

// Ord i fältnamn som kan tyda på färginställningar.
const VP_FARGORD = /colou?r|appearance|override|theme|style|material|tint|rgb|hex|paint|visual|setting|custom/i;

function vpReset() {
  Object.assign(_vp, { laddar: false, framsteg: '', fel: null, rader: null, setFel: [], sok: '', modell: '', setFilter: '', api: null });
}

function vpSattLage(lage) {
  _vp.lage = lage;
  if (lage === 'publika' && !_vp.rader && !_vp.laddar) vpLadda();
  vhRita();
}

// Växlaren överst i fliken. Anropas från vhKropp.
function vpLageHtml() {
  const knapp = (l, text) => `
    <button onclick="vpSattLage('${l}')"
            class="px-3 py-1 text-xs font-medium rounded transition-all ${_vp.lage === l ? 'bg-white text-ads-text shadow-sm' : 'text-ads-muted hover:text-ads-text'}">${text}</button>`;
  return `
    <div class="mb-4 inline-flex items-center bg-ads-gray rounded p-0.5">
      ${knapp('set', 'Per model set')}${knapp('publika', 'Alla publika vyer')}
    </div>`;
}

// ── Läsning ───────────────────────────────────────────────────────────────────

async function vpLadda() {
  const projektId = _currentProject?.id;
  if (!projektId) return;
  Object.assign(_vp, { laddar: true, fel: null, rader: null, setFel: [], framsteg: 'Läser model set…' });
  vhRita();
  try {
    const set = (await listModelSets(projektId)).map(s => ({ id: s.id, namn: s.name || '(namnlöst model set)' }));
    const rader = [];
    let klara = 0;
    for (const s of set) {
      _vp.framsteg = `Läser ${s.namn} (${++klara} av ${set.length})…`;
      vhRita();
      try {
        const versioner = await getModelSetVersions(projektId, s.id);
        const senaste = versioner.length ? vkSenasteSetVersion(versioner) : null;
        const [detalj, vyer] = await Promise.all([
          senaste ? getModelSetVersion(projektId, s.id, senaste.version ?? senaste.id) : Promise.resolve(null),
          listModelSetViews(projektId, s.id),
        ]);
        const modeller = vkGrupperaDokument(detalj?.documentVersions || [])
          .map(d => ({ itemId: d.itemId, namn: d.namn }))
          .sort((a, b) => a.namn.localeCompare(b.namn, 'sv'));
        for (const v of vyer) {
          if (v.isPrivate) continue;
          const ingar = new Set((v.definition || []).map(d => vkUtanViewable(d.lineageUrn)).filter(Boolean));
          rader.push({
            setId: s.id, setNamn: s.namn, viewId: v.viewId,
            namn: v.name || '(namnlös vy)',
            modeller, ingar,
            saknas: modeller.filter(m => !ingar.has(m.itemId)),
            ra: v,
          });
        }
      } catch (err) {
        _vp.setFel.push(`${s.namn}: ${err.message}`);
      }
    }
    if (_currentProject?.id !== projektId) return;
    _vp.rader = rader.sort((a, b) => a.setNamn.localeCompare(b.setNamn, 'sv') || a.namn.localeCompare(b.namn, 'sv'));
  } catch (err) {
    _vp.fel = err.message;
  }
  _vp.laddar = false;
  vhRita();
}

function vpSynliga() {
  const q = _vp.sok.trim().toLowerCase();
  return (_vp.rader || []).filter(r =>
    (!_vp.setFilter || r.setId === _vp.setFilter) &&
    (!_vp.modell || (r.modeller.some(m => m.itemId === _vp.modell) && !r.ingar.has(_vp.modell))) &&
    (!q || r.namn.toLowerCase().includes(q) || r.setNamn.toLowerCase().includes(q)));
}

function vpSok(text) {
  _vp.sok = text;
  const el = document.getElementById('vp-tabell');
  if (el) el.innerHTML = vpTabellHtml();
}

function vpSattFilter(nyckel, varde) {
  _vp[nyckel] = varde;
  vhRita();
}

// Öppnar vyns model set i läget Per model set och markerar vyn.
async function vpOppnaISet(i) {
  const r = vpSynliga()[i];
  if (!r) return;
  _vp.lage = 'set';
  if (!_vh.setLista) await vhLaddaSetLista();
  await vhValjSet(r.setId);
  if (_vp.modell) _vh.valda = new Set([_vp.modell]);
  if (_vh.vyer.some(v => v.viewId === r.viewId)) _vh.markerade = new Set([r.viewId]);
  vhRita();
}

function vpExportera() {
  const aoa = [['Model set', 'Vy', 'Modeller i vyn', 'Modeller i model set', 'Saknade modeller']];
  for (const r of vpSynliga()) aoa.push([r.setNamn, r.namn, r.ingar.size, r.modeller.length, r.saknas.map(m => m.namn).join(', ')]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 28 }, { wch: 40 }, { wch: 10 }, { wch: 10 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Publika vyer');
  bhLaddaNer(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]),
    `publika_vyer_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── API-svaret för en vy ──────────────────────────────────────────────────────

async function vpVisaApi(i) {
  const r = vpSynliga()[i];
  if (!r) return;
  _vp.api = { namn: r.namn, setNamn: r.setNamn, lista: r.ra, enskild: null, fel: null, laddar: true };
  vhRita();
  try {
    _vp.api.enskild = await apsGet(`${MC_BASE}/${mcContainer(_currentProject.id)}/modelsets/${r.setId}/views/${r.viewId}`);
  } catch (err) {
    _vp.api.fel = err.message;
  }
  _vp.api.laddar = false;
  vhRita();
}

function vpStangApi() {
  _vp.api = null;
  vhRita();
}

// Alla fältnamn i ett svar, med sökväg, för att se vad som finns.
function vpFaltnamn(obj, vag = '', ut = new Set()) {
  if (Array.isArray(obj)) { for (const x of obj) vpFaltnamn(x, `${vag}[]`, ut); return ut; }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = vag ? `${vag}.${k}` : k;
      ut.add(p);
      vpFaltnamn(v, p, ut);
    }
  }
  return ut;
}

async function vpKopieraApi() {
  const text = JSON.stringify({ lista: _vp.api?.lista, enskild: _vp.api?.enskild }, null, 2);
  try { await navigator.clipboard.writeText(text); alert('Kopierat.'); } catch { prompt('Kopiera:', text); }
}

function vpApiHtml() {
  const a = _vp.api;
  if (!a) return '';
  const falt = [...vpFaltnamn({ lista: a.lista, enskild: a.enskild })];
  const farg = falt.filter(f => VP_FARGORD.test(f.split('.').pop()));
  return `
    <div class="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onclick="if (event.target === this) vpStangApi()">
      <div class="bg-white rounded shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        <div class="px-5 py-3 border-b border-ads-border flex items-start gap-3">
          <div class="flex-1"><h3 class="font-semibold text-ads-text">API-svar för vyn ${vkEsc(a.namn)}</h3>
            <p class="text-xs text-ads-muted mt-0.5">${vkEsc(a.setNamn)} · listan över vyer och den enskilda vyn, som Model Coordinations API returnerar dem.</p></div>
          <button onclick="vpStangApi()" class="px-1.5 text-ads-muted hover:text-ads-text">✕</button>
        </div>
        <div class="flex-1 overflow-y-auto px-5 py-4 text-xs">
          <div class="mb-3 p-2.5 rounded border ${farg.length ? 'border-amber-300 bg-amber-50' : 'border-ads-border bg-ads-gray/40'}">
            ${a.laddar ? 'Läser den enskilda vyn…' : farg.length
              ? `<b>Fält som kan handla om färg eller utseende:</b> <span class="font-mono">${farg.map(vkEsc).join(', ')}</span>`
              : '<b>Inga fält som handlar om färg eller utseende.</b> Svaret innehåller bara de här fälten:'}
            <div class="mt-1 font-mono text-[11px] text-ads-muted">${falt.map(vkEsc).join(' · ')}</div>
          </div>
          ${a.fel ? `<p class="text-red-700 mb-2">Den enskilda vyn kunde inte läsas: ${vkEsc(a.fel)}</p>` : ''}
          <div class="font-medium mb-1">Ur listan över vyer</div>
          <pre class="bg-ads-gray/50 rounded p-2 overflow-x-auto text-[11px] mb-3">${vkEsc(JSON.stringify(a.lista, null, 2))}</pre>
          ${a.enskild ? `
            <div class="font-medium mb-1">Den enskilda vyn</div>
            <pre class="bg-ads-gray/50 rounded p-2 overflow-x-auto text-[11px]">${vkEsc(JSON.stringify(a.enskild, null, 2))}</pre>` : ''}
        </div>
        <div class="px-5 py-3 border-t border-ads-border flex justify-end gap-2">
          <button onclick="vpKopieraApi()" class="text-xs border border-ads-border rounded px-3 py-1.5 bg-white hover:border-ads-blue">Kopiera JSON</button>
          <button onclick="vpStangApi()" class="bg-be-charcoal hover:bg-black text-white text-xs font-medium py-1.5 px-3 rounded">Stäng</button>
        </div>
      </div>
    </div>`;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function vpKropp() {
  if (_vp.laddar) return vkLaddarKort(_vp.framsteg || 'Läser vyer…');
  if (_vp.fel) {
    return `<div class="bg-white border border-ads-border rounded p-6 text-sm">
      <p class="text-red-600 mb-3">Kunde inte läsa vyerna: ${vkEsc(_vp.fel)}</p>
      <button onclick="vpLadda()" class="text-sm border border-ads-border rounded px-3 py-1.5 hover:border-ads-blue">Försök igen</button></div>`;
  }
  if (!_vp.rader) {
    // Till exempel efter projektbyte med läget kvar på publika vyer.
    setTimeout(vpLadda);
    return vkLaddarKort('Läser vyer…');
  }

  const set = [...new Map(_vp.rader.map(r => [r.setId, r.setNamn]))];
  const modeller = [...new Map(_vp.rader.flatMap(r => r.modeller.map(m => [m.itemId, m.namn])))]
    .sort((a, b) => a[1].localeCompare(b[1], 'sv'));

  return `
    ${_vp.setFel.length ? `<div class="mb-3 p-2.5 rounded border border-amber-200 bg-amber-50 text-xs text-amber-900">
      Några model set kunde inte läsas: ${_vp.setFel.map(vkEsc).join('; ')}</div>` : ''}
    <div class="bg-white border border-ads-border rounded p-3 mb-3 flex items-center gap-2 flex-wrap">
      <input value="${vkEsc(_vp.sok)}" oninput="vpSok(this.value)" placeholder="Sök vy eller model set"
             class="border border-ads-border rounded px-2.5 py-1.5 text-sm w-56 focus:outline-none focus:ring-1 focus:ring-ads-blue" />
      <select onchange="vpSattFilter('setFilter', this.value)" class="border border-ads-border rounded px-2 py-1.5 text-sm bg-white">
        <option value="">Alla model set (${set.length})</option>
        ${set.map(([id, n]) => `<option value="${vkEsc(id)}" ${_vp.setFilter === id ? 'selected' : ''}>${vkEsc(n)}</option>`).join('')}
      </select>
      <select onchange="vpSattFilter('modell', this.value)" class="border rounded px-2 py-1.5 text-sm bg-white max-w-xs ${_vp.modell ? 'border-ads-blue' : 'border-ads-border'}">
        <option value="">Visa vyer som saknar modell…</option>
        ${modeller.map(([id, n]) => `<option value="${vkEsc(id)}" ${_vp.modell === id ? 'selected' : ''}>${vkEsc(n)}</option>`).join('')}
      </select>
      <div class="flex-1"></div>
      ${bhKnapp('vpExportera()', 'Excel')}
      <button onclick="vpLadda()" class="text-sm text-ads-muted hover:text-ads-text px-2">Läs om</button>
    </div>
    <div id="vp-tabell">${vpTabellHtml()}</div>
    ${vpApiHtml()}`;
}

function vpTabellHtml() {
  const rader = vpSynliga();
  if (!(_vp.rader || []).length) {
    return '<div class="bg-white border border-ads-border rounded p-6 text-sm text-ads-muted text-center">Projektet har inga publika vyer.</div>';
  }
  if (!rader.length) {
    return `<div class="bg-white border border-ads-border rounded p-6 text-sm text-ads-muted text-center">
      ${_vp.modell ? 'Alla publika vyer innehåller den modellen.' : 'Inga vyer matchar sökningen.'}</div>`;
  }
  return `
    <div class="bg-white border border-ads-border rounded overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-[11px] text-ads-muted text-left bg-ads-gray/60">
          <tr><th class="px-3 py-2">Vy</th><th class="px-3 py-2">Model set</th><th class="px-3 py-2 text-right">Modeller</th>
              <th class="px-3 py-2">Saknar</th><th class="px-3 py-2"></th></tr>
        </thead>
        <tbody>
          ${rader.map((r, i) => `
            <tr class="border-t border-ads-border/60 align-top hover:bg-ads-gray/30">
              <td class="px-3 py-2 font-medium">${vkEsc(r.namn)}</td>
              <td class="px-3 py-2 text-xs text-ads-muted">${vkEsc(r.setNamn)}</td>
              <td class="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">${r.ingar.size} / ${r.modeller.length}</td>
              <td class="px-3 py-2 text-xs text-ads-muted max-w-md">${r.saknas.length
                ? `${r.saknas.slice(0, 3).map(m => vkEsc(m.namn)).join(', ')}${r.saknas.length > 3 ? ` <span class="text-ads-text">+${r.saknas.length - 3}</span>` : ''}`
                : '<span class="text-emerald-700">Alla</span>'}</td>
              <td class="px-3 py-2 text-xs whitespace-nowrap text-right">
                <button onclick="vpOppnaISet(${i})" class="text-ads-blue hover:underline">Ändra modeller</button>
                <span class="text-ads-border mx-1">|</span>
                <button onclick="vpVisaApi(${i})" class="text-ads-muted hover:text-ads-blue hover:underline">Visa API-svar</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="px-3 py-2 text-xs text-ads-muted border-t border-ads-border/60">${rader.length} publika vyer</div>
    </div>`;
}
