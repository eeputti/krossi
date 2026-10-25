// Takes the two app screens shown in the phones on koutsi.krossi.app's front page
// (lib/koutsi-phone.jsx) from the live demo, so the phones look exactly like the real app.
// Run again whenever the app's Koti screens change:
//
//   node scripts/koutsi-landing-shots.mjs            (from the live demo host)
//   node scripts/koutsi-landing-shots.mjs http://localhost:4500   (from `npm run dev:koutsi`)
//
// The clock is pinned to a Wednesday morning so the coach's Koti shows the day's trainings,
// the demo bar and the "teema puuttuu" notice are hidden, and the tab bar gets the home-bar
// space it has on an iPhone.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const host = (process.argv[2] || 'https://demo.koutsi.krossi.app').replace(/\/$/, '');

const SHOTS = [
  { path: '/valmentaja', out: 'assets/koutsi-app-valmentaja.webp' },
  { path: '/pelaaja', out: 'assets/koutsi-app-pelaaja.webp' },
];
// Wed 21.10.2026 klo 9.30 Helsinki time
const NOW = '2026-10-21T06:30:00Z';
// The phone's screen below its status bar is 375 × 748 points (see PhoneFrame).
const VIEWPORT = { width: 375, height: 748, deviceScaleFactor: 1.6, isMobile: true, hasTouch: true };
const CSS = `
  .top-banner { display: none !important; }
  .wk-theme-top { display: none !important; }
  :root { --safe-bottom: 22px !important; }
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
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
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
    await page.goto(host + shot.path, { waitUntil: 'networkidle0' });
    await page.addStyleTag({ content: CSS });
    await page.evaluate(() => document.getElementById('krossi-cookie-banner')?.remove());
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: join(root, shot.out), type: 'webp', quality: 90 });
    await page.close();
    console.log(`${shot.out}  ← ${host}${shot.path}`);
  }
} finally {
  await browser.close();
}
