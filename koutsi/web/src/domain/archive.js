// archive.js — the player's own edit of their Kehitys: anything on the timeline can be moved to
// the archive. An archived item leaves the player's timeline and month calendar; the player sees it
// under "Arkisto", where it can be brought back or deleted.
//
// Rows (koutsi_timeline_archive) are keyed by the timeline event's id ("mood-<id>", "training-<id>",
// "goal-<id>" …). What the player made themselves leaves the coach's view of the player as well
// ("vain pelaajan nähtäviksi"); what the coach made (notes, homework, sessions, the coach's videos)
// stays in the coach's own records and only leaves the player's view.
//
//   archive: Map(key → { key, archivedAt, removedAt })  — removedAt = deleted from the archive
//   for an item the player cannot delete (the coach's); it then stays out of sight for good.

/** Was this event made by the player (so it is theirs to hide from coaches and to delete)? */
export function playerOwnsEvent(event) {
  switch (event.kind) {
    case 'mood': case 'match': case 'entry': return true;
    case 'goal': case 'wish': case 'note': return event.source?.byPlayer !== false;
    case 'video': return event.video?.addedBy === 'player';
    case 'training': return Boolean(event.own);
    default: return false;
  }
}

/** Keys the player's view hides: everything archived (and everything deleted from the archive). */
export function hiddenForPlayer(archive) {
  return new Set([...(archive?.keys?.() || [])]);
}

/** Keys the coach's view of the player hides: archived things the player made themselves. */
export function hiddenForCoach(archive, events) {
  if (!archive?.size) return new Set();
  return new Set(events.filter((e) => archive.has(e.id) && playerOwnsEvent(e)).map((e) => e.id));
}

/** The archive list: archived (not removed) events, newest archiving first. */
export function archivedEvents(archive, events) {
  if (!archive?.size) return [];
  return events
    .filter((e) => archive.has(e.id) && !archive.get(e.id).removedAt)
    .sort((a, b) => String(archive.get(b.id).archivedAt).localeCompare(String(archive.get(a.id).archivedAt)));
}

/**
 * What "Poista" does to an archived event: { action, id } — the player's own things are deleted
 * for good (action: 'mood' | 'match' | 'entry' | 'history' | 'training' | 'video'); the coach's
 * are only removed from the archive and stay hidden (action: 'forget').
 */
export function deletePlan(event) {
  if (!playerOwnsEvent(event)) return { action: 'forget', id: null };
  switch (event.kind) {
    case 'mood': return { action: 'mood', id: event.source.id };
    case 'match': return { action: 'match', id: event.source.id };
    case 'entry': return { action: 'entry', id: event.source.id };
    case 'goal': case 'wish': case 'note': return { action: 'history', id: event.source.id };
    case 'video': return { action: 'video', id: event.video.id };
    case 'training': return { action: 'training', id: event.trainingId };
    default: return { action: 'forget', id: null };
  }
}

/** The archive rows from the database (or the demo) as a Map. */
export function archiveMap(rows) {
  return new Map((rows || []).map((r) => [r.key, r]));
}

/**
 * The coach's copy of a player's data without what the player archived and made themselves:
 * moods, matches, own entries, goal / wish / note changes, the player's own videos and own
 * logged sessions. Returns { student, dropTrainingIds } — the caller drops those trainings.
 */
export function stripArchivedForCoach(student) {
  const keys = new Set((student.archive || []).map((a) => a.key));
  if (!keys.size) return { student, dropTrainingIds: new Set() };
  const keep = (prefix, byPlayerOnly = false) => (x) => !(keys.has(`${prefix}-${x.id}`) && (!byPlayerOnly || x.byPlayer !== false));
  const dropTrainingIds = new Set([...keys].filter((k) => k.startsWith('training-')).map((k) => k.slice('training-'.length)));
  return {
    student: {
      ...student,
      moods: (student.moods || []).filter(keep('mood')),
      matchNotes: (student.matchNotes || []).filter(keep('match')),
      entries: (student.entries || []).filter(keep('entry')),
      goalHistory: (student.goalHistory || []).filter(keep('goal', true)),
      longGoalHistory: (student.longGoalHistory || []).filter(keep('longgoal', true)),
      ambitionHistory: (student.ambitionHistory || []).filter(keep('aim', true)),
      wishHistory: (student.wishHistory || []).filter(keep('wish', true)),
      noteHistory: (student.noteHistory || []).filter(keep('note', true)),
      videos: (student.videos || []).filter((v) => !(v.addedBy === 'player' && keys.has(`video-${v.id}`))),
    },
    dropTrainingIds,
  };
}

/** A coach's state with every player's archived own things taken out (see stripArchivedForCoach). */
export function coachViewOfArchives(state) {
  const drop = new Set();
  const students = state.students.map((st) => {
    const { student, dropTrainingIds } = stripArchivedForCoach(st);
    dropTrainingIds.forEach((id) => drop.add(id));
    return student;
  });
  if (!drop.size && students.every((s, i) => s === state.students[i])) return state;
  // only the player's own logs go; a coach's session the player hid stays in the coach's records
  const trainings = state.trainings.filter((t) => !(drop.has(String(t.id)) && t.loggedBy === 'player'));
  return { ...state, students, trainings };
}
