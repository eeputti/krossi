// The anonymous usage statistics (Ylläpito → Käyttö): the tracker both Koutsi apps run
// (lib/koutsi-usage.js, a classic global script — run here in a vm with a small fake browser),
// the UI vocabulary that decides which tap texts may be sent, and the report helpers both
// admin views share (lib/koutsi-usage-report.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { usageWords } from '../../../scripts/usage-words.mjs';
import { clickName, eventText, heatLevel, routeName, summarize } from '../../../lib/koutsi-usage-report.js';

const here = dirname(fileURLToPath(import.meta.url));
const trackerSource = readFileSync(join(here, '../../../lib/koutsi-usage.js'), 'utf8');

const WORDS = 'lisää treeni tallenna peruuta ryhmät pelaajat vko yritä uudelleen tallennus epäonnistui jokin meni pieleen sulje';

// A browser just big enough for the tracker: listeners, history, fetch, a clock.
function fakeBrowser({ path = '/valmentaja/koti', extra = {} } = {}) {
  const listeners = { window: {}, document: {} };
  const on = (bag) => (type, fn) => { (bag[type] ||= []).push(fn); };
  const requests = [];
  const intervals = [];
  let now = Date.parse('2026-10-14T15:00:00Z');
  const location = { pathname: path };
  const document = { visibilityState: 'visible', body: {}, addEventListener: on(listeners.document) };
  const window = {
    location, document,
    history: {
      pushState(_s, _t, url) { location.pathname = url; },
      replaceState(_s, _t, url) { location.pathname = url; },
    },
    innerWidth: 400, innerHeight: 800,
    screen: { width: 390, height: 844 },
    matchMedia: () => ({ matches: true }),
    crypto: globalThis.crypto,
    getComputedStyle: () => ({ cursor: 'auto' }),
    addEventListener: on(listeners.window),
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    fetch: (url, init) => { requests.push({ url, init, body: JSON.parse(init.body) }); return Promise.resolve({ status: 204 }); },
    ...extra,
  };
  const context = vm.createContext({ window, document, Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }, Promise, JSON, Math, Set, Array, String, Number, Boolean, Uint8Array });
  vm.runInContext(trackerSource, context, { filename: 'koutsi-usage.js' });
  return {
    window, document, location, requests, listeners,
    tick: () => intervals.forEach((fn) => fn()),
    advance: (ms) => { now += ms; },
    fire: (where, type, ev) => (listeners[where][type] || []).forEach((fn) => fn(ev)),
  };
}

const startTracker = (b, token = 'tok') => b.window.koutsiUsage.start({
  app: 'uusi', role: 'valmentaja', url: 'https://x.supabase.co', anonKey: 'anon', words: WORDS,
  onToken: (cb) => cb(token),
});

// An element as the click handler sees it.
function el(tag, { text = '', attrs = {}, parent = null } = {}) {
  const node = {
    nodeType: 1, tagName: tag, innerText: text, title: '', value: '', parentElement: parent,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    matches(selector) {
      return selector.split(',').some((sel) => {
        const s = sel.trim();
        const role = /^\[role="([^"]+)"\]$/.exec(s);
        if (role) return attrs.role === role[1];
        if (s === 'a[href]') return tag === 'A' && 'href' in attrs;
        return s.toUpperCase() === tag;
      });
    },
    closest(selector) {
      for (let n = node; n; n = n.parentElement) if (n.matches(selector)) return n;
      return null;
    },
  };
  return node;
}

test('ids, digits and anything that is not a plain word leave the path', () => {
  const { normalizePath } = fakeBrowser().window.koutsiUsage._internals;
  assert.equal(normalizePath('/valmentaja/ryhma/3f2a9c1e-1111-4222-8333-444455556666'), '/valmentaja/ryhma/:id');
  assert.equal(normalizePath('/valmentaja/pelaaja/Matti%20Meik%C3%A4l%C3%A4inen'), '/valmentaja/pelaaja/:id');
  assert.equal(normalizePath('/demo/valmentaja/koti/'), '/valmentaja/koti');
  assert.equal(normalizePath('/pelaaja'), '/pelaaja');
  assert.equal(normalizePath('/valmentaja/treeni/123'), '/valmentaja/treeni/:id');
});

test('a tap label passes only when every word is the app\'s own wording', () => {
  const { cleanLabel, setWords } = fakeBrowser().window.koutsiUsage._internals;
  setWords(WORDS);
  assert.equal(cleanLabel('Lisää treeni'), 'Lisää treeni');
  assert.equal(cleanLabel('  Vko 42  '), 'Vko #');
  assert.equal(cleanLabel('Matti Meikäläinen'), null);         // a name
  assert.equal(cleanLabel('Tallenna Matti'), null);            // UI word + a name
  assert.equal(cleanLabel('matti@example.com'), null);
  assert.equal(cleanLabel('M'), null);                         // an initial
  assert.equal(cleanLabel('×'), '×');                          // symbols only
  assert.equal(cleanLabel('Lisää treeni '.repeat(8)), null);   // long text is content
});

test('without a vocabulary no text with letters is ever sent', () => {
  const { cleanLabel } = fakeBrowser().window.koutsiUsage._internals;
  assert.equal(cleanLabel('Tallenna'), null);
});

test('error details lose e-mails, ids, values and query strings', () => {
  const { scrub, redactWords, setWords } = fakeBrowser().window.koutsiUsage._internals;
  assert.equal(
    scrub('duplicate key value violates unique constraint "x" Key (email)=(a@b.fi) for 3f2a9c1e-1111-4222-8333-444455556666 at https://x.fi/p?token=abc'),
    'duplicate key value violates unique constraint "…" Key (…)=(…) for :id at https://x.fi/p',
  );
  setWords(WORDS);
  assert.equal(redactWords('Tallennus epäonnistui: Matti Meikäläinen. Yritä uudelleen.'), 'Tallennus epäonnistui: …. Yritä uudelleen.');
});

test('page views, taps and errors are batched with no user in them', async () => {
  const b = fakeBrowser();
  startTracker(b);
  b.window.history.pushState({}, '', '/valmentaja/ryhma/3f2a9c1e-1111-4222-8333-444455556666');
  b.window.history.replaceState({}, '', '/valmentaja/ryhma/3f2a9c1e-1111-4222-8333-444455556666'); // same page: no new view

  const button = el('BUTTON', { text: 'Lisää treeni' });
  b.fire('document', 'click', { target: button, clientX: 200, clientY: 400 });
  const card = el('BUTTON', { text: 'Matti Meikäläinen\nKeskitaso' });
  b.fire('document', 'click', { target: card, clientX: 0, clientY: 0 });
  const tab = el('DIV', { text: 'Ryhmät', attrs: { role: 'tab' } });
  b.fire('document', 'click', { target: el('SPAN', { parent: tab }), clientX: 40, clientY: 780 });
  b.window.koutsiUsage.toast('Tallennus epäonnistui: Matti');
  b.fire('window', 'error', { target: b.window, message: 'TypeError: x is undefined', filename: 'https://k/koutsi-uusi/valmentaja.js', lineno: 1, colno: 99 });

  b.advance(2000);
  b.tick();
  assert.equal(b.requests.length, 1);
  const { url, init, body } = b.requests[0];
  assert.equal(url, 'https://x.supabase.co/rest/v1/rpc/koutsi_track_usage');
  assert.equal(init.headers.Authorization, 'Bearer tok');
  const { batch } = body;
  assert.match(batch.s, /^[0-9a-f-]{36}$/);
  assert.deepEqual([batch.a, batch.r, batch.d], ['uusi', 'valmentaja', 'puhelin']);
  assert.deepEqual(batch.e.map((e) => e.k), ['view', 'view', 'click', 'click', 'click', 'error', 'error']);
  assert.equal(batch.e[1].p, '/valmentaja/ryhma/:id');
  assert.deepEqual([batch.e[2].l, batch.e[2].g, batch.e[2].x, batch.e[2].y], ['Lisää treeni', 'nappi', 500, 500]);
  assert.equal(batch.e[3].l, undefined);   // the name stayed home
  assert.deepEqual([batch.e[4].l, batch.e[4].g], ['Ryhmät', 'välilehti']);
  assert.deepEqual([batch.e[5].l, batch.e[5].m], ['Virheilmoitus', 'Tallennus epäonnistui: …']);
  assert.equal(batch.e[6].l, 'Kaatuminen');
  assert.ok(batch.e.every((e) => e.t >= 0));
  assert.doesNotMatch(JSON.stringify(body), /Matti|3f2a9c1e/);
});

test('nothing is sent before sign-in; the queue waits for a token', () => {
  const b = fakeBrowser();
  let give;
  b.window.koutsiUsage.start({ app: 'vanha', role: 'pelaaja', url: 'https://x', anonKey: 'a', words: WORDS, onToken: (cb) => { give = cb; } });
  b.tick();
  assert.equal(b.requests.length, 0);
  give('tok');
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].body.batch.a, 'vanha');
});

test('a hidden tab ends the visit with a keepalive send, and a long pause starts a new session', () => {
  const b = fakeBrowser();
  startTracker(b);
  b.tick();
  const first = b.requests[0].body.batch.s;
  b.document.visibilityState = 'hidden';
  b.fire('document', 'visibilitychange');
  const hide = b.requests[1];
  assert.equal(hide.init.keepalive, true);
  assert.deepEqual(hide.body.batch.e.map((e) => e.k), ['hide']);

  b.advance(31 * 60 * 1000);
  b.document.visibilityState = 'visible';
  b.fire('document', 'visibilitychange');
  b.tick();
  const again = b.requests[2].body.batch;
  assert.notEqual(again.s, first);
  assert.deepEqual(again.e.map((e) => e.k), ['view']);
});

test('the tracker gives up quietly when the database function is missing', async () => {
  let calls = 0;
  const b = fakeBrowser({ extra: { fetch: () => { calls += 1; return Promise.resolve({ status: 404 }); } } });
  startTracker(b);
  b.tick();
  await new Promise((r) => setImmediate(r));
  b.window.history.pushState({}, '', '/valmentaja/ryhmat');
  b.tick();
  assert.equal(calls, 1);
});

test('the old app starts the tracker by itself, the demo never', () => {
  const real = fakeBrowser({ extra: {
    KOUTSI_APP_NAME: 'koutsi_pelaaja', KOUTSI_SUPABASE_URL: 'https://x', KOUTSI_SUPABASE_ANON_KEY: 'a', KOUTSI_USAGE_WORDS: WORDS,
    koutsiSupabase: { auth: { onAuthStateChange: (cb) => cb('INITIAL_SESSION', { access_token: 'tok' }), getSession: () => Promise.resolve({ data: { session: null } }) } },
  } });
  real.tick();
  assert.equal(real.requests.length, 1);
  assert.deepEqual([real.requests[0].body.batch.a, real.requests[0].body.batch.r], ['vanha', 'pelaaja']);

  const demo = fakeBrowser({ extra: {
    KOUTSI_DEMO_ROLE: 'player', KOUTSI_APP_NAME: 'koutsi_pelaaja', KOUTSI_SUPABASE_URL: 'https://x', KOUTSI_SUPABASE_ANON_KEY: 'a',
    koutsiSupabase: { auth: { onAuthStateChange: (cb) => cb('INITIAL_SESSION', { access_token: 'tok' }), getSession: () => Promise.resolve({ data: { session: null } }) } },
  } });
  demo.tick();
  assert.equal(demo.requests.length, 0);
});

test('the vocabulary comes from string literals only, never comments, placeholders or listed names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'koutsi-words-'));
  const file = join(dir, 'app.jsx');
  writeFileSync(file, `
    // Kommentissa Alpo ja Sirkka
    export const A = () => <div><button>Tallenna muutokset</button><input placeholder="esim. Matti Virtanen" /></div>;
    const msg = 'Ryhmä luotu';
    const contact = 'Eelis Puro';
  `);
  const words = (await usageWords([file])).split(' ');
  for (const w of ['tallenna', 'muutokset', 'ryhmä', 'luotu']) assert.ok(words.includes(w), w);
  for (const w of ['sirkka', 'alpo', 'matti', 'virtanen', 'eelis', 'puro', 'kommentissa']) assert.ok(!words.includes(w), w);
});

test('the report sums sessions across app and role and fills quiet days', () => {
  const data = {
    since: '2026-10-08T06:00:00Z',
    testEvents: 4,
    groups: [
      { app: 'vanha', role: 'valmentaja', sessions: 3, views: 10, clicks: 20, errors: 1 },
      { app: 'uusi', role: 'pelaaja', sessions: 2, views: 4, clicks: 3, errors: 0 },
    ],
    days: [
      { day: '2026-10-10', app: 'vanha', role: 'valmentaja', sessions: 2 },
      { day: '2026-10-10', app: 'uusi', role: 'pelaaja', sessions: 1 },
      { day: '2026-10-13', app: 'vanha', role: 'valmentaja', sessions: 1 },
    ],
    heat: [{ dow: 6, hour: 17, app: 'vanha', role: 'valmentaja', sessions: 2 }, { dow: 6, hour: 17, app: 'uusi', role: 'pelaaja', sessions: 1 }],
    devices: [{ device: 'puhelin', app: 'vanha', role: 'valmentaja', sessions: 3 }],
    views: [{ app: 'vanha', role: 'valmentaja', path: '/valmentaja/oppilaat', views: 7, sessions: 3, seconds: 40 }],
    clicks: [{ app: 'uusi', role: 'pelaaja', path: '/pelaaja/koti', label: null, target: 'kortti', clicks: 2, sessions: 1 }],
    errors: [
      { app: 'vanha', role: 'valmentaja', path: '/valmentaja/profiili', label: 'Kaatuminen', message: 'TypeError: x', count: 2, sessions: 2, firstAt: '2026-10-09T10:00:00Z', lastAt: '2026-10-12T10:00:00Z' },
      { app: 'uusi', role: 'pelaaja', path: '/pelaaja/koti', label: 'Kaatuminen', message: 'TypeError: x', count: 1, sessions: 1, firstAt: '2026-10-13T10:00:00Z', lastAt: '2026-10-13T10:00:00Z' },
      { app: 'vanha', role: 'valmentaja', path: '/valmentaja/ryhmat', label: 'Virheilmoitus', message: 'Tallennus epäonnistui.', count: 1, sessions: 1, firstAt: '2026-10-10T10:00:00Z', lastAt: '2026-10-10T10:00:00Z' },
    ],
    sessions: [{ id: 's1', app: 'vanha', role: 'valmentaja', device: 'kone', lastAt: '2026-10-13T15:05:00Z', events: [
      { at: '2026-10-13T15:00:00Z', kind: 'view', path: '/valmentaja/oppilaat' },
      { at: '2026-10-13T15:01:00Z', kind: 'click', path: '/valmentaja/oppilaat', label: 'Lisää treeni', target: 'nappi' },
      { at: '2026-10-13T15:05:00Z', kind: 'hide', path: '/valmentaja/oppilaat' },
    ] }],
  };
  const all = summarize(data, {}, new Date('2026-10-14T12:00:00Z'));
  assert.deepEqual(all.totals, { sessions: 5, views: 14, clicks: 23, errors: 1 });
  assert.equal(all.days.length, 7);                       // 8.10.–14.10.
  assert.deepEqual(all.days.find((d) => d.day === '2026-10-10'), { day: '2026-10-10', sessions: 3 });
  assert.equal(all.activeDays, 2);
  assert.equal(all.heat[5][17], 3);
  assert.equal(all.heatMax, 3);
  assert.equal(all.sessions[0].seconds, 300);
  assert.equal(all.sessions[0].clicks, 1);

  assert.equal(all.errors.length, 2);                     // one row per problem, not per page
  assert.deepEqual([all.errors[0].label, all.errors[0].count, all.errors[0].places.length], ['Kaatuminen', 3, 2]);
  assert.deepEqual([all.errors[0].firstAt, all.errors[0].lastAt], ['2026-10-09T10:00:00Z', '2026-10-13T10:00:00Z']);

  const players = summarize(data, { role: 'pelaaja' }, new Date('2026-10-14T12:00:00Z'));
  assert.equal(players.errors[0].count, 1);
  assert.deepEqual(players.totals, { sessions: 2, views: 4, clicks: 3, errors: 0 });
  assert.equal(players.heat[5][17], 1);
  assert.equal(players.sessions.length, 0);
  assert.equal(summarize(data, { app: 'uusi' }).views.length, 0);
});

test('report wording', () => {
  assert.equal(routeName('/valmentaja/ryhma/:id'), 'Ryhmän sivu');
  assert.equal(routeName('/jokin/muu'), '/jokin/muu');
  assert.equal(clickName({ label: null, target: 'kortti' }), 'Kortti (teksti piilotettu)');
  assert.equal(eventText({ kind: 'view', path: '/pelaaja/koti', label: 'paluu' }), 'Palasi sivulle Koti');
  assert.equal(eventText({ kind: 'error', label: 'Virheilmoitus', message: 'Jokin meni pieleen.' }), 'Virheilmoitus: Jokin meni pieleen.');
  assert.deepEqual([0, 1, 2, 5, 10].map((v) => heatLevel(v, 10)), [0, 1, 1, 3, 5]);
});
