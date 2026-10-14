// koutsi-usage-report.js — turns koutsi_admin_usage() into what Ylläpito → Käyttö shows.
//
// Pure functions, shared by both admin views: the renewed Koutsi imports them
// (koutsi/web/src/coach/AdminUsage.jsx) and the old one reads window.koutsiUsageReport
// (lib/koutsi-admin-usage.jsx). Tests: koutsi/web/test/usage.test.mjs.

// Paths as lib/koutsi-usage.js sends them (ids replaced by :id). Both apps share most
// addresses; anything unknown is shown as the path itself.
export const ROUTE_NAMES = {
  '/valmentaja': 'Avaus ja kirjautuminen',
  '/valmentaja/koti': 'Koti',
  '/valmentaja/viikko': 'Koti',
  '/valmentaja/teemat': 'Teemasuunnittelija',
  '/valmentaja/oppilaat': 'Oppilaat',
  '/valmentaja/pelaajat': 'Pelaajat',
  '/valmentaja/pelaaja/:id': 'Pelaajan sivu',
  '/valmentaja/kutsut': 'Kutsut',
  '/valmentaja/ryhmat': 'Ryhmät',
  '/valmentaja/ryhma/:id': 'Ryhmän sivu',
  '/valmentaja/treenit': 'Treenit',
  '/valmentaja/kalenteri': 'Kalenteri',
  '/valmentaja/treeni/:id': 'Treenin sivu',
  '/valmentaja/harjoitteet': 'Harjoitteet',
  '/valmentaja/harjoite/:id': 'Harjoitteen sivu',
  '/valmentaja/profiili': 'Profiili',
  '/valmentaja/yllapito': 'Ylläpito',
  '/pelaaja': 'Avaus ja kirjautuminen',
  '/pelaaja/koti': 'Koti',
  '/pelaaja/kehitys': 'Kehitys',
  '/pelaaja/treenit': 'Treenit',
  '/pelaaja/ryhma': 'Ryhmä',
  '/pelaaja/harjoitteet': 'Harjoitteet',
  '/pelaaja/profiili': 'Profiili',
};

export const TARGET_NAMES = {
  nappi: 'Nappi', linkki: 'Linkki', 'välilehti': 'Välilehti', valinta: 'Valinta', 'kenttä': 'Kenttä', kortti: 'Kortti',
};

export const ROLE_NAMES = { valmentaja: 'Valmentaja', pelaaja: 'Pelaaja' };
export const APP_NAMES = { vanha: 'vanha', uusi: 'uusi' };
export const DEVICE_NAMES = { puhelin: 'puhelin', tabletti: 'tabletti', kone: 'tietokone' };
export const WEEKDAYS = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];

export function routeName(path) {
  return ROUTE_NAMES[path] || path || '—';
}

/** What a tapped control is called in the lists: its text, or its kind when the text was held back. */
export function clickName(row) {
  if (row.label) return row.label;
  return `${TARGET_NAMES[row.target] || 'Kohde'} (teksti piilotettu)`;
}

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const HELSINKI = 'Europe/Helsinki';

/** "ke 14.10. klo 17.32" */
export function fmtWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('fi-FI', {
    timeZone: HELSINKI, weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** "17.32" */
export function fmtClock(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fi-FI', { timeZone: HELSINKI, hour: '2-digit', minute: '2-digit' });
}

const localDay = (date) => date.toLocaleDateString('sv-SE', { timeZone: HELSINKI }); // YYYY-MM-DD

/** One line of a session's timeline. */
export function eventText(ev) {
  if (ev.kind === 'view') return `${ev.label === 'paluu' ? 'Palasi sivulle' : 'Avasi'} ${routeName(ev.path)}`;
  if (ev.kind === 'click') return `Painoi: ${clickName(ev)}`;
  if (ev.kind === 'error') return `${ev.label || 'Virhe'}${ev.message ? `: ${ev.message}` : ''}`;
  if (ev.kind === 'hide') return 'Sulki sovelluksen tai siirtyi muualle';
  return ev.kind;
}

const sum = (rows, key) => rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);

/**
 * summarize(data, { role: 'all'|'valmentaja'|'pelaaja', app: 'all'|'vanha'|'uusi' }, now?)
 * → { totals, activeDays, days, heat, heatMax, devices, views, clicks, errors, sessions, testEvents }
 *   errors: [{ label, message, count, firstAt, lastAt, places: [{ app, role, path }] }]
 * Session counts can be summed across app and role: one session is always one of each.
 */
export function summarize(data, { role = 'all', app = 'all' } = {}, now = new Date()) {
  const keep = (r) => (role === 'all' || r.role === role) && (app === 'all' || r.app === app);
  const d = data || {};
  const groups = (d.groups || []).filter(keep);
  const totals = {
    sessions: sum(groups, 'sessions'), views: sum(groups, 'views'), clicks: sum(groups, 'clicks'), errors: sum(groups, 'errors'),
  };

  // every day of the period, also the quiet ones, so the bars read as a calendar
  const perDay = new Map();
  (d.days || []).filter(keep).forEach((r) => perDay.set(r.day, (perDay.get(r.day) || 0) + r.sessions));
  const days = [];
  const since = d.since ? new Date(d.since) : new Date(now.getTime() - 29 * 86400000);
  const today = localDay(now);
  for (let t = since.getTime(), guard = 0; guard < 400; t += 86400000, guard += 1) {
    const day = localDay(new Date(t));
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, sessions: perDay.get(day) || 0 });
    if (day === today) break;
  }

  const heat = WEEKDAYS.map(() => new Array(24).fill(0));
  (d.heat || []).filter(keep).forEach((r) => {
    if (r.dow >= 1 && r.dow <= 7 && r.hour >= 0 && r.hour < 24) heat[r.dow - 1][r.hour] += r.sessions;
  });

  const devices = { puhelin: 0, tabletti: 0, kone: 0 };
  (d.devices || []).filter(keep).forEach((r) => { if (r.device in devices) devices[r.device] += r.sessions; });

  const sessions = (d.sessions || []).filter(keep).map((s) => {
    const events = s.events || [];
    const start = events.length ? events[0].at : s.lastAt;
    const end = events.length ? events[events.length - 1].at : s.lastAt;
    return {
      ...s,
      start,
      end,
      seconds: Math.max(0, (new Date(end) - new Date(start)) / 1000),
      views: events.filter((e) => e.kind === 'view' && e.label !== 'paluu').length,
      clicks: events.filter((e) => e.kind === 'click').length,
      errors: events.filter((e) => e.kind === 'error').length,
    };
  });

  // the same error on several pages is one problem: one row, with the places it happened
  const errorMap = new Map();
  (d.errors || []).filter(keep).forEach((r) => {
    const key = `${r.label}\u0000${r.message || ''}`;
    const e = errorMap.get(key) || { label: r.label, message: r.message, count: 0, firstAt: r.firstAt, lastAt: r.lastAt, places: [] };
    e.count += r.count;
    if (r.firstAt < e.firstAt) e.firstAt = r.firstAt;
    if (r.lastAt > e.lastAt) e.lastAt = r.lastAt;
    if (!e.places.some((p) => p.app === r.app && p.role === r.role && p.path === r.path)) e.places.push({ app: r.app, role: r.role, path: r.path });
    errorMap.set(key, e);
  });

  return {
    totals,
    activeDays: days.filter((x) => x.sessions > 0).length,
    days,
    heat,
    heatMax: Math.max(0, ...heat.flat()),
    devices,
    views: (d.views || []).filter(keep).slice().sort((a, b) => b.views - a.views),
    clicks: (d.clicks || []).filter(keep).slice().sort((a, b) => b.clicks - a.clicks),
    errors: [...errorMap.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))),
    sessions,
    testEvents: d.testEvents || 0,
  };
}

/** Five steps of one hue for the weekday × hour grid; 0 stays empty. */
export function heatLevel(value, max) {
  if (!value || !max) return 0;
  return Math.min(5, Math.max(1, Math.ceil((value / max) * 5)));
}

if (typeof window !== 'undefined') {
  window.koutsiUsageReport = {
    ROUTE_NAMES, TARGET_NAMES, ROLE_NAMES, APP_NAMES, DEVICE_NAMES, WEEKDAYS,
    routeName, clickName, fmtDuration, fmtWhen, fmtClock, eventText, summarize, heatLevel,
  };
}
