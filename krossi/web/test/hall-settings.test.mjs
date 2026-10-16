// Hallin asetukset: the rules in features/seasons.js (Finnish holidays, Y-tunnus, IBAN, BIC and
// the checks the settings sheets and the demo share) and the demo backend's staff functions for
// seasons, series card products, gift cards and invoicing details, plus the decision e-mail mark.
// The SQL side (20261016120000_krossi_booking_hall_settings.sql) is tested against the same
// checks with PGlite (side-session notes, pglite-tests/test-settings.mjs).
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { configureTiming } from '../src/api/demo/runtime.js';
import { db, resetStore } from '../src/api/demo/store.js';
import { backend as api } from '../src/api/demo/index.js';
import { addDays, dateKey } from '../src/features/booking.js';
import {
  checkBillingSettings, checkGiftSettings, checkPassProduct, checkSeason, easterSunday, finnishHolidays, holidayName,
  normalizeBic, normalizeBusinessId, normalizeIban, seasonSkipDates,
} from '../src/features/seasons.js';

configureTiming({ latencyMin: 0, latencyMax: 0, autoScale: 0.001 });
beforeEach(() => resetStore());

const today = () => dateKey(new Date());
const venue = async () => (await api.booking.listVenues())[0];
const keys = (o) => Object.keys(o).sort();
const STAFF_SEASON_KEYS = ['id', 'venueId', 'name', 'startsOn', 'endsOn', 'skipDates', 'discountPercent', 'requestsOpen',
  'activeSlots', 'requests', 'bookedFrom', 'bookedUntil', 'removable'];
const PRODUCT_KEYS = ['id', 'venueId', 'name', 'sport', 'uses', 'minutesPerUse', 'validDays', 'priceCents', 'description',
  'active', 'sold', 'removable'];
const SETTINGS_KEYS = ['venueId', 'sellerName', 'businessId', 'address', 'iban', 'bic', 'email', 'phone', 'vatPercent',
  'paymentTermsDays', 'nextInvoiceNumber', 'lastInvoiceNumber', 'ready', 'updatedAt'];

/** Makes Alex (the demo user) a plain player of the demo hall. */
const notStaff = (v) => { db.booking.venues.find((x) => x.id === v.id).staffIds = []; };

// ── Rules ─────────────────────────────────────────────────────────────────────

test('Finnish holidays: Easter-based days, midsummer and All Saints on the right weekday', () => {
  assert.deepEqual([2024, 2025, 2026, 2027, 2028].map(easterSunday), ['2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28', '2028-04-16']);
  const winter = finnishHolidays('2026-08-31', '2027-05-02');
  assert.deepEqual(winter.map((h) => `${h.date} ${h.name}`), [
    '2026-10-31 pyhäinpäivä', '2026-12-06 itsenäisyyspäivä', '2026-12-24 jouluaatto', '2026-12-25 joulupäivä',
    '2026-12-26 tapaninpäivä', '2026-12-31 uudenvuodenaatto', '2027-01-01 uudenvuodenpäivä', '2027-01-06 loppiainen',
    '2027-03-26 pitkäperjantai', '2027-03-28 pääsiäispäivä', '2027-03-29 2. pääsiäispäivä', '2027-05-01 vappu',
  ]);
  const summer = finnishHolidays('2027-05-03', '2027-08-31').map((h) => `${h.date} ${h.name}`);
  assert.deepEqual(summer, ['2027-05-06 helatorstai', '2027-05-16 helluntaipäivä', '2027-06-25 juhannusaatto', '2027-06-26 juhannuspäivä']);
  assert.equal(holidayName('2026-12-06'), 'itsenäisyyspäivä');
  assert.equal(holidayName('2026-12-07'), null);
  assert.deepEqual(seasonSkipDates(['2027-01-06', '2026-12-24', '2026-12-24', '2027-06-01', '2026-02-30', 'x'], '2026-08-31', '2027-05-02'),
    ['2026-12-24', '2027-01-06']);
});

test('Y-tunnus, IBAN and BIC: check digits and the stored form', () => {
  assert.equal(normalizeBusinessId('0112038-9'), '0112038-9');
  assert.equal(normalizeBusinessId('01120389'), '0112038-9');
  assert.equal(normalizeBusinessId('FI01120389'), '0112038-9');
  assert.equal(normalizeBusinessId('112038-9'), '0112038-9');
  assert.equal(normalizeBusinessId('0112038-8'), null);
  assert.equal(normalizeBusinessId('1234567'), null);
  assert.equal(normalizeIban('fi21 1234 5600 0007 85'), 'FI2112345600000785');
  assert.equal(normalizeIban('FI2112345600000786'), null);
  assert.equal(normalizeIban('FI211234560000078'), null);
  assert.equal(normalizeIban('DE89 3704 0044 0532 0130 00'), 'DE89370400440532013000');
  assert.equal(normalizeBic('ndea fi hh'), 'NDEAFIHH');
  assert.equal(normalizeBic('NDEAFIHHXXX'), 'NDEAFIHHXXX');
  assert.equal(normalizeBic('NDEA'), null);
});

test('settings checks: the first problem in field order, values as they are saved', () => {
  const season = { name: ' Talvi ', startsOn: '2026-08-31', endsOn: '2027-05-02', skipDates: [], discountPercent: 15 };
  assert.deepEqual(checkSeason(season).value, { ...season, name: 'Talvi', requestsOpen: true });
  assert.deepEqual(checkSeason({ ...season, name: '', discountPercent: 99 }), { value: null, field: 'name', error: 'Anna kaudelle nimi.' });
  assert.equal(checkSeason({ ...season, endsOn: '2026-08-30' }).error, 'Kauden pitää päättyä alkamisen jälkeen.');
  assert.equal(checkSeason({ ...season, discountPercent: 12.5 }).field, 'discountPercent');
  assert.equal(checkSeason({ ...season, discountPercent: null }).field, 'discountPercent');
  assert.equal(checkSeason(season, { booked: { from: '2026-09-02', until: '2027-04-28' } }).error, null);
  assert.equal(checkSeason({ ...season, endsOn: '2027-04-27' }, { booked: { from: '2026-09-02', until: '2027-04-28' } }).error,
    'Kauden kausivuoroja pelataan 2.9.2026–28.4.2027, joten kausi ei voi alkaa myöhemmin eikä päättyä aiemmin.');
  assert.equal(checkSeason({ ...season, endsOn: '2025-01-01', startsOn: '2024-09-01' }, { today: '2026-10-16', isNew: true }).error,
    'Kausi on jo päättynyt. Tarkista päivät.');

  const product = { name: 'Tennis 10 × 1 h', sport: 'tennis', uses: 10, minutesPerUse: 60, validDays: 365, priceCents: 26000, description: ' ' };
  assert.deepEqual(checkPassProduct(product).value, { ...product, description: null, active: true });
  assert.equal(checkPassProduct({ ...product, minutesPerUse: 45 }).error, 'Kerran pituus on 30 min – 8 h puolen tunnin välein.');
  assert.equal(checkPassProduct({ ...product, sport: 'padel' }, { sports: ['tennis'] }).error, 'Hallissa ei ole tämän lajin kenttiä.');

  assert.deepEqual(checkGiftSettings({ amounts: [5000, 2500, 5000], minCents: 1000, maxCents: 30000, validDays: 365 }).value,
    { amounts: [2500, 5000], minCents: 1000, maxCents: 30000, validDays: 365 });
  assert.equal(checkGiftSettings({ amounts: [500], minCents: 1000, maxCents: 30000, validDays: 365 }).error,
    'Valmiiden summien pitää olla täysiä euroja välillä 10–300 €.');

  const billing = { sellerName: 'Halli', iban: 'FI21 1234 5600 0007 85', bic: 'nordfihh', vatPercent: 25.5, paymentTermsDays: 14, nextInvoiceNumber: null };
  assert.deepEqual(checkBillingSettings(billing).value, {
    sellerName: 'Halli', businessId: null, address: null, iban: 'FI2112345600000785', bic: 'NORDFIHH', email: null, phone: null,
    vatPercent: 25.5, paymentTermsDays: 14, nextInvoiceNumber: null,
  });
  assert.equal(checkBillingSettings({ ...billing, bic: 'DABASESX' }).error, 'Suomalaisen tilinumeron BIC-koodissa on FI (esim. NDEAFIHH).');
  assert.equal(checkBillingSettings({ ...billing, businessId: '1234567-2' }).field, 'businessId');
  assert.equal(checkBillingSettings({ ...billing, vatPercent: 1.1 }).error, null);
  assert.equal(checkBillingSettings({ ...billing, vatPercent: 14.25 }).field, 'vatPercent');
  assert.equal(checkBillingSettings({ ...billing, nextInvoiceNumber: 1005 }, { lastInvoiceNumber: 1005 }).error,
    'Seuraavan laskun numeron pitää olla suurempi kuin viimeisimmän laskun (1005).');
});

// ── Demo: seasons ─────────────────────────────────────────────────────────────

test('settings: the hall lists its seasons with slots and requests, adds and removes one', async () => {
  const v = await venue();
  const list = await api.seasons.staffSeasons(v.id);
  assert.equal(list.length, 2);
  for (const s of list) assert.deepEqual(keys(s), [...STAFF_SEASON_KEYS].sort());
  const [winter, summer] = list;
  assert.equal(winter.activeSlots, 5);
  assert.equal(winter.requests, 2);
  assert.equal(winter.removable, false);
  assert.ok(winter.bookedFrom >= winter.startsOn && winter.bookedUntil <= winter.endsOn);
  assert.deepEqual([summer.activeSlots, summer.requests, summer.bookedFrom, summer.removable], [0, 0, null, true]);

  const next = addDays(summer.endsOn, 1);
  const added = await api.seasons.saveSeason({
    id: null, venueId: v.id, name: ' Syyskausi ', startsOn: next, endsOn: addDays(next, 90), discountPercent: 10, requestsOpen: false,
    skipDates: finnishHolidays(next, addDays(next, 120)).map((h) => h.date),
  });
  assert.equal(added.name, 'Syyskausi');
  assert.ok(added.skipDates.every((d) => d >= added.startsOn && d <= added.endsOn));
  assert.equal(added.requestsOpen, false);
  // Players see it, but its requests are closed.
  assert.ok((await api.seasons.list(v.id)).some((s) => s.id === added.id));
  await assert.rejects(api.seasons.request({
    seasonId: added.id, locationId: v.locations[0].id, weekday: 2, startTime: '18:00', minutes: 60, billing: 'invoice',
  }), /haku on suljettu/);
  await api.seasons.removeSeason(added.id);
  assert.equal((await api.seasons.staffSeasons(v.id)).length, 2);
  await assert.rejects(api.seasons.removeSeason(winter.id), /ei voi poistaa/);
  await assert.rejects(api.seasons.saveSeason({ venueId: v.id, name: '', startsOn: next, endsOn: next, discountPercent: 0 }), /Anna kaudelle nimi/);
});

test('settings: the season dates must keep covering its active slots; changes leave the slots as they are', async () => {
  const v = await venue();
  const [winter] = await api.seasons.staffSeasons(v.id);
  const input = { ...winter, venueId: v.id };
  await assert.rejects(api.seasons.saveSeason({ ...input, endsOn: addDays(winter.bookedUntil, -1) }), /kausi ei voi alkaa myöhemmin eikä päättyä aiemmin/);
  await assert.rejects(api.seasons.saveSeason({ ...input, startsOn: addDays(winter.bookedFrom, 1) }), /kausi ei voi alkaa myöhemmin/);
  const mine = (await api.seasons.listMine())[0];
  const saved = await api.seasons.saveSeason({ ...input, endsOn: winter.bookedUntil, discountPercent: 30, skipDates: [...winter.skipDates, today()] });
  assert.equal(saved.endsOn, winter.bookedUntil);
  assert.equal(saved.discountPercent, 30);
  const after = (await api.seasons.listMine()).find((s) => s.id === mine.id);
  assert.deepEqual([after.priceCents, after.weeks, after.nextAt], [mine.priceCents, mine.weeks, mine.nextAt]);
  // New quotes use the new discount.
  const quote = await api.seasons.quote({ seasonId: winter.id, locationId: v.locations[0].id, weekday: 4, startTime: '20:00', minutes: 60 });
  assert.equal(quote.discountPercent, 30);
});

// ── Demo: the decision e-mail ─────────────────────────────────────────────────

test('approving or declining a request marks the player e-mailed; the hall\'s own slots are not', async () => {
  const v = await venue();
  const staff = await api.seasons.staffList(v.id);
  const laura = staff.find((s) => s.holderName === 'Laura');
  const juho = staff.find((s) => s.holderName === 'Juho');
  assert.equal(laura.notifiedAt, null);
  const { courtId } = await api.seasons.quote({ ...laura, locationId: laura.locationId, courtId: null });
  const approved = await api.seasons.approve(laura.id, { courtId, skipConflicts: true });
  assert.ok(approved.notifiedAt);
  await api.seasons.decline(juho.id, 'Lauantaiaamut ovat junioreiden.');
  const declined = (await api.seasons.staffList(v.id)).find((s) => s.id === juho.id);
  assert.ok(declined.notifiedAt);
  assert.equal(staff.find((s) => s.holderName.startsWith('Esimerkkiseura')).notifiedAt, null);
  assert.ok(staff.find((s) => s.holderName === 'Petra').notifiedAt);
});

// ── Demo: products and gift cards ─────────────────────────────────────────────

test('settings: series cards for sale and hidden ones; an unpaid order takes the new price', async () => {
  const v = await venue();
  const { passes, gift } = await api.wallet.staffProducts(v.id);
  assert.deepEqual(passes.map((p) => [p.name, p.active]), [['Tennis 10 × 1 h', true], ['Tennis 20 × 1 h', true], ['Kesäkortti 10 × 1 h', false]]);
  for (const p of passes) assert.deepEqual(keys(p), [...PRODUCT_KEYS].sort());
  assert.deepEqual(passes.map((p) => [p.sold, p.removable]), [[3, false], [1, false], [0, true]]);
  assert.deepEqual(gift, { amounts: [2500, 5000, 10000], minCents: 1000, maxCents: 30000, validDays: 365 });
  // Hidden ones aren't in the shop.
  assert.deepEqual((await api.wallet.products(v.id)).passes.map((p) => p.name), ['Tennis 10 × 1 h', 'Tennis 20 × 1 h']);

  const [p10] = passes;
  const pending = await api.wallet.buyPass(p10.id);
  const changed = await api.wallet.saveProduct({ ...p10, venueId: v.id, priceCents: 27500, description: 'Uusi hinta.' });
  assert.deepEqual([changed.priceCents, changed.description, changed.sold], [27500, 'Uusi hinta.', 3]);
  assert.deepEqual(await api.wallet.checkoutConfig({ kind: 'pass', id: pending.id }), { demo: true, amount: 27500, currency: 'eur' });

  const made = await api.wallet.saveProduct({
    id: null, venueId: v.id, name: 'Tennis 5 × 1,5 h', sport: 'tennis', uses: 5, minutesPerUse: 90, validDays: 180, priceCents: 19000,
    description: null, active: true,
  });
  assert.equal(made.removable, true);
  assert.ok((await api.wallet.products(v.id)).passes.some((p) => p.id === made.id));
  await api.wallet.removeProduct(made.id);
  await assert.rejects(api.wallet.removeProduct(p10.id), /Piilota se myynnistä/);
  await assert.rejects(api.wallet.saveProduct({ ...p10, venueId: v.id, sport: 'golf' }), /Valitse laji/);
});

test('settings: gift card amounts and limits; the shop and the purchase follow them', async () => {
  const v = await venue();
  const saved = await api.wallet.saveGiftSettings(v.id, { amounts: [4000, 2000], minCents: 2000, maxCents: 20000, validDays: 730 });
  assert.deepEqual(saved, { amounts: [2000, 4000], minCents: 2000, maxCents: 20000, validDays: 730 });
  assert.deepEqual((await api.wallet.products(v.id)).gift, saved);
  await assert.rejects(api.wallet.buyGiftCard({ venueId: v.id, amountCents: 1000 }), /20–200 €/);
  const card = await api.wallet.buyGiftCard({ venueId: v.id, amountCents: 4000 });
  await api.wallet.createPaymentIntent({ kind: 'gift', id: card.id });
  const issued = (await api.wallet.get(v.id)).giftCards.find((g) => g.id === card.id);
  assert.equal(issued.validUntil, addDays(today(), 730));
  await assert.rejects(api.wallet.saveGiftSettings(v.id, { amounts: [], minCents: 1000, maxCents: 30000, validDays: 365 }), /1–6 valmista/);
});

// ── Demo: invoicing details ───────────────────────────────────────────────────

test('settings: invoicing details are checked, saved normalized, and the next invoice uses them', async () => {
  const v = await venue();
  const before = await api.billing.getSettings(v.id);
  assert.deepEqual(keys(before), [...SETTINGS_KEYS].sort());
  assert.deepEqual([before.ready, before.lastInvoiceNumber, before.nextInvoiceNumber], [true, 1003, 1004]);
  await assert.rejects(api.billing.saveSettings(v.id, { ...before, businessId: '1234567-2' }), /Tarkista Y-tunnus/);
  await assert.rejects(api.billing.saveSettings(v.id, { ...before, iban: 'FI21 1234 5600 0007 86' }), /Tarkista tilinumero/);
  await assert.rejects(api.billing.saveSettings(v.id, { ...before, nextInvoiceNumber: 1003 }), /suurempi kuin viimeisimmän laskun \(1003\)/);
  const saved = await api.billing.saveSettings(v.id, {
    ...before, sellerName: ' Lahden tennishallit Oy ', businessId: 'FI01120389', iban: 'fi79 4405 2020 0360 82', bic: 'helsfihh',
    vatPercent: 25.5, paymentTermsDays: 7, nextInvoiceNumber: 2001,
  });
  assert.deepEqual([saved.sellerName, saved.businessId, saved.iban, saved.bic, saved.vatPercent, saved.nextInvoiceNumber, saved.ready],
    ['Lahden tennishallit Oy', '0112038-9', 'FI7944052020036082', 'HELSFIHH', 25.5, 2001, true]);
  assert.ok(saved.updatedAt);

  const juho = (await api.seasons.staffList(v.id)).find((s) => s.holderName === 'Juho');
  const slot = await api.seasons.approve(juho.id, { skipConflicts: true });
  const invoice = await api.billing.getInvoice(slot.invoice.id);
  assert.deepEqual([invoice.number, invoice.vatPercent, invoice.seller.name, invoice.seller.iban, invoice.dueOn],
    ['2001', 25.5, 'Lahden tennishallit Oy', 'FI7944052020036082', addDays(invoice.issuedOn, 7)]);
  // An earlier invoice keeps the details it was made with.
  const old = (await api.billing.listInvoices(v.id)).find((i) => i.number === '1001');
  assert.equal(old.seller.name, 'Lahden tennishallit (demo)');

  // Without an IBAN invoiced slots can't be approved; null keeps the invoice number.
  const cleared = await api.billing.saveSettings(v.id, { ...saved, iban: '', nextInvoiceNumber: null });
  assert.deepEqual([cleared.ready, cleared.iban, cleared.nextInvoiceNumber], [false, null, 2002]);
  const laura = (await api.seasons.staffList(v.id)).find((s) => s.holderName === 'Laura');
  await api.seasons.decline(laura.id, '');
  const club = await api.seasons.staffSeasons(v.id);
  await assert.rejects(api.seasons.create({
    venueId: v.id, seasonId: club[0].id, courtId: v.locations[0].courts[0].id, weekday: 2, startTime: '06:00', minutes: 60,
    holderName: 'Seura', skipConflicts: true,
  }), (err) => err.code === 'billing_settings');
});

test('settings: only the hall\'s staff may read or change anything', async () => {
  const v = await venue();
  notStaff(v);
  const [winter] = await api.seasons.list(v.id);
  for (const attempt of [
    api.seasons.staffSeasons(v.id), api.seasons.saveSeason({ ...winter, venueId: v.id }), api.seasons.removeSeason(winter.id),
    api.wallet.staffProducts(v.id), api.wallet.saveGiftSettings(v.id, { amounts: [2500], minCents: 1000, maxCents: 30000, validDays: 365 }),
    api.wallet.removeProduct('pp-kesa'), api.billing.getSettings(v.id), api.billing.saveSettings(v.id, { sellerName: 'X', vatPercent: 14, paymentTermsDays: 14 }),
  ]) {
    await assert.rejects(attempt, (err) => err.code === 'forbidden');
  }
});
