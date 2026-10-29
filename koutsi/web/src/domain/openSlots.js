// openSlots.js — Vapaat ajat (koutsi_open_slots): a coach's single free times that their own players
// book. A booking is an ordinary private lesson (koutsi_trainings, type Yksityistunti), so the week
// views, attendance, "En pääse" and billing see it like any other. Pure helpers for both apps and the
// demo backend; the rules mirror koutsi/web/sql/20261029180000_koutsi_open_slots.sql.
//
//   Slot { id, coachId, date: 'YYYY-MM-DD', time: 'HH:MM', durationMinutes, place, audience: 'all' | 'private',
//          sourceTrainingId, bookedBy, bookedAt, trainingId, at }

import { koutsiAddDays, koutsiAddMinutesToTime, koutsiFmtShortDate, koutsiPad, koutsiTimeRangeLabel } from './core.js';

export const SLOT_MIN_MINUTES = 15;
export const SLOT_MAX_MINUTES = 240;
export const SLOT_DAYS_AHEAD = 183;
export const SLOT_PLACE_MAX = 120;
export const SLOTS_PER_PUBLISH = 50;
// Who a slot is for (the database's audience): every current player, or those who have had a
// private lesson with the coach. Known minors never see slots (koutsi_open_slot_for).
export const AUDIENCES = [
  { value: 'all', label: 'Kaikille pelaajille' },
  { value: 'private', label: 'Yksityistuntilaisille' },
];
// Suggestions (Koti, "Korvaava aika?") look this far ahead, and Koti's "Ei kiitos" lasts this long.
export const SUGGEST_DAYS = 14;
export const SUGGEST_REST_DAYS = 14;

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

/** A player known to be under 18: no slots, no suggestions until there is a guardian flow. */
export function isMinor(student) {
  return Number.isFinite(student?.age) && student.age < 18;
}

/** The free times worth suggesting: open, within the next SUGGEST_DAYS days (of one coach, if given). */
export function soonSlots(slots, { coachId = null, now = new Date(), days = SUGGEST_DAYS } = {}) {
  const until = koutsiAddDays(dateOf(now), days);
  return openToBook(slots, now).filter((s) => s.date <= until && (!coachId || s.coachId === coachId));
}

/** Has the player a booked free time still to come? (Then Koti doesn't suggest another.) */
export function hasComingBooking(slots, studentId, now = new Date()) {
  return (slots || []).some((s) => s.bookedBy === studentId && !hasStarted(s, now));
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

/** A freed lesson (its player said "En pääse") as a new slot: same day, start, length, place and audience. */
export function slotFromLesson(t, slots) {
  const booked = bookedSlotOf(slots, t.id);
  return {
    date: t.date, time: t.time, durationMinutes: t.durationMinutes || 60,
    place: booked?.place || '', audience: booked?.audience || 'all', sourceTrainingId: t.id,
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

/** The first row: today (like Uusi treeni), no time yet — nothing guessed. */
export function firstDraftRow(now = new Date()) {
  return { date: dateOf(now), time: '' };
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
export function draftSlots(rows, { durationMinutes, place = '', audience = 'all' } = {}) {
  return (rows || []).map((r) => ({ date: r.date, time: r.time, durationMinutes, place: (place || '').trim(), audience }));
}
