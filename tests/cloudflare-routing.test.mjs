import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import worker, {
  formatShareTime,
  gameShareMeta,
  injectShareMeta,
  inviteShareMeta,
  resolveAssetPath,
  shareTargetFor,
} from '../src/worker.js';
// Byte-for-byte copy of src/worker.js from before the Krossi web rebuild
// (git show caa4059:src/worker.js). Koutsi hosts must keep behaving exactly like it.
import previousWorker, { resolveAssetPath as previousResolveAssetPath } from './fixtures/worker-before-krossi-web.js';

const GAME_ID = '3f2b8c1e-7a4d-4e9b-9c11-0d5e6f7a8b9c';

const routes = [
  ['https://krossi.app/', '/index.html'],
  ['https://www.krossi.app/', '/index.html'],
  ['https://krossi.app/pelaa', '/app.html'],
  ['https://krossi.app/pelaa/pelaajat', '/app.html'],
  ['https://krossi.app/pelaa/avoimet/', '/app.html'],
  ['https://krossi.app/pelaa/pelaajat/a', '/app.html'],
  [`https://krossi.app/pelaa/peli/${GAME_ID}`, '/app.html'],
  ['https://krossi.app/pelaa/viestit/9d0c2a44-2b1f-4f53-a1a4-6e2b4a8f0c11', '/app.html'],
  ['https://krossi.app/pelaa/asetukset/estetyt', '/app.html'],
  ['https://krossi.app/pelaa/kooste/kausi-2026?dia=3', '/app.html'],
  ['https://krossi.app/pelaa/a/b/c/', '/app.html'],
  ['https://www.krossi.app/pelaa/kutsu/ABC234', '/app.html'],
  ['https://krossi.app/demo', '/krossi-demo.html'],
  ['https://krossi.app/demo/', '/krossi-demo.html'],
  ['https://krossi.app/demo/pelit', '/krossi-demo.html'],
  [`https://www.krossi.app/demo/peli/${GAME_ID}/`, '/krossi-demo.html'],
  ['https://krossi.app/demo/a/b/c', '/krossi-demo.html'],
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
  ['https://preview.example.workers.dev/demo/viestit', '/krossi-demo.html'],
];

// Never let a test reach the real Supabase project: every test that can trigger the
// share-preview lookup installs its own fetch stub through this helper.
async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const refuseNetwork = async (url) => {
  throw new Error(`unexpected network request to ${url}`);
};

test('maps the existing host and deep-link routes', () => {
  for (const [url, expected] of routes) assert.equal(resolveAssetPath(url), expected, url);
});

test('does not turn unknown or overly deep paths into app pages', () => {
  assert.equal(resolveAssetPath('https://koutsi.krossi.app/tuntematon'), null);
  assert.equal(resolveAssetPath('https://koutsi.krossi.app/valmentaja/a/b'), null);
  assert.equal(resolveAssetPath('https://krossi.app/pelaa/a/b/c/d'), null);
  assert.equal(resolveAssetPath('https://krossi.app/demo/a/b/c/d'), null);
  assert.equal(resolveAssetPath('https://krossi.app/pelaaja'), null);
  assert.equal(resolveAssetPath('https://krossi.app/pelaat'), null);
  assert.equal(resolveAssetPath('https://krossi.app/demot'), null);
  // The new Krossi routes don't leak onto the Koutsi hosts.
  assert.equal(resolveAssetPath('https://koutsi.krossi.app/demo'), null);
  assert.equal(resolveAssetPath(`https://koutsi.krossi.app/pelaa/peli/${GAME_ID}`), null);
  assert.equal(resolveAssetPath('https://demo.koutsi.krossi.app/demo/pelit'), null);
});

// Every path shape the Koutsi hosts could plausibly receive, including ones that are
// only meaningful on krossi.app, so a Krossi routing change can't silently reach Koutsi.
const KOUTSI_PATHS = [
  '/', '//', '/index.html', '/app.html', '/koutsi.html', '/koutsi-demo.html',
  '/valmentaja', '/valmentaja/', '/valmentaja/oppilaat', '/valmentaja/oppilaat/', '/valmentaja/ryhmat?auth=login',
  '/valmentaja/a/b', '/valmentaja//', '/valmentajat', '/Valmentaja',
  '/pelaaja', '/pelaaja/', '/pelaaja/treenit', '/pelaaja/treenit/', '/pelaaja/treenit?koodi=ABC', '/pelaaja/a/b',
  '/pelaajat', '/tietosuoja', '/tietosuoja/', '/tietosuoja/x', '/kayttoehdot', '/kayttoehdot/', '/kayttoehdot/x',
  '/pelaa', '/pelaa/', '/pelaa/pelaajat', '/pelaa/pelaajat/', `/pelaa/peli/${GAME_ID}`, '/pelaa/viestit/abc',
  '/pelaa/asetukset/estetyt', '/pelaa/kutsu/ABC234', '/pelaa/a/b/c', '/pelaa/a/b/c/d', '/pelaa//', '/PELAA',
  '/demo', '/demo/', '/demo/pelit', '/demo/a/b/c', '/krossi-demo.html',
  '/assets/ball-tight.png', '/dist/koutsi-landing.js', '/lib/cookie-consent.js', '/krossi/app.js',
  '/robots.txt', '/sitemap.xml', '/tuntematon', '/%70elaa', '/valmentaja/%2F', '/pelaa/%C3%A4',
];
const KOUTSI_ORIGINS = [
  'https://koutsi.krossi.app', 'https://demo.koutsi.krossi.app',
  'http://koutsi.krossi.app', 'https://koutsi.krossi.app:8787', 'http://demo.koutsi.krossi.app:8787',
];

test('every Koutsi host path resolves exactly as it did before the Krossi web rebuild', () => {
  let checked = 0;
  for (const origin of KOUTSI_ORIGINS) {
    for (const path of KOUTSI_PATHS) {
      const url = `${origin}${path}`;
      assert.equal(resolveAssetPath(url), previousResolveAssetPath(url), url);
      assert.equal(resolveAssetPath(new URL(url)), previousResolveAssetPath(new URL(url)), `URL ${url}`);
      assert.equal(resolveAssetPath(new Request(url)), previousResolveAssetPath(new Request(url)), `Request ${url}`);
      checked += 1;
    }
  }
  assert.equal(checked, KOUTSI_ORIGINS.length * KOUTSI_PATHS.length);
});

test('the worker answers every Koutsi request exactly like before, without network calls', async () => {
  const echoAssets = { ASSETS: { fetch: async (request) => new Response(`${request.method} ${request.url}`, { headers: { 'content-type': 'text/html' } }) } };
  await withFetch(refuseNetwork, async () => {
    for (const origin of KOUTSI_ORIGINS) {
      for (const path of KOUTSI_PATHS) {
        const url = `${origin}${path}`;
        const [now, before] = await Promise.all([
          worker.fetch(new Request(url), echoAssets),
          previousWorker.fetch(new Request(url), echoAssets),
        ]);
        assert.equal(now.status, before.status, url);
        assert.equal(now.headers.get('content-type'), before.headers.get('content-type'), url);
        assert.equal(await now.text(), await before.text(), url);
      }
    }
  });
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

  const demo = await worker.fetch(new Request('https://krossi.app/demo/pelit?suodatin=sisa'), env);
  assert.equal(await demo.text(), 'https://krossi.app/krossi-demo.html?suodatin=sisa');
});

test('every routed HTML file exists in the staged deployment', async () => {
  const output = join(import.meta.dirname, '..', 'cloudflare-dist');
  for (const assetPath of new Set(routes.map(([, path]) => path))) {
    await access(join(output, assetPath.slice(1)));
  }
});

test('staged deployment ships the new Krossi web bundle and drops the old app', async () => {
  const output = join(import.meta.dirname, '..', 'cloudflare-dist');
  for (const file of ['app.html', 'krossi-demo.html', 'krossi.webmanifest', 'krossi/app.js', 'krossi/demo.js', 'krossi/app.css']) {
    await access(join(output, file));
  }
  await assert.rejects(access(join(output, 'lib/krossi-web-app.jsx')));
  const appHtml = await readFile(join(output, 'app.html'), 'utf8');
  assert.match(appHtml, /<script src="\/krossi\/app\.js"/);
  assert.match(appHtml, /<title>Krossi — Selainversio<\/title>/);
});

test('deployment output excludes secrets and backend implementation files', async () => {
  const output = join(import.meta.dirname, '..', 'cloudflare-dist');
  await assert.rejects(access(join(output, '.env.local')));
  await assert.rejects(access(join(output, 'supabase')));
  await assert.rejects(access(join(output, 'KOUTSI-DPA-CHECKLIST.md')));
  await assert.rejects(access(join(output, 'krossi/web')));
  await assert.rejects(access(join(output, 'tests')));
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
  assert.match(krossiBody, /Disallow: \/demo/);
  assert.match(krossiBody, /Sitemap: https:\/\/krossi\.app\/sitemap\.xml/);

  const koutsi = await worker.fetch(new Request('https://koutsi.krossi.app/robots.txt'), env);
  const koutsiBody = await koutsi.text();
  assert.match(koutsiBody, /Disallow: \/valmentaja/);
  assert.match(koutsiBody, /Disallow: \/pelaaja/);
  assert.match(koutsiBody, /Sitemap: https:\/\/koutsi\.krossi\.app\/sitemap\.xml/);
  assert.doesNotMatch(koutsiBody, /\/demo/);

  const demo = await worker.fetch(new Request('https://demo.koutsi.krossi.app/robots.txt'), env);
  assert.match(await demo.text(), /Disallow: \/\s*$/m);
});

test('robots.txt and sitemap.xml are unchanged for the Koutsi hosts', async () => {
  const env = { ASSETS: { fetch: async () => new Response('unused') } };
  for (const origin of KOUTSI_ORIGINS) {
    for (const file of ['/robots.txt', '/sitemap.xml']) {
      const [now, before] = await Promise.all([
        worker.fetch(new Request(`${origin}${file}`), env),
        previousWorker.fetch(new Request(`${origin}${file}`), env),
      ]);
      assert.equal(now.headers.get('content-type'), before.headers.get('content-type'), `${origin}${file}`);
      assert.equal(await now.text(), await before.text(), `${origin}${file}`);
    }
  }
});

test('sitemap.xml lists only public marketing/legal pages per host', async () => {
  const env = { ASSETS: { fetch: async () => new Response('unused') } };
  const krossi = await worker.fetch(new Request('https://www.krossi.app/sitemap.xml'), env);
  const krossiBody = await krossi.text();
  assert.match(krossiBody, /<loc>https:\/\/krossi\.app\/<\/loc>/);
  assert.doesNotMatch(krossiBody, /pelaa|demo/);

  const koutsi = await worker.fetch(new Request('https://koutsi.krossi.app/sitemap.xml'), env);
  const koutsiBody = await koutsi.text();
  assert.match(koutsiBody, /<loc>https:\/\/koutsi\.krossi\.app\/<\/loc>/);
  assert.match(koutsiBody, /<loc>https:\/\/koutsi\.krossi\.app\/tietosuoja<\/loc>/);
  assert.match(koutsiBody, /<loc>https:\/\/koutsi\.krossi\.app\/kayttoehdot<\/loc>/);
  assert.doesNotMatch(koutsiBody, /valmentaja|pelaaja/);
});

// ── Open Graph cards for shared links ────────────────────────────────────────

test('share targets are only game and invite links', () => {
  assert.deepEqual(shareTargetFor(`/pelaa/peli/${GAME_ID.toUpperCase()}/`), { kind: 'game', id: GAME_ID });
  assert.deepEqual(shareTargetFor('/pelaa/kutsu/abc234'), { kind: 'invite', code: 'ABC234' });
  assert.equal(shareTargetFor('/pelaa/peli/ei-uuid'), null);
  assert.equal(shareTargetFor(`/pelaa/peli/${GAME_ID}/chat`), null);
  assert.equal(shareTargetFor('/pelaa/kutsu/a<b>'), null);
  assert.equal(shareTargetFor('/pelaa/pelit'), null);
});

test('share times are Finnish local time across daylight saving', () => {
  assert.equal(formatShareTime('2025-10-03T15:00:00Z'), 'pe 3.10. klo 18'); // UTC+3
  assert.equal(formatShareTime('2026-01-09T16:30:00Z'), 'pe 9.1. klo 18.30'); // UTC+2
  assert.equal(formatShareTime('2026-03-29T06:05:00Z'), 'su 29.3. klo 9.05'); // first summer-time morning
  assert.equal(formatShareTime(null), null);
  assert.equal(formatShareTime('ei päivä'), null);
});

test('game share card says who, when, where and how many spots are left', () => {
  const preview = {
    id: GAME_ID, kind: 'open', status: 'open', creator_name: 'Alex', creator_avatar_color: 'blue',
    match_type: 'kaksinpeli', location: 'Kispi Areena', location_type: 'sisätennis', city: 'Lahti',
    scheduled_at: '2025-10-03T15:00:00Z', title: null, spots_left: 1, participant_count: 0,
  };
  assert.deepEqual(gameShareMeta(preview), {
    title: 'Alex hakee pelikaveria — pe 3.10. klo 18',
    description: 'Kaksinpeli · Kispi Areena, Lahti · 1 paikka vapaana. Liity Krossissa.',
  });
  assert.deepEqual(gameShareMeta({ ...preview, match_type: 'nelinpeli', spots_left: 3, location: 'Avoin', location_type: 'ulkotennis' }), {
    title: 'Alex hakee pelikavereita — pe 3.10. klo 18',
    description: 'Nelinpeli · Ulkokenttä, Lahti · 3 paikkaa vapaana. Liity Krossissa.',
  });
  assert.deepEqual(gameShareMeta({ ...preview, status: 'filled', spots_left: 0, scheduled_at: null }), {
    title: 'Alex on sopinut pelin',
    description: 'Kaksinpeli · Kispi Areena, Lahti · Peli on täynnä. Katso Krossissa.',
  });
  assert.equal(gameShareMeta({ ...preview, kind: 'event', title: 'Friday Afternoon Club' }).title, 'Friday Afternoon Club — pe 3.10. klo 18');
  assert.equal(gameShareMeta({ ...preview, creator_name: null }).title, 'Pelaaja hakee pelikaveria — pe 3.10. klo 18');
  assert.deepEqual(inviteShareMeta({ inviter_name: 'Alex' }), {
    title: 'Alex kutsuu sinut Krossiin',
    description: 'Löydä pelikavereita tennikseen ja sovi pelit helposti.',
  });
});

// Minimal stand-in for Cloudflare's HTMLRewriter (Node has none): supports the element
// selectors the worker uses (`title`, `meta[attr="value"]`), setInnerContent and
// setAttribute, escaping like the real one.
const escapeText = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (value) => escapeText(value).replace(/"/g, '&quot;');

class FakeHTMLRewriter {
  #rules = [];

  on(selector, handlers) {
    this.#rules.push({ selector, handlers });
    return this;
  }

  transform(response) {
    const rules = this.#rules;
    const body = new ReadableStream({
      async start(controller) {
        let html = await response.text();
        for (const { selector, handlers } of rules) html = applyRule(html, selector, handlers);
        controller.enqueue(new TextEncoder().encode(html));
        controller.close();
      },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
}

function applyRule(html, selector, handlers) {
  if (selector === 'title') {
    return html.replace(/<title>[\s\S]*?<\/title>/g, (tag) => {
      let inner = tag.slice('<title>'.length, -'</title>'.length);
      handlers.element({ setInnerContent: (text) => { inner = escapeText(text); } });
      return `<title>${inner}</title>`;
    });
  }
  const [, attr, value] = /^meta\[([\w:-]+)="([^"]+)"\]$/.exec(selector) ?? [];
  if (!attr) throw new Error(`FakeHTMLRewriter: unsupported selector ${selector}`);
  return html.replace(/<meta\b[^>]*>/g, (tag) => {
    if (!tag.includes(`${attr}="${value}"`)) return tag;
    let updated = tag;
    handlers.element({
      setAttribute(name, next) {
        updated = updated.replace(new RegExp(`${name}="[^"]*"`), `${name}="${escapeAttribute(next)}"`);
      },
    });
    return updated;
  });
}

const APP_SHELL = `<!DOCTYPE html><html lang="fi"><head>
<title>Krossi — Selainversio</title>
<meta name="description" content="Krossi selainversio" />
<meta property="og:title" content="Krossi — Löydä pelikavereita tennikseen" />
<meta property="og:description" content="Sovi tennispeli tällä viikolla." />
</head><body><div id="root"></div></body></html>`;

const htmlAssets = {
  ASSETS: {
    fetch: async () => new Response(APP_SHELL, { headers: { 'content-type': 'text/html; charset=utf-8', etag: '"app-shell"' } }),
  },
};

async function withRewriter(fn) {
  const original = globalThis.HTMLRewriter;
  globalThis.HTMLRewriter = FakeHTMLRewriter;
  try {
    return await fn();
  } finally {
    if (original) globalThis.HTMLRewriter = original;
    else delete globalThis.HTMLRewriter;
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('shared game links get a game-specific title and Open Graph card', async () => {
  const calls = [];
  const stub = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({
      id: GAME_ID, kind: 'open', status: 'open', creator_name: 'Alex <3', creator_avatar_color: 'red',
      match_type: 'kaksinpeli', location: 'Kispi "Areena"', location_type: 'sisätennis', city: 'Lahti',
      scheduled_at: '2025-10-03T15:00:00Z', title: null, spots_left: 1, participant_count: 0,
    });
  };

  const response = await withRewriter(() => withFetch(stub, () => worker.fetch(new Request(`https://krossi.app/pelaa/peli/${GAME_ID}`), htmlAssets)));
  const html = await response.text();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://hhybjpgrvlbazbqiaaao.supabase.co/rest/v1/rpc/krossi_public_challenge_preview');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.apikey, 'sb_publishable_IKLRGbstMLfxKeXwBTavSA_UVYyMgTL');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sb_publishable_IKLRGbstMLfxKeXwBTavSA_UVYyMgTL');
  assert.deepEqual(JSON.parse(calls[0].init.body), { challenge_id_input: GAME_ID });
  assert.ok(calls[0].init.signal instanceof AbortSignal);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), null);
  // First name only, and user-provided text is escaped.
  assert.match(html, /<title>Alex hakee pelikaveria — pe 3\.10\. klo 18<\/title>/);
  assert.match(html, /<meta property="og:title" content="Alex hakee pelikaveria — pe 3\.10\. klo 18" \/>/);
  assert.match(html, /<meta property="og:description" content="Kaksinpeli · Kispi &quot;Areena&quot;, Lahti · 1 paikka vapaana\. Liity Krossissa\." \/>/);
  assert.match(html, /<meta name="description" content="Kaksinpeli · Kispi &quot;Areena&quot;, Lahti/);
  assert.doesNotMatch(html, /Krossi — Löydä pelikavereita tennikseen/);
  assert.match(html, /<div id="root"><\/div>/);
});

test('shared invite links name the inviter', async () => {
  const calls = [];
  const stub = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return jsonResponse({ inviter_name: 'Alex' });
  };
  const response = await withRewriter(() => withFetch(stub, () => worker.fetch(new Request('https://www.krossi.app/pelaa/kutsu/abc234'), htmlAssets)));
  const html = await response.text();

  assert.deepEqual(calls, [{ url: 'https://hhybjpgrvlbazbqiaaao.supabase.co/rest/v1/rpc/krossi_resolve_invite', body: { code_input: 'ABC234' } }]);
  assert.match(html, /<title>Alex kutsuu sinut Krossiin<\/title>/);
  assert.match(html, /<meta property="og:description" content="Löydä pelikavereita tennikseen ja sovi pelit helposti\." \/>/);
});

test('the page is served unchanged when the preview is missing or the backend fails', async () => {
  const failures = {
    'not found (null)': async () => jsonResponse(null),
    'function not deployed yet (404)': async () => jsonResponse({ code: 'PGRST202', message: 'Could not find the function' }, 404),
    'network error': async () => { throw new TypeError('fetch failed'); },
    'invalid JSON': async () => new Response('<html>oops</html>', { status: 200 }),
  };
  for (const [label, stub] of Object.entries(failures)) {
    const response = await withRewriter(() => withFetch(stub, () => worker.fetch(new Request(`https://krossi.app/pelaa/peli/${GAME_ID}`), htmlAssets)));
    assert.equal(response.status, 200, label);
    assert.equal(await response.text(), APP_SHELL, label);
  }
});

test('a slow preview backend is abandoned after the timeout', async () => {
  const hanging = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const started = Date.now();
  const response = await withRewriter(() => withFetch(hanging, () => worker.fetch(new Request(`https://krossi.app/pelaa/peli/${GAME_ID}`), htmlAssets)));
  const elapsed = Date.now() - started;
  assert.equal(await response.text(), APP_SHELL);
  assert.ok(elapsed >= 1400 && elapsed < 3000, `took ${elapsed} ms`);
});

test('only GET requests for share links on Krossi hosts trigger a preview lookup', async () => {
  const cases = [
    new Request(`https://krossi.app/pelaa/peli/${GAME_ID}`, { method: 'HEAD' }),
    new Request('https://krossi.app/pelaa/pelit'),
    new Request(`https://krossi.app/demo/peli/${GAME_ID}`),
    new Request('https://koutsi.krossi.app/pelaa'),
    new Request(`https://koutsi.krossi.app/pelaa/peli/${GAME_ID}`),
  ];
  await withRewriter(() => withFetch(refuseNetwork, async () => {
    for (const request of cases) {
      const response = await worker.fetch(request, htmlAssets);
      assert.equal(await response.text(), APP_SHELL, `${request.method} ${request.url}`);
    }
  }));
});

test('share meta injection is skipped for non-HTML or non-200 asset responses', async () => {
  const stub = async () => jsonResponse({ inviter_name: 'Alex' });
  const notModified = { ASSETS: { fetch: async () => new Response(null, { status: 304 }) } };
  const response = await withRewriter(() => withFetch(stub, () => worker.fetch(new Request('https://krossi.app/pelaa/kutsu/ABC234'), notModified)));
  assert.equal(response.status, 304);

  // Without HTMLRewriter (e.g. a non-Workers runtime) the response passes through untouched.
  const plain = new Response(APP_SHELL, { headers: { 'content-type': 'text/html' } });
  assert.equal(injectShareMeta(plain, { title: 'x', description: 'y' }, null), plain);
});
