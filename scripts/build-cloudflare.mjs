// Stages only browser-facing files for Cloudflare Workers Static Assets.
// Keeping the deployment output explicit prevents internal docs, environment files,
// Supabase migrations, and source-only files from becoming public web assets.

import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'cloudflare-dist');

// Krossi Koutsi and shared files, published at the same path they have in the repo.
const publicFiles = [
  'koutsi.html',
  'koutsi-demo.html',
  'koutsi-valmentaja.html',
  'koutsi-pelaaja.html',
  'koutsi-valmentaja-demo.html',
  'koutsi-pelaaja-demo.html',
  'koutsi-tietosuoja.html',
  'koutsi-kayttoehdot.html',
  'koutsi.webmanifest',
  'lib/koutsi-shared.css',
  'lib/cookie-consent.js',
  'dist/koutsi-landing.js',
  'dist/koutsi-valmentaja.js',
  'dist/koutsi-pelaaja.js',
  'dist/koutsi-valmentaja-demo.js',
  'dist/koutsi-pelaaja-demo.js',
];

// Krossi (krossi/web): [source in the repo, published path]. The landing page HTML is
// published unchanged and still loads its scripts from /lib/…; the web app bundle comes
// from `npm run build:krossi` and lives under /krossi/.
const KROSSI_WEB_DIST = 'krossi/web/dist';
const krossiFiles = [
  ['krossi/web/landing/index.html', 'index.html'],
  ['krossi/web/landing/tweaks-panel.jsx', 'lib/tweaks-panel.jsx'],
  ['krossi/web/landing/krossi-phone.jsx', 'lib/krossi-phone.jsx'],
  ['krossi/web/landing/krossi-landing.jsx', 'lib/krossi-landing.jsx'],
  [`${KROSSI_WEB_DIST}/app.html`, 'app.html'],
  [`${KROSSI_WEB_DIST}/krossi-demo.html`, 'krossi-demo.html'],
  [`${KROSSI_WEB_DIST}/krossi.webmanifest`, 'krossi.webmanifest'],
  [`${KROSSI_WEB_DIST}/app.js`, 'krossi/app.js'],
  [`${KROSSI_WEB_DIST}/demo.js`, 'krossi/demo.js'],
  [`${KROSSI_WEB_DIST}/app.css`, 'krossi/app.css'],
];

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const source = join(directory, entry.name);
    const destination = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(source, destination));
    else if (entry.isFile()) files.push(destination);
  }
  return files;
}

async function copy(sourcePath, publishedPath) {
  const destination = join(output, publishedPath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(root, sourcePath), destination);
}

// Without this check a missing or half-finished web build would quietly ship the wrong app.
const requiredBuildOutputs = [
  ...krossiFiles.map(([source]) => source).filter((source) => source.startsWith(`${KROSSI_WEB_DIST}/`)),
  `${KROSSI_WEB_DIST}/static`,
];
const missingBuildOutputs = requiredBuildOutputs.filter((path) => !existsSync(join(root, path)));
if (missingBuildOutputs.length) {
  console.error(
    `Krossin selainversion build puuttuu tai on keskeneräinen (${KROSSI_WEB_DIST}).\n` +
      `Puuttuu: ${missingBuildOutputs.join(', ')}\n` +
      'Aja ensin: npm run build:krossi',
  );
  process.exit(1);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const assetFiles = (await listFiles(join(root, 'assets'), 'assets')).sort();
const krossiStatic = (await listFiles(join(root, KROSSI_WEB_DIST, 'static'))).sort()
  .map((file) => [join(KROSSI_WEB_DIST, 'static', file), join('krossi/static', file)]);

const files = [
  ...publicFiles.map((file) => [file, file]),
  ...assetFiles.map((file) => [file, file]),
  ...krossiFiles,
  ...krossiStatic,
];
for (const [source, published] of files) await copy(source, published);

let totalBytes = 0;
for (const [, published] of files) totalBytes += (await stat(join(output, published))).size;

console.log(
  `${relative(root, output)}/  ${files.length} tiedostoa, ${(totalBytes / 1024 / 1024).toFixed(1)} Mt`,
);
