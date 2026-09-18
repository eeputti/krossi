// Bakes real marketing copy into the shipped HTML for the two client-rendered
// landing pages (index.html / koutsi.html) so Google (and anyone with JS off)
// sees the actual content immediately instead of an empty <div id="root">.
//
// Runs a real browser against the built cloudflare-dist output, waits for
// React to mount, then freezes the resulting #root markup into the file on
// disk. The page's own script tags are left in place, so React still mounts
// on top for interactivity — createRoot().render() just replaces the frozen
// markup with an identical live render, no hydration involved.
//
//   npm run build:cloudflare   (runs this automatically as the last step)

import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'cloudflare-dist');

const PAGES = ['index.html', 'koutsi.html'];

// The pages load in-browser Babel, which fetches sibling .jsx files via XHR —
// that's blocked by CORS under file://, so this serves cloudflare-dist over a
// throwaway local HTTP server instead (same fix a browser would need in prod).
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.jsx': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function startServer() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(req.url.split('?')[0]));
    const filePath = join(output, path);
    if (!filePath.startsWith(output)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((path) => existsSync(path));
if (!executablePath) {
  console.error(
    'Esirenderöinti vaatii paikallisen Chrome/Chromium-selaimen.\n' +
      'Asenna Google Chrome, tai aseta CHROME_PATH osoittamaan selaimen binääriin.',
  );
  process.exit(1);
}

const server = await startServer();
const { port } = server.address();
const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  for (const file of PAGES) {
    const path = join(output, file);
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/${file}`, { waitUntil: 'networkidle0' });
    const rootHtml = await page.$eval('#root', (el) => el.innerHTML);
    await page.close();

    if (!rootHtml.trim()) {
      console.error(`${file}: #root jäi tyhjäksi renderöinnin jälkeen, keskeytetään.`);
      process.exit(1);
    }

    const html = await readFile(path, 'utf8');
    const updated = html.replace('<div id="root"></div>', `<div id="root">${rootHtml}</div>`);
    if (updated === html) {
      console.error(`${file}: <div id="root"></div> -kohtaa ei löytynyt, ei mitään korvattavaa.`);
      process.exit(1);
    }
    await writeFile(path, updated, 'utf8');
    console.log(`${file}  esirenderöity (${(rootHtml.length / 1024).toFixed(1)} kB)`);
  }
} finally {
  await browser.close();
  server.close();
}
