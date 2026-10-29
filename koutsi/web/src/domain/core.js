// core.js — Koutsi's domain helpers: dates, ISO weeks, weekly themes, schedules, lookups
// over the loaded state, attendance and monthly summaries, invite texts.
//
// Ported verbatim from the old app's lib/koutsi-data.js (b947036) so both apps compute the
// same weeks, themes and summaries from the same rows. test/core-parity.test.mjs runs the
// old file side by side with this module and fails if the two ever disagree. Keep the old
// names: they are what the coach-facing logic has been reviewed and fixed against.
//
// Pure: no Supabase, no DOM (koutsiRandomUuid needs Web Crypto, which browsers and Node have).

// ── deterministic display helpers (not persisted — purely cosmetic) ───────
function koutsiHueFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
function koutsiInitialOf(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }
function koutsiRandomUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── date + lookup helpers — pure, operate only on the assembled state ─────
function koutsiPad(n) { return String(n).padStart(2, '0'); }
function koutsiTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${koutsiPad(d.getMonth() + 1)}-${koutsiPad(d.getDate())}`;
}
const KOUTSI_WEEKDAYS = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
const KOUTSI_WEEKDAYS_LONG = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'];
const KOUTSI_MONTHS = ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu', 'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'];

function koutsiDateFromStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function koutsiFmtShortDate(dateStr) {
  const dt = koutsiDateFromStr(dateStr);
  return `${KOUTSI_WEEKDAYS[dt.getDay()]} ${dt.getDate()}.${dt.getMonth() + 1}.`;
}
function koutsiFmtLongDate(dateStr) {
  const dt = koutsiDateFromStr(dateStr);
  return `${KOUTSI_WEEKDAYS_LONG[dt.getDay()]} ${dt.getDate()}. ${KOUTSI_MONTHS[dt.getMonth()]}ta`;
}
// created_at is a full timestamptz — diary/mood entries only ever display the date part.
function koutsiFmtShortDateFromTimestamp(ts) { return koutsiFmtShortDate(ts.slice(0, 10)); }

// ── ISO weeks ────────────────────────────────────────────────
// Weekly themes are keyed by ISO week (Mon-first, the week a Finnish coach means when
// they say "vko 34"), not by a date range, so the same theme keeps showing all week and
// a term can be planned months ahead.
function koutsiIsoWeekOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;          // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);  // Thursday decides which year the week is in
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}
function koutsiCurrentIsoWeek() { return koutsiIsoWeekOf(new Date()); }
function koutsiIsoWeekOfDateStr(dateStr) { return koutsiIsoWeekOf(koutsiDateFromStr(dateStr)); }
// Monday of the given ISO week, as a local Date.
function koutsiIsoWeekStart(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayNum = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayNum + 1 + (week - 1) * 7);
  return new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
}
function koutsiWeeksInIsoYear(year) { return koutsiIsoWeekOf(new Date(year, 11, 28)).week; }
// n may be negative; rolls over the year boundary the way the calendar does.
function koutsiAddIsoWeeks({ year, week }, n) {
  const monday = koutsiIsoWeekStart(year, week);
  monday.setDate(monday.getDate() + n * 7);
  return koutsiIsoWeekOf(monday);
}
function koutsiIsoWeekKey({ year, week }) { return `${year}-${koutsiPad(week)}`; }
// "18.8.–24.8." — the dates make an abstract week number concrete on a coach's screen.
function koutsiIsoWeekRangeLabel(year, week) {
  const start = koutsiIsoWeekStart(year, week);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.getDate()}.${start.getMonth() + 1}.–${end.getDate()}.${end.getMonth() + 1}.`;
}
function koutsiCompareIsoWeeks(a, b) { return a.year - b.year || a.week - b.week; }

function koutsiStudentById(state, id) { return state.students.find((s) => s.id === id) || null; }
// allGroups (renewed app, seasons): a past or coming session's group may be out of this season's list
function koutsiGroupById(state, id) { return (state.allGroups || state.groups).find((g) => g.id === id) || null; }
function koutsiGroupsForStudent(state, studentId) { return state.groups.filter((g) => g.memberIds.includes(studentId)); }
// The theme of the week a given training falls in — not today's. A coach opening a
// session three weeks out must see the theme they planned for that week.
function koutsiThemeForDate(group, dateStr) {
  if (!group) return null;
  const w = koutsiIsoWeekOfDateStr(dateStr);
  return (group.themes || []).find((t) => t.year === w.year && t.week === w.week) || null;
}
// A week that has ended keeps its theme: it moves to `pastThemes` (newest first) and
// becomes the group's theme history instead of dropping out of every view.
function koutsiSplitThemes(themes, now = koutsiCurrentIsoWeek()) {
  const sorted = (themes || []).slice().sort(koutsiCompareIsoWeeks);
  return {
    themes: sorted,
    theme: sorted.find((t) => t.year === now.year && t.week === now.week) || null,
    upcomingThemes: sorted.filter((t) => koutsiCompareIsoWeeks(t, now) > 0),
    pastThemes: sorted.filter((t) => koutsiCompareIsoWeeks(t, now) < 0).reverse(),
  };
}
// "Syöttö / smash" typed for one group and "syöttö /  smash " for the next are one theme.
function koutsiThemeKey(title) {
  return (title || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fi');
}
function koutsiGroupThemeForWeek(group, week) {
  return (group.themes || []).find((t) => t.year === week.year && t.week === week.week) || null;
}
// One week across all groups, grouped by theme (biggest first), so the coach sees
// "Syöttö / smash — 8 ryhmää" instead of eight separate rows.
function koutsiThemeClusters(groups, week) {
  const byKey = new Map();
  koutsiSortGroupsBySchedule(groups).forEach((group) => {
    const theme = koutsiGroupThemeForWeek(group, week);
    if (!theme) return;
    const key = koutsiThemeKey(theme.title);
    if (!byKey.has(key)) byKey.set(key, { key, title: theme.title, lead: theme.lead || '', groups: [], themes: [] });
    const cluster = byKey.get(key);
    cluster.groups.push(group);
    cluster.themes.push(theme);
  });
  return [...byKey.values()].map((c) => ({ ...c, mixedLead: c.themes.some((t) => (t.lead || '') !== c.lead) }))
    .sort((a, b) => b.groups.length - a.groups.length || a.title.localeCompare(b.title, 'fi'));
}
// Weeks before `week` that have themes, newest first, each grouped like the planner's
// own week: the "what have we trained" list a coach picks an earlier theme from.
function koutsiThemeHistory(groups, week) {
  const weeks = new Map();
  (groups || []).forEach((g) => (g.themes || []).forEach((t) => {
    if (koutsiCompareIsoWeeks(t, week) < 0) weeks.set(koutsiIsoWeekKey(t), { year: t.year, week: t.week });
  }));
  return [...weeks.values()].sort((a, b) => koutsiCompareIsoWeeks(b, a))
    .map((w) => ({ ...w, clusters: koutsiThemeClusters(groups, w) }));
}
// Every theme the coach has written, once per title with its latest wording and lead,
// most recently used first — what the planner offers instead of retyping.
function koutsiThemeLibrary(groups) {
  const byKey = new Map();
  (groups || []).forEach((group) => (group.themes || []).forEach((t) => {
    const key = koutsiThemeKey(t.title);
    const hit = byKey.get(key);
    if (!hit) byKey.set(key, { key, title: t.title, lead: t.lead || '', year: t.year, week: t.week, uses: 1 });
    else {
      hit.uses += 1;
      if (koutsiCompareIsoWeeks(t, hit) > 0) Object.assign(hit, { title: t.title, lead: t.lead || '', year: t.year, week: t.week });
    }
  }));
  return [...byKey.values()].sort((a, b) => koutsiCompareIsoWeeks(b, a) || b.uses - a.uses);
}
// The group's own most recent theme within `maxBack` weeks before `week`, for
// "Jatka edellisillä teemoilla". Older than that is a different block of the season.
function koutsiLatestThemeBefore(group, week, maxBack = 4) {
  const floor = koutsiAddIsoWeeks(week, -maxBack);
  return (group.themes || [])
    .filter((t) => koutsiCompareIsoWeeks(t, week) < 0 && koutsiCompareIsoWeeks(t, floor) >= 0)
    .sort((a, b) => koutsiCompareIsoWeeks(b, a))[0] || null;
}
// A break in the group's calendar (a holiday week): sessions after `week` but none in it.
// Past the end of the generated calendar there is nothing to go on, so that is no break.
function koutsiGroupSkipsWeek(trainings, groupId, week) {
  let later = false;
  for (const t of trainings || []) {
    if (t.groupId !== groupId) continue;
    const c = koutsiCompareIsoWeeks(koutsiIsoWeekOfDateStr(t.date), week);
    if (c === 0) return false;
    if (c > 0) later = true;
  }
  return later;
}
// One week's theme coverage, shared by the week planner and the reminder card so the two
// can never disagree: which groups count (not on a break), which still lack a theme,
// which of those can carry on with their own previous theme, and the sessions still
// ahead for groups without one, soonest first. A session that has already started
// is not "ahead": a theme for it would come too late to matter.
function koutsiWeekThemeStatus(groups, trainings, week, now = new Date()) {
  const todayStr = `${now.getFullYear()}-${koutsiPad(now.getMonth() + 1)}-${koutsiPad(now.getDate())}`;
  const nowTime = `${koutsiPad(now.getHours())}:${koutsiPad(now.getMinutes())}`;
  const rows = koutsiSortGroupsBySchedule(groups).map((group) => ({
    group,
    theme: koutsiGroupThemeForWeek(group, week),
    skips: koutsiGroupSkipsWeek(trainings, group.id, week),
  }));
  const pool = rows.filter((r) => !r.skips);
  const missing = pool.filter((r) => !r.theme).map((r) => r.group);
  const missingIds = new Set(missing.map((g) => g.id));
  const carry = missing
    .map((group) => ({ group, from: koutsiLatestThemeBefore(group, week, 4) }))
    .filter((x) => x.from);
  const upcoming = (trainings || [])
    .filter((t) => missingIds.has(t.groupId)
      && (t.date > todayStr || (t.date === todayStr && (!t.time || t.time > nowTime)))
      && koutsiCompareIsoWeeks(koutsiIsoWeekOfDateStr(t.date), week) === 0)
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  return { rows, pool, covered: pool.length - missing.length, missing, carry, upcoming };
}
// Words that split a coach's groups into cohorts ("aikuiset", "juniorit"): found in at
// least two group names but not in all of them. Weekday names are covered by day chips.
const KOUTSI_GROUP_CHIP_STOPWORDS = new Set(['maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai', 'sunnuntai', 'ryhmä', 'klo']);
function koutsiGroupNameChips(groups, max = 4) {
  const idsByWord = new Map();
  (groups || []).forEach((g) => {
    const words = new Set((g.name || '').toLocaleLowerCase('fi').split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !KOUTSI_GROUP_CHIP_STOPWORDS.has(w)));
    words.forEach((w) => {
      if (!idsByWord.has(w)) idsByWord.set(w, []);
      idsByWord.get(w).push(g.id);
    });
  });
  return [...idsByWord.entries()]
    .filter(([, ids]) => ids.length >= 2 && ids.length < (groups || []).length)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'fi'))
    .slice(0, max)
    .map(([word, groupIds]) => ({ word, groupIds }));
}
function koutsiCoachById(state, id) { return state.coaches.find((c) => c.id === id) || null; }

function koutsiTrainingParty(state, training) {
  if (training.groupId != null) {
    const group = koutsiGroupById(state, training.groupId);
    const members = group ? group.memberIds.map((id) => koutsiStudentById(state, id)).filter(Boolean) : [];
    return { kind: 'group', group, members };
  }
  return { kind: 'student', student: koutsiStudentById(state, training.studentId) };
}
function koutsiTrainingsForStudent(state, studentId) {
  const groups = koutsiGroupsForStudent(state, studentId);
  const groupIds = groups.map((g) => g.id);
  return state.trainings
    .filter((t) => t.studentId === studentId || (t.groupId != null && groupIds.includes(t.groupId)))
    .slice()
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
function koutsiUpcomingTrainingsForStudent(state, studentId) {
  const today = koutsiTodayStr();
  return koutsiTrainingsForStudent(state, studentId).filter((t) => t.date >= today);
}
// A player's own logged tournaments — the only koutsi_trainings rows a match note's
// tournament_id is allowed to point at. Newest first, so the tournament a player is
// most likely mid-way through sits at the top of the picker in MatchNoteModal.
function koutsiTournamentsForStudent(state, studentId) {
  return koutsiTrainingsForStudent(state, studentId)
    .filter((t) => t.type === 'Turnaus' && t.loggedBy === 'player')
    .sort((a, b) => b.date.localeCompare(a.date));
}
// The tournament (if any) a given day falls inside, for defaulting MatchNoteModal's picker
// when a match is logged from within a tournament's date range.
function koutsiTournamentOnDateForStudent(state, studentId, dateStr) {
  return koutsiTournamentsForStudent(state, studentId)
    .find((t) => dateStr >= t.date && dateStr <= (t.endDate || t.date)) || null;
}
// A tournament entry has no name field of its own — a player types the tournament's name
// into its free-text `notes` (see SELF_TRAINING_NOTE_HINTS.Turnaus in koutsi-pelaaja-app.jsx),
// so that's the label wherever a tournament needs a one-line name; falls back to its date(s)
// for the (rare) tournament logged with no description.
function koutsiTournamentLabel(t) {
  if (!t) return '';
  if (t.notes && t.notes.trim()) return t.notes.trim();
  const range = t.endDate && t.endDate !== t.date ? `${koutsiFmtShortDate(t.date)}–${koutsiFmtShortDate(t.endDate)}` : koutsiFmtShortDate(t.date);
  return `Turnaus ${range}`;
}
function koutsiTrainingsForGroup(state, groupId) {
  return state.trainings.filter((t) => t.groupId === groupId).slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
function koutsiTrainingsOnDate(state, dateStr) {
  return state.trainings.filter((t) => t.date === dateStr).slice().sort((a, b) => a.time.localeCompare(b.time));
}
function koutsiTrainingsOnDateForStudent(state, dateStr, studentId) {
  const groupIds = koutsiGroupsForStudent(state, studentId).map((g) => g.id);
  return koutsiTrainingsOnDate(state, dateStr).filter((t) => t.studentId === studentId || (t.groupId != null && groupIds.includes(t.groupId)));
}
function koutsiClubEventsOnDate(state, dateStr) {
  return (state.clubEvents || []).filter((e) => e.date <= dateStr && (e.endDate || e.date) >= dateStr);
}
function koutsiUpcomingClubEvents(state) {
  const today = koutsiTodayStr();
  return (state.clubEvents || []).filter((e) => (e.endDate || e.date) >= today).slice().sort((a, b) => a.date.localeCompare(b.date));
}

const KOUTSI_LEVEL_COLORS = {
  aloitt: { bg: 'rgba(214,140,44,0.14)', fg: '#8a5a12', border: 'rgba(214,140,44,0.35)' },
  keski: { bg: 'rgba(58,130,212,0.12)', fg: '#2a5d94', border: 'rgba(58,130,212,0.32)' },
  edist: { bg: 'rgba(148,88,214,0.12)', fg: '#6a389c', border: 'rgba(148,88,214,0.32)' },
  kilpa: { bg: 'rgba(180,205,20,0.22)', fg: '#5c6b06', border: 'rgba(180,205,20,0.55)' },
};
function koutsiLevelColor(level) {
  const l = (level || '').toLowerCase();
  const key = Object.keys(KOUTSI_LEVEL_COLORS).find((k) => l.includes(k));
  return key ? KOUTSI_LEVEL_COLORS[key] : { bg: '#f4f2ec', fg: '#6b665c', border: '#d8d4ca' };
}

const KOUTSI_TAG_LABELS = { syotto: 'Syöttö', liikkuminen: 'Liikkuminen', pistepeli: 'Pistepeli', verkkopeli: 'Verkkopeli', tekniikka: 'Tekniikka', lammittely: 'Lämmittely', fysiikka: 'Fysiikka', drilli: 'Drilli' };
const KOUTSI_TAGS = ['syotto', 'liikkuminen', 'pistepeli', 'verkkopeli', 'tekniikka', 'lammittely', 'fysiikka', 'drilli'];
const KOUTSI_ABSENCE_REASON_LABELS = { poissa: 'Poissa' };
const KOUTSI_ATTENDANCE_STATUS_LABELS = { paikalla: 'Paikalla', ...KOUTSI_ABSENCE_REASON_LABELS };
function koutsiStudentAge(studentRow, profileRow) {
  const hasAccount = Boolean(profileRow);
  const value = hasAccount
    ? (profileRow.age || '')
    : (studentRow.age == null ? '' : String(studentRow.age));
  const exact = /^\d{1,3}$/.test(value) ? Number(value) : null;
  return {
    age: exact,
    ageRange: null,
    ageValue: exact == null ? '' : String(exact),
    ageLabel: exact == null ? '' : `${exact} v`,
  };
}

// ── trainings ────────────────────────────────────────────────
// A one-off session and a weekly series are the same rows; a series just shares a
// series_id, so "muokkaa/poista koko sarja" is a filter rather than a second table.
const KOUTSI_WEEKDAY_TO_INDEX = { su: 0, ma: 1, ti: 2, ke: 3, to: 4, pe: 5, la: 6 };
function koutsiAddDays(dateStr, days) {
  const d = koutsiDateFromStr(dateStr);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${koutsiPad(d.getMonth() + 1)}-${koutsiPad(d.getDate())}`;
}
// Weekly occurrences from `date` up to and including `untilDate` (capped so a mistyped
// end date can never write thousands of rows).
function koutsiWeeklyDates(date, untilDate, maxCount = 60) {
  const dates = [];
  let cur = date;
  while (cur <= untilDate && dates.length < maxCount) {
    dates.push(cur);
    cur = koutsiAddDays(cur, 7);
  }
  return dates;
}
// A coach picks day + time on a dial/keyboard that can land anywhere; the calendar (and
// the DB constraint backing it) only accepts quarter-hour marks, so every entry point
// rounds through this before it's stored.
function koutsiRoundTimeToQuarterHour(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const wrapped = (((Math.round((h * 60 + m) / 15) * 15) % 1440) + 1440) % 1440;
  return `${koutsiPad(Math.floor(wrapped / 60))}:${koutsiPad(wrapped % 60)}`;
}
// A coach can type any minute count into a duration field; the DB constraint (and the
// calendar's quarter-hour grid) only accepts 15-480 in steps of 15, so every entry point
// rounds through this before it's stored — same idea as koutsiRoundTimeToQuarterHour.
function koutsiRoundToQuarterHourMinutes(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return 60;
  const rounded = Math.round(n / 15) * 15;
  return Math.min(480, Math.max(15, rounded));
}
function koutsiAddMinutesToTime(hhmm, minutes) {
  if (!hhmm || !minutes) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const wrapped = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${koutsiPad(Math.floor(wrapped / 60))}:${koutsiPad(wrapped % 60)}`;
}
function koutsiFmtDuration(minutes) {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}
// "14:00" alone, or "14:00–15:30" once a duration is known.
function koutsiTimeRangeLabel(hhmm, minutes) {
  if (!hhmm) return '';
  return minutes ? `${hhmm}–${koutsiAddMinutesToTime(hhmm, minutes)}` : hhmm;
}
// First date on/after `fromDate` that falls on the group's weekday.
function koutsiNextWeekday(fromDate, dayCode) {
  const targetIdx = KOUTSI_WEEKDAY_TO_INDEX[(dayCode || '').toLowerCase()];
  if (targetIdx == null) return null;
  const diff = (targetIdx - koutsiDateFromStr(fromDate).getDay() + 7) % 7;
  return koutsiAddDays(fromDate, diff);
}
// A coach can have four groups all called "tiistai aikuiset": only the weekday, time and
// level tell them apart, so a screen that names one group on its own uses this.
function koutsiGroupScheduleLabel(group) {
  if (!group) return '';
  const when = group.day ? `${group.day} klo ${koutsiTimeRangeLabel(group.time, group.durationMinutes)}` : '';
  return [when, group.name, group.level].filter(Boolean).join(', ');
}
// The order a coaching week runs in: Monday first, then start time.
function koutsiSortGroupsBySchedule(groups) {
  const dayOrder = (g) => {
    const idx = KOUTSI_WEEKDAY_TO_INDEX[(g.day || '').toLowerCase()];
    return idx == null ? 7 : (idx + 6) % 7;
  };
  return (groups || []).slice().sort((a, b) => dayOrder(a) - dayOrder(b)
    || (a.time || '').localeCompare(b.time || '')
    || (a.name || '').localeCompare(b.name || '', 'fi'));
}
// How many weeks of sessions a group's weekly slot materializes by default, and the most
// a coach can ask for at once — creating a group (or an extra slot) floods the calendar
// with one row per week, so this stays well under a full year unless raised explicitly.
const KOUTSI_DEFAULT_GROUP_TRAINING_WEEKS = 12;
const KOUTSI_MAX_GROUP_TRAINING_WEEKS = 52;
function koutsiClampGroupTrainingWeeks(weeksAhead) {
  const value = Math.round(Number(weeksAhead));
  if (!Number.isFinite(value)) return KOUTSI_DEFAULT_GROUP_TRAINING_WEEKS;
  return Math.min(KOUTSI_MAX_GROUP_TRAINING_WEEKS, Math.max(1, value));
}

// ── weekly theme limits (same as koutsi_bulk_setup) ─────────
const KOUTSI_THEME_TITLE_MAX = 160;
const KOUTSI_THEME_LEAD_MAX = 1000;

// The link a coach actually sends. Prefilling the code is the difference between the
// player tapping once and the coach dictating six characters over the phone.
function koutsiInviteLink(code, studentId = null) {
  const params = new URLSearchParams({ koodi: code });
  if (studentId) params.set('oppilas', studentId);
  return `https://koutsi.krossi.app/pelaaja?${params.toString()}`;
}
function koutsiInviteMessage(code, coachName, groupName, studentId = null) {
  const who = coachName ? `${coachName} täällä` : 'Moi';
  const where = groupName ? ` ryhmään ${groupName}` : '';
  return `${who}! Otetaan Krossi Koutsi käyttöön — sieltä näet ryhmäsi viikon teeman ja treenit ja voit seurata omaa tenniskehitystäsi. Ikää ei tarvitse ilmoittaa, eikä Koutsiin kirjata terveystietoja.\n\nLiity${where} henkilökohtaisesta linkistä: ${koutsiInviteLink(code, studentId)}${studentId ? '' : `\n\n(Jos linkki ei aukea, mene osoitteeseen koutsi.krossi.app/pelaaja ja syötä koodi ${code}.)`}`;
}

// The week's theme as a message the coach pastes into the group's WhatsApp: the channel
// players already read, pointing them back to where the theme and its history live.
function koutsiThemeShareMessage(theme) {
  if (!theme) return '';
  const lead = (theme.lead || '').trim();
  return `Vko ${theme.week} teema: ${theme.title}${lead ? `\n${lead}` : ''}\n\nKatso Koutsista, mitä harjoitellaan ja mitä olemme jo käyneet läpi: https://koutsi.krossi.app/pelaaja`;
}

// ── club events ──────────────────────────────────────────────
// The calendar has always drawn these (orange dot, "Seuran tapahtuma" in the legend) but
// nothing could create one, so the legend advertised a feature that did not exist.
const KOUTSI_EVENT_KINDS = [
  { value: 'kilpailu', label: 'Kilpailu' },
  { value: 'leiri', label: 'Leiri' },
  { value: 'seura', label: 'Seuran tapahtuma' },
  { value: 'muu', label: 'Muu' },
];

// ── attendance summary ───────────────────────────────────────
// Pure: counts sessions the student was expected at (individual + their groups') against
// the absence rows already loaded in state. Only past sessions count, otherwise a season
// planned in advance would read as one long absence.
function koutsiAttendanceSummary(state, studentId, sinceDate) {
  const today = koutsiTodayStr();
  // Player-logged practice has no coach-run session to be present or absent from.
  const all = koutsiTrainingsForStudent(state, studentId)
    .filter((t) => t.loggedBy !== 'player' && t.date <= today && (!sinceDate || t.date >= sinceDate));
  let present = 0, absent = 0;
  const events = [];
  for (const t of all) {
    const entry = (t.absences || []).find((a) => a.studentId === studentId);
    if (!entry) { present += 1; continue; }
    absent += 1;
    events.push({ training: t, reason: 'poissa', note: '', reportedBy: entry.reportedBy || null, updatedAt: entry.updatedAt || null });
  }
  const total = all.length;
  return {
    studentId,
    total, present, absent, injured: 0,
    missed: absent,
    rate: total ? Math.round((present / total) * 100) : null,
    events: events.sort((a, b) => b.training.date.localeCompare(a.training.date)),
  };
}

// ── monthly summary (Strava-like overview for a player's own month) ──────────
// Past-only, like koutsiAttendanceSummary: a month still in progress should read as
// "what you've actually done", not inflated by sessions that have not happened yet.
// Buckets are drawn from fields that already exist on a training/match note — no new
// category column needed. Reused by the coach side to spot an inactive player (Osa 5).
const KOUTSI_MONTHLY_CATEGORIES = [
  { key: 'ryhmatreeni', label: 'Ryhmätreenit' },
  { key: 'valmennus', label: 'Muut valmennukset' },
  { key: 'omatoiminen', label: 'Omatoimiset harjoitukset' },
  { key: 'fysiikka', label: 'Fysiikka' },
  { key: 'muu', label: 'Muu liikunta' },
  { key: 'turnaus', label: 'Turnaukset' },
  { key: 'ottelu', label: 'Ottelut' },
];
function koutsiMonthlySummary(state, studentId, year, month) {
  const monthPrefix = `${year}-${koutsiPad(month + 1)}`;
  const today = koutsiTodayStr();
  const buckets = {};
  KOUTSI_MONTHLY_CATEGORIES.forEach((c) => { buckets[c.key] = { key: c.key, label: c.label, count: 0, minutes: 0 }; });

  const trainings = koutsiTrainingsForStudent(state, studentId)
    .filter((t) => t.date.startsWith(monthPrefix) && t.date <= today);
  for (const t of trainings) {
    const key = t.groupId != null ? 'ryhmatreeni'
      : t.loggedBy === 'player' ? (t.type === 'Fysiikka' ? 'fysiikka' : t.type === 'Muu liikunta' ? 'muu' : t.type === 'Turnaus' ? 'turnaus' : 'omatoiminen')
      : 'valmennus';
    buckets[key].count += 1;
    buckets[key].minutes += t.durationMinutes || 0;
  }

  const student = koutsiStudentById(state, studentId);
  const matches = (student?.matchNotes || []).filter((n) => n.date.startsWith(monthPrefix) && n.date <= today);
  buckets.ottelu.count = matches.length;
  buckets.ottelu.minutes = matches.reduce((sum, n) => sum + (n.durationMinutes || 0), 0);
  const wins = matches.filter((n) => n.result === 'voitto').length;
  const losses = matches.filter((n) => n.result === 'tappio').length;

  const categories = KOUTSI_MONTHLY_CATEGORIES.map((c) => buckets[c.key]);
  const totalSessions = trainings.length + matches.length;
  const totalMinutes = categories.reduce((sum, c) => sum + c.minutes, 0);
  return { categories, totalSessions, totalMinutes, matchWins: wins, matchLosses: losses };
}

// Splits a pasted list into names. Accepts one per line and also CSV/TSV rows, taking the
// first column — which is what actually comes out of a coach's spreadsheet.
function koutsiParseNameList(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.split(/[,;\t]/)[0].trim())
    .filter((n) => n && !/^(nimi|name|pelaaja)$/i.test(n))
    .slice(0, 200);
}

export {
  koutsiHueFromId,
  koutsiInitialOf,
  koutsiRandomUuid,
  koutsiPad,
  koutsiTodayStr,
  KOUTSI_WEEKDAYS,
  KOUTSI_WEEKDAYS_LONG,
  KOUTSI_MONTHS,
  koutsiDateFromStr,
  koutsiFmtShortDate,
  koutsiFmtLongDate,
  koutsiFmtShortDateFromTimestamp,
  koutsiIsoWeekOf,
  koutsiCurrentIsoWeek,
  koutsiIsoWeekOfDateStr,
  koutsiIsoWeekStart,
  koutsiWeeksInIsoYear,
  koutsiAddIsoWeeks,
  koutsiIsoWeekKey,
  koutsiIsoWeekRangeLabel,
  koutsiCompareIsoWeeks,
  koutsiStudentById,
  koutsiGroupById,
  koutsiGroupsForStudent,
  koutsiThemeForDate,
  koutsiSplitThemes,
  koutsiThemeKey,
  koutsiGroupThemeForWeek,
  koutsiThemeClusters,
  koutsiThemeHistory,
  koutsiThemeLibrary,
  koutsiLatestThemeBefore,
  koutsiGroupSkipsWeek,
  koutsiWeekThemeStatus,
  KOUTSI_GROUP_CHIP_STOPWORDS,
  koutsiGroupNameChips,
  koutsiCoachById,
  koutsiTrainingParty,
  koutsiTrainingsForStudent,
  koutsiUpcomingTrainingsForStudent,
  koutsiTournamentsForStudent,
  koutsiTournamentOnDateForStudent,
  koutsiTournamentLabel,
  koutsiTrainingsForGroup,
  koutsiTrainingsOnDate,
  koutsiTrainingsOnDateForStudent,
  koutsiClubEventsOnDate,
  koutsiUpcomingClubEvents,
  KOUTSI_LEVEL_COLORS,
  koutsiLevelColor,
  KOUTSI_TAG_LABELS,
  KOUTSI_TAGS,
  KOUTSI_ABSENCE_REASON_LABELS,
  KOUTSI_ATTENDANCE_STATUS_LABELS,
  koutsiStudentAge,
  KOUTSI_WEEKDAY_TO_INDEX,
  koutsiAddDays,
  koutsiWeeklyDates,
  koutsiRoundTimeToQuarterHour,
  koutsiRoundToQuarterHourMinutes,
  koutsiAddMinutesToTime,
  koutsiFmtDuration,
  koutsiTimeRangeLabel,
  koutsiNextWeekday,
  koutsiGroupScheduleLabel,
  koutsiSortGroupsBySchedule,
  KOUTSI_DEFAULT_GROUP_TRAINING_WEEKS,
  KOUTSI_MAX_GROUP_TRAINING_WEEKS,
  koutsiClampGroupTrainingWeeks,
  KOUTSI_THEME_TITLE_MAX,
  KOUTSI_THEME_LEAD_MAX,
  koutsiInviteLink,
  koutsiInviteMessage,
  koutsiThemeShareMessage,
  KOUTSI_EVENT_KINDS,
  koutsiAttendanceSummary,
  KOUTSI_MONTHLY_CATEGORIES,
  koutsiMonthlySummary,
  koutsiParseNameList,
};
