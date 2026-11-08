// Walker per macOS: fa lo stesso lavoro di walker.ps1 e scrive lo stesso formato (JSON Lines).
// Sola lettura. Gira a priorita' bassa per non disturbare il lavoro in corso.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKIP = new Set([
  'node_modules', '.git', '__pycache__', '.trash',
  '$recycle.bin', 'system volume information', 'windowsapps', 'config.msi', 'recovery', 'perflogs', '$winreagent', '$sysreset',
  '.spotlight-v100', '.fseventsd', '.documentrevisions-v100', '.temporaryitems', 'backups.backupdb', 'cloudstorage',
]);
const MODEL_EXT = new Set(['.gguf', '.ggml', '.safetensors', '.ckpt', '.pt', '.pth', '.onnx', '.tflite', '.nemo', '.bin']);
const EXE_BASE = ['llama-server', 'llama-cli', 'whisper-cli', 'whisper-server', 'ollama', 'lms', 'lm studio', 'koboldcpp', 'audiocpp_server', 'jan', 'anythingllm', 'msty', 'pinokio'];
const WIN = process.platform === 'win32';
const EXES = new Set(EXE_BASE.map((n) => (WIN ? `${n}.exe` : n)));
const PROJECT_DIR = /[\\/](documents|developer|projects|progetti)[\\/]/i;
const MIN_MODEL = 50 * 1024 * 1024;

// Dalla tabella di `mount` tiene i dischi locali scrivibili, esclusi quelli di backup.
export function parseLocalVolumes(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/ on (\/Volumes\/.+?) \(([^)]*)\)$/);
    if (!m) continue;
    const flags = m[2].split(',').map((f) => f.trim());
    if (flags.includes('local') && !flags.includes('read-only') && !/timemachine/i.test(m[1])) out.push(m[1]);
  }
  return out;
}

export function localVolumes() {
  try { return parseLocalVolumes(execFileSync('/sbin/mount', { encoding: 'utf8', timeout: 8000 })); } catch { return []; }
}

const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };

function defaultRoots() {
  const roots = [os.homedir(), '/Applications', '/Library/Application Support', '/opt', '/usr/local', ...localVolumes()];
  return roots.filter((p) => fs.existsSync(p));
}

function scanDisk(output, watchedList, roots) {
  const watched = new Set(watchedList.split('|').filter(Boolean).map((p) => p.replace(/[\\/]+$/, '').toLowerCase()));
  const fd = fs.openSync(output, 'w');
  let buffer = '', files = 0, dirs = 0, denied = 0;
  const flush = () => { if (buffer) { fs.writeSync(fd, buffer); buffer = ''; } };
  const emit = (k, p, s, m) => {
    buffer += `${JSON.stringify(m ? { k, p, s, m: m.toISOString() } : { k, p, s })}\n`;
    if (buffer.length > 65536) flush();
  };

  function walk(dir, inHf) {
    dirs++;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { denied++; return 0; }
    const hf = path.basename(dir).toLowerCase().startsWith('models--');
    let total = 0, isVenv = false, isComfy = false;
    const subdirs = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!SKIP.has(e.name.toLowerCase())) subdirs.push(e.name); continue; }
      if (!e.isFile()) continue;
      const p = path.join(dir, e.name);
      const st = lstat(p);
      if (!st) { denied++; continue; }
      files++;
      total += st.size;
      const name = e.name.toLowerCase();
      if (name === 'pyvenv.cfg') isVenv = true;
      else if (name === 'skill.md') emit('skill', p, st.size);
      else if (name === '.mcp.json' || name === 'claude_desktop_config.json') emit('mcp', p, st.size);
      else if (name === 'comfyui_version.py') isComfy = true;
      else if (name === 'package.json' && st.size < 200000 && PROJECT_DIR.test(p)) emit('pkg', p, st.size);
      else if (EXES.has(name) && (WIN || st.mode & 0o111)) emit('exe', p, st.size, st.mtime);
      else if (!inHf && !hf && st.size >= MIN_MODEL && MODEL_EXT.has(path.extname(name))) emit('model', p, st.size, st.mtime);
    }
    for (const s of subdirs) total += walk(path.join(dir, s), inHf || hf);
    if (hf && !inHf) emit('hf', dir, total, lstat(dir)?.mtime);
    if (isVenv) emit('venv', dir, total);
    if (isComfy) emit('comfy', dir, total);
    if (watched.has(dir.toLowerCase())) emit('dir', dir, total);
    return total;
  }

  for (const r of roots) walk(r, false);
  buffer += `${JSON.stringify({ k: 'done', files, dirs, denied, drives: ['/', ...roots.filter((r) => r.startsWith('/Volumes/'))].join(' ') })}\n`;
  flush();
  fs.closeSync(fd);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ''; };
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
  const roots = arg('--roots') ? arg('--roots').split('|') : defaultRoots();
  scanDisk(arg('--out'), arg('--watched'), roots);
}
