// parameterkontroll-arenden.js — ACC-ärenden från bristerna (del 9).
//
// Ett ärende per modell eller per disciplin, aldrig ett per element. En
// förhandsvisning visar varje ärende innan något skapas. Ärendenas id sparas i
// körningens mätpunkt, så att nästa körning kan lägga en kommentar med de nya
// siffrorna i stället för att skapa dubbletter. Stängda ärenden rapporteras och
// får ett nytt ärende bara om användaren kryssar i det.

const PK_ARENDE_RUBRIK_MAX = 255;
const PK_ARENDE_TEXT_MAX   = 9000;

function pkArendenKnapp() {
  return pkKnapp('Skapa ärenden', 'pkArendenDialog()', { titel: 'Gör bristerna till ärenden i ACC' });
}

function pkAccId() {
  return String(_currentProject.id).replace(/^b\./, '');
}

// Grupperna som kan bli ärenden: modeller eller discipliner med brister.
function pkArendeGrupper(per) {
  const r = _pk.korning.resultat;
  const grupper = per === 'disciplin'
    ? r.discipliner.map(d => ({ nyckel: `disciplin:${d.disciplin}`, namn: d.disciplin || 'Ej angiven disciplin', modeller: d.modeller.map(id => r.modeller.find(m => m.id === id)) }))
    : r.modeller.map(m => ({ nyckel: `modell:${m.id}`, namn: m.namn, modeller: [m] }));
  return grupper.map(g => {
    const lasbara = g.modeller.filter(m => m.status === 'klar');
    const kravVarden = lasbara.reduce((s, m) => s + m.nyckeltal.kravVarden, 0);
    const ifyllda = lasbara.reduce((s, m) => s + m.nyckeltal.ifyllda, 0);
    const brister = new Map();
    for (const m of lasbara) for (const kat of m.kategorier) for (const p of kat.parametrar) {
      if (p.status === 'ejHamtad' || p.medVarde === p.antal) continue;
      const nyckel = `${p.namn} i ${pkKatText(kat.namn)}`;
      brister.set(nyckel, (brister.get(nyckel) || 0) + p.antal - p.medVarde);
    }
    return { ...g, kravVarden, ifyllda, saknas: kravVarden - ifyllda, brister: [...brister].sort((a, b) => b[1] - a[1]) };
  }).filter(g => g.saknas > 0);
}

function pkArendeText(g) {
  const k = _pk.korning;
  const rader = [
    `Parameterkontroll "${k.setup.namn}", körd ${new Date(k.tid).toLocaleString('sv-SE')}.`,
    `Kravprofil: ${k.setup.kravprofil.namn}. Kontrollen mäter om värden finns, inte om de är korrekta.`,
    '',
    `Ifyllnadsgrad: ${pkProcentText(g.ifyllda, g.kravVarden)} (${pkTalText(g.ifyllda)} av ${pkTalText(g.kravVarden)} krävda värden). ${pkTalText(g.saknas)} värden saknas.`,
    '',
    'Största bristerna:',
    ...g.brister.slice(0, 10).map(([namn, n]) => `• ${namn}: ${pkTalText(n)} element`),
    g.brister.length > 10 ? `• … och ${g.brister.length - 10} till` : '',
    '',
    'Modeller och versioner:',
    ...g.modeller.map(m => `• ${m.namn}${m.version ? ` v${m.version.nummer ?? '?'}` : ''}`),
    _pk.ui.arendeRapport ? `\nExcel-rapporten med alla element: ${_pk.ui.arendeRapport}` : '\nExportera Excel-rapporten från Parameterkontroll för listan över alla element.',
  ];
  return rader.filter(r => r !== '').join('\n').replace(/\n\n\n+/g, '\n\n').slice(0, PK_ARENDE_TEXT_MAX);
}

// Ärenden som skapades från förra mätpunkten med ärenden, per gruppnyckel.
async function pkTidigareArenden() {
  try {
    const h = await pkLasHistorik();
    const med = [...h.poster].reverse().find(p => p.arenden?.length && p.id !== _pk.korning.id);
    // Kopior, så att statusen som läses nedan inte hamnar i historiken.
    return new Map((med?.arenden || []).map(a => [a.nyckel, { ...a }]));
  } catch { return new Map(); }
}

async function pkArendenDialog(per = 'modell') {
  if (!_pk.korning?.resultat) return;
  if (pkResultatInaktuellt()) return vkToast('Resultatet är inaktuellt. Uppdatera först, så att ärendena stämmer med valen.', 'red');
  const d = pkDialog({ titel: 'Skapa ärenden i ACC', html: `<div id="pk-arenden">${pkLaddarHtml('Läser ärendetyper och tidigare ärenden…')}</div>`, knappar: [{ text: 'Avbryt' }], bredd: 'w-[720px]' });
  try {
    const [typer, medlemmar, tidigare] = await Promise.all([
      listIssueTypes(_currentProject.id),
      listProjectUsers(pkAccId()).catch(() => []),
      pkTidigareArenden(),
    ]);
    // Status för tidigare ärenden, så att stängda inte får kommentarer.
    await pkParallellt([...tidigare.values()], 4, async a => {
      try { a.status = (await apsGet(`/construction/issues/v1/projects/${pkAccId()}/issues/${a.id}`)).status; } catch { a.status = 'okand'; }
    });
    if (!document.body.contains(d)) return;
    _pk.ui.arenden = { per, typer, medlemmar, tidigare, grupper: pkArendeGrupper(per) };
    pkRitaArendeDialog();
  } catch (err) {
    const el = document.getElementById('pk-arenden');
    if (el) el.innerHTML = `<p class="text-sm text-red-600">Kunde inte läsa ärendetyperna: ${pkEsc(vkFelText(err))}. Har du behörighet till Issues i projektet?</p>`;
  }
}

function pkRitaArendeDialog() {
  const a = _pk.ui.arenden;
  const el = document.getElementById('pk-arenden');
  if (!el || !a) return;
  const subtyper = a.typer.flatMap(t => (t.subtypes || []).filter(s => s.isActive !== false).map(s => ({ id: s.id, namn: `${t.title} › ${s.title}` })));
  const falt = 'px-2 py-1.5 text-sm border border-ads-border rounded bg-white focus:outline-none focus:ring-1 focus:ring-ads-blue';
  el.innerHTML = `
    <div class="flex flex-col gap-3 text-sm">
      <div class="flex gap-4">
        <label class="flex items-center gap-1.5"><input type="radio" name="pk-a-per" ${a.per === 'modell' ? 'checked' : ''} onchange="pkArendenDialog('modell')" class="accent-ads-blue"/> Ett ärende per modell</label>
        <label class="flex items-center gap-1.5"><input type="radio" name="pk-a-per" ${a.per === 'disciplin' ? 'checked' : ''} onchange="pkArendenDialog('disciplin')" class="accent-ads-blue"/> Ett ärende per disciplin</label>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <label class="flex flex-col gap-1 text-xs text-ads-muted">Ärendetyp
          <select id="pk-a-typ" class="${falt}">${subtyper.map(s => `<option value="${pkEsc(s.id)}">${pkEsc(s.namn)}</option>`).join('')}</select></label>
        <label class="flex flex-col gap-1 text-xs text-ads-muted">Tilldelas
          <select id="pk-a-till" class="${falt}"><option value="">Ingen</option>
            ${a.medlemmar.filter(m => m.autodeskId).sort((x, y) => String(x.name).localeCompare(String(y.name), 'sv')).map(m => `<option value="${pkEsc(m.autodeskId)}">${pkEsc(m.name || m.email)}</option>`).join('')}</select></label>
        <label class="flex flex-col gap-1 text-xs text-ads-muted">Förfaller
          <input id="pk-a-datum" type="date" class="${falt}"/></label>
      </div>
      ${a.grupper.length ? `<ul class="border border-ads-border rounded divide-y divide-ads-border max-h-80 overflow-auto">${a.grupper.map((g, i) => {
        const fore = a.tidigare.get(g.nyckel);
        const oppen = fore && !['closed', 'void', 'okand'].includes(fore.status);
        return `
          <li class="px-3 py-2">
            <label class="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" data-i="${i}" class="pk-a-val accent-ads-blue mt-0.5" ${fore && !oppen ? '' : 'checked'}/>
              <span class="min-w-0">
                <span class="block text-ads-text font-medium">${pkEsc(`Parameterkontroll: ${pkTalText(g.saknas)} värden saknas – ${g.namn}`)}</span>
                <span class="block text-xs text-ads-muted">${pkProcentText(g.ifyllda, g.kravVarden)} ifyllt · ${pkEsc(g.brister.slice(0, 3).map(([n]) => n).join(', '))}${g.brister.length > 3 ? ' …' : ''}</span>
                <span class="block text-xs mt-0.5 ${oppen ? 'text-ads-blue' : fore ? 'text-amber-700' : 'text-ads-muted'}">${oppen
                  ? `Uppdaterar ärende ${pkEsc(fore.displayId || '')} med en kommentar (nu ${pkTalText(g.saknas)}, förra gången ${pkTalText(fore.saknas)} värden saknades).`
                  : fore ? `Ärende ${pkEsc(fore.displayId || '')} är stängt. Kryssa i för att skapa ett nytt.` : 'Skapar ett nytt ärende.'}</span>
              </span>
            </label>
          </li>`;
      }).join('')}</ul>` : `<p class="text-ads-muted">Inga brister att göra ärenden av.</p>`}
      <p class="text-xs text-ads-muted">Inget skapas förrän du trycker Skapa. Ärendena hamnar i ACC Issues med typ, tilldelning och förfallodatum ovan.
        ${_pk.sparatId === _pk.setup.id ? 'Ärendena sparas i mätpunkten, så att nästa körning uppdaterar dem.' : 'Spara kontrollen först, annars kan nästa körning inte känna igen ärendena och skapar nya.'}</p>
      <div class="flex justify-end gap-2">${pkKnapp('Avbryt', "document.getElementById('pk-dialog').remove()")}${a.grupper.length ? pkKnapp('Skapa', 'pkSkapaArenden()', { primar: true }) : ''}</div>
    </div>`;
  document.querySelector('#pk-dialog .border-t')?.remove();
}

async function pkSkapaArenden() {
  const a = _pk.ui.arenden;
  if (!a || a.pagar) return;
  const subtyp = document.getElementById('pk-a-typ')?.value;
  const till   = document.getElementById('pk-a-till')?.value;
  const datum  = document.getElementById('pk-a-datum')?.value;
  const valda  = [...document.querySelectorAll('.pk-a-val:checked')].map(x => a.grupper[Number(x.dataset.i)]);
  if (!subtyp) return vkToast('Välj ärendetyp.', 'red');
  if (!valda.length) return vkToast('Kryssa i minst ett ärende.', 'red');

  a.pagar = true;
  const lyckade = [], misslyckade = [];
  for (const g of valda) {
    const fore = a.tidigare.get(g.nyckel);
    const oppen = fore && !['closed', 'void', 'okand'].includes(fore.status);
    try {
      if (oppen) {
        await apsSend('POST', `/construction/issues/v1/projects/${pkAccId()}/issues/${fore.id}/comments`, {
          body: `Ny parameterkontroll ${new Date(_pk.korning.tid).toLocaleString('sv-SE')}: ${pkTalText(g.saknas)} värden saknas (förra gången ${pkTalText(fore.saknas)}).\n\n${pkArendeText(g)}`.slice(0, PK_ARENDE_TEXT_MAX),
        });
        lyckade.push({ ...fore, saknas: g.saknas, uppdaterad: true });
      } else {
        const issue = await createIssue(_currentProject.id, {
          title: `Parameterkontroll: ${pkTalText(g.saknas)} värden saknas – ${g.namn}`.slice(0, PK_ARENDE_RUBRIK_MAX),
          description: pkArendeText(g),
          issueSubtypeId: subtyp,
          status: 'open',
          ...(till ? { assignedTo: till, assignedToType: 'user' } : {}),
          ...(datum ? { dueDate: datum } : {}),
        });
        lyckade.push({ nyckel: g.nyckel, id: issue.id, displayId: issue.displayId, saknas: g.saknas });
      }
    } catch (err) {
      misslyckade.push({ g, fel: vkFelText(err) });
    }
  }
  a.pagar = false;

  // Ärendena sparas i mätpunkten, så att nästa körning känner igen dem.
  if (lyckade.length && _pk.sparatId === _pk.setup.id) {
    if (!pkMatpunktSparad()) await pkSparaMatpunkt({ tyst: true });
    try {
      const h = await pkLasHistorik();
      const p = h.poster.find(x => x.id === _pk.korning.id);
      if (p) {
        p.arenden = [...(p.arenden || []).filter(x => !lyckade.some(l => l.nyckel === x.nyckel)), ...lyckade.map(({ nyckel, id, displayId, saknas }) => ({ nyckel, id, displayId, saknas }))];
        const itemId = await writeTextFile(_currentProject.id, pkLagring().mapp.id, pkHistorikFil(_pk.sparatId), JSON.stringify({ typ: 'forma-console-parameterkontroll-historik', version: 1, setupId: _pk.sparatId, poster: h.poster }, null, 2), h.itemId);
        h.itemId = itemId;
      }
    } catch (err) {
      vkToast(`Ärendena är skapade men kunde inte sparas i historiken: ${vkFelText(err)}`, 'red');
    }
  }

  const el = document.getElementById('pk-arenden');
  if (el) el.innerHTML = `
    <div class="text-sm flex flex-col gap-2">
      ${lyckade.length ? `<p class="text-green-700">${lyckade.filter(l => !l.uppdaterad).length} skapade, ${lyckade.filter(l => l.uppdaterad).length} uppdaterade med en kommentar.</p>
        <ul class="text-xs text-ads-text list-disc pl-5">${lyckade.map(l => `<li>${l.uppdaterad ? 'Uppdaterat' : 'Skapat'} ärende ${pkEsc(l.displayId || l.id)}</li>`).join('')}</ul>` : ''}
      ${misslyckade.length ? `<p class="text-red-600">${misslyckade.length} gick inte:</p>
        <ul class="text-xs text-red-600 list-disc pl-5">${misslyckade.map(m => `<li>${pkEsc(m.g.namn)}: ${pkEsc(m.fel)}</li>`).join('')}</ul>
        <div>${pkKnapp('Försök igen med de som inte gick', 'pkArendenIgen()', { primar: true })}</div>` : ''}
      <div class="flex justify-end">${pkKnapp('Stäng', "document.getElementById('pk-dialog').remove()")}</div>
    </div>`;
  a.misslyckade = misslyckade.map(m => m.g.nyckel);
  a.val = { subtyp, till, datum };
}

// Försöker bara med dem som misslyckades.
function pkArendenIgen() {
  const a = _pk.ui.arenden;
  if (!a?.misslyckade?.length) return;
  a.grupper = a.grupper.filter(g => a.misslyckade.includes(g.nyckel));
  pkRitaArendeDialog();
  const sel = (id, v) => { const e = document.getElementById(id); if (e && v) e.value = v; };
  sel('pk-a-typ', a.val.subtyp); sel('pk-a-till', a.val.till); sel('pk-a-datum', a.val.datum);
}
