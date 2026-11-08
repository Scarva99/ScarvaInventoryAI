// Raccoglie su macOS gli stessi dati di system.ps1: hardware, programmi, porte in ascolto e motori AI in esecuzione.
// Sola lettura. Dei processi si guarda solo il programma eseguito, mai gli argomenti.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME, run, pool, listDir } from './util.mjs';
import { localVolumes } from './walker.mjs';

const RUNNING = {
  ComfyUI: /ComfyUI/i, 'Unsloth Studio': /unsloth/i, 'llama.cpp': /llama-server|llama-cli/i, 'whisper.cpp': /whisper-server|whisper-cli/i,
  Ollama: /ollama/i, 'LM Studio': /LM Studio/i, VoiceStudio: /VoiceStudio|OmniVoice/i,
};
const AI_PORTS = new Set([1234, 5000, 7860, 8000, 8080, 8188, 8888, 11434]);

export function parseListeningPorts(text) {
  const out = new Map();
  for (const line of String(text).split('\n').slice(1)) {
    const m = line.match(/^(\S+)\s.*:(\d+)\s+\(LISTEN\)\s*$/);
    if (m && AI_PORTS.has(Number(m[2]))) out.set(Number(m[2]), m[1].replace(/\\x20/g, ' '));
  }
  return [...out].map(([port, process]) => ({ port, process }));
}

export function parseRunning(text) {
  const lines = String(text).split('\n');
  return Object.keys(RUNNING).filter((name) => lines.some((l) => RUNNING[name].test(l)));
}

export function parseGpus(text) {
  let list = [];
  try { list = JSON.parse(text).SPDisplaysDataType || []; } catch {}
  return list.map((g) => {
    const m = String(g.spdisplays_vram || '').match(/(\d+)\s*(GB|MB)/i);
    return { name: g.sppci_model || g._name || 'Grafica integrata', vramMiB: m ? Number(m[1]) * (/gb/i.test(m[2]) ? 1024 : 1) : 0, cores: g.sppci_cores ? Number(g.sppci_cores) : undefined };
  });
}

export function parseBundleInfo(xml) {
  const read = (key) => (String(xml).match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`)) || [])[1]?.replace(/&amp;/g, '&');
  return { name: read('CFBundleDisplayName') || read('CFBundleName'), version: read('CFBundleShortVersionString') || '' };
}

const text = async (cmd, args, timeout = 15000) => (await run(cmd, args, { timeout })).out.trim();

function bundles() {
  const out = [];
  for (const root of ['/Applications', path.join(HOME, 'Applications')]) {
    for (const e of listDir(root)) {
      if (e.name.endsWith('.app')) out.push(path.join(root, e.name));
      else if (e.isDirectory()) for (const n of listDir(path.join(root, e.name))) if (n.name.endsWith('.app')) out.push(path.join(root, e.name, n.name));
    }
  }
  return out;
}

function diskOf(name, label) {
  try {
    const s = fs.statfsSync(name);
    return { name, label, size: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch { return null; }
}

export async function readMacSystem() {
  const apps = pool(bundles(), 6, async (b) => {
    const info = parseBundleInfo(await text('plutil', ['-convert', 'xml1', '-o', '-', path.join(b, 'Contents', 'Info.plist')], 8000));
    const kb = parseInt(await text('du', ['-sk', b], 30000), 10) || 0;
    return { name: info.name || path.basename(b, '.app'), version: info.version, publisher: '', location: b, kb };
  });
  const [computer, cpu, cores, threads, version, build, displays, listen, procs, appList] = await Promise.all([
    text('scutil', ['--get', 'ComputerName']), text('sysctl', ['-n', 'machdep.cpu.brand_string']), text('sysctl', ['-n', 'hw.physicalcpu']), text('sysctl', ['-n', 'hw.logicalcpu']),
    text('sw_vers', ['-productVersion']), text('sw_vers', ['-buildVersion']), text('system_profiler', ['SPDisplaysDataType', '-json'], 30000),
    text('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']), text('ps', ['-axo', 'comm=']), apps,
  ]);
  return {
    computer: computer || os.hostname(), cpu, cores: Number(cores) || 0, threads: Number(threads) || 0,
    ramGB: Math.round(os.totalmem() / 1024 ** 3), os: version ? `macOS ${version}` : 'macOS', build,
    disks: [diskOf('/', 'Disco interno'), ...localVolumes().map((v) => diskOf(v, path.basename(v)))].filter(Boolean),
    gpus: parseGpus(displays), cuda: '', apps: appList, appx: [], wsl: [], ports: parseListeningPorts(listen), running: parseRunning(procs),
  };
}
