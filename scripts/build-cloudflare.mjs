// Stages only browser-facing files for Cloudflare Workers Static Assets.
// Keeping the deployment output explicit prevents internal docs, environment files,
// Supabase migrations, and source-only files from becoming public web assets.

import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'cloudflare-dist');

const publicFiles = [
  'index.html',
  'app.html',
  'koutsi.html',
  'koutsi-demo.html',
  'koutsi-valmentaja.html',
  'koutsi-pelaaja.html',
  'koutsi-valmentaja-demo.html',
  'koutsi-pelaaja-demo.html',
  'koutsi-tietosuoja.html',
  'koutsi-kayttoehdot.html',
  'koutsi.webmanifest',
  'lib/tweaks-panel.jsx',
  'lib/krossi-phone.jsx',
  'lib/krossi-landing.jsx',
  'lib/krossi-web-app.jsx',
  'lib/koutsi-shared.css',
  'lib/cookie-consent.js',
  'dist/koutsi-landing.js',
  'dist/koutsi-valmentaja.js',
  'dist/koutsi-pelaaja.js',
  'dist/koutsi-valmentaja-demo.js',
  'dist/koutsi-pelaaja-demo.js',
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

async function copy(relativePath) {
  const source = join(root, relativePath);
  const destination = join(output, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const assetFiles = (await listFiles(join(root, 'assets'), 'assets')).sort();
const files = [...publicFiles, ...assetFiles];
for (const file of files) await copy(file);

let totalBytes = 0;
for (const file of files) totalBytes += (await stat(join(output, file))).size;

console.log(
  `${relative(root, output)}/  ${files.length} tiedostoa, ${(totalBytes / 1024 / 1024).toFixed(1)} Mt`,
);
