// week.js — the coach's week: labels, the default planning week, today's agenda, calendars
// that are about to run out, player activity since the coach last looked, unjoined players,
// today's timeline and the Ryhmät page's week board.
// Pure functions over the loaded state (see domain/core.js for the shared helpers).

import {
  koutsiCurrentIsoWeek, koutsiAddIsoWeeks, koutsiIsoWeekRangeLabel, koutsiIsoWeekStart, koutsiTodayStr,
  koutsiAddDays, koutsiAddMinutesToTime, koutsiPad, koutsiSortGroupsBySchedule, koutsiGroupById,
  koutsiStudentById, koutsiIsoWeekOfDateStr, koutsiCompareIsoWeeks, KOUTSI_WEEKDAY_TO_INDEX,
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

/** "12.–18.10.2026", or "28.9.–4.10.2026" across a month: Viikkohallinta's and the planner's week head. */
export function weekRangeLabel(w) {
  const dates = weekDates(w);
  const [a, b] = [dates[0], dates[6]];
  const dm = (d) => `${Number(d.slice(8))}.${Number(d.slice(5, 7))}.`;
  return a.slice(5, 7) === b.slice(5, 7) ? `${Number(a.slice(8))}.–${dm(b)}${b.slice(0, 4)}` : `${dm(a)}–${dm(b)}${b.slice(0, 4)}`;
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
 * What players did lately that a coach would want to see: their own practice logs, Kehitys
 * entries ("Oma merkintä"), moods they didn't hide, wishes and notes, match notes, finished
 * homework. Newest first.
 */
export function playerActivity(state, sinceDays = 14, today = koutsiTodayStr()) {
  const since = koutsiAddDays(today, -sinceDays);
  const items = [];
  const day = (at) => String(at || '').slice(0, 10);
  for (const s of state.students) {
    for (const m of s.moods || []) if (day(m.at) >= since) items.push({ kind: 'mood', at: m.at, student: s, mood: m });
    for (const h of s.wishHistory || []) if (day(h.at) >= since && h.value) items.push({ kind: 'wish', at: h.at, student: s, text: h.value });
    for (const h of s.noteHistory || []) if (day(h.at) >= since && h.value) items.push({ kind: 'note', at: h.at, student: s, text: h.value });
    for (const e of s.entries || []) if ((e.date || day(e.at)) >= since && e.text) items.push({ kind: 'entry', at: e.at, student: s, text: e.text, how: e.how || '' });
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
    ...(student.entries || []).map((e) => e.at || e.date),
    ...state.trainings.filter((t) => t.loggedBy === 'player' && t.studentId === student.id).map((t) => t.date),
  ].filter(Boolean).map((s) => String(s).slice(0, 10)).sort();
  const last = stamps[stamps.length - 1];
  if (!last) return null;
  const ms = new Date(`${today}T12:00:00`) - new Date(`${last}T12:00:00`);
  return Math.max(0, Math.round(ms / 86400000));
}

// A session's start as a local Date (built from numbers: Safari 14 reads "…T17:00" as UTC).
function startOf(training) {
  const [y, m, d] = training.date.split('-').map(Number);
  const [h, min] = String(training.time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, h || 0, min || 0);
}

const HOUR_MS = 3600000;
export const PLAYER_SECTIONS_PAST_HOURS = 24;
export const PLAYER_SECTIONS_AHEAD_DAYS = 7;

/**
 * Pelaajat, the most current players first. The coach-run sessions from the last 24 hours
 * (counted from their end) to a week ahead, nearest to now first: the one going on, then by
 * how long ago it ended or how soon it starts. Under each, the players not already listed under
 * a nearer one, by name — whether they were (or will be) away, and their next session after it.
 * `rest`: everyone in none of those sessions, by name, with their next session (if any).
 *   → { sections: [{ training, group, student, status, end, minutesAgo, minutesUntil, players: [{ student, absent, next }] }],
 *       rest: [{ student, next }] }
 */
export function playerSections(state, now = new Date()) {
  const sessions = state.trainings
    .filter((t) => t.loggedBy !== 'player' && t.date)
    .map((training) => {
      const group = training.groupId ? koutsiGroupById(state, training.groupId) : null;
      const start = startOf(training);
      const stop = new Date(start.getTime() + (training.durationMinutes || group?.durationMinutes || 60) * 60000);
      const ids = group ? group.memberIds : training.studentId ? [training.studentId] : [];
      return { training, group, start, stop, ids };
    })
    .sort((a, b) => a.start - b.start);
  const nextAfter = (studentId, after) => sessions.find((s) => s.start > after && s.ids.includes(studentId))?.training || null;
  const from = now.getTime() - PLAYER_SECTIONS_PAST_HOURS * HOUR_MS;
  const until = now.getTime() + PLAYER_SECTIONS_AHEAD_DAYS * 24 * HOUR_MS;
  const distance = (s) => (s.stop <= now ? now - s.stop : s.start > now ? s.start - now : 0);
  const near = sessions.filter((s) => s.stop.getTime() > from && s.start.getTime() <= until)
    .sort((a, b) => distance(a) - distance(b) || a.start - b.start);
  const byName = (a, b) => a.name.localeCompare(b.name, 'fi');
  const placed = new Set();
  const sections = [];
  for (const s of near) {
    const players = s.ids.filter((id) => !placed.has(id)).map((id) => koutsiStudentById(state, id)).filter(Boolean).sort(byName);
    if (!players.length) continue;
    players.forEach((p) => placed.add(p.id));
    const status = s.stop <= now ? 'past' : s.start <= now ? 'now' : 'upcoming';
    const absent = new Set((s.training.absences || []).map((a) => a.studentId));
    sections.push({
      training: s.training,
      group: s.group,
      student: s.training.studentId ? koutsiStudentById(state, s.training.studentId) : null,
      status,
      end: sessionEnd(s.training, s.group),
      minutesAgo: status === 'past' ? Math.round((now - s.stop) / 60000) : null,
      minutesUntil: status === 'upcoming' ? Math.round((s.start - now) / 60000) : null,
      players: players.map((student) => ({ student, absent: absent.has(student.id), next: nextAfter(student.id, s.start) })),
    });
  }
  const rest = state.students.filter((s) => !placed.has(s.id)).sort(byName)
    .map((student) => ({ student, next: nextAfter(student.id, now) }));
  return { sections, rest };
}

/** "tänään 18:30", "huomenna 16:30", "to 18:00" (within a week), "ti 3.11. 17:00" — when a session is. */
export function sessionWhen(training, today = koutsiTodayStr()) {
  const time = training.time || '';
  if (training.date === today) return `tänään ${time}`;
  if (training.date === koutsiAddDays(today, 1)) return `huomenna ${time}`;
  const short = shortDay(training.date);
  return `${training.date < koutsiAddDays(today, 7) && training.date > today ? short.split(' ')[0] : short} ${time}`;
}

/** The ISO week a date falls in is the current one. */
export function inCurrentWeek(dateStr) {
  return koutsiCompareIsoWeeks(koutsiIsoWeekOfDateStr(dateStr), koutsiCurrentIsoWeek()) === 0;
}

const localDay = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${koutsiPad(d.getMonth() + 1)}-${koutsiPad(d.getDate())}`;
};

// Sessions held, attendance, the players' feelings (the ones they let the coach see) and new
// wishes between two dates (inclusive) — the recap of a week, or of a single day.
function recapBetween(state, first, last, now) {
  const sessions = state.trainings.filter((t) => t.loggedBy !== 'player' && t.date >= first && t.date <= last);
  const groupOf = (t) => (t.groupId ? koutsiGroupById(state, t.groupId) : null);
  const held = sessions.filter((t) => sessionStatus(t, groupOf(t), now) === 'past');
  let expected = 0;
  let present = 0;
  held.forEach((t) => {
    const roster = sessionRoster(state, t);
    expected += roster.length;
    present += roster.filter((s) => !(t.absences || []).some((a) => a.studentId === s.id)).length;
  });
  const inRange = (iso) => { const d = localDay(iso); return d >= first && d <= last; };
  const moods = state.students.flatMap((s) => (s.moods || []).filter((m) => inRange(m.at)).map((m) => ({ ...m, student: s })));
  const wishes = state.students.flatMap((s) => (s.wishHistory || [])
    .filter((h) => h.value && inRange(h.at)).map((h) => ({ student: s, text: h.value, at: h.at })))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return {
    hadSessions: sessions.length > 0,
    sessions: sessions.length,
    held: held.length,
    done: sessions.length > 0 && held.length === sessions.length,
    attendance: expected ? present / expected : null,
    present,
    expected,
    moodCount: moods.length,
    moodAverage: moods.length ? moods.reduce((sum, m) => sum + m.score, 0) / moods.length : null,
    wishes,
  };
}

/**
 * "Viikko paketissa": how a week went for the coach — sessions held, attendance, the players'
 * feelings (the ones they let the coach see) and new wishes. `done` once every coach-run session
 * of the week has ended; `hadSessions` false for a week with nothing on the calendar.
 */
export function weekRecap(state, week, now = new Date()) {
  const dates = weekDates(week);
  return { week, ...recapBetween(state, dates[0], dates[6], now) };
}

/** The same for one day ("Päivän yhteenveto"). */
export function dayRecap(state, date, now = new Date()) {
  return { date, ...recapBetween(state, date, date, now) };
}

/**
 * The week whose recap the coach should see when the app opens, if any: this week once all its
 * sessions are over, or — early in the next week — last week, when it had sessions and has no
 * diary entry yet. `seen(week)` says whether the coach already closed that week's recap.
 */
export function recapWeekDue(state, seen, now = new Date()) {
  const current = koutsiCurrentIsoWeek();
  const noted = (w) => (state.weekNotes || []).some((n) => n.year === w.year && n.week === w.week);
  const thisWeek = weekRecap(state, current, now);
  if (thisWeek.done && !noted(current) && !seen(current)) return current;
  const isoDay = ((now.getDay() + 6) % 7) + 1; // 1 = Monday
  const previous = koutsiAddIsoWeeks(current, -1);
  if (isoDay <= 2 && weekRecap(state, previous, now).hadSessions && !noted(previous) && !seen(previous)) return previous;
  return null;
}

const toMinutes = (hhmm) => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const JUST_ENDED_MINUTES = 120;

/**
 * What the Merkitse menu leads with, today:
 *   'now'   a session is going on (all of them, if two overlap)
 *   'ended' a session ended within the last two hours (the latest first, at most two)
 *   'week'  on a Sunday once the day's sessions are over: the week's recap
 *   'day'   once the day's last session is over: the day's summary
 *   'next'  the next session later today
 * → { kind, items: [{ training, group, student }] } or null (nothing on today, not a Sunday).
 */
export function merkitseContext(state, now = new Date()) {
  const today = koutsiTodayStr();
  const items = coachSessionsOn(state, today);
  const status = (it) => sessionStatus(it.training, it.group, now);
  const live = items.filter((it) => status(it) === 'now');
  if (live.length) return { kind: 'now', items: live };
  const minutesNow = toMinutes(nowHHMM(now));
  const ended = items.filter((it) => {
    if (status(it) !== 'past') return false;
    const ago = minutesNow - toMinutes(sessionEnd(it.training, it.group));
    return ago >= 0 && ago <= JUST_ENDED_MINUTES;
  }).reverse();
  if (ended.length) return { kind: 'ended', items: ended.slice(0, 2) };
  const later = items.filter((it) => status(it) === 'upcoming');
  if (!later.length && now.getDay() === 0) return { kind: 'week', items: [] };
  if (items.length && !later.length) return { kind: 'day', items };
  if (later.length) return { kind: 'next', items: later.slice(0, 1) };
  return null;
}

/** Who a note after a session is for: the players who were there (or the one student). */
export function presentPlayerIds(state, training) {
  const absent = new Set((training.absences || []).map((a) => a.studentId));
  return sessionRoster(state, training).filter((s) => !absent.has(s.id)).map((s) => s.id);
}

/** Who a record for several sessions is for: everyone there (or coming) in any of them, once. */
export function presentPlayerIdsOf(state, trainings) {
  return [...new Set(trainings.flatMap((t) => presentPlayerIds(state, t)))];
}

/** The groups with a coach-run session in a week (Monday–Sunday), in schedule order. */
export function weekGroups(state, week) {
  const dates = weekDates(week);
  const ids = new Set(state.trainings
    .filter((t) => t.groupId && t.loggedBy !== 'player' && t.date >= dates[0] && t.date <= dates[6])
    .map((t) => t.groupId));
  return koutsiSortGroupsBySchedule((state.allGroups || state.groups).filter((g) => ids.has(g.id)));
}

/** The players in some groups, once each (members without a player record left out). */
export function groupMemberIds(state, groups) {
  return [...new Set(groups.flatMap((g) => g.memberIds || []))].filter((id) => koutsiStudentById(state, id));
}

/**
 * The session "Läsnäolo" opens: the one going on or just over, else today's latest held one,
 * else today's next one; null when there is nothing today.
 */
export function attendanceSession(state, now = new Date()) {
  const ctx = merkitseContext(state, now);
  if (ctx && (ctx.kind === 'now' || ctx.kind === 'ended')) return ctx.items[0];
  const items = coachSessionsOn(state, koutsiTodayStr());
  const held = items.filter((it) => sessionStatus(it.training, it.group, now) === 'past');
  return held[held.length - 1] || items.find((it) => sessionStatus(it.training, it.group, now) === 'upcoming') || null;
}

/** "25 min", "1 h", "1 h 55 min" — how long until a session starts or ends. */
export function minutesLabel(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

/**
 * A day's coach-run sessions as a timeline, by time: each with where it stands ('past' | 'now'
 * | 'upcoming'), when it ends, the minutes left (running) or until it starts (upcoming, today
 * only), how far it has run (0–1), and who is expected and who is there.
 */
export function dayTimeline(state, dateStr, now = new Date()) {
  const minutesNow = toMinutes(nowHHMM(now));
  const isToday = dateStr === koutsiTodayStr();
  return coachSessionsOn(state, dateStr).map((item) => {
    const { training, group } = item;
    const status = sessionStatus(training, group, now);
    const end = sessionEnd(training, group);
    const start = toMinutes(training.time);
    const stop = Math.max(start + 1, toMinutes(end));
    const roster = sessionRoster(state, training).length;
    const absent = (training.absences || []).length;
    return {
      ...item,
      status,
      end,
      roster,
      absent,
      present: Math.max(0, roster - absent),
      minutesLeft: status === 'now' ? stop - minutesNow : null,
      minutesUntil: status === 'upcoming' && isToday ? start - minutesNow : null,
      progress: status === 'past' ? 1 : status === 'now' ? Math.min(1, Math.max(0, (minutesNow - start) / (stop - start))) : 0,
    };
  });
}

/** Today's sessions as a timeline (dayTimeline for today). */
export function todayTimeline(state, now = new Date()) {
  return dayTimeline(state, koutsiTodayStr(), now);
}

/** A group's weekly times: its own day and time, then its extra slots. */
export function groupTimes(group) {
  const main = group.day ? [{ day: group.day, time: group.time, durationMinutes: group.durationMinutes }] : [];
  return [...main, ...(group.slots || []).map((s) => ({ day: s.day, time: s.time, durationMinutes: s.durationMinutes }))];
}

/** 0 = Monday … 6 = Sunday for a weekday code ("Ma", "ke"), or -1. */
function mondayIndex(code) {
  const i = KOUTSI_WEEKDAY_TO_INDEX[String(code || '').toLowerCase()];
  return i == null ? -1 : (i + 6) % 7;
}

/**
 * The Ryhmät page's week, Monday to Sunday: under each day the groups that train then, by time.
 * A card is a session on the calendar — on the day it really is, so a moved session shows where
 * it moved — or, when a group's weekly time has no session that week, a "no session" card
 * (`missing`), so a calendar that ran out or a cancelled session shows instead of the group
 * quietly vanishing. Weeks before a group's first session leave the group out.
 *   → { days: [{ date, items: [{ group, training, time, durationMinutes, missing, why }] }] ×7, loose: [group] }
 * `why` for a missing card: 'none' (nothing on the calendar at all), 'week' (no session this
 * week) or 'day' (the group trains this week, but not on this day). `loose`: groups with no
 * weekly day and no session this week.
 */
export function groupWeekBoard(state, week) {
  const dates = weekDates(week);
  const first = dates[0];
  const last = dates[6];
  const days = dates.map((date) => ({ date, items: [] }));
  const loose = [];
  for (const group of state.groups) {
    const all = state.trainings.filter((t) => t.groupId === group.id && t.loggedBy !== 'player');
    const inWeek = all.filter((t) => t.date >= first && t.date <= last);
    inWeek.forEach((t) => {
      days[dates.indexOf(t.date)].items.push({ group, training: t, time: t.time, durationMinutes: t.durationMinutes || group.durationMinutes, missing: false });
    });
    const times = groupTimes(group).filter((x) => mondayIndex(x.day) >= 0);
    if (!times.length && !inWeek.length) loose.push(group);
    const started = all.length === 0 || all.some((t) => t.date <= last);
    if (!started) continue;
    const why = all.length === 0 ? 'none' : inWeek.length ? 'day' : 'week';
    times.forEach((x) => {
      const day = days[mondayIndex(x.day)];
      if (day.items.some((it) => it.group.id === group.id)) return;
      day.items.push({ group, training: null, time: x.time, durationMinutes: x.durationMinutes, missing: true, why });
    });
  }
  days.forEach((d) => d.items.sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.group.name.localeCompare(b.group.name, 'fi')));
  return { days, loose: koutsiSortGroupsBySchedule(loose) };
}
