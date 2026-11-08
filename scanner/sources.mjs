import path from 'node:path';
import fs from 'node:fs';
import { googlePlan } from './google-plans.mjs';
import { HOME, LOCAL, ROAMING, WIN, MAC, readText, readJson, exists, isDir, listDir, subdirs, sh, whichCmd, run, pool, slug, norm, uniq, versionOf, compareVersions, isProjectPath } from './util.mjs';

const j = (...p) => path.join(...p);
const H = norm(HOME);

// ---------- Linguaggi e strumenti ----------
// [comando, nome mostrato, argomenti per la versione, gruppo, mostra anche se assente]
const TOOLS = [
  ['node', 'Node.js', '--version', 'Linguaggi', 1], ['python', 'Python', '--version', 'Linguaggi', 1], ['java', 'Java', '-version', 'Linguaggi', 1],
  ['go', 'Go', 'version', 'Linguaggi', 1], ['rustc', 'Rust', '--version', 'Linguaggi', 1], ['dotnet', '.NET', '--version', 'Linguaggi', 1],
  ['php', 'PHP', '--version', 'Linguaggi', 1], ['ruby', 'Ruby', '--version', 'Linguaggi', 1], ['deno', 'Deno', '--version', 'Linguaggi', 1],
  ['bun', 'Bun', '--version', 'Linguaggi', 1], ['perl', 'Perl', '--version', 'Linguaggi', 0], ['lua', 'Lua', '-v', 'Linguaggi', 0], ['tsc', 'TypeScript', '--version', 'Linguaggi', 0],
  ['npm', 'npm', '--version', 'Gestori di pacchetti', 1], ['pnpm', 'pnpm', '--version', 'Gestori di pacchetti', 0], ['yarn', 'Yarn', '--version', 'Gestori di pacchetti', 0],
  ['pip', 'pip', '--version', 'Gestori di pacchetti', 1], ['uv', 'uv', '--version', 'Gestori di pacchetti', 1], ['conda', 'Conda', '--version', 'Gestori di pacchetti', 0],
  ['cargo', 'Cargo', '--version', 'Gestori di pacchetti', 0], ['winget', 'winget', '--version', 'Gestori di pacchetti', 0], ['choco', 'Chocolatey', '--version', 'Gestori di pacchetti', 0], ['brew', 'Homebrew', '--version', 'Gestori di pacchetti', 0],
  ['gcc', 'GCC', '--version', 'Compilatori', 0], ['clang', 'Clang', '--version', 'Compilatori', 0], ['cmake', 'CMake', '--version', 'Compilatori', 0], ['ninja', 'Ninja', '--version', 'Compilatori', 0], ['make', 'Make', '--version', 'Compilatori', 0],
  ['git', 'Git', '--version', 'Sviluppo', 1], ['gh', 'GitHub CLI', '--version', 'Sviluppo', 1], ['git-lfs', 'Git LFS', '--version', 'Sviluppo', 0], ['docker', 'Docker', '--version', 'Sviluppo', 1], ['code', 'VS Code', '--version', 'Sviluppo', 0],
  ['vercel', 'Vercel CLI', '--version', 'Cloud', 0], ['supabase', 'Supabase CLI', '--version', 'Cloud', 0], ['wrangler', 'Wrangler', '--version', 'Cloud', 0], ['gcloud', 'Google Cloud CLI', '--version', 'Cloud', 0], ['aws', 'AWS CLI', '--version', 'Cloud', 0],
  ['ffmpeg', 'FFmpeg', '-version', 'Media', 1], ['yt-dlp', 'yt-dlp', '--version', 'Media', 0], ['magick', 'ImageMagick', '-version', 'Media', 0], ['tesseract', 'Tesseract', '--version', 'Media', 0], ['pdflatex', WIN ? 'MiKTeX (pdfLaTeX)' : 'pdfLaTeX', '--version', 'Media', 0], ['blender', 'Blender', '--version', 'Media', 0],
  ['sqlite3', 'SQLite', '--version', 'Dati', 0], ['psql', 'PostgreSQL', '--version', 'Dati', 0],
];
const MIKTEX = /MiKTeX\s+(\d[\d.]*)/;

// Su macOS python e pip si chiamano di solito python3 e pip3.
const MAC_ALIAS = { python: 'python3', pip: 'pip3' };
// Su un Mac senza gli strumenti Xcode questi comandi esistono, ma lanciarli apre una finestra di installazione.
const XCODE_STUBS = new Set(['git', 'gcc', 'clang', 'make', 'python3', 'pip3']);
let xcodeCheck;
const hasXcodeTools = () => (xcodeCheck ||= run('xcode-select', ['-p'], { timeout: 8000 }).then((r) => r.code === 0));

async function isMacStub(cmd, found) {
  if (!MAC || !found.startsWith('/usr/bin/')) return false;
  if (cmd === 'java') return (await run('/usr/libexec/java_home', [], { timeout: 8000 })).code !== 0;
  return XCODE_STUBS.has(cmd) && !(await hasXcodeTools());
}

async function tool([rawCmd, name, args, group, always]) {
  const cmd = MAC ? MAC_ALIAS[rawCmd] || rawCmd : rawCmd;
  const w = await sh(whichCmd(cmd), { timeout: 8000 });
  const found = w.code === 0 ? w.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  const real = found.filter((p) => !/WindowsApps\\python/i.test(p));
  if (!real.length || await isMacStub(cmd, real[0])) {
    if (!always) return null;
    return { id: `strumento:${slug(name)}`, cat: 'strumento', name, group, status: 'assente' };
  }
  const v = await sh(`${cmd} ${args}`, { timeout: 25000 });
  const text = `${v.out}\n${v.err}`;
  const version = cmd === 'pdflatex' && MIKTEX.test(text) ? text.match(MIKTEX)[1] : versionOf(text);
  const prefix = !WIN && cmd === 'python3' ? (await run(real[0], ['-c', 'import sys; print(sys.prefix)'], { timeout: 10000 })).out.trim() : undefined;
  return { id: `strumento:${slug(name)}`, cat: 'strumento', name, group, version, path: real[0], status: 'rilevato', prefix };
}

export async function collectTools() {
  const items = (await pool(TOOLS, 6, tool)).filter(Boolean);
  const extras = [];
  const dotnet = await sh('dotnet --list-runtimes', { timeout: 15000 });
  const runtimes = uniq(dotnet.out.split(/\r?\n/).map((l) => (l.match(/^\S+\s+(\d[\w.-]*)/) || [])[1]));
  const net = items.find((i) => i.name === '.NET');
  if (net && runtimes.length) { net.version = net.version && /^\d/.test(net.version) ? net.version : runtimes[runtimes.length - 1]; net.note = `Runtime presenti: ${runtimes.join(', ')}`; }
  const npm = await sh('npm ls -g --depth=0 --json', { timeout: 30000 });
  try {
    for (const [name, d] of Object.entries(JSON.parse(npm.out).dependencies || {})) {
      if (name === 'npm' || name === 'corepack') continue;
      extras.push({ id: `strumento:npm-${slug(name)}`, cat: 'strumento', name, group: 'Pacchetti globali npm', version: d.version, status: 'rilevato' });
    }
  } catch {}
  const uv = await run('uv', ['tool', 'list'], { timeout: 15000 });
  for (const m of uv.out.matchAll(/^(\S+) v(\S+)/gm)) extras.push({ id: `strumento:uv-${slug(m[1])}`, cat: 'strumento', name: m[1], group: 'Strumenti Python (uv)', version: m[2], status: 'rilevato' });
  return [...items, ...extras];
}

// ---------- Skill ----------
function frontmatter(p) {
  const t = readText(p, 400000) || '';
  const m = t.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const name = (m[1].match(/^name:\s*["']?([^\r\n"']+)/m) || [])[1];
  let d = m[1].match(/^description:\s*(?:[|>][-+]?\s*)?["']?([\s\S]*?)(?:\r?\n[a-zA-Z_-]+:|$)/m);
  d = d ? d[1].replace(/\s+/g, ' ').replace(/["']$/, '').trim() : '';
  return { name: name && name.trim(), description: d.slice(0, 260) };
}

export function skillOrigin(raw, installPaths, label) {
  const l = norm(raw);
  const rel = l.startsWith(H) ? l.slice(H.length) : l;
  const seg = (re) => (rel.match(re) || [])[1];
  if (/\\plugins\\marketplaces\\|\\\.tmp\\|\\vendor_imports\\|\\cache\\marketplaces\\|\\_template\\/.test(rel)) return null;
  if (rel.includes('\\microsoft vs code\\') || rel.includes('\\capcut\\') || rel.includes('\\appdata\\local\\temp\\')) return null;
  const claudeApp = rel.includes('\\claude-data\\') || rel.includes('\\application support\\claude\\');
  if (rel.startsWith('\\.claude\\skills\\synced\\')) return { ai: ['Claude Code', 'App Claude'], origin: 'Account Claude' };
  if (rel.startsWith('\\.claude\\skills\\')) return { ai: ['Claude Code'], origin: 'Personale' };
  if (rel.startsWith('\\.agents\\skills\\')) return { ai: ['Cartella .agents'], origin: 'Condivisa tra agenti' };
  if (rel.startsWith('\\.codex\\skills\\')) return { ai: ['Codex'], origin: rel.includes('\\.system\\') ? 'Integrata in Codex' : 'Personale' };
  if (rel.startsWith('\\.gemini\\antigravity\\skills\\')) return { ai: ['Antigravity'], origin: 'Personale' };
  if (rel.startsWith('\\.claude\\plugins\\cache\\')) {
    const inst = installPaths.find((p) => l.startsWith(p + '\\'));
    if (!inst || l.slice(inst.length).startsWith('\\.claude\\')) return null;
    return { ai: ['Claude Code'], origin: `Plugin ${seg(/\\cache\\[^\\]+\\([^\\]+)\\/)}`, plugin: seg(/\\cache\\[^\\]+\\([^\\]+)\\/) };
  }
  if (rel.startsWith('\\.claude\\plugins\\synced\\')) { const p = seg(/\\synced\\[^\\]+\\([^\\~]+)/); return { ai: ['Claude Code', 'App Claude'], origin: `Plugin ${p}`, plugin: p }; }
  if (rel.startsWith('\\.codex\\plugins\\cache\\')) { const c = seg(/\\cache\\[^\\]+\\([^\\]+)\\/); const p = c.startsWith('app-') ? 'App collegata' : c; return { ai: ['Codex'], origin: `Plugin ${p}`, plugin: p }; }
  if (claudeApp && rel.includes('\\skills-plugin\\')) return { ai: ['App Claude'], origin: 'Skill Anthropic (Cowork)' };
  if (claudeApp && rel.includes('\\rpm\\')) return { ai: ['App Claude'], origin: 'Plugin account' };
  if (rel.includes('\\antigravity ide\\user\\globalstorage\\')) return { ai: ['Antigravity IDE'], origin: `Estensione ${seg(/globalstorage\\([^\\]+)/)}` };
  if (rel.startsWith('\\.') || rel.startsWith('\\appdata\\') || rel.startsWith('\\library\\')) return null;
  const ai = rel.includes('\\.claude\\skills\\') ? 'Claude Code' : (rel.includes('\\.agents\\skills\\') || rel.includes('\\.agent\\skills\\')) ? 'Cartella .agents' : rel.includes('\\.codex\\skills\\') ? 'Codex' : null;
  if (!ai) return null;
  return { ai: [ai], origin: `Progetto: ${label(raw)}`, project: label(raw) };
}

export function buildSkills(deep, installPaths, label, usage, declared) {
  const map = new Map();
  for (const h of deep.filter((x) => x.k === 'skill')) {
    const o = skillOrigin(h.p, installPaths, label);
    if (!o) continue;
    const dir = path.dirname(h.p);
    const fm = frontmatter(h.p);
    const name = (fm.name || path.basename(dir)).trim();
    const k = name.toLowerCase();
    const e = map.get(k) || { id: `skill:${slug(name)}`, cat: 'skill', name, description: '', ai: [], origins: [], status: 'rilevato', locations: [], path: dir };
    e.ai = uniq([...e.ai, ...o.ai]);
    e.origins = uniq([...e.origins, o.origin]);
    if (fm.description && !e.description) e.description = fm.description;
    e.locations.push({ label: o.origin, path: dir });
    map.set(k, e);
  }
  for (const b of declared.skillIntegrate || []) {
    const k = b.toLowerCase();
    if (map.has(k)) continue;
    map.set(k, { id: `skill:${slug(b)}`, cat: 'skill', name: b, description: '', ai: ['Claude Code'], origins: ['Integrata in Claude Code'], status: 'dichiarato', locations: [] });
  }
  for (const [raw, u] of Object.entries(usage || {})) {
    const short = raw.includes(':') ? raw.split(':').pop() : raw;
    const e = map.get(raw.toLowerCase()) || map.get(short.toLowerCase());
    if (e) { e.uses = (e.uses || 0) + (u.usageCount || 0); e.lastUsed = Math.max(e.lastUsed || 0, u.lastUsedAt || 0); }
    else map.set(raw.toLowerCase(), { id: `skill:${slug(raw)}`, cat: 'skill', name: raw, description: '', ai: ['Claude Code'], origins: ['Usata in passato, non trovata sul disco'], status: 'citato', uses: u.usageCount || 0, lastUsed: u.lastUsedAt || 0, locations: [] });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

// ---------- Plugin ed estensioni ----------
function extensions(root, ai) {
  const best = new Map();
  for (const d of subdirs(root)) {
    const m = d.match(/^(.+?)-(\d+\.\d+[\w.]*)(?:-(?:universal|win32-x64|win32-arm64|darwin-x64|darwin-arm64))?$/);
    if (!m) continue;
    const prev = best.get(m[1]);
    if (!prev || compareVersions(m[2], prev.version) > 0) best.set(m[1], { version: m[2], dir: d });
  }
  return [...best].map(([name, v]) => ({ id: `plugin:${slug(ai)}-${slug(name)}`, cat: 'plugin', name, version: v.version, ai: [ai], group: ai, source: 'Estensione', status: 'rilevato', path: j(root, v.dir) }));
}

export function collectPlugins(claudeJson, usage, comfyPath) {
  const out = [];
  const installed = readJson(j(HOME, '.claude', 'plugins', 'installed_plugins.json'))?.plugins || {};
  const settings = readJson(j(HOME, '.claude', 'settings.json')) || {};
  const installPaths = [];
  for (const [key, list] of Object.entries(installed)) {
    const [name, market] = key.split('@');
    const e = list[list.length - 1] || {};
    if (e.installPath) installPaths.push(norm(e.installPath));
    const u = usage?.[key];
    const on = settings.enabledPlugins?.[key] !== false;
    out.push({ id: `plugin:claude-code-${slug(name)}`, cat: 'plugin', name, version: e.version?.length > 16 ? e.version.slice(0, 7) : e.version, ai: ['Claude Code'], group: 'Claude Code', source: market, status: on ? 'rilevato' : 'disattivato', path: e.installPath, updated: e.lastUpdated, uses: u?.usageCount });
  }
  const synced = j(HOME, '.claude', 'plugins', 'synced');
  for (const acc of subdirs(synced)) for (const p of subdirs(j(synced, acc))) {
    if (p.startsWith('.')) continue;
    const dir = j(synced, acc, p), name = p.replace(/~.*$/, '');
    const meta = readJson(j(dir, '.claude-plugin', 'plugin.json')) || {};
    out.push({ id: `plugin:account-${slug(name)}`, cat: 'plugin', name, version: meta.version, description: meta.description, ai: ['Claude Code', 'App Claude'], group: 'Account Claude', source: 'Account Claude', status: 'rilevato', path: dir });
  }
  const cd = j(LOCAL, WIN ? 'Claude-Data' : 'Claude');
  for (const inst of subdirs(cd)) {
    const rpm = j(cd, inst, 'rpm');
    if (!isDir(rpm)) continue;
    const walk = (d, depth) => {
      for (const n of subdirs(d)) {
        const p = j(d, n);
        if (n.startsWith('plugin_')) {
          const meta = readJson(j(p, '.claude-plugin', 'plugin.json')) || {};
          const name = meta.name || n;
          if (!out.some((x) => x.name === name && x.ai.includes('App Claude'))) out.push({ id: `plugin:app-${slug(name)}`, cat: 'plugin', name, version: meta.version, description: meta.description, ai: ['App Claude'], group: 'App Claude', source: 'Account Claude', status: 'rilevato', path: p });
        } else if (depth < 3) walk(p, depth + 1);
      }
    };
    walk(rpm, 0);
  }
  const codexCfg = readText(j(HOME, '.codex', 'config.toml')) || '';
  const cc = j(HOME, '.codex', 'plugins', 'cache');
  for (const market of subdirs(cc)) for (const p of subdirs(j(cc, market))) {
    const vs = subdirs(j(cc, market, p)).sort(compareVersions);
    const v = vs[vs.length - 1];
    const name = market === 'openai-curated-remote' && p.startsWith('app-') ? 'App collegata Codex' : p;
    const re = new RegExp(`\\[plugins\\."${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@[^"]+"\\][^\\[]*?enabled\\s*=\\s*false`);
    out.push({ id: `plugin:codex-${slug(p)}`, cat: 'plugin', name, version: v && v !== 'local' && v.length < 24 ? v : '', ai: ['Codex'], group: 'Codex', source: market, status: re.test(codexCfg) ? 'disattivato' : 'rilevato', path: j(cc, market, p, v || '') });
  }
  out.push(...extensions(j(HOME, '.antigravity', 'extensions'), 'Antigravity'), ...extensions(j(HOME, '.antigravity-ide', 'extensions'), 'Antigravity IDE'), ...extensions(j(HOME, '.vscode', 'extensions'), 'VS Code'));
  const nodes = comfyPath ? j(comfyPath, 'custom_nodes') : '';
  for (const n of nodes ? subdirs(nodes) : []) {
    if (n.startsWith('__') || n.startsWith('.')) continue;
    const py = readText(j(nodes, n, 'pyproject.toml')) || '';
    out.push({ id: `plugin:comfyui-${slug(n)}`, cat: 'plugin', name: n, version: (py.match(/^version\s*=\s*"([^"]+)"/m) || [])[1], ai: ['ComfyUI'], group: 'ComfyUI', source: 'Nodo personalizzato', status: 'rilevato', path: j(nodes, n) });
  }
  for (const v of obsidianVaults()) {
    const enabled = readJson(j(v, '.obsidian', 'community-plugins.json')) || [];
    for (const p of subdirs(j(v, '.obsidian', 'plugins'))) {
      const dir = j(v, '.obsidian', 'plugins', p);
      const meta = readJson(j(dir, 'manifest.json')) || {};
      out.push({ id: `plugin:obsidian-${slug(path.basename(v))}-${slug(p)}`, cat: 'plugin', name: meta.name || p, version: meta.version, description: meta.description, ai: ['Obsidian'], group: 'Obsidian', source: `Vault ${path.basename(v)}`, status: enabled.includes(meta.id || p) ? 'rilevato' : 'disattivato', path: dir });
    }
  }
  return { plugins: out, installPaths };
}

// ---------- MCP e connettori: solo i nomi, mai argomenti, variabili o chiavi ----------
const mcpNames = (o) => Object.keys(o?.mcpServers || o || {});

export function collectMcp(claudeJson, deep, label, installPaths, declared) {
  const map = new Map();
  const add = (name, ai, kind, status, where) => {
    const k = `${name.toLowerCase()}`;
    const e = map.get(k) || { id: `mcp:${slug(name)}`, cat: 'mcp', name, ai: [], kinds: [], status, where: [] };
    e.ai = uniq([...e.ai, ai]); e.kinds = uniq([...e.kinds, kind]); e.where = uniq([...e.where, where]);
    if (status === 'da-autorizzare') e.status = status;
    map.set(k, e);
  };
  for (const raw of claudeJson?.claudeAiMcpEverConnected || []) add(raw.replace(/^claude\.ai\s+/, '').replace('Higghsfield', 'Higgsfield'), 'Account Claude', 'Connettore', 'rilevato', 'claude.ai');
  for (const n of declared.connettoriAccount || []) add(n, 'Account Claude', 'Connettore', 'da-autorizzare', 'claude.ai');
  for (const n of mcpNames(claudeJson?.mcpServers)) add(n, 'Claude Code', 'Server MCP', 'rilevato', 'Globale');
  for (const [p, v] of Object.entries(claudeJson?.projects || {})) for (const n of mcpNames(v.mcpServers)) add(n, 'Claude Code', 'Server MCP', 'rilevato', label(p));
  const auth = readJson(j(HOME, '.claude', 'mcp-needs-auth-cache.json')) || {};
  for (const raw of Object.keys(auth)) { const m = raw.match(/^plugin:([^:]+):(.+)$/); if (m) add(m[2], 'Claude Code', `Plugin ${m[1]}`, 'da-autorizzare', `Plugin ${m[1]}`); }
  const agy = readJson(j(HOME, '.gemini', 'antigravity', 'mcp_config.json'));
  for (const n of mcpNames(agy)) add(n, 'Antigravity', 'Server MCP', 'rilevato', 'Globale');
  const toml = readText(j(HOME, '.codex', 'config.toml')) || '';
  for (const m of toml.matchAll(/^\[mcp_servers\.([^.\]]+)\]/gm)) add(m[1], 'Codex', 'Server MCP', 'rilevato', 'Globale');
  for (const h of deep.filter((x) => x.k === 'mcp')) {
    const l = norm(h.p);
    if (/\\plugins\\marketplaces\\|\\\.tmp\\|\\cache\\marketplaces\\/.test(l)) continue;
    const data = readJson(h.p);
    if (!data) continue;
    const names = mcpNames(data);
    if (l.endsWith('claude_desktop_config.json')) { for (const n of names) add(n, 'App Claude', 'Server MCP', 'rilevato', 'App Claude'); continue; }
    if (l.includes('\\.claude\\plugins\\cache\\')) { if (!installPaths.some((p) => l.startsWith(p + '\\'))) continue; const p = (l.match(/\\cache\\[^\\]+\\([^\\]+)\\/) || [])[1]; for (const n of names) add(n, 'Claude Code', `Plugin ${p}`, 'rilevato', `Plugin ${p}`); continue; }
    if (l.includes('\\.claude\\plugins\\synced\\')) { const p = (l.match(/\\synced\\[^\\]+\\([^\\~]+)/) || [])[1]; for (const n of names) add(n, 'Claude Code', `Plugin ${p}`, 'rilevato', `Plugin ${p}`); continue; }
    if (l.includes('\\.codex\\plugins\\cache\\')) { const p = (l.match(/\\cache\\[^\\]+\\([^\\]+)\\/) || [])[1]; for (const n of names) add(n, 'Codex', `Plugin ${p}`, 'rilevato', `Plugin ${p}`); continue; }
    if (l.includes('\\claude-data\\') || l.includes('\\application support\\claude\\')) { for (const n of names) add(n, 'App Claude', 'Plugin account', 'rilevato', 'Plugin account'); continue; }
    if (isProjectPath(l)) for (const n of names) add(n, 'Claude Code', 'Server MCP', 'rilevato', label(h.p));
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

// ---------- Ambienti Python e librerie AI ----------
const AI_PKG = {
  'faster-whisper': 'Trascrizione', 'openai-whisper': 'Trascrizione', 'whisperx': 'Trascrizione', 'ctranslate2': 'Trascrizione', 'sherpa-onnx': 'Trascrizione',
  'mlx': 'Base', 'mlx-lm': 'LLM', 'mlx-whisper': 'Trascrizione', 'torch': 'Base', 'torchaudio': 'Base', 'torchvision': 'Base', 'transformers': 'Base', 'diffusers': 'Base', 'accelerate': 'Base', 'peft': 'Base', 'bitsandbytes': 'Base', 'safetensors': 'Base', 'huggingface-hub': 'Base', 'onnxruntime': 'Base', 'onnxruntime-gpu': 'Base', 'sentence-transformers': 'Base',
  'chatterbox-tts': 'Voce', 'qwen-tts': 'Voce', 'kokoro': 'Voce', 'tts': 'Voce', 'coqui-tts': 'Voce', 'voxcpm': 'Voce',
  'llama-cpp-python': 'LLM', 'unsloth': 'LLM', 'vllm': 'LLM', 'langchain': 'LLM', 'openai': 'LLM', 'anthropic': 'LLM', 'google-genai': 'LLM', 'crawl4ai': 'LLM',
  'rembg': 'Immagini', 'insightface': 'Immagini', 'ultralytics': 'Immagini', 'opencv-python': 'Immagini', 'opencv-contrib-python': 'Immagini', 'opencv-python-headless': 'Immagini',
  'manim': 'Video', 'manimgl': 'Video', 'demucs': 'Audio', 'yt-dlp': 'Video', 'playwright': 'Automazione', 'gradio': 'Interfacce',
};
const SKIP_VENV = /\\uv\\cache\\|\\\.cache\\uv\\|\\caches\\uv\\/;

// Windows: Lib\site-packages. macOS: lib/pythonX.Y/site-packages.
function sitePackages(env) {
  if (WIN) return [j(env, 'Lib', 'site-packages')];
  return subdirs(j(env, 'lib')).filter((n) => /^python\d/.test(n)).map((n) => j(env, 'lib', n, 'site-packages'));
}

export function buildPython(deep, label, systemPython) {
  const envs = [], libs = new Map();
  const sys = systemPython?.path ? [{ k: 'venv', p: systemPython.prefix || path.dirname(systemPython.path), system: true }] : [];
  for (const h of [...sys, ...deep.filter((x) => x.k === 'venv' && !SKIP_VENV.test(norm(x.p)))]) {
    const cfg = readText(j(h.p, 'pyvenv.cfg')) || '';
    const py = h.system ? systemPython.version : (cfg.match(/version(?:_info)?\s*=\s*([\d.]+)/i) || [])[1] || '';
    const found = [];
    for (const d of sitePackages(h.p).flatMap(listDir)) {
      const m = d.name.match(/^(.+?)-(\d[^-]*?)\.dist-info$/i);
      if (!m) continue;
      const pkg = m[1].toLowerCase().replace(/_/g, '-');
      if (AI_PKG[pkg]) found.push({ pkg, version: m[2] });
    }
    const where = h.system ? 'Python di sistema' : label(h.p);
    const env = { id: `ambiente:${slug(norm(h.p).replace(H, ''))}`, cat: 'ambiente', name: h.system ? 'Python di sistema' : `${where} · ${path.basename(h.p)}`, version: py, size: h.s, path: h.p, status: 'rilevato', libs: found.map((f) => `${f.pkg} ${f.version}`) };
    envs.push(env);
    for (const f of found) {
      const e = libs.get(f.pkg) || { id: `libreria:${slug(f.pkg)}`, cat: 'libreria', name: f.pkg, group: AI_PKG[f.pkg], versions: [], places: [], status: 'rilevato', locations: [] };
      e.versions = uniq([...e.versions, f.version]);
      e.places = uniq([...e.places, where]);
      e.locations.push({ label: `${where} · ${f.version}`, path: h.p });
      libs.set(f.pkg, e);
    }
  }
  for (const e of libs.values()) e.version = e.versions.sort(compareVersions).reverse().join(', ');
  return { envs: envs.sort((a, b) => b.size - a.size), libs: [...libs.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

const NODE_PKG = /^(remotion|@remotion\/renderer|@anthropic-ai\/|openai$|ai$|@ai-sdk\/|@google\/genai|@huggingface\/|playwright(-core)?$|puppeteer$|@langchain\/|langchain$|onnxruntime|three$)/;
export function buildNodeLibs(deep, label) {
  const libs = new Map();
  for (const h of deep.filter((x) => x.k === 'pkg')) {
    if (/\\\.next\\|\\dist\\|\\sorgente\\/.test(norm(h.p))) continue;
    const pj = readJson(h.p, 300000);
    if (!pj) continue;
    const deps = { ...pj.dependencies, ...pj.devDependencies };
    for (const [n, v] of Object.entries(deps)) {
      if (!NODE_PKG.test(n)) continue;
      const e = libs.get(n) || { id: `libreria:node-${slug(n)}`, cat: 'libreria', name: n, group: 'Progetti Node', versions: [], places: [], status: 'rilevato', locations: [] };
      e.versions = uniq([...e.versions, String(v).replace(/^[\^~]/, '')]);
      e.places = uniq([...e.places, label(h.p)]);
      e.locations.push({ label: `${label(h.p)} · ${v}`, path: path.dirname(h.p) });
      libs.set(n, e);
    }
  }
  for (const e of libs.values()) e.version = e.versions.sort(compareVersions).reverse().join(', ');
  return [...libs.values()];
}

// ---------- Motori (programmi che fanno girare l'AI) ----------
// Se ci sono piu' copie di ComfyUI vale la piu' grande, cioe' quella con i modelli.
export const comfyRoot = (deep) => deep.filter((h) => h.k === 'comfy').sort((a, b) => b.s - a.s)[0];

export async function buildEngines(deep, sys, dirSize, label) {
  const out = [];
  const running = new Set(sys.running || []);
  const comfyHit = comfyRoot(deep);
  if (comfyHit) {
    const comfy = comfyHit.p;
    const v = (readText(j(comfy, 'pyproject.toml')) || '').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    out.push({ name: 'ComfyUI', group: 'Generazione', version: v, path: comfy, description: 'Genera immagini, video e musica con i modelli in models.', size: comfyHit.s, run: 'ComfyUI' });
  }
  const uns = j(HOME, '.unsloth');
  if (isDir(uns)) out.push({ name: 'Unsloth Studio', group: 'LLM', version: (sys.apps || []).find((a) => /unsloth/i.test(a.name))?.version, path: j(uns, 'studio'), description: 'Interfaccia locale per far girare e addestrare gli LLM, porta 8888.', size: dirSize(uns), run: 'Unsloth Studio' });

  const exes = deep.filter((h) => h.k === 'exe');
  const exeName = (h) => path.basename(h.p).toLowerCase().replace(/\.exe$/, '');
  const ver = await pool(exes.filter((h) => /^llama-(server|cli)$/.test(exeName(h))), 3, async (h) => {
    const r = await run(h.p, ['--version'], { timeout: 12000 });
    const t = `${r.out}\n${r.err}`;
    return { h, v: (t.match(/build\s+(\d+)/i) || [])[1] };
  });
  for (const { h, v } of ver) out.push({ name: `llama.cpp · ${label(h.p)}`, group: 'LLM', version: v ? `b${v}` : '', path: path.dirname(h.p), description: 'Motore che esegue i modelli GGUF.', run: 'llama.cpp' });
  for (const h of exes) {
    const n = exeName(h);
    if (/^llama-(server|cli)$/.test(n)) continue;
    if (n === 'whisper-server' || n === 'whisper-cli') {
      const info = readJson(j(HOME, '.unsloth', 'whisper.cpp', 'UNSLOTH_WHISPER_PREBUILT_INFO.json'));
      const version = info ? versionOf(JSON.stringify(info).match(/"(?:tag|version|upstream)[^"]*"\s*:\s*"([^"]+)/i)?.[1]) : '';
      out.push({ name: `whisper.cpp · ${label(h.p)}`, group: 'Trascrizione', version, path: path.dirname(h.p), description: 'Trascrive audio con i modelli Whisper in formato ggml.', run: 'whisper.cpp' });
    } else if (n === 'audiocpp_server') {
      const info = readText(j(path.dirname(h.p), 'BUILD_INFO.txt')) || '';
      out.push({ name: `audio.cpp · ${label(h.p)}`, group: 'Voce', version: (info.match(/upstream:\s*\S+\s+v([\d.]+)/) || [])[1], path: path.dirname(h.p), description: 'Motore audio per la sintesi vocale.' });
    } else if (!out.some((e) => e.name.toLowerCase() === n)) {
      out.push({ name: path.basename(h.p, '.exe'), group: 'LLM', path: path.dirname(h.p), run: path.basename(h.p, '.exe') });
    }
  }
  // VoiceStudio tiene runtime e programma nelle sue cartelle, ma dati e modelli nelle cartelle OmniVoice: e' un solo motore.
  const vsApp = MAC ? '/Applications/VoiceStudio.app' : j(LOCAL, 'Programs', 'VoiceStudio'), vsResources = MAC ? j(vsApp, 'Contents', 'Resources') : j(vsApp, 'resources'), vsRun = j(ROAMING, 'VoiceStudio'), vsData = j(ROAMING, 'OmniVoice');
  if (isDir(vsRun) || isDir(vsApp)) {
    const repo = (readText(j(vsResources, 'app-update.yml')) || '').match(/github\.com\/([\w.-]+\/[\w.-]+)/)?.[1];
    const size = [vsRun, vsApp, vsData].reduce((sum, p) => sum + (dirSize(p) || 0), 0);
    out.push({
      name: 'VoiceStudio', group: 'Voce', version: (sys.apps || []).find((a) => /voicestudio/i.test(a.name))?.version,
      path: isDir(vsRun) ? vsRun : vsApp, size: size || undefined, run: 'VoiceStudio',
      description: `${repo ? `Repo GitHub ${repo}: a` : 'A'}lternativa locale e gratuita a ElevenLabs. Il motore interno è OmniVoice, per questo dati e modelli stanno nelle cartelle OmniVoice.`,
    });
  }
  if (WIN && sys.gpus?.length) out.push({ name: 'NVIDIA CUDA', group: 'Base', version: sys.cuda, description: `Driver ${sys.gpus[0].driver}. È lo strato che porta i modelli sulla scheda video.` });
  if (MAC && sys.gpus?.length) out.push({ name: 'Apple Metal', group: 'Base', description: `${sys.gpus[0].name}. È lo strato che porta i modelli sul chip grafico.` });
  return out.map((e) => ({ id: `motore:${slug(e.name)}`, cat: 'motore', status: running.has(e.run) ? 'in-funzione' : 'rilevato', ...e }));
}

// ---------- Agenti e app AI ----------
const AI_APP = /antigravity|claude|chatgpt|codex|copilot|cursor|windsurf|gemini|ollama|lm studio|\bjan\b|pinokio|msty|anythingllm|perplexity|unsloth|comfyui|voicestudio|omnivoice|notebooklm/i;
const REMOVE_APP = /^(microsoft (visual c\+\+|\.net|asp\.net|edge|update|windows desktop)|windows (sdk|software|desktop|iot|mobile|team)|universal |sdk arm|nvidia (backend|container|localsystem|messagebus|session|telemetry|user|watchdog|virtual|install|app driver|aiuser)|python 3\.\d+\.\d+ (add|core|development|documentation|executables|pip|standard|tcl|test|utility)|vs_|kits configuration|winrt|winappdeploy|application verifier|msi development|msvc)/i;

const MAC_SYSTEM_DOTDIRS = /^\.(Trash|ssh|npm|nvm|zsh_sessions|bash_sessions|oh-my-zsh|cups)$/;

function obsidianVaults() {
  const vaults = readJson(j(ROAMING, 'obsidian', 'obsidian.json'))?.vaults || {};
  return Object.values(vaults).map((v) => v.path).filter((p) => p && isDir(p));
}

// Conta le note come le vede Obsidian, che ignora le cartelle nascoste.
function countNotes(root) {
  let n = 0;
  const walk = (d) => {
    for (const e of listDir(d)) {
      if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(j(d, e.name)); }
      else if (e.name.toLowerCase().endsWith('.md')) n++;
    }
  };
  walk(root);
  return n;
}

export function buildAgents(sys, claudeVersion) {
  const out = [];
  const add = (name, group, version, p, description, extra) => out.push({ id: `agente:${slug(name)}`, cat: 'agente', name, group, version, path: p, description, status: 'rilevato', ...extra });
  if (claudeVersion) add('Claude Code (terminale)', 'Agenti di programmazione', claudeVersion.version, claudeVersion.path);
  const macApp = (re) => (MAC ? (sys.apps || []).find((a) => re.test(a.name)) : undefined);
  const pkg = (sys.appx || []).find((a) => /claude/i.test(a.name)) || macApp(/^claude$/i);
  const codexApp = (sys.appx || []).find((a) => /codex|openai/i.test(a.name)) || macApp(/^codex$/i);
  if (pkg) add('App Claude (desktop)', 'App di chat e lavoro', pkg.version, pkg.location);
  const agy = readJson(j(HOME, '.gemini', 'bin', 'agy.version.json'));
  if (agy) add('Antigravity CLI (agy)', 'Agenti di programmazione', agy.version, j(HOME, '.gemini', 'bin'));
  if (isDir(j(ROAMING, 'Antigravity IDE'))) add('Antigravity IDE', 'Agenti di programmazione', '', j(ROAMING, 'Antigravity IDE'));
  if (isDir(j(HOME, '.codex'))) add('Codex', 'Agenti di programmazione', codexApp?.version || '', codexApp?.location || j(HOME, '.codex'));
  for (const e of listDir(j(HOME, '.vscode', 'extensions'))) {
    const m = e.name.match(/^(anthropic\.claude-code|google\.geminicodeassist)-(\d[\d.]*)/);
    if (m) add(m[1].startsWith('anth') ? 'Claude Code per VS Code' : 'Gemini Code Assist per VS Code', 'Agenti di programmazione', m[2], j(HOME, '.vscode', 'extensions', e.name));
  }
  for (const a of sys.apps || []) {
    if (a === pkg || a === codexApp || !AI_APP.test(a.name) || out.some((o) => o.name.toLowerCase() === a.name.toLowerCase())) continue;
    if (/unsloth|voicestudio|omnivoice/i.test(a.name)) continue;
    add(a.name.replace(/\s+\d+(\.\d+)+$/, ''), /antigravity/i.test(a.name) ? 'Agenti di programmazione' : 'App di chat e lavoro', a.version, a.location || '');
  }
  for (const a of sys.appx || []) {
    const n = a.name.replace(/^Microsoft\./, '');
    if (!/claude|codex|openai/i.test(a.name) && !out.some((o) => o.name.toLowerCase() === n.toLowerCase())) add(n, 'App di chat e lavoro', a.version, a.location);
  }
  const chromeModel = j(LOCAL, 'Google', 'Chrome', ...(WIN ? ['User Data'] : []), 'OptGuideOnDeviceModel');
  if (exists(chromeModel)) add('Gemini Nano in Chrome', 'AI dentro altri programmi', '', chromeModel, 'Modello scaricato da Chrome per le funzioni AI del browser.');
  const davinciData = WIN ? 'C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve' : '/Library/Application Support/Blackmagic Design/DaVinci Resolve';
  if ((sys.apps || []).some((a) => /davinci/i.test(a.name)) || exists(davinciData)) add('DaVinci Resolve', 'AI dentro altri programmi', (sys.apps || []).find((a) => /davinci/i.test(a.name))?.version, davinciData, 'Funzioni neurali con modelli propri.');
  const obsidian = (sys.apps || []).find((a) => /^obsidian\b/i.test(a.name));
  const vaults = obsidianVaults();
  if (obsidian || vaults.length) {
    const home = obsidian?.location || j(LOCAL, 'Programs', 'Obsidian');
    add('Obsidian', 'Second brain', obsidian?.version, isDir(home) ? home : '', `App per le note, usata come second brain. Vault collegati: ${vaults.length}.`, { size: obsidian?.kb ? obsidian.kb * 1024 : undefined });
    for (const v of vaults) {
      const count = (sub) => listDir(j(v, '.claude', sub)).filter((f) => f.name.endsWith('.md')).length;
      const plugins = subdirs(j(v, '.obsidian', 'plugins')).length;
      const parts = [`Vault di Obsidian con ${countNotes(v).toLocaleString('it-IT')} note.`, plugins ? `Plugin della community: ${plugins}.` : 'Nessun plugin della community.'];
      if (count('agents') || count('commands')) parts.push(`Per Claude contiene ${count('agents')} agenti e ${count('commands')} comandi.`);
      add(`Vault ${path.basename(v)}`, 'Second brain', '', v, parts.join(' '));
    }
  }
  const known = /^\.(claude|codex|gemini|antigravity|antigravity-ide|agents|unsloth|cache|config|local|vscode|vscode-shared|docker|thumbnails|insomniac|matplotlib|sbx-denybin|taste-skill)$/;
  for (const d of listDir(HOME)) {
    if (!d.isDirectory() || !d.name.startsWith('.') || known.test(d.name) || (MAC && MAC_SYSTEM_DOTDIRS.test(d.name))) continue;
    add(d.name, 'Altre tracce sul PC', '', j(HOME, d.name), 'Cartella di configurazione di uno strumento.');
  }
  return out;
}

export function buildPrograms(sys) {
  return (sys.apps || []).filter((a) => !REMOVE_APP.test(a.name)).map((a) => ({
    id: `programma:${slug(a.name)}`, cat: 'programma', name: a.name, version: a.version, group: a.publisher || '', path: a.location || '', status: 'rilevato', size: a.kb ? a.kb * 1024 : undefined,
  }));
}

// Il piano di Codex sta nelle sue sessioni: auth.json non viene mai aperto.
const CODEX_PLANS = { go: 'ChatGPT Go', plus: 'ChatGPT Plus', pro: 'ChatGPT Pro', team: 'ChatGPT Team', business: 'ChatGPT Business', enterprise: 'ChatGPT Enterprise', edu: 'ChatGPT Edu' };

function codexPlan() {
  const files = [];
  const walk = (d) => {
    for (const e of listDir(d)) {
      const p = j(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) { try { files.push({ p, m: fs.statSync(p).mtimeMs }); } catch {} }
    }
  };
  walk(j(HOME, '.codex', 'sessions'));
  walk(j(HOME, '.codex', 'archived_sessions'));
  for (const f of files.sort((a, b) => b.m - a.m).slice(0, 300)) {
    const found = (readText(f.p, 200_000_000) || '').match(/"plan_type":"\w+"/g);
    if (found) return { plan: found.at(-1).slice(13, -1), seen: f.m };
  }
  return null;
}

export function buildSubscriptions(claudeJson, declared) {
  const out = [];
  const oa = claudeJson?.oauthAccount;
  if (oa?.organizationType) {
    const tier = String(oa.organizationRateLimitTier || '').match(/max_(\d+)x/);
    const name = oa.organizationType === 'claude_max' ? `Claude Max${tier ? ` ${tier[1]}x` : ''}` : oa.organizationType.replace('claude_', 'Claude ');
    out.push({ id: 'abbonamento:claude', cat: 'abbonamento', name, group: 'Anthropic', status: 'rilevato', since: oa.subscriptionCreatedAt, models: declared.modelliInAbbonamento?.Claude || [], description: oa.hasExtraUsageEnabled ? 'Utilizzo extra attivo.' : '' });
  }
  const google = googlePlan(declared);
  if (google) out.push({ id: `abbonamento:${slug(google.nome)}`, cat: 'abbonamento', name: google.nome, group: 'Google', status: 'indicato', models: ['Antigravity', 'Gemini', 'Google'], description: [google.prezzo, 'Copre Antigravity, Gemini e le app AI di Google.'].filter(Boolean).join('. ') });
  for (const a of declared.abbonamenti || []) out.push({ id: `abbonamento:${slug(a.nome)}`, cat: 'abbonamento', name: a.nome, group: a.fornitore, status: 'dichiarato', models: a.modelli || [], description: a.nota });
  const codex = readJson(j(HOME, '.codex', 'models_cache.json'));
  if (codex?.models) {
    const seen = codexPlan();
    const paid = seen && seen.plan !== 'free' ? CODEX_PLANS[seen.plan] || `ChatGPT ${seen.plan}` : null;
    const date = seen ? new Date(seen.seen).toLocaleDateString('it-IT') : '';
    const free = seen ? !paid : (declared.senzaAbbonamento || []).includes('Codex');
    const description = seen
      ? `${paid ? `Piano ${paid}` : 'Account gratuito'}, letto dalle sessioni di Codex. Ultimo dato disponibile: ${date}.`
      : free ? 'Account collegato sul PC, nessun abbonamento a pagamento.' : 'Account collegato sul PC. Nessuna sessione riporta ancora il piano.';
    out.push({ id: 'abbonamento:codex', cat: 'abbonamento', name: paid ? `Codex (${paid})` : 'Codex (OpenAI)', group: 'OpenAI', status: paid ? 'rilevato' : free ? 'senza-piano' : 'piano-ignoto', models: codex.models.map((m) => m.slug).filter((s) => s && !/auto-review|reserve/.test(s)), description });
  }
  return out;
}

export { fs };
