// map.js — database rows → the state shapes in contract.js. Ported from the old Koutsi's
// mappers (lib/koutsi-data.js) so both apps read the same rows the same way. Differences:
// sub-lists (notes, homework, videos, moods) come out newest first — the old loader left
// them in database order, so "latest feedback" could show the oldest note.

import {
  koutsiSplitThemes, koutsiStudentAge, koutsiInitialOf, koutsiHueFromId,
  koutsiFmtShortDateFromTimestamp, koutsiTodayStr,
} from '../../domain/core.js';
import { SUPABASE_URL } from '../../lib/constants.js';

// profiles.avatar_url holds two formats: a storage path (Koutsi uploads) or a full URL
// (Krossi web). Both are accepted; a path resolves to the public profile-avatars bucket.
export function avatarUrl(path) {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return `${SUPABASE_URL}/storage/v1/object/public/profile-avatars/${path}`;
}

const newestFirst = (a, b) => String(b.at || '').localeCompare(String(a.at || ''));

export function mapGroup(g, memberIds, themeRows, slotRows) {
  const { themes, theme: current, upcomingThemes, pastThemes } = koutsiSplitThemes((themeRows || [])
    .filter((t) => t.group_id === g.id)
    .map((t) => ({ id: t.id, year: t.iso_year, week: t.iso_week, title: t.title, lead: t.lead || '' })));
  const slots = (slotRows || [])
    .filter((s) => s.group_id === g.id)
    .map((s) => ({ id: s.id, day: s.weekday, time: s.time ? s.time.slice(0, 5) : '', durationMinutes: s.duration_minutes || 60, seriesId: s.series_id || null }));
  return {
    id: g.id, coachId: g.coach_id, name: g.name, level: g.level, day: g.weekday, time: g.time ? g.time.slice(0, 5) : '',
    durationMinutes: g.duration_minutes || 60,
    memberIds,
    slots,
    themes,
    theme: current,
    upcomingThemes,
    pastThemes,
    annualPlan: g.annual_plan_filename ? {
      filename: g.annual_plan_filename,
      storagePath: g.annual_plan_storage_path || null,
      sizeBytes: g.annual_plan_size_bytes || null,
      // 'review' = sent to us and not yet in the system, 'published' = live
      status: g.annual_plan_status || 'published',
      date: g.annual_plan_uploaded_at ? g.annual_plan_uploaded_at.slice(0, 10) : koutsiTodayStr(),
    } : null,
  };
}

export function mapTraining(t, absencesByTraining) {
  return {
    id: t.id, date: t.date, time: t.time ? t.time.slice(0, 5) : '', type: t.type,
    durationMinutes: t.duration_minutes || null,
    loggedBy: t.logged_by || 'coach', notes: t.notes || '', endDate: t.end_date || null,
    studentId: t.student_id, groupId: t.group_id, coachId: t.coach_id, seriesId: t.series_id || null,
    absences: (absencesByTraining.get(t.id) || []).map((a) => ({
      studentId: a.student_id,
      reason: a.reason,
      note: a.note || '',
      reportedBy: a.reported_by || null,
      updatedAt: a.updated_at || a.created_at || null,
    })),
  };
}

export function mapExercise(e) {
  const hasVideo = Boolean(e.video_storage_path || e.video_external_url);
  return {
    id: e.id, coachId: e.coach_id, name: e.name, goal: e.goal, players: e.players_label,
    playerCount: e.player_count, duration: e.duration, level: e.level, tags: e.tags || [],
    video: hasVideo ? {
      title: e.video_title || e.name,
      storagePath: e.video_storage_path || null,
      externalUrl: e.video_external_url || null,
      mimeType: e.video_mime_type || null,
      sizeBytes: e.video_size_bytes || null,
    } : null,
  };
}

export function mapClubEvent(e) {
  return { id: e.id, date: e.date, endDate: e.end_date || null, title: e.title, kind: e.kind };
}

// One append-only table holds the goal, wish and note histories; the UI wants them apart.
function splitHistory(historyRows, studentId) {
  const mine = (historyRows || []).filter((h) => h.student_id === studentId)
    .map((h) => ({ id: h.id, at: h.created_at, field: h.field || 'goal', value: h.value || '', previousValue: h.previous_value || '', byPlayer: h.changed_by === studentId }))
    .sort(newestFirst);
  const of = (field) => mine.filter((h) => h.field === field);
  return { goalHistory: of('goal'), wishHistory: of('wish'), noteHistory: of('note'), longGoalHistory: of('long_goal'), ambitionHistory: of('ambition') };
}

export function mapStudent(studentRow, profileRow, rows) {
  const { diary = [], homework = [], videos = [], moods = [], matchNotes = [], history = [], entries = [], archive = [] } = rows;
  const id = studentRow.id;
  const age = koutsiStudentAge(studentRow, profileRow);
  const videoRecipients = new Map();
  for (const row of videos) {
    const shareId = row.share_id || row.id;
    const recipients = videoRecipients.get(shareId) || [];
    if (!recipients.includes(row.student_id)) recipients.push(row.student_id);
    videoRecipients.set(shareId, recipients);
  }
  const mine = (list) => list.filter((r) => r.student_id === id);
  return {
    id, initial: koutsiInitialOf(profileRow?.name || studentRow.display_name), hue: koutsiHueFromId(id),
    avatarUrl: avatarUrl(profileRow?.avatar_url),
    // A player the coach added by name has no profile until they claim it; the name then
    // comes from koutsi_students.display_name.
    name: profileRow?.name || studentRow.display_name || 'Pelaaja',
    isPlaceholder: Boolean(studentRow.placeholder_coach_id),
    ...age, level: studentRow.level,
    goal: studentRow.goal || '', lastSession: studentRow.last_session_note || '', focus: studentRow.focus || '',
    playerNote: studentRow.player_note || '', playerWish: studentRow.player_wish || '',
    ambition: studentRow.ambition || '', longGoal: studentRow.long_goal || '',
    joinedAt: studentRow.created_at || null,
    welcomeSeenAt: studentRow.welcome_seen_at || null,
    diary: mine(diary).map((d) => ({ id: d.id, at: d.created_at, date: koutsiFmtShortDateFromTimestamp(d.created_at), text: d.text })).sort(newestFirst),
    homework: mine(homework).map((h) => ({ id: h.id, at: h.created_at, doneAt: h.done_at || null, text: h.text, done: h.done })).sort(newestFirst),
    videos: mine(videos).map((v) => ({
      id: v.id,
      shareId: v.share_id || v.id,
      recipientIds: videoRecipients.get(v.share_id || v.id) || [v.student_id],
      at: v.created_at,
      title: v.title,
      hue: koutsiHueFromId(v.share_id || v.id),
      date: v.date,
      tags: v.tags || [],
      addedBy: v.added_by_id === id ? 'player' : 'coach',
      storagePath: v.storage_path || null,
      externalUrl: v.external_url || null,
      mimeType: v.mime_type || null,
      sizeBytes: v.size_bytes || null,
    })).sort(newestFirst),
    moods: mine(moods).map((m) => ({ id: m.id, at: m.created_at, date: koutsiFmtShortDateFromTimestamp(m.created_at), score: m.score, note: m.note || '', hiddenFromCoach: !!m.hidden_from_coach, trainingId: m.training_id || null })).sort(newestFirst),
    matchNotes: mine(matchNotes).map((n) => ({
      id: n.id, at: n.created_at, opponentName: n.opponent_name, date: n.date, note: n.note || '',
      durationMinutes: n.duration_minutes || null, result: n.result || null, format: n.format || null, score: n.score || '',
      partnerName: n.partner_name || '', opponent2Name: n.opponent2_name || '', tournamentId: n.tournament_id || null,
    })).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    ...splitHistory(history, id),
    // Newest day first; on the same day the latest written first.
    // Kehitys items the player moved to their archive (domain/archive.js), keyed by timeline id.
    archive: mine(archive).map((a) => ({ key: a.item_key, archivedAt: a.archived_at, removedAt: a.removed_at || null })),
    entries: mine(entries).map((e) => ({ id: e.id, at: e.created_at, date: e.date, text: e.text || '', how: e.how || '' }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.at).localeCompare(String(a.at))),
  };
}

export function mapCoach(coachRow, profileRow) {
  return {
    id: coachRow.id, initial: koutsiInitialOf(profileRow?.name), hue: koutsiHueFromId(coachRow.id),
    avatarUrl: avatarUrl(profileRow?.avatar_url),
    name: profileRow?.name || 'Valmentaja', tagline: coachRow.tagline || '', bio: coachRow.bio || '',
    experience: coachRow.experience || '', specialties: coachRow.specialties || [],
    welcomeSeenAt: coachRow.welcome_seen_at || null,
  };
}

/** Roster stubs the player sees of their group mates: never goals, notes or moods. */
export function mapRosterStub(row) {
  return {
    id: row.student_id,
    initial: koutsiInitialOf(row.name),
    hue: koutsiHueFromId(row.student_id),
    avatarUrl: avatarUrl(row.avatar_url),
    name: row.name || 'Pelaaja',
    level: row.level || null,
    rosterOnly: true,
  };
}

export function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows || []) {
    const k = row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

export function mapWeekNote(n) {
  return { id: n.id, year: n.iso_year, week: n.iso_week, score: n.score, note: n.note || '', updatedAt: n.updated_at || n.created_at || null };
}
