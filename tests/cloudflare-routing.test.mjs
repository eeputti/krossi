import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import worker, { resolveAssetPath } from '../src/worker.js';

const routes = [
  ['https://krossi.app/', '/index.html'],
  ['https://www.krossi.app/', '/index.html'],
  ['https://krossi.app/pelaa', '/app.html'],
  ['https://koutsi.krossi.app/', '/koutsi.html'],
  ['https://koutsi.krossi.app/valmentaja', '/koutsi-valmentaja.html'],
  ['https://koutsi.krossi.app/valmentaja/oppilaat?auth=login', '/koutsi-valmentaja.html'],
  ['https://koutsi.krossi.app/pelaaja', '/koutsi-pelaaja.html'],
  ['https://koutsi.krossi.app/pelaaja/treenit/', '/koutsi-pelaaja.html'],
  ['https://koutsi.krossi.app/tietosuoja', '/koutsi-tietosuoja.html'],
  ['https://koutsi.krossi.app/kayttoehdot', '/koutsi-kayttoehdot.html'],
  ['https://demo.koutsi.krossi.app/', '/koutsi-demo.html'],
  ['https://demo.koutsi.krossi.app/valmentaja', '/koutsi-valmentaja-demo.html'],
  ['https://demo.koutsi.krossi.app/pelaaja/treenit', '/koutsi-pelaaja-demo.html'],
  ['https://preview.example.workers.dev/', '/index.html'],
];

test('maps the existing Vercel host and deep-link routes', () => {
  for (const [url, expected] of routes) assert.equal(resolveAssetPath(url), expected, url);
});

test('does not turn unknown or overly deep paths into app pages', () => {
  assert.equal(resolveAssetPath('https://koutsi.krossi.app/tuntematon'), null);
  assert.equal(resolveAssetPath('https://koutsi.krossi.app/valmentaja/a/b'), null);
});

test('worker preserves query parameters while rewriting the asset path', async () => {
  const env = {
    ASSETS: {
      fetch: async (request) => new Response(request.url),
    },
  };
  const response = await worker.fetch(
    new Request('https://koutsi.krossi.app/pelaaja?auth=login&koodi=ABC'),
    env,
  );
  assert.equal(
    await response.text(),
    'https://koutsi.krossi.app/koutsi-pelaaja.html?auth=login&koodi=ABC',
  );
});

test('every routed HTML file exists in the staged deployment', async () => {
  const output = join(import.meta.dirname, '..', 'cloudflare-dist');
  for (const assetPath of new Set(routes.map(([, path]) => path))) {
    await access(join(output, assetPath.slice(1)));
  }
});

test('deployment output excludes secrets and backend implementation files', async () => {
  const output = join(import.meta.dirname, '..', 'cloudflare-dist');
  await assert.rejects(access(join(output, '.env.local')));
  await assert.rejects(access(join(output, 'supabase')));
  await assert.rejects(access(join(output, 'KOUTSI-DPA-CHECKLIST.md')));
});
