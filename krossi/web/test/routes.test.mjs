import assert from 'node:assert/strict';
import test from 'node:test';
import { matchRoute, PHONE_TABS, ROUTES, TABS } from '../src/app/routes.js';

test('every app URL resolves to the intended route', () => {
  const cases = [
    ['/pelaa/koti', 'home', {}],
    ['/pelaa/pelit', 'games', {}],
    ['/pelaa/uusi-peli', 'createGame', {}],
    ['/pelaa/peli/0b8d1c2e-0000-4000-8000-000000000001', 'game', { id: '0b8d1c2e-0000-4000-8000-000000000001' }],
    ['/pelaa/pelaajat', 'players', {}],
    ['/pelaa/pelaaja/abc', 'player', { id: 'abc' }],
    ['/pelaa/pelikaverit', 'partners', {}],
    ['/pelaa/viestit', 'inbox', {}],
    ['/pelaa/viestit/arkisto', 'archive', {}],
    ['/pelaa/viestit/c-1', 'chat', { id: 'c-1' }],
    ['/pelaa/profiili', 'profile', {}],
    ['/pelaa/profiili/muokkaa', 'profileEdit', {}],
    ['/pelaa/asetukset', 'settings', {}],
    ['/pelaa/asetukset/estetyt', 'blocked', {}],
    ['/pelaa/merkit', 'badges', {}],
    ['/pelaa/kooste/2026-09', 'recap', { period: '2026-09' }],
    ['/pelaa/kooste/kausi-2026', 'recap', { period: 'kausi-2026' }],
    ['/pelaa/liigat', 'leagues', {}],
    ['/pelaa/liiga/l1', 'league', { id: 'l1' }],
    ['/pelaa/kutsu/ABC234', 'invite', { code: 'ABC234' }],
    ['/pelaa/yllapito', 'admin', {}],
    ['/pelaa/varaa', 'booking', {}],
    ['/pelaa/varaa/lahden-tennis-ja-squash', 'bookingVenue', { venue: 'lahden-tennis-ja-squash' }],
    ['/pelaa/halli/lahden-tennis-ja-squash', 'hall', { venue: 'lahden-tennis-ja-squash' }],
    ['/pelaa/maksa/Kq3vT9xLm2Pz8RwYb4Nc7d', 'splitPay', { token: 'Kq3vT9xLm2Pz8RwYb4Nc7d' }],
    ['/pelaa/omat-varaukset', 'myBookings', {}],
    ['/pelaa/lasku/inv-1001', 'invoice', { id: 'inv-1001' }],
    ['/pelaa/pelit/', 'games', {}],
    ['/varaa', 'bookingSite', {}],
    ['/varaa/', 'bookingSite', {}],
    ['/varaa/lahden-ulkokentat', 'bookingSiteVenue', { venue: 'lahden-ulkokentat' }],
  ];
  for (const [path, name, params] of cases) {
    const m = matchRoute(path);
    assert.ok(m, `no match for ${path}`);
    assert.equal(m.name, name, path);
    assert.deepEqual(m.params, params, path);
  }
});

test('unknown paths do not match', () => {
  for (const path of ['/pelaa/tuntematon', '/pelaa/peli', '/pelaa/peli/a/b', '/koutsi', '/', '/varaa/a/b']) {
    assert.equal(matchRoute(path), null, path);
  }
});

test('every tab has a root route and route names are unique', () => {
  const names = ROUTES.map((r) => r.name);
  assert.equal(new Set(names).size, names.length);
  for (const tab of TABS) assert.equal(matchRoute(tab.path)?.route.type, 'tab', tab.path);
});

test('phones get Koti · Peliseura · Viestit · Profiili; the desktop side nav adds Varaa', () => {
  assert.deepEqual(PHONE_TABS.map((t) => t.label), ['Koti', 'Peliseura', 'Viestit', 'Profiili']);
  assert.deepEqual(TABS.map((t) => t.label), ['Koti', 'Peliseura', 'Varaa', 'Viestit', 'Profiili']);
});

test('the booking site lives outside the app and its menus', () => {
  for (const path of ['/varaa', '/varaa/lahden-ulkokentat']) {
    const m = matchRoute(path);
    assert.equal(m.route.type, 'site', path);
    assert.equal(m.route.tab, null, path);
  }
});
