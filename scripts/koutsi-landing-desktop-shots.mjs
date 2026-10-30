// Takes the four app screens shown on the laptop on koutsi.krossi.app's front page
// (lib/koutsi-laptop.jsx) from the demo, so the laptop shows the real coach app on a computer:
// Suunnittele, Viikkohallinta, a player's page (attendance, fiilis, kehitys) and Laskutus.
// Run again whenever those screens change:
//
//   node scripts/koutsi-landing-desktop-shots.mjs                              (the live demo)
//   node scripts/koutsi-landing-desktop-shots.mjs http://localhost:4500/demo   (`npm run dev:koutsi`)
//
// The clock is pinned to a Wednesday morning so Viikkohallinta shows a week in progress. The demo
// bar is hidden, and so is Viestit, which the real app doesn't have yet: the front page shows only
// what a coach really gets. The screens are taller than the laptop's window, so the page can pan
// down to show more of each one.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const base = (process.argv[2] || 'https://demo.koutsi.krossi.app').replace(/\/$/, '');

const SHOTS = [
  { path: '/valmentaja/suunnittele', out: 'assets/koutsi-kone-suunnittele.webp' },
  { path: '/valmentaja/ryhmat', out: 'assets/koutsi-kone-viikko.webp' },
  { path: '/valmentaja/pelaaja/demo-s-ilona', out: 'assets/koutsi-kone-pelaaja.webp' },
  { path: '/valmentaja/laskutus', out: 'assets/koutsi-kone-laskutus.webp' },
];
// Wed 28.10.2026 klo 9.30 Helsinki time
const NOW = '2026-10-28T07:30:00Z';
// a laptop's browser window, 1280 wide; taller than the 16:10 screen so the page can pan down
const VIEWPORT = { width: 1280, height: 1120, deviceScaleFactor: 1.25 };
const CSS = `
  .top-banner { display: none !important; }
  * { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; caret-color: transparent !important; }
`;

const executablePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!executablePath) throw new Error('Chrome not found — set CHROME_PATH');

const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  for (const shot of SHOTS) {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.evaluateOnNewDocument((iso) => {
      const fixed = new Date(iso).getTime();
      const start = Date.now();
      const Real = Date;
      function FakeDate(...args) { return args.length ? new Real(...args) : new Real(fixed + (Real.now() - start)); }
      FakeDate.prototype = Real.prototype;
      FakeDate.now = () => fixed + (Real.now() - start);
      FakeDate.parse = Real.parse;
      FakeDate.UTC = Real.UTC;
      globalThis.Date = FakeDate;
    }, NOW);
    page.on('pageerror', (e) => console.warn(`${shot.path}: ${e.message}`));
    await page.goto(base + shot.path, { waitUntil: 'networkidle0' });
    await page.addStyleTag({ content: CSS });
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(() => {
      document.getElementById('krossi-cookie-banner')?.remove();
      // no demo bar, and no room kept for it (the side nav and sticky heads move up)
      document.querySelectorAll('.top-banner').forEach((el) => el.remove());
      document.querySelectorAll('.has-top-banner').forEach((el) => el.classList.remove('has-top-banner'));
      // Viestit isn't in the real app yet: its side-nav link and the player page's Viesti tile go
      document.querySelectorAll('a[href*="/viestit"]').forEach((a) => a.remove());
      [...document.querySelectorAll('button, a')].filter((el) => el.textContent.trim() === 'Viesti').forEach((el) => el.remove());
      window.scrollTo(0, 0);
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: join(root, shot.out), type: 'webp', quality: 80 });
    await page.close();
    console.log(`${shot.out}  ← ${base}${shot.path}`);
  }
} finally {
  await browser.close();
}
