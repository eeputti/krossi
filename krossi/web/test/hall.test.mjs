// Hall view (screens/booking/Hall*.jsx): the pure helpers in hallData.js — timeline placement,
// half-hour states, the day's numbers per location and the block form's choices.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { configureTiming } from '../src/api/demo/runtime.js';
import { resetStore } from '../src/api/demo/store.js';
import { backend as api } from '../src/api/demo/index.js';
import { LIVE_SPORTS, addDays, dateKey, localDate } from '../src/features/booking.js';
import {
  blockGroup, cellStates, conflictsFor, courtsLabel, dayText, dayWindow, daySummary, defaultStart, endChoices, hhmm,
  isoWeek, itemVariant, kindForTitle, liveLocations, locationLabel, minuteIn, nowMinuteOn, parseDayKey, percentLabel,
  spanOf, startChoices,
} from '../src/screens/booking/hallData.js';

configureTiming({ latencyMin: 0, latencyMax: 0, autoScale: 0.001 });
beforeEach(() => resetStore());

const K = '2026-10-14';
const at = (key, hm) => localDate(key, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))).toISOString();
const court = (id, sport = 'tennis') => ({ id, locationId: 'loc', name: `Kenttä ${id}`, shortName: id, sport, surface: null, mapId: null });
const location = { id: 'loc', name: 'Halli', indoor: true, courts: [court('a'), court('b')] };
// Open 06–23 on the grid, but only 07–22 has a price (= bookable).
const venue = {
  id: 'v', openFrom: '06:00', openUntil: '23:00', slotMinutes: 30, locations: [location],
  prices: [{ sports: ['tennis'], courtIds: null, weekdays: [1, 2, 3, 4, 5, 6, 7], from: '07:00', until: '22:00', centsPerHour: 2000 }],
};
const win = dayWindow(venue);

const item = (over) => ({
  id: over.id, courtId: 'a', kind: 'booking', status: 'confirmed', title: null, bookedBy: { id: 'p', name: 'Mikko Mallikas' },
  priceCents: 0, paymentStatus: 'paid', ...over,
});
const ITEMS = [
  item({ id: 'paid', startsAt: at(K, '18:00'), endsAt: at(K, '19:30'), priceCents: 3000 }),
  item({ id: 'held', startsAt: at(K, '20:00'), endsAt: at(K, '21:00'), status: 'held', paymentStatus: 'unpaid', priceCents: 2000 }),
  item({ id: 'block', courtId: 'b', kind: 'block', title: 'Kunnostus', bookedBy: null, startsAt: at(K, '06:00'), endsAt: at(K, '08:00'), paymentStatus: 'none' }),
  item({ id: 'league-b', courtId: 'b', kind: 'league', title: 'Hallisarja', bookedBy: null, startsAt: at(K, '21:30'), endsAt: at(K, '23:00'), paymentStatus: 'none' }),
  item({ id: 'league-a', courtId: 'a', kind: 'league', title: 'Hallisarja', bookedBy: null, startsAt: at(K, '21:30'), endsAt: at(K, '23:00'), paymentStatus: 'none' }),
];

test('day keys, weeks and clock labels', () => {
  assert.equal(parseDayKey('2026-10-14'), '2026-10-14');
  assert.equal(parseDayKey('2026-02-30'), null);
  assert.equal(parseDayKey('14.10.2026'), null);
  assert.equal(parseDayKey(undefined), null);
  assert.equal(isoWeek('2026-10-14'), 42);
  assert.equal(isoWeek('2026-01-01'), 1);
  assert.equal(isoWeek('2027-01-01'), 53);
  assert.equal(isoWeek('2024-12-30'), 1);
  assert.equal(hhmm(390), '6.30');
  assert.equal(hhmm(1080), '18.00');
  assert.equal(hhmm(1440), '24.00');
  assert.equal(percentLabel(0.2667), '27 %');
  assert.equal(dayText('2026-10-14', '2026-10-14'), 'Tänään ke 14.10.');
  assert.equal(dayText('2026-10-15', '2026-10-14'), 'Huomenna to 15.10.');
  assert.equal(dayText('2026-10-20', '2026-10-14'), 'ti 20.10.');
});

test('only live sports are shown: other courts and emptied locations drop out', () => {
  const v = {
    locations: [
      { id: 'a', name: 'A', indoor: true, courts: [court('t1'), court('s1', 'sulkapallo'), court('t2')] },
      { id: 'b', name: 'B', indoor: true, courts: [court('q1', 'squash')] },
    ],
  };
  const live = liveLocations(v, ['tennis']);
  assert.deepEqual(live.map((l) => [l.id, l.courts.map((c) => c.id)]), [['a', ['t1', 't2']]]);
  assert.equal(v.locations[0].courts.length, 3, 'the venue itself is not touched');
  assert.equal(liveLocations(v, ['tennis', 'squash']).length, 2);
});

test('the window and where items sit on it, clamped to the day and opening hours', () => {
  assert.deepEqual(win, { from: 360, until: 1380, slots: 34 });
  assert.deepEqual(spanOf(ITEMS[0], K, win), { start: 24, len: 3 });
  assert.deepEqual(spanOf(ITEMS[2], K, win), { start: 0, len: 4 });
  // Started the evening before, ends 7.00: drawn from the window start.
  assert.deepEqual(spanOf(item({ id: 'x', startsAt: at(addDays(K, -1), '23:00'), endsAt: at(K, '07:00') }), K, win), { start: 0, len: 2 });
  // Entirely after closing: not drawn.
  assert.equal(spanOf(item({ id: 'y', startsAt: at(K, '23:00'), endsAt: at(K, '23:30') }), K, win), null);
  assert.equal(minuteIn(at(addDays(K, 1), '00:00'), K), 1440);
  assert.equal(minuteIn(at(addDays(K, -1), '22:00'), K), 0);
  // The night the clocks go back doesn't shift the evening.
  assert.equal(minuteIn(at('2026-10-25', '18:00'), '2026-10-25'), 1080);
});

test('half-hour states: busy, closed, past and free', () => {
  const states = cellStates(venue, location.courts[0], K, ITEMS, 18 * 60 + 10, win);
  assert.equal(states.length, 34);
  assert.equal(states[0], 'closed');                 // 6.00, no price
  assert.equal(states[2], 'past');                   // 7.00, over by 18.10
  assert.deepEqual(states.slice(24, 28), ['busy', 'busy', 'busy', 'free']); // 18.00–19.30 booked, 19.30 free
  assert.equal(states[32], 'busy');                  // 22.00, the league runs past the price rules
  assert.ok(cellStates(venue, location.courts[0], K, [], -Infinity, win).every((s) => s === 'free' || s === 'closed'));
  assert.ok(cellStates(venue, location.courts[0], K, [], Infinity, win).every((s) => s === 'past' || s === 'closed'));
});

test('day summary counts per location and only bookable minutes', () => {
  const s = daySummary(venue, location, K, [...ITEMS, item({ id: 'elsewhere', courtId: 'zz', startsAt: at(K, '10:00'), endsAt: at(K, '11:00'), priceCents: 9999 })], win);
  assert.equal(s.bookings, 2);
  assert.equal(s.own, 3);
  assert.equal(s.unpaid, 1);
  assert.equal(s.unpaidCents, 2000);
  assert.equal(s.salesCents, 3000);
  assert.equal(s.bookableMin, 2 * 15 * 60);
  // a: 90 booked + 60 held + 30 league (21.30–22) · b: 60 block (7–8) + 30 league
  assert.equal(s.usedMin, 90 + 60 + 30 + 60 + 30);
  assert.ok(Math.abs(s.utilization - 270 / 1800) < 1e-9);
  assert.equal(daySummary(venue, location, K, [], win).utilization, 0);
});

test('block form choices, conflicts, groups and labels', () => {
  assert.equal(startChoices(win, -Infinity).length, 34);
  assert.equal(startChoices(win, 18 * 60 + 10)[0], 18 * 60);
  assert.deepEqual(startChoices(win, Infinity), []);
  assert.deepEqual(endChoices(win, 22 * 60), [22 * 60 + 30, 23 * 60]);
  assert.equal(defaultStart(win, -Infinity), 16 * 60);
  assert.equal(defaultStart(win, 18 * 60 + 10), 18 * 60);

  assert.deepEqual(conflictsFor(ITEMS, ['a'], K, 19 * 60, 20 * 60).map((it) => it.id), ['paid']);
  assert.deepEqual(conflictsFor(ITEMS, ['b'], K, 19 * 60, 20 * 60), []);
  assert.deepEqual(blockGroup(ITEMS, ITEMS[3]).map((it) => it.id).sort(), ['league-a', 'league-b']);
  assert.deepEqual(blockGroup(ITEMS, ITEMS[0]).map((it) => it.id), ['paid']);

  assert.equal(kindForTitle('Hallisarja'), 'league');
  assert.equal(kindForTitle(' hallisarja – 3. kierros'), 'league');
  assert.equal(kindForTitle('Valmennus'), 'block');
  assert.equal(courtsLabel(location.courts), 'a, b');
  assert.equal(courtsLabel(['1', '2', '3', '4', '5'].map((n) => court(n))), '5 kenttää');
  assert.equal(locationLabel({ name: 'Janus-Areena', indoor: true }), 'Janus-Areena');
  assert.equal(locationLabel({ name: 'Janus-Areena', indoor: true }, true), 'Janus');
  assert.equal(locationLabel({ name: 'Kisapuiston ulkokentät', indoor: false }), 'Ulkokentät');
  assert.equal(locationLabel({ name: 'Kisapuiston ulkokentät', indoor: false }, true), 'Ulkokentät');
  assert.deepEqual(ITEMS.map(itemVariant), ['booking', 'held', 'block', 'league', 'league']);
  assert.equal(itemVariant(item({ id: 'u', paymentStatus: 'unpaid' })), 'unpaid');
});

test('"now" on the viewed day', () => {
  const now = Date.now();
  const today = dateKey(new Date(now));
  assert.ok(Number.isFinite(nowMinuteOn(today, now)));
  assert.equal(nowMinuteOn(addDays(today, -1), now), Infinity);
  assert.equal(nowMinuteOn(addDays(today, 1), now), -Infinity);
});

test('the demo hall: live courts only, and every location adds up', async () => {
  const v = await api.booking.getVenue('lahden-tennis-ja-squash');
  const key = addDays(dateKey(new Date()), 1);
  const items = await api.booking.staffDay(v.id, key);
  const live = liveLocations(v);
  const liveCourtIds = live.flatMap((l) => l.courts.map((c) => c.id)).sort();
  const expected = v.locations.flatMap((l) => l.courts).filter((c) => LIVE_SPORTS.includes(c.sport)).map((c) => c.id).sort();
  assert.deepEqual(liveCourtIds, expected);
  assert.ok(live.every((l) => l.courts.every((c) => LIVE_SPORTS.includes(c.sport))));
  for (const loc of live) {
    const s = daySummary(v, loc, key, items);
    const ids = new Set(loc.courts.map((c) => c.id));
    const here = items.filter((it) => ids.has(it.courtId));
    assert.ok(s.utilization >= 0 && s.utilization <= 1, `${loc.name} ${s.utilization}`);
    assert.equal(s.bookings + s.season + s.own, here.length);
    assert.equal(s.salesCents, here.filter((it) => it.paymentStatus === 'paid').reduce((n, it) => n + it.priceCents, 0));
  }
});
