// week.js — the coach's week: labels, the default planning week, today's agenda, calendars
// that are about to run out, player activity since the coach last looked, and unjoined players.
// Pure functions over the loaded state (see domain/core.js for the shared helpers).

import {
  koutsiCurrentIsoWeek, koutsiAddIsoWeeks, koutsiIsoWeekRangeLabel, koutsiIsoWeekStart, koutsiTodayStr,
  koutsiAddDays, koutsiAddMinutesToTime, koutsiPad, koutsiSortGroupsBySchedule, koutsiGroupById,
  koutsiStudentById, koutsiIsoWeekOfDateStr, koutsiCompareIsoWeeks,
} from './core.js';

export const DAY_NAMES = { Ma: 'Maanantai', Ti: 'Tiistai', Ke: 'Keskiviikko', To: 'Torstai', Pe: 'Perjantai', La: 'Lauantai', Su: 'Sunnuntai' };
export const DAY_ORDER = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
const WEEKDAY_SHORT = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];

/** Planning at the weekend is planning the coming week. */
export function plannerDefaultWeek(now = new Date()) {
  const week = koutsiCurrentIsoWeek();
  const day = now.getDay();
  return day === 6 || day === 0 ? koutsiAddIsoWeeks(week, 1) : week;
}

export const sameWeek = (a, b) => a.year === b.year && a.week === b.week;

/** "vko 48", or "vko 48/2025" when the week is in another year than this one. */
export function themeWeekShort(w, now = koutsiCurrentIsoWeek()) {
  return `vko ${w.week}${w.year !== now.year ? `/${w.year}` : ''}`;
}

/** "Tämä viikko" / "Ensi viikko" / "Viime viikko", or '' for any other week. */
export function themeWeekRelative(w, now = koutsiCurrentIsoWeek()) {
  return sameWeek(w, now) ? 'Tämä viikko'
    : sameWeek(w, koutsiAddIsoWeeks(now, 1)) ? 'Ensi viikko'
      : sameWeek(w, koutsiAddIsoWeeks(now, -1)) ? 'Viime viikko' : '';
}

export function themeWeekLabel(w, now = koutsiCurrentIsoWeek()) {
  const note = themeWeekRelative(w, now);
  return `${themeWeekShort(w, now)} · ${koutsiIsoWeekRangeLabel(w.year, w.week)}${note ? ` (${note.toLowerCase()})` : ''}`;
}

export function weekParam(w) { return `${w.year}-${koutsiPad(w.week)}`; }
export function parseWeekParam(value) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(value || ''));
  if (!m) return null;
  const week = { year: Number(m[1]), week: Number(m[2]) };
  return week.week >= 1 && week.week <= 53 ? week : null;
}

/** The seven dates (YYYY-MM-DD) of an ISO week, Monday first. */
export function weekDates(w) {
  const monday = koutsiIsoWeekStart(w.year, w.week);
  const first = `${monday.getFullYear()}-${koutsiPad(monday.getMonth() + 1)}-${koutsiPad(monday.getDate())}`;
  return Array.from({ length: 7 }, (_, i) => koutsiAddDays(first, i));
}

/** "ti 14.10." */
export function shortDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${WEEKDAY_SHORT[dt.getDay()]} ${d}.${m}.`;
}

/** "Tänään" / "Huomenna" / "Eilen" / "ti 14.10." */
export function relativeDay(dateStr, today = koutsiTodayStr()) {
  if (dateStr === today) return 'Tänään';
  if (dateStr === koutsiAddDays(today, 1)) return 'Huomenna';
  if (dateStr === koutsiAddDays(today, -1)) return 'Eilen';
  return shortDay(dateStr);
}

export function sessionEnd(training, group) {
  const minutes = training.durationMinutes || group?.durationMinutes || 60;
  return koutsiAddMinutesToTime(training.time || '00:00', minutes);
}

const nowHHMM = (now) => `${koutsiPad(now.getHours())}:${koutsiPad(now.getMinutes())}`;

/** A coach-run session (not a player's own log) that is going on right now or later today. */
export function sessionStatus(training, group, now = new Date()) {
  const today = koutsiTodayStr();
  if (training.date < today) return 'past';
  if (training.date > today) return 'upcoming';
  const t = nowHHMM(now);
  if (t < (training.time || '00:00')) return 'upcoming';
  if (t < sessionEnd(training, group)) return 'now';
  return 'past';
}

/** Coach-run sessions on a date, by time, each with its group. */
export function coachSessionsOn(state, dateStr) {
  return state.trainings
    .filter((t) => t.date === dateStr && t.loggedBy !== 'player')
    .slice()
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    .map((t) => ({ training: t, group: t.groupId ? koutsiGroupById(state, t.groupId) : null, student: t.studentId ? koutsiStudentById(state, t.studentId) : null }));
}

/** Who is expected at a session: the group's members, or the one student. */
export function sessionRoster(state, training) {
  if (training.groupId) {
    const group = koutsiGroupById(state, training.groupId);
    return (group?.memberIds || []).map((id) => koutsiStudentById(state, id)).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  }
  const s = training.studentId ? koutsiStudentById(state, training.studentId) : null;
  return s ? [s] : [];
}

/**
 * Groups whose generated calendar ends within `withinDays` (or has already ended while the
 * group still exists): the coach must extend it before the sessions — and with them the
 * weekly theme reminder and the players' calendars — quietly disappear.
 */
export function calendarEndings(state, withinDays = 42, today = koutsiTodayStr()) {
  const limit = koutsiAddDays(today, withinDays);
  return koutsiSortGroupsBySchedule(state.groups).map((group) => {
    const dates = state.trainings.filter((t) => t.groupId === group.id && t.loggedBy !== 'player').map((t) => t.date).sort();
    const last = dates[dates.length - 1] || null;
    return { group, last, upcoming: dates.filter((d) => d >= today).length };
  }).filter((x) => !x.last || x.last <= limit)
    .sort((a, b) => String(a.last || '').localeCompare(String(b.last || '')));
}

/**
 * What players did lately that a coach would want to see: their own practice logs, moods
 * they didn't hide, wishes and notes, match notes, finished homework. Newest first.
 */
export function playerActivity(state, sinceDays = 14, today = koutsiTodayStr()) {
  const since = koutsiAddDays(today, -sinceDays);
  const items = [];
  const day = (at) => String(at || '').slice(0, 10);
  for (const s of state.students) {
    for (const m of s.moods || []) if (day(m.at) >= since) items.push({ kind: 'mood', at: m.at, student: s, mood: m });
    for (const h of s.wishHistory || []) if (day(h.at) >= since && h.value) items.push({ kind: 'wish', at: h.at, student: s, text: h.value });
    for (const h of s.noteHistory || []) if (day(h.at) >= since && h.value) items.push({ kind: 'note', at: h.at, student: s, text: h.value });
    for (const n of s.matchNotes || []) if ((n.date || day(n.at)) >= since) items.push({ kind: 'match', at: n.at || n.date, student: s, match: n });
    for (const h of s.homework || []) if (h.done && h.doneAt && day(h.doneAt) >= since) items.push({ kind: 'homework', at: h.doneAt, student: s, text: h.text });
  }
  for (const t of state.trainings) {
    if (t.loggedBy !== 'player' || t.date < since) continue;
    const s = koutsiStudentById(state, t.studentId);
    if (s) items.push({ kind: 'self', at: `${t.date}T${t.time || '12:00'}`, student: s, training: t });
  }
  return items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Players the coach added by name who have not joined yet, by name. */
export function unjoinedPlayers(state) {
  return state.students.filter((s) => s.isPlaceholder).sort((a, b) => a.name.localeCompare(b.name, 'fi'));
}

/** Groups a student belongs to, in schedule order. */
export function groupsOf(state, studentId) {
  return koutsiSortGroupsBySchedule(state.groups.filter((g) => g.memberIds.includes(studentId)));
}

/** Days since the player's latest own activity, or null if none. */
export function lastActivityDays(state, student, today = koutsiTodayStr()) {
  const stamps = [
    ...(student.moods || []).map((m) => m.at), ...(student.matchNotes || []).map((n) => n.at || n.date),
    ...(student.goalHistory || []).map((h) => h.at), ...(student.wishHistory || []).map((h) => h.at),
    ...(student.noteHistory || []).map((h) => h.at), ...(student.homework || []).filter((h) => h.doneAt).map((h) => h.doneAt),
    ...state.trainings.filter((t) => t.loggedBy === 'player' && t.studentId === student.id).map((t) => t.date),
  ].filter(Boolean).map((s) => String(s).slice(0, 10)).sort();
  const last = stamps[stamps.length - 1];
  if (!last) return null;
  const ms = new Date(`${today}T12:00:00`) - new Date(`${last}T12:00:00`);
  return Math.max(0, Math.round(ms / 86400000));
}

/** The ISO week a date falls in is the current one. */
export function inCurrentWeek(dateStr) {
  return koutsiCompareIsoWeeks(koutsiIsoWeekOfDateStr(dateStr), koutsiCurrentIsoWeek()) === 0;
}
