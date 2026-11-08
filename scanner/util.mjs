import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const HOME = os.homedir();
export const WIN = process.platform === 'win32';
export const MAC = process.platform === 'darwin';
const APP_SUPPORT = path.join(HOME, 'Library', 'Application Support');
export const LOCAL = WIN ? process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local') : APP_SUPPORT;
export const ROAMING = WIN ? process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming') : APP_SUPPORT;

// Su macOS i programmi di Homebrew e simili possono non essere nel PATH ereditato.
if (!WIN) process.env.PATH = [...new Set([...(process.env.PATH || '').split(':'), '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', path.join(HOME, '.local', 'bin'), path.join(HOME, '.bun', 'bin'), path.join(HOME, '.cargo', 'bin')])].filter(Boolean).join(':');

// File con token e credenziali: l'inventario non li apre mai, in nessun caso.
const VIETATI = /(^|[\\/])(\.credentials\.json|auth\.json|oauth_creds\.json|google_accounts\.json|\.env(\..*)?)$|[\\/]\.sandbox-secrets[\\/]/i;

export function readText(p, max = 2_000_000) {
  if (VIETATI.test(p)) return null;
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > max) return null;
    return fs.readFileSync(p, 'utf8');
  } catch { return null; }
}
export function readJson(p, max = 60_000_000) {
  const t = readText(p, max);
  if (t == null) return null;
  try { return JSON.parse(t.replace(/^\uFEFF/, '')); } catch { return null; }
}
export const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
export const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
export function listDir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; }
}
export const subdirs = (p) => listDir(p).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name);

export function run(cmd, args = [], { timeout = 20000, verbatim = false, stdin = false } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    let child;
    const finish = (code) => { if (!done) { done = true; clearTimeout(t); resolve({ out, err, code }); } };
    try {
      child = spawn(cmd, args, { windowsHide: true, windowsVerbatimArguments: verbatim, stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    } catch { resolve({ out: '', err: '', code: -1 }); return; }
    const t = setTimeout(() => { try { child.kill(); } catch {} finish(-2); }, timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', () => finish(-1));
    child.on('close', (c) => finish(c));
  });
}
export const sh = (line, opts) => (WIN ? run('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { verbatim: true, ...opts }) : run('/bin/sh', ['-c', line], opts));
export const whichCmd = (cmd) => (WIN ? `where ${cmd}` : `command -v ${cmd}`);
export const ps = (file, args = [], opts) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], opts);

export async function pool(items, n, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length || 1) }, async () => {
    while (i < items.length) { const k = i++; results[k] = await fn(items[k], k); }
  }));
  return results;
}

export const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const norm = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
export const uniq = (a) => [...new Set(a.filter(Boolean))];
export const baseName = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || '';
// Vuole un percorso gia' passato da norm().
export const isProjectPath = (l) => /\\(documents|developer|projects|progetti)\\/.test(l);
export function versionOf(text) {
  const m = String(text || '').match(/\d+(?:\.\d+)+(?:[-+.][0-9A-Za-z]+)*/) || String(text || '').match(/\bv?(\d+)\b/);
  return m ? (m[1] && !m[0].includes('.') ? m[1] : m[0]) : '';
}
export function compareVersions(a, b) {
  const x = String(a).split(/[.\-+]/), y = String(b).split(/[.\-+]/);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
    if (d) return d;
  }
  return 0;
}

// Nome leggibile del posto in cui si trova un percorso.
export function makeLabeler(projectRoots) {
  const roots = projectRoots
    .map((p) => ({ p: norm(p), name: baseName(p) }))
    .filter((r) => isProjectPath(r.p) && r.name)
    .sort((a, b) => b.p.length - a.p.length);
  const h = norm(HOME);
  return function label(raw) {
    const l = norm(raw);
    const t = l.match(/\\test\\(\d{3})-([^\\]+)/);
    if (t) return `Test ${t[1]}`;
    if (/\\comfyui(\\|$)/.test(l)) return 'ComfyUI';
    if (l.includes('\\.cache\\huggingface')) return 'Cache Hugging Face';
    if (l.includes('\\.unsloth\\') || l.includes('ai.unsloth.studio')) return 'Unsloth Studio';
    if (l.includes('\\omnivoice\\')) return 'OmniVoice';
    if (l.includes('\\.agents\\skills\\watch')) return 'Skill watch';
    if (l.includes('\\.claude\\skills\\watch')) return 'Skill watch';
    if (l.includes('\\.rembg')) return 'rembg';
    if (l.includes('\\google\\chrome\\')) return 'Chrome';
    if (l.includes('blackmagic design')) return 'DaVinci Resolve';
    for (const r of roots) if (l === r.p || l.startsWith(r.p + '\\')) return r.name;
    const doc = l.match(/\\documents\\(?:progetti dev\\)?([^\\]+)/);
    if (doc) return path.basename(String(raw).replace(/\//g, '\\').split(/\\documents\\(?:progetti dev\\)?/i)[1].split('\\')[0]);
    const seg = String(raw).replace(/\//g, '\\').split('\\');
    if (l.startsWith(h + '\\appdata\\')) return seg[5] || 'AppData';
    if (l.startsWith(h + '\\library\\application support\\')) return seg[5] || 'Library';
    if (l.startsWith(h + '\\')) return seg[3];
    return WIN ? seg.slice(0, 3).join('\\') : String(raw).split('/').slice(0, 3).join('/');
  };
}
