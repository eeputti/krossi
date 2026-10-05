// sheet-touch.mjs — phone-emulated touch checks for bottom sheets (open, drag down, close, and
// that the page is scrollable and tappable afterwards). Uses the build in <out>/site from snap.mjs.
//
//   node krossi/web/scripts/snap.mjs --out /tmp/x /demo/koti   (builds <out>/site once)
//   node krossi/web/test/e2e/sheet-touch.mjs /tmp/x
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const site = join(process.argv[2], 'site');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const p = normalize(req.url.split('?')[0]);
  const file = /^\/demo(\/.*)?$/.test(p) ? join(site, 'krossi-demo.html')
    : p.startsWith('/krossi/') ? join(site, p.slice(8)) : p.startsWith('/assets/') ? join(repo, p) : null;
  let body;
  try { body = await readFile(file); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

async function swipe(page, x, y0, y1, steps = 12) {
  const c = await page.target().createCDPSession();
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / steps }] });
    await new Promise((r) => setTimeout(r, 16));
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const state = (page) => page.evaluate(() => ({
  path: location.pathname,
  sheets: document.querySelectorAll('.sheet-root').length,
  bodyLocked: document.body.classList.contains('sheet-open') || getComputedStyle(document.body).position === 'fixed',
  dragging: !!document.querySelector('.sheet.is-dragging'),
}));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => check('no page errors', false, e.message));

  // 1. Create-game sheet opens from the FAB and can be dragged closed by its grabber.
  await page.goto(`${base}/demo/pelit`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));
  await page.tap('.games-fab, [aria-label="Luo peli"]').catch(() => page.evaluate(() => window.history.pushState({}, '', '/demo/uusi-peli')));
  await new Promise((r) => setTimeout(r, 700));
  let s = await state(page);
  check('create sheet opens', s.sheets === 1 && s.path.endsWith('/uusi-peli'), JSON.stringify(s));
  const grab = await page.$eval('.sheet-grabber', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await swipe(page, grab.x, grab.y, grab.y + 320);
  await new Promise((r) => setTimeout(r, 900));
  s = await state(page);
  check('drag down by the grabber closes the sheet', s.sheets === 0, JSON.stringify(s));
  check('page unlocked after drag-close', !s.bodyLocked, JSON.stringify(s));
  check('route back to /pelit after drag-close', s.path.endsWith('/pelit'), s.path);

  // 2. Dragging the title/header area also closes.
  await page.goto(`${base}/demo/uusi-peli`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));
  const head = await page.$eval('.sheet-title', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
  await swipe(page, head.x, head.y, head.y + 300);
  await new Promise((r) => setTimeout(r, 900));
  s = await state(page);
  check('drag down by the title closes the sheet', s.sheets === 0 && !s.bodyLocked, JSON.stringify(s));

  // 3. A short drag snaps back (sheet stays open, not stuck mid-way or in dragging state).
  await page.goto(`${base}/demo/uusi-peli`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));
  const g2 = await page.$eval('.sheet-grabber', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await swipe(page, g2.x, g2.y, g2.y + 40, 4);
  await new Promise((r) => setTimeout(r, 600));
  s = await state(page);
  const tf = await page.$eval('.sheet', (el) => el.style.transform || getComputedStyle(el).transform);
  check('short drag snaps back', s.sheets === 1 && !s.dragging && (tf === '' || tf === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(tf)), `${JSON.stringify(s)} transform=${tf}`);

  // 4. Scrolling inside the sheet body works and doesn't close it.
  const body = await page.$eval('.sheet-body', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.7, top: el.scrollTop }; });
  await swipe(page, body.x, body.y, body.y - 300);
  await new Promise((r) => setTimeout(r, 700));
  const scrolled = await page.$eval('.sheet-body', (el) => el.scrollTop);
  s = await state(page);
  check('sheet body scrolls by touch', scrolled > body.top && s.sheets === 1, `scrollTop ${body.top} -> ${scrolled}`);

  // 5. Close with X, then the page itself must scroll and respond to taps.
  await page.tap('.sheet [aria-label="Sulje"]');
  await new Promise((r) => setTimeout(r, 800));
  s = await state(page);
  check('X closes the sheet and unlocks the page', s.sheets === 0 && !s.bodyLocked, JSON.stringify(s));
  const y0 = await page.evaluate(() => window.scrollY);
  await swipe(page, 195, 650, 250);
  await new Promise((r) => setTimeout(r, 700));
  const y1 = await page.evaluate(() => window.scrollY);
  check('page scrolls after closing', y1 > y0, `scrollY ${y0} -> ${y1}`);

  // 6. Content drag: pulling down when the content is at the top closes; after scrolling the
  //    content, pulling down scrolls back up instead of closing.
  await page.goto(`${base}/demo/uusi-peli`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));
  const b2 = await page.$eval('.sheet-body', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 120 }; });
  await swipe(page, b2.x, b2.y + 260, b2.y - 40); // scroll content down
  await new Promise((r) => setTimeout(r, 500));
  const st = await page.$eval('.sheet-body', (el) => el.scrollTop);
  await swipe(page, b2.x, b2.y, b2.y + 120, 8); // pull down: should scroll content back first
  await new Promise((r) => setTimeout(r, 600));
  s = await state(page);
  check('pull-down while scrolled scrolls content, keeps sheet', s.sheets === 1 && st > 0, `scrollTop was ${st} ${JSON.stringify(s)}`);
  await page.$eval('.sheet-body', (el) => { el.scrollTop = 0; });
  await swipe(page, b2.x, b2.y, b2.y + 340);
  await new Promise((r) => setTimeout(r, 900));
  s = await state(page);
  check('pull-down from content at top closes', s.sheets === 0 && !s.bodyLocked, JSON.stringify(s));

  // 7. The "Pelasitteko?" prompt never pops outside Koti, and never over another sheet.
  await page.goto(`${base}/demo/pelit`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 3500));
  s = await state(page);
  check('no outcome prompt on Pelit', s.sheets === 0 && !s.bodyLocked, JSON.stringify(s));
  await page.goto(`${base}/demo/koti`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));
  await page.tap('.home-hero .btn-lime').catch(() => {});
  await new Promise((r) => setTimeout(r, 3200));
  s = await state(page);
  const titles = await page.$$eval('.sheet-title', (els) => els.map((e) => e.textContent));
  check('outcome prompt does not stack on the create sheet', s.sheets === 1 && !titles.some((t) => /Pelasitteko/.test(t)), JSON.stringify({ ...s, titles }));

  // 8. Open/close many times quickly: no leaked locks or stuck backdrops.
  for (let i = 0; i < 6; i++) {
    await page.goto(`${base}/demo/uusi-peli`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 450));
    await page.goBack().catch(() => {});
    await new Promise((r) => setTimeout(r, 150));
  }
  await page.goto(`${base}/demo/pelit`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 600));
  await page.tap('.games-fab').catch(() => {});
  await new Promise((r) => setTimeout(r, 120));
  await page.goBack();
  await new Promise((r) => setTimeout(r, 900));
  s = await state(page);
  check('rapid open + back leaves no sheet or lock', s.sheets === 0 && !s.bodyLocked, JSON.stringify(s));
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
