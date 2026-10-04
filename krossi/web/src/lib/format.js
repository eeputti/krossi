// format.js — Finnish date, time, name and number formatting. Pure functions (testable in Node).

export const WEEKDAYS_SHORT = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
export const WEEKDAYS = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'];
export const MONTHS = ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu', 'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'];

const pad = (n) => String(n).padStart(2, '0');
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Whole calendar days from `now` to `date` (0 = today, 1 = tomorrow, -1 = yesterday). */
export function dayDiff(date, now = new Date()) {
  return Math.round((startOfDay(new Date(date)) - startOfDay(now)) / 86_400_000);
}

/** 'klo 18.30' style time (Finnish uses a dot). */
export function formatTime(iso) {
  const d = new Date(iso);
  return `${d.getHours()}.${pad(d.getMinutes())}`;
}

/** '3.10.' */
export function formatDayMonth(iso) {
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

/** 'Tänään' | 'Huomenna' | 'Ylihuomenna' | 'Eilen' | 'pe 3.10.' */
export function dayLabel(iso, now = new Date()) {
  const diff = dayDiff(iso, now);
  if (diff === 0) return 'Tänään';
  if (diff === 1) return 'Huomenna';
  if (diff === 2) return 'Ylihuomenna';
  if (diff === -1) return 'Eilen';
  const d = new Date(iso);
  return `${WEEKDAYS_SHORT[d.getDay()]} ${formatDayMonth(iso)}`;
}

/** 'Huomenna klo 18.30' | 'pe 3.10. klo 18.30' | 'Aika sovitaan' when null. */
export function formatGameTime(iso, now = new Date()) {
  if (!iso) return 'Aika sovitaan';
  return `${dayLabel(iso, now)} klo ${formatTime(iso)}`;
}

/** Calendar-tile parts for a game card: { weekday: 'PE', day: '3', month: 'loka', time: '18.30' } */
export function dateTile(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return { weekday: WEEKDAYS_SHORT[d.getDay()].toUpperCase(), day: String(d.getDate()), month: MONTHS[d.getMonth()].slice(0, 4), time: formatTime(iso) };
}

/** 'pe 3.10.2026' */
export function formatDate(iso) {
  const d = new Date(iso);
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/** Chat/inbox relative time: 'nyt', '5 min', '2 t', 'eilen', 'ti', '3.10.' */
export function relativeShort(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 1) return 'nyt';
  if (mins < 60) return `${mins} min`;
  const diff = dayDiff(iso, new Date(now));
  if (diff === 0) return `${Math.floor(mins / 60)} t`;
  if (diff === -1) return 'eilen';
  if (diff > -7) return WEEKDAYS_SHORT[new Date(iso).getDay()];
  return formatDayMonth(iso);
}

/** Longer relative phrase: 'juuri nyt', '5 minuuttia sitten', '3 päivää sitten'… */
export function relativeLong(iso, now = Date.now()) {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'juuri nyt';
  if (mins < 60) return `${mins} min sitten`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} t sitten`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'eilen';
  if (d < 30) return `${d} päivää sitten`;
  return formatDate(iso);
}

/** Chat date separator: 'Tänään' | 'Eilen' | 'maanantai 29.9.' | '12.8.2025' */
export function chatDayLabel(iso, now = new Date()) {
  const diff = dayDiff(iso, now);
  if (diff === 0) return 'Tänään';
  if (diff === -1) return 'Eilen';
  const d = new Date(iso);
  if (diff > -7) return `${WEEKDAYS[d.getDay()]} ${formatDayMonth(iso)}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getDate()}.${d.getMonth() + 1}.`;
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/** First name for greetings and compact UI. */
export function firstName(name) {
  return String(name || 'Pelaaja').trim().split(/\s+/)[0];
}

/** Finnish plural: plural(3, 'peli', 'peliä') -> '3 peliä' */
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** 8,99 € / 15 € */
export function formatEuro(n) {
  if (n == null || n === '') return '';
  const num = Number(n);
  return `${Number.isInteger(num) ? num : num.toFixed(2).replace('.', ',')} €`;
}

/** Time-of-day greeting. */
export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5) return 'Hyvää yötä';
  if (h < 10) return 'Huomenta';
  if (h < 17) return 'Moi';
  if (h < 22) return 'Iltaa';
  return 'Hyvää yötä';
}

/** ISO string from a local date + 'HH:MM'. */
export function combineDateTime(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m || 0, 0, 0);
  return d.toISOString();
}

/** Value for <input type="datetime-local"> from an ISO string. */
export function toLocalInput(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
