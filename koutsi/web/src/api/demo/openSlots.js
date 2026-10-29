// openSlots.js — Vapaat ajat in the demo backend. Anna has the feature on: a few open times, one
// booked by Jussi, and a freed lesson (Leo cannot come on Thursday) to offer to the others.
//
// The coach and the player demo are two pages, each with its own memory, so what happens to the
// slots travels between them through the browser (localStorage, kept for a few hours): a time the
// coach adds in /demo/valmentaja can be booked in /demo/pelaaja, and the lesson shows in both weeks
// (the other page picks it up when it loads or comes back to the front). Nothing leaves the browser.
// The rules are the database's (koutsi/web/sql/20261029180000_koutsi_open_slots.sql).

import { ApiError } from '../errors.js';
import { koutsiAddDays, koutsiNextWeekday, koutsiTodayStr } from '../../domain/core.js';
import { OPEN_SLOTS_ON, draftProblem, hasStarted, isMinor, isPrivateLesson, listLine, slotStartLabel } from '../../domain/openSlots.js';
import { COACH, PLAYER, newId } from './seed.js';

const KEY = 'koutsi-demo-vapaat-v1';
const KEEP_MS = 6 * 60 * 60 * 1000;
const COACH_NAME = 'Anna Koskinen';
const clone = (v) => JSON.parse(JSON.stringify(v));
const nowIso = () => new Date().toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const newestFirst = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));

// ── what the two demo pages share ───────────────────────────────────────────
const blank = () => ({ added: [], removed: [], booked: [] });
function readShared() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (!data || Date.now() - (data.savedAt || 0) > KEEP_MS) return blank();
    return { added: data.added || [], removed: data.removed || [], booked: data.booked || [] };
  } catch {
    return blank();
  }
}
function writeShared(change) {
  try {
    const data = readShared();
    change(data);
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch { /* private mode: the other page just won't see it */ }
}

// ── the demo world's slots ──────────────────────────────────────────────────
const slot = (id, date, time, durationMinutes = 60, place = '', extra = {}) => ({
  id, coachId: COACH, date, time, durationMinutes, place, audience: 'all', sourceTrainingId: null, bookedBy: null, bookedAt: null, trainingId: null, at: hoursAgo(20), ...extra,
});

/** The database's koutsi_open_slot_for: a current player, not a known minor, and for 'private' someone
 *  who has had a private lesson with the coach. */
function slotFor(state, s, studentId) {
  const me = state.students.find((x) => x.id === studentId);
  if (!me || isMinor(me)) return false;
  return s.audience !== 'private'
    || state.trainings.some((t) => t.coachId === s.coachId && t.studentId === studentId && isPrivateLesson(t));
}
const lessonFor = (s, studentId, trainingId) => ({
  id: trainingId, date: s.date, time: s.time, type: 'Yksityistunti', durationMinutes: s.durationMinutes, loggedBy: 'coach', notes: '', endDate: null,
  studentId, groupId: null, coachId: s.coachId, seriesId: null, absences: [],
});

function seedSlots(state) {
  const next = (code) => koutsiNextWeekday(koutsiAddDays(koutsiTodayStr(), 1), code);
  state.openSlots = [
    slot('demo-slot-1', next('Ma'), '14:00', 60, 'Kenttä 2'),
    slot('demo-slot-2', next('Ke'), '14:30'),
    slot('demo-slot-3', next('Ke'), '15:30'),
    slot('demo-slot-4', next('La'), '10:30', 90, 'Kenttä 1', { audience: 'private' }),
  ];
  // Jussi booked Friday's time: an ordinary private lesson in both calendars
  const jussi = slot('demo-slot-5', next('Pe'), '14:00', 60, 'Kenttä 2', { bookedBy: 'demo-s-jussi', bookedAt: hoursAgo(6), trainingId: 'tr-slot-jussi' });
  state.openSlots.push(jussi);
  state.trainings.push(lessonFor(jussi, 'demo-s-jussi', 'tr-slot-jussi'));
  // Leo cannot come to his lesson on Thursday: a time the coach can offer to the others
  const leo = state.trainings.find((t) => t.id === 'tr-private-leo');
  if (leo && !leo.absences.some((a) => a.studentId === 'demo-s-leo')) {
    leo.absences.push({ studentId: 'demo-s-leo', reason: 'poissa', note: '', reportedBy: 'demo-s-leo', updatedAt: hoursAgo(3) });
  }
  state.notifications = [
    ...(leo ? [{ id: 'demo-nt-slot-leo', kind: 'player_absence', title: 'Leo K. ei pääse', body: `Yksityistunti · ${slotStartLabel(leo)}`, linkPath: '/valmentaja/treeni/tr-private-leo', createdAt: hoursAgo(3), read: false }] : []),
    { id: 'demo-nt-slot-jussi', kind: 'slot_booked', title: 'Jussi T. varasi ajan', body: `${slotStartLabel(jussi)} · Kenttä 2`, linkPath: '/valmentaja/treeni/tr-slot-jussi', createdAt: hoursAgo(6), read: true },
    ...(state.notifications || []),
  ].sort(newestFirst);
  state.playerNotifications = [
    { id: 'demo-pn-slots', kind: 'open_slots', title: 'Uusia vapaita aikoja', body: `${COACH_NAME}: ${listLine(state.openSlots.filter((s) => !s.bookedBy && slotFor(state, s, PLAYER)).map(slotStartLabel))}`, linkPath: '/pelaaja/vapaat', createdAt: hoursAgo(20), read: false },
    ...(state.playerNotifications || []),
  ].sort(newestFirst);
}

function applyBooking(state, s, { studentId, trainingId, at }) {
  Object.assign(s, { bookedBy: studentId, bookedAt: at, trainingId });
  if (!state.trainings.some((t) => t.id === trainingId)) state.trainings.push(lessonFor(s, studentId, trainingId));
}

const nameOf = (state, id) => state.students.find((x) => x.id === id)?.name || 'Pelaaja';

/** What the other page did since this one looked: new and removed times, bookings. */
function syncShared(state, role) {
  const shared = readShared();
  const removed = new Set(shared.removed);
  const fresh = shared.added.filter((s) => !removed.has(s.id) && !state.openSlots.some((x) => x.id === s.id));
  fresh.forEach((s) => state.openSlots.push(clone(s)));
  state.openSlots = state.openSlots.filter((s) => s.bookedBy || !removed.has(s.id));
  shared.booked.forEach((b) => {
    const s = state.openSlots.find((x) => x.id === b.slotId);
    if (!s || s.bookedBy) return;
    applyBooking(state, s, b);
    if (role === 'coach') {
      state.notifications.unshift({ id: `demo-nt-${b.trainingId}`, kind: 'slot_booked', title: `${nameOf(state, b.studentId)} varasi ajan`,
        body: `${slotStartLabel(s)}${s.place ? ` · ${s.place}` : ''}`, linkPath: `/valmentaja/treeni/${b.trainingId}`, createdAt: b.at, read: false });
    }
  });
  const mine = role === 'player' ? fresh.filter((s) => !s.bookedBy && slotFor(state, s, PLAYER)) : [];
  if (mine.length) {
    state.playerNotifications.unshift({ id: newId('pn'), kind: 'open_slots', title: 'Uusia vapaita aikoja',
      body: `${COACH_NAME}: ${listLine(mine.map(slotStartLabel))}`, linkPath: '/pelaaja/vapaat', createdAt: nowIso(), read: false });
  }
}

/** The database's own rules: a removed lesson takes its slot, "Pääsen sittenkin" takes back an offer. */
function tidy(state) {
  const lessons = new Map(state.trainings.map((t) => [t.id, t]));
  state.openSlots = state.openSlots.filter((s) => {
    if (s.trainingId) return lessons.has(s.trainingId);
    const source = s.sourceTrainingId ? lessons.get(s.sourceTrainingId) : null;
    if (s.sourceTrainingId && !source) s.sourceTrainingId = null;
    return !source || (source.absences || []).some((a) => a.studentId === source.studentId);
  });
}

function prepare(state, role) {
  if (!state.openSlots) seedSlots(state);
  syncShared(state, role);
  tidy(state);
}

// ── the backend's functions ─────────────────────────────────────────────────

/** The snapshot's Vapaat ajat for the coach (all of theirs from today on) or a player (open ones and their own). */
export function openSlotsView(state, role, studentId = PLAYER) {
  // not released yet: no slots, and the demo world (Leo, Jussi, the bells) stays as it was
  if (!OPEN_SLOTS_ON) return { openSlots: [], openSlotsReady: false };
  prepare(state, role);
  const today = koutsiTodayStr();
  const list = state.openSlots.filter((s) => s.date >= today
    && (role === 'coach' || s.bookedBy === studentId || (!s.bookedBy && slotFor(state, s, studentId))));
  return { openSlots: clone(list), openSlotsReady: true };
}

export function addOpenSlots(state, slots) {
  if (!OPEN_SLOTS_ON) throw new ApiError('Vapaat ajat eivät ole vielä käytössä.');
  prepare(state, 'coach');
  const rows = (slots || []).map((s) => ({
    date: s.date, time: s.time, durationMinutes: s.durationMinutes || 60, place: (s.place || '').trim(),
    audience: s.audience === 'private' ? 'private' : 'all', sourceTrainingId: s.sourceTrainingId || null,
  }));
  rows.forEach((r) => {
    const problem = draftProblem([r], r);
    if (problem) throw new ApiError(problem);
    if (r.sourceTrainingId && !state.trainings.some((t) => t.id === r.sourceTrainingId && t.coachId === COACH && isPrivateLesson(t))) {
      throw new ApiError('Treeniä ei löytynyt.');
    }
  });
  const fresh = [];
  rows.forEach((r) => {
    const taken = state.openSlots.some((x) => (!x.bookedBy && x.date === r.date && x.time === r.time)
      || (r.sourceTrainingId && x.sourceTrainingId === r.sourceTrainingId));
    if (taken || fresh.some((x) => x.date === r.date && x.time === r.time)) return;
    fresh.push(slot(newId('slot'), r.date, r.time, r.durationMinutes, r.place, { audience: r.audience, sourceTrainingId: r.sourceTrainingId, at: nowIso() }));
  });
  state.openSlots.push(...fresh);
  if (fresh.length) writeShared((d) => { d.added.push(...clone(fresh)); });
  return fresh.length;
}

export function removeOpenSlot(state, slotId) {
  if (!OPEN_SLOTS_ON) throw new ApiError('Vapaat ajat eivät ole vielä käytössä.');
  prepare(state, 'coach');
  const s = state.openSlots.find((x) => x.id === slotId);
  if (!s || s.bookedBy) throw new ApiError('Aika on jo varattu tai poistettu. Päivitä näkymä.', { code: 'not_found' });
  state.openSlots = state.openSlots.filter((x) => x.id !== slotId);
  writeShared((d) => { d.removed.push(slotId); d.added = d.added.filter((x) => x.id !== slotId); });
}

export function bookOpenSlot(state, slotId, studentId = PLAYER) {
  if (!OPEN_SLOTS_ON) throw new ApiError('Vapaat ajat eivät ole vielä käytössä.');
  prepare(state, 'player');
  const s = state.openSlots.find((x) => x.id === slotId);
  if (!s) throw new ApiError('Aikaa ei löytynyt. Se on ehkä poistettu.', { code: 'not_found' });
  if (s.bookedBy === studentId) return { trainingId: s.trainingId };
  if (!slotFor(state, s, studentId)) throw new ApiError('Aikaa ei löytynyt. Se on ehkä poistettu.', { code: 'not_found' });
  if (s.bookedBy) throw new ApiError('Joku ehti varata tämän ajan.', { code: 'taken' });
  if (hasStarted(s)) throw new ApiError('Tämä aika on jo mennyt.');
  const booking = { slotId, studentId, trainingId: newId('tr'), at: nowIso() };
  applyBooking(state, s, booking);
  writeShared((d) => { d.booked.push(booking); });
  return { trainingId: booking.trainingId };
}
