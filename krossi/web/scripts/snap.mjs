// snap.mjs — screenshot demo routes in headless Chrome (visual QA without a browser pane).
//
//   node krossi/web/scripts/snap.mjs --out /tmp/shots /demo/koti /demo/pelit "/demo/uusi-peli"
//   options:
//     --out <dir>        where PNGs go (required)
//     --viewport mobile|desktop|both   (default both: 390×844 @2x and 1280×860)
//     --wait <ms>        extra wait after load (default 900)
//     --click <css>      click an element after load (repeatable, runs in order, 450 ms apart)
//     --full             full-page screenshot instead of the viewport
//     --no-build         reuse the previous build in <out>/site
//
// Builds the app into <out>/site (KROSSI_OUT), serves it on a random port with the same URL
// layout as production, and prints every console error / page error it saw. Exit code 1 if any.

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const repo = join(web, '..', '..');

const args = process.argv.slice(2);
const opt = { out: null, viewport: 'both', wait: 900, clicks: [], full: false, build: true, paths: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') opt.out = args[++i];
  else if (a === '--viewport') opt.viewport = args[++i];
  else if (a === '--wait') opt.wait = Number(args[++i]);
  else if (a === '--click') opt.clicks.push(args[++i]);
  else if (a === '--full') opt.full = true;
  else if (a === '--no-build') opt.build = false;
  else opt.paths.push(a);
}
if (!opt.out || opt.paths.length === 0) {
  console.error('usage: node krossi/web/scripts/snap.mjs --out <dir> /demo/koti [/demo/…]');
  process.exit(2);
}
const site = join(opt.out, 'site');
await mkdir(site, { recursive: true });
if (opt.build) {
  const r = spawnSync(process.execPath, [join(web, 'build.mjs')], { env: { ...process.env, KROSSI_OUT: site }, stdio: 'inherit' });
  if (r.status !== 0) { console.error('build failed'); process.exit(1); }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
function resolve(p) {
  if (/^\/pelaa(\/.*)?$/.test(p)) return join(site, 'app.html');
  if (/^\/demo(\/.*)?$/.test(p)) return join(site, 'krossi-demo.html');
  if (p.startsWith('/krossi/')) return join(site, p.slice('/krossi/'.length));
  if (p === '/krossi.webmanifest') return join(site, 'krossi.webmanifest');
  if (p.startsWith('/assets/')) return join(repo, p);
  if (p === '/lib/cookie-consent.js') return join(repo, 'lib/cookie-consent.js');
  return null;
}
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(req.url.split('?')[0]));
  const file = resolve(p);
  if (!file) { res.writeHead(404).end(); return; }
  try { res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();

const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
const viewports = opt.viewport === 'both' ? ['mobile', 'desktop'] : [opt.viewport];
const VP = { mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { width: 1280, height: 860, deviceScaleFactor: 1 } };
const problems = [];
try {
  for (const path of opt.paths) {
    for (const vp of viewports) {
      const page = await browser.newPage();
      await page.setViewport(VP[vp]);
      // geolocation off, no cookie banner in the demo
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${vp} ${path}] console: ${m.text()}`); });
      page.on('pageerror', (e) => problems.push(`[${vp} ${path}] pageerror: ${e.message}`));
      await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'networkidle0', timeout: 20000 }).catch((e) => problems.push(`[${vp} ${path}] goto: ${e.message}`));
      await new Promise((r) => setTimeout(r, opt.wait));
      for (const sel of opt.clicks) {
        try { await page.click(sel); } catch (e) { problems.push(`[${vp} ${path}] click ${sel}: ${e.message}`); }
        await new Promise((r) => setTimeout(r, 450));
      }
      const name = `${path.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_') || 'root'}-${vp}.png`;
      await page.screenshot({ path: join(opt.out, name), fullPage: opt.full });
      console.log(join(opt.out, name));
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
  process.exit(1);
}
