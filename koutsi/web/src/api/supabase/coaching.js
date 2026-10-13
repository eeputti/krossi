// coaching.js — the coach's and the player's own data: roles, state, roster, groups, themes,
// sessions, attendance, notes, homework and club events.
//
// Every write is the same query the old lib/koutsi-data.js runs, against the same tables and
// RPCs, so the old and the renewed app can run side by side on one database.

import { db, must, randomUuid, isMissingFunction } from './client.js';
import { loadCoachState, loadPlayerState } from './load.js';
import { ApiError } from '../errors.js';
import {
  koutsiTodayStr, koutsiNextWeekday, koutsiAddDays, koutsiWeeklyDates, koutsiClampGroupTrainingWeeks,
  koutsiRoundTimeToQuarterHour, koutsiRoundToQuarterHourMinutes,
  KOUTSI_DEFAULT_GROUP_TRAINING_WEEKS, KOUTSI_THEME_TITLE_MAX, KOUTSI_THEME_LEAD_MAX,
} from '../../domain/core.js';

const from = (table) => db().from(table);

// Tables whose changes should refresh an open app (one save can touch many rows; the
// subscriber debounces).
const LIVE_TABLES = ['koutsi_coaches', 'koutsi_students', 'koutsi_coach_students', 'koutsi_groups', 'koutsi_group_members',
  'koutsi_group_themes', 'koutsi_group_slots', 'koutsi_trainings', 'koutsi_training_absences', 'koutsi_exercises', 'koutsi_coach_events',
  'koutsi_videos', 'koutsi_diary_entries', 'koutsi_homework', 'koutsi_moods', 'koutsi_match_notes', 'koutsi_player_history'];
let channelSeq = 0;
function subscribeTables(name, cb) {
  const channel = LIVE_TABLES.reduce(
    (ch, table) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => cb(table)),
    db().channel(`${name}-${Date.now().toString(36)}-${channelSeq++}`),
  ).subscribe();
  return () => { db().removeChannel(channel); };
}

// Materializes a weekly slot into koutsi_trainings, exactly like the old app.
async function generateGroupTrainings(groupId, coachId, day, time, durationMinutes, fromDate, weeksAhead) {
  const first = koutsiNextWeekday(fromDate || koutsiTodayStr(), day);
  if (!first || !time) return { count: 0, seriesId: null };
  const span = (koutsiClampGroupTrainingWeeks(weeksAhead ?? KOUTSI_DEFAULT_GROUP_TRAINING_WEEKS) - 1) * 7;
  const dates = koutsiWeeklyDates(first, koutsiAddDays(first, span));
  const seriesId = randomUuid();
  const rows = dates.map((d) => ({
    coach_id: coachId, group_id: groupId, date: d, time, type: 'Ryhmätreeni',
    duration_minutes: durationMinutes || null, series_id: seriesId,
  }));
  must(await from('koutsi_trainings').insert(rows));
  return { count: rows.length, seriesId };
}

export const coach = {
  async fetchRow(uid) {
    return must(await from('koutsi_coaches').select('id').eq('id', uid).maybeSingle());
  },
  load: loadCoachState,
  async redeemKey(key) {
    return must(await db().rpc('redeem_koutsi_coach_key', { key_input: key }));
  },
  async markWelcomeSeen(coachId) {
    must(await from('koutsi_coaches').update({ welcome_seen_at: new Date().toISOString() }).eq('id', coachId));
  },
  async saveProfile(coachId, { tagline, bio, experience, specialties }) {
    must(await from('koutsi_coaches').update({ tagline, bio, experience, specialties }).eq('id', coachId));
  },
  subscribe(coachId, cb) { return subscribeTables(`koutsi-coach-${coachId}`, cb); },
};

// The three free-text fields a player owns (goal, wish, note) each keep a history row, so
// the timeline can show what the value used to be. The previous value is read back from the
// server, so a stale tab cannot record a wrong "aiemmin".
const HISTORY_COLUMNS = { goal: 'goal', wish: 'player_wish', note: 'player_note' };
async function savePlayerField(studentId, field, value) {
  const column = HISTORY_COLUMNS[field];
  const current = must(await from('koutsi_students').select(column).eq('id', studentId).maybeSingle());
  const previous = current?.[column] || '';
  if (previous === value) return;
  must(await from('koutsi_students').update({ [column]: value }).eq('id', studentId));
  // History is a nice-to-have: a failed append must not lose what the player just wrote.
  await from('koutsi_player_history').insert({ student_id: studentId, field, value, previous_value: previous || null, changed_by: studentId });
}

const matchNoteRow = ({ opponentName, date, note, durationMinutes, result, format, score, partnerName, opponent2Name, tournamentId }) => ({
  opponent_name: opponentName, date, note: note || null,
  duration_minutes: durationMinutes || null, result: result || null, format: format || null, score: score || null,
  partner_name: format === 'nelinpeli' ? (partnerName || null) : null,
  opponent2_name: format === 'nelinpeli' ? (opponent2Name || null) : null,
  tournament_id: tournamentId || null,
});

export const player = {
  async fetchRow(uid) {
    return must(await from('koutsi_students').select('id').eq('id', uid).maybeSingle());
  },
  load: loadPlayerState,
  subscribe(studentId, cb) { return subscribeTables(`koutsi-player-${studentId}`, cb); },
  async markWelcomeSeen(studentId) {
    must(await from('koutsi_students').update({ welcome_seen_at: new Date().toISOString() }).eq('id', studentId));
  },
  saveGoal(studentId, goal) { return savePlayerField(studentId, 'goal', goal); },
  saveNote(studentId, note) { return savePlayerField(studentId, 'note', note); },
  saveWish(studentId, wish) { return savePlayerField(studentId, 'wish', wish); },
  /** The player's optional exact age: the shared profile and the student row, as before. */
  async saveAge(studentId, age) {
    must(await from('profiles').update({ age: age == null ? null : String(age) }).eq('id', studentId));
    must(await from('koutsi_students').update({ age }).eq('id', studentId));
  },
  // hidden_from_coach is enforced by RLS: a hidden mood is simply not selectable by the coach.
  async addMood(studentId, { score, note, hiddenFromCoach }) {
    must(await from('koutsi_moods').insert({ student_id: studentId, score, note: note || null, hidden_from_coach: !!hiddenFromCoach }));
  },
  async setMoodHidden(moodId, hidden) {
    must(await from('koutsi_moods').update({ hidden_from_coach: hidden }).eq('id', moodId));
  },
  async deleteMood(moodId) {
    must(await from('koutsi_moods').delete().eq('id', moodId));
  },
  async addMatchNote(studentId, note) {
    must(await from('koutsi_match_notes').insert({ student_id: studentId, ...matchNoteRow(note) }));
  },
  async updateMatchNote(noteId, note) {
    must(await from('koutsi_match_notes').update(matchNoteRow(note)).eq('id', noteId));
  },
  async deleteMatchNote(noteId) {
    must(await from('koutsi_match_notes').delete().eq('id', noteId));
  },
  // Player-logged individual sessions; `type` doubles as the category label.
  async addSelfTraining({ studentId, coachId, date, endDate, time, type, durationMinutes, notes }) {
    must(await from('koutsi_trainings').insert({
      coach_id: coachId, student_id: studentId, group_id: null, date, end_date: endDate || null, time, type,
      duration_minutes: durationMinutes || null, notes: notes || null, logged_by: 'player',
    }));
  },
  async deleteSelfTraining(trainingId) {
    must(await from('koutsi_trainings').delete().eq('id', trainingId));
  },
};

const validAge = (age) => age == null || (Number.isInteger(age) && age >= 1 && age < 120);

export const students = {
  async create(coachId, { name, age, level }) {
    if (!validAge(age)) throw new ApiError('Jos annat pelaajan iän, sen pitää olla 1–119 vuotta.');
    return must(await db().rpc('koutsi_create_player_v2', {
      name_input: name, age_input: age ?? null, level_input: level || null, coach_id_input: coachId || null,
    }));
  },
  // One RPC instead of a browser-side chain: players, new/existing groups, memberships and
  // themes are stored atomically or not at all.
  async bulkSetup(coachId, { groups = [], players = [], themes = [], weeksAhead } = {}) {
    if (players.some((p) => !validAge(p.age))) throw new ApiError('Jos annat pelaajan iän, sen pitää olla 1–119 vuotta.');
    return must(await db().rpc('koutsi_bulk_setup_v2', {
      payload: { groups, players, themes, weeks_ahead: koutsiClampGroupTrainingWeeks(weeksAhead ?? KOUTSI_DEFAULT_GROUP_TRAINING_WEEKS) },
      coach_id_input: coachId || null,
    }));
  },
  async setLevel(studentId, level) {
    must(await from('koutsi_students').update({ level }).eq('id', studentId));
  },
  // Only for a player who hasn't claimed an account yet; afterwards name and age are player-owned.
  async updatePlaceholder(studentId, { name, age, level }) {
    if (age != null && !validAge(age)) throw new ApiError('Pelaajan iän pitää olla 1–119 vuotta.');
    const patch = {};
    if (name !== undefined) patch.display_name = name;
    if (age !== undefined) patch.age = age;
    if (level !== undefined) patch.level = level;
    if (Object.keys(patch).length === 0) return;
    must(await from('koutsi_students').update(patch).eq('id', studentId));
  },
  // Ends the relationship without destroying shared history; also leaves the coach's groups.
  async endCoaching(coachId, studentId) {
    const now = new Date().toISOString();
    must(await from('koutsi_coach_students').update({ ended_at: now }).eq('coach_id', coachId).eq('student_id', studentId));
    const groups = must(await from('koutsi_groups').select('id').eq('coach_id', coachId)) || [];
    const groupIds = groups.map((g) => g.id);
    if (groupIds.length) {
      must(await from('koutsi_group_members').update({ ended_at: now })
        .eq('student_id', studentId).in('group_id', groupIds).is('ended_at', null));
    }
  },
  async merge(coachId, keepStudentId, removeStudentId) {
    return must(await db().rpc('koutsi_merge_students', {
      coach_id_input: coachId || null, keep_student_id: keepStudentId, remove_student_id: removeStudentId,
    }));
  },
  // Server-side restricted to still-unclaimed placeholders.
  async deletePlaceholder(coachId, studentId) {
    must(await db().rpc('koutsi_delete_placeholder_student', { coach_id_input: coachId, student_id_input: studentId }));
  },
  async placeholderJoinCode(studentId) {
    return must(await db().rpc('koutsi_placeholder_join_code', { student_id_input: studentId }));
  },
};

export const groups = {
  async create(coachId, { name, level, day, time, durationMinutes, memberIds = [], weeksAhead }) {
    const duration = durationMinutes || 60;
    const data = must(await from('koutsi_groups')
      .insert({ coach_id: coachId, name, level, weekday: day, time, duration_minutes: duration }).select('id').single());
    if (memberIds.length > 0) {
      must(await from('koutsi_group_members').insert(memberIds.map((studentId) => ({ group_id: data.id, student_id: studentId }))));
    }
    await generateGroupTrainings(data.id, coachId, day, time, duration, null, weeksAhead);
    return data.id;
  },
  // Renaming doesn't touch the calendar. Moving the weekly slot drops and regenerates only
  // future sessions of the primary slot (extra slots keep their own series).
  async update(groupId, { name, level, day, time, durationMinutes, weeksAhead }) {
    const duration = durationMinutes || 60;
    const existing = must(await from('koutsi_groups').select('coach_id, weekday, time, duration_minutes').eq('id', groupId).single());
    must(await from('koutsi_groups').update({ name, level, weekday: day, time, duration_minutes: duration }).eq('id', groupId));
    const scheduleChanged = existing.weekday !== day
      || (existing.time || '').slice(0, 5) !== (time || '').slice(0, 5)
      || (existing.duration_minutes || 60) !== duration;
    if (!scheduleChanged) return;
    const today = koutsiTodayStr();
    const slots = must(await from('koutsi_group_slots').select('series_id').eq('group_id', groupId).not('series_id', 'is', null)) || [];
    const slotSeriesIds = slots.map((s) => s.series_id).filter(Boolean);
    let del = from('koutsi_trainings').delete().eq('group_id', groupId).gte('date', today);
    if (slotSeriesIds.length) del = del.not('series_id', 'in', `(${slotSeriesIds.join(',')})`);
    must(await del);
    await generateGroupTrainings(groupId, existing.coach_id, day, time, duration, today, weeksAhead);
  },
  // Sessions cascade with the group (and their attendance with them).
  async remove(groupId) {
    must(await from('koutsi_trainings').delete().eq('group_id', groupId));
    must(await from('koutsi_groups').delete().eq('id', groupId));
  },
  async addMembers(groupId, studentIds) {
    const rows = studentIds.map((studentId) => ({ group_id: groupId, student_id: studentId, ended_at: null }));
    must(await from('koutsi_group_members').upsert(rows, { onConflict: 'group_id,student_id' }));
  },
  async removeMember(groupId, studentId) {
    must(await from('koutsi_group_members').update({ ended_at: new Date().toISOString() }).eq('group_id', groupId).eq('student_id', studentId));
  },
  async addSlot({ groupId, coachId, day, time, durationMinutes, weeksAhead }) {
    const roundedTime = koutsiRoundTimeToQuarterHour(time);
    const duration = koutsiRoundToQuarterHourMinutes(durationMinutes || 60);
    const data = must(await from('koutsi_group_slots')
      .insert({ group_id: groupId, coach_id: coachId, weekday: day, time: roundedTime, duration_minutes: duration }).select('id').single());
    const { seriesId } = await generateGroupTrainings(groupId, coachId, day, roundedTime, duration, null, weeksAhead);
    if (seriesId) must(await from('koutsi_group_slots').update({ series_id: seriesId }).eq('id', data.id));
    return data.id;
  },
  // Deletes the slot and its not-yet-happened sessions; past ones keep their attendance.
  async deleteSlot(slotId) {
    const slot = must(await from('koutsi_group_slots').select('series_id').eq('id', slotId).maybeSingle());
    if (slot?.series_id) must(await from('koutsi_trainings').delete().eq('series_id', slot.series_id).gte('date', koutsiTodayStr()));
    must(await from('koutsi_group_slots').delete().eq('id', slotId));
  },
  /**
   * Continues a group's weekly sessions (primary slot and extra slots) up to `untilDate`,
   * skipping `skipDates`. Runs server-side so the players get one summary notification
   * instead of one per inserted session. Needs migration
   * 20261013120000_koutsi_extend_group_series; without it nothing is written.
   */
  async extendSeries(groupId, untilDate, skipDates = []) {
    const { data, error } = await db().rpc('koutsi_extend_group_series', {
      group_id_input: groupId, until_date: untilDate, skip_dates: skipDates,
    });
    if (error && isMissingFunction(error)) {
      throw new ApiError('Kalenterin jatkaminen otetaan käyttöön pian. Treenit eivät katoa — ne näkyvät kalenterissa niin kauan kuin ne on luotu.', { code: 'not_deployed' });
    }
    if (error) throw error;
    return data;
  },
};

export const themes = {
  // One upsert across any number of groups and weeks. `onlyNew` never replaces a row: for
  // writes the coach didn't explicitly agree to overwrite with. Resolves to rows written.
  async save(rows, { onlyNew = false } = {}) {
    const clean = (rows || [])
      .filter((r) => r.title && r.title.trim())
      .map((r) => ({ group_id: r.groupId, iso_year: r.year, iso_week: r.week, title: r.title.trim(), lead: (r.lead || '').trim() || null, updated_at: new Date().toISOString() }));
    if (clean.some((r) => r.title.length > KOUTSI_THEME_TITLE_MAX || (r.lead || '').length > KOUTSI_THEME_LEAD_MAX)) {
      throw new ApiError(`Viikkoteeman teksti on liian pitkä: teema enintään ${KOUTSI_THEME_TITLE_MAX} ja tarkennus enintään ${KOUTSI_THEME_LEAD_MAX} merkkiä.`);
    }
    if (clean.length === 0) return 0;
    if (onlyNew) {
      const data = must(await from('koutsi_group_themes')
        .upsert(clean, { onConflict: 'group_id,iso_year,iso_week', ignoreDuplicates: true }).select('id'));
      return (data || []).length;
    }
    must(await from('koutsi_group_themes').upsert(clean, { onConflict: 'group_id,iso_year,iso_week' }));
    return clean.length;
  },
  async remove(themeIds) {
    if (!themeIds || themeIds.length === 0) return;
    must(await from('koutsi_group_themes').delete().in('id', themeIds));
  },
};

export const trainings = {
  async add({ coachId, studentId, groupId, date, time, type, repeatUntil }) {
    const base = { coach_id: coachId, student_id: studentId || null, group_id: groupId || null, time, type };
    if (!repeatUntil || repeatUntil <= date) {
      must(await from('koutsi_trainings').insert({ ...base, date }));
      return 1;
    }
    const seriesId = randomUuid();
    const rows = koutsiWeeklyDates(date, repeatUntil).map((d) => ({ ...base, date: d, series_id: seriesId }));
    must(await from('koutsi_trainings').insert(rows));
    return rows.length;
  },
  async update(trainingId, { date, time, type }) {
    must(await from('koutsi_trainings').update({ date, time, type }).eq('id', trainingId));
  },
  // Time/type change for every not-yet-passed occurrence; dates stay.
  async updateSeries(seriesId, { time, type }, fromDate) {
    must(await from('koutsi_trainings').update({ time, type }).eq('series_id', seriesId).gte('date', fromDate || koutsiTodayStr()));
  },
  async remove(trainingId) {
    must(await from('koutsi_trainings').delete().eq('id', trainingId));
  },
  // "Poista kaikki tulevat" never reaches into the past.
  async removeSeries(seriesId, fromDate) {
    const today = koutsiTodayStr();
    const floor = !fromDate || fromDate < today ? today : fromDate;
    must(await from('koutsi_trainings').delete().eq('series_id', seriesId).gte('date', floor));
  },
  async countSeriesRemaining(seriesId, fromDate) {
    const { count, error } = await from('koutsi_trainings').select('id', { count: 'exact', head: true })
      .eq('series_id', seriesId).gte('date', fromDate || koutsiTodayStr());
    if (error) throw error;
    return count || 0;
  },
};

export const attendance = {
  // Presence is no row; "poissa" is a row. No reason is ever stored (health-data rule).
  async set(trainingIds, studentId, status) {
    const ids = [...new Set((trainingIds || []).filter(Boolean))];
    if (ids.length === 0) return;
    if (!['paikalla', 'poissa'].includes(status)) throw new ApiError('Pilotissa voi merkitä vain läsnäolon tai poissaolon.');
    if (status === 'paikalla') {
      must(await from('koutsi_training_absences').delete().eq('student_id', studentId).in('training_id', ids));
      return;
    }
    const rows = ids.map((trainingId) => ({ training_id: trainingId, student_id: studentId, reason: 'poissa', note: null }));
    must(await from('koutsi_training_absences').upsert(rows, { onConflict: 'training_id,student_id' }));
  },
};

export const notes = {
  async add(coachId, studentId, text) {
    must(await from('koutsi_diary_entries').insert({ coach_id: coachId, student_id: studentId, text }));
  },
  async update(entryId, text) {
    must(await from('koutsi_diary_entries').update({ text }).eq('id', entryId));
  },
  async remove(entryId) {
    must(await from('koutsi_diary_entries').delete().eq('id', entryId));
  },
};

export const homework = {
  async add(studentId, text) {
    must(await from('koutsi_homework').insert({ student_id: studentId, text }));
  },
  async update(homeworkId, text) {
    must(await from('koutsi_homework').update({ text }).eq('id', homeworkId));
  },
  async remove(homeworkId) {
    must(await from('koutsi_homework').delete().eq('id', homeworkId));
  },
  async toggleDone(homeworkId, done) {
    must(await from('koutsi_homework').update({ done, done_at: done ? new Date().toISOString() : null }).eq('id', homeworkId));
  },
};

export const events = {
  async add(coachId, { date, endDate, title, kind }) {
    must(await from('koutsi_coach_events').insert({ coach_id: coachId, date, end_date: endDate || null, title, kind: kind || 'seura' }));
  },
  async update(eventId, { date, endDate, title, kind }) {
    must(await from('koutsi_coach_events').update({ date, end_date: endDate || null, title, kind: kind || 'seura' }).eq('id', eventId));
  },
  async remove(eventId) {
    must(await from('koutsi_coach_events').delete().eq('id', eventId));
  },
};
