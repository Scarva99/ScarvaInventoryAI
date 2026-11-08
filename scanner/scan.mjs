import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, LOCAL, ROAMING, MAC, WIN, ps, run, sh, whichCmd, readJson, readText, listDir, subdirs, norm, uniq, baseName, makeLabeler } from './util.mjs';
import { buildModels, extractMentions, matchMention, KINDS } from './models.mjs';
import { googlePlan } from './google-plans.mjs';
import { collectTools, buildSkills, collectPlugins, collectMcp, buildPython, buildNodeLibs, buildEngines, buildAgents, buildPrograms, buildSubscriptions, comfyRoot } from './sources.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const DATA = path.join(ROOT, 'data');
const LATEST = path.join(DATA, 'latest.json');
const CHANGES = path.join(DATA, 'changes.json');
const DEEP = path.join(DATA, 'deep.jsonl');

// Le cartelle di cui serve il peso totale, oltre a quelle trovate da sole.
const WATCHED = [
  path.join(HOME, '.unsloth'), path.join(HOME, '.rembg'),
  path.join(ROAMING, 'VoiceStudio'), path.join(ROAMING, 'OmniVoice'), MAC ? '/Applications/VoiceStudio.app' : path.join(LOCAL, 'Programs', 'VoiceStudio'),
];

function loadDeep() {
  try { return fs.readFileSync(DEEP, 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; }
}

async function walk(onPhase) {
  onPhase('Lettura del disco');
  const tmp = `${DEEP}.tmp`;
  const r = WIN
    ? await ps(path.join(here, 'walker.ps1'), ['-Out', tmp, '-Watched', WATCHED.join('|')], { timeout: 900000 })
    : await run(process.execPath, [path.join(here, 'walker.mjs'), '--out', tmp, '--watched', WATCHED.join('|')], { timeout: 900000 });
  if (r.code === 0 && fs.existsSync(tmp) && /"k":"done"/.test(fs.readFileSync(tmp, 'utf8').slice(-400))) {
    fs.renameSync(tmp, DEEP);
    return true;
  }
  try { fs.unlinkSync(tmp); } catch {}
  return false;
}

async function readSystem() {
  if (!WIN) return (await import('./system-mac.mjs')).readMacSystem();
  const r = await ps(path.join(here, 'system.ps1'), [], { timeout: 120000 });
  try { return JSON.parse(r.out.replace(/^﻿/, '').trim()); } catch { return {}; }
}

function readDeclared() {
  const file = path.join(ROOT, 'dichiarato.json');
  if (!fs.existsSync(file)) { try { fs.copyFileSync(path.join(ROOT, 'dichiarato.esempio.json'), file); } catch {} }
  return readJson(file) || {};
}

// Incrocia le memorie di Claude con quello che c'e' davvero sul PC.
function readMemories(claudeJson, foundNames, label) {
  const base = path.join(HOME, '.claude', 'projects');
  const real = new Map(Object.keys(claudeJson?.projects || {}).map((p) => [p.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(), p]));
  const projects = [], missing = new Map();
  for (const dir of subdirs(base)) {
    const mem = path.join(base, dir, 'memory');
    const files = listDir(mem).filter((f) => f.name.endsWith('.md'));
    if (!files.length) continue;
    const fullPath = real.get(dir.toLowerCase()) || '';
    const homePrefix = `${HOME.replace(/[^a-zA-Z0-9]/g, '-')}-`.toLowerCase();
    const short = dir.toLowerCase().startsWith(homePrefix) ? dir.slice(homePrefix.length).replace(/^Documents-(PROGETTI-DEV-)?/i, '') : dir;
    const name = fullPath ? baseName(fullPath) : (short || dir).replace(/-/g, ' ');
    const mentions = new Map();
    for (const f of files) for (const t of extractMentions(readText(path.join(mem, f.name)) || '')) if (!mentions.has(t.toLowerCase())) mentions.set(t.toLowerCase(), t);
    const found = [], notFound = [];
    for (const t of mentions.values()) {
      if (matchMention(t, foundNames)) found.push(t);
      else {
        notFound.push(t);
        const e = missing.get(t.toLowerCase()) || { name: t, projects: [] };
        e.projects = uniq([...e.projects, name]);
        missing.set(t.toLowerCase(), e);
      }
    }
    projects.push({ name, path: fullPath && path.normalize(fullPath), memories: files.length, found: found.sort(), notFound: notFound.sort() });
  }
  return { projects: projects.sort((a, b) => (b.found.length + b.notFound.length) - (a.found.length + a.notFound.length) || a.name.localeCompare(b.name, 'it')), missing: [...missing.values()] };
}

const ENGINE_LIBS_NAMES = new Set(['faster-whisper', 'openai-whisper', 'whisperx', 'sherpa-onnx', 'qwen-tts', 'chatterbox-tts', 'kokoro', 'tts', 'coqui-tts', 'llama-cpp-python', 'unsloth', 'crawl4ai', 'rembg', 'insightface', 'ultralytics', 'manim', 'manimgl', 'demucs', 'remotion']);

function diff(prev, items) {
  if (!prev?.items) return [];
  const now = new Date().toISOString();
  const before = new Map([...prev.items, ...(prev.cited || [])].filter((i) => i.status !== 'assente').map((i) => [i.id, i]));
  const after = new Map(items.filter((i) => i.status !== 'assente').map((i) => [i.id, i]));
  const out = [];
  for (const [id, i] of after) {
    const p = before.get(id);
    if (!p) out.push({ at: now, type: 'aggiunto', cat: i.cat, name: i.name });
    else if (p.version && i.version) {
      // Se una libreria ha piu' versioni in progetti diversi, conta solo la piu' recente.
      const a = String(p.version).split(', ')[0], b = String(i.version).split(', ')[0];
      if (a !== b) out.push({ at: now, type: 'aggiornato', cat: i.cat, name: i.name, from: a, to: b });
    }
  }
  for (const [id, p] of before) if (!after.has(id)) out.push({ at: now, type: 'rimosso', cat: p.cat, name: p.name });
  return out;
}

export async function runScan(onPhase = () => {}) {
  fs.mkdirSync(DATA, { recursive: true });
  const prev = readJson(LATEST, 200_000_000);
  const started = Date.now();

  onPhase('Lettura di programmi e hardware');
  const sysRun = readSystem();
  const toolsRun = collectTools();
  const walkOk = await walk(onPhase);

  const sys = await sysRun;
  const tools = await toolsRun;
  onPhase('Composizione dell\'inventario');

  const deep = loadDeep();
  const done = deep.find((h) => h.k === 'done') || {};
  const claudeJson = readJson(path.join(HOME, '.claude.json'));
  const declared = readDeclared();
  const label = makeLabeler([...Object.keys(claudeJson?.projects || {})]);
  const sizes = new Map(deep.filter((h) => h.k === 'dir').map((h) => [norm(h.p), h.s]));
  const dirSize = (p) => sizes.get(norm(p));

  const models = buildModels(deep.filter((h) => !/\\\.locks\\/.test(norm(h.p))), label);
  const { plugins, installPaths } = collectPlugins(claudeJson, claudeJson?.pluginUsage, comfyRoot(deep)?.p);
  const skills = buildSkills(deep, installPaths, label, claudeJson?.skillUsage, declared);
  const mcp = collectMcp(claudeJson, deep, label, installPaths, declared);
  const { envs, libs } = buildPython(deep, label, tools.find((t) => t.name === 'Python'));
  const nodeLibs = buildNodeLibs(deep, label);
  const engines = await buildEngines(deep, sys, dirSize, label);
  const cc = tools.find((t) => t.id === 'strumento:npm-anthropic-ai-claude-code');
  const claudeVer = await sh('claude --version', { timeout: 20000 });
  const claudePath = await sh(whichCmd('claude'), { timeout: 8000 });
  const agents = buildAgents(sys, { version: (claudeVer.out.match(/\d+\.\d+\.\d+/) || [cc?.version])[0], path: claudePath.out.split(/\r?\n/)[0]?.trim() });
  const programs = buildPrograms(sys);
  const subs = buildSubscriptions(claudeJson, declared);
  // Le app comprese in un piano lo dicono anche sulla propria riga.
  const google = googlePlan(declared);
  for (const a of [...(declared.abbonamenti || []), ...(google ? [{ nome: google.nome, fornitore: 'Google' }] : [])]) {
    // Un piano Google AI copre tutte le app Google con AI. Gemini Nano in Chrome e' un modello locale e resta fuori.
    const included = a.appIncluse ? new RegExp(a.appIncluse, 'i') : /google/i.test(`${a.fornitore} ${a.nome}`) ? /antigravity|gemini(?! nano)/i : null;
    if (!included) continue;
    for (const x of agents) if (included.test(x.name)) x.description = [x.description, `Compreso in ${a.nome}.`].filter(Boolean).join(' ');
  }

  const foundNames = [...models.map((m) => m.name), ...models.flatMap((m) => m.locations.map((l) => l.label)), ...engines.map((e) => e.name), ...libs.map((l) => l.name), ...nodeLibs.map((l) => l.name)];
  const mem = readMemories(claudeJson, foundNames, label);
  // Oltre alle memorie, conta quello che sta fisicamente dentro la cartella del progetto.
  for (const p of mem.projects) {
    if (!p.path) continue;
    const root = norm(p.path) + '\\';
    const inside = [...models, ...libs.filter((l) => ENGINE_LIBS_NAMES.has(l.name)), ...nodeLibs.filter((l) => ENGINE_LIBS_NAMES.has(l.name))]
      .filter((x) => x.locations.some((l) => norm(l.path).startsWith(root)))
      .map((x) => x.name);
    const seen = new Set(p.found.map((f) => f.toLowerCase()));
    p.found = [...p.found, ...inside.filter((n) => !seen.has(n.toLowerCase()))];
  }
  mem.projects.sort((a, b) => (b.found.length + b.notFound.length) - (a.found.length + a.notFound.length) || a.name.localeCompare(b.name, 'it'));
  const cited = mem.missing.map((m) => ({ id: `citato:${m.name.toLowerCase()}`, cat: 'modello', name: m.name, group: 'Citati', status: 'citato', projects: m.projects, places: m.projects, locations: [] }));

  // Le librerie che sono veri motori (Whisper, le voci, rembg...) stanno tra i motori, con i posti in cui sono installate.
  const ENGINE_LIBS = { 'faster-whisper': 'faster-whisper', 'openai-whisper': 'OpenAI Whisper', whisperx: 'WhisperX', 'sherpa-onnx': 'sherpa-onnx', 'qwen-tts': 'Qwen3-TTS', 'chatterbox-tts': 'Chatterbox', kokoro: 'Kokoro', tts: 'Coqui TTS', 'coqui-tts': 'Coqui TTS', 'llama-cpp-python': 'llama-cpp-python', unsloth: 'Unsloth (libreria)', crawl4ai: 'Crawl4AI', rembg: 'rembg', insightface: 'InsightFace', ultralytics: 'Ultralytics YOLO', manim: 'Manim', manimgl: 'ManimGL', demucs: 'Demucs', remotion: 'Remotion' };
  const allLibs = [...libs, ...nodeLibs];
  const libEngines = allLibs.filter((l) => ENGINE_LIBS[l.name]).map((l) => ({ ...l, id: `motore:lib-${l.name}`, cat: 'motore', name: ENGINE_LIBS[l.name], group: l.group === 'Progetti Node' ? 'Video' : l.group, description: `Usato in: ${l.places.join(', ')}.`, path: l.locations[0]?.path }));
  const otherLibs = allLibs.filter((l) => !ENGINE_LIBS[l.name]);
  const allEngines = [...engines, ...libEngines];
  const items = [...subs, ...models, ...allEngines, ...agents, ...skills, ...plugins, ...mcp, ...tools, ...otherLibs, ...envs, ...programs];
  const history = readJson(CHANGES) || [];
  const newChanges = diff(prev, [...items, ...cited]);
  const changes = [...newChanges, ...history].slice(0, 300);
  fs.writeFileSync(CHANGES, JSON.stringify(changes), 'utf8');

  const modelBytes = models.reduce((s, m) => s + m.size, 0);
  const byKind = KINDS.map((k) => ({ kind: k, size: models.filter((m) => m.group === k).reduce((s, m) => s + m.size, 0), count: models.filter((m) => m.group === k).length })).filter((k) => k.count);
  const places = uniq(models.flatMap((m) => m.places));

  const output = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    firstRun: !prev,
    walkOk, walk: done,
    machine: { platform: process.platform, computer: sys.computer, cpu: sys.cpu, cores: sys.cores, threads: sys.threads, ramGB: sys.ramGB, os: sys.os, build: sys.build, disks: sys.disks || [], gpus: sys.gpus || [], cuda: sys.cuda, wsl: sys.wsl || [], ports: sys.ports || [], running: sys.running || [] },
    totals: { modelBytes, families: models.length, places: places.length, kinds: byKind, engines: allEngines.length, agents: agents.length, skills: skills.filter((s) => s.status !== 'citato').length, plugins: plugins.length, mcp: mcp.length, tools: tools.filter((t) => t.status !== 'assente').length, envs: envs.length },
    items, cited, projects: mem.projects, changes,
  };
  const tmp = `${LATEST}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(output), 'utf8');
  fs.renameSync(tmp, LATEST);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runScan((p) => console.log('·', p)).then((o) => {
    const c = {};
    for (const i of o.items) c[i.cat] = (c[i.cat] || 0) + 1;
    console.log(JSON.stringify({ secondi: Math.round(o.durationMs / 1000), walkOk: o.walkOk, walk: o.walk, voci: c, totali: { ...o.totals, kinds: undefined }, citati: o.cited.length }, null, 1));
  }).catch((e) => { console.error(e); process.exit(1); });
}
