// Court booking: the shared rules in features/booking.js and the demo backend that follows them
// (same messages and shapes as the krossi_*_booking RPCs + the krossi-booking edge function).
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { ApiError } from '../src/api/errors.js';
import { configureTiming } from '../src/api/demo/runtime.js';
import { db, resetStore } from '../src/api/demo/store.js';
import { backend as api } from '../src/api/demo/index.js';
import { outdoorUntil } from '../src/api/demo/bookingSeed.js';
import {
  addDays, bookingDays, canPutOnSale, cancelDeadline, centsLabel, chargeErrorText, courtStatesAt, dateKey, discounted,
  durationLabel, findCourt, fitsAvailability, freeSlots, friendsPaid, giveBackOf, giveBackShort, giveBackText, isTaken,
  lastMinutePercent, localDate, priceOf, shareDeadline, splitBlocker, splitCents, sportsOf, startTimes,
} from '../src/features/booking.js';

configureTiming({ latencyMin: 0, latencyMax: 0, autoScale: 0.001 });
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
beforeEach(() => resetStore());

const BOOKING_KEYS = [
  'id', 'venueId', 'venueName', 'locationName', 'mapKey', 'courtId', 'courtName', 'courtMapId', 'sport', 'startsAt',
  'endsAt', 'status', 'priceCents', 'paymentStatus', 'holdExpiresAt', 'cancellableUntil', 'cancelledAt', 'createdAt', 'credit',
  'forSale', 'soldAt', 'split',
];
const VENUE_KEYS = [
  'id', 'slug', 'name', 'city', 'openFrom', 'openUntil', 'slotMinutes', 'durations', 'daysAhead', 'cancelLimitHours',
  'holdMinutes', 'payOnline', 'lastMinute', 'isStaff', 'locations', 'prices', 'shareDeadlineHours',
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
  // outdoor courts from 8: until 21 in the summer, until 18 the rest of the year
  const k1 = v.locations[2].courts[0];
  assert.equal(priceOf(v, k1, at(tue, '07:00'), 60), null);
  assert.equal(priceOf(v, k1, at(tue, '20:30'), 60), null);
  assert.equal(priceOf(v, k1, at(tue, '17:00'), 60), 1600);
  assert.equal(priceOf(v, k1, at(tue, '18:00'), 60), outdoorUntil(Date.now()) === '21:00' ? 1600 : null);
  assert.equal(outdoorUntil(new Date(2026, 9, 16)), '18:00');
  assert.equal(outdoorUntil(new Date(2027, 4, 1)), '21:00');
  assert.equal(outdoorUntil(new Date(2027, 7, 31)), '21:00');
  assert.equal(outdoorUntil(new Date(2027, 8, 1)), '18:00');
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
  assert.ok(busy.every((b) => Object.keys(b).sort().join() === 'courtId,endsAt,forSale,id,kind,mine,startsAt,title'));
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
    'bookedBy', 'courtId', 'credit', 'endsAt', 'forSale', 'id', 'kind', 'parts', 'paymentStatus', 'priceCents', 'seasonSlotId', 'startsAt',
    'status', 'title', 'unpaidCents',
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
  const soon = new Date(Date.now() + 1 * 3_600_000).toISOString();
  const later = new Date(Date.now() + 30 * 3_600_000).toISOString();
  assert.equal(lastMinutePercent(v, soon), 20);
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

// ── Jaettu maksu (demo) ──────────────────────────────────────────────────────

const LINE_KEYS = ['cents', 'id', 'kind', 'paidAt', 'person', 'status'];
const SHARE_KEYS = ['booker', 'booking', 'cents', 'chargeError', 'deadline', 'id', 'kind', 'paidAt', 'payable', 'status'];
const messagesWith = async (userId) => {
  const conversation = (await api.messages.listConversations()).find((c) => !c.isGroup && c.participants.some((p) => p.id === userId));
  return conversation ? api.messages.listMessages(conversation.id) : [];
};

test('split: pelikaverit to pick from, the price split in whole cents, my part paid first', async () => {
  const friends = await api.booking.shareFriends();
  const ids = friends.map((p) => p.id);
  assert.ok(['p-mikko', 'p-laura', 'p-ville'].every((id) => ids.includes(id)));
  assert.ok(!ids.includes('demo-user'));
  assert.ok(friends.every((p) => Object.keys(p).sort().join() === 'ageRange,avatarColor,avatarUrl,id,name,skillLevel'));

  const v = await venue();
  const slot = await freeTennis(v, addDays(dateKey(new Date()), 5));
  const held = await api.booking.hold({ courtId: slot.court.id, startsAt: slot.startsAt, minutes: 60, friendIds: ['p-mikko', 'p-laura', 'p-ville'] });
  assert.equal(held.status, 'held');
  assert.equal(held.split.parts, 4);
  const { ownCents, friendCents } = splitCents(held.priceCents, 4);
  assert.equal(held.split.ownCents, ownCents);
  assert.equal(ownCents + 3 * friendCents, held.priceCents);
  assert.equal(held.split.deadline, shareDeadline(held.startsAt, v));
  assert.deepEqual(held.split.lines.map((l) => [l.kind, l.status]), [['own', 'pending'], ['friend', 'pending'], ['friend', 'pending'], ['friend', 'pending']]);
  held.split.lines.forEach((l) => assert.deepEqual(Object.keys(l).sort(), LINE_KEYS));
  assert.deepEqual(await api.booking.checkoutConfig(held.id), { demo: true, amount: ownCents, currency: 'eur' });

  // Nobody is asked before I have paid my part.
  assert.ok(!(await messagesWith('p-ville')).some((m) => /Osuutesi/.test(m.text || '')));
  assert.deepEqual(await api.booking.createPaymentIntent(held.id), { paid: true });
  for (const friend of ['p-mikko', 'p-laura', 'p-ville']) {
    const asked = (await messagesWith(friend)).find((m) => m.senderId === 'demo-user' && /Osuutesi on/.test(m.text || ''));
    assert.ok(asked, `${friend} got the request`);
    assert.match(asked.text, /https:\/\/krossi\.app\/pelaa\/osuus\/sh-new-\d+$/);
  }

  await tick(80); // two of the three pay within moments in the demo; the last leaves it for later
  const mine = (await api.booking.listMine()).upcoming.find((b) => b.id === held.id);
  assert.deepEqual(mine.split.lines.map((l) => l.status), ['paid', 'paid', 'paid', 'pending']);
  assert.ok(mine.split.lines.slice(1, 3).every((l) => l.paidAt));
  assert.ok((await messagesWith('p-mikko')).some((m) => m.senderId === 'p-mikko' && /Maksoin osuuteni/.test(m.text)));
});

test('split: the rules for whom and when', async () => {
  const v = await venue();
  const key = addDays(dateKey(new Date()), 6);
  const slot = await freeTennis(v, key);
  const reject = (friendIds, re) => assert.rejects(api.booking.hold({ courtId: slot.court.id, startsAt: slot.startsAt, minutes: 60, friendIds }),
    (err) => err instanceof ApiError && re.test(err.userMessage));
  await reject(['p-mikko', 'p-laura'], /kaksinpeliin yksi ja nelinpeliin kolme/);
  await reject(['p-mikko', 'p-mikko'], /kaksinpeliin yksi ja nelinpeliin kolme/);
  await reject(['demo-user'], /pelikavereidesi/);
  const friends = new Set((await api.booking.shareFriends()).map((p) => p.id));
  const stranger = (await api.players.list({ city: 'Lahti' })).find((p) => !friends.has(p.id));
  if (stranger) await reject([stranger.id], /pelikavereidesi/);
  // nothing was held by the refused attempts
  assert.ok(!(await api.booking.listMine()).upcoming.some((b) => b.startsAt === slot.startsAt && b.courtId === slot.court.id));

  const now = Date.now();
  assert.match(splitBlocker(v, new Date(now + 2.25 * 3_600_000).toISOString(), 3000, 2, now), /ei ehdi enää/);
  assert.equal(splitBlocker(v, new Date(now + 3 * 3_600_000).toISOString(), 3000, 2, now), null);
  assert.match(splitBlocker(v, new Date(now + 30 * 3_600_000).toISOString(), 150, 4, now), /liian edullinen/);
  assert.deepEqual(splitCents(2250, 4), { ownCents: 564, friendCents: 562 });
  assert.deepEqual(splitCents(3000, 2), { ownCents: 1500, friendCents: 1500 });
});

test('a friend\'s side: Mikko asked for my share — it is listed, can be declined and still paid', async () => {
  const shares = await api.booking.listShares();
  const fromMikko = shares.find((s) => s.kind === 'friend' && s.booker.id === 'p-mikko');
  assert.ok(fromMikko, 'the seeded request from Mikko');
  assert.deepEqual(Object.keys(fromMikko).sort(), SHARE_KEYS);
  assert.equal(fromMikko.payable, true);
  assert.equal(fromMikko.status, 'pending');
  assert.equal(fromMikko.cents, 1500);
  assert.deepEqual(Object.keys(fromMikko.booking).sort(), [...BOOKING_KEYS].sort());
  assert.deepEqual(fromMikko.booking.split.lines.map((l) => [l.kind, l.person.id, l.status]),
    [['own', 'p-mikko', 'paid'], ['friend', 'demo-user', 'pending']]);
  assert.ok(shares.indexOf(fromMikko) <= shares.findIndex((s) => !s.payable) || shares.every((s) => s.payable), 'payable first');
  assert.ok((await messagesWith('p-mikko')).some((m) => m.senderId === 'p-mikko' && m.text.includes(`/pelaa/osuus/${fromMikko.id}`)));

  assert.deepEqual(await api.booking.getShare(fromMikko.id), fromMikko);
  assert.deepEqual(await api.booking.shareCheckoutConfig(fromMikko.id), { demo: true, amount: 1500, currency: 'eur' });
  await api.booking.declineShare(fromMikko.id);
  const declined = await api.booking.getShare(fromMikko.id);
  assert.equal(declined.status, 'declined');
  assert.equal(declined.payable, true, 'declined is still owed until the deadline');
  assert.ok((await messagesWith('p-mikko')).some((m) => m.senderId === 'demo-user' && /En pääse valitettavasti mukaan/.test(m.text)));

  assert.deepEqual(await api.booking.createSharePaymentIntent(fromMikko.id), { paid: true });
  assert.deepEqual(await api.booking.verifySharePayment(fromMikko.id, 'pi_demo'), { paid: true, status: 'succeeded' });
  assert.equal((await api.booking.getShare(fromMikko.id)).status, 'paid');
  assert.deepEqual(await api.booking.shareCheckoutConfig(fromMikko.id), { paid: true });
  await assert.rejects(api.booking.declineShare(fromMikko.id), /jo maksettu/);

  assert.equal(await api.booking.getShare('nope'), null);
  await assert.rejects(api.booking.shareCheckoutConfig('nope'), (err) => err.code === 'not_found');
});

test('the deadline: unpaid shares become my rest, charged; a card that said no leaves a rest to pay', async () => {
  const shares = await api.booking.listShares();
  assert.equal(shares.some((s) => s.kind === 'rest' && s.payable), false, 'the demo starts without an unpaid rest');

  // Alex's nelinpeli: Ville hasn't paid. Once its deadline passes, Ville's share is charged to Alex.
  const nelinpeli = (await api.booking.listMine()).upcoming.find((b) => b.split?.parts === 4);
  assert.deepEqual(nelinpeli.split.lines.map((l) => l.status), ['paid', 'paid', 'paid', 'pending']);
  db.booking.rows.find((r) => r.id === nelinpeli.id).split.deadline = new Date(Date.now() - 60_000).toISOString();
  const after = (await api.booking.listMine()).upcoming.find((b) => b.id === nelinpeli.id);
  const ville = after.split.lines[3];
  const rest = after.split.lines.at(-1);
  assert.deepEqual([ville.status, rest.kind, rest.status, rest.cents, rest.person.id], ['covered', 'rest', 'paid', ville.cents, 'demo-user']);

  // Had the card said no, the rest stays for Alex to pay in Krossi.
  const restRow = db.booking.shares.find((s) => s.bookingId === nelinpeli.id && s.kind === 'rest');
  Object.assign(restRow, { status: 'pending', paidAt: null, chargeError: 'card_declined' });
  const failed = (await api.booking.listShares()).find((s) => s.id === restRow.id);
  assert.equal(failed.payable, true);
  assert.equal(chargeErrorText(failed.chargeError), 'Kortti hylättiin');
  assert.equal(failed.booker.id, 'demo-user');
  assert.deepEqual(failed.booking.split.lines.map((l) => [l.kind, l.status]).slice(-2), [['friend', 'covered'], ['rest', 'pending']]);
  await api.booking.createSharePaymentIntent(failed.id);
  assert.equal((await api.booking.getShare(failed.id)).status, 'paid');

  // A friend share past its deadline can't be paid any more: the booker has covered it.
  const fromMikko = shares.find((s) => s.kind === 'friend' && s.booker.id === 'p-mikko');
  db.booking.rows.find((r) => r.id === fromMikko.booking.id).split.deadline = new Date(Date.now() - 60_000).toISOString();
  await assert.rejects(api.booking.shareCheckoutConfig(fromMikko.id), (err) => err.code === 'closed' && /Mikko maksaa osuutesi/.test(err.userMessage));
  assert.equal((await api.booking.getShare(fromMikko.id)).status, 'covered');
});

test('cancelling a split booking before the limit gives everybody their part back', async () => {
  const v = await venue();
  const slot = await freeTennis(v, addDays(dateKey(new Date()), 7));
  const held = await api.booking.hold({ courtId: slot.court.id, startsAt: slot.startsAt, minutes: 60, friendIds: ['p-laura'] });
  await api.booking.createPaymentIntent(held.id);
  await tick(40); // Laura pays
  assert.deepEqual((await api.booking.listMine()).upcoming.find((b) => b.id === held.id).split.lines.map((l) => l.status), ['paid', 'paid']);
  assert.deepEqual(await api.booking.cancel(held.id), { refundedCents: held.split.ownCents, creditCents: 0, creditMinutes: 0 });
  const gone = (await api.booking.listMine()).past.find((b) => b.id === held.id);
  assert.deepEqual([gone.status, gone.paymentStatus], ['cancelled', 'refunded']);
  assert.deepEqual(gone.split.lines.map((l) => l.status), ['refunded', 'refunded']);
});

// ── Laita myyntiin (demo) ────────────────────────────────────────────────────

test('on sale: only after the free cancellation; the slot is bookable for others; when it sells, everything goes back', async () => {
  const v = await venue();
  const { upcoming } = await api.booking.listMine();
  const late = upcoming.find((b) => Date.parse(b.cancellableUntil) <= Date.now());
  assert.ok(late, 'the seed has a booking inside the 24 h limit');
  assert.equal(canPutOnSale(late), true);
  const early = upcoming.find((b) => Date.parse(b.cancellableUntil) > Date.now());
  await assert.rejects(api.booking.putOnSale(early.id), (err) => err.code === 'cancellable');

  const listed = await api.booking.putOnSale(late.id);
  assert.equal(listed.forSale, true);
  assert.equal(canPutOnSale(listed), false);
  const key = dateKey(new Date(late.startsAt));
  const entry = (await api.booking.day(v.id, key)).busy.find((b) => b.id === late.id);
  assert.deepEqual([entry.forSale, entry.mine], [true, true]);
  // For me it is still mine; for anybody else the court is free at exactly that time, at the full price.
  const minutes = Math.round((Date.parse(late.endsAt) - Date.parse(late.startsAt)) / 60_000);
  const mineSlots = freeSlots(v, key, [entry], { sport: 'tennis', minutes, includeFull: true });
  assert.ok(!mineSlots.find((s) => s.startsAt === late.startsAt)?.options.some((o) => o.court.id === late.courtId));
  const theirs = [{ ...entry, mine: false }];
  const option = freeSlots(v, key, theirs, { sport: 'tennis', minutes }).find((s) => s.startsAt === late.startsAt)
    .options.find((o) => o.court.id === late.courtId);
  assert.deepEqual([option.resale, option.cents], [true, option.fullCents]);
  const half = Date.parse(late.startsAt) + 30 * 60_000;
  assert.equal(isTaken(theirs, late.courtId, half, half + 60 * 60_000), true, 'a partial overlap is still taken');

  assert.equal((await api.booking.takeOffSale(late.id)).forSale, false);
  await api.booking.putOnSale(late.id);
  await tick(40); // somebody books it in the demo
  const after = await api.booking.listMine();
  assert.ok(!after.upcoming.some((b) => b.id === late.id));
  const sold = after.past.find((b) => b.id === late.id);
  assert.deepEqual([sold.status, sold.paymentStatus, sold.forSale], ['cancelled', 'refunded', false]);
  assert.ok(sold.soldAt);
  const now = (await api.booking.day(v.id, key)).busy.filter((b) => b.courtId === late.courtId && b.startsAt === late.startsAt);
  assert.deepEqual(now.map((b) => [b.mine, b.forSale]), [[false, false]], 'the buyer has the court now');
});

test('buying somebody\'s on-sale slot takes it over at the full price; a partial overlap is refused', async () => {
  const v = await venue();
  const today = dateKey(new Date());
  let entry = null;
  let key = null;
  for (const k of [today, addDays(today, 1)]) {
    entry = (await api.booking.day(v.id, k)).busy.find((b) => b.forSale && !b.mine);
    if (entry) { key = k; break; }
  }
  assert.ok(entry, 'the seed has somebody\'s slot on sale');
  const minutes = Math.round((Date.parse(entry.endsAt) - Date.parse(entry.startsAt)) / 60_000);
  const court = findCourt(v, entry.courtId).court;
  if (Date.parse(entry.startsAt) > Date.now() + 30 * 60_000 && minutes >= 60) {
    const half = new Date(Date.parse(entry.startsAt) + 30 * 60_000).toISOString();
    await assert.rejects(api.booking.hold({ courtId: entry.courtId, startsAt: half, minutes: 60 }), (err) => err.code === 'taken');
  }
  const held = await api.booking.hold({ courtId: entry.courtId, startsAt: entry.startsAt, minutes });
  assert.equal(held.priceCents, priceOf(v, court, entry.startsAt, minutes), 'no last-minute deal on a resale');
  await api.booking.createPaymentIntent(held.id);
  const seller = db.booking.rows.find((r) => r.id === entry.id);
  assert.deepEqual([seller.status, seller.resoldBy, seller.paymentStatus], ['cancelled', held.id, 'refunded']);
  const busy = (await api.booking.day(v.id, key)).busy.filter((b) => b.courtId === entry.courtId && b.startsAt === entry.startsAt);
  assert.deepEqual(busy.map((b) => [b.id, b.mine, b.forSale]), [[held.id, true, false]]);
});

test('what comes back when a booking is cancelled or sold: card money, gift balance, series card hours', () => {
  const card = { priceCents: 3000, paymentStatus: 'paid', credit: null, split: null };
  assert.deepEqual(giveBackOf(card), { cardCents: 3000, giftCents: 0, minutes: 0 });
  assert.equal(giveBackText(giveBackOf(card)), 'Saat takaisin 30 € maksutavallesi');
  assert.equal(giveBackShort(giveBackOf({ ...card, paymentStatus: 'refunded' })), '30 € palautetaan', 'the same once it went back');
  const gift = { ...card, credit: { kind: 'gift', cents: 500, minutes: 0, name: null } };
  assert.equal(giveBackText(giveBackOf(gift)), 'Saat takaisin 25 € maksutavallesi ja 5 € lahjakorttisaldoosi');
  const allGift = { ...card, paymentStatus: 'credit', credit: { kind: 'gift', cents: 3000, minutes: 0, name: null } };
  assert.equal(giveBackText(giveBackOf(allGift)), 'Saat takaisin 30 € lahjakorttisaldoosi');
  const pass = { ...card, paymentStatus: 'credit', credit: { kind: 'pass', cents: 3000, minutes: 90, name: 'Tennis 10 × 1 h' } };
  assert.equal(giveBackText(giveBackOf(pass)), 'Saat takaisin 1,5 h sarjakortillesi');
  assert.equal(giveBackShort(giveBackOf(pass)), '1,5 h sarjakortille');
  assert.equal(giveBackText(giveBackOf({ ...card, paymentStatus: 'free' })), null);
  assert.equal(giveBackText(giveBackOf({ ...card, paymentStatus: 'unpaid' })), null);
  const line = (kind, status, cents) => ({ id: null, kind, person: null, cents, status, paidAt: null });
  const split = { ...card, split: { parts: 4, ownCents: 750, lines: [line('own', 'refunded', 750), line('friend', 'refunded', 750), line('friend', 'covered', 750), line('rest', 'refunded', 1500)] } };
  assert.deepEqual(giveBackOf(split), { cardCents: 2250, giftCents: 0, minutes: 0 }, 'my part and the rest; friends get their own');
  assert.equal(friendsPaid(split), true);
  assert.equal(friendsPaid(card), false);
  assert.equal(giveBackText({ cardCents: 1500, giftCents: 200, minutes: 60 }), 'Saat takaisin 15 € maksutavallesi, 2 € lahjakorttisaldoosi ja 1 h sarjakortillesi');
});

test('a split booking is paid by card: no series card or gift balance on it', async () => {
  const v = await venue();
  const slot = await freeTennis(v, addDays(dateKey(new Date()), 8));
  const held = await api.booking.hold({ courtId: slot.court.id, startsAt: slot.startsAt, minutes: 60, friendIds: ['p-laura'] });
  const pass = (await api.wallet.get(v.id)).passes.find((p) => p.status === 'active');
  assert.ok(pass, 'the seed gives Alex a series card');
  await assert.rejects(api.wallet.payBooking(held.id, pass.id), /Jaetun vuoron osuudet maksetaan kortilla/);
  await assert.rejects(api.wallet.useGift(held.id, true), /Jaetun vuoron osuudet maksetaan kortilla/);
  assert.deepEqual(await api.booking.checkoutConfig(held.id), { demo: true, amount: held.split.ownCents, currency: 'eur' });
});

test('a series card buys somebody\'s on-sale slot: taken over at once, the seller refunded', async () => {
  const v = await venue();
  const today = dateKey(new Date());
  let entry = null;
  for (const k of [today, addDays(today, 1)]) {
    entry = (await api.booking.day(v.id, k)).busy.find((b) => b.forSale && !b.mine);
    if (entry) break;
  }
  assert.ok(entry, 'the seed has somebody\'s slot on sale');
  const minutes = Math.round((Date.parse(entry.endsAt) - Date.parse(entry.startsAt)) / 60_000);
  const held = await api.booking.hold({ courtId: entry.courtId, startsAt: entry.startsAt, minutes });
  const pass = (await api.wallet.get(v.id)).passes.find((p) => p.status === 'active');
  db.booking.passes.find((p) => p.id === pass.id).minutesLeft = 600;
  const paid = await api.wallet.payBooking(held.id, pass.id);
  assert.deepEqual([paid.status, paid.paymentStatus, paid.credit.minutes], ['confirmed', 'credit', minutes]);
  const seller = db.booking.rows.find((r) => r.id === entry.id);
  assert.deepEqual([seller.status, seller.resoldBy, seller.paymentStatus], ['cancelled', held.id, 'refunded']);
});

test('my series-card booking on sale: when it sells, the hours go back to the card', async () => {
  const v = await venue();
  const now = Date.now();
  // a free tennis start 3–22 h away: inside the free-cancellation limit, so it can go on sale
  let slot = null;
  for (const key of [dateKey(new Date(now)), addDays(dateKey(new Date(now)), 1)]) {
    const { busy } = await api.booking.day(v.id, key);
    slot = freeSlots(v, key, busy, { sport: 'tennis', minutes: 60 })
      .find((s) => Date.parse(s.startsAt) > now + 3 * 3_600_000 && Date.parse(s.startsAt) < now + 22 * 3_600_000);
    if (slot) break;
  }
  assert.ok(slot, 'a free court later today or tomorrow');
  const held = await api.booking.hold({ courtId: slot.options[0].court.id, startsAt: slot.startsAt, minutes: 60 });
  const pass = (await api.wallet.get(v.id)).passes.find((p) => p.status === 'active');
  db.booking.passes.find((p) => p.id === pass.id).minutesLeft = 600;
  await api.wallet.payBooking(held.id, pass.id);
  assert.equal((await api.wallet.get(v.id)).passes.find((p) => p.id === pass.id).minutesLeft, 540);
  await api.booking.putOnSale(held.id);
  await tick(40); // somebody books it in the demo
  const sold = (await api.booking.listMine()).past.find((b) => b.id === held.id);
  assert.ok(sold?.soldAt, 'sold');
  assert.deepEqual([sold.status, sold.paymentStatus], ['cancelled', 'refunded']);
  assert.equal(giveBackText(giveBackOf(sold)), 'Saat takaisin 1 h sarjakortillesi');
  const after = (await api.wallet.get(v.id)).passes.find((p) => p.id === pass.id);
  assert.equal(after.minutesLeft, 600);
  assert.match(after.history[0].label, /^Myyty: /);
});

test('staff see what is on sale and what is still unpaid', async () => {
  const v = await venue();
  const nelinpeli = (await api.booking.listMine()).upcoming.find((b) => b.split?.parts === 4);
  const items = await api.booking.staffDay(v.id, dateKey(new Date(nelinpeli.startsAt)));
  const item = items.find((i) => i.id === nelinpeli.id);
  assert.deepEqual([item.parts, item.unpaidCents, item.forSale], [4, nelinpeli.split.lines[3].cents, false]);
  assert.ok(items.filter((i) => i.kind !== 'booking').every((i) => i.unpaidCents === 0 && i.parts === null));
});
