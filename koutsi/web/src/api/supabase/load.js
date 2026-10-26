// load.js — the coach's and the player's state snapshots.
//
// Same tables and the same nested shape as the old koutsiLoadCoachState /
// koutsiLoadStudentState, with three fixes that matter for a live pilot:
//   1. every sub-query's error is thrown — a failed absences query used to read as
//      "everyone was present", a failed members query as "empty group";
//   2. trainings are read page by page, so a coach past PostgREST's 1000-row cap does not
//      silently lose sessions;
//   3. `.in()` id lists are chunked so a long season cannot outgrow the request URL.

import { db, isMissingFunction, isMissingTable, must, selectAll, selectIn } from './client.js';
import { coachViewOfArchives } from '../../domain/archive.js';
import { koutsiAddDays, koutsiTodayStr } from '../../domain/core.js';
import { mapClubEvent, mapCoach, mapCoachVideo, mapExercise, mapGroup, mapRosterStub, mapSeason, mapSend, mapStudent, mapTraining, mapWeekNote, groupBy } from './map.js';

const fromTable = (table) => db().from(table);

async function loadAbsences(trainingIds) {
  const rows = await selectIn(trainingIds, (ids) => fromTable('koutsi_training_absences').select('*').in('training_id', ids));
  return groupBy(rows, 'training_id');
}

// The coach's own weekly diary. It is an addition: if its table isn't there yet (migration not
// run) or the read fails, the coach's app still opens, just without old entries.
async function loadWeekNotes(coachId) {
  const { data, error } = await fromTable('koutsi_coach_week_notes').select('*').eq('coach_id', coachId);
  if (error) {
    if (!isMissingTable(error)) console.warn('week notes unavailable:', error.message || error);
    return [];
  }
  return (data || []).map(mapWeekNote);
}

// A player's own logs are theirs, not one coach's: the row carries one coach_id (the table needs
// one), but every coach of the player sees it (RLS koutsi_trainings_linked_coach_reads_player_logs).
// This reads the ones written under the player's other coaches (policy applied 2026-10-21).
async function loadPlayerLogs(studentIds, coachId) {
  const ids = [...new Set(studentIds.filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const pages = await Promise.all(chunks.map((chunk) => selectAll(() => fromTable('koutsi_trainings').select('*')
    .in('student_id', chunk).eq('logged_by', 'player').neq('coach_id', coachId).order('date').order('id'))));
  return pages.flat();
}

// The player's own Kehitys entries, an addition like the week diary: without the table (migration not run)
// both apps open as before and `ready` keeps the Merkintä button hidden.
async function loadEntries(studentIds) {
  try {
    return { rows: await selectIn(studentIds, (ids) => fromTable('koutsi_player_entries').select('*').in('student_id', ids).order('date', { ascending: false })), ready: true };
  } catch (error) {
    if (!isMissingTable(error)) console.warn('player entries unavailable:', error?.message || error);
    return { rows: [], ready: false };
  }
}

// Columns added by supabase/migrations/20261021083503_koutsi_long_goal_and_mood_session.sql (applied
// 2026-10-21). On a database without them, the long-term goal stays hidden and only the latest session is asked "Miten meni?".
async function moodSessionsReady() {
  const { error } = await fromTable('koutsi_moods').select('training_id').limit(1);
  return !error;
}

// The player's Kehitys archive (koutsi_timeline_archive): what they moved off their timeline.
// Without the table both apps open as before and `archiveReady` keeps "Muokkaa" hidden.
async function loadArchive(studentIds) {
  try {
    return { rows: await selectIn(studentIds, (ids) => fromTable('koutsi_timeline_archive').select('*').in('student_id', ids)), ready: true };
  } catch (error) {
    if (!isMissingTable(error)) console.warn('timeline archive unavailable:', error?.message || error);
    return { rows: [], ready: false };
  }
}

// Tiedotteet (koutsi_announcements, supabase/migrations/20261023114724_koutsi_announcements.sql). An
// addition like the week diary: without the table both apps open as before and
// `announcementsReady` keeps the Tiedote choice hidden. RLS decides whose rows a player gets.
function mapAnnouncement(r) {
  return { id: r.id, coachId: r.coach_id, text: r.body, groupIds: r.group_ids || [], studentIds: r.student_ids || [], until: r.until, at: r.created_at };
}
async function loadAnnouncements(narrow) {
  const { data, error } = await narrow(fromTable('koutsi_announcements').select('id, coach_id, body, group_ids, student_ids, until, created_at'));
  if (error) {
    if (!isMissingTable(error)) console.warn('announcements unavailable:', error.message || error);
    return { rows: [], ready: !isMissingTable(error) };
  }
  return { rows: (data || []).map(mapAnnouncement), ready: true };
}

// Lähetetyt and the coach's own videos (koutsi/web/sql/20261026110000_koutsi_sends_and_video_library.sql).
// An addition like the week diary: without the tables the app opens as before and `sendsReady`
// keeps Lähetetyt, the Videot tab and "Omista videoista" hidden. The newest 1000 sendings are plenty
// for the page; a player's own copies (homework, notes, videos) are read with the players.
async function loadSends(coachId) {
  const [sends, videos] = await Promise.all([
    fromTable('koutsi_sends').select('*').eq('coach_id', coachId).order('created_at', { ascending: false }).limit(1000),
    fromTable('koutsi_coach_videos').select('*').eq('coach_id', coachId).order('created_at', { ascending: false }),
  ]);
  const error = sends.error || videos.error;
  if (error) {
    if (!isMissingTable(error)) console.warn('sends unavailable:', error.message || error);
    return { sends: [], videoLibrary: [], ready: false };
  }
  return { sends: (sends.data || []).map(mapSend), videoLibrary: (videos.data || []).map(mapCoachVideo), ready: true };
}

export async function loadCoachState(coachId) {
  const [coachRow, profileRow] = await Promise.all([
    fromTable('koutsi_coaches').select('id, tagline, bio, experience, specialties, welcome_seen_at').eq('id', coachId).single().then(must),
    fromTable('profiles').select('id, name, avatar_url, avatar_color, area').eq('id', coachId).maybeSingle().then(must),
  ]);

  const links = must(await fromTable('koutsi_coach_students').select('student_id').eq('coach_id', coachId).is('ended_at', null)) || [];
  const studentIds = links.map((l) => l.student_id);
  const byStudent = (table, order) => selectIn(studentIds, (ids) => {
    let q = fromTable(table).select('*').in('student_id', ids);
    if (order) q = q.order(order, { ascending: false });
    return q;
  });

  const [
    studentRows, studentProfiles, groupRows, exerciseRows, eventRows, ownTrainingRows, playerLogRows,
    diary, homework, videos, moods, matchNotes, history, weekNotes, entries, archive, seasons, notices, sent,
  ] = await Promise.all([
    selectIn(studentIds, (ids) => fromTable('koutsi_students').select('*').in('id', ids)),
    selectIn(studentIds, (ids) => fromTable('profiles').select('id, name, avatar_url, age, bio').in('id', ids)),
    fromTable('koutsi_groups').select('*').eq('coach_id', coachId).then(must),
    fromTable('koutsi_exercises').select('*').eq('coach_id', coachId).then(must),
    fromTable('koutsi_coach_events').select('*').eq('coach_id', coachId).then(must),
    selectAll(() => fromTable('koutsi_trainings').select('*').eq('coach_id', coachId).order('date').order('id')),
    loadPlayerLogs(studentIds, coachId),
    byStudent('koutsi_diary_entries', 'created_at'),
    byStudent('koutsi_homework', 'created_at'),
    byStudent('koutsi_videos', 'created_at'),
    // RLS withholds moods a player hid from their coach; nothing to filter here.
    byStudent('koutsi_moods', 'created_at'),
    byStudent('koutsi_match_notes', 'date'),
    byStudent('koutsi_player_history', 'created_at'),
    loadWeekNotes(coachId),
    loadEntries(studentIds),
    loadArchive(studentIds),
    loadCoachSeasons(coachId),
    // a month back is enough for Merkitse's list; Lähetetyt shows the ones the nightly prune keeps (60 pv)
    loadAnnouncements((q) => q.eq('coach_id', coachId).gte('until', koutsiAddDays(koutsiTodayStr(), -60)).order('created_at', { ascending: false })),
    loadSends(coachId),
  ]);

  const trainingRows = [...ownTrainingRows, ...playerLogRows];
  const groupIds = (groupRows || []).map((g) => g.id);
  const [memberRows, themeRows, slotRows, absencesByTraining] = await Promise.all([
    selectIn(groupIds, (ids) => fromTable('koutsi_group_members').select('group_id, student_id').in('group_id', ids).is('ended_at', null)),
    selectIn(groupIds, (ids) => fromTable('koutsi_group_themes').select('*').in('group_id', ids)),
    selectIn(groupIds, (ids) => fromTable('koutsi_group_slots').select('*').in('group_id', ids)),
    loadAbsences(trainingRows.map((t) => t.id)),
  ]);

  const profileById = new Map((studentProfiles || []).map((p) => [p.id, p]));
  const rows = { diary, homework, videos, moods, matchNotes, history, entries: entries.rows, archive: archive.rows };
  const membersByGroup = groupBy(memberRows, 'group_id');
  const coach = mapCoach(coachRow, profileRow);
  return coachViewOfArchives({
    coach,
    coaches: [coach],
    students: (studentRows || []).map((s) => mapStudent(s, profileById.get(s.id), rows)),
    groups: (groupRows || []).map((g) => mapGroup(g, (membersByGroup.get(g.id) || []).map((m) => m.student_id), themeRows, slotRows)),
    trainings: trainingRows.map((t) => mapTraining(t, absencesByTraining)),
    exercises: (exerciseRows || []).map(mapExercise),
    clubEvents: (eventRows || []).map(mapClubEvent),
    weekNotes,
    entriesReady: entries.ready,
    archiveReady: archive.ready,
    seasons: seasons.seasons,
    seasonDraft: seasons.draft,
    seasonsReady: seasons.ready,
    announcements: notices.rows,
    announcementsReady: notices.ready,
    sends: sent.sends,
    videoLibrary: sent.videoLibrary,
    sendsReady: sent.ready,
  });
}

// "Uusi kausi" (migration 20261026120000_koutsi_seasons): the coach's seasons, the unpublished
// draft and whether the feature is open for this account (koutsi_seasons_enabled — beta testers and
// admins first). Before the migration all three fall back quietly and the feature stays hidden.
async function loadCoachSeasons(coachId) {
  const [seasons, draft, enabled] = await Promise.all([
    fromTable('koutsi_seasons').select('*').eq('coach_id', coachId).order('starts_on'),
    fromTable('koutsi_season_drafts').select('draft, from_season_id').eq('coach_id', coachId).maybeSingle(),
    db().rpc('koutsi_seasons_enabled'),
  ]);
  if (seasons.error) {
    if (!isMissingTable(seasons.error)) console.warn('seasons unavailable:', seasons.error.message || seasons.error);
    return { seasons: [], draft: null, ready: false };
  }
  if (enabled.error && !isMissingFunction(enabled.error)) console.warn('season gate unavailable:', enabled.error.message || enabled.error);
  const row = draft.error ? null : draft.data;
  return {
    seasons: (seasons.data || []).map(mapSeason),
    draft: row ? { ...row.draft, fromSeasonId: row.from_season_id || row.draft?.fromSeasonId || null } : null,
    ready: !enabled.error && enabled.data === true,
  };
}

// The seasons of the player's groups (RLS: a member reads them), so the player's lists show the
// season that is on now. No gate: a coach who never made a season simply has none.
async function loadPlayerSeasons(groupRows) {
  const ids = [...new Set((groupRows || []).map((g) => g.season_id).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await fromTable('koutsi_seasons').select('*').in('id', ids);
  if (error) {
    if (!isMissingTable(error)) console.warn('seasons unavailable:', error.message || error);
    return [];
  }
  return (data || []).map(mapSeason);
}

export async function loadPlayerState(studentId) {
  const [studentRow, profileRow] = await Promise.all([
    fromTable('koutsi_students').select('*').eq('id', studentId).single().then(must),
    fromTable('profiles').select('id, name, avatar_url, avatar_color, age, bio, area').eq('id', studentId).maybeSingle().then(must),
  ]);

  const [coachLinks, memberRows] = await Promise.all([
    fromTable('koutsi_coach_students').select('coach_id').eq('student_id', studentId).is('ended_at', null).then(must),
    fromTable('koutsi_group_members').select('group_id').eq('student_id', studentId).is('ended_at', null).then(must),
  ]);
  const coachIds = (coachLinks || []).map((l) => l.coach_id);
  const groupIds = (memberRows || []).map((m) => m.group_id);
  const own = (table, order) => {
    let q = fromTable(table).select('*').eq('student_id', studentId);
    if (order) q = q.order(order, { ascending: false });
    return q.then(must);
  };

  const [
    coachRows, coachProfiles, groupRows, rosterRows, themeRows, slotRows, exerciseRows, eventRows,
    ownTrainings, groupTrainings, diary, homework, videos, moods, matchNotes, history, entries, moodSessions, archive, notices,
  ] = await Promise.all([
    selectIn(coachIds, (ids) => fromTable('koutsi_coaches').select('*').in('id', ids)),
    selectIn(coachIds, (ids) => fromTable('profiles').select('id, name, avatar_url').in('id', ids)),
    selectIn(groupIds, (ids) => fromTable('koutsi_groups').select('*').in('id', ids)),
    groupIds.length ? db().rpc('koutsi_player_group_roster').then(must) : [],
    selectIn(groupIds, (ids) => fromTable('koutsi_group_themes').select('*').in('group_id', ids)),
    selectIn(groupIds, (ids) => fromTable('koutsi_group_slots').select('*').in('group_id', ids)),
    selectIn(coachIds, (ids) => fromTable('koutsi_exercises').select('*').in('coach_id', ids)),
    selectIn(coachIds, (ids) => fromTable('koutsi_coach_events').select('*').in('coach_id', ids)),
    selectAll(() => fromTable('koutsi_trainings').select('*').eq('student_id', studentId).order('date').order('id')),
    groupIds.length ? selectAll(() => fromTable('koutsi_trainings').select('*').in('group_id', groupIds).order('date').order('id')) : [],
    own('koutsi_diary_entries', 'created_at'),
    own('koutsi_homework', 'created_at'),
    own('koutsi_videos', 'created_at'),
    own('koutsi_moods', 'created_at'),
    own('koutsi_match_notes', 'date'),
    own('koutsi_player_history', 'created_at'),
    loadEntries([studentId]),
    moodSessionsReady(),
    loadArchive([studentId]),
    loadAnnouncements((q) => q.gte('until', koutsiTodayStr()).order('created_at', { ascending: false })),
  ]);

  const trainingRows = [...ownTrainings, ...groupTrainings.filter((t) => !ownTrainings.some((o) => o.id === t.id))];
  const [absencesByTraining, seasons] = await Promise.all([loadAbsences(trainingRows.map((t) => t.id)), loadPlayerSeasons(groupRows)]);

  const coachProfileById = new Map((coachProfiles || []).map((p) => [p.id, p]));
  const coaches = (coachRows || []).map((c) => mapCoach(c, coachProfileById.get(c.id)));
  const rosterByGroup = groupBy(rosterRows || [], 'group_id');
  const me = mapStudent(studentRow, profileRow, { diary, homework, videos, moods, matchNotes, history, entries: entries.rows, archive: archive.rows });

  // Roster rows are intentionally sparse: the RPC never returns goals, notes or moods.
  const rosterById = new Map();
  for (const row of (rosterRows || [])) {
    if (row.student_id === studentId || rosterById.has(row.student_id)) continue;
    rosterById.set(row.student_id, mapRosterStub(row));
  }

  return {
    coach: coaches[0] || null,
    coaches,
    students: [me, ...rosterById.values()],
    groups: (groupRows || []).map((g) => mapGroup(g, (rosterByGroup.get(g.id) || []).map((m) => m.student_id), themeRows, slotRows)),
    trainings: trainingRows.map((t) => mapTraining(t, absencesByTraining)),
    exercises: (exerciseRows || []).map(mapExercise),
    clubEvents: (eventRows || []).map(mapClubEvent),
    entriesReady: entries.ready,
    moodSessionsReady: moodSessions,
    archiveReady: archive.ready,
    longGoalReady: 'long_goal' in studentRow,
    tennisProfileReady: 'plays_hand' in studentRow,
    seasons,
    announcements: notices.rows,
    announcementsReady: notices.ready,
  };
}
