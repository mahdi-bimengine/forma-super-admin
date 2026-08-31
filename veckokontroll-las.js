// ── Veckokontroll: läsa modelldata ────────────────────────────────────────────
// Hämtar veckans underlag från ACC. Två källor läses oberoende av varandra och
// jämförs sedan mot varandra i veckokontroll-kor.js:
//
//   Data Management  de bevakade mapparna, med senaste versionen av varje fil
//   Model Coordination  senaste model set-versionen och vilka filversioner som
//                       ingår i den
//
// Del 2 av 5.

// En spärr mot att tappa bort sig i djupa mappträd. Slår den till sägs det i
// resultatet, i stället för att tysta bort modeller.
const VK_MAX_MAPPAR = 120;

// ── Hjälpare ──────────────────────────────────────────────────────────────────

// urn:adsk.wipprod:fs.file:vf.abc?version=3  →  3
function vkVersionNrUrUrn(urn) {
  const m = String(urn || '').match(/version=(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Model Coordination hänger på viewable-namn efter en fyrkant. Bort med det.
function vkUtanViewable(urn) {
  return String(urn || '').split('#')[0];
}

function vkFilandelse(namn) {
  return (String(namn).split('.').pop() || '').toLowerCase();
}

// Klockor går isär mellan ACC och datorn, så en fil kan se ut att vara laddad
// upp om en stund. Noll dagar är sanningen nära nog i det läget.
function vkDagarSedan(iso, nu = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((nu - t) / 86400000));
}

// ── Data Management: de bevakade mapparna ─────────────────────────────────────

async function vkLasMappar(inst, rapport) {
  const projektId = _currentProject.id;
  const modeller  = [];
  const problem   = [];
  const besokta   = new Set();
  let bromsad     = false;

  // Kö av mappar att läsa. Undermappar läggs på under vägen om de ska räknas med.
  const ko = inst.mappar.map(m => ({ id: m.id, sokvag: m.sokvag || m.namn }));

  while (ko.length) {
    if (besokta.size >= VK_MAX_MAPPAR) { bromsad = true; break; }

    const mapp = ko.shift();
    if (besokta.has(mapp.id)) continue;
    besokta.add(mapp.id);

    rapport?.(`Läser ${mapp.sokvag}`);

    let svar;
    try {
      svar = await getFolderContentsWithTips(projektId, mapp.id);
    } catch (err) {
      problem.push(`Kunde inte läsa mappen ${mapp.sokvag}: ${err.message}`);
      continue;
    }

    for (const post of svar.poster) {
      const namn = post.attributes?.displayName || post.attributes?.name || '';

      if (post.type === 'folders') {
        if (inst.undermappar && !post.attributes?.hidden) {
          ko.push({ id: post.id, sokvag: `${mapp.sokvag} / ${namn}` });
        }
        continue;
      }
      if (post.type !== 'items') continue;
      if (post.attributes?.hidden) continue;
      if (!inst.filtyper.includes(vkFilandelse(namn))) continue;

      const tip = tipVersionOf(post, svar.tips);
      if (!tip) {
        problem.push(`Hittade ingen version för ${namn} i ${mapp.sokvag}.`);
        continue;
      }

      const a = tip.attributes || {};
      modeller.push({
        itemId:    post.id,
        versionId: tip.id,
        namn,
        ext:       vkFilandelse(namn),
        mappId:    mapp.id,
        sokvag:    mapp.sokvag,
        version:   a.versionNumber ?? vkVersionNrUrUrn(tip.id),
        andrad:    a.lastModifiedTime || a.createTime || null,
        av:        a.lastModifiedUserName || a.createUserName || '',
      });
    }
  }

  return { modeller, problem, antalMappar: besokta.size, bromsad };
}

// ── Model Coordination: senaste model set-versionen ───────────────────────────

async function vkLasModellSet(inst, rapport) {
  const projektId = _currentProject.id;
  const setLista  = [];
  const problem   = [];

  for (const ms of inst.modellSet) {
    rapport?.(`Läser model set ${ms.namn}`);
    try {
      const versioner = await getModelSetVersions(projektId, ms.id);
      if (!versioner.length) {
        problem.push(`Model set ${ms.namn} har ingen version ännu.`);
        setLista.push({ id: ms.id, namn: ms.namn, version: null, dokument: [] });
        continue;
      }

      const senaste = vkSenasteSetVersion(versioner);
      const detalj  = await getModelSetVersion(projektId, ms.id, senaste.version ?? senaste.id);

      setLista.push({
        id:       ms.id,
        namn:     ms.namn,
        version:  detalj.version ?? senaste.version ?? null,
        tid:      detalj.createTime || senaste.createTime || null,
        status:   detalj.status || null,
        dokument: vkGrupperaDokument(detalj.documentVersions || []),
      });
    } catch (err) {
      problem.push(`Kunde inte läsa model set ${ms.namn}: ${err.message}`);
      setLista.push({ id: ms.id, namn: ms.namn, version: null, dokument: [], fel: err.message });
    }
  }

  return { setLista, problem };
}

// ── Model Coordination: de sparade vyerna ─────────────────────────────────────
// En vy är en uppsättning modeller som du tittar på tillsammans. Vyn hör till
// model settet, och innehållet läses ur den model set-version som gäller nu.

async function vkLasVyer(setLista, rapport) {
  const projektId = _currentProject.id;
  const vyer      = [];
  const problem   = [];

  for (const s of setLista) {
    if (s.version == null) continue;

    rapport?.(`Läser vyer i ${s.namn}`);
    try {
      const definitioner = await listModelSetViews(projektId, s.id);
      const innehall     = await listModelSetViewVersions(projektId, s.id, s.version);
      const perVy        = new Map(innehall.map(v => [v.viewId, v]));

      for (const def of definitioner) {
        const dokument = vkGrupperaDokument(perVy.get(def.viewId)?.documentVersions || []);
        const efter    = dokument.filter(d => d.arTip === false);

        // Modeller som vyn är definierad med men som inte kom med i versionen.
        const finns   = new Set(dokument.map(d => d.itemId));
        const saknade = (def.definition || [])
          .map(d => vkUtanViewable(d.lineageUrn))
          .filter(id => id && !finns.has(id));

        vyer.push({
          viewId:     def.viewId,
          namn:       def.name || '(namnlös vy)',
          beskrivning: def.description || '',
          privat:     !!def.isPrivate,
          setId:      s.id,
          setNamn:    s.namn,
          setVersion: s.version,
          antalModeller: dokument.length,
          dokument,
          efter,
          saknade,
          iFas:       efter.length === 0 && saknade.length === 0,
        });
      }
    } catch (err) {
      problem.push(`Kunde inte läsa vyer i model set ${s.namn}: ${err.message}`);
    }
  }

  return { vyer, problem };
}

function vkSenasteSetVersion(versioner) {
  const nr = v => v.version ?? v.versionNumber ?? 0;
  return [...versioner].sort((a, b) => {
    const d = nr(b) - nr(a);
    if (d) return d;
    return String(b.createTime || '').localeCompare(String(a.createTime || ''));
  })[0];
}

// En Revitfil ger en post per 3D-vy i model set-versionen. Slå ihop dem till en
// rad per modell, annars ser en fil ut som flera.
function vkGrupperaDokument(documentVersions) {
  const perModell = new Map();

  for (const d of documentVersions) {
    const itemId = vkUtanViewable(d.documentLineage?.lineageUrn);
    if (!itemId) continue;

    const iSet   = vkVersionNrUrUrn(d.versionUrn);
    const tipNr  = vkVersionNrUrUrn(d.documentLineage?.tipVersionUrn);
    const namn   = d.originalSeedFileVersionName
                || String(d.displayName || '').replace(/^\{[^}]*\}_?/, '')
                || d.displayName || '';

    const fanns = perModell.get(itemId);
    if (fanns) {
      // Behåll den högsta versionen och lägg ihop vyerna.
      if ((iSet ?? 0) > (fanns.versionISet ?? 0)) fanns.versionISet = iSet;
      if (d.documentStatus && d.documentStatus !== 'Succeeded') fanns.status = d.documentStatus;
      if (d.viewableName) fanns.vyer.push(d.viewableName);
      continue;
    }

    perModell.set(itemId, {
      itemId,
      namn,
      versionISet: iSet,
      tipVersion:  tipNr,
      arTip:       typeof d.isTipVersion === 'boolean'
                     ? d.isTipVersion
                     : (iSet != null && tipNr != null ? iSet === tipNr : null),
      status:      d.documentStatus || null,
      inpassad:    d.documentLineage?.isAligned ?? null,
      vyer:        d.viewableName ? [d.viewableName] : [],
    });
  }

  return [...perModell.values()];
}
