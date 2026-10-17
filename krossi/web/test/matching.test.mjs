// Matching: how well another player fits me, the order of the Pelaajat list, the suggestions in
// Pelataanko? and the reason line under each of them.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { matchScore, rankPlayers, reasonLine, reasonTexts, suggestPlayers, SUGGEST_MIN, WEIGHTS } from '../src/features/matching.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-17T12:00:00Z');

const player = (id, extra = {}) => ({
  id, name: id, skillLevel: 'keskitaso', competitionClasses: [], playStyles: [], availability: [],
  playingThisWeek: false, playingNowUntil: null, createdAt: new Date(NOW - 400 * DAY).toISOString(), ...extra,
});

const ME = player('me', { playStyles: ['matsit', 'kaksinpeli'], availability: ['arki-illat', 'viikonloppuaamut'] });
const texts = (r) => r.reasons.map((x) => x.text);

describe('matchScore', () => {
  test('the weights add up to 100 before the newcomer bonus', () => {
    const { newcomer, ...rest } = WEIGHTS;
    assert.equal(Object.values(rest).reduce((a, b) => a + b, 0), 100);
    assert.ok(newcomer > 0);
  });

  test('a perfect partner scores 100 and says why', () => {
    const twin = player('twin', {
      playStyles: ['matsit'], availability: ['arki-illat', 'viikonloppuaamut'],
      playingNowUntil: new Date(NOW + 3_600_000).toISOString(),
    });
    const r = matchScore(ME, twin, { now: NOW, partners: [{ player: { id: 'twin' }, gamesTogether: 3 }] });
    assert.equal(r.score, 100);
    assert.deepEqual(r.reasons, [
      { key: 'level', text: 'Sama taso' },
      { key: 'time', text: 'Ehditte arki-iltaisin' },
      { key: 'partner', text: '3 yhteistä peliä' },
      { key: 'style', text: 'Tykkää myös matseista' },
    ]);
  });

  test('level: same 1, one step 0.5, two steps 0', () => {
    const fit = (skillLevel) => matchScore(ME, player('x', { skillLevel }), { now: NOW }).fit.level;
    assert.equal(fit('keskitaso'), 1);
    assert.equal(fit('aloittelija'), 0.5);
    assert.equal(fit('edistynyt'), 0.5);
    assert.equal(fit('kilpapelaaja'), 0);
  });

  test('two competition players compare their classes', () => {
    const me = player('me', { skillLevel: 'kilpapelaaja', competitionClasses: ['C1', 'C2'] });
    const r = (classes) => matchScore(me, player('x', { skillLevel: 'kilpapelaaja', competitionClasses: classes }), { now: NOW });
    assert.equal(r(['C2']).fit.level, 1);
    assert.equal(texts(r(['C2']))[0], 'Sama kilpailuluokka');
    assert.equal(r(['B2']).fit.level, 0.6);
    assert.equal(texts(r(['B2']))[0], 'Lähes sama luokka');
    assert.equal(r(['A1']).fit.level, 0.3);
    // Without classes it is just the same level.
    assert.equal(r([]).fit.level, 1);
    assert.equal(texts(r([]))[0], 'Sama taso');
  });

  test('time: any shared slot is a fit, a full overlap the best one', () => {
    const fit = (availability) => matchScore(ME, player('x', { availability }), { now: NOW }).fit.time;
    assert.equal(fit(['arki-illat', 'viikonloppuaamut']), 1);
    assert.equal(fit(['arki-illat']), 1); // all of theirs are mine too
    assert.equal(fit(['arki-illat', 'arkiaamut']), 0.8);
    assert.equal(fit(['arkiaamut']), 0);
    assert.equal(fit(['joustavasti']), 0.8);
    assert.equal(fit([]), 0.5); // unknown: half
  });

  test('the time reason names the first shared slot in the day order', () => {
    const r = matchScore(ME, player('x', { availability: ['viikonloppuaamut', 'arki-illat'] }), { now: NOW });
    assert.ok(texts(r).includes('Ehditte arki-iltaisin'));
    const flex = matchScore(ME, player('x', { availability: ['joustavasti'] }), { now: NOW });
    assert.ok(texts(flex).includes('Joustava aikataulu'));
  });

  test('Pelaan nyt beats this week, which beats neither', () => {
    const now = matchScore(ME, player('a', { playingNowUntil: new Date(NOW + 60_000).toISOString() }), { now: NOW });
    const week = matchScore(ME, player('b', { playingThisWeek: true }), { now: NOW });
    const ended = matchScore(ME, player('c', { playingNowUntil: new Date(NOW - 60_000).toISOString() }), { now: NOW });
    assert.equal(now.fit.now, 1);
    assert.equal(week.fit.now, 0.6);
    assert.equal(ended.fit.now, 0);
  });

  test('style: shared 1, kaikki käy 0.8, unknown half, none 0', () => {
    const fit = (playStyles) => matchScore(ME, player('x', { playStyles }), { now: NOW }).fit.style;
    assert.equal(fit(['matsit', 'nelinpeli']), 1);
    assert.equal(fit(['kaikki käy']), 0.8);
    assert.equal(fit([]), 0.5);
    assert.equal(fit(['pallottelu']), 0);
  });

  test('a newcomer gets a fading bonus for 30 days', () => {
    const joined = (days) => matchScore(ME, player('x', { createdAt: new Date(NOW - days * DAY).toISOString() }), { now: NOW });
    assert.equal(joined(0).fit.newcomer, 1);
    assert.equal(joined(15).fit.newcomer, 0.5);
    assert.equal(joined(30).fit.newcomer, 0);
    assert.ok(texts(joined(2)).includes('Uusi Krossissa'));
    assert.ok(!texts(joined(40)).includes('Uusi Krossissa'));
    assert.equal(joined(-1).fit.newcomer, 0); // clock skew: a future createdAt is no newcomer
  });

  test('one game together reads in the singular', () => {
    const r = matchScore(ME, player('x'), { now: NOW, partners: new Map([['x', 1]]) });
    assert.ok(texts(r).includes('1 yhteinen peli'));
  });

  test('an empty profile on my side neither wins nor sinks anybody', () => {
    const blank = { id: 'me' };
    const r = matchScore(blank, player('x', { availability: ['arki-illat'], playStyles: ['matsit'] }), { now: NOW });
    assert.equal(r.score, Math.round(WEIGHTS.level * 0.5 + WEIGHTS.time * 0.5 + WEIGHTS.style * 0.5));
    assert.deepEqual(r.reasons, []);
  });
});

describe('rankPlayers', () => {
  test('best fit first, ties keep the backend order', () => {
    const list = [
      player('far', { skillLevel: 'kilpapelaaja' }),
      player('tie-1'),
      player('best', { availability: ['arki-illat'], playStyles: ['matsit'], playingThisWeek: true }),
      player('tie-2'),
    ];
    assert.deepEqual(rankPlayers(ME, list, { now: NOW }).map((r) => r.player.id), ['best', 'tie-1', 'tie-2', 'far']);
  });

  test('handles a missing list', () => {
    assert.deepEqual(rankPlayers(ME, null, { now: NOW }), []);
  });
});

describe('suggestPlayers', () => {
  test('only good fits, at most three', () => {
    const good = (id) => player(id, { availability: ['arki-illat'], playStyles: ['matsit'] });
    const list = [good('a'), good('b'), good('c'), good('d'), player('meh')];
    const top = suggestPlayers(ME, list, { now: NOW });
    assert.deepEqual(top.map((r) => r.player.id), ['a', 'b', 'c']);
    assert.ok(top.every((r) => r.score >= SUGGEST_MIN));
  });

  test('never somebody two levels away or with no time in common, however active', () => {
    const active = { playingNowUntil: new Date(NOW + 60_000).toISOString(), playStyles: ['matsit'] };
    const far = player('far', { ...active, skillLevel: 'kilpapelaaja', availability: ['arki-illat'] });
    const busy = player('busy', { ...active, availability: ['arkiaamut'] });
    assert.deepEqual(suggestPlayers(ME, [far, busy], { now: NOW, partners: [{ player: { id: 'far' }, gamesTogether: 4 }] }), []);
  });
});

describe('reasonLine', () => {
  const reasons = [
    { key: 'level', text: 'Sama taso' },
    { key: 'time', text: 'Ehditte arki-iltaisin' },
    { key: 'style', text: 'Tykkää myös matseista' },
  ];

  test('joins the first two, lower-casing the rest', () => {
    assert.equal(reasonLine(reasons), 'Sama taso · ehditte arki-iltaisin');
    assert.equal(reasonLine(reasons, { max: 1 }), 'Sama taso');
    assert.equal(reasonLine([]), '');
    assert.equal(reasonLine(undefined), '');
  });

  test('skips what the screen already shows, capitalising the new first one', () => {
    assert.equal(reasonLine(reasons, { skip: ['level'] }), 'Ehditte arki-iltaisin · tykkää myös matseista');
    assert.equal(reasonLine([{ key: 'partner', text: '3 yhteistä peliä' }, ...reasons.slice(1)], { skip: ['level'] }), '3 yhteistä peliä · ehditte arki-iltaisin');
  });

  test('reasonTexts gives the same pieces one by one', () => {
    assert.deepEqual(reasonTexts(reasons, { skip: ['level'] }), ['Ehditte arki-iltaisin', 'tykkää myös matseista']);
    assert.deepEqual(reasonTexts(null), []);
  });
});
