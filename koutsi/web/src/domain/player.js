// player.js — what the player's screens show, as pure functions over the player state:
// theme cards for Koti, the post-session check-in, the theme path, and an activity streak
// built only from things the player did (never from attendance, which defaults to "present").

import {
  koutsiCurrentIsoWeek, koutsiAddIsoWeeks, koutsiCompareIsoWeeks, koutsiIsoWeekKey, koutsiThemeKey,
  koutsiTodayStr, koutsiAddDays, koutsiTrainingsForStudent, koutsiIsoWeekOfDateStr, koutsiGroupById,
  koutsiAddMinutesToTime, koutsiPad,
} from './core.js';
import { moodAnswers } from './playerNow.js';

/**
 * Koti's theme cards: each group's theme this week, or — until the coach sets one — its latest
 * from the past two weeks, so Monday isn't blank. Groups with the same theme share a card.
 */
export function homeThemeCards(groups, now = koutsiCurrentIsoWeek()) {
  const floor = koutsiAddIsoWeeks(now, -2);
  const cards = new Map();
  (groups || []).forEach((g) => {
    const current = (g.themes || []).find((t) => t.year === now.year && t.week === now.week) || null;
    const theme = current || (g.pastThemes || []).find((t) => koutsiCompareIsoWeeks(t, floor) >= 0 && koutsiCompareIsoWeeks(t, now) < 0) || null;
    if (!theme) return;
    const key = `${current ? 'now' : koutsiIsoWeekKey(theme)}|${koutsiThemeKey(theme.title)}`;
    if (!cards.has(key)) cards.set(key, { key, theme, current: Boolean(current), groups: [] });
    cards.get(key).groups.push(g);
  });
  return [...cards.values()].sort((a, b) => Number(b.current) - Number(a.current));
}

const nowHHMM = (d) => `${koutsiPad(d.getHours())}:${koutsiPad(d.getMinutes())}`;

/** Coach-run sessions for the player that haven't ended yet, soonest first. */
export function upcomingSessions(state, studentId, now = new Date()) {
  const today = koutsiTodayStr();
  const t = nowHHMM(now);
  return koutsiTrainingsForStudent(state, studentId).filter((s) => {
    if (s.loggedBy === 'player') return false;
    if (s.date > today) return true;
    if (s.date < today) return false;
    const group = s.groupId ? koutsiGroupById(state, s.groupId) : null;
    const end = koutsiAddMinutesToTime(s.time || '00:00', s.durationMinutes || group?.durationMinutes || 60);
    return t < end;
  });
}

/**
 * The session to ask "Miten treeni meni?" about: the latest coach-run session that ended in
 * the last three days, that the player wasn't absent from, with no mood logged since it began.
 */
export function checkInCandidate(state, student, dismissed = new Set(), now = new Date()) {
  const today = koutsiTodayStr();
  const floor = koutsiAddDays(today, -3);
  const t = nowHHMM(now);
  const past = koutsiTrainingsForStudent(state, student.id).filter((s) => {
    if (s.loggedBy === 'player' || s.date < floor || s.date > today || dismissed.has(s.id)) return false;
    if ((s.absences || []).some((a) => a.studentId === student.id)) return false;
    if (s.date === today) {
      const group = s.groupId ? koutsiGroupById(state, s.groupId) : null;
      return t >= koutsiAddMinutesToTime(s.time || '00:00', s.durationMinutes || group?.durationMinutes || 60);
    }
    return true;
  });
  const last = past[past.length - 1];
  if (!last) return null;
  // a mood names its session (training_id): rating a later session no longer answers this one
  const answered = (student.moods || []).some((m) => moodAnswers(m, last));
  return answered ? null : last;
}

/** Themes the player's groups worked on, oldest first, one entry per week (titles merged). */
export function themePath(groups, upTo = koutsiCurrentIsoWeek(), limit = 12) {
  const byWeek = new Map();
  (groups || []).forEach((g) => (g.themes || []).forEach((t) => {
    if (koutsiCompareIsoWeeks(t, upTo) > 0) return;
    const k = koutsiIsoWeekKey(t);
    if (!byWeek.has(k)) byWeek.set(k, { year: t.year, week: t.week, titles: [] });
    const entry = byWeek.get(k);
    if (!entry.titles.some((x) => koutsiThemeKey(x) === koutsiThemeKey(t.title))) entry.titles.push(t.title);
  }));
  return [...byWeek.values()].sort(koutsiCompareIsoWeeks).slice(-limit);
}

/** ISO weeks (as keys) in which the player did something themselves. */
function activeWeeks(state, student) {
  const keys = new Set();
  const add = (dateStr) => { if (dateStr) keys.add(koutsiIsoWeekKey(koutsiIsoWeekOfDateStr(String(dateStr).slice(0, 10)))); };
  (student.moods || []).forEach((m) => add(m.at));
  (student.matchNotes || []).forEach((n) => add(n.date || n.at));
  (student.homework || []).filter((h) => h.done && h.doneAt).forEach((h) => add(h.doneAt));
  [...(student.goalHistory || []), ...(student.wishHistory || []), ...(student.noteHistory || [])].forEach((h) => add(h.at));
  (student.entries || []).forEach((e) => add(e.date || e.at));
  state.trainings.filter((t) => t.loggedBy === 'player' && t.studentId === student.id).forEach((t) => add(t.date));
  return keys;
}

/**
 * A forgiving weekly streak: consecutive weeks with any own activity. This week counts if
 * there is activity already; if not, the streak still stands from last week (it isn't over
 * until the week is).
 */
export function activityStreak(state, student, now = koutsiCurrentIsoWeek()) {
  const weeks = activeWeeks(state, student);
  let cursor = weeks.has(koutsiIsoWeekKey(now)) ? now : koutsiAddIsoWeeks(now, -1);
  let n = 0;
  while (weeks.has(koutsiIsoWeekKey(cursor)) && n < 520) { n += 1; cursor = koutsiAddIsoWeeks(cursor, -1); }
  return { weeks: n, thisWeek: weeks.has(koutsiIsoWeekKey(now)) };
}

/** Self-logged minutes and sessions in the current ISO week. */
export function ownThisWeek(state, studentId, now = koutsiCurrentIsoWeek()) {
  const list = state.trainings.filter((t) => t.loggedBy === 'player' && t.studentId === studentId
    && koutsiCompareIsoWeeks(koutsiIsoWeekOfDateStr(t.date), now) === 0);
  return { count: list.length, minutes: list.reduce((s, t) => s + (t.durationMinutes || 0), 0) };
}
