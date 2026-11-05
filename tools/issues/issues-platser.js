// issues-platser.js — kolumnen Location och namnen på platserna.
//
// Ärendena anger sin plats (Location) med ett id. Namnen ligger i Autodesks
// Locations-API, som saknar CORS och inte kan läsas från webbläsaren. Därför
// namnger man varje plats en gång här. Namnen sparas per projekt i
// localStorage (is-platser). När konsolen får en egen server kan de riktiga
// namnen hämtas, och då går platsträdet före det man satt själv.
//
// Förslagen i namnrutan härleds ur rubrikerna (isHarleddaPlatsnamn) och
// används bara som hjälp, aldrig som värde.

const IS_EJ_NAMNGIVEN = 'Ej namngiven';

// Ärendets plats som text, eller tom om ärendet saknar plats.
function isLocation(a) {
  if (!a.platsId) return '';
  const eget = _is.platsNamn?.[a.projektId]?.[a.platsId];
  if (eget) return eget;
  if (a.platsVag?.length) return a.platsVag.join(' › ');
  return `${IS_EJ_NAMNGIVEN} ${String(a.platsId).slice(0, 6)}`;
}

// Alla platser i de hämtade ärendena, per projekt, med antal och exempel.
function isPlatsLista() {
  return [..._is.projekt.values()].map(p => {
    const forslag = isHarleddaPlatsnamn(p);
    const platser = new Map();
    for (const a of p.arenden) {
      if (!a.platsId) continue;
      if (!platser.has(a.platsId)) platser.set(a.platsId, { id: a.platsId, antal: 0, rubriker: [] });
      const r = platser.get(a.platsId);
      r.antal++;
      if (r.rubriker.length < 3) r.rubriker.push(a.rubrik);
    }
    const rader = [...platser.values()].map(r => ({
      ...r,
      projektId: p.id,
      namn:      _is.platsNamn?.[p.id]?.[r.id] || '',
      forslag:   forslag.get(r.id) || '',
    })).sort((x, y) => (!!x.namn - !!y.namn) || y.antal - x.antal);
    return { projekt: p, rader };
  }).filter(g => g.rader.length);
}

function isOppnaPlatser() {
  _is.dialog = 'platser';
  isRita();
}

function isSattPlatsnamn(ref, namn) {
  const r = _is.ref[ref];
  const projekt = (_is.platsNamn[r.projektId] ||= {});
  if (String(namn).trim()) projekt[r.id] = String(namn).trim(); else delete projekt[r.id];
  isLagra('is-platser', _is.platsNamn);
}

// Fyller platserna som saknar namn med förslagen, så att man bara rättar.
function isFyllPlatsforslag() {
  let antal = 0;
  for (const { rader } of isPlatsLista()) {
    for (const r of rader) {
      if (r.namn || !r.forslag) continue;
      (_is.platsNamn[r.projektId] ||= {})[r.id] = r.forslag;
      antal++;
    }
  }
  if (!antal) return alert('Det finns inga förslag att fylla i.');
  isLagra('is-platser', _is.platsNamn);
  isRita();
}

function isPlatserHtml() {
  const grupper = isPlatsLista();
  const utan = grupper.reduce((s, g) => s + g.rader.filter(r => !r.namn).length, 0);
  return `
    ${isDialogHuvud('Namnge platser (Location)',
      'Autodesk låter inte webbläsaren läsa platsernas namn, så de namnges här en gång. Namnen sparas i den här webbläsaren och används i kolumnen Location.')}
    <div class="flex-1 overflow-y-auto px-5 py-4">
      ${!grupper.length ? '<p class="text-sm text-ads-muted text-center py-8">Inga av de hämtade ärendena har en plats.</p>' : ''}
      ${grupper.map(({ projekt, rader }) => `
        <div class="mb-5">
          ${grupper.length > 1 ? `<div class="text-xs font-semibold text-ads-text mb-1.5">${vkEsc(projekt.namn)}</div>` : ''}
          <table class="w-full text-xs">
            <thead class="text-[11px] text-ads-muted text-left">
              <tr><th class="py-1 pr-2 w-64">Namn</th><th class="py-1 pr-2 text-right">Ärenden</th><th class="py-1">Exempel på rubriker</th></tr>
            </thead>
            <tbody>
              ${rader.map(r => `
                <tr class="border-t border-ads-border/60 align-top">
                  <td class="py-1.5 pr-2">
                    <input value="${vkEsc(r.namn)}" placeholder="${vkEsc(r.forslag ? `Förslag: ${r.forslag}` : `Plats ${String(r.id).slice(0, 6)}`)}"
                           onchange="isSattPlatsnamn(${isRef(r)}, this.value)"
                           class="w-full px-2 py-1 border rounded ${r.namn ? 'border-ads-border' : 'border-amber-300 bg-amber-50/40'}" /></td>
                  <td class="py-1.5 pr-2 text-right font-mono">${r.antal}</td>
                  <td class="py-1.5 text-ads-muted">${r.rubriker.map(t => vkEsc(t)).join('<br>')}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`).join('')}
    </div>
    <div class="px-5 py-3 border-t border-ads-border flex items-center gap-3">
      <span class="text-xs text-ads-muted flex-1">${utan ? `${utan} plats${utan > 1 ? 'er' : ''} saknar namn.` : 'Alla platser har namn.'}</span>
      ${utan ? `<button onclick="isFyllPlatsforslag()" class="text-xs border border-ads-border rounded px-3 py-1.5 bg-white hover:border-ads-blue">Fyll tomma med förslagen</button>` : ''}
      <button onclick="isStangDialog()" class="bg-be-charcoal hover:bg-black text-white text-xs font-medium py-1.5 px-3 rounded">Klar</button>
    </div>`;
}
