// playerNow.js — what the player's Merkitse sheet (and Koti) leads with, as pure functions:
// the sessions that just ended, each to be rated on its own slide (or all at once), and
// otherwise the next session with its "En pääse".
//
// A mood can name the session it is about (koutsi_moods.training_id). One that does answers that
// session only; one that doesn't — the old way, "Fiilis nyt", or "Kaikista kerralla" — answers
// every session that began before it. Before the column exists every mood is the second kind,
// so only the latest session is asked about, as before.

import { koutsiAddDays, koutsiTrainingsForStudent, koutsiGroupById, koutsiAddMinutesToTime, koutsiPad } from './core.js';
import { upcomingSessions } from './player.js';

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

/** Long-term ambition: what kind of player the player is aiming to be. */
export const AMBITIONS = [
  { id: 'harrastus', label: 'Pelaan huvikseni', sub: 'Liikunta ja hyvä fiilis' },
  { id: 'kehitys', label: 'Haluan kehittyä', sub: 'Paremmaksi omaan tahtiin' },
  { id: 'kilpailu', label: 'Pelaan kilpaa', sub: 'Kisat ja sarjat' },
  { id: 'huippu', label: 'Tähtään huipulle', sub: 'Esim. A-taso tai SM' },
];
export const ambitionById = (id) => AMBITIONS.find((a) => a.id === id) || null;
