'use strict';
const $ = (s) => document.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let D = null;
let status = { running: false, phase: '', generation: 0 };
let shownGeneration = -1;
const ui = { tabs: {}, filter: {}, open: new Set() };

const DASH = '<span class="dash">—</span>';
const num = (n, d = 0) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
function sizeParts(b) {
  if (b == null) return null;
  if (b >= 1024 ** 4) return [num(b / 1024 ** 4, 2), 'TB'];
  if (b >= 1024 ** 3) return [num(b / 1024 ** 3, 1), 'GB'];
  return [num(b / 1024 ** 2, 0), 'MB'];
}
function size(b) { const p = sizeParts(b); return p ? `${p[0]}<span class="unit">${p[1]}</span>` : DASH; }
const sizeText = (b) => { const p = sizeParts(b); return p ? `${p[0]} ${p[1]}` : '—'; };
const when = (d) => new Date(d).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const day = (d) => (d ? new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : DASH);
function recent(ts) {
  if (!ts) return DASH;
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'Oggi';
  if (days === 1) return 'Ieri';
  if (days < 30) return `${days} giorni fa`;
  return day(ts);
}
const CAT_NAME = { abbonamento: 'Abbonamento', modello: 'Modello', motore: 'Motore', agente: 'Agente o app', skill: 'Skill', plugin: 'Plugin', mcp: 'MCP o connettore', strumento: 'Strumento', libreria: 'Libreria', ambiente: 'Ambiente Python', programma: 'Programma' };
const CAT_ROUTE = { abbonamento: 'abbonamenti', modello: 'modelli', motore: 'motori', agente: 'agenti', skill: 'skill', plugin: 'plugin', mcp: 'mcp', strumento: 'strumenti', libreria: 'motori', ambiente: 'motori', programma: 'strumenti' };

function aiClass(a) {
  if (/claude/i.test(a)) return 'claude';
  if (/codex|openai/i.test(a)) return 'codex';
  if (/antigravity|gemini/i.test(a)) return 'google';
  if (/vs code/i.test(a)) return 'vscode';
  if (/comfy/i.test(a)) return 'comfy';
  return '';
}
const chips = (list) => (list && list.length ? `<div class="chips">${list.map((a) => `<span class="chip ${aiClass(a)}">${esc(a)}</span>`).join('')}</div>` : DASH);
function pill(st) {
  const m = { 'in-funzione': ['ok', 'In funzione'], dichiarato: ['', 'Scritto a mano'], indicato: ['', 'Indicato da te'], citato: ['warn', 'Non trovato'], 'da-autorizzare': ['warn', 'Da autorizzare'], disattivato: ['', 'Disattivato'], assente: ['', 'Non installato'], 'piano-ignoto': ['', 'Piano non rilevato'], 'senza-piano': ['', 'Senza abbonamento'] }[st];
  return m ? `<span class="pill ${m[0]}">${m[1]}</span>` : '';
}
const items = (cat) => D.items.filter((i) => i.cat === cat);

// ---------- Barra laterale ----------
const NAV = [
  ['panoramica', 'Panoramica'], null, ['abbonamenti', 'Abbonamenti'], ['modelli', 'Modelli locali'], ['motori', 'Motori AI'], ['agenti', 'Agenti e app'],
  'Estensioni', ['skill', 'Skill'], ['plugin', 'Plugin'], ['mcp', 'MCP e connettori'],
  'Il PC', ['strumenti', 'Linguaggi e strumenti'], ['progetti', 'Progetti'], ['hardware', 'Hardware'],
];
function renderNav(route) {
  const html = NAV.map((n) => {
    if (n === null) return '';
    if (typeof n === 'string') return `<div class="grp">${n}</div>`;
    const badge = n[0] === 'mcp' && D ? D.items.filter((i) => i.cat === 'mcp' && i.status === 'da-autorizzare').length : 0;
    return `<a href="#/${n[0]}" ${route === n[0] ? 'aria-current="page"' : ''}><span>${n[1]}</span>${badge ? `<span class="badge" title="Da autorizzare">${badge}</span>` : ''}</a>`;
  }).join('');
  $('#nav').innerHTML = html;
  if (D?.machine) $('#scope').textContent = D.machine.gpus?.[0]?.name?.replace('NVIDIA GeForce ', '') || D.machine.computer || 'Questo PC';
}

// ---------- Titolo ----------
function stamp() {
  if (status.running) return `<div class="stamp">${esc(status.phase || 'Scansione')}…</div>`;
  if (status.error) return `<div class="stamp err">Scansione non riuscita.</div>`;
  return D ? `<div class="stamp">Aggiornato alle ${new Date(D.generatedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}<br>${num(D.walk?.files || 0)} file controllati in ${Math.max(1, Math.round(D.durationMs / 1000))} s</div>` : '';
}
const refreshBtn = () => `<button class="btn btn-primary" data-act="scan" ${status.running ? 'disabled' : ''}>${status.running ? 'Scansione…' : 'Aggiorna'}</button>`;
const titleRow = (title, lede) => `<div class="title-row"><div><h1>${esc(title)}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div><div class="title-actions" id="title-actions">${stamp()}${refreshBtn()}</div></div>`;

// ---------- Panoramica ----------
function overview() {
  const t = D.totals;
  const parts = t.kinds.slice().sort((a, b) => b.size - a.size);
  const main = parts.slice(0, 5);
  const rest = parts.slice(5);
  const segs = [...main, ...(rest.length ? [{ kind: `Altri (${rest.map((r) => r.kind.toLowerCase()).join(', ')})`, short: 'Altri', size: rest.reduce((s, r) => s + r.size, 0), count: rest.reduce((s, r) => s + r.count, 0) }] : [])];
  const col = ['var(--k1)', 'var(--k2)', 'var(--k3)', 'var(--k4)', 'var(--k5)', 'var(--k6)'];
  const models = items('modello').slice(0, 6);
  const gpu = D.machine.gpus?.[0];
  const running = items('motore').filter((e) => e.status === 'in-funzione');
  const ch = D.changes.slice(0, 5);
  const sign = { aggiunto: ['+', 'add'], rimosso: ['−', 'del'], aggiornato: ['↑', 'upd'] };
  const subs = items('abbonamento');
  const countBy = (list) => { const m = {}; for (const i of list) for (const a of i.ai || []) m[a] = (m[a] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5); };
  const langs = items('strumento').filter((s) => s.group === 'Linguaggi' && s.status !== 'assente').slice(0, 5);
  const kpi = (route, label, value, unit) => `<a class="kpi" href="#/${route}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div></a>`;
  const s = sizeParts(t.modelBytes);
  return `
  ${titleRow('Inventario', `${s[0]} ${s[1]} di modelli AI, in ${t.families} famiglie sparse in ${t.places} posti diversi del PC.`)}
  <div class="kpis">
    ${kpi('modelli', 'Spazio modelli', s[0], s[1])}${kpi('modelli', 'Modelli locali', num(t.families))}${kpi('motori', 'Motori AI', num(t.engines))}${kpi('agenti', 'Agenti e app', num(t.agents))}${kpi('skill', 'Skill', num(t.skills))}${kpi('plugin', 'Plugin', num(t.plugins))}${kpi('strumenti', 'Linguaggi e strumenti', num(t.tools))}
  </div>
  <div class="grid-main">
    <section class="panel">
      <div class="panel-head"><h2>Dove stanno i modelli</h2><a class="link" href="#/modelli">Vedi tutti</a></div>
      <div class="bar" role="img" aria-label="Spazio occupato per tipo di modello">${segs.map((p, i) => `<i style="flex:${Math.max(p.size, 1)} 1 0;background:${col[i]}" title="${esc(p.kind)}: ${sizeText(p.size)}"></i>`).join('')}</div>
      <div class="split">
        <div>${segs.map((p, i) => `<div class="kv"><span title="${esc(p.kind)}"><i class="dot" style="background:${col[i]}"></i>${esc(p.short || p.kind)}</span><span class="num">${size(p.size)}</span></div>`).join('')}</div>
        <div>${models.map((m) => `<a class="fam" href="#/modelli"><b>${esc(m.name)}</b><small>${esc(m.places.join(' · '))}</small><span class="num">${size(m.size)}</span></a>`).join('')}</div>
      </div>
    </section>
    <div class="stack">
      <section class="panel">
        <div class="panel-head"><h2>Novità</h2>${D.changes.length ? '' : ''}</div>
        ${ch.length ? ch.map((c) => `<div class="chg"><span class="sign ${sign[c.type][1]}">${sign[c.type][0]}</span><span title="${esc(CAT_NAME[c.cat] || '')}">${esc(c.name)}${c.type === 'aggiornato' ? ` <span class="muted">${esc(c.from)} → ${esc(c.to)}</span>` : ''}</span></div>`).join('') : `<p class="empty">Nessuna modifica dall'ultima scansione.</p>`}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>In funzione ora</h2></div>
        ${gpu && gpu.usedMiB != null ? `<div class="kv"><span>Memoria video</span><span class="num">${num(gpu.usedMiB / 1024, 1)} <span class="muted">di ${num(gpu.vramMiB / 1024, 0)} GB</span></span></div><div class="meter"><i style="width:${Math.min(100, (gpu.usedMiB / gpu.vramMiB) * 100)}%"></i></div>` : ''}
        ${running.length ? `<p class="small" style="margin-top:6px">${running.map((r) => esc(r.name)).join(', ')}</p>` : '<p class="small muted" style="margin-top:6px">Nessun motore AI attivo.</p>'}
      </section>
    </div>
  </div>
  <div class="grid-four">
    <section class="panel"><div class="panel-head"><h2>Abbonamenti</h2><a class="link" href="#/abbonamenti">Vedi tutti</a></div>${subs.map((x) => `<div class="kv"><span>${esc(x.name)}</span>${x.status === 'rilevato' ? '' : pill(x.status)}</div>`).join('')}</section>
    <section class="panel"><div class="panel-head"><h2>Skill per AI</h2><a class="link" href="#/skill">Vedi tutte</a></div>${countBy(items('skill').filter((x) => x.status !== 'citato')).map(([a, n]) => `<div class="kv"><span>${esc(a)}</span><span class="num">${num(n)}</span></div>`).join('')}</section>
    <section class="panel"><div class="panel-head"><h2>Plugin per AI</h2><a class="link" href="#/plugin">Vedi tutti</a></div>${countBy(items('plugin')).map(([a, n]) => `<div class="kv"><span>${esc(a)}</span><span class="num">${num(n)}</span></div>`).join('')}</section>
    <section class="panel"><div class="panel-head"><h2>Linguaggi</h2><a class="link" href="#/strumenti">Vedi tutti</a></div>${langs.map((l) => `<div class="kv"><span>${esc(l.name)}</span><span class="num mono">${esc(l.version)}</span></div>`).join('')}</section>
  </div>`;
}

// ---------- Elenco generico ----------
function detailHtml(i) {
  const locs = (i.locations && i.locations.length) ? i.locations : (i.path ? [{ label: '', path: i.path }] : []);
  const extra = [];
  if (i.description && i.description !== '-') extra.push(`<p>${esc(i.description)}</p>`);
  if (i.note) extra.push(`<p class="muted">${esc(i.note)}</p>`);
  if (i.quants?.length) extra.push(`<p class="muted">Varianti: ${esc(i.quants.join(', '))}</p>`);
  if (i.libs?.length) extra.push(`<p class="muted">Librerie AI: ${esc(i.libs.join(', '))}</p>`);
  if (i.origins?.length) extra.push(`<p class="muted">Provenienza: ${esc(i.origins.join(', '))}</p>`);
  if (i.status === 'citato' && i.projects) extra.push(`<p class="muted">Citato nelle memorie di: ${esc(i.projects.join(', '))}. Non risulta sul disco.</p>`);
  const rows = locs.map((l) => `<div class="loc"><div>${l.label ? `<div>${esc(l.label)}${l.size ? ` <span class="muted">· ${sizeText(l.size)}</span>` : ''}</div>` : ''}<div class="loc-path">${esc(l.path)}</div></div><div class="loc-actions"><button class="btn btn-ghost" data-copy="${esc(l.path)}">Copia percorso</button><button class="btn btn-ghost" data-open="${esc(l.path)}">Apri cartella</button></div></div>`).join('');
  return extra.join('') + rows || '<p class="muted">Nessun percorso sul PC: vive nel tuo account.</p>';
}
function nameCell(i, sub) {
  const has = i.path || i.locations?.length || i.description || i.libs?.length || i.note || i.origins?.length;
  const name = has ? `<button class="name-btn" data-toggle="${esc(i.id)}" aria-expanded="${ui.open.has(i.id)}">${esc(i.name)}</button>` : `<span class="name-plain">${esc(i.name)}</span>`;
  return name + (sub ? `<div class="desc">${sub}</div>` : '');
}
function listView(cfg) {
  const key = cfg.key;
  const tabs = cfg.tabs || [];
  if (tabs.length && !tabs.some((t) => t.id === ui.tabs[key])) ui.tabs[key] = tabs[0].id;
  const tab = tabs.find((t) => t.id === ui.tabs[key]);
  const base = tab ? cfg.rows.filter(tab.test) : cfg.rows;
  const cols = tab?.cols || cfg.cols;
  const tabsHtml = tabs.length > 1 ? `<div class="tabs" role="tablist">${tabs.map((t) => `<button class="tab" role="tab" aria-selected="${t.id === ui.tabs[key]}" data-tab="${key}|${esc(t.id)}">${esc(t.label)}<small>${num(cfg.rows.filter(t.test).length)}</small></button>`).join('')}</div>` : '';
  return `${titleRow(cfg.title, cfg.lede)}${cfg.before || ''}${tabsHtml}
  <div class="toolbar"><input class="filter" data-filter="${key}" type="search" placeholder="Filtra questo elenco" aria-label="Filtra questo elenco" value="${esc(ui.filter[key] || '')}"><span class="count" id="count"></span></div>
  <div id="table">${tableHtml(cols, filterRows(base, ui.filter[key]), key, cfg.noun)}</div>`;
}
function filterRows(rows, q) {
  if (!q) return rows;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => { const hay = [r.name, r.group, r.version, r.description, r.path, ...(r.ai || []), ...(r.places || []), ...(r.origins || [])].join(' ').toLowerCase(); return terms.every((t) => hay.includes(t)); });
}
function tableHtml(cols, rows, key, noun) {
  setTimeout(() => { const c = $('#count'); if (c) c.textContent = `${num(rows.length)} ${noun || 'voci'}`; });
  if (!rows.length) return `<div class="empty-row">Nessuna voce corrisponde a questo filtro.</div>`;
  const head = `<thead><tr>${cols.map((c, n) => `<th class="${c.num ? 'num ' : ''}${c.phone === false ? 'phone-off' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead>`;
  const body = rows.map((r) => {
    const open = ui.open.has(r.id);
    return `<tr class="row">${cols.map((c) => `<td class="${c.num ? 'num ' : ''}${c.phone === false ? 'phone-off' : ''}">${c.cell(r)}</td>`).join('')}</tr>${open ? `<tr class="detail"><td colspan="${cols.length}"><div class="detail-box">${detailHtml(r)}</div></td></tr>` : ''}`;
  }).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}
const sub = (...p) => p.filter(Boolean).map(esc).join(' · ');
const ver = (r) => (r.version ? `<span class="mono">${esc(r.version)}</span>` : DASH);

// ---------- Sezioni ----------
const views = {
  panoramica: overview,
  abbonamenti() {
    const rows = items('abbonamento');
    return listView({ key: 'abbonamenti', title: 'Abbonamenti', noun: 'abbonamenti', lede: 'Gli LLM che usi da remoto. Claude e Codex si leggono dai file del PC, il piano Google lo indichi tu.', before: '<div class="section-actions"><button class="btn btn-ghost" data-act="google">Cambia piano Google</button></div>', rows, cols: [
      { h: 'Abbonamento', cell: (r) => nameCell(r, sub(r.group, r.description)) },
      { h: 'Modelli disponibili', cell: (r) => chips(r.models) },
      { h: 'Attivo dal', phone: false, cell: (r) => day(r.since) },
      { h: 'Origine', cell: (r) => pill(r.status) || '<span class="pill ok">Rilevato</span>' },
    ] });
  },
  modelli() {
    const rows = [...items('modello'), ...D.cited];
    const kinds = D.totals.kinds.map((k) => k.kind);
    const tabs = [{ id: 'tutti', label: 'Tutti', test: (r) => r.status !== 'citato' }, ...kinds.map((k) => ({ id: k, label: k, test: (r) => r.group === k && r.status !== 'citato' })), { id: 'citati', label: 'Citati, non trovati', test: (r) => r.status === 'citato' }];
    return listView({ key: 'modelli', title: 'Modelli locali', noun: 'famiglie', lede: `I file dei modelli trovati su tutti i dischi. I citati sono nomi presenti nelle memorie di Claude che sul disco non risultano.`, rows, tabs, cols: [
      { h: 'Modello', cell: (r) => nameCell(r, r.status === 'citato' ? sub('In: ' + r.places.join(', ')) : sub(r.quants?.length ? r.quants.slice(0, 4).join(', ') : '')) },
      { h: 'Tipo', phone: false, cell: (r) => esc(r.group) },
      { h: 'Dove', cell: (r) => (r.status === 'citato' ? pill('citato') : chips(r.places)) },
      { h: 'Peso', num: true, cell: (r) => size(r.size) },
    ] });
  },
  motori() {
    const engines = items('motore'), libs = items('libreria'), envs = items('ambiente');
    const rows = [...engines, ...libs, ...envs];
    const tabs = [
      { id: 'prog', label: 'Motori', test: (r) => r.cat === 'motore' },
      { id: 'lib', label: 'Librerie AI', test: (r) => r.cat === 'libreria', cols: [
        { h: 'Libreria', cell: (r) => nameCell(r) }, { h: 'Tipo', phone: false, cell: (r) => esc(r.group) }, { h: 'Versioni', cell: ver }, { h: 'Usata in', phone: false, cell: (r) => chips(r.places) },
      ] },
      { id: 'env', label: 'Ambienti Python', test: (r) => r.cat === 'ambiente', cols: [
        { h: 'Ambiente', cell: (r) => nameCell(r, sub(r.libs?.slice(0, 4).join(', '))) }, { h: 'Python', phone: false, cell: ver }, { h: 'Librerie AI', num: true, phone: false, cell: (r) => num(r.libs.length) }, { h: 'Peso', num: true, cell: (r) => size(r.size) },
      ] },
    ];
    return listView({ key: 'motori', title: 'Motori AI', noun: 'voci', lede: 'Quello che fa girare i modelli sul PC, compresi gli ambienti Python sparsi nei progetti.', rows, tabs, cols: [
      { h: 'Motore', cell: (r) => nameCell(r, sub(r.description)) },
      { h: 'Tipo', phone: false, cell: (r) => esc(r.group) },
      { h: 'Versione', cell: ver },
      { h: 'Stato', phone: false, cell: (r) => pill(r.status) || DASH },
      { h: 'Peso', num: true, phone: false, cell: (r) => size(r.size) },
    ] });
  },
  agenti() {
    const rows = items('agente');
    const groups = [...new Set(rows.map((r) => r.group))];
    return listView({ key: 'agenti', title: 'Agenti e app', noun: 'voci', lede: 'I programmi con cui parli con le AI, più le tracce di strumenti rimaste nella tua cartella utente.', rows, tabs: [{ id: 'tutti', label: 'Tutti', test: () => true }, ...groups.map((g) => ({ id: g, label: g, test: (r) => r.group === g }))], cols: [
      { h: 'Nome', cell: (r) => nameCell(r, sub(r.description)) },
      { h: 'Tipo', phone: false, cell: (r) => esc(r.group) },
      { h: 'Versione', cell: ver },
    ] });
  },
  skill() {
    const rows = items('skill');
    const ais = ['Claude Code', 'App Claude', 'Cartella .agents', 'Codex', 'Antigravity', 'Antigravity IDE'].filter((a) => rows.some((r) => r.ai.includes(a)));
    const tabs = [{ id: 'tutte', label: 'Tutte', test: (r) => r.status !== 'citato' }, ...ais.map((a) => ({ id: a, label: a, test: (r) => r.ai.includes(a) && r.status !== 'citato' })), { id: 'sparite', label: 'Non trovate', test: (r) => r.status === 'citato' }];
    return listView({ key: 'skill', title: 'Skill', noun: 'skill', lede: 'Tutte le skill presenti sul PC e a quale AI appartengono, comprese quelle dentro i plugin e nei singoli progetti.', rows, tabs, cols: [
      { h: 'Skill', cell: (r) => nameCell(r, esc(r.description && r.description !== '-' ? r.description : '')) },
      { h: 'Per quale AI', cell: (r) => chips(r.ai) },
      { h: 'Usi', num: true, phone: false, cell: (r) => (r.uses != null ? num(r.uses) : DASH) },
      { h: 'Ultimo uso', num: true, phone: false, cell: (r) => recent(r.lastUsed) },
    ] });
  },
  plugin() {
    const rows = items('plugin');
    const groups = [...new Set(rows.map((r) => r.group))];
    return listView({ key: 'plugin', title: 'Plugin', noun: 'plugin', lede: 'Plugin ed estensioni, divisi per l\'AI o il programma su cui sono installati.', rows, tabs: [{ id: 'tutti', label: 'Tutti', test: () => true }, ...groups.map((g) => ({ id: g, label: g, test: (r) => r.group === g }))], cols: [
      { h: 'Plugin', cell: (r) => nameCell(r, sub(r.description)) },
      { h: 'Per quale AI', cell: (r) => chips(r.ai) },
      { h: 'Fonte', phone: false, cell: (r) => esc(r.source) },
      { h: 'Versione', phone: false, cell: ver },
      { h: 'Stato', cell: (r) => pill(r.status) || DASH },
    ] });
  },
  mcp() {
    const rows = items('mcp');
    return listView({ key: 'mcp', title: 'MCP e connettori', noun: 'voci', lede: 'I servizi esterni collegati alle AI. Da questo elenco si leggono solo i nomi, mai chiavi o parametri.', rows, tabs: [{ id: 'tutti', label: 'Tutti', test: () => true }, { id: 'auth', label: 'Da autorizzare', test: (r) => r.status === 'da-autorizzare' }], cols: [
      { h: 'Nome', cell: (r) => `<span class="name-plain">${esc(r.name)}</span>` },
      { h: 'Per quale AI', cell: (r) => chips(r.ai) },
      { h: 'Tipo', phone: false, cell: (r) => esc(r.kinds.join(', ')) },
      { h: 'Stato', cell: (r) => pill(r.status) || DASH },
    ] });
  },
  strumenti() {
    const tools = items('strumento'), progs = items('programma');
    const rows = [...tools, ...progs];
    const groups = [...new Set(tools.map((r) => r.group))];
    const tabs = [...groups.map((g) => ({ id: g, label: g, test: (r) => r.cat === 'strumento' && r.group === g })), { id: 'tutti', label: 'Tutti i programmi', test: (r) => r.cat === 'programma', cols: [
      { h: 'Programma', cell: (r) => nameCell(r, sub(r.group)) }, { h: 'Versione', cell: ver }, { h: 'Peso', num: true, phone: false, cell: (r) => size(r.size) },
    ] }];
    return listView({ key: 'strumenti', title: 'Linguaggi e strumenti', noun: 'voci', lede: 'Versioni lette dai programmi stessi. Se un linguaggio non è installato, resta in elenco e lo dice.', rows, tabs, cols: [
      { h: 'Nome', cell: (r) => nameCell(r, r.note ? esc(r.note) : '') },
      { h: 'Versione', cell: (r) => (r.status === 'assente' ? pill('assente') : ver(r)) },
      { h: 'Percorso', phone: false, cell: (r) => (r.path ? `<span class="loc-path">${esc(r.path)}</span>` : DASH) },
    ] });
  },
  progetti() {
    const rows = D.projects.map((p) => ({ ...p, id: `progetto:${p.name}`, description: '', locations: p.path ? [{ label: '', path: p.path }] : [] }));
    return listView({ key: 'progetti', title: 'Progetti', noun: 'progetti', lede: 'Cosa citano le memorie di Claude di ogni progetto, incrociato con quello che c\'è sul disco.', rows, cols: [
      { h: 'Progetto', cell: (r) => nameCell(r) },
      { h: 'AI citate e presenti', cell: (r) => chips(r.found) },
      { h: 'Citate, non trovate', phone: false, cell: (r) => (r.notFound.length ? `<div class="chips">${r.notFound.map((n) => `<span class="pill warn">${esc(n)}</span>`).join('')}</div>` : DASH) },
      { h: 'Memorie', num: true, phone: false, cell: (r) => num(r.memories) },
    ] });
  },
  hardware() {
    const m = D.machine;
    const kv = (k, v) => `<div class="kv"><span class="muted">${k}</span><span>${v}</span></div>`;
    return `${titleRow('Hardware', `Il computer su cui gira tutto: ${esc(m.computer || 'questo PC')}.`)}
    <div class="hw">
      <section class="panel"><div class="panel-head"><h2>Macchina</h2></div>${kv('Processore', esc(m.cpu?.trim()))}${kv('Core e thread', `${num(m.cores)} / ${num(m.threads)}`)}${kv('Memoria RAM', `${num(m.ramGB)} GB`)}${kv('Sistema', esc(`${m.os} (build ${m.build})`))}${m.platform === 'darwin' ? '' : kv('WSL', m.wsl?.length ? esc(m.wsl.join(', ')) : 'Nessuna distribuzione')}</section>
      <section class="panel"><div class="panel-head"><h2>Scheda video</h2></div>${(m.gpus || []).map((g) => g.usedMiB == null ? `${kv('Modello', esc(g.name))}${kv('Memoria video', g.vramMiB ? `${num(g.vramMiB / 1024, 0)} GB` : 'Condivisa con il sistema')}${g.cores ? kv('Core grafici', num(g.cores)) : ''}` : `${kv('Modello', esc(g.name))}${kv('Memoria video', `${num(g.usedMiB / 1024, 1)} di ${num(g.vramMiB / 1024, 0)} GB`)}<div class="meter"><i style="width:${Math.min(100, (g.usedMiB / g.vramMiB) * 100)}%"></i></div>${kv('Utilizzo', `${num(g.util)}%`)}${kv('Driver', esc(g.driver))}${kv('CUDA', esc(m.cuda || '—'))}`).join('') || '<p class="empty">Nessuna scheda video rilevata.</p>'}</section>
      <section class="panel"><div class="panel-head"><h2>Dischi</h2></div>${m.disks.map((d) => `<div class="kv"><span>${esc(d.name)} ${esc(d.label || '')}</span><span class="num">${sizeText(d.size - d.free)} <span class="muted">di ${sizeText(d.size)}</span></span></div><div class="meter"><i style="width:${((d.size - d.free) / d.size) * 100}%"></i></div>`).join('')}</section>
      <section class="panel"><div class="panel-head"><h2>Ultima scansione</h2></div>${kv('File controllati', num(D.walk?.files || 0))}${kv('Cartelle controllate', num(D.walk?.dirs || 0))}${kv('Cartelle protette, saltate', num(D.walk?.denied || 0))}${kv('Dischi', esc(D.walk?.drives || '—'))}${kv('Porte AI in ascolto', m.ports?.length ? esc(m.ports.map((p) => `${p.port} (${p.process})`).join(', ')) : 'Nessuna')}</section>
    </div>`;
  },
  cerca() {
    const q = $('#q').value.trim();
    const all = [...D.items, ...D.cited.map((c) => ({ ...c }))];
    const rows = filterRows(all, q).slice(0, 200);
    return `${titleRow(`Risultati per “${q}”`, '')}<div class="toolbar"><span class="count" id="count"></span></div><div id="table">${tableHtml([
      { h: 'Nome', cell: (r) => nameCell(r, sub(r.description)) },
      { h: 'Sezione', cell: (r) => `<a class="link" href="#/${CAT_ROUTE[r.cat]}">${esc(CAT_NAME[r.cat])}</a>` },
      { h: 'Versione', phone: false, cell: ver },
      { h: 'Peso', num: true, phone: false, cell: (r) => size(r.size) },
    ], rows, 'cerca', 'risultati')}</div>`;
  },
};

// ---------- Rendering ----------
const route = () => (location.hash.replace(/^#\//, '') || 'panoramica').split('?')[0];
function loadingView() {
  return `<div class="title-row"><div><h1>Inventario</h1><p class="lede">Prima scansione del PC in corso: può richiedere qualche minuto.</p></div><div class="title-actions">${stamp()}</div></div><div class="skeleton"></div><div class="skeleton" style="height:320px"></div>`;
}
function render(keepScroll) {
  const r = route();
  renderNav(r);
  if (!D) { view.innerHTML = loadingView(); return; }
  const fn = views[r] || overview;
  const sheet = $('#sheet'), top = sheet.scrollTop;
  try { view.innerHTML = fn(); }
  catch (e) { console.error(e); view.innerHTML = `<div class="panel"><p class="err">Questa sezione non si è caricata.</p><button class="btn btn-ghost" data-act="reload" style="margin-top:8px">Riprova</button></div>`; }
  sheet.scrollTop = keepScroll ? top : 0;
  document.title = 'Inventario AI';
}
function updateTitleActions() {
  const a = $('#title-actions');
  if (a) a.innerHTML = stamp() + refreshBtn();
}

async function loadData() {
  const res = await fetch('/api/inventory');
  D = await res.json();
  shownGeneration = status.generation;
  render(true);
}
async function poll() {
  try {
    const s = await (await fetch('/api/ping')).json();
    const changed = s.generation !== status.generation;
    status = s;
    maybeAskGoogle();
    if (changed || (D === null && !s.running)) await loadData(); else updateTitleActions();
    if (!D && s.running) render(true);
  } catch { /* il server si riavvia con l'icona sul Desktop */ }
  setTimeout(poll, status.running ? 1200 : 15000);
}
async function startScan(force) {
  const res = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }) });
  status = await res.json();
  updateTitleActions();
}
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1600); }

// ---------- Domanda sul piano Google ----------
let googleAsked = false;
function maybeAskGoogle() {
  if (!status.askGoogle || googleAsked) return;
  googleAsked = true;
  openGooglePlan().catch(() => {});
}
async function openGooglePlan() {
  const info = await (await fetch('/api/piani-google')).json();
  const now = info.risposta || {};
  const opt = (value, name, price = '') => `<label class="opt"><input type="radio" name="plan" value="${esc(value)}" ${now.scelta === value ? 'checked' : ''}><span>${esc(name)}</span>${price ? `<span class="price">${esc(price)}</span>` : ''}</label>`;
  const d = $('#gplan');
  d.innerHTML = `<form id="gplan-form" novalidate>
    <h2 id="gplan-title">Hai un piano in abbonamento Google?</h2>
    <p class="dlg-lede">Vale per Antigravity, Gemini e le app AI di Google. Il computer non lo può sapere da solo, e la risposta resta qui.</p>
    <fieldset class="opts"><legend class="sr">Scegli il tuo piano Google</legend>
      ${opt('nessuno', 'No, nessun piano')}
      ${info.piani.map((p) => opt(p.id, p.nome, p.prezzo)).join('')}
      ${opt('altro', 'Altro piano, aziendale o personalizzato')}
    </fieldset>
    <div class="dlg-fields" id="gplan-altro" hidden>
      <label class="field"><span>Nome del piano</span><input id="gplan-nome" maxlength="80" autocomplete="off" value="${esc(now.scelta === 'altro' ? now.nome || '' : '')}"></label>
      <label class="field"><span>Costo, se vuoi indicarlo</span><input id="gplan-prezzo" maxlength="40" autocomplete="off" value="${esc(now.scelta === 'altro' ? now.prezzo || '' : '')}"></label>
    </div>
    <p class="dlg-note">Prezzi di listino in Italia, controllati ${esc(info.verificato)} sul sito di Google.</p>
    <div class="dlg-actions"><span class="err" id="gplan-err" role="alert"></span><button type="button" class="btn btn-ghost" data-act="google-close">Più tardi</button><button type="submit" class="btn btn-primary" id="gplan-save">Salva</button></div>
  </form>`;
  syncGooglePlan();
  if (!d.open) d.showModal();
}
function syncGooglePlan() {
  const choice = document.querySelector('#gplan input[name="plan"]:checked')?.value;
  const other = choice === 'altro';
  $('#gplan-altro').hidden = !other;
  $('#gplan-save').disabled = !choice || (other && !$('#gplan-nome').value.trim());
}
async function saveGooglePlan() {
  const scelta = document.querySelector('#gplan input[name="plan"]:checked')?.value;
  const body = { scelta, nome: $('#gplan-nome').value, prezzo: $('#gplan-prezzo').value };
  const res = await fetch('/api/piano-google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  if (!res?.ok) { $('#gplan-err').textContent = 'Salvataggio non riuscito, riprova.'; return; }
  status = await res.json();
  $('#gplan').close();
  toast('Piano salvato');
  updateTitleActions();
  setTimeout(poll, 400);
}
$('#gplan').addEventListener('change', syncGooglePlan);
$('#gplan').addEventListener('input', syncGooglePlan);
$('#gplan').addEventListener('submit', (e) => { e.preventDefault(); if (!$('#gplan-save').disabled) saveGooglePlan(); });

// ---------- Interazioni ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act],[data-toggle],[data-tab],[data-copy],[data-open]');
  if (!t) return;
  if (t.dataset.act === 'scan') { await startScan(true); setTimeout(poll, 400); }
  if (t.dataset.act === 'reload') loadData();
  if (t.dataset.act === 'google') openGooglePlan().catch(() => toast('Non riesco ad aprire la domanda'));
  if (t.dataset.act === 'google-close') $('#gplan').close();
  if (t.dataset.toggle) { const id = t.dataset.toggle; ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); render(true); document.querySelector(`[data-toggle="${CSS.escape(id)}"]`)?.focus(); }
  if (t.dataset.tab) { const [k, id] = t.dataset.tab.split('|'); ui.tabs[k] = id; render(true); }
  if (t.dataset.copy) { await navigator.clipboard.writeText(t.dataset.copy); toast('Percorso copiato'); }
  if (t.dataset.open) { const r = await fetch('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: t.dataset.open }) }); toast(r.ok ? 'Cartella aperta' : 'Questa cartella non esiste più'); }
});
document.addEventListener('input', (e) => {
  const f = e.target.dataset?.filter;
  if (f) {
    ui.filter[f] = e.target.value;
    const pos = e.target.selectionStart;
    render(true);
    const el = document.querySelector(`[data-filter="${f}"]`);
    if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  }
  if (e.target.id === 'q') {
    if (e.target.value.trim()) { if (route() !== 'cerca') location.hash = '#/cerca'; else render(false); }
    else if (route() === 'cerca') location.hash = '#/panoramica';
  }
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#q').focus(); $('#q').select(); }
});
window.addEventListener('hashchange', () => { $('#side').classList.remove('open'); $('#menu').setAttribute('aria-expanded', 'false'); render(false); });
$('#menu').addEventListener('click', () => { const o = $('#side').classList.toggle('open'); $('#menu').setAttribute('aria-expanded', String(o)); });

(async function start() {
  render();
  try { status = await (await fetch('/api/ping')).json(); maybeAskGoogle(); await loadData(); } catch {}
  await startScan(false).catch(() => {});
  setTimeout(poll, 800);
})();
