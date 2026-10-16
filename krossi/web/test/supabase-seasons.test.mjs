// The real phase-2 booking backend (api/supabase/seasons.js, billing.js, wallet.js) against a fake
// supabase-js client: which RPC / edge action each function calls with which arguments, the shapes
// it returns, what happens before the migration is deployed, and how errors reach the UI.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setClientForTests } from '../src/api/supabase/client.js';
import * as seasons from '../src/api/supabase/seasons.js';
import * as billing from '../src/api/supabase/billing.js';
import * as wallet from '../src/api/supabase/wallet.js';
import { backend } from '../src/api/supabase/index.js';
import { API_CONTRACT } from '../src/api/contract.js';
import { ApiError } from '../src/api/errors.js';

const UID = '11111111-1111-4111-8111-111111111111';
const VENUE = 'b00c0000-0000-4000-a000-000000000001';
const SEASON = 'b00c0000-0000-4000-a010-000000000001';
const COURT = 'b00c0000-0000-4000-a001-000000000001';
const SLOT = '22222222-2222-4222-8222-222222222222';
const BOOKING = '33333333-3333-4333-8333-333333333333';
const PASS = '44444444-4444-4444-8444-444444444444';
const INVOICE = '55555555-5555-4555-8555-555555555555';
const CHARGE = '66666666-6666-4666-8666-666666666666';

function fakeClient({ rpc = () => undefined, invoke = () => undefined, signedIn = true } = {}) {
  const log = { rpc: [], invoked: [] };
  return {
    log,
    from(table) {
      throw new Error(`phase-2 modules must not read tables directly (${table})`);
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

const raised = (message) => ({ data: null, error: { code: 'P0001', message, details: null, hint: null } });
const missing = { data: null, error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } };
function functionError(message, status = 409) {
  return {
    data: null,
    error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      name: 'FunctionsHttpError',
      context: new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } }),
    }),
  };
}

const SLOT_ROW = {
  id: SLOT, venueId: VENUE, seasonId: SEASON, seasonName: 'Talvikausi 2026–2027', sport: 'tennis', courtId: COURT, courtName: 'Tennis 1',
  locationId: 'b00c0000-0000-4000-a000-000000000011', locationName: 'Janus-Areena', weekday: 3, startTime: '19:00', minutes: 60,
  startsOn: '2026-10-21', endsOn: '2027-05-02', skipDates: ['2026-12-24'], status: 'active', billing: 'card', priceCents: 76500,
  weeks: 27, holderName: 'Pelaaja Yksi',
  holder: { id: UID, name: 'Pelaaja Yksi', avatarUrl: null, avatarColor: 'red', ageRange: '20-30', skillLevel: 'keskitaso' },
  billingEmail: 'p1@example.fi', billingAddress: null, note: null, declineReason: null, nextAt: '2026-10-21T16:00:00.000Z',
  invoice: null,
  charges: [{ id: CHARGE, seasonSlotId: SLOT, month: '2026-10', weeks: 2, amountCents: 5100, dueOn: '2026-10-16', status: 'failed',
    attempts: 1, failureMessage: 'Pankki hylkäsi veloituksen.', paidAt: null, holderName: 'Pelaaja Yksi' }],
  createdAt: '2026-10-14T18:00:00.000Z', decidedAt: '2026-10-16T08:00:00.000Z', notifiedAt: '2026-10-16T08:00:02.000Z',
};

test('the phase-2 modules export exactly their contract functions and are registered', () => {
  for (const [name, mod] of [['seasons', seasons], ['billing', billing], ['wallet', wallet]]) {
    assert.deepEqual(Object.keys(mod).sort(), [...API_CONTRACT[name]].sort(), name);
    assert.equal(backend[name], mod);
  }
});

test('before the migration is deployed the pages just look empty', async () => {
  setClientForTests(fakeClient({ rpc: () => missing }));
  assert.deepEqual(await seasons.list(VENUE), []);
  assert.deepEqual(await seasons.listMine(), []);
  assert.equal(await billing.cardStatus(), null);
  assert.deepEqual(await wallet.products(VENUE), { passes: [], gift: null });
  assert.deepEqual(await wallet.get(VENUE), { venueId: VENUE, passes: [], giftCents: 0, giftHistory: [], giftCards: [] });
  // the hall's views too
  assert.deepEqual(await seasons.staffList(VENUE), []);
  assert.deepEqual(await billing.listInvoices(VENUE), []);
  assert.deepEqual(await billing.listCharges(VENUE), []);
  assert.deepEqual(await wallet.staffList(VENUE), { passes: [], giftCards: [] });
});

test('seasons: arguments, mapping, and the conflict error the approve sheet looks for', async () => {
  const fake = fakeClient({
    rpc: (name) => {
      if (name === 'krossi_seasons') return { data: [{ id: SEASON, venueId: VENUE, name: 'Talvikausi', startsOn: '2026-08-31', endsOn: '2027-05-02', skipDates: ['2026-12-24'], discountPercent: 15, requestsOpen: true }], error: null };
      if (name === 'krossi_season_approve') return raised('Kenttä on varattu 2 viikkona (17.10., 24.10.). Ohita ne viikot tai valitse toinen kenttä.');
      return { data: SLOT_ROW, error: null };
    },
  });
  setClientForTests(fake);
  const [season] = await seasons.list(VENUE);
  assert.equal(season.discountPercent, 15);
  const slot = await seasons.request({ seasonId: SEASON, courtId: COURT, weekday: 3, startTime: '19:00', minutes: 60, billing: 'card', note: 'Hei' });
  assert.deepEqual(fake.log.rpc[1], {
    name: 'krossi_season_request',
    args: { season_id_input: SEASON, court_id_input: COURT, location_id_input: null, weekday_input: 3, start_time_input: '19:00',
      minutes_input: 60, billing_input: 'card', note_input: 'Hei' },
  });
  assert.deepEqual(slot, SLOT_ROW);
  await assert.rejects(seasons.approve(SLOT, { skipConflicts: false }), (err) => err instanceof ApiError && err.code === 'conflict'
    && err.userMessage.startsWith('Kenttä on varattu 2 viikkona'));
  assert.deepEqual(fake.log.rpc.at(-1).args, { slot_id_input: SLOT, court_id_input: null, price_cents_input: null, skip_conflicts_input: false });
  await assert.rejects(seasons.quote({ seasonId: SEASON, weekday: 9, startTime: '19:00', minutes: 60 }), /viikonpäivä/);
  await assert.rejects(seasons.quote({ seasonId: SEASON, weekday: 1, startTime: '7:00', minutes: 60 }), /aloitusaika/);
  setClientForTests(fakeClient({ rpc: () => raised('Tallenna ensin kortti, jolta kuukausimaksut veloitetaan.') }));
  await assert.rejects(seasons.request({ seasonId: SEASON, weekday: 3, startTime: '19:00', minutes: 60, billing: 'card' }), (err) => err.code === 'card_required');
});

test('billing: invoices by RPC, cards and charges through krossi-billing', async () => {
  const fake = fakeClient({
    rpc: () => ({ data: null, error: null }),
    invoke: (body) => {
      if (body.action === 'cardSetup') return { data: { publishableKey: 'pk_test_x', clientSecret: 'seti_1_secret', email: 'me@example.com' }, error: null };
      if (body.action === 'cardSaved') return { data: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 }, error: null };
      if (body.action === 'runCharges') return { data: { paid: 2, failed: 1 }, error: null };
      if (body.action === 'payCharge') return { data: { publishableKey: 'pk_test_x', clientSecret: 'pi_9_secret', paymentIntentId: 'pi_9', amount: 5100, currency: 'eur', email: null }, error: null };
      if (body.action === 'verifyCharge') return { data: { paid: true, status: 'succeeded' }, error: null };
      return functionError('Laskulla ei ole sähköpostiosoitetta. Tulosta lasku tai lisää osoite.');
    },
  });
  setClientForTests(fake);
  assert.equal(await billing.getInvoice('nope'), null);
  assert.equal(await billing.getInvoice(INVOICE), null);
  assert.deepEqual(fake.log.rpc[0], { name: 'krossi_billing_invoice', args: { invoice_id_input: INVOICE } });
  assert.deepEqual(await billing.cardSetup(), { publishableKey: 'pk_test_x', clientSecret: 'seti_1_secret', email: 'me@example.com' });
  await assert.rejects(billing.cardSaved('demo-4242'), /Korttia ei löytynyt/);
  assert.equal((await billing.cardSaved('seti_1')).last4, '4242');
  assert.deepEqual(await billing.runCharges(VENUE), { paid: 2, failed: 1 });
  assert.equal((await billing.payCharge(CHARGE)).paymentIntentId, 'pi_9');
  assert.deepEqual(await billing.verifyCharge(CHARGE, 'pi_9'), { paid: true, status: 'succeeded' });
  assert.deepEqual(fake.log.invoked.map((c) => [c.name, c.body.action]), [
    ['krossi-billing', 'cardSetup'], ['krossi-billing', 'cardSaved'], ['krossi-billing', 'runCharges'],
    ['krossi-billing', 'payCharge'], ['krossi-billing', 'verifyCharge'],
  ]);
  await assert.rejects(billing.sendInvoice(INVOICE), (err) => err.userMessage === 'Laskulla ei ole sähköpostiosoitetta. Tulosta lasku tai lisää osoite.');
  await assert.rejects(billing.markInvoicePaid(INVOICE, '16.10.2026'), /maksupäivä/);
});

test('wallet: orders through krossi-billing, redeem answers become errors, credit returns a Booking', async () => {
  const booking = {
    id: BOOKING, venueId: VENUE, venueName: 'Halli', locationName: 'Janus-Areena', mapKey: 'lahti-janus', courtId: COURT,
    courtName: 'Tennis 1', courtMapId: 'te1', sport: 'tennis', startsAt: '2026-10-20T15:00:00.000Z', endsAt: '2026-10-20T16:00:00.000Z',
    status: 'confirmed', priceCents: 3000, paymentStatus: 'credit', holdExpiresAt: null, cancellableUntil: '2026-10-19T15:00:00.000Z',
    cancelledAt: null, createdAt: '2026-10-14T18:00:00.000Z', credit: { kind: 'pass', cents: 3000, minutes: 60, name: 'Tennis 10 × 1 h' },
    forSale: false, soldAt: null, split: null,
  };
  const fake = fakeClient({
    rpc: (name) => {
      if (name === 'krossi_wallet_redeem') return { data: { ok: false, code: 'used', error: 'Tämä lahjakortti on jo käytetty.' }, error: null };
      return { data: booking, error: null };
    },
    invoke: (body) => (body.action === 'orderConfig'
      ? { data: { publishableKey: 'pk_test_x', amount: 26000, currency: 'eur', email: 'me@example.com' }, error: null }
      : { data: { paid: true }, error: null }),
  });
  setClientForTests(fake);
  await assert.rejects(wallet.redeem('KRSI-AAAA-BBBB'), (err) => err.code === 'used' && err.userMessage === 'Tämä lahjakortti on jo käytetty.');
  assert.deepEqual(await wallet.payBooking(BOOKING, PASS), booking);
  assert.deepEqual(fake.log.rpc.at(-1), { name: 'krossi_wallet_pay_booking', args: { booking_id_input: BOOKING, pass_id_input: PASS } });
  await wallet.useGift(BOOKING, false);
  assert.deepEqual(fake.log.rpc.at(-1).args, { booking_id_input: BOOKING, use_input: false });
  assert.deepEqual(await wallet.checkoutConfig({ kind: 'pass', id: PASS }), { publishableKey: 'pk_test_x', amount: 26000, currency: 'eur', email: 'me@example.com' });
  assert.deepEqual(await wallet.createPaymentIntent({ kind: 'pass', id: PASS }), { paid: true });
  assert.deepEqual(fake.log.invoked.filter((c) => c.name === 'krossi-billing').map((c) => c.body),
    [{ action: 'orderConfig', kind: 'pass', id: PASS }, { action: 'orderIntent', kind: 'pass', id: PASS }]);
  // A booking the credit confirmed: krossi-booking refunds the on-sale slots it took over (fire and forget).
  assert.deepEqual(fake.log.invoked.find((c) => c.name === 'krossi-booking')?.body, { action: 'confirmed', bookingId: BOOKING });
  await assert.rejects(wallet.checkoutConfig({ kind: 'lahja', id: PASS }), /Tilausta ei löytynyt/);
});

// ── Hallin asetukset ──────────────────────────────────────────────────────────

test('settings: before the migration the views look empty or not ready', async () => {
  setClientForTests(fakeClient({ rpc: () => missing }));
  assert.deepEqual(await seasons.staffSeasons(VENUE), []);
  assert.deepEqual(await wallet.staffProducts(VENUE), { passes: [], gift: null });
  const settings = await billing.getSettings(VENUE);
  assert.deepEqual([settings.venueId, settings.sellerName, settings.ready, settings.nextInvoiceNumber, settings.vatPercent], [VENUE, '', false, 1001, 14]);
});

test('settings: seasons, products, gift cards and invoicing details go to their RPCs as typed arguments', async () => {
  const STAFF_SEASON = {
    id: SEASON, venueId: VENUE, name: 'Talvikausi', startsOn: '2026-08-31', endsOn: '2027-05-02', skipDates: ['2026-12-24'], discountPercent: 15,
    requestsOpen: true, activeSlots: 3, requests: 1, bookedFrom: '2026-09-02', bookedUntil: '2027-04-28', removable: false,
  };
  const PRODUCT = {
    id: PASS, venueId: VENUE, name: 'Tennis 10 × 1 h', sport: 'tennis', uses: 10, minutesPerUse: 60, validDays: 365, priceCents: 26000,
    description: null, active: false, sold: 4, removable: false,
  };
  const GIFT = { amounts: [2500, 5000], minCents: 1000, maxCents: 30000, validDays: 365 };
  const SETTINGS = {
    venueId: VENUE, sellerName: 'Halli Oy', businessId: '0112038-9', address: null, iban: 'FI2112345600000785', bic: 'NDEAFIHH',
    email: 'laskutus@halli.fi', phone: null, vatPercent: 25.5, paymentTermsDays: 14, nextInvoiceNumber: 1006, lastInvoiceNumber: 1005,
    ready: true, updatedAt: '2026-10-16T08:00:00.000Z',
  };
  const fake = fakeClient({
    rpc: (name) => {
      if (name === 'krossi_season_save' || name === 'krossi_season_staff_seasons') return { data: name === 'krossi_season_save' ? STAFF_SEASON : [STAFF_SEASON], error: null };
      if (name === 'krossi_wallet_staff_products') return { data: { passes: [PRODUCT], gift: GIFT }, error: null };
      if (name === 'krossi_wallet_save_product') return { data: PRODUCT, error: null };
      if (name === 'krossi_wallet_save_gift_settings') return { data: GIFT, error: null };
      if (name === 'krossi_billing_settings' || name === 'krossi_billing_save_settings') return { data: SETTINGS, error: null };
      if (name === 'krossi_season_remove') return raised('Kaudella on kausivuoroja tai hakemuksia, joten sitä ei voi poistaa. Sulje haku, niin uusia ei tule.');
      return { data: null, error: null };
    },
  });
  setClientForTests(fake);
  assert.deepEqual(await seasons.staffSeasons(VENUE), [STAFF_SEASON]);
  assert.deepEqual(await seasons.saveSeason({
    id: null, venueId: VENUE, name: 'Talvikausi', startsOn: '2026-08-31', endsOn: '2027-05-02', skipDates: ['2026-12-24', 'nope'],
    discountPercent: 12.5, requestsOpen: false,
  }), STAFF_SEASON);
  assert.deepEqual(fake.log.rpc.at(-1), {
    name: 'krossi_season_save',
    args: { season_id_input: null, venue_id_input: VENUE, name_input: 'Talvikausi', starts_on_input: '2026-08-31', ends_on_input: '2027-05-02',
      skip_dates_input: ['2026-12-24'], discount_percent_input: null, requests_open_input: false },
  });
  await assert.rejects(seasons.removeSeason(SEASON), (err) => err instanceof ApiError && /ei voi poistaa/.test(err.userMessage));
  await assert.rejects(seasons.saveSeason({ id: 'nope', venueId: VENUE, name: 'X' }), /Kautta ei löytynyt/);

  assert.deepEqual(await wallet.staffProducts(VENUE), { passes: [PRODUCT], gift: GIFT });
  assert.deepEqual(await wallet.saveProduct({ ...PRODUCT, uses: '10', priceCents: 26000.5 }), PRODUCT);
  assert.deepEqual(fake.log.rpc.at(-1).args, {
    product_id_input: PASS, venue_id_input: VENUE, name_input: 'Tennis 10 × 1 h', sport_input: 'tennis', uses_input: null,
    minutes_per_use_input: 60, valid_days_input: 365, price_cents_input: null, description_input: null, active_input: false,
  });
  await wallet.removeProduct(PASS);
  assert.deepEqual(fake.log.rpc.at(-1), { name: 'krossi_wallet_remove_product', args: { product_id_input: PASS } });
  assert.deepEqual(await wallet.saveGiftSettings(VENUE, { amounts: [2500, 5000, 25.5], minCents: 1000, maxCents: 30000, validDays: 365 }), GIFT);
  assert.deepEqual(fake.log.rpc.at(-1).args, {
    venue_id_input: VENUE, amounts_input: [2500, 5000, null], min_cents_input: 1000, max_cents_input: 30000, valid_days_input: 365,
  });

  assert.deepEqual(await billing.getSettings(VENUE), SETTINGS);
  assert.deepEqual(await billing.saveSettings(VENUE, { ...SETTINGS, iban: 'FI21 1234 5600 0007 85', vatPercent: 25.5, nextInvoiceNumber: null }), SETTINGS);
  assert.deepEqual(fake.log.rpc.at(-1), {
    name: 'krossi_billing_save_settings',
    args: { venue_id_input: VENUE, seller_name_input: 'Halli Oy', business_id_input: '0112038-9', address_input: null,
      iban_input: 'FI21 1234 5600 0007 85', bic_input: 'NDEAFIHH', email_input: 'laskutus@halli.fi', phone_input: null,
      vat_percent_input: 25.5, payment_terms_days_input: 14, next_invoice_number_input: null },
  });
  await assert.rejects(billing.saveSettings(VENUE, { ...SETTINGS, nextInvoiceNumber: 10.5 }), /seuraavan laskun numero/);
  assert.equal(fake.log.invoked.length, 0);
});

test('approve and decline e-mail the player through krossi-billing; a failing mail never fails the decision', async () => {
  const fake = fakeClient({
    rpc: () => ({ data: SLOT_ROW, error: null }),
    invoke: () => functionError('Sähköpostilähetintä ei ole vielä konfiguroitu.', 503),
  });
  setClientForTests(fake);
  const warn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args);
  try {
    assert.deepEqual(await seasons.approve(SLOT, { courtId: COURT }), SLOT_ROW);
    await seasons.decline(SLOT, 'Täynnä.');
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(fake.log.invoked, [
    { name: 'krossi-billing', body: { action: 'seasonDecided', slotId: SLOT } },
    { name: 'krossi-billing', body: { action: 'seasonDecided', slotId: SLOT } },
  ]);
  assert.equal(warned.length, 2);
  // a refused approval sends nothing
  const refused = fakeClient({ rpc: () => raised('Hakemus on jo käsitelty.') });
  setClientForTests(refused);
  await assert.rejects(seasons.approve(SLOT, {}), /jo käsitelty/);
  assert.deepEqual(refused.log.invoked, []);
});
