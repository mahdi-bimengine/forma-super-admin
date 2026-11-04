// vyhantering-jamfor.js — läget "Jämför vyer" i fliken Vyhantering.
//
// Ställer valda publika vyer bredvid varandra: en rad per modell, en kolumn per
// vy, med de 3D-vyer modellen ligger med i varje vy. Varje modell bedöms:
//
//   alla     med i alla vyer med samma 3D-vy (det som gäller hela huset)
//   perVy    med i alla vyer, men med en egen 3D-vy i var och en (blockspecifikt)
//   en       bara med i en av vyerna
//   saknas   med i flera vyer men inte i alla (flaggas, kan läggas till)
//   blandat  med i alla, men några delar 3D-vy och andra har en egen (flaggas)
//
// En saknad modell kan läggas till i vyerna som saknar den när de övriga vyerna
// har samma 3D-vyer för den. Ändringen visas först och skrivs till ACC efter
// bekräftelse (updateModelSetViewDefinition). Vyernas data kommer från
// vyhantering-publika.js (_vp.rader). State: _vj.

const _vj = {
  valda:   [],        // nycklar setId|viewId i vald ordning
  sok:     '',
  bara:    false,     // visa bara avvikande
  lagg:    new Set(), // itemId för saknade modeller som ska läggas till
  plan:    null,
  kor:     null,
};

const VJ_MAX = 15;

const VJ_STATUS = {
  saknas:  { text: 'Saknas i några vyer',  farg: 'bg-red-100 text-red-800',         ordning: 0 },
  blandat: { text: 'Blandat',              farg: 'bg-amber-100 text-amber-900',     ordning: 1 },
  perVy:   { text: 'En egen 3D-vy per vy', farg: 'bg-sky-100 text-sky-800',         ordning: 2 },
  en:      { text: 'Bara i en vy',         farg: 'bg-ads-gray text-ads-muted',      ordning: 3 },
  alla:    { text: 'I alla, samma 3D-vy',  farg: 'bg-emerald-100 text-emerald-800', ordning: 4 },
};

const vjNyckel = r => `${r.setId}|${r.viewId}`;

function vjVyer() {
  const perNyckel = new Map((_vp.rader || []).map(r => [vjNyckel(r), r]));
  return _vj.valda.map(k => perNyckel.get(k)).filter(Boolean);
}

// ── Val av vyer ───────────────────────────────────────────────────────────────

function vjToggla(nyckel, pa) {
  _vj.valda = _vj.valda.filter(k => k !== nyckel);
  if (pa) {
    if (_vj.valda.length >= VJ_MAX) { alert(`Högst ${VJ_MAX} vyer åt gången.`); return vhRita(); }
    _vj.valda.push(nyckel);
  }
  _vj.lagg = new Set();
  _vj.plan = null;
  vhRita();
}

function vjTraffar() {
  const q = _vj.sok.trim().toLowerCase();
  return (_vp.rader || []).filter(r => !q || r.namn.toLowerCase().includes(q) || r.setNamn.toLowerCase().includes(q));
}

function vjSok(text) {
  _vj.sok = text;
  const el = document.getElementById('vj-vylista');
  if (el) el.innerHTML = vjVylistaHtml();
}

function vjMarkeraTraffar() {
  const nya = vjTraffar().map(vjNyckel).filter(k => !_vj.valda.includes(k));
  const plats = VJ_MAX - _vj.valda.length;
  if (nya.length > plats) alert(`Högst ${VJ_MAX} vyer åt gången, så bara de första ${plats} markeras.`);
  _vj.valda.push(...nya.slice(0, Math.max(0, plats)));
  _vj.lagg = new Set();
  _vj.plan = null;
  vhRita();
}

function vjRensa() {
  _vj.valda = [];
  _vj.lagg = new Set();
  _vj.plan = null;
  vhRita();
}

// ── Analys ────────────────────────────────────────────────────────────────────

// Modellens filnamn, ur något av de inlästa model setten.
function vjModellNamn(itemId) {
  for (const r of _vp.rader || []) {
    const m = r.modeller.find(x => x.itemId === itemId);
    if (m) return m.namn;
  }
  return '(modell som inte finns i model settet)';
}

// [{ itemId, namn, perVy: Map(nyckel → [3D-vyer]), status, saknasI: [nycklar], kanLaggas, varfor }]
function vjAnalys() {
  const vyer = vjVyer();
  const perFil = new Map();
  for (const r of vyer) {
    for (const d of r.ra.definition || []) {
      const id = vkUtanViewable(d.lineageUrn);
      if (!perFil.has(id)) perFil.set(id, { itemId: id, perVy: new Map() });
      const f = perFil.get(id);
      if (!f.perVy.has(vjNyckel(r))) f.perVy.set(vjNyckel(r), []);
      const lista = f.perVy.get(vjNyckel(r));
      if (!lista.includes(d.viewableName || '')) lista.push(d.viewableName || '');
    }
  }
  const ut = [];
  for (const f of perFil.values()) {
    f.namn = vjModellNamn(f.itemId);
    const sig = k => [...f.perVy.get(k)].sort().join('|');
    const med = vyer.filter(r => f.perVy.has(vjNyckel(r))).map(vjNyckel);
    f.saknasI = vyer.filter(r => !f.perVy.has(vjNyckel(r))).map(vjNyckel);
    if (!f.saknasI.length) {
      const sigs = med.map(sig);
      const unika = new Set(sigs);
      f.status = unika.size === 1 ? 'alla'
        : unika.size === sigs.length && med.every(k => f.perVy.get(k).length === 1) ? 'perVy' : 'blandat';
    } else {
      f.status = med.length === 1 && vyer.length > 1 ? 'en' : 'saknas';
    }
    if (vyer.length < 2) f.status = 'alla';

    // En saknad modell kan bara läggas till när vyerna som har den är överens
    // om 3D-vyerna, och modellen finns i model settet för vyn som saknar den.
    if (f.status === 'saknas') {
      const sigs = new Set(med.map(sig));
      const perNyckel = new Map(vyer.map(r => [vjNyckel(r), r]));
      const utanforSet = f.saknasI.filter(k => !perNyckel.get(k).modeller.some(m => m.itemId === f.itemId));
      if (sigs.size > 1) f.varfor = 'Vyerna har olika 3D-vyer för modellen. Lägg till den i läget Per model set.';
      else if (utanforSet.length) f.varfor = 'Modellen finns inte i model settet för alla vyer som saknar den.';
      f.kanLaggas = !f.varfor;
      f.vy3dAttLagga = f.kanLaggas ? f.perVy.get(med[0]) : [];
    }
    ut.push(f);
  }
  return ut.sort((a, b) => VJ_STATUS[a.status].ordning - VJ_STATUS[b.status].ordning || a.namn.localeCompare(b.namn, 'sv'));
}

// ── Lägga till saknade modeller ───────────────────────────────────────────────

function vjTogglaLagg(itemId, pa) {
  if (pa) _vj.lagg.add(itemId); else _vj.lagg.delete(itemId);
  _vj.plan = null;
  const knapp = document.getElementById('vj-lagg-knapp');
  if (knapp) { knapp.disabled = !_vj.lagg.size; knapp.textContent = `Lägg till markerade (${_vj.lagg.size})…`; }
}

function vjMarkeraAllaSaknade() {
  for (const f of vjAnalys()) if (f.status === 'saknas' && f.kanLaggas) _vj.lagg.add(f.itemId);
  vhRita();
}

function vjForbered() {
  const filer = vjAnalys().filter(f => _vj.lagg.has(f.itemId) && f.kanLaggas);
  const perNyckel = new Map(vjVyer().map(r => [vjNyckel(r), r]));
  const perVy = new Map();   // nyckel → [{ f, vy3d }]
  for (const f of filer) {
    for (const k of f.saknasI) {
      if (!perVy.has(k)) perVy.set(k, []);
      perVy.get(k).push(f);
    }
  }
  const plan = [];
  for (const [k, lista] of perVy) {
    const r = perNyckel.get(k);
    const gammal = (r.ra.definition || []).map(d => ({ lineageUrn: d.lineageUrn, viewableName: d.viewableName }));
    const ny = [...gammal, ...lista.flatMap(f => f.vy3dAttLagga.map(v => v ? { lineageUrn: f.itemId, viewableName: v } : { lineageUrn: f.itemId }))];
    if (ny.length > VH_MAX_MODELLER) return alert(`Vyn ${r.namn} skulle få ${ny.length} poster, men Model Coordination tar högst ${VH_MAX_MODELLER}.`);
    plan.push({ r, lista, gammal, ny });
  }
  if (!plan.length) return alert('Inget att lägga till.');
  _vj.plan = plan;
  vhRita();
}

async function vjKor() {
  const plan = _vj.plan;
  if (!plan) return;
  _vj.plan = null;
  _vj.kor = { klar: false, rader: plan.map(p => ({ namn: `${p.r.setNamn} · ${p.r.namn}`, status: 'väntar' })) };
  vhRita();
  for (let i = 0; i < plan.length; i++) {
    const rad = _vj.kor.rader[i];
    rad.status = 'pågår';
    vhRita();
    try {
      await updateModelSetViewDefinition(_currentProject.id, plan[i].r.setId, plan[i].r.viewId, plan[i].gammal, plan[i].ny);
      rad.status = 'klar';
    } catch (err) {
      rad.status = 'fel';
      rad.fel = vhFelText(err.message);
    }
  }
  _vj.kor.klar = true;
  _vj.lagg = new Set();
  await vpLadda();
}

function vjExportera() {
  const vyer = vjVyer();
  const aoa = [['Modell', 'Bedömning', ...vyer.map(r => r.namn)]];
  for (const f of vjAnalys()) {
    aoa.push([vmUtanFilandelse(f.namn), VJ_STATUS[f.status].text,
      ...vyer.map(r => (f.perVy.get(vjNyckel(r)) || ['–']).map(v => v || '(standard)').join(', '))]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 45 }, { wch: 22 }, ...vyer.map(() => ({ wch: 24 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Jämförelse');
  bhLaddaNer(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]),
    `jamforelse_vyer_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function vjKropp() {
  if (_vp.laddar) return vkLaddarKort(_vp.framsteg || 'Läser vyer…');
  if (_vp.fel) return `<div class="bg-white border border-ads-border rounded p-6 text-sm text-red-600">Kunde inte läsa vyerna: ${vkEsc(_vp.fel)}</div>`;
  if (!_vp.rader) { setTimeout(vpLadda); return vkLaddarKort('Läser vyer…'); }

  return `
    <div class="grid gap-4" style="grid-template-columns: minmax(240px, 300px) 1fr">
      <div class="bg-white border border-ads-border rounded p-3 self-start">
        <div class="flex items-center justify-between mb-2">
          <p class="text-sm font-medium">Vyer att jämföra <span class="text-ads-muted font-normal">(${_vj.valda.length})</span></p>
          ${_vj.valda.length ? '<button onclick="vjRensa()" class="text-xs text-ads-muted hover:text-ads-text">Rensa</button>' : ''}
        </div>
        <input value="${vkEsc(_vj.sok)}" oninput="vjSok(this.value)" placeholder="Sök vy, t.ex. Block"
               class="w-full border border-ads-border rounded px-2.5 py-1.5 text-sm mb-1 focus:outline-none focus:ring-1 focus:ring-ads-blue" />
        <button onclick="vjMarkeraTraffar()" class="text-xs text-ads-blue hover:underline mb-2">Markera träffarna</button>
        <div id="vj-vylista" class="max-h-[60vh] overflow-auto">${vjVylistaHtml()}</div>
      </div>
      <div class="min-w-0">${vjResultatHtml()}</div>
    </div>`;
}

function vjVylistaHtml() {
  const traffar = vjTraffar();
  if (!traffar.length) return '<p class="text-xs text-ads-muted">Inga vyer matchar.</p>';
  let set = null;
  return traffar.map(r => {
    const rubrik = r.setNamn !== set ? `<div class="text-[10px] uppercase tracking-wide text-ads-muted mt-2 mb-0.5">${vkEsc(set = r.setNamn)}</div>` : '';
    return `${rubrik}
      <label class="flex items-start gap-1.5 text-xs py-0.5 cursor-pointer">
        <input type="checkbox" class="accent-ads-blue mt-0.5" ${_vj.valda.includes(vjNyckel(r)) ? 'checked' : ''}
               onchange="vjToggla('${vkEsc(vjNyckel(r))}', this.checked)" />
        <span>${vkEsc(r.namn)}</span></label>`;
  }).join('');
}

function vjResultatHtml() {
  const vyer = vjVyer();
  if (vyer.length < 2) {
    return `<div class="bg-white border border-ads-border rounded p-6 text-sm text-ads-muted">
      Välj minst två vyer. Varje modell visas på en rad med de 3D-vyer den ligger med i varje vy, och bedöms:
      <ul class="mt-2 space-y-1 text-xs">${Object.values(VJ_STATUS).map(s => `<li><span class="px-1.5 py-0.5 rounded ${s.farg}">${s.text}</span></li>`).join('')}</ul>
      <p class="text-xs mt-2">Det som gäller hela huset, som upphängningar, ska vara med i alla vyer med samma 3D-vy.
        Blockspecifika modeller har en egen 3D-vy i varje blockvy.</p></div>`;
  }
  const analys = vjAnalys();
  const rader = _vj.bara ? analys.filter(f => f.status === 'saknas' || f.status === 'blandat') : analys;
  const antal = s => analys.filter(f => f.status === s).length;
  const kortVy = v => vkEsc(v || '(standard)');

  return `
    <div class="flex items-center gap-2 flex-wrap mb-3 text-xs">
      ${Object.entries(VJ_STATUS).map(([k, s]) => `<span class="px-2 py-0.5 rounded-full ${s.farg}">${s.text} <b>${antal(k)}</b></span>`).join('')}
    </div>
    ${_vj.kor ? vjKorHtml() : ''}
    ${_vj.plan ? vjPlanHtml() : ''}
    <div class="bg-white border border-ads-border rounded p-3 mb-3 flex items-center gap-3 flex-wrap text-xs">
      <label class="flex items-center gap-1.5"><input type="checkbox" class="accent-ads-blue" ${_vj.bara ? 'checked' : ''}
        onchange="_vj.bara = this.checked; vhRita()" /> Bara det som avviker</label>
      ${antal('saknas') ? '<button onclick="vjMarkeraAllaSaknade()" class="text-ads-blue hover:underline">Markera alla saknade som går att lägga till</button>' : ''}
      <div class="flex-1"></div>
      ${bhKnapp('vjExportera()', 'Excel')}
      <button id="vj-lagg-knapp" onclick="vjForbered()" ${_vj.lagg.size ? '' : 'disabled'}
              class="bg-be-charcoal hover:bg-black text-white font-medium py-1.5 px-3 rounded disabled:opacity-40">Lägg till markerade (${_vj.lagg.size})…</button>
    </div>
    <div class="bg-white border border-ads-border rounded overflow-auto max-h-[70vh]">
      <table class="text-xs border-separate border-spacing-0">
        <thead class="sticky top-0 z-10 bg-ads-gray text-ads-muted text-left">
          <tr>
            <th class="px-2 py-2 w-6 bg-ads-gray"></th>
            <th class="px-3 py-2 sticky left-0 bg-ads-gray min-w-[240px]">Modell</th>
            <th class="px-3 py-2">Bedömning</th>
            ${vyer.map(r => `<th class="px-3 py-2 min-w-[120px] max-w-[180px]" title="${vkEsc(`${r.setNamn} · ${r.namn}`)}"><div class="truncate">${vkEsc(r.namn)}</div></th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${!rader.length ? `<tr><td colspan="${3 + vyer.length}" class="px-3 py-6 text-center text-ads-muted">Inga avvikelser mellan vyerna.</td></tr>` : ''}
          ${rader.map(f => {
            const s = VJ_STATUS[f.status];
            return `
              <tr class="align-top hover:bg-ads-gray/40">
                <td class="px-2 py-1.5 border-t border-ads-border/60">${f.status === 'saknas' && f.kanLaggas
                  ? `<input type="checkbox" class="accent-ads-blue" ${_vj.lagg.has(f.itemId) ? 'checked' : ''} onchange="vjTogglaLagg('${vkEsc(f.itemId)}', this.checked)"
                       title="Lägg till i vyerna som saknar den" />` : ''}</td>
                <td class="px-3 py-1.5 border-t border-ads-border/60 sticky left-0 bg-white font-medium">${vkEsc(vmUtanFilandelse(f.namn))}</td>
                <td class="px-3 py-1.5 border-t border-ads-border/60 whitespace-nowrap">
                  <span class="px-1.5 py-0.5 rounded ${s.farg}">${s.text}</span>
                  ${f.varfor ? `<div class="text-[10px] text-ads-muted mt-0.5 whitespace-normal max-w-[200px]">${vkEsc(f.varfor)}</div>` : ''}</td>
                ${vyer.map(r => {
                  const har = f.perVy.get(vjNyckel(r));
                  return `<td class="px-3 py-1.5 border-t border-ads-border/60 ${!har && f.status === 'saknas' ? 'bg-red-50' : ''}">
                    ${har ? har.map(kortVy).join('<br>') : `<span class="${f.status === 'saknas' ? 'text-red-700 font-semibold' : 'text-ads-border'}">–</span>`}</td>`;
                }).join('')}
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function vjPlanHtml() {
  return `
    <div class="bg-amber-50 border border-amber-300 rounded p-3 mb-3 text-xs">
      <div class="font-medium text-sm mb-1">Det här skrivs till ACC</div>
      <ul class="space-y-1 mb-2">
        ${_vj.plan.map(p => `<li><b>${vkEsc(p.r.namn)}</b> <span class="text-ads-muted">(${vkEsc(p.r.setNamn)})</span>: läggs till
          ${p.lista.map(f => vkEsc(`${vmUtanFilandelse(f.namn)}${f.vy3dAttLagga.filter(Boolean).length ? ` – ${f.vy3dAttLagga.filter(Boolean).join(', ')}` : ''}`)).join(', ')}</li>`).join('')}
      </ul>
      <div class="flex gap-2">
        <button onclick="vjKor()" class="bg-be-charcoal hover:bg-black text-white font-medium py-1.5 px-3 rounded">Spara i ACC</button>
        <button onclick="_vj.plan = null; vhRita()" class="px-2 text-ads-muted hover:text-ads-text">Avbryt</button>
      </div>
    </div>`;
}

function vjKorHtml() {
  const k = _vj.kor;
  const farg = { väntar: 'text-ads-muted', pågår: 'text-ads-blue', klar: 'text-emerald-700', fel: 'text-red-700' };
  return `
    <div class="bg-white border border-ads-border rounded p-3 mb-3 text-xs">
      <div class="flex items-center mb-1"><span class="font-medium text-sm flex-1">${k.klar ? 'Klart' : 'Sparar i ACC…'}</span>
        ${k.klar ? '<button onclick="_vj.kor = null; vhRita()" class="text-ads-muted hover:text-ads-text">✕</button>' : ''}</div>
      <ul>${k.rader.map(r => `<li class="${farg[r.status]}">${vkEsc(r.namn)}: ${r.status}${r.fel ? ` – ${vkEsc(r.fel)}` : ''}</li>`).join('')}</ul>
    </div>`;
}
