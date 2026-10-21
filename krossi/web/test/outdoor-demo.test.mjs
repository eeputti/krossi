// The public demo's booking world (krossi.app/demo and the booking site krossi.app/varaa): only the six
// Kisapuisto clay courts, 16 €/h, summer hours 8–21 every day of the year. The other test files keep the
// halls world, which has every sport and price level the booking engine must handle.
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { configureTiming } from '../src/api/demo/runtime.js';
import { configureDemoWorld, db } from '../src/api/demo/store.js';
import { backend as api } from '../src/api/demo/index.js';
import { ME } from '../src/api/demo/rows.js';
import { OUTDOOR_HOURS } from '../src/api/demo/bookingSeed.js';
import { addDays, dateKey, freeSlots, localDate, priceOf, sportsOf } from '../src/features/booking.js';

configureTiming({ latencyMin: 0, latencyMax: 0, autoScale: 0.001 });
beforeEach(() => configureDemoWorld({ courts: 'outdoor' }));
after(() => configureDemoWorld({ courts: 'halls' }));

const at = (key, hhmm) => localDate(key, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))).toISOString();
const minutesOfDay = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };

test('the outdoor world is one place with six clay tennis courts', async () => {
  const venues = await api.booking.listVenues();
  assert.equal(venues.length, 1);
  const [v] = venues;
  assert.equal(v.name, 'Lahden ulkokentät');
  assert.equal(v.slug, 'lahden-ulkokentat');
  assert.equal(v.locations.length, 1);
  const [place] = v.locations;
  assert.equal(place.indoor, false);
  assert.equal(place.mapKey, 'lahti-kisapuisto');
  assert.deepEqual(place.courts.map((c) => c.name), ['Kenttä 1', 'Kenttä 2', 'Kenttä 3', 'Kenttä 4', 'Kenttä 5', 'Kenttä 6']);
  assert.ok(place.courts.every((c) => c.sport === 'tennis' && c.surface === 'massa'));
  assert.deepEqual(sportsOf(v).map((s) => s.value), ['tennis']);
  assert.equal(await api.booking.getVenue('lahden-ulkokentat').then((x) => x.id), v.id);
});

test('16 €/h from 8 to 21 every day, in winter too', async () => {
  const [v] = await api.booking.listVenues();
  const k1 = v.locations[0].courts[0];
  for (const key of ['2027-01-12', '2026-10-24', '2027-07-04']) {
    assert.equal(priceOf(v, k1, at(key, OUTDOOR_HOURS.from), 60), 1600, key);
    assert.equal(priceOf(v, k1, at(key, '20:00'), 60), 1600, key);
    assert.equal(priceOf(v, k1, at(key, '19:30'), 90), 2400, key);
    assert.equal(priceOf(v, k1, at(key, '07:30'), 60), null, key);
    assert.equal(priceOf(v, k1, at(key, '20:30'), 60), null, key);
  }
});

test('every seeded booking fits the courts and their hours', () => {
  const v = db.booking.venues[0];
  const courts = new Set(v.locations[0].courts.map((c) => c.id));
  for (const row of db.booking.rows) {
    assert.ok(courts.has(row.courtId), row.id);
    assert.ok(minutesOfDay(row.startsAt) >= 8 * 60, `${row.id} starts ${row.startsAt}`);
    assert.ok(minutesOfDay(row.endsAt) <= 21 * 60 && minutesOfDay(row.endsAt) > minutesOfDay(row.startsAt), `${row.id} ends ${row.endsAt}`);
    if (row.kind === 'booking') assert.ok(row.priceCents > 0, `${row.id} has a price`);
  }
  assert.deepEqual(db.booking.seasons.map((s) => s.name.split(' ')[0]), ['Kausi', 'Kesäkausi']);
  assert.ok(db.booking.seasonSlots.every((s) => s.weeks > 0), 'every kausivuoro has weeks');
  assert.equal(db.booking.billing[v.id].seller.name, 'Lahden ulkokentät (demo)');
  // A series card is cheaper per hour than paying for the hour.
  assert.ok(db.booking.passProducts.every((p) => p.priceCents / (p.uses * p.minutesPerUse / 60) < 1600));
});

test('Alex has courts coming up and there are evening times left to book', async () => {
  const mine = await api.booking.listMine();
  assert.ok(mine.upcoming.length >= 3);
  assert.ok(mine.upcoming.every((b) => b.locationName === 'Kisapuiston ulkokentät'));
  const [v] = await api.booking.listVenues();
  const tomorrow = addDays(dateKey(new Date()), 1);
  const { busy } = await api.booking.day(v.id, tomorrow);
  const evening = freeSlots(v, tomorrow, busy, { sport: 'tennis', minutes: 60 })
    .filter((s) => s.options.length && minutesOfDay(s.startsAt) >= 17 * 60);
  assert.ok(evening.length >= 3, 'some evening starts are still free');
});

test('a court on the booking site books and pays like anywhere else', async () => {
  const [v] = await api.booking.listVenues();
  const key = addDays(dateKey(new Date()), 2);
  const { busy } = await api.booking.day(v.id, key);
  const slot = freeSlots(v, key, busy, { sport: 'tennis', minutes: 60 }).find((s) => s.options.length);
  const held = await api.booking.hold({ courtId: slot.options[0].court.id, startsAt: slot.startsAt, minutes: 60 });
  assert.equal(held.priceCents, 1600);
  assert.deepEqual(await api.booking.createPaymentIntent(held.id), { paid: true });
  assert.deepEqual(await api.booking.verifyPayment(held.id, 'pi_demo'), { confirmed: true, status: 'succeeded' });
  const booked = (await api.booking.listMine()).upcoming.find((b) => b.id === held.id);
  assert.equal(booked.status, 'confirmed');
  assert.equal(booked.locationName, 'Kisapuiston ulkokentät');
  assert.ok(db.booking.rows.some((r) => r.id === held.id && r.bookedBy === ME));
});
