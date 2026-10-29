// openSlots.js — Vapaat ajat (koutsi_open_slots): a coach's single free times that their own players
// book. A booking is an ordinary private lesson (koutsi_trainings, type Yksityistunti), so the week
// views, attendance, "En pääse" and billing see it like any other. Pure helpers for both apps and the
// demo backend; the rules mirror koutsi/web/sql/20261029180000_koutsi_open_slots.sql.
//
//   Slot { id, coachId, date: 'YYYY-MM-DD', time: 'HH:MM', durationMinutes, place, sourceTrainingId,
//          bookedBy, bookedAt, trainingId, at }

import { koutsiAddDays, koutsiAddMinutesToTime, koutsiFmtShortDate, koutsiPad, koutsiTimeRangeLabel } from './core.js';

export const SLOT_MIN_MINUTES = 15;
export const SLOT_MAX_MINUTES = 240;
export const SLOT_DAYS_AHEAD = 183;
export const SLOT_PLACE_MAX = 120;
export const SLOTS_PER_PUBLISH = 50;

const dateOf = (now) => `${now.getFullYear()}-${koutsiPad(now.getMonth() + 1)}-${koutsiPad(now.getDate())}`;
const stampOf = (now) => `${dateOf(now)}T${koutsiPad(now.getHours())}:${koutsiPad(now.getMinutes())}`;
const startOf = (x) => `${x.date}T${x.time || '00:00'}`;
const byStart = (a, b) => startOf(a).localeCompare(startOf(b));

/** Has the slot (or lesson) started by `now`? */
export function hasStarted(x, now = new Date()) {
  return startOf(x) <= stampOf(now);
}

/** "ti 3.11. klo 17:00–18:00" */
export function slotWhen(slot) {
  return `${koutsiFmtShortDate(slot.date)} klo ${koutsiTimeRangeLabel(slot.time, slot.durationMinutes || 60)}`;
}

/** "ti 3.11. klo 17:00" — the way the database's notices name a time (koutsi_session_when). */
export function slotStartLabel(slot) {
  return `${koutsiFmtShortDate(slot.date)} klo ${slot.time}`;
}

/** Open (nobody has booked it) and still to come, soonest first. */
export function openToBook(slots, now = new Date()) {
  return (slots || []).filter((s) => !s.bookedBy && !hasStarted(s, now)).sort(byStart);
}

/** The coach's list: everything from now on (open and booked), soonest first, by day. */
export function slotsByDay(slots, now = new Date()) {
  const out = [];
  (slots || []).filter((s) => !hasStarted(s, now)).sort(byStart).forEach((s) => {
    const last = out[out.length - 1];
    if (last && last.date === s.date) last.slots.push(s);
    else out.push({ date: s.date, slots: [s] });
  });
  return out;
}

/** A coach's private lesson (one player, no group, not a player's own log). */
export function isPrivateLesson(t) {
  return Boolean(t && t.studentId && !t.groupId && t.loggedBy !== 'player');
}

/** The slot a lesson was offered from ("Tarjoa aika muille"), if it was. */
export function offerOf(slots, trainingId) {
  return (slots || []).find((s) => s.sourceTrainingId === trainingId) || null;
}

/** The slot a lesson was booked from (its place lives there). */
export function bookedSlotOf(slots, trainingId) {
  return (slots || []).find((s) => s.trainingId === trainingId) || null;
}

/**
 * Vapautuneet ajat: coming private lessons whose player said "En pääse" and that are not offered to
 * the others yet — each one tap away from being an open slot again.
 */
export function freedLessons(trainings, slots, now = new Date()) {
  return (trainings || [])
    .filter((t) => isPrivateLesson(t) && !hasStarted(t, now)
      && (t.absences || []).some((a) => a.studentId === t.studentId)
      && !offerOf(slots, t.id))
    .sort(byStart);
}

/** A freed lesson as a new slot: same day, start, length and place. */
export function slotFromLesson(t, slots) {
  return {
    date: t.date, time: t.time, durationMinutes: t.durationMinutes || 60,
    place: bookedSlotOf(slots, t.id)?.place || '', sourceTrainingId: t.id,
  };
}

/** "a", "a ja b", "a, b ja c", "a, b, c ja 2 muuta" — like the players' notice. */
export function listLine(labels) {
  const items = (labels || []).filter(Boolean);
  if (items.length <= 1) return items[0] || '';
  if (items.length <= 3) return `${items.slice(0, -1).join(', ')} ja ${items[items.length - 1]}`;
  const more = items.length - 3;
  return `${items.slice(0, 3).join(', ')} ja ${more} ${more === 1 ? 'muu' : 'muuta'}`;
}

// ── the coach's "Lisää vapaita aikoja" form ─────────────────────────────────

/** The first row: tomorrow, no time yet. */
export function firstDraftRow(now = new Date()) {
  return { date: koutsiAddDays(dateOf(now), 1), time: '' };
}

/** "+ Lisää aika": right after the previous time on the same day, or the same time the next day. */
export function nextDraftRow(prev, durationMinutes = 60, now = new Date()) {
  if (!prev?.date) return firstDraftRow(now);
  if (!prev.time) return { date: prev.date, time: '' };
  const next = koutsiAddMinutesToTime(prev.time, durationMinutes);
  if (next > prev.time && next <= '21:00') return { date: prev.date, time: next };
  return { date: koutsiAddDays(prev.date, 1), time: prev.time };
}

/** What still keeps the form from publishing (a Finnish sentence), or null. */
export function draftProblem(rows, { durationMinutes, place = '' } = {}, now = new Date()) {
  const list = rows || [];
  if (!list.length) return 'Lisää vähintään yksi aika.';
  if (list.length > SLOTS_PER_PUBLISH) return `Enintään ${SLOTS_PER_PUBLISH} aikaa kerralla.`;
  if (list.some((r) => !r.date)) return 'Valitse päivä.';
  if (list.some((r) => !r.time)) return 'Valitse kellonaika.';
  if (list.some((r) => hasStarted(r, now))) return 'Vapaan ajan pitää olla tulevaisuudessa.';
  if (list.some((r) => r.date > koutsiAddDays(dateOf(now), SLOT_DAYS_AHEAD))) return 'Vapaita aikoja voi lisätä enintään puoli vuotta eteenpäin.';
  const keys = list.map(startOf);
  if (new Set(keys).size !== keys.length) return 'Sama aika on listalla kahdesti.';
  if (!(durationMinutes >= SLOT_MIN_MINUTES && durationMinutes <= SLOT_MAX_MINUTES)) return `Keston pitää olla ${SLOT_MIN_MINUTES}–${SLOT_MAX_MINUTES} minuuttia.`;
  if ((place || '').trim().length > SLOT_PLACE_MAX) return `Paikka on liian pitkä (enintään ${SLOT_PLACE_MAX} merkkiä).`;
  return null;
}

/** The rows as slots for api.openSlots.add. */
export function draftSlots(rows, { durationMinutes, place = '' } = {}) {
  return (rows || []).map((r) => ({ date: r.date, time: r.time, durationMinutes, place: (place || '').trim() }));
}
