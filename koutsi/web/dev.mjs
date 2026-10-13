// dev.mjs — local development server for the renewed Koutsi.
//
//   node koutsi/web/dev.mjs   → http://localhost:4500/demo/valmentaja  (coach demo, no account)
//                               http://localhost:4500/demo/pelaaja     (player demo)
//                               http://localhost:4500/valmentaja       (REAL backend — production data!)
//
// Rebuilds on change (build.mjs --watch) and serves the production URL layout: app paths
// fall back to their HTML shells, /koutsi-uusi/* is the bundle, /assets and
// /lib/cookie-consent.js come from the repo root. In production the demo lives on its own
// host (demo.koutsi.krossi.app) at the same paths; here it sits under /demo instead.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const dist = process.env.KOUTSI_OUT || join(here, 'dist');
const port = Number(process.env.PORT || 4500);

if (!process.argv.includes('--no-build')) {
  const watcher = spawn(process.execPath, [join(here, 'build.mjs'), '--watch'], { stdio: 'inherit', env: process.env });
  process.on('exit', () => watcher.kill());
}
process.on('SIGINT', () => process.exit(0));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

const deep = (base) => new RegExp(`^${base}(?:/[^/]+){0,3}/?$`);

export function resolveDevPath(pathname) {
  if (deep('/demo/valmentaja').test(pathname)) return join(dist, 'koutsi-uusi-valmentaja-demo.html');
  if (deep('/demo/pelaaja').test(pathname)) return join(dist, 'koutsi-uusi-pelaaja-demo.html');
  if (deep('/valmentaja').test(pathname)) return join(dist, 'koutsi-uusi-valmentaja.html');
  if (deep('/pelaaja').test(pathname)) return join(dist, 'koutsi-uusi-pelaaja.html');
  if (pathname.startsWith('/koutsi-uusi/')) return join(dist, pathname);
  if (pathname.startsWith('/assets/')) return join(repo, pathname);
  if (pathname === '/lib/cookie-consent.js') return join(repo, 'lib/cookie-consent.js');
  if (pathname === '/' || pathname === '/demo') return join(dist, 'koutsi-uusi-valmentaja-demo.html');
  return null;
}

createServer(async (req, res) => {
  let pathname;
  try { pathname = normalize(decodeURIComponent(req.url.split('?')[0])); } catch { pathname = normalize(req.url.split('?')[0]); }
  const file = resolveDevPath(pathname);
  if (!file || !(file.startsWith(repo) || file.startsWith(dist))) { res.writeHead(404).end('Not found'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`koutsi/web dev: http://localhost:${port}/demo/valmentaja  ·  http://localhost:${port}/demo/pelaaja`));
