// openSlots.js — Vapaat ajat over koutsi_open_slots (migration
// koutsi/web/sql/20261029180000_koutsi_open_slots.sql, NOT applied yet). Until it is, the snapshots
// carry openSlotsReady: false and both apps keep Vapaat ajat hidden. Row security decides who sees
// what (the coach their own; a player the open ones of their coaches and their own bookings); adding
// and booking are one RPC each, and a booking creates the private lesson in koutsi_trainings.

import { db, isMissingFunction, isMissingTable, must } from './client.js';
import { ApiError } from '../errors.js';
import { koutsiTodayStr } from '../../domain/core.js';

const COLUMNS = 'id, coach_id, date, time, duration_minutes, place, source_training_id, booked_by, booked_at, training_id, created_at';

export function mapOpenSlot(r) {
  return {
    id: r.id, coachId: r.coach_id, date: r.date, time: String(r.time || '').slice(0, 5), durationMinutes: r.duration_minutes || 60,
    place: r.place || '', sourceTrainingId: r.source_training_id || null, bookedBy: r.booked_by || null, bookedAt: r.booked_at || null,
    trainingId: r.training_id || null, at: r.created_at,
  };
}

// The coach: their own slots from today on, and only when the feature is on for them
// (koutsi_open_slots_enabled — the owner's list and admins). A player: what row security lets them see.
async function loadOpenSlots(role, ownerId) {
  let query = db().from('koutsi_open_slots').select(COLUMNS).gte('date', koutsiTodayStr()).order('date').order('time');
  if (role === 'coach') query = query.eq('coach_id', ownerId);
  const [rows, gate] = await Promise.all([query, role === 'coach' ? db().rpc('koutsi_open_slots_enabled') : null]);
  if (rows.error) {
    if (!isMissingTable(rows.error)) console.warn('open slots unavailable:', rows.error.message || rows.error);
    return { openSlots: [], openSlotsReady: false };
  }
  if (role === 'coach') {
    if (gate.error && !isMissingFunction(gate.error)) console.warn('open slots gate unavailable:', gate.error.message || gate.error);
    const on = !gate.error && gate.data === true;
    return { openSlots: on ? (rows.data || []).map(mapOpenSlot) : [], openSlotsReady: on };
  }
  return { openSlots: (rows.data || []).map(mapOpenSlot), openSlotsReady: true };
}

/** A role's snapshot with its Vapaat ajat, read side by side with it. */
export async function withOpenSlots(role, ownerId, snapshot) {
  const [state, slots] = await Promise.all([snapshot, loadOpenSlots(role, ownerId)]);
  return { ...state, ...slots };
}

export const openSlots = {
  // slots: [{ date, time, durationMinutes, place, sourceTrainingId? }] → how many were added (a time
  // that is already open is skipped); each player gets one notice per publish (the RPC sends it).
  async add(coachId, slots) {
    const list = (slots || []).map((s) => ({
      date: s.date, time: s.time, duration: s.durationMinutes || 60, place: (s.place || '').trim() || null, source: s.sourceTrainingId || null,
    }));
    if (!list.length) throw new ApiError('Lisää vähintään yksi aika.');
    return must(await db().rpc('koutsi_add_open_slots', { p_slots: list })) || 0;
  },
  // Only an open one; a booked time goes by removing its lesson.
  async remove(slotId) {
    const rows = must(await db().from('koutsi_open_slots').delete().eq('id', slotId).select('id'));
    if (!rows || rows.length === 0) throw new ApiError('Aika on jo varattu tai poistettu. Päivitä näkymä.', { code: 'not_found' });
  },
  // The first one wins; the same player booking again gets the same lesson back.
  async book(slotId) {
    const trainingId = must(await db().rpc('koutsi_book_open_slot', { p_slot: slotId }));
    return { trainingId };
  },
};
