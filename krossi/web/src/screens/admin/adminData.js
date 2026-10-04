// adminData.js — pure helpers for Ylläpito: stat groups, user search/sort/filter, labels.

const DAY = 24 * 60 * 60 * 1000;

const time = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Latest sign of life: a sign-in or an app open (sessions persist, so sign-ins alone undercount). */
export const lastSeenAt = (u) => Math.max(time(u.lastSignInAt), time(u.lastAppOpenAt));

/** Users seen (signed in or opened the app) within the last `days` days. */
export function countActive(users, days = 30, now = Date.now()) {
  const since = now - days * DAY;
  return (users || []).filter((u) => lastSeenAt(u) > since).length;
}

/**
 * Stat tiles grouped by topic (three per row on phones, so groups come in threes).
 * Keys follow krossi_admin_stats; the rest come from statValues() below.
 */
export const STAT_GROUPS = [
  {
    title: 'Pelaajat',
    items: [
      { key: 'new_players_7d', label: 'Uusia (7\u00a0pv)', icon: 'sparkles' },
      { key: 'new_players_30d', label: 'Uusia (30\u00a0pv)', icon: 'calendar' },
      { key: 'active1d', label: 'Aktiivisia (24\u00a0t)', icon: 'sun' },
      { key: 'active30d', label: 'Aktiivisia (30\u00a0pv)', icon: 'bolt' },
      { key: 'unpaid_players', label: 'Maksamattomia', icon: 'lock' },
      { key: 'hidden_players', label: 'Piilotettuja', icon: 'eye-off' },
    ],
  },
  {
    title: 'Pelit',
    items: [
      { key: 'challenges_total', label: 'Pelejä yhteensä', icon: 'ball' },
      { key: 'challenges_open', label: 'Avoimia', icon: 'calendar-plus' },
      { key: 'challenges_filled', label: 'Täynnä', icon: 'users' },
      { key: 'challenges_played', label: 'Pelattuja', icon: 'check-circle' },
      { key: 'played_share', label: 'Toteutui', icon: 'target', unit: '%' },
      { key: 'matches_recorded', label: 'Tuloksia kirjattu', icon: 'trophy' },
    ],
  },
  {
    title: 'Viestit ja ilmoitukset',
    items: [
      { key: 'conversations_total', label: 'Keskusteluja', icon: 'chat' },
      { key: 'messages_total', label: 'Viestejä', icon: 'send' },
      { key: 'reports_open', label: 'Ilmoituksia', icon: 'flag', alert: true },
    ],
  },
];

const num = (v) => (typeof v === 'number' ? v : null);

/** krossi_admin_stats + values derived from it and from the user list (null = not known yet). */
export function statValues(stats, users, now = Date.now()) {
  const s = stats || {};
  const total = num(s.total_players);
  const paid = num(s.paid_players);
  const games = num(s.challenges_total);
  const played = num(s.challenges_played);
  return {
    ...s,
    active1d: users ? countActive(users, 1, now) : null,
    active30d: users ? countActive(users, 30, now) : null,
    unpaid_players: total != null && paid != null ? Math.max(0, total - paid) : null,
    played_share: games && played != null ? Math.round((played / games) * 100) : games === 0 ? 0 : null,
  };
}

export const SORTS = [
  { value: 'joined', label: 'Liittynyt' },
  { value: 'signin', label: 'Kirjautunut' },
  { value: 'opens', label: 'Avauksia' },
];

export const FILTERS = [
  { value: 'paid', label: 'Maksaneet' },
  { value: 'unpaid', label: 'Maksamattomat' },
  { value: 'events', label: 'Tapahtuma-adminit' },
  { value: 'admins', label: 'Ylläpitäjät' },
  { value: 'hidden', label: 'Piilotetut' },
];

const FILTER_FNS = {
  paid: (u) => Boolean(u.paidAt),
  unpaid: (u) => !u.paidAt,
  events: (u) => u.adminCities.length > 0,
  admins: (u) => u.isAdmin,
  hidden: (u) => u.hiddenFromFeed,
};

const SORT_FNS = {
  joined: (a, b) => time(b.joinedAt) - time(a.joinedAt),
  signin: (a, b) => time(b.lastSignInAt) - time(a.lastSignInAt) || time(b.joinedAt) - time(a.joinedAt),
  opens: (a, b) => b.appOpenCount - a.appOpenCount || time(b.lastAppOpenAt) - time(a.lastAppOpenAt),
};

const norm = (s) => String(s || '').toLocaleLowerCase('fi-FI');

/** Search (name, email, city) + filter + sort. Returns a new array. */
export function selectUsers(users, { query = '', filter = '', sort = 'joined' } = {}) {
  const q = norm(query).trim();
  const words = q ? q.split(/\s+/) : [];
  const keep = FILTER_FNS[filter];
  return (users || [])
    .filter((u) => (keep ? keep(u) : true))
    .filter((u) => {
      if (!words.length) return true;
      const hay = `${norm(u.name)} ${norm(u.email)} ${norm(u.area)} ${norm(u.adminCities.join(' '))}`;
      return words.every((w) => hay.includes(w));
    })
    .sort(SORT_FNS[sort] || SORT_FNS.joined);
}

/** 3.10.2026 */
export function shortDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/** Relative for recent activity (handy when scanning for dormant accounts), a date once it's old. */
export function ago(iso, now = Date.now()) {
  const t = time(iso);
  if (!t) return 'ei koskaan';
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 1) return 'juuri äsken';
  if (mins < 60) return `${mins} min sitten`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} t sitten`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'eilen';
  if (days < 30) return `${days} pv sitten`;
  return shortDate(iso);
}

/** Thousands with a Finnish narrow space: 12 345 */
export const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString('fi-FI') : '–');

const AVATAR_TONES = ['blue', 'green', 'yellow', 'red'];
/** Stable avatar colour from the user id (admin rows carry no avatar data). */
export function toneFor(id) {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}
