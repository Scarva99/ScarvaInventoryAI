// Server locale dell'inventario. Niente dipendenze, ascolta solo su questo PC e si spegne quando chiudi la pagina.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runScan } from './scanner/scan.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const LATEST = path.join(ROOT, 'data', 'latest.json');
const HOST = '127.0.0.1';
const PORT = 47474;
const ORIGIN = `http://${HOST}:${PORT}`;
const openBrowser = process.argv.includes('--open');
const keepAlive = process.argv.includes('--keep');
const MAC = process.platform === 'darwin';
const detach = (cmd, args) => spawn(cmd, args, { windowsHide: true, detached: true, stdio: 'ignore' }).unref();

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const status = { running: false, phase: '', generation: 0, startedAt: null, finishedAt: null, error: null };
let lastPing = Date.now();

async function scan() {
  if (status.running) return;
  Object.assign(status, { running: true, phase: 'Avvio', startedAt: Date.now(), error: null });
  try {
    await runScan((p) => { status.phase = p; });
    status.generation++;
  } catch (e) {
    status.error = String(e?.message || e);
  } finally {
    Object.assign(status, { running: false, phase: '', finishedAt: Date.now() });
  }
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
const readBody = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (d) => { if (b.length < 20000) b += d; });
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
});

// Si puo' aprire solo una cartella che e' davvero nell'inventario.
function knownPaths() {
  const set = new Set();
  try {
    const d = JSON.parse(fs.readFileSync(LATEST, 'utf8'));
    for (const i of [...d.items, ...d.cited]) {
      if (i.path) set.add(i.path.toLowerCase());
      for (const l of i.locations || []) if (l.path) set.add(l.path.toLowerCase());
    }
    for (const p of d.projects) if (p.path) set.add(p.path.toLowerCase());
  } catch {}
  return set;
}

const server = http.createServer(async (req, res) => {
  // Blocca le richieste che non arrivano da questa pagina (altri siti aperti nel browser).
  if (req.headers.host !== `${HOST}:${PORT}`) return send(res, 403, '{}');
  const url = new URL(req.url, ORIGIN);
  if (req.method === 'POST') {
    if (req.headers.origin !== ORIGIN) return send(res, 403, '{}');
    if (url.pathname === '/api/scan') {
      const body = await readBody(req);
      const fresh = status.finishedAt && Date.now() - status.finishedAt < 30000;
      if (!status.running && (body.force || !fresh)) scan();
      return send(res, 200, JSON.stringify(status));
    }
    if (url.pathname === '/api/open') {
      const { path: p } = await readBody(req);
      if (typeof p !== 'string' || !knownPaths().has(p.toLowerCase()) || !fs.existsSync(p)) return send(res, 404, '{}');
      const isDir = fs.statSync(p).isDirectory();
      if (MAC) detach('open', isDir ? [p] : ['-R', p]);
      else detach('explorer.exe', isDir ? [p] : [`/select,${p}`]);
      return send(res, 200, '{}');
    }
    return send(res, 404, '{}');
  }
  if (url.pathname === '/api/ping') { lastPing = Date.now(); return send(res, 200, JSON.stringify(status)); }
  if (url.pathname === '/api/inventory') {
    if (!fs.existsSync(LATEST)) return send(res, 200, 'null');
    return send(res, 200, fs.readFileSync(LATEST));
  }
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Non trovato', 'text/plain; charset=utf-8');
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
});

const launchBrowser = () => (MAC ? detach('open', [`${ORIGIN}/`]) : detach('cmd.exe', ['/d', '/c', 'start', '""', `${ORIGIN}/`]));

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { if (openBrowser) launchBrowser(); setTimeout(() => process.exit(0), 300); }
  else { console.error(e); process.exit(1); }
});
server.listen(PORT, HOST, () => {
  console.log(`Inventario AI su ${ORIGIN}`);
  if (openBrowser) launchBrowser();
  scan();
  if (!keepAlive) setInterval(() => { if (!status.running && Date.now() - lastPing > 90000) process.exit(0); }, 15000);
});
