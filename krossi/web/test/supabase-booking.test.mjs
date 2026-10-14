// The real booking backend (api/supabase/booking.js) against a fake supabase-js client: the RPC
// and edge-function arguments it sends, the shapes it returns, and how errors reach the UI.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setClientForTests } from '../src/api/supabase/client.js';
import * as booking from '../src/api/supabase/booking.js';
import { backend } from '../src/api/supabase/index.js';
import { API_CONTRACT } from '../src/api/contract.js';
import { ApiError } from '../src/api/errors.js';
import { SUPABASE_URL } from '../src/lib/constants.js';

const UID = '11111111-1111-4111-8111-111111111111';
const VENUE = 'b00c0000-0000-4000-a000-000000000001';
const LOC = 'b00c0000-0000-4000-a000-000000000011';
const COURT = 'b00c0000-0000-4000-a001-000000000001';
const COURT2 = 'b00c0000-0000-4000-a001-000000000002';
const BOOKING = '33333333-3333-4333-8333-333333333333';
const WATCH = '44444444-4444-4444-8444-444444444444';

/**
 * Stand-in for supabase-js: records every rpc / functions.invoke call. `rpc(name, args)` and
 * `invoke(body, name)` return what supabase-js would resolve to ({ data, error }).
 */
function fakeClient({ rpc = () => undefined, invoke = () => undefined, signedIn = true } = {}) {
  const log = { rpc: [], invoked: [] };
  return {
    log,
    from(table) {
      throw new Error(`booking.js must not read tables directly (${table})`);
    },
    async rpc(name, args) {
      log.rpc.push({ name, args });
      return (await rpc(name, args)) ?? { data: null, error: null };
    },
    functions: {
      async invoke(name, options) {
        log.invoked.push({ name, body: options?.body });
        return (await invoke(options?.body, name)) ?? { data: null, error: null };
      },
    },
    auth: {
      getSession: async () => ({ data: { session: signedIn ? { user: { id: UID, email: 'me@example.com' } } : null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
}

/** What supabase-js gives for a non-2xx answer of an edge function with a JSON { error } body. */
function functionError(message, status = 409) {
  return {
    data: null,
    error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      name: 'FunctionsHttpError',
      context: new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } }),
    }),
  };
}

const raised = (message) => ({ data: null, error: { code: 'P0001', message, details: null, hint: null } });
const flush = () => new Promise((resolve) => setImmediate(resolve));

const VENUE_ROW = {
  id: VENUE,
  slug: 'lahden-tennis-ja-squash',
  name: 'Lahden Tennis- ja Squashkeskus',
  city: 'Lahti',
  openFrom: '06:00',
  openUntil: '23:00',
  slotMinutes: 30,
  durations: [60, 90, 120],
  daysAhead: 14,
  cancelLimitHours: 24,
  holdMinutes: 10,
  payOnline: true,
  lastMinute: { hours: 4, percent: 30 },
  isStaff: false,
  locations: [{
    id: LOC, name: 'Janus-Areena', address: 'Heinlammintie 64, Lahti', indoor: true, mapKey: 'lahti-janus',
    lat: 61.0015881, lng: 25.6970796,
    courts: [{ id: COURT, locationId: LOC, name: 'Tennis 1', shortName: 'Te1', sport: 'tennis', surface: 'kova', mapId: 'te1' }],
  }],
  prices: [{ sports: ['tennis'], courtIds: [COURT], weekdays: [1, 2, 3, 4, 5], from: '15:00', until: '21:00', centsPerHour: 3000 }],
};

const BOOKING_ROW = {
  id: BOOKING, venueId: VENUE, venueName: 'Lahden Tennis- ja Squashkeskus', locationName: 'Janus-Areena', mapKey: 'lahti-janus',
  courtId: COURT, courtName: 'Tennis 1', courtMapId: 'te1', sport: 'tennis', startsAt: '2026-10-20T15:00:00.000Z',
  endsAt: '2026-10-20T16:00:00.000Z', status: 'held', priceCents: 3000, paymentStatus: 'unpaid',
  holdExpiresAt: '2026-10-14T18:10:00.000Z', cancellableUntil: '2026-10-19T15:00:00.000Z', cancelledAt: null,
  createdAt: '2026-10-14T18:00:00.000Z',
};

const BOOKING_KEYS = ['id', 'venueId', 'venueName', 'locationName', 'mapKey', 'courtId', 'courtName', 'courtMapId', 'sport',
  'startsAt', 'endsAt', 'status', 'priceCents', 'paymentStatus', 'holdExpiresAt', 'cancellableUntil', 'cancelledAt', 'createdAt'];

test('booking exports exactly the contract functions and is registered in the backend', () => {
  assert.deepEqual(Object.keys(booking).sort(), [...API_CONTRACT.booking].sort());
  assert.equal(backend.booking, booking);
});

test('listVenues works without a session and keeps the contract shape', async () => {
  const fake = fakeClient({ signedIn: false, rpc: () => ({ data: [VENUE_ROW], error: null }) });
  setClientForTests(fake);
  const venues = await booking.listVenues();
  assert.deepEqual(fake.log.rpc, [{ name: 'krossi_booking_venues', args: {} }]);
  assert.deepEqual(venues, [VENUE_ROW]);
  assert.equal(venues[0].locations[0].lat, 61.0015881);
  assert.deepEqual(venues[0].lastMinute, { hours: 4, percent: 30 });
});

test('listVenues answers [] while the booking migration is not deployed', async () => {
  setClientForTests(fakeClient({
    rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.krossi_booking_venues without parameters in the schema cache' } }),
  }));
  assert.deepEqual(await booking.listVenues(), []);
  assert.equal(await booking.getVenue('lahden-tennis-ja-squash'), null);

  setClientForTests(fakeClient({ rpc: () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) }));
  await assert.rejects(booking.listVenues(), (err) => err instanceof ApiError && err.userMessage === 'Varauksia ei voitu ladata.');
});

test('listVenues fills in what an older server leaves out', async () => {
  const { lastMinute, isStaff, ...older } = VENUE_ROW;
  setClientForTests(fakeClient({ rpc: () => ({ data: [{ ...older, locations: [{ ...older.locations[0], lat: undefined, lng: undefined }] }], error: null }) }));
  const [venue] = await booking.listVenues();
  assert.equal(venue.lastMinute, null);
  assert.equal(venue.isStaff, false);
  assert.equal(venue.locations[0].lat, null);
  assert.equal(venue.locations[0].lng, null);
});

test('getVenue finds a venue by id or slug, never sending a malformed id', async () => {
  const fake = fakeClient({ rpc: () => ({ data: [VENUE_ROW], error: null }) });
  setClientForTests(fake);
  assert.equal((await booking.getVenue(VENUE)).slug, 'lahden-tennis-ja-squash');
  assert.equal((await booking.getVenue(VENUE.toUpperCase())).id, VENUE);
  assert.equal((await booking.getVenue('lahden-tennis-ja-squash')).id, VENUE);
  assert.equal(await booking.getVenue('ei-ole'), null);
  assert.equal(await booking.getVenue('00000000-0000-4000-8000-000000000000'), null);
  const before = fake.log.rpc.length;
  assert.equal(await booking.getVenue(''), null);
  assert.equal(await booking.getVenue(null), null);
  assert.equal(fake.log.rpc.length, before);
});

test('day sends the venue and the local date; bad input never reaches the network', async () => {
  const busy = [{ id: BOOKING, courtId: COURT, startsAt: '2026-10-20T15:00:00.000Z', endsAt: '2026-10-20T16:00:00.000Z', kind: 'block', mine: false, title: 'Hallisarja' }];
  const fake = fakeClient({ signedIn: false, rpc: () => ({ data: { date: '2026-10-20', busy }, error: null }) });
  setClientForTests(fake);
  assert.deepEqual(await booking.day(VENUE, '2026-10-20'), { date: '2026-10-20', busy });
  assert.deepEqual(fake.log.rpc, [{ name: 'krossi_booking_day', args: { venue_id_input: VENUE, day_input: '2026-10-20' } }]);
  await assert.rejects(booking.day('lahti', '2026-10-20'), (err) => err.code === 'not_found' && err.userMessage === 'Hallia ei löytynyt.');
  await assert.rejects(booking.day(VENUE, '20.10.2026'), (err) => err.code === 'invalid');
  assert.equal(fake.log.rpc.length, 1);
});

test('hold sends ISO time and whole minutes and returns a Booking; RPC messages reach the player as-is', async () => {
  const fake = fakeClient({ rpc: () => ({ data: BOOKING_ROW, error: null }) });
  setClientForTests(fake);
  const held = await booking.hold({ courtId: COURT, startsAt: new Date('2026-10-20T15:00:00Z'), minutes: '60' });
  assert.deepEqual(fake.log.rpc[0], {
    name: 'krossi_hold_booking',
    args: { court_id_input: COURT, starts_at_input: '2026-10-20T15:00:00.000Z', minutes_input: 60 },
  });
  assert.deepEqual(Object.keys(held).sort(), [...BOOKING_KEYS].sort());
  assert.deepEqual(held, BOOKING_ROW);

  setClientForTests(fakeClient({ rpc: () => raised('Valitse varauksen kesto.') }));
  await assert.rejects(booking.hold({ courtId: COURT, startsAt: BOOKING_ROW.startsAt, minutes: 45 }),
    (err) => err instanceof ApiError && err.userMessage === 'Valitse varauksen kesto.');
  setClientForTests(fakeClient({ rpc: () => raised('Joku ehti varata tämän ajan juuri ennen sinua. Valitse toinen aika.') }));
  await assert.rejects(booking.hold({ courtId: COURT, startsAt: BOOKING_ROW.startsAt, minutes: 60 }), (err) => err.code === 'taken');
  setClientForTests(fakeClient({ rpc: () => ({ data: null, error: { code: '23P01', message: 'conflicting key value violates exclusion constraint' } }) }));
  await assert.rejects(booking.hold({ courtId: COURT, startsAt: BOOKING_ROW.startsAt, minutes: 60 }),
    (err) => err.userMessage === 'Varaus epäonnistui. Yritä hetken päästä uudelleen.');

  const signedOut = fakeClient({ signedIn: false });
  setClientForTests(signedOut);
  await assert.rejects(booking.hold({ courtId: COURT, startsAt: BOOKING_ROW.startsAt, minutes: 60 }), (err) => err.code === 'auth_required');
  setClientForTests(fakeClient());
  await assert.rejects(booking.hold({ courtId: 'x', startsAt: BOOKING_ROW.startsAt, minutes: 60 }), (err) => err.code === 'not_found');
  await assert.rejects(booking.hold({ courtId: COURT, startsAt: 'huomenna', minutes: 60 }), (err) => err.code === 'invalid');
  assert.equal(signedOut.log.rpc.length, 0);
});

test('release drops the hold and then tells krossi-booking the court is free (never failing on that)', async () => {
  const fake = fakeClient({ invoke: () => functionError('Varausta ei löytynyt.', 404) });
  setClientForTests(fake);
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    await booking.release(BOOKING);
    await flush();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(fake.log.rpc, [{ name: 'krossi_release_booking', args: { booking_id_input: BOOKING } }]);
  assert.deepEqual(fake.log.invoked, [{ name: 'krossi-booking', body: { action: 'freed', bookingId: BOOKING } }]);
  assert.equal(warnings.length, 1);

  const failing = fakeClient({ rpc: () => raised('Varausta ei löytynyt.') });
  setClientForTests(failing);
  await assert.rejects(booking.release(BOOKING), (err) => err.code === 'not_found');
  assert.equal(failing.log.invoked.length, 0);
});

test('checkout: config, intent and verify go to krossi-booking with the booking id', async () => {
  const answers = {
    config: { data: { publishableKey: 'pk_test_x', amount: 3000, currency: 'eur', email: 'me@example.com' }, error: null },
    intent: { data: { clientSecret: 'pi_1_secret_2', paymentIntentId: 'pi_1' }, error: null },
    verify: { data: { confirmed: true, status: 'succeeded' }, error: null },
  };
  const fake = fakeClient({ invoke: (body) => answers[body.action] });
  setClientForTests(fake);
  assert.deepEqual(await booking.checkoutConfig(BOOKING), { publishableKey: 'pk_test_x', amount: 3000, currency: 'eur', email: 'me@example.com' });
  assert.deepEqual(await booking.createPaymentIntent(BOOKING), { clientSecret: 'pi_1_secret_2', paymentIntentId: 'pi_1' });
  assert.deepEqual(await booking.verifyPayment(BOOKING, 'pi_1'), { confirmed: true, status: 'succeeded' });
  assert.deepEqual(fake.log.invoked, [
    { name: 'krossi-booking', body: { action: 'config', bookingId: BOOKING } },
    { name: 'krossi-booking', body: { action: 'intent', bookingId: BOOKING } },
    { name: 'krossi-booking', body: { action: 'verify', bookingId: BOOKING, paymentIntentId: 'pi_1' } },
  ]);

  setClientForTests(fakeClient({ invoke: () => ({ data: { paid: true }, error: null }) }));
  assert.deepEqual(await booking.checkoutConfig(BOOKING), { paid: true });
  assert.deepEqual(await booking.createPaymentIntent(BOOKING), { paid: true });
});

test('checkout errors: the function\'s own Finnish text and code reach the UI', async () => {
  setClientForTests(fakeClient({ invoke: () => functionError('Varauksen pitoaika ehti umpeutua. Valitse aika uudelleen.') }));
  await assert.rejects(booking.checkoutConfig(BOOKING),
    (err) => err instanceof ApiError && err.code === 'expired' && err.userMessage === 'Varauksen pitoaika ehti umpeutua. Valitse aika uudelleen.');
  await assert.rejects(booking.createPaymentIntent(BOOKING), (err) => err.code === 'expired');

  setClientForTests(fakeClient({ invoke: () => ({ data: null, error: Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' }) }) }));
  await assert.rejects(booking.checkoutConfig(BOOKING), (err) => err.userMessage === 'Maksun aloitus epäonnistui. Yritä hetken päästä uudelleen.');

  setClientForTests(fakeClient({ invoke: () => ({ data: {}, error: null }) }));
  await assert.rejects(booking.checkoutConfig(BOOKING), (err) => err instanceof ApiError);
});

test('verifyPayment reports a lost court with the function\'s message', async () => {
  setClientForTests(fakeClient({ invoke: () => ({ data: { confirmed: false, status: 'lost', error: 'Aika ehti mennä toiselle — maksu palautettiin.' }, error: null }) }));
  assert.deepEqual(await booking.verifyPayment(BOOKING, 'pi_9'),
    { confirmed: false, status: 'lost', message: 'Aika ehti mennä toiselle — maksu palautettiin.' });
  setClientForTests(fakeClient({ invoke: () => ({ data: { confirmed: false, status: 'processing' }, error: null }) }));
  assert.deepEqual(await booking.verifyPayment(BOOKING, 'pi_9'), { confirmed: false, status: 'processing' });
});

test('listMine maps both lists; cancel returns the refunded amount', async () => {
  const past = { ...BOOKING_ROW, id: '55555555-5555-4555-8555-555555555555', status: 'cancelled', paymentStatus: 'refunded', cancelledAt: '2026-10-13T08:00:00+00:00' };
  const fake = fakeClient({
    rpc: () => ({ data: { upcoming: [BOOKING_ROW], past: [past] }, error: null }),
    invoke: () => ({ data: { refundedCents: 3000 }, error: null }),
  });
  setClientForTests(fake);
  const mine = await booking.listMine();
  assert.deepEqual(fake.log.rpc, [{ name: 'krossi_my_bookings', args: {} }]);
  assert.deepEqual(mine.upcoming, [BOOKING_ROW]);
  assert.equal(mine.past[0].cancelledAt, '2026-10-13T08:00:00.000Z'); // normalised to toISOString()
  assert.deepEqual(await booking.cancel(BOOKING), { refundedCents: 3000 });
  assert.deepEqual(fake.log.invoked.at(-1), { name: 'krossi-booking', body: { action: 'cancel', bookingId: BOOKING } });

  setClientForTests(fakeClient({ invoke: () => functionError('Peruutusaika on mennyt. Ota yhteyttä halliin.') }));
  await assert.rejects(booking.cancel(BOOKING), (err) => err.code === 'too_late' && err.userMessage === 'Peruutusaika on mennyt. Ota yhteyttä halliin.');
});

test('watch / unwatch / listWatches', async () => {
  const row = { id: WATCH, venueId: VENUE, sport: 'tennis', locationId: null, startsAt: '2026-10-20T15:00:00.000Z', minutes: 60, notifiedAt: null, createdAt: '2026-10-14T18:00:00.000Z' };
  const fake = fakeClient({ rpc: (name) => ({ data: name === 'krossi_booking_my_watches' ? [row] : row, error: null }) });
  setClientForTests(fake);
  assert.deepEqual(await booking.watch({ venueId: VENUE, sport: 'tennis', startsAt: row.startsAt, minutes: 60 }), row);
  assert.deepEqual(fake.log.rpc[0], {
    name: 'krossi_booking_watch',
    args: { venue_id_input: VENUE, sport_input: 'tennis', location_id_input: null, starts_at_input: row.startsAt, minutes_input: 60 },
  });
  await booking.watch({ venueId: VENUE, sport: 'tennis', locationId: LOC, startsAt: row.startsAt, minutes: 90 });
  assert.equal(fake.log.rpc[1].args.location_id_input, LOC);
  assert.deepEqual(await booking.listWatches(), [row]);
  await booking.unwatch(WATCH);
  assert.deepEqual(fake.log.rpc.slice(2), [
    { name: 'krossi_booking_my_watches', args: {} },
    { name: 'krossi_booking_unwatch', args: { watch_id_input: WATCH } },
  ]);
  await booking.unwatch('not-an-id');
  assert.equal(fake.log.rpc.length, 4);
  await assert.rejects(booking.watch({ venueId: VENUE, sport: 'tennis', locationId: 'Janus', startsAt: row.startsAt, minutes: 60 }), (err) => err.code === 'not_found');

  setClientForTests(fakeClient({ rpc: () => raised('Aika on vapaana — varaa se heti.') }));
  await assert.rejects(booking.watch({ venueId: VENUE, sport: 'tennis', startsAt: row.startsAt, minutes: 60 }),
    (err) => err.code === 'free' && err.userMessage === 'Aika on vapaana — varaa se heti.');
  setClientForTests(fakeClient({ rpc: () => raised('Sinulla on jo 5 hälytystä. Poista jokin ensin.') }));
  await assert.rejects(booking.watch({ venueId: VENUE, sport: 'tennis', startsAt: row.startsAt, minutes: 60 }),
    (err) => err.userMessage === 'Sinulla on jo 5 hälytystä. Poista jokin ensin.');
});

test('staffDay builds the booker\'s PersonLite like map.js; blocks have no booker', async () => {
  const items = [
    {
      id: BOOKING, courtId: COURT, startsAt: '2026-10-20T15:00:00.000Z', endsAt: '2026-10-20T16:00:00.000Z', kind: 'booking',
      status: 'confirmed', title: null, priceCents: 3000, paymentStatus: 'paid',
      bookedBy: { id: UID, name: 'Pelaaja Yksi', avatarUrl: 'avatars/p1.jpg', avatarColor: 'red', ageRange: '20-30', skillLevel: 'kilpapelaaja,B1' },
    },
    {
      id: WATCH, courtId: COURT2, startsAt: '2026-10-20T15:00:00.000Z', endsAt: '2026-10-20T18:00:00.000Z', kind: 'league',
      status: 'confirmed', title: 'Hallisarja', priceCents: 0, paymentStatus: 'none', bookedBy: null,
    },
    {
      id: '66666666-6666-4666-8666-666666666666', courtId: COURT, startsAt: '2026-10-20T17:00:00.000Z', endsAt: '2026-10-20T18:00:00.000Z',
      kind: 'booking', status: 'held', title: null, priceCents: 3000, paymentStatus: 'unpaid',
      bookedBy: { id: '77777777-7777-4777-8777-777777777777', name: 'Pelaaja', avatarUrl: null, avatarColor: 'blue', ageRange: null, skillLevel: null },
    },
  ];
  const fake = fakeClient({ rpc: () => ({ data: items, error: null }) });
  setClientForTests(fake);
  const day = await booking.staffDay(VENUE, '2026-10-20');
  assert.deepEqual(fake.log.rpc, [{ name: 'krossi_booking_staff_day', args: { venue_id_input: VENUE, day_input: '2026-10-20' } }]);
  assert.deepEqual(day[0].bookedBy, {
    id: UID, name: 'Pelaaja Yksi', avatarUrl: `${SUPABASE_URL}/storage/v1/object/public/profile-avatars/avatars/p1.jpg`,
    avatarColor: 'red', ageRange: '20-30', skillLevel: 'kilpapelaaja',
  });
  assert.equal(day[1].bookedBy, null);
  assert.equal(day[1].title, 'Hallisarja');
  assert.equal(day[1].paymentStatus, 'none');
  assert.equal(day[2].bookedBy.skillLevel, null);
  assert.equal(day[2].bookedBy.avatarUrl, null);

  setClientForTests(fakeClient({ rpc: () => raised('Vain hallin henkilökunta voi tehdä tämän.') }));
  await assert.rejects(booking.staffDay(VENUE, '2026-10-20'), (err) => err.code === 'forbidden');
});

test('block sends each court once; unblock tells krossi-booking the court is free', async () => {
  const fake = fakeClient({ rpc: (name) => ({ data: name === 'krossi_booking_block' ? [BOOKING, WATCH] : null, error: null }) });
  setClientForTests(fake);
  const ids = await booking.block({
    courtIds: [COURT, COURT2, COURT, 'Te3'], startsAt: '2026-10-20T15:00:00Z', endsAt: new Date('2026-10-20T18:00:00Z'),
    title: 'Hallisarja', kind: 'league',
  });
  assert.deepEqual(ids, [BOOKING, WATCH]);
  assert.deepEqual(fake.log.rpc[0], {
    name: 'krossi_booking_block',
    args: {
      court_ids_input: [COURT, COURT2], starts_at_input: '2026-10-20T15:00:00.000Z', ends_at_input: '2026-10-20T18:00:00.000Z',
      title_input: 'Hallisarja', kind_input: 'league',
    },
  });
  await booking.block({ courtIds: [COURT], startsAt: '2026-10-20T15:00:00Z', endsAt: '2026-10-20T16:00:00Z', title: 'Valmennus' });
  assert.equal(fake.log.rpc[1].args.kind_input, 'block');
  await assert.rejects(booking.block({ courtIds: ['Te1'], startsAt: '2026-10-20T15:00:00Z', endsAt: '2026-10-20T16:00:00Z', title: 'x' }),
    (err) => err.userMessage === 'Valitse ainakin yksi kenttä.');

  await booking.unblock(BOOKING);
  await flush();
  assert.deepEqual(fake.log.rpc.at(-1), { name: 'krossi_booking_unblock', args: { block_id_input: BOOKING } });
  assert.deepEqual(fake.log.invoked, [{ name: 'krossi-booking', body: { action: 'freed', bookingId: BOOKING } }]);

  setClientForTests(fakeClient({ rpc: () => raised('Aika ei ole vapaa kaikilla valituilla kentillä.') }));
  await assert.rejects(booking.block({ courtIds: [COURT], startsAt: '2026-10-20T15:00:00Z', endsAt: '2026-10-20T16:00:00Z', title: 'x' }),
    (err) => err.code === 'taken');
});

test('staffCancel refunds by default and resolves to nothing', async () => {
  const fake = fakeClient({ invoke: () => ({ data: { refundedCents: 3000 }, error: null }) });
  setClientForTests(fake);
  assert.equal(await booking.staffCancel(BOOKING), undefined);
  await booking.staffCancel(BOOKING, { refund: false });
  assert.deepEqual(fake.log.invoked, [
    { name: 'krossi-booking', body: { action: 'staffCancel', bookingId: BOOKING, refund: true } },
    { name: 'krossi-booking', body: { action: 'staffCancel', bookingId: BOOKING, refund: false } },
  ]);
  setClientForTests(fakeClient({ invoke: () => functionError('Vain hallin henkilökunta voi tehdä tämän.', 403) }));
  await assert.rejects(booking.staffCancel(BOOKING), (err) => err.code === 'forbidden');
});
