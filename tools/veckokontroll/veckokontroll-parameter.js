// ── Veckokontroll: parameterkontroller ────────────────────────────────────────
// Veckokontrollen kan köra sparade parameterkontroller (fliken Parameter-
// kontroll) med modellernas senaste versioner. Valet görs i inställningarna.
// Resultatet visas med veckans avläsning, och när avläsningen sparas hamnar
// siffrorna i veckologgen och som mätpunkt i respektive kontrolls historik.
// Så växer trenden varje vecka som någon kör Veckokontroll; appen har ingen
// server, så inget körs av sig självt.
//
// State: _vk.pk (listan över sparade kontroller i inställningarna) och
// _vk.kor.parameterkontroller (veckans körning).

function vkPkState() {
  _vk.pk ??= { laddar: false, laddad: false, fel: null, lista: [], mapp: null };
  return _vk.pk;
}

async function vkPkLasUppsattningar() {
  const s = vkPkState();
  if (s.laddar) return;
  s.laddar = true;
  s.fel = null;
  vkPkRitaLista();
  const projektId = _currentProject.id;
  try {
    const fil = await pkHittaFil(projektId);
    if (_currentProject?.id !== projektId) return;
    Object.assign(s, { laddad: true, lista: fil.data.uppsattningar, mapp: fil.mapp });
  } catch (err) {
    s.fel = vkFelText(err);
  }
  s.laddar = false;
  vkPkRitaLista();
}

function vkPkInstallningarHtml() {
  const s = vkPkState();
  if (!s.laddad && !s.laddar) setTimeout(vkPkLasUppsattningar, 0);
  return vkKort('6. Parameterkontroller', `
    Välj sparade kontroller från fliken Parameterkontroll som ska köras med veckokontrollen, mot modellernas
    senaste versioner. När du sparar veckans avläsning sparas resultatet också som mätpunkt, så att trenden
    växer varje vecka. Inget körs av sig självt: kontrollerna körs när du kör Veckokontroll.`, `
    <div id="vk-pk-lista">${vkPkListaHtml()}</div>`);
}

function vkPkRitaLista() {
  const el = document.getElementById('vk-pk-lista');
  if (el) el.innerHTML = vkPkListaHtml();
}

function vkPkListaHtml() {
  const s = vkPkState();
  const valda = new Set((_vk.utkast?.parameterkontroller || []).map(p => p.id));
  if (s.laddar || (!s.laddad && !s.fel)) return `<p class="text-xs text-ads-muted">Söker efter sparade parameterkontroller…</p>`;
  if (s.fel) return `<p class="text-xs text-red-600">Kunde inte läsa parameterkontroll.json: ${vkEsc(s.fel)}</p>`;
  const borttagna = (_vk.utkast?.parameterkontroller || []).filter(p => !s.lista.some(u => u.id === p.id));
  if (!s.lista.length && !borttagna.length) return `<p class="text-xs text-ads-muted">Projektet har inga sparade parameterkontroller än. Spara en i fliken Parameterkontroll först.</p>`;
  return `
    <div class="flex flex-col gap-1.5">
      ${s.lista.map(u => `
        <label class="flex items-center gap-2 text-sm text-ads-text cursor-pointer">
          <input type="checkbox" ${valda.has(u.id) ? 'checked' : ''} onchange="vkPkValj('${vkEsc(u.id)}', this.checked)" class="w-3.5 h-3.5 accent-ads-blue"/>
          ${vkEsc(u.namn)} <span class="text-xs text-ads-muted">· ${u.modeller.length} modeller · ${(u.kravprofil?.krav || []).length} krav</span>
        </label>`).join('')}
      ${borttagna.map(p => `<p class="text-xs text-amber-700">"${vkEsc(p.namn)}" finns inte längre bland de sparade kontrollerna och hoppas över.
        <button onclick="vkPkValj('${vkEsc(p.id)}', false)" class="text-ads-blue hover:underline">Ta bort</button></p>`).join('')}
    </div>`;
}

function vkPkValj(id, pa) {
  const u = _vk.utkast;
  if (!u) return;
  const lista = (u.parameterkontroller || []).filter(p => p.id !== id);
  if (pa) {
    const post = vkPkState().lista.find(x => x.id === id);
    if (post) lista.push({ id, namn: post.namn });
  }
  u.parameterkontroller = lista;
  vkPkRitaLista();
}

// ── Körningen ─────────────────────────────────────────────────────────────────
// En kontroll som inte går att köra stoppar inte resten av veckokontrollen.

async function vkPkKor(inst, rapport) {
  const valda = inst.parameterkontroller || [];
  if (!valda.length) return null;
  const projektId = _currentProject.id;
  rapport('Läser sparade parameterkontroller');
  let fil;
  try { fil = await pkHittaFil(projektId); }
  catch (err) { return { mapp: null, rader: valda.map(p => ({ id: p.id, namn: p.namn, fel: `parameterkontroll.json gick inte att läsa: ${vkFelText(err)}` })) }; }

  const rader = [];
  for (const p of valda) {
    const sparad = fil.data.uppsattningar.find(u => u.id === p.id);
    if (!sparad) { rader.push({ id: p.id, namn: p.namn, fel: 'Kontrollen finns inte längre bland de sparade parameterkontrollerna.' }); continue; }
    const setup = pkNormaliseraUppsattning(sparad);
    try {
      const korning = await pkKorUppsattning(projektId, setup, { onSteg: steg => rapport(`Parameterkontroll ${setup.namn}: ${steg}`) });
      rader.push({ id: p.id, namn: setup.namn, korning });
    } catch (err) {
      rader.push({ id: p.id, namn: setup.namn, fel: vkFelText(err) });
    }
  }
  return { mapp: fil.mapp, rader };
}

function vkPkResultatHtml(res) {
  const pk = res?.parameterkontroller;
  if (!pk?.rader?.length) return '';
  return `
    <div class="bg-white border border-ads-border rounded p-5">
      <h3 class="text-sm font-semibold text-ads-text mb-1">Parameterkontroller</h3>
      <p class="text-xs text-ads-muted mb-3">Mot modellernas senaste versioner. Sparas som mätpunkt i varje kontrolls historik när du sparar veckans avläsning.</p>
      <table class="w-full text-sm">
        <thead><tr class="text-[11px] uppercase tracking-wide text-ads-muted text-left">
          <th class="py-1.5 pr-3 font-semibold">Kontroll</th><th class="py-1.5 pr-3 font-semibold">Ifyllnadsgrad</th>
          <th class="py-1.5 pr-3 font-semibold">Klara element</th><th class="py-1.5 pr-3 font-semibold">Modeller som uppfyller kraven</th><th></th></tr></thead>
        <tbody>${pk.rader.map((r, i) => {
          if (r.fel) return `<tr class="border-t border-ads-border"><td class="py-2 pr-3">${vkEsc(r.namn)}</td><td colspan="4" class="py-2 text-xs text-red-600">${vkEsc(r.fel)}</td></tr>`;
          const t = r.korning.resultat.totalt;
          const bedomda = r.korning.resultat.modeller.filter(m => ['uppfyller', 'uppfyller-inte'].includes(m.bedomning));
          const olasbara = r.korning.resultat.modeller.filter(m => m.status !== 'klar').length;
          return `<tr class="border-t border-ads-border">
            <td class="py-2 pr-3 text-ads-text">${vkEsc(r.namn)}</td>
            <td class="py-2 pr-3 tabular-nums">${pkProcentText(t.ifyllda, t.kravVarden)}</td>
            <td class="py-2 pr-3 tabular-nums">${pkProcentText(t.klara, t.kontrollerade)}</td>
            <td class="py-2 pr-3">${bedomda.filter(m => m.bedomning === 'uppfyller').length} av ${bedomda.length}${olasbara ? ` <span class="text-xs text-red-600">· ${olasbara} kunde inte läsas</span>` : ''}</td>
            <td class="py-2 text-right"><button onclick="vkPkOppna(${i})" class="text-xs text-ads-blue hover:underline">Visa i Parameterkontroll</button></td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}

// Öppnar kontrollen i fliken Parameterkontroll med veckans resultat, utan att
// köra om den.
async function vkPkOppna(i) {
  const r = _vk.kor.resultat?.parameterkontroller?.rader?.[i];
  if (!r?.korning) return;
  showTab('parameterkontroll');
  try {
    await pkLasLagring();
    const u = pkLagring().data.uppsattningar.find(x => x.id === r.id);
    if (!u) return vkToast('Kontrollen finns inte längre bland de sparade.', 'red');
    pkOppnaUppsattning(String(pkNod(u.id)));
    _pk.korning = r.korning;
    _pk.steg = 'resultat';
    pkUppdatera();
  } catch (err) {
    vkToast(`Kunde inte öppna kontrollen: ${vkFelText(err)}`, 'red');
  }
}

// ── Till veckologgen och historiken ───────────────────────────────────────────

function vkPkLoggPoster(res) {
  return (res?.parameterkontroller?.rader || []).map(r => {
    if (r.fel) return { id: r.id, namn: r.namn, fel: r.fel };
    const t = r.korning.resultat.totalt;
    const m = r.korning.resultat.modeller;
    return {
      id: r.id, namn: r.namn, tid: r.korning.tid,
      kravVarden: t.kravVarden, ifyllda: t.ifyllda, kontrollerade: t.kontrollerade, klara: t.klara,
      uppfyller: m.filter(x => x.bedomning === 'uppfyller').length,
      bedomda: m.filter(x => ['uppfyller', 'uppfyller-inte'].includes(x.bedomning)).length,
      olasbara: m.filter(x => x.status !== 'klar').length,
    };
  });
}

async function vkPkSparaMatpunkter(res) {
  const pk = res?.parameterkontroller;
  if (!pk?.rader?.some(r => r.korning)) return;
  if (!pk.mapp) { vkToast('Mätpunkterna sparades inte: mappen med parameterkontroll.json gick inte att läsa.', 'red'); return; }
  const fel = [];
  for (const r of pk.rader.filter(x => x.korning)) {
    try { await pkSparaPunktI(_currentProject.id, pk.mapp.id, r.id, pkMatpunktAv(r.korning)); }
    catch (err) { fel.push(`${r.namn}: ${vkFelText(err)}`); }
  }
  if (fel.length) vkToast(`Några mätpunkter sparades inte: ${fel.join('; ')}`, 'red');
}
