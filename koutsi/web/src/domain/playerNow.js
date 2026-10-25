// playerNow.js — what the player's Merkitse sheet (and Koti) leads with, as pure functions:
// the sessions that just ended, each to be rated on its own slide (or all at once), and
// otherwise the next session with its "En pääse".
//
// A mood can name the session it is about (koutsi_moods.training_id). One that does answers that
// session only; one that doesn't — the old way, "Fiilis nyt", or "Kaikista kerralla" — answers
// every session that began before it. Before the column exists every mood is the second kind,
// so only the latest session is asked about, as before.

import {
  koutsiAddDays, koutsiTrainingsForStudent, koutsiGroupById, koutsiAddMinutesToTime, koutsiPad, koutsiCoachById, koutsiThemeForDate,
} from './core.js';
import { upcomingSessions } from './player.js';
import { weekDates } from './week.js';

const hhmm = (d) => `${koutsiPad(d.getHours())}:${koutsiPad(d.getMinutes())}`;
const dayOf = (d) => `${d.getFullYear()}-${koutsiPad(d.getMonth() + 1)}-${koutsiPad(d.getDate())}`;
const startOf = (t) => new Date(`${t.date}T${t.time || '00:00'}:00`);

/** When a session ends, as "HH:MM" on its own date (the group's length if the row has none). */
export function sessionEnd(state, training) {
  const group = training.groupId ? koutsiGroupById(state, training.groupId) : null;
  return koutsiAddMinutesToTime(training.time || '00:00', training.durationMinutes || group?.durationMinutes || 60);
}

/** Does this mood answer this session? */
export function moodAnswers(mood, training) {
  if (mood.trainingId) return mood.trainingId === training.id;
  return new Date(mood.at) >= startOf(training);
}

/** The mood that answers a session (newest first in student.moods), or null. */
export function moodFor(student, training) {
  return (student.moods || []).find((m) => moodAnswers(m, training)) || null;
}

/**
 * The sessions to ask "Miten meni?" about: coach-run sessions of the player's latest day with an
 * ended, unanswered one in the last three days. Each comes with its mood (null = not answered).
 * The player's absences and skipped sessions are left out. With `perSession` false (no
 * training_id column yet) only the latest session is returned, as the old check-in did.
 *   → [{ training, end, mood }] in time order, or [] when nothing is waiting.
 */
export function endedSessions(state, student, { now = new Date(), skipped = new Set(), perSession = true } = {}) {
  const today = dayOf(now);
  const floor = koutsiAddDays(today, -3);
  const t = hhmm(now);
  const ended = koutsiTrainingsForStudent(state, student.id).filter((s) => {
    if (s.loggedBy === 'player' || s.date < floor || s.date > today || skipped.has(s.id)) return false;
    if ((s.absences || []).some((a) => a.studentId === student.id)) return false;
    return s.date < today || t >= sessionEnd(state, s);
  }).map((training) => ({ training, end: sessionEnd(state, training), mood: moodFor(student, training) }));
  const waiting = ended.filter((x) => !x.mood);
  if (!waiting.length) return [];
  const day = waiting[waiting.length - 1].training.date;
  if (!perSession) return [waiting[waiting.length - 1]];
  // the whole day, answered ones too, so the slides keep their places as they get rated
  const block = ended.filter((x) => x.training.date === day);
  return block.sort((a, b) => (a.training.time || '').localeCompare(b.training.time || ''));
}

/**
 * The lead of the Merkitse sheet: { ended: endedSessions(), next, then } — `next` and `then`
 * are the next two coach-run sessions that haven't ended (null when none).
 */
export function merkitseLead(state, student, opts = {}) {
  const now = opts.now || new Date();
  const ended = endedSessions(state, student, { ...opts, now });
  const upcoming = upcomingSessions(state, student.id, now);
  return { ended, next: upcoming[0] || null, then: upcoming[1] || null };
}

/** Index of the first unanswered slide (0 if all are answered). */
export const firstOpenSlide = (ended) => Math.max(0, ended.findIndex((x) => !x.mood));

/** "17:00–20:00" over a run of sessions, from the first start to the last end. */
export function spanLabel(ended) {
  if (!ended.length) return '';
  return `${ended[0].training.time || ''}–${ended[ended.length - 1].end}`;
}

// ── Koti's session line ─────────────────────────────────────
// A player can have many sessions a week, each with its own group and theme, so Koti reads them
// from the clock, the way the coach's day does: the one that just ended, the one on now, the
// next one and a few after it.

const MIN = 60 * 1000;

/** A coach-run session as Koti shows it: where it stands now and how far from now it is. */
function lineItem(state, student, training, nowMs) {
  const group = training.groupId ? koutsiGroupById(state, training.groupId) : null;
  const length = training.durationMinutes || group?.durationMinutes || 60;
  const start = startOf(training).getTime();
  const endMs = start + length * MIN;
  const status = nowMs < start ? 'upcoming' : nowMs < endMs ? 'now' : 'past';
  return {
    training, group, status,
    coach: state.coaches ? koutsiCoachById(state, training.coachId) : null,
    theme: group ? koutsiThemeForDate(group, training.date) : null,
    end: hhmm(new Date(endMs)),
    absent: (training.absences || []).some((a) => a.studentId === student.id),
    minutesUntil: Math.round((start - nowMs) / MIN),
    minutesLeft: Math.round((endMs - nowMs) / MIN),
    minutesAgo: Math.round((nowMs - endMs) / MIN),
    progress: Math.min(1, Math.max(0, (nowMs - start) / (endMs - start))),
  };
}

/**
 * The player's coach-run sessions around now, for Koti:
 *   previous — the latest one that ended in the last two days and the player was at (or null),
 *   now      — the ones running now,
 *   next     — the next one that hasn't started (or null),
 *   later    — up to `later` more after it, within two weeks.
 */
export function sessionLine(state, student, { now = new Date(), later = 3 } = {}) {
  const today = dayOf(now);
  const nowMs = now.getTime();
  const items = koutsiTrainingsForStudent(state, student.id)
    .filter((t) => t.loggedBy !== 'player' && t.date >= koutsiAddDays(today, -2) && t.date <= koutsiAddDays(today, 14))
    .map((t) => lineItem(state, student, t, nowMs));
  const past = items.filter((x) => x.status === 'past' && !x.absent);
  const upcoming = items.filter((x) => x.status === 'upcoming');
  return {
    previous: past[past.length - 1] || null,
    now: items.filter((x) => x.status === 'now'),
    next: upcoming[0] || null,
    later: upcoming.slice(1, 1 + later),
  };
}

/** The session a tap on a day opens: the day's first one that hasn't ended, else its last; null when the day has none. */
export function sessionForDay(state, student, date, now = new Date()) {
  const nowMs = now.getTime();
  const day = koutsiTrainingsForStudent(state, student.id)
    .filter((t) => t.loggedBy !== 'player' && t.date === date)
    .map((t) => lineItem(state, student, t, nowMs));
  return day.find((x) => x.status !== 'past') || day[day.length - 1] || null;
}

/** Koti's week strip: Monday to Sunday, a dot per coach-run session and whether there are own logs. */
export function weekDots(state, student, week, now = new Date()) {
  const today = dayOf(now);
  const nowMs = now.getTime();
  const all = koutsiTrainingsForStudent(state, student.id);
  return weekDates(week).map((date, i) => {
    const onDay = all.filter((t) => t.date === date);
    return {
      date, label: ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'][i], day: Number(date.slice(8)),
      isToday: date === today, isPast: date < today,
      sessions: onDay.filter((t) => t.loggedBy !== 'player').map((t) => lineItem(state, student, t, nowMs)),
      own: onDay.filter((t) => t.loggedBy === 'player' && t.studentId === student.id).length,
    };
  });
}

/** Long-term ambition: what kind of player the player is aiming to be. */
export const AMBITIONS = [
  { id: 'harrastus', label: 'Pelaan huvikseni', sub: 'Liikunta ja hyvä fiilis' },
  { id: 'kehitys', label: 'Haluan kehittyä', sub: 'Paremmaksi omaan tahtiin' },
  { id: 'kilpailu', label: 'Pelaan kilpaa', sub: 'Kisat ja sarjat' },
  { id: 'huippu', label: 'Tähtään huipulle', sub: 'Esim. A-taso tai SM' },
];
export const ambitionById = (id) => AMBITIONS.find((a) => a.id === id) || null;
