// harness.mjs — shared helpers for phone-emulated end-to-end checks against the demo build.
//
//   import { startHarness } from './harness.mjs';
//   const h = await startHarness(process.argv[2]);          // <out> dir that has <out>/site (snap.mjs build)
//   const page = await h.phone();                            // 390×844 touch phone (or h.phone({ width: 360 }))
//   await page.goto(h.url('/demo/pelit'), { waitUntil: 'networkidle0' });
//   await h.tapText(page, 'Liity peliin');                   // tap the first visible element with this text
//   await h.swipe(page, x, y0, y1);                          // touch drag
//   h.check('name', ok, detail);                             // records PASS/FAIL
//   await h.finish();                                        // closes everything, exits 1 on any FAIL
//
// Every page gets: console errors + page errors recorded as FAILs, and h.state(page) for
// { path, sheets, bodyLocked, dragging, toasts }.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

export async function startHarness(outDir, { name = 'e2e' } = {}) {
  const site = join(outDir, 'site');
  const server = createServer(async (req, res) => {
    let p;
    try { p = normalize(decodeURIComponent(req.url.split('?')[0])); } catch { p = req.url.split('?')[0]; }
    const file = /^\/demo(\/.*)?$/.test(p) ? join(site, 'krossi-demo.html')
      : /^\/pelaa(\/.*)?$/.test(p) ? join(site, 'app.html')
        : p.startsWith('/krossi/') ? join(site, p.slice(8))
          : p.startsWith('/assets/') ? join(repo, p)
            : p === '/lib/cookie-consent.js' ? join(repo, 'lib/cookie-consent.js') : null;
    let body;
    try { body = await readFile(file); } catch { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  const results = [];

  const check = (label, ok, detail = '') => {
    results.push({ label, ok: Boolean(ok), detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
  };

  async function phone({ width = 390, height = 844 } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    page.on('pageerror', (e) => check(`no page error`, false, e.message.slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') check('no console error', false, m.text().slice(0, 200)); });
    return page;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function swipe(page, x, y0, y1, { steps = 12, x1 = x } = {}) {
    const c = await page.target().createCDPSession();
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= steps; i++) {
      await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + ((x1 - x) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
      await wait(16);
    }
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await c.detach().catch(() => {});
  }

  /** Taps the centre of the first visible element whose text (or aria-label) contains `text`. */
  async function tapText(page, text, { selector = 'button, a, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], label' } = {}) {
    const box = await page.evaluate((t, sel) => {
      const els = [...document.querySelectorAll(sel)];
      const el = els.find((e) => {
        const r = e.getBoundingClientRect();
        const label = `${e.textContent || ''} ${e.getAttribute('aria-label') || ''}`;
        return r.width > 0 && r.height > 0 && label.includes(t) && getComputedStyle(e).visibility !== 'hidden';
      });
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, text, selector);
    if (!box) return false;
    await page.touchscreen.tap(box.x, box.y);
    return true;
  }

  const state = (page) => page.evaluate(() => ({
    path: location.pathname + location.search,
    sheets: document.querySelectorAll('.sheet-root:not(.is-closing)').length,
    bodyLocked: document.body.classList.contains('sheet-open') || getComputedStyle(document.body).position === 'fixed',
    dragging: Boolean(document.querySelector('.sheet.is-dragging')),
    toasts: [...document.querySelectorAll('.toast-text')].map((t) => t.textContent),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));

  async function finish() {
    await browser.close();
    server.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n[${name}] ${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
  }

  return { url: (p) => base + p, phone, swipe, tapText, state, check, wait, finish, browser };
}
