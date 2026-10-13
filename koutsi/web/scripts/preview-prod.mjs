// preview-prod.mjs — serves the staged deployment (cloudflare-dist) through the real worker
// (src/worker.js), the way Cloudflare does: an existing file is served as is, everything
// else goes to the worker, whose ASSETS binding reads cloudflare-dist. Each port plays one
// host, so the Koutsi routing and the ?uusi=1 switch can be clicked through before a deploy:
//
//   npm run build:cloudflare && node koutsi/web/scripts/preview-prod.mjs
//   http://localhost:8790  → koutsi.krossi.app        http://localhost:8791 → demo.koutsi.krossi.app

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../../../src/worker.js';

const root = fileURLToPath(new URL('../../../cloudflare-dist/', import.meta.url));
const HOSTS = { 8790: 'koutsi.krossi.app', 8791: 'demo.koutsi.krossi.app' };
const RUN_WORKER_FIRST = new Set(['/', '/robots.txt', '/sitemap.xml']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
};

async function fileResponse(pathname) {
  const path = normalize(join(root, decodeURIComponent(pathname)));
  if (!path.startsWith(root)) return null;
  try {
    if (!(await stat(path)).isFile()) return null;
  } catch {
    return null;
  }
  return new Response(await readFile(path), { headers: { 'content-type': TYPES[extname(path)] || 'application/octet-stream' } });
}

const env = {
  ASSETS: {
    async fetch(request) {
      return (await fileResponse(new URL(request.url).pathname)) || new Response('Not found', { status: 404 });
    },
  },
};

for (const [port, host] of Object.entries(HOSTS)) {
  createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `https://${host}`);
      const request = new Request(url, { method: req.method, headers: Object.entries(req.headers).filter(([k]) => k !== 'host') });
      const response = (!RUN_WORKER_FIRST.has(url.pathname) && await fileResponse(url.pathname)) || await worker.fetch(request, env);
      const headers = {};
      response.headers.forEach((value, key) => { if (key !== 'set-cookie') headers[key] = value; });
      const cookies = response.headers.getSetCookie?.() || [];
      // Secure cookies can't be set over plain http on 127.0.0.1-style hosts in every browser.
      if (cookies.length) headers['set-cookie'] = cookies.map((c) => c.replace(/; Secure/, ''));
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(err?.stack || err));
    }
  }).listen(Number(port), () => console.log(`http://localhost:${port}  →  ${host}`));
}
