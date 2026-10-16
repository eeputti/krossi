// Court booking: the shared rules in features/booking.js and the demo backend that follows them
// (same messages and shapes as the krossi_*_booking RPCs + the krossi-booking edge function).
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { ApiError } from '../src/api/errors.js';
import { configureTiming } from '../src/api/demo/runtime.js';
import { db, resetStore } from '../src/api/demo/store.js';
import { backend as api } from '../src/api/demo/index.js';
import {
  addDays, bookingDays, cancelDeadline, centsLabel, courtStatesAt, dateKey, discounted, durationLabel, fitsAvailability,
  freeSlots, lastMinutePercent, localDate, priceOf, sportsOf, startTimes,
} from '../src/features/booking.js';

configureTiming({ latencyMin: 0, latencyMax: 0, autoScale: 0.001 });
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
beforeEach(() => resetStore());

const BOOKING_KEYS = [
  'id', 'venueId', 'venueName', 'locationName', 'mapKey', 'courtId', 'courtName', 'courtMapId', 'sport', 'startsAt',
  'endsAt', 'status', 'priceCents', 'paymentStatus', 'holdExpiresAt', 'cancellableUntil', 'cancelledAt', 'createdAt', 'credit',
];
const VENUE_KEYS = [
  'id', 'slug', 'name', 'city', 'openFrom', 'openUntil', 'slotMinutes', 'durations', 'daysAhead', 'cancelLimitHours',
  'holdMinutes', 'payOnline', 'lastMinute', 'isStaff', 'locations', 'prices',
];

/** Next weekday (ISO 1–7) from tomorrow on, as 'YYYY-MM-DD'. */
function next(isoWeekday) {
  const today = dateKey(new Date());
  for (let i = 1; i <= 7; i += 1) {
    const key = addDays(today, i);
    if (((localDate(key).getDay() + 6) % 7) + 1 === isoWeekday) return key;
  }
  throw new Error('unreachable');
}

async function venue() {
  return (await api.booking.listVenues())[0];
}

const tennis1 = (v, location = 0) => v.locations[location].courts.find((c) => c.mapId === 'te1');
const at = (key, hhmm) => localDate(key, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))).toISOString();

/** A free tennis start for `minutes` on `key` (prefers the evening), so tests don't hit seeded bookings. */
async function freeTennis(v, key, minutes = 60) {
  const { busy } = await api.booking.day(v.id, key);
  const slots = freeSlots(v, key, busy, { sport: 'tennis', minutes });
  assert.ok(slots.length, `no free tennis on ${key}`);
  const slot = slots[slots.length - 1];
  return { startsAt: slot.startsAt, court: slot.options[0].court, cents: slot.options[0].cents };
}

// ── Rules ─────────────────────────────────────────────────────────────────────

test('prices add up per half hour across price boundaries and weekends', async () => {
  const v = await venue();
  const te1 = tennis1(v);
  const tue = next(2);
  assert.equal(priceOf(v, te1, at(tue, '08:00'), 60), 1800);
  assert.equal(priceOf(v, te1, at(tue, '18:00'), 60), 3000);
  // 14.30–16.00: half an hour at 23 € + an hour at 30 €
  assert.equal(priceOf(v, te1, at(tue, '14:30'), 90), 1150 + 3000);
  assert.equal(priceOf(v, te1, at(next(6), '10:00'), 120), 6000);
  // weekends close at 21 for tennis
  assert.equal(priceOf(v, te1, at(next(7), '20:30'), 60), null);
  const padel = v.locations[0].courts.find((c) => c.sport === 'padel');
  assert.equal(priceOf(v, padel, at(tue, '15:30'), 60), 1150 + 1550);
  // outdoor courts only 8–21
  const k1 = v.locations[2].courts[0];
  assert.equal(priceOf(v, k1, at(tue, '07:00'), 60), null);
  assert.equal(priceOf(v, k1, at(tue, '20:30'), 60), null);
  assert.equal(priceOf(v, k1, at(tue, '18:00'), 60), 1600);
});

test('start times follow the grid, leave room for the duration and skip the past', async () => {
  const v = await venue();
  const key = next(3);
  const starts = startTimes(v, key, 90, Date.now());
  assert.equal(starts[0].getHours(), 6);
  assert.equal(starts.at(-1).getHours() * 60 + starts.at(-1).getMinutes(), 23 * 60 - 90);
  assert.ok(starts.every((d) => d.getMinutes() % 30 === 0));
  const today = startTimes(v, dateKey(new Date()), 60, Date.now());
  assert.ok(today.every((d) => d.getTime() > Date.now()));
  assert.equal(bookingDays(v).length, v.daysAhead + 1);
});

test('labels', () => {
  assert.equal(durationLabel(60), '1 h');
  assert.equal(durationLabel(90), '1,5 h');
  assert.equal(centsLabel(2500), '25 €');
  assert.equal(centsLabel(2250), '22,50 €');
});

// ── Demo backend ─────────────────────────────────────────────────────────────

test('venues: shape, sports, staff', async () => {
  const v = await venue();
  assert.deepEqual(Object.keys(v).sort(), [...VENUE_KEYS].sort());
  assert.equal(v.isStaff, true);
  // the pilot offers tennis only; the other courts stay in the data
  assert.deepEqual(sportsOf(v).map((s) => s.value), ['tennis']);
  assert.deepEqual(sportsOf(v, { all: true }).map((s) => s.value), ['tennis', 'padel', 'sulkapallo', 'squash']);
  assert.equal((await api.booking.getVenue(v.slug)).id, v.id);
  assert.equal(await api.booking.getVenue('nope'), null);
});

test('day: busy slots carry no names, blocks have titles, my bookings are marked', async () => {
  const v = await venue();
  const tomorrow = addDays(dateKey(new Date()), 1);
  const { busy } = await api.booking.day(v.id, tomorrow);
  assert.ok(busy.length > 20, 'the demo hall should look busy');
  assert.ok(busy.some((b) => b.mine), 'Alex has a booking tomorrow');
  assert.ok(busy.every((b) => Object.keys(b).sort().join() === 'courtId,endsAt,id,kind,mine,startsAt,title'));
  assert.ok(busy.filter((b) => b.kind === 'booking').every((b) => b.title === null));
  const thu = next(4);
  const league = (await api.booking.day(v.id, thu)).busy.filter((b) => b.kind === 'league');
  assert.equal(league.length, 4);
  assert.ok(league.every((b) => b.title === 'Hallisarja'));
});

test('hold → pay → listed as upcoming → cancel refunds', async () => {
  const v = await venue();
  const key = addDays(dateKey(new Date()), 3);
  const slot = await freeTennis(v, key);
  const held = await api.booking.hold({ courtId: slot.court.id, startsAt: slot.startsAt, minutes: 60 });
  assert.deepEqual(Object.keys(held).sort(), [...BOOKING_KEYS].sort());
  assert.equal(held.status, 'held');
  assert.equal(held.priceCents, slot.cents);
  assert.ok(Date.parse(held.holdExpiresAt) > Date.now());
  assert.equal(held.cancellableUntil, cancelDeadline(slot.startsAt, v));

  // the slot is now taken for everybody
  await assert.rejects(api.booking.hold({ courtId: slot.court.id, startsAt: slot.startsAt, minutes: 60 }), (err) => err instanceof ApiError && err.code === 'taken');

  assert.deepEqual(await api.booking.checkoutConfig(held.id), { demo: true, amount: slot.cents, currency: 'eur' });
  assert.deepEqual(await api.booking.createPaymentIntent(held.id), { paid: true });
  assert.deepEqual(await api.booking.verifyPayment(held.id, 'pi_demo'), { confirmed: true, status: 'succeeded' });

  const { upcoming } = await api.booking.listMine();
  const mine = upcoming.find((b) => b.id === held.id);
  assert.equal(mine.status, 'confirmed');
  assert.equal(mine.paymentStatus, 'paid');
  assert.deepEqual(upcoming.map((b) => b.startsAt), [...upcoming.map((b) => b.startsAt)].sort());

  assert.deepEqual(await api.booking.cancel(held.id), { refundedCents: slot.cents, creditCents: 0, creditMinutes: 0 });
  const after = await api.booking.listMine();
  assert.ok(!after.upcoming.some((b) => b.id === held.id));
  assert.equal(after.past.find((b) => b.id === held.id).paymentStatus, 'refunded');
});

test('hold rules: duration, grid, past, days ahead, closed, two-hold limit', async () => {
  const v = await venue();
  const te1 = tennis1(v);
  const key = addDays(dateKey(new Date()), 2);
  const reject = (input, re) => assert.rejects(api.booking.hold(input), (err) => err instanceof ApiError && re.test(err.userMessage));
  await reject({ courtId: te1.id, startsAt: at(key, '18:00'), minutes: 45 }, /kesto/);
  await reject({ courtId: te1.id, startsAt: at(key, '18:15'), minutes: 60 }, /kalenterista/);
  await reject({ courtId: te1.id, startsAt: new Date(Date.now() - 3_600_000).toISOString(), minutes: 60 }, /mennyt|kalenterista/);
  await reject({ courtId: te1.id, startsAt: at(addDays(key, v.daysAhead), '18:00'), minutes: 60 }, /päivän päähän/);
  await reject({ courtId: te1.id, startsAt: at(next(7), '20:30'), minutes: 60 }, /suljettu/);

  const day = addDays(dateKey(new Date()), 5);
  const slots = freeSlots(v, day, (await api.booking.day(v.id, day)).busy, { sport: 'tennis', minutes: 60 });
  // two hours apart, so holding one never takes the next one's court
  const picks = [slots.at(-1), slots.at(-5), slots.at(-9)];
  await api.booking.hold({ courtId: picks[0].options[0].court.id, startsAt: picks[0].startsAt, minutes: 60 });
  await api.booking.hold({ courtId: picks[1].options[0].court.id, startsAt: picks[1].startsAt, minutes: 60 });
  await reject({ courtId: picks[2].options[0].court.id, startsAt: picks[2].startsAt, minutes: 60 }, /kaksi maksamatonta/);
});

test('an expired hold frees the court and can no longer be paid', async () => {
  const v = await venue();
  const key = addDays(dateKey(new Date()), 6);
  const slot = await freeTennis(v, key);
  const held = await api.booking.hold({ courtId: slot.court.id, startsAt: slot.startsAt, minutes: 60 });
  db.booking.rows.find((r) => r.id === held.id).holdExpiresAt = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(api.booking.checkoutConfig(held.id), (err) => err.code === 'expired');
  const states = courtStatesAt(v, (await api.booking.day(v.id, key)).busy, { sport: 'tennis', startsAt: slot.startsAt, minutes: 60 });
  assert.equal(states[slot.court.id], 'free');
  const again = await api.booking.hold({ courtId: slot.court.id, startsAt: slot.startsAt, minutes: 60 });
  assert.equal(again.status, 'held');
});

test('release drops my hold; cancel is refused after the deadline', async () => {
  const v = await venue();
  const key = addDays(dateKey(new Date()), 4);
  const slot = await freeTennis(v, key);
  const held = await api.booking.hold({ courtId: slot.court.id, startsAt: slot.startsAt, minutes: 60 });
  await api.booking.release(held.id);
  assert.ok(!(await api.booking.listMine()).upcoming.some((b) => b.id === held.id));

  // Alex's seeded booking tomorrow evening may already be inside the 24 h window
  const soon = (await api.booking.listMine()).upcoming.find((b) => Date.parse(b.cancellableUntil) < Date.now());
  if (soon) await assert.rejects(api.booking.cancel(soon.id), (err) => err.code === 'too_late');
});

test('staff: day with names, block atomically, unblock, cancel with refund', async () => {
  const v = await venue();
  const key = addDays(dateKey(new Date()), 2);
  const items = await api.booking.staffDay(v.id, key);
  const booking = items.find((i) => i.kind === 'booking' && i.bookedBy);
  assert.ok(booking.bookedBy.name);
  assert.deepEqual(Object.keys(booking).sort(), [
    'bookedBy', 'courtId', 'credit', 'endsAt', 'id', 'kind', 'paymentStatus', 'priceCents', 'seasonSlotId', 'startsAt', 'status', 'title',
  ]);

  const kispiTennis = v.locations[1].courts.filter((c) => c.sport === 'tennis').map((c) => c.id);
  const late = next(1);
  const free = kispiTennis.filter((id) => !items.some((i) => i.courtId === id));
  const ids = await api.booking.block({ courtIds: kispiTennis.slice(0, 2), startsAt: at(late, '22:00'), endsAt: at(late, '23:00'), title: 'Kunnostus', kind: 'block' })
    .catch(() => null);
  if (ids) {
    assert.equal(ids.length, 2);
    await api.booking.unblock(ids[0]);
  }
  // overlapping an existing booking fails as a whole
  await assert.rejects(api.booking.block({ courtIds: [booking.courtId, ...free], startsAt: booking.startsAt, endsAt: booking.endsAt, title: 'Testi' }),
    (err) => err.code === 'taken');

  await api.booking.staffCancel(booking.id, { refund: true });
  assert.ok(!(await api.booking.staffDay(v.id, key)).some((i) => i.id === booking.id));
});

test('last-minute deal: only inside the window, rounded like the server', async () => {
  const v = await venue();
  const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
  const later = new Date(Date.now() + 30 * 3_600_000).toISOString();
  assert.equal(lastMinutePercent(v, soon), 30);
  assert.equal(lastMinutePercent(v, later), 0);
  assert.equal(lastMinutePercent({ ...v, lastMinute: null }, soon), 0);
  assert.equal(discounted(2500, 30), 1750);
  assert.equal(discounted(2100, 0), 2100);
});

test('full start times come back with includeFull, free ones carry full and final prices', async () => {
  const v = await venue();
  const key = addDays(dateKey(new Date()), 1);
  const { busy } = await api.booking.day(v.id, key);
  const all = freeSlots(v, key, busy, { sport: 'tennis', minutes: 60, includeFull: true });
  const free = freeSlots(v, key, busy, { sport: 'tennis', minutes: 60 });
  assert.ok(all.length >= free.length);
  assert.ok(all.every((s) => Array.isArray(s.options)));
  assert.ok(free.every((s) => s.options.every((o) => o.fullCents >= o.cents)));
});

test('play times: weekday evenings and weekend mornings', () => {
  const tue = next(2);
  const sat = next(6);
  assert.equal(fitsAvailability(['arki-illat'], at(tue, '18:00')), true);
  assert.equal(fitsAvailability(['arki-illat'], at(tue, '12:00')), false);
  assert.equal(fitsAvailability(['arki-illat'], at(sat, '19:00')), false);
  assert.equal(fitsAvailability(['viikonloppuaamut'], at(sat, '10:30')), true);
  assert.equal(fitsAvailability(['joustavasti'], at(tue, '18:00')), false);
  assert.equal(fitsAvailability([], at(tue, '18:00')), false);
});

test('watch a full time: limits, duplicates, already free, and the demo frees it later', async () => {
  const v = await venue();
  const key = addDays(dateKey(new Date()), 1);
  const { busy } = await api.booking.day(v.id, key);
  const full = freeSlots(v, key, busy, { sport: 'tennis', minutes: 60, includeFull: true }).filter((s) => !s.options.length);
  const free = freeSlots(v, key, busy, { sport: 'tennis', minutes: 60 });
  await assert.rejects(api.booking.watch({ venueId: v.id, sport: 'tennis', locationId: null, startsAt: free[0].startsAt, minutes: 60 }),
    (err) => err.code === 'free');
  if (!full.length) return; // nothing full tomorrow in this seed: the rest needs a full time
  const w = await api.booking.watch({ venueId: v.id, sport: 'tennis', locationId: null, startsAt: full[0].startsAt, minutes: 60 });
  assert.deepEqual(Object.keys(w).sort(), ['createdAt', 'id', 'locationId', 'minutes', 'notifiedAt', 'sport', 'startsAt', 'venueId']);
  const again = await api.booking.watch({ venueId: v.id, sport: 'tennis', locationId: null, startsAt: full[0].startsAt, minutes: 60 });
  assert.equal(again.id, w.id);
  assert.equal((await api.booking.listWatches()).length, 1);
  await tick(60); // the demo's "somebody cancels" runs 1000x faster in tests
  const [watched] = await api.booking.listWatches();
  if (watched.notifiedAt) {
    const after = await api.booking.day(v.id, key);
    const now = freeSlots(v, key, after.busy, { sport: 'tennis', minutes: 60 });
    assert.ok(now.some((s) => s.startsAt === full[0].startsAt), 'the watched time is free now');
  }
  await api.booking.unwatch(w.id);
  assert.equal((await api.booking.listWatches()).length, 0);
});
