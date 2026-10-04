import assert from 'node:assert/strict';
import test from 'node:test';
import { matchRoute, ROUTES, TABS } from '../src/app/routes.js';

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
    ['/pelaa/pelit/', 'games', {}],
  ];
  for (const [path, name, params] of cases) {
    const m = matchRoute(path);
    assert.ok(m, `no match for ${path}`);
    assert.equal(m.name, name, path);
    assert.deepEqual(m.params, params, path);
  }
});

test('unknown paths do not match', () => {
  for (const path of ['/pelaa/tuntematon', '/pelaa/peli', '/pelaa/peli/a/b', '/koutsi', '/']) {
    assert.equal(matchRoute(path), null, path);
  }
});

test('every tab has a root route and route names are unique', () => {
  const names = ROUTES.map((r) => r.name);
  assert.equal(new Set(names).size, names.length);
  for (const tab of TABS) assert.equal(matchRoute(tab.path)?.route.type, 'tab', tab.path);
});
