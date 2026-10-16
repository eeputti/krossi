// priceTable.js — the hall's price rules as a table people can read: "Sisäkentät · Arki ·
// 6–9 18 €/h · 9–15 23 €/h …". Used by Hallin asetukset → Hinnat ja säännöt. Pure, so the
// grouping is tested in test/price-table.test.mjs.
import { LIVE_SPORTS, SPORTS, centsLabel, minutesOf } from '../../features/booking.js';

const WEEKDAY = ['', 'ma', 'ti', 'ke', 'to', 'pe', 'la', 'su']; // ISO 1–7

/** 'Arki' | 'La–su' | 'Joka päivä' | 'ma, ke, pe' */
export function weekdaysLabel(days) {
  const set = [...new Set(days)].sort((a, b) => a - b);
  const key = set.join('');
  if (key === '1234567') return 'Joka päivä';
  if (key === '12345') return 'Arki';
  if (key === '67') return 'La–su';
  // A run like 1–4: 'ma–to'
  const run = set.length > 2 && set.every((d, i) => i === 0 || d === set[i - 1] + 1);
  return run ? `${WEEKDAY[set[0]]}–${WEEKDAY[set[set.length - 1]]}` : set.map((d) => WEEKDAY[d]).join(', ');
}

/** '6–9' | '9.30–15' | '21–24' */
export function hoursLabel(from, until) {
  const fmt = (hhmm) => {
    const m = minutesOf(hhmm);
    return m % 60 ? `${Math.floor(m / 60)}.${String(m % 60).padStart(2, '0')}` : String(m / 60);
  };
  return `${fmt(from)}–${fmt(until)}`;
}

/** Which courts a rule covers, as a name: 'Sisäkentät', 'Ulkokentät', 'Janus-Areena', 'Kaikki tenniskentät'. */
function groupOf(venue, rule, sport) {
  const courts = [];
  for (const location of venue.locations || []) {
    for (const court of location.courts || []) {
      if (court.sport !== sport) continue;
      if (rule.courtIds && !rule.courtIds.includes(court.id)) continue;
      courts.push({ court, location });
    }
  }
  if (!courts.length) return null;
  const sportName = SPORTS.find((s) => s.value === sport)?.label.toLowerCase() || sport;
  if (!rule.courtIds) return { key: `${sport}:all`, label: `Kaikki ${sportName}kentät`, indoor: true };
  const locations = [...new Set(courts.map((c) => c.location))];
  const allIndoor = locations.every((l) => l.indoor);
  const allOutdoor = locations.every((l) => !l.indoor);
  const label = locations.length === 1 ? locations[0].name
    : allIndoor ? 'Sisäkentät' : allOutdoor ? 'Ulkokentät' : locations.map((l) => l.name).join(', ');
  return { key: `${sport}:${locations.map((l) => l.id).join(',')}`, label, places: locations.map((l) => l.name), indoor: allIndoor };
}

/**
 * [{ label, places, rows: [{ days, slots: [{ hours, price }] }] }] for the sports players can book
 * (LIVE_SPORTS), in the order the rules come (highest priority first) and time order within a row.
 */
export function priceTable(venue, sports = LIVE_SPORTS) {
  const groups = [];
  for (const rule of venue?.prices || []) {
    const ruleSports = rule.sports || SPORTS.map((s) => s.value);
    for (const sport of ruleSports) {
      if (!sports.includes(sport)) continue;
      const group = groupOf(venue, rule, sport);
      if (!group) continue;
      let g = groups.find((x) => x.key === group.key);
      if (!g) {
        g = { key: group.key, label: group.label, places: group.places || [], indoor: group.indoor, rows: [] };
        groups.push(g);
      }
      const days = weekdaysLabel(rule.weekdays);
      let row = g.rows.find((r) => r.days === days);
      if (!row) {
        row = { days, slots: [] };
        g.rows.push(row);
      }
      row.slots.push({ from: rule.from, hours: hoursLabel(rule.from, rule.until), price: `${centsLabel(rule.centsPerHour)}/h` });
    }
  }
  for (const g of groups) for (const r of g.rows) r.slots.sort((a, b) => minutesOf(a.from) - minutesOf(b.from));
  // Indoor courts first (that's what people book most), the order of the rules otherwise.
  const ordered = [...groups.filter((g) => g.indoor), ...groups.filter((g) => !g.indoor)];
  return ordered.map(({ key, indoor, ...rest }) => ({
    ...rest,
    rows: rest.rows.map((r) => ({ days: r.days, slots: r.slots.map(({ from, ...slot }) => slot) })),
  }));
}
