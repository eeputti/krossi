import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import worker, { resolveAssetPath } from '../src/worker.js';

const routes = [
  ['https://krossi.app/', '/index.html'],
  ['https://www.krossi.app/', '/index.html'],
  ['https://krossi.app/pelaa', '/app.html'],
  ['https://krossi.app/pelaa/pelaajat', '/app.html'],
  ['https://krossi.app/pelaa/avoimet/', '/app.html'],
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

test('maps the existing host and deep-link routes', () => {
  for (const [url, expected] of routes) assert.equal(resolveAssetPath(url), expected, url);
});

test('does not turn unknown or overly deep paths into app pages', () => {
  assert.equal(resolveAssetPath('https://koutsi.krossi.app/tuntematon'), null);
  assert.equal(resolveAssetPath('https://koutsi.krossi.app/valmentaja/a/b'), null);
  assert.equal(resolveAssetPath('https://krossi.app/pelaa/pelaajat/a'), null);
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

test('landing pages ship prerendered content instead of an empty #root', async () => {
  const output = join(import.meta.dirname, '..', 'cloudflare-dist');
  for (const file of ['index.html', 'koutsi.html']) {
    const html = await readFile(join(output, file), 'utf8');
    assert.doesNotMatch(html, /<div id="root">\s*<\/div>/, file);
    assert.match(html, /<div id="root">.{200,}/s, file);
  }
});

test('robots.txt disallows auth-gated app views and points to the host sitemap', async () => {
  const env = { ASSETS: { fetch: async () => new Response('unused') } };
  const krossi = await worker.fetch(new Request('https://krossi.app/robots.txt'), env);
  const krossiBody = await krossi.text();
  assert.match(krossiBody, /Disallow: \/pelaa/);
  assert.match(krossiBody, /Sitemap: https:\/\/krossi\.app\/sitemap\.xml/);

  const koutsi = await worker.fetch(new Request('https://koutsi.krossi.app/robots.txt'), env);
  const koutsiBody = await koutsi.text();
  assert.match(koutsiBody, /Disallow: \/valmentaja/);
  assert.match(koutsiBody, /Disallow: \/pelaaja/);
  assert.match(koutsiBody, /Sitemap: https:\/\/koutsi\.krossi\.app\/sitemap\.xml/);

  const demo = await worker.fetch(new Request('https://demo.koutsi.krossi.app/robots.txt'), env);
  assert.match(await demo.text(), /Disallow: \/\s*$/m);
});

test('sitemap.xml lists only public marketing/legal pages per host', async () => {
  const env = { ASSETS: { fetch: async () => new Response('unused') } };
  const krossi = await worker.fetch(new Request('https://www.krossi.app/sitemap.xml'), env);
  const krossiBody = await krossi.text();
  assert.match(krossiBody, /<loc>https:\/\/krossi\.app\/<\/loc>/);
  assert.doesNotMatch(krossiBody, /pelaa/);

  const koutsi = await worker.fetch(new Request('https://koutsi.krossi.app/sitemap.xml'), env);
  const koutsiBody = await koutsi.text();
  assert.match(koutsiBody, /<loc>https:\/\/koutsi\.krossi\.app\/<\/loc>/);
  assert.match(koutsiBody, /<loc>https:\/\/koutsi\.krossi\.app\/tietosuoja<\/loc>/);
  assert.match(koutsiBody, /<loc>https:\/\/koutsi\.krossi\.app\/kayttoehdot<\/loc>/);
  assert.doesNotMatch(koutsiBody, /valmentaja|pelaaja/);
});
