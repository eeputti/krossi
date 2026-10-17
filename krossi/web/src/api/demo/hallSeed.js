// hallSeed.js — the demo hall's phase-2 world: seasons, kausivuorot (a team's, Alex's own one
// charged from a card, Mikko's whose card keeps failing, two requests waiting for the hall),
// invoices (paid, overdue, open), series cards and gift cards with their history. Called by
// bookingSeed.js after the hall's standing blocks and Alex's bookings, before everybody else's
// bookings, so the season weeks are in the calendar and other people book around them.
//
// Everything is relative to `now`, like the rest of the demo seed. Names, prices and invoicing
// details are made up (the demo's neutral hall, not the real operator).

import { ME } from './rows.js';
import { addDays, isoWeekday, localDate } from '../../features/booking.js';
import {
  chargeSchedule, creditEventLabel, finnishHolidays, invoiceLines, newGiftCode, quoteSeason, referenceNumber, vatOf,
} from '../../features/seasons.js';

const pid = (key) => (key === 'me' ? ME : `p-${key}`);

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The holidays the demo hall keeps season play off: the weekday ones, not the weekend days it stays open on. */
const HALL_HOLIDAYS = new Set([
  'uudenvuodenpäivä', 'loppiainen', 'pitkäperjantai', '2. pääsiäispäivä', 'juhannusaatto', 'juhannuspäivä',
  'itsenäisyyspäivä', 'jouluaatto', 'joulupäivä', 'tapaninpäivä', 'uudenvuodenaatto',
]);
const holidays = (fromKey, toKey) => finnishHolidays(fromKey, toKey).filter((h) => HALL_HOLIDAYS.has(h.name)).map((h) => h.date);

function seasonName(startsOn, endsOn) {
  const [y1, m1] = startsOn.split('-').map(Number);
  const y2 = Number(endsOn.slice(0, 4));
  if (m1 >= 7) return `Talvikausi ${y1}–${y2}`;
  return y1 === y2 ? `Kesäkausi ${y1}` : `Kausi ${y1}–${y2}`;
}

/** The season running now (started seven weeks ago) and the summer season after it. */
function buildSeasons(venueId, today) {
  const monday = addDays(today, -(isoWeekday(localDate(today)) - 1));
  const winterStart = addDays(monday, -7 * 7);
  const winterEnd = addDays(monday, 7 * 28 + 6);
  const summerStart = addDays(winterEnd, 1);
  const summerEnd = addDays(summerStart, 7 * 17 - 1);
  return [
    {
      id: 'season-winter', venueId, name: seasonName(winterStart, winterEnd), startsOn: winterStart, endsOn: winterEnd,
      skipDates: holidays(winterStart, winterEnd), discountPercent: 15, requestsOpen: true,
    },
    {
      id: 'season-summer', venueId, name: seasonName(summerStart, summerEnd), startsOn: summerStart, endsOn: summerEnd,
      skipDates: holidays(summerStart, summerEnd), discountPercent: 20, requestsOpen: true,
    },
  ];
}

const PASS_PRODUCTS = [
  {
    id: 'pp-10', name: 'Tennis 10 × 1 h', sport: 'tennis', uses: 10, minutesPerUse: 60, validDays: 365, priceCents: 26000,
    description: 'Käy kaikkiin tennisvuoroihin, myös iltoihin ja viikonloppuun. Pidemmästä vuorosta kuluu enemmän.',
  },
  {
    id: 'pp-20', name: 'Tennis 20 × 1 h', sport: 'tennis', uses: 20, minutesPerUse: 60, validDays: 365, priceCents: 48000,
    description: 'Edullisin tuntihinta.',
  },
  // Sold in summer only: hidden from the shop now (Hallin asetukset shows it as piilotettu).
  {
    id: 'pp-kesa', name: 'Kesäkortti 10 × 1 h', sport: 'tennis', uses: 10, minutesPerUse: 60, validDays: 120, priceCents: 19000,
    description: 'Ulkokentille ja halliin kesäkaudella, voimassa neljä kuukautta.', active: false,
  },
];

/**
 * Adds the season weeks to `rows` (through `add`) and returns the phase-2 tables of db.booking.
 *   add(row)  bookingSeed's adder (gives ids and defaults)
 *   at(key, 'HH:MM') -> Date
 */
export function createHallSeed({ venue, rows, add, now, today, at }) {
  const rng = createRng(20261016);
  const seasons = buildSeasons(venue.id, today);
  const [winter] = seasons;
  const court = (location, mapId) => venue.locations[location].courts.find((c) => c.mapId === mapId);
  const daysAgo = (n, hhmm = '09:00') => at(addDays(today, -n), hhmm).toISOString();
  const live = () => rows.filter((r) => r.status === 'confirmed');

  const seasonSlots = [];
  const invoices = [];
  const charges = [];
  let invoiceNumber = 1001;
  let n = 0;

  const billing = {
    seller: {
      name: 'Lahden tennishallit (demo)', businessId: '1234567-1', address: 'Heinlammintie 64, 15800 Lahti',
      iban: 'FI2112345600000785', bic: 'NDEAFIHH', email: 'laskutus@example.fi', phone: '03 123 4567',
    },
    vatPercent: 14,
    paymentTermsDays: 14,
    gift: { amounts: [2500, 5000, 10000], minCents: 1000, maxCents: 30000, validDays: 365 },
    updatedAt: daysAgo(60, '14:20'),
  };

  function invoiceFor(slot, quote, { issuedOn, status, paidOn = null, sentAt = null }) {
    const number = String(invoiceNumber);
    invoiceNumber += 1;
    const found = venue.locations.flatMap((l) => l.courts.map((c) => ({ c, l }))).find((x) => x.c.id === slot.courtId);
    const lines = invoiceLines(slot, {
      weeks: quote.weeks.filter((w) => !w.conflict), fullCents: quote.fullCents, priceCents: slot.priceCents,
      discountPercent: winter.discountPercent, courtName: found?.c.name, locationName: found?.l.name,
    });
    const invoice = {
      id: `inv-${number}`, venueId: venue.id, seasonSlotId: slot.id, number, reference: referenceNumber(number),
      issuedOn, dueOn: addDays(issuedOn, billing.paymentTermsDays), amountCents: slot.priceCents, vatPercent: billing.vatPercent,
      vatCents: vatOf(slot.priceCents, billing.vatPercent), lines,
      recipient: { name: slot.holderName, email: slot.billingEmail, address: slot.billingAddress },
      seller: { ...billing.seller }, status, paidOn, sentAt, createdAt: `${issuedOn}T07:00:00.000Z`,
    };
    invoices.push(invoice);
    return invoice;
  }

  function chargesFor(slot, quote, { failing = false } = {}) {
    for (const { month, weeks, amountCents, dueOn } of chargeSchedule(quote.months, slot.decidedAt.slice(0, 10))) {
      const due = dueOn <= today;
      const failed = failing && due && dueOn.slice(0, 7) === today.slice(0, 7);
      charges.push({
        id: `ch-${slot.id}-${month}`, venueId: venue.id, seasonSlotId: slot.id, month, weeks, amountCents, dueOn,
        status: failed ? 'failed' : due ? 'paid' : 'scheduled',
        attempts: failed ? 2 : due ? 1 : 0,
        failureMessage: failed ? 'Pankki hylkäsi veloituksen. Kortti pitää päivittää tai kuukausi maksaa sovelluksessa.' : null,
        paidAt: due && !failed ? `${dueOn}T06:00:00.000Z` : null,
        paymentIntentId: null,
      });
    }
  }

  /**
   * A season slot as the hall approved it on `decidedDaysAgo`, its weeks from `fromDate` (taken
   * weeks are skipped, as approve(skipConflicts) does) added to the calendar.
   */
  function slot({
    key, holder = null, holderName, mapId, location, weekday, startTime, minutes, billingKind, billingEmail = null,
    billingAddress = null, decidedDaysAgo, fromDate = winter.startsOn, status = 'active', note = null,
  }) {
    n += 1;
    const c = court(location, mapId);
    const decidedAt = daysAgo(decidedDaysAgo);
    const quote = quoteSeason(venue, winter, live(), {
      courtId: c.id, weekday, startTime, minutes, fromDate, now: Date.parse(`${fromDate}T00:00:00`) - 1,
    });
    const conflicts = quote.weeks.filter((w) => w.conflict).map((w) => w.date);
    const booked = quote.weeks.filter((w) => !w.conflict);
    const row = {
      id: `ss-${key}`, venueId: venue.id, seasonId: winter.id, sport: c.sport, courtId: c.id, locationId: c.locationId,
      weekday, startTime, minutes, startsOn: booked[0]?.date || fromDate, endsOn: winter.endsOn,
      skipDates: [...quote.skipped, ...conflicts].sort(), status, billing: billingKind, priceCents: quote.cents,
      weeks: booked.length, holderId: holder ? pid(holder) : null, holderName, billingEmail, billingAddress, note,
      declineReason: null, createdAt: daysAgo(decidedDaysAgo + 2), decidedAt, notifiedAt: holder ? decidedAt : null,
    };
    seasonSlots.push(row);
    const weekCents = (w) => Math.round((w.cents * (100 - winter.discountPercent)) / 100);
    for (const w of booked) {
      add({
        courtId: c.id, startsAt: w.startsAt, endsAt: w.endsAt, kind: 'season', title: 'Kausivuoro',
        bookedBy: row.holderId, priceCents: weekCents(w), paymentStatus: 'none', seasonSlotId: row.id,
        createdAt: decidedAt,
      });
    }
    return { row, quote };
  }

  // Alex's own Wednesday hour, from the season's start, charged month by month.
  const alex = slot({
    key: 'alex', holder: 'me', holderName: 'Alex', mapId: 'te1', location: 0, weekday: 3, startTime: '19:00', minutes: 60,
    billingKind: 'card', billingEmail: 'demo@krossi.app', decidedDaysAgo: 52,
  });
  chargesFor(alex.row, alex.quote);

  // A club's Monday training: two hours at Kispi, invoiced and paid.
  const club = slot({
    key: 'seura', holderName: 'Esimerkkiseura ry · kilpaharjoitukset', mapId: 'te1', location: 1, weekday: 1,
    startTime: '17:00', minutes: 120, billingKind: 'invoice', billingEmail: 'rahastonhoitaja@example.fi',
    billingAddress: 'Esimerkkiseura ry, PL 12, 15101 Lahti', decidedDaysAgo: 55,
  });
  invoiceFor(club.row, club.quote, { issuedOn: addDays(today, -55), status: 'paid', paidOn: addDays(today, -46), sentAt: daysAgo(55, '10:00') });

  // Mikko's early Tuesday hour: his card keeps failing this month.
  const mikko = slot({
    key: 'mikko', holder: 'mikko', holderName: 'Mikko', mapId: 'te4', location: 0, weekday: 2, startTime: '07:00',
    minutes: 60, billingKind: 'card', billingEmail: 'mikko@example.fi', decidedDaysAgo: 40,
  });
  chargesFor(mikko.row, mikko.quote, { failing: true });

  // A company club on Fridays: invoiced, the invoice is overdue.
  const company = slot({
    key: 'yritys', holderName: 'Yritys Oy:n tenniskerho', mapId: 'te2', location: 0, weekday: 5, startTime: '16:00',
    minutes: 90, billingKind: 'invoice', billingEmail: 'kerho@yritys.example', billingAddress: 'Yritys Oy, Aleksanterinkatu 1, 15110 Lahti',
    decidedDaysAgo: 17, fromDate: addDays(today, -14),
  });
  invoiceFor(company.row, company.quote, { issuedOn: addDays(today, -17), status: 'open', sentAt: daysAgo(17, '10:00') });

  // Petra's Sunday morning, started mid-season: the invoice is open.
  const petra = slot({
    key: 'petra', holder: 'petra', holderName: 'Petra', mapId: 'te3', location: 1, weekday: 7, startTime: '10:00',
    minutes: 60, billingKind: 'invoice', billingEmail: 'petra@example.fi', decidedDaysAgo: 5, fromDate: addDays(today, 1),
  });
  invoiceFor(petra.row, petra.quote, { issuedOn: addDays(today, -5), status: 'open' });

  // Two requests waiting for the hall.
  const request = ({ key, holder, holderName, location, mapId = null, weekday, startTime, minutes, billingKind, note, daysAgoCreated, email }) => {
    const loc = venue.locations[location];
    const quote = quoteSeason(venue, winter, live(), {
      courtId: mapId ? court(location, mapId).id : null, locationId: loc.id, weekday, startTime, minutes, now,
    });
    seasonSlots.push({
      id: `ss-${key}`, venueId: venue.id, seasonId: winter.id, sport: 'tennis', courtId: mapId ? court(location, mapId).id : null,
      locationId: loc.id, weekday, startTime, minutes, startsOn: quote.weeks[0]?.date || today, endsOn: winter.endsOn,
      skipDates: quote.skipped, status: 'requested', billing: billingKind, priceCents: quote.cents, weeks: quote.count,
      holderId: pid(holder), holderName, billingEmail: email, billingAddress: null, note, declineReason: null,
      createdAt: daysAgo(daysAgoCreated, '20:15'), decidedAt: null, notifiedAt: null,
    });
  };
  request({
    key: 'laura', holder: 'laura', holderName: 'Laura', location: 0, weekday: 4, startTime: '20:00', minutes: 60, billingKind: 'card',
    note: 'Pelaisin torstai-iltaisin koko kauden. Mikä tahansa Janus-Areenan kenttä käy.', daysAgoCreated: 2, email: 'laura@example.fi',
  });
  request({
    key: 'juho', holder: 'juho', holderName: 'Juho', location: 1, mapId: 'te4', weekday: 6, startTime: '10:00', minutes: 90,
    billingKind: 'invoice', note: 'Junnujen vanhempien porukka, lasku minulle.', daysAgoCreated: 1, email: 'juho@example.fi',
  });

  // ── Cards on file ──
  const cards = new Map([
    [ME, { brand: 'visa', last4: '4242', expMonth: 8, expYear: new Date(now).getFullYear() + 2, fails: false }],
    [pid('mikko'), { brand: 'visa', last4: '0341', expMonth: 3, expYear: new Date(now).getFullYear() + 1, fails: true }],
    [pid('laura'), { brand: 'mastercard', last4: '4444', expMonth: 11, expYear: new Date(now).getFullYear() + 3, fails: false }],
  ]);

  // ── Series cards and gift cards ──
  const passProducts = PASS_PRODUCTS.map((p) => ({ ...p, venueId: venue.id, active: p.active !== false }));
  const passes = [];
  const giftCards = [];
  const creditEvents = [];
  let e = 0;
  const event = (row) => { e += 1; creditEvents.push({ id: `ce-seed-${e}`, venueId: venue.id, passId: null, giftCardId: null, bookingId: null, minutes: 0, cents: 0, ...row }); };
  const janus = venue.locations[0];
  const kispi = venue.locations[1];
  const label = (location, mapId, startsAt) => creditEventLabel({
    courtName: location.courts.find((c) => c.mapId === mapId).name, locationName: location.name, startsAt,
  });

  const pass = (key, owner, product, { boughtDaysAgo, usedMinutes }) => {
    const p = passProducts.find((x) => x.id === product);
    const purchasedAt = daysAgo(boughtDaysAgo, '12:00');
    const row = {
      id: `pass-${key}`, venueId: venue.id, productId: p.id, userId: pid(owner), name: p.name, sport: p.sport,
      minutesTotal: p.uses * p.minutesPerUse, minutesLeft: p.uses * p.minutesPerUse - usedMinutes,
      validUntil: addDays(addDays(today, -boughtDaysAgo), p.validDays), status: 'active', priceCents: p.priceCents,
      purchasedAt, createdAt: purchasedAt, paymentIntentId: null,
    };
    passes.push(row);
    event({ userId: row.userId, kind: 'purchase', passId: row.id, minutes: row.minutesTotal, label: `Ostettu: ${p.name}`, createdAt: purchasedAt });
    return row;
  };

  // Alex: a 10-hour card with two hours used — the second one is the booking two days ago.
  const alexPass = pass('alex', 'me', 'pp-10', { boughtDaysAgo: 40, usedMinutes: 120 });
  const oldUse = at(addDays(today, -30), '19:00').toISOString();
  event({ userId: ME, kind: 'use', passId: alexPass.id, minutes: -60, label: label(janus, 'te2', oldUse), createdAt: daysAgo(31, '18:20') });
  const twoDaysAgo = rows.find((r) => r.bookedBy === ME && r.kind === 'booking' && r.startsAt === at(addDays(today, -2), '19:00').toISOString());
  if (twoDaysAgo) {
    Object.assign(twoDaysAgo, { paymentStatus: 'credit', passId: alexPass.id, passMinutes: 60 });
    event({
      userId: ME, kind: 'use', passId: alexPass.id, minutes: -60, bookingId: twoDaysAgo.id,
      label: label(janus, 'te4', twoDaysAgo.startsAt), createdAt: daysAgo(4, '21:05'),
    });
  } else {
    event({ userId: ME, kind: 'use', passId: alexPass.id, minutes: -60, label: label(janus, 'te4', daysAgo(2, '19:00')), createdAt: daysAgo(4, '21:05') });
  }
  pass('mikko', 'mikko', 'pp-20', { boughtDaysAgo: 70, usedMinutes: 300 });
  pass('laura', 'laura', 'pp-10', { boughtDaysAgo: 340, usedMinutes: 480 });
  pass('teemu', 'teemu', 'pp-10', { boughtDaysAgo: 120, usedMinutes: 600 });

  const gift = (key, { buyer, amountCents, recipientName, message, boughtDaysAgo, redeemedBy = null, redeemedDaysAgo = null }) => {
    const paidAt = daysAgo(boughtDaysAgo, '15:30');
    const row = {
      id: `gc-${key}`, venueId: venue.id, code: newGiftCode(rng), amountCents, buyerId: pid(buyer), recipientName, message,
      status: redeemedBy ? 'redeemed' : 'active', validUntil: addDays(addDays(today, -boughtDaysAgo), billing.gift.validDays),
      paidAt, redeemedBy: redeemedBy ? pid(redeemedBy) : null, redeemedAt: redeemedBy ? daysAgo(redeemedDaysAgo, '19:40') : null,
      createdAt: paidAt, paymentIntentId: null,
    };
    giftCards.push(row);
    return row;
  };
  // A birthday present Alex got and has partly spent, one Alex gave away, one of Ville's.
  const fromSanna = gift('sanna', {
    buyer: 'sanna', amountCents: 5000, recipientName: 'Alex', message: 'Onnea! Nyt pelataan.', boughtDaysAgo: 24, redeemedBy: 'me', redeemedDaysAgo: 20,
  });
  event({ userId: ME, kind: 'redeem', giftCardId: fromSanna.id, cents: 5000, label: `Lahjakortti ${fromSanna.code}`, createdAt: fromSanna.redeemedAt });
  const giftUse = at(addDays(today, -12), '18:00').toISOString();
  event({ userId: ME, kind: 'use', cents: -3000, label: label(kispi, 'te2', giftUse), createdAt: daysAgo(13, '08:10') });
  gift('alex', {
    buyer: 'me', amountCents: 5000, recipientName: 'Sanna', message: 'Hyvää syntymäpäivää! Nähdään kentällä.', boughtDaysAgo: 6,
  });
  gift('ville', { buyer: 'ville', amountCents: 2500, recipientName: 'Aino', message: null, boughtDaysAgo: 3 });

  return {
    seasons,
    seasonSlots,
    invoices,
    charges,
    cards,
    billing: { [venue.id]: { ...billing, nextInvoiceNumber: invoiceNumber } },
    passProducts,
    passes,
    giftCards,
    creditEvents,
    topups: [],
  };
}
