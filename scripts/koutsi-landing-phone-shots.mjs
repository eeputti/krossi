// Takes the player app screens shown on the phone on koutsi.krossi.app's front page
// (lib/koutsi-player-phone.jsx) from the demo, so the phone shows the real player app:
// Koti, Viikko, Merkitse, Kehitys and Harjoitteet ja videot. Run again whenever those screens change:
//
//   node scripts/koutsi-landing-phone-shots.mjs                              (the live demo)
//   node scripts/koutsi-landing-phone-shots.mjs http://localhost:4500/demo   (`npm run dev:koutsi`)
//
// Each screen gives two pictures: the page without its tab bar, taller than the phone so the
// front page can scroll it slowly (assets/koutsi-puhelin-<id>.webp), and the tab bar alone on a
// see-through background, which stays put at the bottom of the phone (-tabs.png). Merkitse is a
// sheet over the page, so it has no tab bar picture.
//
// The clock is pinned to a Wednesday morning, like the laptop's screens. The demo bar is hidden,
// and so is Viestit, which the real app doesn't have yet: the front page shows only what a
// player really gets.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const base = (process.argv[2] || 'https://demo.koutsi.krossi.app').replace(/\/$/, '');

const SHOTS = [
  { id: 'koti', path: '/pelaaja/koti' },
  { id: 'viikko', path: '/pelaaja/treenit' },
  { id: 'merkitse', path: '/pelaaja/koti', open: 'Merkitse' },
  { id: 'kehitys', path: '/pelaaja/kehitys' },
  { id: 'harjoitteet', path: '/pelaaja/harjoitteet' },
];
// Wed 28.10.2026 klo 9.30 Helsinki time
const NOW = '2026-10-28T07:30:00Z';
// an iPhone's width; the page picture is taller than the phone's screen so it can scroll
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const TALL = 1240;
// the screen under the phone's status bar (47 of 844): Merkitse is a sheet, shown as it is, no scroll
const UNDER_STATUS = 797;
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, shot, height) {
  const page = await browser.newPage();
  await page.setViewport({ ...PHONE, height });
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
  await wait(1500);
  await page.evaluate(() => {
    const cookie = document.getElementById('krossi-cookie-banner');
    if (cookie) cookie.style.display = 'none';
    // no demo bar, and no room kept for it
    document.querySelectorAll('.top-banner').forEach((el) => { el.style.display = 'none'; });
    document.querySelectorAll('.has-top-banner').forEach((el) => el.classList.remove('has-top-banner'));
    // Viestit isn't in the real app yet: Koti's chat button, "Vastaa valmentajalle", the
    // "Viesti valmentajalta" row and Merkitse's "Viesti valmentajalle" go
    document.querySelectorAll('button[aria-label^="Viestit"], a[href*="/viestit"]').forEach((el) => { el.style.display = 'none'; });
    [...document.querySelectorAll('button, a')]
      .filter((el) => /^(Vastaa valmentajalle|Viesti valmentaja)/.test(el.textContent.trim()))
      .forEach((el) => { el.style.display = 'none'; });
    window.scrollTo(0, 0);
  });
  if (shot.open) {
    const buttons = await page.$$('button');
    for (const b of buttons) {
      if ((await b.evaluate((el) => el.textContent.trim())) === shot.open) { await b.click(); break; }
    }
    await wait(1000);
  }
  await wait(400);
  return page;
}

const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  for (const shot of SHOTS) {
    // the page, tall, without its tab bar
    const page = await open(browser, shot, shot.open ? UNDER_STATUS : TALL);
    if (!shot.open) await page.addStyleTag({ content: '.tabbar { visibility: hidden !important; }' });
    await wait(200);
    const out = `assets/koutsi-puhelin-${shot.id}.webp`;
    await page.screenshot({ path: join(root, out), type: 'webp', quality: 80 });
    await page.close();
    console.log(`${out}  ← ${base}${shot.path}`);
    if (shot.open) continue;

    // the tab bar alone, at the phone's real height, on a see-through background
    const bar = await open(browser, shot, PHONE.height);
    await bar.addStyleTag({ content: `
      html, body { background: transparent !important; }
      body * { visibility: hidden !important; }
      .tabbar, .tabbar * { visibility: visible !important; }
      /* the app's bar is see-through with a blur; a picture can't blur what scrolls under it */
      .tabbar { background: #fff !important; }
    ` });
    await wait(200);
    const box = await bar.evaluate(() => {
      const nav = document.querySelector('.tabbar').getBoundingClientRect();
      const tops = [...document.querySelectorAll('.tabbar *')].map((el) => el.getBoundingClientRect().top);
      return { top: Math.floor(Math.min(nav.top, ...tops)) - 2, bottom: Math.ceil(nav.bottom) };
    });
    const tabsOut = `assets/koutsi-puhelin-${shot.id}-tabs.png`;
    await bar.screenshot({ path: join(root, tabsOut), omitBackground: true, clip: { x: 0, y: box.top, width: PHONE.width, height: box.bottom - box.top } });
    await bar.close();
    console.log(`${tabsOut}  (${box.bottom - box.top} px high)`);
  }
} finally {
  await browser.close();
}
