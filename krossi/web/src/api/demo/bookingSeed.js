// bookingSeed.js — the demo's court-booking world: the Lahti halls (Janus-Areena, Kispi-Areena)
// and the Kisapuisto outdoor courts, placeholder prices, and two weeks of other people's bookings
// so the calendar looks like a real Tuesday. Alex is on the hall's staff, so the demo can show
// the hall view too. The public demo uses a neutral venue name on purpose: the operator hasn't
// joined Krossi, and the prices here are made up.
//
// Same fixed-seed approach as seed.js: the layout is relative to `now`, so the demo always
// shows "tomorrow 18.00" instead of a date that went stale.

import { ME } from './rows.js';
import { addDays, dateKey, localDate, priceOf } from '../../features/booking.js';

const MIN = 60_000;
const SEED = 20261014;

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pid = (key) => (key === 'me' ? ME : `p-${key}`);
const BOOKERS = ['mikko', 'laura', 'ville', 'joonas', 'teemu', 'olli', 'sanna', 'riikka', 'antti', 'emilia', 'juho', 'petra', 'henna', 'aino'];

const court = (locationId, key, name, shortName, sport, surface, mapId) => ({
  id: `c-${locationId.replace('loc-', '')}-${key}`, locationId, name, shortName, sport, surface, mapId,
});

function buildVenue() {
  const janus = [
    ...[1, 2, 3, 4].map((n) => court('loc-janus', `te${n}`, `Tennis ${n}`, `Te${n}`, 'tennis', 'kova', `te${n}`)),
    court('loc-janus', 'padel', 'Padel', 'Padel', 'padel', 'tekonurmi', 'padel'),
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => court('loc-janus', `su${n}`, `Sulkapallo ${n}`, `Su${n}`, 'sulkapallo', 'matto', `sulka${n}`)),
  ];
  const kispi = [
    ...[1, 2, 3, 4].map((n) => court('loc-kispi', `te${n}`, `Tennis ${n}`, `Te${n}`, 'tennis', 'kova', `te${n}`)),
    ...[1, 2, 3, 4, 5].map((n) => court('loc-kispi', `su${n}`, `Sulkapallo ${n}`, `Su${n}`, 'sulkapallo', 'matto', `sulka${n}`)),
    court('loc-kispi', 'sq1', 'Squash 1', 'Sq1', 'squash', 'parketti', 'squash1'),
  ];
  const ulko = [1, 2, 3, 4, 5, 6].map((n) => court('loc-ulko', `k${n}`, `Kenttä ${n}`, `K${n}`, 'tennis', 'massa', `ulko${n}`));

  // Hall tennis prices name the indoor courts: a sport-wide rule would also open the outdoor courts
  // outside their own 8–21 hours.
  const indoorTennis = [...janus, ...kispi].filter((c) => c.sport === 'tennis').map((c) => c.id);
  const weekdays = [1, 2, 3, 4, 5];
  const weekend = [6, 7];
  const all = [1, 2, 3, 4, 5, 6, 7];
  // Price levels like the Lahti halls charge on Cintoia (autumn 2026): cheaper mornings and
  // daytime, evening peak, flat weekends. The demo also has a last-minute deal (below).
  // Highest priority first; a half hour no rule covers is closed.
  const prices = [
    { sports: ['padel'], courtIds: null, weekdays, from: '07:00', until: '16:00', centsPerHour: 2300 },
    { sports: ['padel'], courtIds: null, weekdays, from: '16:00', until: '22:00', centsPerHour: 3100 },
    { sports: ['padel'], courtIds: null, weekdays: weekend, from: '08:00', until: '21:00', centsPerHour: 3100 },
    { sports: ['squash'], courtIds: null, weekdays, from: '07:00', until: '09:00', centsPerHour: 1200 },
    { sports: ['squash'], courtIds: null, weekdays, from: '09:00', until: '16:00', centsPerHour: 1500 },
    { sports: ['squash'], courtIds: null, weekdays, from: '16:00', until: '22:00', centsPerHour: 2100 },
    { sports: ['squash'], courtIds: null, weekdays: weekend, from: '08:00', until: '21:00', centsPerHour: 1600 },
    { sports: ['sulkapallo'], courtIds: null, weekdays, from: '07:00', until: '09:00', centsPerHour: 1200 },
    { sports: ['sulkapallo'], courtIds: null, weekdays, from: '09:00', until: '16:00', centsPerHour: 1600 },
    { sports: ['sulkapallo'], courtIds: null, weekdays, from: '16:00', until: '22:00', centsPerHour: 2200 },
    { sports: ['sulkapallo'], courtIds: null, weekdays: weekend, from: '08:00', until: '21:00', centsPerHour: 1600 },
    { sports: null, courtIds: ulko.map((c) => c.id), weekdays: all, from: '08:00', until: '21:00', centsPerHour: 1600 },
    { sports: ['tennis'], courtIds: indoorTennis, weekdays, from: '06:00', until: '09:00', centsPerHour: 1800 },
    { sports: ['tennis'], courtIds: indoorTennis, weekdays, from: '09:00', until: '15:00', centsPerHour: 2300 },
    { sports: ['tennis'], courtIds: indoorTennis, weekdays, from: '15:00', until: '21:00', centsPerHour: 3000 },
    { sports: ['tennis'], courtIds: indoorTennis, weekdays, from: '21:00', until: '23:00', centsPerHour: 2300 },
    { sports: ['tennis'], courtIds: indoorTennis, weekdays: weekend, from: '08:00', until: '21:00', centsPerHour: 3000 },
  ];

  return {
    id: 'v-lahti',
    slug: 'lahden-tennis-ja-squash',
    name: 'Lahden tennishallit',
    city: 'Lahti',
    openFrom: '06:00',
    openUntil: '23:00',
    slotMinutes: 30,
    durations: [60, 90, 120],
    daysAhead: 14,
    cancelLimitHours: 24,
    holdMinutes: 10,
    payOnline: true,
    lastMinute: { hours: 4, percent: 30 }, // empty courts in the next four hours are 30 % off
    staffIds: [ME],
    locations: [
      { id: 'loc-janus', name: 'Janus-Areena', address: 'Heinlammintie 64, Lahti', indoor: true, mapKey: 'lahti-janus', lat: 61.0015881, lng: 25.6970796, courts: janus },
      { id: 'loc-kispi', name: 'Kispi-Areena', address: 'Kisapuisto, Lahti', indoor: true, mapKey: 'lahti-kispi', lat: 60.9891361, lng: 25.6520164, courts: kispi },
      { id: 'loc-ulko', name: 'Kisapuiston ulkokentät', address: 'Kisapuisto, Lahti', indoor: false, mapKey: 'lahti-kisapuisto', lat: 60.9879, lng: 25.6537, courts: ulko },
    ],
    prices,
  };
}

/** How full a court tends to be at hour `h` on ISO weekday `wd` (0…1). */
function demand(sport, indoor, wd, h) {
  if (!indoor) return h >= 16 && h < 20 ? 0.18 : 0.08; // October: the outdoor season is winding down
  const weekend = wd >= 6;
  let p;
  if (weekend) p = h >= 9 && h < 16 ? 0.55 : 0.3;
  else if (h >= 17 && h < 21) p = 0.82;
  else if (h >= 15) p = 0.6;
  else if (h < 9) p = 0.35;
  else p = 0.28;
  if (sport === 'sulkapallo') p *= 0.7;
  if (sport === 'squash') p *= 0.6;
  if (sport === 'padel') p = Math.min(0.9, p * 1.1);
  return p;
}

export function createBookingSeed(now) {
  const rng = createRng(SEED);
  const venue = buildVenue();
  const rows = [];
  let n = 0;
  const add = (row) => {
    n += 1;
    rows.push({
      id: `bk-${n}`, venueId: venue.id, kind: 'booking', status: 'confirmed', bookedBy: null, title: null,
      priceCents: 0, paymentStatus: 'paid', holdExpiresAt: null, createdAt: new Date(now - (2 + (n % 9)) * 86_400_000).toISOString(),
      cancelledAt: null, ...row,
    });
  };
  const today = dateKey(new Date(now));
  const at = (key, hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return localDate(key, h * 60 + (m || 0));
  };
  const taken = (courtId, startMs, endMs) => rows.some((r) => r.courtId === courtId && r.status !== 'cancelled'
    && Date.parse(r.startsAt) < endMs && Date.parse(r.endsAt) > startMs);

  // Standing blocks first: the hall's own use of its courts.
  for (let d = -7; d <= venue.daysAhead; d += 1) {
    const key = addDays(today, d);
    const wd = ((localDate(key).getDay() + 6) % 7) + 1;
    if (wd === 2 || wd === 4) {
      // Hallisarja on Tuesday and Thursday evenings at Kispi.
      for (const c of venue.locations[1].courts.filter((x) => x.sport === 'tennis')) {
        add({ courtId: c.id, startsAt: at(key, '18:00').toISOString(), endsAt: at(key, '21:00').toISOString(), kind: 'league', title: 'Hallisarja', paymentStatus: 'none' });
      }
    }
    if (wd <= 5) {
      const c = venue.locations[0].courts.find((x) => x.mapId === 'te3');
      add({ courtId: c.id, startsAt: at(key, '16:00').toISOString(), endsAt: at(key, '18:00').toISOString(), kind: 'block', title: 'Junioreiden valmennus', paymentStatus: 'none' });
    }
  }

  // Alex's own bookings: one tomorrow evening, one later this week, a few in the past.
  const mine = [
    { day: 1, time: '18:00', minutes: 90, loc: 0, mapId: 'te2' },
    { day: 4, time: '07:00', minutes: 60, loc: 1, mapId: 'te1' },
    { day: -2, time: '19:00', minutes: 60, loc: 0, mapId: 'te4' },
    { day: -6, time: '17:30', minutes: 90, loc: 0, mapId: 'te1' },
  ];
  for (const b of mine) {
    const key = addDays(today, b.day);
    const c = venue.locations[b.loc].courts.find((x) => x.mapId === b.mapId);
    const start = at(key, b.time);
    add({
      courtId: c.id, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + b.minutes * MIN).toISOString(),
      bookedBy: ME, priceCents: priceOf(venue, c, start.toISOString(), b.minutes) || 0,
    });
  }

  // Everybody else: walk every court hour by hour and book by demand.
  for (let d = -7; d <= venue.daysAhead; d += 1) {
    const key = addDays(today, d);
    const wd = ((localDate(key).getDay() + 6) % 7) + 1;
    const fade = d > 7 ? 0.55 : d > 3 ? 0.8 : 1; // further days are emptier
    for (const location of venue.locations) {
      for (const c of location.courts) {
        for (let h = 6; h < 23;) {
          const minutes = rng() < 0.3 ? 90 : 60;
          const start = at(key, `${h}:${rng() < 0.15 ? '30' : '00'}`);
          const startMs = start.getTime();
          const endMs = startMs + minutes * MIN;
          const cents = priceOf(venue, c, start.toISOString(), minutes);
          if (cents != null && !taken(c.id, startMs, endMs) && rng() < demand(c.sport, location.indoor, wd, h) * fade) {
            const who = BOOKERS[Math.floor(rng() * BOOKERS.length)];
            add({ courtId: c.id, startsAt: start.toISOString(), endsAt: new Date(endMs).toISOString(), bookedBy: pid(who), priceCents: cents });
            h += Math.ceil(minutes / 60);
          } else {
            h += 1;
          }
        }
      }
    }
  }

  return { venues: [venue], rows, watches: [] };
}
