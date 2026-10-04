// dev.mjs — local development server for the Krossi web app.
//
//   node krossi/web/dev.mjs        → http://localhost:4400/demo  (demo, no account needed)
//                                    http://localhost:4400/pelaa (real backend)
//
// Rebuilds on change (build.mjs --watch) and serves the same URL layout as production:
// /pelaa/* and /demo/* fall back to their HTML shells, /krossi/* is the bundle, /assets and
// /lib/cookie-consent.js come from the repo root, / is the landing page.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const dist = join(here, 'dist');
const port = Number(process.env.PORT || 4400);

const watcher = spawn(process.execPath, [join(here, 'build.mjs'), '--watch'], { stdio: 'inherit' });
process.on('exit', () => watcher.kill());
process.on('SIGINT', () => process.exit(0));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.jsx': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

function resolve(pathname) {
  if (/^\/pelaa(\/.*)?$/.test(pathname)) return join(dist, 'app.html');
  if (/^\/demo(\/.*)?$/.test(pathname)) return join(dist, 'krossi-demo.html');
  if (pathname.startsWith('/krossi/')) return join(dist, pathname.slice('/krossi/'.length));
  if (pathname === '/krossi.webmanifest') return join(dist, 'krossi.webmanifest');
  if (pathname.startsWith('/assets/')) return join(repo, pathname);
  if (pathname === '/lib/cookie-consent.js') return join(repo, 'lib/cookie-consent.js');
  if (pathname === '/' || pathname === '/index.html') return join(here, 'landing/index.html');
  if (pathname.startsWith('/lib/')) return join(here, 'landing', pathname.slice('/lib/'.length));
  return null;
}

createServer(async (req, res) => {
  const pathname = normalize(decodeURIComponent(req.url.split('?')[0]));
  const file = resolve(pathname);
  if (!file || !file.startsWith(repo)) { res.writeHead(404).end('Not found'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`krossi/web dev: http://localhost:${port}/demo  ·  http://localhost:${port}/pelaa`));
