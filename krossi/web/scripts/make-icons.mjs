// make-icons.mjs — renders the app icons and the link-preview image with headless Chrome.
//
//   node krossi/web/scripts/make-icons.mjs
//
// Writes krossi/web/static/{icon-180,icon-192,icon-512,icon-512-maskable,og-image}.png.
// Re-run only when the brand artwork changes; the PNGs are committed.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const repo = join(web, '..', '..');
const out = join(web, 'static');

// The brand ball: lime with the two white seams of the app icon, drawn as SVG so it has a
// transparent background at any size.
const ballSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="g" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#E4F25A"/><stop offset=".7" stop-color="#CFE414"/><stop offset="1" stop-color="#B9CC0E"/></radialGradient><clipPath id="c"><circle cx="50" cy="50" r="46"/></clipPath></defs><circle cx="50" cy="50" r="46" fill="url(#g)"/><g clip-path="url(#c)" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round"><path d="M10 30c18-6 40-4 56 8s22 22 28 32"/><path d="M30 80c14 7 34 6 50-6"/></g></svg>`;
const ball = `data:image/svg+xml;base64,${Buffer.from(ballSvg).toString('base64')}`;
const court = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 480" fill="none" stroke="white" stroke-width="3"><rect x="10" y="10" width="340" height="460" rx="2"/><path d="M52 10v460M308 10v460M52 132h256M52 348h256M180 132v216"/><path d="M0 240h360" stroke-dasharray="3 7"/></svg>`;

const iconHtml = (size, pad) => `<!doctype html><html><body style="margin:0">
<div style="width:${size}px;height:${size}px;background:radial-gradient(120% 120% at 30% 20%, #1E6B52 0%, #0E3B2C 55%, #0A2C20 100%);display:grid;place-items:center;overflow:hidden;position:relative">
  <div style="position:absolute;inset:-10%;opacity:.12;transform:rotate(-14deg);background:url('data:image/svg+xml;utf8,${encodeURIComponent(court)}') center/70% no-repeat"></div>
  <img src="${ball}" style="width:${Math.round(size * (1 - pad * 2))}px;height:auto;position:relative;filter:drop-shadow(0 ${size * 0.02}px ${size * 0.04}px rgba(0,0,0,.35))">
</div></body></html>`;

const ogHtml = `<!doctype html><html><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif">
<div style="width:1200px;height:630px;background:radial-gradient(110% 130% at 85% 10%, #1E6B52 0%, #0E3B2C 50%, #0A2C20 100%);position:relative;overflow:hidden;color:#fff">
  <div style="position:absolute;right:-60px;top:-120px;width:620px;height:860px;opacity:.13;transform:rotate(-14deg);background:url('data:image/svg+xml;utf8,${encodeURIComponent(court)}') center/contain no-repeat"></div>
  <img src="${ball}" style="position:absolute;right:120px;top:150px;width:330px;filter:drop-shadow(0 30px 40px rgba(0,0,0,.35))">
  <div style="position:absolute;left:90px;top:120px">
    <div style="font-size:150px;font-weight:800;letter-spacing:-6px;color:#CFE414;line-height:1">Krossi</div>
    <div style="margin-top:28px;font-size:46px;font-weight:750;letter-spacing:-1px;line-height:1.15;max-width:640px">Löydä pelikaveri.<br>Sovi peli. Pelaa.</div>
    <div style="margin-top:34px;display:inline-flex;align-items:center;gap:12px;background:#CFE414;color:#101A08;font-size:26px;font-weight:800;padding:16px 28px;border-radius:999px">krossi.app 🎾</div>
  </div>
</div></body></html>`;

const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const shoot = async (html, w, h, file) => {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: join(out, file), clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  console.log(`krossi/web/static/${file}`);
};
try {
  await shoot(iconHtml(180, 0.17), 180, 180, 'icon-180.png');
  await shoot(iconHtml(192, 0.17), 192, 192, 'icon-192.png');
  await shoot(iconHtml(512, 0.17), 512, 512, 'icon-512.png');
  await shoot(iconHtml(512, 0.26), 512, 512, 'icon-512-maskable.png');
  await shoot(ogHtml, 1200, 630, 'og-image.png');
} finally {
  await browser.close();
}
