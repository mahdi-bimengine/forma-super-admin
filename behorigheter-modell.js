// behorigheter-modell.js — datamodellen bakom fliken Behörigheter.
//
// Porterad från ACC Permissions Dashboard v4 (Adrian, BIM EngineAi/001 - Forma
// Behörigheter). Modellen är densamma oavsett om datan kommer från Excel-
// exporterna eller direkt från ACC:
//
//   folders      sökväg → { path, name, depth, parentPath, children }
//   permissions  sökväg → { everyone, byId: Map(principal-id → nivå) }
//   users, roles, companies  [{ id, name, ... }]
//
// Bara behörigheter som är satta direkt på en mapp lagras. Ärvda räknas fram
// genom att gå uppåt i trädet till närmaste mapp där principalen har en nivå.

const BH_PERM = {
  V:  { rank: 1, label: 'Visa',             bg: 'bg-slate-300',  text: 'text-slate-800' },
  VD: { rank: 2, label: 'Visa + Hämta',     bg: 'bg-sky-400',    text: 'text-white'     },
  C:  { rank: 3, label: 'Skapa',            bg: 'bg-amber-300',  text: 'text-amber-900' },
  CU: { rank: 4, label: 'Skapa + Överför',  bg: 'bg-amber-500',  text: 'text-white'     },
  E:  { rank: 5, label: 'Redigera',         bg: 'bg-orange-600', text: 'text-white'     },
  M:  { rank: 6, label: 'Hantera',          bg: 'bg-rose-600',   text: 'text-white'     },
  A:  { rank: 7, label: 'Administratör',    bg: 'bg-indigo-700', text: 'text-white'     },
};
const BH_PERM_ORDER = ['V', 'VD', 'C', 'CU', 'E', 'M', 'A'];

const BH_VIA = {
  direct:       'Direkt på mappen',
  user:         'Direkt som person',
  role:         'Via roll',
  company:      'Via företag',
  everyone:     'Via "Alla"',
  projectAdmin: 'Projektadministratör',
};

function bhRank(level) {
  return BH_PERM[level]?.rank ?? null;
}

// ACC:s API anger behörighet som en lista med actions. Nivåerna bygger på
// varandra, så den högsta action som finns avgör nivån. BIM 360:s "Upload only"
// (bara PUBLISH) motsvarar Skapa enligt Autodesks kompatibilitetstabell.
function bhNivaFranActions(actions) {
  const a = new Set(actions || []);
  if (a.has('CONTROL'))                return 'M';
  if (a.has('EDIT'))                   return 'E';
  if (a.has('PUBLISH') && a.has('VIEW')) return 'CU';
  if (a.has('PUBLISH') || a.has('PUBLISH_MARKUP')) return 'C';
  if (a.has('DOWNLOAD'))               return 'VD';
  if (a.has('VIEW'))                   return 'V';
  return null;
}

// Bygger upp children och rotlistan när alla mappar är inlagda.
function bhLankaTrad(folders) {
  const rootPaths = [];
  for (const [path, node] of folders) {
    if (node.parentPath && folders.has(node.parentPath)) folders.get(node.parentPath).children.push(path);
    else rootPaths.push(path);
  }
  const cmp = (a, b) => folders.get(a).name.localeCompare(folders.get(b).name, 'sv', { numeric: true });
  for (const n of folders.values()) n.children.sort(cmp);
  rootPaths.sort(cmp);
  return rootPaths;
}

function bhNyMapp(path) {
  const parts = path.split('/');
  return {
    path,
    name:       parts[parts.length - 1],
    depth:      parts.length - 1,
    parentPath: parts.length > 1 ? parts.slice(0, -1).join('/') : null,
    children:   [],
  };
}

const bhNorm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const bhSv   = (a, b) => a.name.localeCompare(b.name, 'sv');

// ── Koppla medlemmar till principaler ─────────────────────────────────────────
// Excel-exporterna har bara namn att gå på. Från API:et finns även id och
// e-post, som prövas först eftersom två personer kan heta likadant.

function bhMatchaMedlemmar(medlemmar, data) {
  if (!medlemmar || !data) return null;

  const index = (lista, nycklar) => {
    const m = new Map();
    for (const e of lista) for (const k of nycklar(e)) if (k) m.set(k, e);
    return m;
  };
  const users     = index(data.users,     u => [u.email && 'e:' + bhNorm(u.email), 'n:' + bhNorm(u.name)]);
  const roles     = index(data.roles,     r => ['i:' + r.id, 'n:' + bhNorm(r.name)]);
  const companies = index(data.companies, c => ['i:' + c.id, 'n:' + bhNorm(c.name)]);

  const members = medlemmar.members.map(m => {
    const u = (m.email && users.get('e:' + bhNorm(m.email))) || users.get('n:' + bhNorm(m.name));
    const c = (m.companyKey && companies.get('i:' + m.companyKey)) || companies.get('n:' + bhNorm(m.company));
    const matchedRoles = [];
    const unmatched    = [];
    m.roleNames.forEach((rn, i) => {
      const r = (m.roleKeys?.[i] && roles.get('i:' + m.roleKeys[i])) || roles.get('n:' + bhNorm(rn));
      if (r) matchedRoles.push({ id: r.id, name: r.name });
      else   unmatched.push(rn);
    });
    return { ...m, userId: u ? u.id : null, companyId: c ? c.id : null, matchedRoles, unmatched };
  }).sort(bhSv);

  const unmatchedRoles = [];
  for (const m of members) for (const rn of m.unmatched) unmatchedRoles.push({ member: m.name, role: rn });

  return {
    members,
    diagnostics: {
      totalMembers:   members.length,
      matchedAsUsers: members.filter(m => m.userId != null).length,
      projectAdmins:  members.filter(m => m.isProjectAdmin).length,
      unmatchedRoles,
    },
  };
}

// ── Uppslag ───────────────────────────────────────────────────────────────────

function bhDirekt(data, path, principal) {
  const p = data.permissions.get(path);
  if (!p) return null;
  if (principal.kind === 'everyone') return p.everyone || null;
  return p.byId.get(principal.id) || null;
}

function bhEffektiv(data, path, principal) {
  let cur = path;
  while (cur) {
    const v = bhDirekt(data, cur, principal);
    if (v) return { level: v, source: cur === path ? 'direct' : 'inherited', inheritedFrom: cur };
    cur = data.folders.get(cur)?.parentPath || null;
  }
  return null;
}

function bhHogsta(kallor) {
  let best = null;
  for (const s of kallor) {
    const r = bhRank(s.level);
    if (r == null) { console.warn('[Behörigheter] Okänd nivå:', s.level, s); continue; }
    if (!best || r > bhRank(best.level)) best = s;
  }
  return best;
}

// Alla källor som ger en medlem åtkomst till mappen. Med medDirekt = false
// fås baslinjen, alltså det personen skulle ha utan egna direkta behörigheter.
function bhKallorForMedlem(data, path, member, medDirekt = true) {
  const kallor = [];
  const ev = bhEffektiv(data, path, { kind: 'everyone' });
  if (ev) kallor.push({ via: 'everyone', name: 'Alla projektmedlemmar', ...ev });

  if (medDirekt && member.userId != null) {
    const d = bhEffektiv(data, path, { kind: 'user', id: member.userId });
    if (d) kallor.push({ via: 'user', name: member.name, ...d });
  }
  for (const r of member.matchedRoles || []) {
    const e = bhEffektiv(data, path, { kind: 'role', id: r.id });
    if (e) kallor.push({ via: 'role', name: r.name, ...e });
  }
  if (member.companyId != null) {
    const c = data.companies.find(x => x.id === member.companyId);
    const e = c && bhEffektiv(data, path, { kind: 'company', id: member.companyId });
    if (e) kallor.push({ via: 'company', name: c.name, ...e });
  }
  return kallor;
}

// Projektadministratörer har Administratör på alla mappar oavsett vad som är satt.
function bhEffektivForMedlem(data, path, member) {
  if (member.isProjectAdmin) {
    const s = { level: 'A', via: 'projectAdmin', name: 'Projektadministratör', source: 'direct' };
    return { effective: s, sources: [s] };
  }
  const sources = bhKallorForMedlem(data, path, member);
  return { effective: bhHogsta(sources), sources };
}

function bhBaslinje(data, path, member) {
  if (member.isProjectAdmin) return { level: 'A', via: 'projectAdmin', source: 'direct' };
  return bhHogsta(bhKallorForMedlem(data, path, member, false));
}

// Nivån som ska visas i trädet för den valda principalen.
function bhNivaFor(data, path, vald) {
  if (!vald) return null;
  if (vald.kind === 'member') {
    const e = bhEffektivForMedlem(data, path, vald.member).effective;
    return e ? { level: e.level, source: e.source || 'direct', via: e.via, inheritedFrom: e.inheritedFrom } : null;
  }
  const e = bhEffektiv(data, path, vald);
  return e ? { ...e, via: vald.kind === 'everyone' ? 'everyone' : vald.kind } : null;
}

// Alla principaler med åtkomst till en mapp, för mappdetaljen.
function bhAtkomstTillMapp(data, path) {
  const res = { everyone: bhEffektiv(data, path, { kind: 'everyone' }), users: [], roles: [], companies: [] };
  for (const [lista, kind, ut] of [[data.users, 'user', res.users], [data.roles, 'role', res.roles], [data.companies, 'company', res.companies]]) {
    for (const e of lista) {
      const p = bhEffektiv(data, path, { kind, id: e.id });
      if (p) ut.push({ ...e, ...p });
    }
    ut.sort((a, b) => bhRank(b.level) - bhRank(a.level) || bhSv(a, b));
  }
  return res;
}

// ── Audit: direkta behörigheter som avviker från baslinjen ────────────────────

function bhAudit(data, member) {
  const tom = { findings: [], summary: { upward: 0, soloDirect: 0, downward: 0 } };
  if (!member || member.userId == null) return tom;

  const fynd = [];
  for (const path of data.folders.keys()) {
    const direkt = bhEffektiv(data, path, { kind: 'user', id: member.userId });
    if (!direkt) continue;
    const bas = bhBaslinje(data, path, member);
    const dr  = bhRank(direkt.level) ?? 0;
    const br  = bas ? (bhRank(bas.level) ?? 0) : 0;
    if (bas && direkt.level === bas.level) continue;

    let kind, desc;
    if (!bas)         { kind = 'soloDirect'; desc = 'Endast åtkomst via direkt behörighet (saknar roll/företag-källa)'; }
    else if (dr > br) { kind = 'upward';     desc = `Direkt behörighet höjer åtkomsten (${bas.level} → ${direkt.level})`; }
    else              { kind = 'downward';   desc = `Direkt behörighet sänker åtkomsten (${bas.level} → ${direkt.level})`; }

    fynd.push({
      path, kind, desc,
      directLevel:         direkt.level,
      directSource:        direkt.source,
      directInheritedFrom: direkt.inheritedFrom,
      baselineLevel:       bas?.level || null,
      baselineVia:         bas?.via   || null,
      baselineSourceName:  bas?.name  || null,
    });
  }

  // Undermappar som bara ärver samma avvikelse från en förälder säger inget
  // nytt, så bara den översta mappen i varje sådan gren behålls.
  fynd.sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  const sedda = new Set();
  const kvar  = [];
  for (const f of fynd) {
    const parts = f.path.split('/');
    const nyckel = p => `${p}|${f.kind}|${f.directLevel}|${f.baselineLevel}`;
    let redundant = false;
    for (let i = parts.length - 1; i > 0 && !redundant; i--) redundant = sedda.has(nyckel(parts.slice(0, i).join('/')));
    if (!redundant) { kvar.push(f); sedda.add(nyckel(f.path)); }
  }

  const ordning = { upward: 0, soloDirect: 1, downward: 2 };
  kvar.sort((a, b) => ordning[a.kind] - ordning[b.kind] || a.path.localeCompare(b.path, 'sv', { numeric: true }));
  const summary = { upward: 0, soloDirect: 0, downward: 0 };
  for (const f of kvar) summary[f.kind]++;
  return { findings: kvar, summary };
}

// ── Jämför två medlemmar ──────────────────────────────────────────────────────

function bhJamfor(data, a, b) {
  const rows    = [];
  const summary = { onlyA: 0, onlyB: 0, different: 0, same: 0 };
  if (!a || !b) return { rows, summary };
  for (const path of data.folders.keys()) {
    const ea = bhEffektivForMedlem(data, path, a).effective;
    const eb = bhEffektivForMedlem(data, path, b).effective;
    if (!ea && !eb) continue;
    const kind = ea && !eb ? 'onlyA' : !ea && eb ? 'onlyB' : ea.level === eb.level ? 'same' : 'different';
    summary[kind]++;
    if (kind !== 'same') rows.push({ path, kind, a: ea, b: eb });
  }
  return { rows, summary };
}

// ── Export ────────────────────────────────────────────────────────────────────

function bhExportBladdraMd(data, rader, vald) {
  const ut = [`# Behörighetsöversikt — ${data.meta.projectName}`, ''];
  if (vald) {
    ut.push(`**Vald principal:** ${vald.name}`);
    const m = vald.member;
    if (m?.company)              ut.push(`**Företag:** ${m.company}`);
    if (m?.matchedRoles?.length) ut.push(`**Roller:** ${m.matchedRoles.map(r => r.name).join(', ')}`);
    if (m?.isProjectAdmin)       ut.push('**Projektadministratör:** Ja');
    ut.push('');
  }
  ut.push(`*Exporterad ${new Date().toLocaleString('sv-SE')} · ${rader.length} mappar · källa: ${data.meta.kalla}*`, '');
  for (const r of rader) {
    let rad = `${'  '.repeat(r.depth)}- 📁 **${r.name}**`;
    if (r.perm) {
      rad += ` — \`${r.perm.level}\` ${BH_PERM[r.perm.level]?.label || ''}`;
      if (r.perm.source === 'inherited') rad += ' *(ärvd)*';
      if (r.perm.via && r.perm.via !== 'user' && BH_VIA[r.perm.via]) rad += ` _${BH_VIA[r.perm.via].toLowerCase()}_`;
    }
    ut.push(rad);
  }
  return ut.join('\n');
}

function bhExportBladdraXlsx(data, rader, vald) {
  const aoa = [['Sökväg', 'Mappnamn', 'Djup', 'Nivå', 'Nivå-beskrivning', 'Källa', 'Ärvd från']];
  for (const r of rader) {
    aoa.push([
      r.path, r.name, r.depth,
      r.perm?.level || '',
      r.perm ? BH_PERM[r.perm.level]?.label || '' : '',
      r.perm?.via ? BH_VIA[r.perm.via] || r.perm.via : '',
      r.perm?.source === 'inherited' ? r.perm.inheritedFrom || '' : '',
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 60 }, { wch: 25 }, { wch: 6 }, { wch: 8 }, { wch: 20 }, { wch: 22 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, bhBladnamn(vald ? vald.name : 'Behörigheter'));
  return wb;
}

function bhExportJamforMd(data, a, b, diff) {
  const ut = [`# Jämförelse — ${a.name} vs ${b.name}`, ''];
  for (const m of [a, b]) ut.push(`*${m.name}* (${m.company || '?'}) — ${(m.matchedRoles || []).map(r => r.name).join(', ')}`);
  const s = diff.summary;
  ut.push('', `Skillnader: ${s.onlyA + s.onlyB + s.different} av ${s.same + s.onlyA + s.onlyB + s.different} mappar`, '');
  for (const [kind, titel] of [['onlyA', `Endast ${a.name}`], ['onlyB', `Endast ${b.name}`], ['different', 'Olika nivå']]) {
    const rader = diff.rows.filter(r => r.kind === kind);
    if (!rader.length) continue;
    ut.push(`## ${titel} (${rader.length})`, '');
    for (const r of rader) ut.push(`- ${r.path} — ${a.name}: \`${r.a?.level || '–'}\` · ${b.name}: \`${r.b?.level || '–'}\``);
    ut.push('');
  }
  return ut.join('\n');
}

function bhExportJamforXlsx(data, a, b, diff) {
  const typ = k => k === 'onlyA' ? `Endast ${a.name}` : k === 'onlyB' ? `Endast ${b.name}` : 'Olika nivå';
  const aoa = [['Sökväg', 'Typ', a.name, b.name], ...diff.rows.map(r => [r.path, typ(r.kind), r.a?.level || '', r.b?.level || ''])];
  const ws  = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 60 }, { wch: 25 }, { wch: 18 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Jämförelse');
  return wb;
}

const BH_AUDIT_TYP = {
  upward:     { ikon: '🔺', titel: 'Uppåt-overrides (extra åtkomst)',                   etikett: 'Uppåt-override' },
  soloDirect: { ikon: '🟡', titel: 'Endast direkt (saknar roll/företag-källa)',          etikett: 'Endast direkt'  },
  downward:   { ikon: '🔻', titel: 'Nedåt-overrides (avsiktlig begränsning?)',          etikett: 'Nedåt-override' },
};

function bhExportAuditMd(data, m, audit) {
  const ut = [`# Audit — ${m.name}`, ''];
  if (m.company)              ut.push(`**Företag:** ${m.company}`);
  if (m.matchedRoles?.length) ut.push(`**Roller:** ${m.matchedRoles.map(r => r.name).join(', ')}`);
  const s = audit.summary;
  ut.push('', `**Sammanfattning:** ${s.upward} uppåt-overrides, ${s.soloDirect} endast direkta, ${s.downward} nedåt-overrides`, '');
  for (const kind of ['upward', 'soloDirect', 'downward']) {
    const rader = audit.findings.filter(f => f.kind === kind);
    if (!rader.length) continue;
    ut.push(`## ${BH_AUDIT_TYP[kind].ikon} ${BH_AUDIT_TYP[kind].titel} (${rader.length})`, '');
    for (const f of rader) {
      const bas = f.baselineLevel ? `\`${f.baselineLevel}\` via ${f.baselineSourceName || f.baselineVia}` : 'ingen baslinje';
      ut.push(`- ${f.path}`, `  - Direkt: \`${f.directLevel}\`${f.directSource === 'inherited' ? ' (ärvd)' : ''} · Baslinje: ${bas}`);
    }
    ut.push('');
  }
  return ut.join('\n');
}

function bhExportAuditXlsx(data, m, audit) {
  const aoa = [['Sökväg', 'Typ', 'Direkt nivå', 'Direkt källa', 'Baslinje nivå', 'Baslinje källa', 'Beskrivning']];
  for (const f of audit.findings) {
    aoa.push([
      f.path, BH_AUDIT_TYP[f.kind].etikett, f.directLevel,
      f.directSource === 'inherited' ? `Ärvd från ${f.directInheritedFrom}` : 'Direkt',
      f.baselineLevel || '', f.baselineSourceName || '', f.desc,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 60 }, { wch: 18 }, { wch: 12 }, { wch: 28 }, { wch: 14 }, { wch: 30 }, { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Audit');
  return wb;
}

function bhBladnamn(s) {
  return String(s).replace(/[\\/?*[\]:]/g, '_').slice(0, 28) || 'Blad';
}

function bhLaddaNer(innehall, filnamn, mime) {
  const blob = innehall instanceof Blob ? innehall : new Blob([innehall], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filnamn;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
