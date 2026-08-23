// koutsi-data.js — real Supabase-backed data layer for the Koutsi app (koutsi.krossi.app).
// Exposes the same window.koutsiXxx helper names the UI (koutsi-valmentaja-app.jsx /
// koutsi-pelaaja-app.jsx) already calls, but backed by the shared Supabase project
// (see lib/koutsi-auth.jsx for the client + auth gate) instead of localStorage.
// The sales demo loads this file first and then lets lib/koutsi-demo-backend.jsx overwrite
// the Supabase-backed functions below with in-memory ones, so the demo and the real app run
// the very same UI code.
//
// The load functions below assemble one nested `state` shape
// ({coach, coaches, students, groups, trainings, exercises, clubEvents}) that both the UI
// and the demo backend build against — which is what lets that swap go unnoticed.

// ── deterministic display helpers (not persisted — purely cosmetic) ───────
function koutsiHueFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
function koutsiInitialOf(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }
function koutsiRandomUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── date + lookup helpers — pure, operate only on the assembled state ─────
function koutsiPad(n) { return String(n).padStart(2, '0'); }
function koutsiTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${koutsiPad(d.getMonth() + 1)}-${koutsiPad(d.getDate())}`;
}
const KOUTSI_WEEKDAYS = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
const KOUTSI_WEEKDAYS_LONG = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'];
const KOUTSI_MONTHS = ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu', 'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'];

function koutsiDateFromStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function koutsiFmtShortDate(dateStr) {
  const dt = koutsiDateFromStr(dateStr);
  return `${KOUTSI_WEEKDAYS[dt.getDay()]} ${dt.getDate()}.${dt.getMonth() + 1}.`;
}
function koutsiFmtLongDate(dateStr) {
  const dt = koutsiDateFromStr(dateStr);
  return `${KOUTSI_WEEKDAYS_LONG[dt.getDay()]} ${dt.getDate()}. ${KOUTSI_MONTHS[dt.getMonth()]}ta`;
}
// created_at is a full timestamptz — diary/mood entries only ever display the date part.
function koutsiFmtShortDateFromTimestamp(ts) { return koutsiFmtShortDate(ts.slice(0, 10)); }

// ── ISO weeks ────────────────────────────────────────────────
// Weekly themes are keyed by ISO week (Mon-first, the week a Finnish coach means when
// they say "vko 34"), not by a date range, so the same theme keeps showing all week and
// a term can be planned months ahead.
function koutsiIsoWeekOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;          // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);  // Thursday decides which year the week is in
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}
function koutsiCurrentIsoWeek() { return koutsiIsoWeekOf(new Date()); }
function koutsiIsoWeekOfDateStr(dateStr) { return koutsiIsoWeekOf(koutsiDateFromStr(dateStr)); }
// Monday of the given ISO week, as a local Date.
function koutsiIsoWeekStart(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayNum = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayNum + 1 + (week - 1) * 7);
  return new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
}
function koutsiWeeksInIsoYear(year) { return koutsiIsoWeekOf(new Date(year, 11, 28)).week; }
// n may be negative; rolls over the year boundary the way the calendar does.
function koutsiAddIsoWeeks({ year, week }, n) {
  const monday = koutsiIsoWeekStart(year, week);
  monday.setDate(monday.getDate() + n * 7);
  return koutsiIsoWeekOf(monday);
}
function koutsiIsoWeekKey({ year, week }) { return `${year}-${koutsiPad(week)}`; }
// "18.8.–24.8." — the dates make an abstract week number concrete on a coach's screen.
function koutsiIsoWeekRangeLabel(year, week) {
  const start = koutsiIsoWeekStart(year, week);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.getDate()}.${start.getMonth() + 1}.–${end.getDate()}.${end.getMonth() + 1}.`;
}
function koutsiCompareIsoWeeks(a, b) { return a.year - b.year || a.week - b.week; }

function koutsiStudentById(state, id) { return state.students.find((s) => s.id === id) || null; }
function koutsiGroupById(state, id) { return state.groups.find((g) => g.id === id) || null; }
function koutsiGroupForStudent(state, studentId) { return state.groups.find((g) => g.memberIds.includes(studentId)) || null; }
function koutsiGroupsForStudent(state, studentId) { return state.groups.filter((g) => g.memberIds.includes(studentId)); }
// The theme of the week a given training falls in — not today's. A coach opening a
// session three weeks out must see the theme they planned for that week.
function koutsiThemeForDate(group, dateStr) {
  if (!group) return null;
  const w = koutsiIsoWeekOfDateStr(dateStr);
  return (group.themes || []).find((t) => t.year === w.year && t.week === w.week) || null;
}
function koutsiCoachById(state, id) { return state.coaches.find((c) => c.id === id) || null; }

function koutsiTrainingParty(state, training) {
  if (training.groupId != null) {
    const group = koutsiGroupById(state, training.groupId);
    const members = group ? group.memberIds.map((id) => koutsiStudentById(state, id)).filter(Boolean) : [];
    return { kind: 'group', group, members };
  }
  return { kind: 'student', student: koutsiStudentById(state, training.studentId) };
}
function koutsiTrainingsForStudent(state, studentId) {
  const groups = koutsiGroupsForStudent(state, studentId);
  const groupIds = groups.map((g) => g.id);
  return state.trainings
    .filter((t) => t.studentId === studentId || (t.groupId != null && groupIds.includes(t.groupId)))
    .slice()
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
function koutsiUpcomingTrainingsForStudent(state, studentId) {
  const today = koutsiTodayStr();
  return koutsiTrainingsForStudent(state, studentId).filter((t) => t.date >= today);
}
function koutsiTrainingsForGroup(state, groupId) {
  return state.trainings.filter((t) => t.groupId === groupId).slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
function koutsiTrainingsOnDate(state, dateStr) {
  return state.trainings.filter((t) => t.date === dateStr).slice().sort((a, b) => a.time.localeCompare(b.time));
}
function koutsiTrainingsOnDateForStudent(state, dateStr, studentId) {
  const groupIds = koutsiGroupsForStudent(state, studentId).map((g) => g.id);
  return koutsiTrainingsOnDate(state, dateStr).filter((t) => t.studentId === studentId || (t.groupId != null && groupIds.includes(t.groupId)));
}
function koutsiClubEventsOnDate(state, dateStr) {
  return (state.clubEvents || []).filter((e) => e.date === dateStr);
}
function koutsiUpcomingClubEvents(state) {
  const today = koutsiTodayStr();
  return (state.clubEvents || []).filter((e) => e.date >= today).slice().sort((a, b) => a.date.localeCompare(b.date));
}

const KOUTSI_LEVEL_COLORS = {
  aloitt: { bg: 'rgba(214,140,44,0.14)', fg: '#8a5a12', border: 'rgba(214,140,44,0.35)' },
  keski: { bg: 'rgba(58,130,212,0.12)', fg: '#2a5d94', border: 'rgba(58,130,212,0.32)' },
  edist: { bg: 'rgba(148,88,214,0.12)', fg: '#6a389c', border: 'rgba(148,88,214,0.32)' },
  kilpa: { bg: 'rgba(180,205,20,0.22)', fg: '#5c6b06', border: 'rgba(180,205,20,0.55)' },
};
function koutsiLevelColor(level) {
  const l = (level || '').toLowerCase();
  const key = Object.keys(KOUTSI_LEVEL_COLORS).find((k) => l.includes(k));
  return key ? KOUTSI_LEVEL_COLORS[key] : { bg: '#f4f2ec', fg: '#6b665c', border: '#d8d4ca' };
}

const KOUTSI_TAG_LABELS = { syotto: 'Syöttö', liikkuminen: 'Liikkuminen', pistepeli: 'Pistepeli', verkkopeli: 'Verkkopeli', tekniikka: 'Tekniikka', lammittely: 'Lämmittely' };
const KOUTSI_TAGS = ['syotto', 'liikkuminen', 'pistepeli', 'verkkopeli', 'tekniikka', 'lammittely'];
const KOUTSI_ABSENCE_REASON_LABELS = { poissa: 'Poissa' };
const KOUTSI_ATTENDANCE_STATUS_LABELS = { paikalla: 'Paikalla', ...KOUTSI_ABSENCE_REASON_LABELS };

// ── row -> UI-shape mappers ─────────────────────────────────
// `themes` is every week the coach has planned; `theme` is whichever one is live today,
// so every screen written against the old single-theme shape keeps working unchanged.
function koutsiMapGroup(g, memberIds, themeRows) {
  const themes = (themeRows || [])
    .filter((t) => t.group_id === g.id)
    .map((t) => ({ id: t.id, year: t.iso_year, week: t.iso_week, title: t.title, lead: t.lead || '' }))
    .sort(koutsiCompareIsoWeeks);
  const now = koutsiCurrentIsoWeek();
  const current = themes.find((t) => t.year === now.year && t.week === now.week) || null;
  return {
    id: g.id, coachId: g.coach_id, name: g.name, level: g.level, day: g.weekday, time: g.time ? g.time.slice(0, 5) : '',
    memberIds,
    themes,
    theme: current,
    upcomingThemes: themes.filter((t) => koutsiCompareIsoWeeks(t, now) > 0),
    annualPlan: g.annual_plan_filename ? {
      filename: g.annual_plan_filename,
      storagePath: g.annual_plan_storage_path || null,
      sizeBytes: g.annual_plan_size_bytes || null,
      // 'review' = sent to us and not yet in the system (the beta hand-off), 'published' = live
      status: g.annual_plan_status || 'published',
      date: g.annual_plan_uploaded_at ? g.annual_plan_uploaded_at.slice(0, 10) : koutsiTodayStr(),
    } : null,
  };
}
function koutsiMapTraining(t, absenceRows) {
  return {
    id: t.id, date: t.date, time: t.time ? t.time.slice(0, 5) : '', type: t.type,
    studentId: t.student_id, groupId: t.group_id, coachId: t.coach_id, seriesId: t.series_id || null,
    absences: absenceRows.filter((a) => a.training_id === t.id).map((a) => ({
      studentId: a.student_id,
      reason: a.reason,
      note: a.note || '',
      reportedBy: a.reported_by || null,
      updatedAt: a.updated_at || a.created_at || null,
    })),
  };
}
function koutsiMapExercise(e) {
  return { id: e.id, coachId: e.coach_id, name: e.name, goal: e.goal, players: e.players_label, playerCount: e.player_count, duration: e.duration, level: e.level, tags: e.tags || [] };
}
function koutsiMapCoachEvent(e) { return { id: e.id, date: e.date, title: e.title, kind: e.kind }; }
// `at` on each sub-record is the raw ISO timestamp the Kehitys timeline sorts and groups
// by; `date` stays the pre-formatted label the older list views already render.
function koutsiMapStudent(studentRow, profileRow, diaryRows, homeworkRows, videoRows, moodRows, matchNoteRows, historyRows) {
  const videoRecipients = new Map();
  for (const row of videoRows) {
    const shareId = row.share_id || row.id;
    const recipients = videoRecipients.get(shareId) || [];
    if (!recipients.includes(row.student_id)) recipients.push(row.student_id);
    videoRecipients.set(shareId, recipients);
  }
  return {
    id: studentRow.id, initial: koutsiInitialOf(profileRow?.name || studentRow.display_name), hue: koutsiHueFromId(studentRow.id),
    avatarUrl: koutsiAvatarUrl(profileRow?.avatar_url),
    // Valmentajan nimellä lisäämällä pelaajalla ei ole profiilia ennen kuin hän
    // lunastaa sen; nimi tulee silloin koutsi_students.display_name-kentästä.
    name: profileRow?.name || studentRow.display_name || 'Pelaaja',
    isPlaceholder: Boolean(studentRow.placeholder_coach_id),
    age: studentRow.age, level: studentRow.level,
    goal: studentRow.goal || '', lastSession: studentRow.last_session_note || '', focus: studentRow.focus || '',
    playerNote: studentRow.player_note || '', playerWish: studentRow.player_wish || '',
    joinedAt: studentRow.created_at || null,
    diary: diaryRows.filter((d) => d.student_id === studentRow.id).map((d) => ({ id: d.id, at: d.created_at, date: koutsiFmtShortDateFromTimestamp(d.created_at), text: d.text })),
    homework: homeworkRows.filter((h) => h.student_id === studentRow.id).map((h) => ({ id: h.id, at: h.created_at, doneAt: h.done_at || null, text: h.text, done: h.done })),
    videos: videoRows.filter((v) => v.student_id === studentRow.id).map((v) => ({
      id: v.id,
      shareId: v.share_id || v.id,
      recipientIds: videoRecipients.get(v.share_id || v.id) || [v.student_id],
      at: v.created_at,
      title: v.title,
      hue: koutsiHueFromId(v.share_id || v.id),
      date: v.date,
      tags: v.tags || [],
      addedBy: v.added_by_id === studentRow.id ? 'player' : 'coach',
      storagePath: v.storage_path || null,
      externalUrl: v.external_url || null,
      mimeType: v.mime_type || null,
      sizeBytes: v.size_bytes || null,
    })),
    moods: moodRows.filter((m) => m.student_id === studentRow.id).map((m) => ({ id: m.id, at: m.created_at, date: koutsiFmtShortDateFromTimestamp(m.created_at), score: m.score, note: m.note || '', hiddenFromCoach: !!m.hidden_from_coach })),
    matchNotes: (matchNoteRows || []).filter((n) => n.student_id === studentRow.id).map((n) => ({ id: n.id, at: n.created_at, opponentName: n.opponent_name, date: n.date, note: n.note || '' })),
    ...koutsiSplitHistory(historyRows, studentRow.id),
  };
}
// One append-only table holds the goal, wish and note histories; the UI wants them apart.
function koutsiSplitHistory(historyRows, studentId) {
  const mine = (historyRows || []).filter((h) => h.student_id === studentId)
    .map((h) => ({ id: h.id, at: h.created_at, field: h.field || 'goal', value: h.value || '', previousValue: h.previous_value || '', byPlayer: h.changed_by === studentId }))
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const of = (field) => mine.filter((h) => h.field === field);
  return { goalHistory: of('goal'), wishHistory: of('wish'), noteHistory: of('note') };
}
function koutsiMapCoach(coachRow, profileRow) {
  return {
    id: coachRow.id, initial: koutsiInitialOf(profileRow?.name), hue: koutsiHueFromId(coachRow.id),
    avatarUrl: koutsiAvatarUrl(profileRow?.avatar_url),
    name: profileRow?.name || 'Valmentaja', tagline: coachRow.tagline || '', bio: coachRow.bio || '',
    experience: coachRow.experience || '', specialties: coachRow.specialties || [],
  };
}

// ── role lookup — used by each app's root gate before loading full state ──
async function koutsiFetchCoachRow(uid) {
  const { data, error } = await koutsiSupabase.from('koutsi_coaches').select('id').eq('id', uid).maybeSingle();
  if (error) throw error;
  return data;
}
async function koutsiFetchStudentRow(uid) {
  const { data, error } = await koutsiSupabase.from('koutsi_students').select('id').eq('id', uid).maybeSingle();
  if (error) throw error;
  return data;
}
async function koutsiFetchCoachLinksForStudent(uid) {
  const { data, error } = await koutsiSupabase.from('koutsi_coach_students').select('coach_id').eq('student_id', uid).is('ended_at', null);
  if (error) throw error;
  return data || [];
}

// ── full state loaders ──────────────────────────────────────
async function koutsiLoadCoachState(coachId) {
  const [{ data: coachRow, error: coachErr }, { data: profileRow }] = await Promise.all([
    koutsiSupabase.from('koutsi_coaches').select('id, tagline, bio, experience, specialties').eq('id', coachId).single(),
    koutsiSupabase.from('profiles').select('id, name, avatar_url, avatar_color').eq('id', coachId).maybeSingle(),
  ]);
  if (coachErr) throw coachErr;

  const { data: links, error: linksErr } = await koutsiSupabase.from('koutsi_coach_students').select('student_id').eq('coach_id', coachId).is('ended_at', null);
  if (linksErr) throw linksErr;
  const studentIds = (links || []).map((l) => l.student_id);

  const [
    { data: studentRows }, { data: studentProfiles },
    { data: groupRows }, { data: exerciseRows }, { data: eventRows }, { data: trainingRows },
    { data: diaryRows }, { data: homeworkRows }, { data: videoRows }, { data: moodRows }, { data: matchNoteRows }, { data: historyRows },
  ] = await Promise.all([
    studentIds.length ? koutsiSupabase.from('koutsi_students').select('*').in('id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length ? koutsiSupabase.from('profiles').select('id, name, avatar_url').in('id', studentIds) : Promise.resolve({ data: [] }),
    koutsiSupabase.from('koutsi_groups').select('*').eq('coach_id', coachId),
    koutsiSupabase.from('koutsi_exercises').select('*').eq('coach_id', coachId),
    koutsiSupabase.from('koutsi_coach_events').select('*').eq('coach_id', coachId),
    koutsiSupabase.from('koutsi_trainings').select('*').eq('coach_id', coachId),
    studentIds.length ? koutsiSupabase.from('koutsi_diary_entries').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length ? koutsiSupabase.from('koutsi_homework').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length ? koutsiSupabase.from('koutsi_videos').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length ? koutsiSupabase.from('koutsi_moods').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length ? koutsiSupabase.from('koutsi_match_notes').select('*').in('student_id', studentIds).order('date', { ascending: false }) : Promise.resolve({ data: [] }),
    studentIds.length ? koutsiSupabase.from('koutsi_player_history').select('*').in('student_id', studentIds).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
  ]);

  const groupIds = (groupRows || []).map((g) => g.id);
  const [{ data: memberRows }, { data: themeRows }] = groupIds.length
    ? await Promise.all([
      koutsiSupabase.from('koutsi_group_members').select('group_id, student_id').in('group_id', groupIds).is('ended_at', null),
      koutsiSupabase.from('koutsi_group_themes').select('*').in('group_id', groupIds),
    ])
    : [{ data: [] }, { data: [] }];
  const trainingIds = (trainingRows || []).map((t) => t.id);
  const { data: absenceRows } = trainingIds.length
    ? await koutsiSupabase.from('koutsi_training_absences').select('*').in('training_id', trainingIds)
    : { data: [] };

  const profileByStudentId = new Map((studentProfiles || []).map((p) => [p.id, p]));
  const students = (studentRows || []).map((s) => koutsiMapStudent(s, profileByStudentId.get(s.id), diaryRows || [], homeworkRows || [], videoRows || [], moodRows || [], matchNoteRows || [], historyRows || []));
  const groups = (groupRows || []).map((g) => koutsiMapGroup(g, (memberRows || []).filter((m) => m.group_id === g.id).map((m) => m.student_id), themeRows || []));
  const trainings = (trainingRows || []).map((t) => koutsiMapTraining(t, absenceRows || []));
  const coach = koutsiMapCoach(coachRow, profileRow);

  return { coach, coaches: [coach], students, groups, trainings, exercises: (exerciseRows || []).map(koutsiMapExercise), clubEvents: (eventRows || []).map(koutsiMapCoachEvent) };
}

async function koutsiLoadStudentState(studentId) {
  const [{ data: studentRow, error: studentErr }, { data: profileRow }] = await Promise.all([
    koutsiSupabase.from('koutsi_students').select('*').eq('id', studentId).single(),
    koutsiSupabase.from('profiles').select('id, name, avatar_url, avatar_color').eq('id', studentId).maybeSingle(),
  ]);
  if (studentErr) throw studentErr;

  const [{ data: coachLinks, error: linksErr }, { data: memberRows, error: memberErr }] = await Promise.all([
    koutsiSupabase.from('koutsi_coach_students').select('coach_id').eq('student_id', studentId).is('ended_at', null),
    koutsiSupabase.from('koutsi_group_members').select('group_id').eq('student_id', studentId).is('ended_at', null),
  ]);
  if (linksErr) throw linksErr;
  if (memberErr) throw memberErr;
  const coachIds = (coachLinks || []).map((l) => l.coach_id);
  const groupIds = (memberRows || []).map((m) => m.group_id);

  const [
    { data: coachRows }, { data: coachProfiles },
    { data: groupRows }, { data: rosterRows, error: rosterErr }, { data: themeRows },
    { data: exerciseRows }, { data: eventRows },
    { data: individualTrainingRows }, { data: groupTrainingRows },
    { data: diaryRows }, { data: homeworkRows }, { data: videoRows }, { data: moodRows }, { data: matchNoteRows }, { data: historyRows },
  ] = await Promise.all([
    coachIds.length ? koutsiSupabase.from('koutsi_coaches').select('*').in('id', coachIds) : Promise.resolve({ data: [] }),
    coachIds.length ? koutsiSupabase.from('profiles').select('id, name, avatar_url').in('id', coachIds) : Promise.resolve({ data: [] }),
    groupIds.length ? koutsiSupabase.from('koutsi_groups').select('*').in('id', groupIds) : Promise.resolve({ data: [] }),
    groupIds.length ? koutsiSupabase.rpc('koutsi_player_group_roster') : Promise.resolve({ data: [] }),
    groupIds.length ? koutsiSupabase.from('koutsi_group_themes').select('*').in('group_id', groupIds) : Promise.resolve({ data: [] }),
    coachIds.length ? koutsiSupabase.from('koutsi_exercises').select('*').in('coach_id', coachIds) : Promise.resolve({ data: [] }),
    coachIds.length ? koutsiSupabase.from('koutsi_coach_events').select('*').in('coach_id', coachIds) : Promise.resolve({ data: [] }),
    koutsiSupabase.from('koutsi_trainings').select('*').eq('student_id', studentId),
    groupIds.length ? koutsiSupabase.from('koutsi_trainings').select('*').in('group_id', groupIds) : Promise.resolve({ data: [] }),
    koutsiSupabase.from('koutsi_diary_entries').select('*').eq('student_id', studentId),
    koutsiSupabase.from('koutsi_homework').select('*').eq('student_id', studentId),
    koutsiSupabase.from('koutsi_videos').select('*').eq('student_id', studentId),
    koutsiSupabase.from('koutsi_moods').select('*').eq('student_id', studentId),
    koutsiSupabase.from('koutsi_match_notes').select('*').eq('student_id', studentId).order('date', { ascending: false }),
    koutsiSupabase.from('koutsi_player_history').select('*').eq('student_id', studentId).order('created_at', { ascending: false }),
  ]);
  if (rosterErr) throw rosterErr;

  const trainingRows = [...(individualTrainingRows || []), ...(groupTrainingRows || [])];
  const trainingIds = trainingRows.map((t) => t.id);
  const { data: absenceRows } = trainingIds.length
    ? await koutsiSupabase.from('koutsi_training_absences').select('*').in('training_id', trainingIds)
    : { data: [] };

  const coachProfileById = new Map((coachProfiles || []).map((p) => [p.id, p]));
  const coaches = (coachRows || []).map((c) => koutsiMapCoach(c, coachProfileById.get(c.id)));
  const groups = (groupRows || []).map((g) => koutsiMapGroup(g, (rosterRows || []).filter((m) => m.group_id === g.id).map((m) => m.student_id), themeRows || []));
  const trainings = trainingRows.map((t) => koutsiMapTraining(t, absenceRows || []));
  const student = koutsiMapStudent(studentRow, profileRow, diaryRows || [], homeworkRows || [], videoRows || [], moodRows || [], matchNoteRows || [], historyRows || []);

  // Roster rows are intentionally sparse. The RPC never returns goals, notes, moods or
  // other coaching data, and keeping the stubs sparse prevents a future group-card change
  // from accidentally rendering a field that the player was never authorised to read.
  const rosterById = new Map();
  for (const row of (rosterRows || [])) {
    if (row.student_id === studentId || rosterById.has(row.student_id)) continue;
    rosterById.set(row.student_id, {
      id: row.student_id,
      initial: koutsiInitialOf(row.name),
      hue: koutsiHueFromId(row.student_id),
      avatarUrl: koutsiAvatarUrl(row.avatar_url),
      name: row.name || 'Pelaaja',
      level: row.level || null,
      rosterOnly: true,
    });
  }

  return { coach: coaches[0] || null, coaches, students: [student, ...rosterById.values()], groups, trainings, exercises: (exerciseRows || []).map(koutsiMapExercise), clubEvents: (eventRows || []).map(koutsiMapCoachEvent) };
}

// ── error text ───────────────────────────────────────────────
// Supabase and Postgres speak English and mention table names; a coach standing on court
// should not. Anything unrecognised falls back to a generic Finnish sentence rather than
// leaking the raw message.
const KOUTSI_ERROR_PATTERNS = [
  [/invalid login credentials/i, 'Sähköposti tai salasana ei täsmää.'],
  [/email not confirmed/i, 'Vahvista ensin sähköpostiosoitteesi vahvistusviestin linkistä.'],
  [/user already registered|already been registered/i, 'Tällä sähköpostilla on jo tili. Kirjaudu sisään.'],
  [/password should be at least|password is too short/i, 'Salasanan pitää olla vähintään 8 merkkiä.'],
  [/(new )?password should be different/i, 'Uusi salasana ei voi olla sama kuin vanha.'],
  [/for security purposes|rate limit|too many requests/i, 'Liian monta yritystä. Odota hetki ja yritä uudelleen.'],
  [/invalid invite code/i, 'Koodia ei löytynyt. Tarkista kirjoitusasu.'],
  [/invite code has expired/i, 'Koodi on vanhentunut. Pyydä valmentajalta uusi.'],
  [/invite code has been revoked/i, 'Koodi on poistettu käytöstä. Pyydä valmentajalta uusi.'],
  [/invite code has reached its use limit/i, 'Koodi on jo käytetty. Pyydä valmentajalta uusi.'],
  [/authentication required/i, 'Istuntosi on vanhentunut. Kirjaudu sisään uudelleen.'],
  [/not a coach/i, 'Tiliäsi ei ole liitetty valmentajaksi.'],
  [/Anna pelaajalle nimi/i, 'Anna pelaajalle nimi.'],
  [/Tätä profiilia ei voi lunastaa/i, 'Tätä profiilia ei voi lunastaa. Pyydä valmentajalta uusi koodi.'],
  [/own coach code/i, 'Tämä on oma valmentajakoodisi. Anna se pelaajalle — sinun ei tarvitse liittyä itse.'],
  // Turvaverkko: jos koodipolku joskus ohittaisi tarkistuksen, tietokannan
  // CHECK (coach_id <> student_id) kaatuisi raakana käyttöliittymään.
  [/koutsi_coach_students_check/i, 'Tämä on oma valmentajakoodisi. Anna se pelaajalle — sinun ei tarvitse liittyä itse.'],
  [/invalid coach key/i, 'Väärä valmentaja-avain.'],
  [/coach key has expired/i, 'Valmentaja-avain on vanhentunut.'],
  [/coach key has been revoked/i, 'Valmentaja-avain on poistettu käytöstä.'],
  [/coach key has already been used/i, 'Valmentaja-avain on jo käytetty.'],
  [/profile required/i, 'Luo ensin profiilisi.'],
  [/not a coach/i, 'Tiliäsi ei ole liitetty valmentajaksi.'],
  [/duplicate key|already exists/i, 'Tämä on jo olemassa.'],
  [/violates foreign key/i, 'Kohdetta ei löytynyt — se on ehkä juuri poistettu.'],
  [/video share not found/i, 'Videojakoa ei enää löytynyt. Päivitä näkymä.'],
  [/choose at least one recipient/i, 'Valitse vähintään yksi pelaaja.'],
  [/recipient is not linked to this coach/i, 'Valittu pelaaja ei ole enää valmennuksessasi. Päivitä näkymä.'],
  [/aikuisten beta-pilotissa|rajattu vähintään 18-vuotiaille/i, 'Koutsi-beta on rajattu vähintään 18-vuotiaille, eikä terveystietoja tallenneta.'],
  [/poissaolon syytä ei tallenneta/i, 'Beta-pilotissa poissaolosta tallennetaan vain poissa-merkintä, ei syytä.'],
  [/cannot delete your own admin account/i, 'Et voi poistaa omaa ylläpitäjätiliäsi tästä näkymästä.'],
  [/cannot delete an administrator/i, 'Ylläpitäjätiliä ei voi poistaa tästä näkymästä.'],
  [/user not found/i, 'Käyttäjää ei enää löytynyt. Päivitä näkymä.'],
  [/violates row-level security|permission denied|not allowed/i, 'Sinulla ei ole oikeutta tähän.'],
  [/payload too large|exceeded the maximum allowed size/i, 'Tiedosto on liian suuri.'],
  [/mime type .* is not supported|invalid_mime_type/i, 'Tätä tiedostotyyppiä ei tueta.'],
  [/failed to fetch|network|networkerror/i, 'Yhteysvirhe. Tarkista verkkoyhteys ja yritä uudelleen.'],
  [/jwt expired|invalid claim|session.*expired/i, 'Istunto vanheni. Kirjaudu uudelleen sisään.'],
];
function koutsiErrorText(err, fallback) {
  const raw = typeof err === 'string' ? err : (err?.message || err?.error_description || '');
  if (!raw) return fallback || 'Jokin meni pieleen. Yritä uudelleen.';
  const hit = KOUTSI_ERROR_PATTERNS.find(([re]) => re.test(raw));
  if (hit) return hit[1];
  // Errors raised by our own SQL are already written in Finnish; pass those through.
  if (/[äöÄÖ]/.test(raw)) return raw;
  return fallback || 'Jokin meni pieleen. Yritä uudelleen.';
}

// ── mutations — each writes to Supabase; the caller reloads state afterwards ──
async function koutsiAddDiaryEntry(coachId, studentId, text) {
  const { error } = await koutsiSupabase.from('koutsi_diary_entries').insert({ coach_id: coachId, student_id: studentId, text });
  if (error) throw error;
}
async function koutsiUpdateDiaryEntry(entryId, text) {
  const { error } = await koutsiSupabase.from('koutsi_diary_entries').update({ text }).eq('id', entryId);
  if (error) throw error;
}
async function koutsiDeleteDiaryEntry(entryId) {
  const { error } = await koutsiSupabase.from('koutsi_diary_entries').delete().eq('id', entryId);
  if (error) throw error;
}
async function koutsiToggleHomeworkDone(homeworkId, done) {
  const { error } = await koutsiSupabase.from('koutsi_homework')
    .update({ done, done_at: done ? new Date().toISOString() : null }).eq('id', homeworkId);
  if (error) throw error;
}
async function koutsiAddHomework(studentId, text) {
  const { error } = await koutsiSupabase.from('koutsi_homework').insert({ student_id: studentId, text });
  if (error) throw error;
}
async function koutsiUpdateHomework(homeworkId, text) {
  const { error } = await koutsiSupabase.from('koutsi_homework').update({ text }).eq('id', homeworkId);
  if (error) throw error;
}
async function koutsiDeleteHomework(homeworkId) {
  const { error } = await koutsiSupabase.from('koutsi_homework').delete().eq('id', homeworkId);
  if (error) throw error;
}

// ── trainings ────────────────────────────────────────────────
// A one-off session and a weekly series are the same rows; a series just shares a
// series_id, so "muokkaa/poista koko sarja" is a filter rather than a second table.
const KOUTSI_WEEKDAY_TO_INDEX = { su: 0, ma: 1, ti: 2, ke: 3, to: 4, pe: 5, la: 6 };
function koutsiAddDays(dateStr, days) {
  const d = koutsiDateFromStr(dateStr);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${koutsiPad(d.getMonth() + 1)}-${koutsiPad(d.getDate())}`;
}
// Weekly occurrences from `date` up to and including `untilDate` (capped so a mistyped
// end date can never write thousands of rows).
function koutsiWeeklyDates(date, untilDate, maxCount = 60) {
  const dates = [];
  let cur = date;
  while (cur <= untilDate && dates.length < maxCount) {
    dates.push(cur);
    cur = koutsiAddDays(cur, 7);
  }
  return dates;
}
async function koutsiAddTraining({ coachId, studentId, groupId, date, time, type, repeatUntil }) {
  const base = { coach_id: coachId, student_id: studentId, group_id: groupId, time, type };
  if (!repeatUntil || repeatUntil <= date) {
    const { error } = await koutsiSupabase.from('koutsi_trainings').insert({ ...base, date });
    if (error) throw error;
    return 1;
  }
  const seriesId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const rows = koutsiWeeklyDates(date, repeatUntil).map((d) => ({ ...base, date: d, series_id: seriesId }));
  const { error } = await koutsiSupabase.from('koutsi_trainings').insert(rows);
  if (error) throw error;
  return rows.length;
}
async function koutsiUpdateTraining(trainingId, { date, time, type }) {
  const { error } = await koutsiSupabase.from('koutsi_trainings').update({ date, time, type }).eq('id', trainingId);
  if (error) throw error;
}
// Applies a time/type change to every not-yet-passed occurrence of the series. Dates are
// deliberately left alone: shifting a whole series to one date makes no sense.
async function koutsiUpdateTrainingSeries(seriesId, { time, type }, fromDate) {
  const { error } = await koutsiSupabase.from('koutsi_trainings')
    .update({ time, type })
    .eq('series_id', seriesId)
    .gte('date', fromDate || koutsiTodayStr());
  if (error) throw error;
}
async function koutsiDeleteTraining(trainingId) {
  const { error } = await koutsiSupabase.from('koutsi_trainings').delete().eq('id', trainingId);
  if (error) throw error;
}
async function koutsiDeleteTrainingSeries(seriesId, fromDate) {
  const { error } = await koutsiSupabase.from('koutsi_trainings')
    .delete()
    .eq('series_id', seriesId)
    .gte('date', fromDate || koutsiTodayStr());
  if (error) throw error;
}
async function koutsiCountSeriesRemaining(seriesId, fromDate) {
  const { count, error } = await koutsiSupabase.from('koutsi_trainings')
    .select('id', { count: 'exact', head: true })
    .eq('series_id', seriesId)
    .gte('date', fromDate || koutsiTodayStr());
  if (error) throw error;
  return count || 0;
}

// ── videos ───────────────────────────────────────────────────
// A shared video is either an uploaded file or an external link. The file is stored once
// under the uploader's own folder and referenced by one koutsi_videos row per recipient —
// storage RLS authorises reads through those rows, not through the folder name.
const KOUTSI_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const KOUTSI_VIDEO_TUS_CHUNK_BYTES = 6 * 1024 * 1024;
async function koutsiUploadVideoFile(uploaderId, shareId, file, onProgress) {
  if (file.size > KOUTSI_VIDEO_MAX_BYTES) {
    throw new Error(`Video on liian suuri (${Math.round(file.size / 1048576)} Mt). Tiedostolatauksen raja on 50 Mt — jaa pitkä video linkkinä.`);
  }
  const mimeType = file.type || 'video/mp4';
  const mimeExtensions = {
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'video/x-m4v': 'm4v', 'video/mpeg': 'mpeg',
  };
  const fileExtension = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  const ext = mimeExtensions[mimeType] || fileExtension || 'mp4';
  const path = `${uploaderId}/${shareId}.${ext}`;
  const reportProgress = typeof onProgress === 'function' ? onProgress : () => {};
  reportProgress(0);

  // Files larger than one TUS chunk go straight from the browser to Supabase's dedicated
  // Storage host. The static Koutsi/Vercel app never proxies or buffers the video. TUS can
  // retry individual 6 MiB chunks and resume the same modal's upload after an interruption.
  if (file.size > KOUTSI_VIDEO_TUS_CHUNK_BYTES && window.tus?.Upload && window.tus.isSupported !== false) {
    const { data: { session }, error: sessionError } = await koutsiSupabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session?.access_token) throw new Error('Kirjaudu uudelleen ennen videon lataamista.');

    const projectId = new URL(window.KOUTSI_SUPABASE_URL).hostname.split('.')[0];
    await new Promise((resolve, reject) => {
      const upload = new window.tus.Upload(file, {
        endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          authorization: `Bearer ${session.access_token}`,
          apikey: window.KOUTSI_SUPABASE_ANON_KEY,
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        fingerprint: () => Promise.resolve(`koutsi-video-${uploaderId}-${shareId}-${file.name}-${file.size}-${file.lastModified}`),
        metadata: {
          bucketName: 'koutsi-videos',
          objectName: path,
          contentType: mimeType,
          cacheControl: '3600',
        },
        chunkSize: KOUTSI_VIDEO_TUS_CHUNK_BYTES,
        onError: reject,
        onProgress: (uploadedBytes, totalBytes) => {
          reportProgress(totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0);
        },
        onSuccess: resolve,
      });
      upload.findPreviousUploads()
        .then((previousUploads) => {
          if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
          upload.start();
        })
        .catch(reject);
    });
    reportProgress(100);
    return { path, mimeType, sizeBytes: file.size };
  }

  // Small clips keep the simpler SDK request. It is still a direct browser-to-Storage
  // upload; the fallback also keeps uploads working if the optional TUS script is blocked.
  const { error } = await koutsiSupabase.storage.from('koutsi-videos').upload(path, file, {
    contentType: mimeType, cacheControl: '3600', upsert: false,
  });
  if (error) throw error;
  reportProgress(100);
  return { path, mimeType, sizeBytes: file.size };
}
async function koutsiShareVideo({ shareId, title, date, tags, studentIds, addedById, file, externalUrl, onProgress }) {
  const resolvedShareId = shareId || koutsiRandomUuid();
  let uploaded = null;
  if (file) uploaded = await koutsiUploadVideoFile(addedById, resolvedShareId, file, onProgress);
  const rows = studentIds.map((studentId) => ({
    share_id: resolvedShareId, student_id: studentId, added_by_id: addedById, title, date, tags,
    storage_path: uploaded ? uploaded.path : null,
    mime_type: uploaded ? uploaded.mimeType : null,
    size_bytes: uploaded ? uploaded.sizeBytes : null,
    external_url: externalUrl || null,
  }));
  const { error } = await koutsiSupabase.from('koutsi_videos').insert(rows);
  if (error) {
    // don't leave the object behind if the rows that authorise it never landed
    if (uploaded) {
      const { error: cleanupErr } = await koutsiSupabase.storage.from('koutsi-videos').remove([uploaded.path]);
      if (cleanupErr) {
        throw new Error(`${error.message}; videotiedoston siivous epäonnistui: ${cleanupErr.message}`);
      }
    }
    throw error;
  }
}
async function koutsiSetVideoRecipients(shareId, studentIds) {
  const { error } = await koutsiSupabase.rpc('koutsi_set_video_recipients', {
    share_id_input: shareId,
    student_ids_input: studentIds,
  });
  if (error) throw error;
}
// Signed URL — the bucket is private, so this is how playback and download happen.
async function koutsiVideoUrl(storagePath, expiresSeconds = 3600) {
  if (!storagePath) return null;
  const { data, error } = await koutsiSupabase.storage.from('koutsi-videos').createSignedUrl(storagePath, expiresSeconds);
  if (error) throw error;
  return data.signedUrl;
}
async function koutsiDeleteVideo(videoId, _storagePath) {
  const { data: video, error: readErr } = await koutsiSupabase.from('koutsi_videos').select('*').eq('id', videoId).maybeSingle();
  if (readErr) throw readErr;
  if (!video) return;

  // Use only the path read back under RLS; a caller-supplied path must never choose a
  // different object for deletion.
  const path = video.storage_path || null;
  let referenceCount = 0;
  if (path) {
    const { count, error: countErr } = await koutsiSupabase.from('koutsi_videos')
      .select('id', { count: 'exact', head: true }).eq('storage_path', path);
    if (countErr) throw countErr;
    referenceCount = count || 0;
  }

  const { error } = await koutsiSupabase.from('koutsi_videos').delete().eq('id', videoId);
  if (error) throw error;
  if (!path || referenceCount > 1) return;

  // The object is shared between recipients. Remove it only with the final row, and put
  // that row back if Storage rejects the delete so the object never becomes an orphan.
  const { error: storageErr } = await koutsiSupabase.storage.from('koutsi-videos').remove([path]);
  if (!storageErr) return;
  const { error: rollbackErr } = await koutsiSupabase.from('koutsi_videos').insert(video);
  if (rollbackErr) {
    throw new Error(`${storageErr.message}; videorivin palautus epäonnistui: ${rollbackErr.message}`);
  }
  throw storageErr;
}

// ── attendance ───────────────────────────────────────────────
// Saves an explicit status for one or several sessions in one request. Presence remains
// represented by no absence row, keeping old attendance history backwards compatible.
async function koutsiSetAttendance(trainingIds, studentId, status, note) {
  const ids = [...new Set((trainingIds || []).filter(Boolean))];
  if (ids.length === 0) return;
  if (!['paikalla', 'poissa'].includes(status)) throw new Error('Beta-pilotissa voi merkitä vain läsnäolon tai poissaolon.');
  if (status === 'paikalla') {
    const { error } = await koutsiSupabase.from('koutsi_training_absences')
      .delete().eq('student_id', studentId).in('training_id', ids);
    if (error) throw error;
    return;
  }
  const rows = ids.map((trainingId) => ({
    training_id: trainingId,
    student_id: studentId,
    reason: status,
    note: null,
  }));
  const { error } = await koutsiSupabase.from('koutsi_training_absences')
    .upsert(rows, { onConflict: 'training_id,student_id' });
  if (error) throw error;
}

// Cycles a member's status for one training: paikalla → poissa → paikalla.
// A legacy `vamma` value is cleared to present on the next click.
async function koutsiCycleAbsence(trainingId, studentId, currentReason) {
  const next = !currentReason ? 'poissa' : 'paikalla';
  await koutsiSetAttendance([trainingId], studentId, next, '');
}

// ── students ─────────────────────────────────────────────────
async function koutsiSetStudentLevel(studentId, level) {
  const { error } = await koutsiSupabase.from('koutsi_students').update({ level }).eq('id', studentId);
  if (error) throw error;
}
// Ends the coaching relationship without destroying the shared history: the student keeps
// their diary and the coach keeps their records, the link just stops being active.
async function koutsiEndCoaching(coachId, studentId) {
  const { error } = await koutsiSupabase.from('koutsi_coach_students')
    .update({ ended_at: new Date().toISOString() })
    .eq('coach_id', coachId).eq('student_id', studentId);
  if (error) throw error;
  // an ex-student should not stay on the coach's group rosters either
  const { data: groups } = await koutsiSupabase.from('koutsi_groups').select('id').eq('coach_id', coachId);
  const groupIds = (groups || []).map((g) => g.id);
  if (groupIds.length) {
    await koutsiSupabase.from('koutsi_group_members')
      .update({ ended_at: new Date().toISOString() })
      .eq('student_id', studentId).in('group_id', groupIds).is('ended_at', null);
  }
}

// ── groups ───────────────────────────────────────────────────
async function koutsiCreateGroup({ coachId, name, level, day, time, memberIds }) {
  const { data, error } = await koutsiSupabase.from('koutsi_groups').insert({ coach_id: coachId, name, level, weekday: day, time }).select('id').single();
  if (error) throw error;
  if (memberIds.length > 0) {
    const { error: memberErr } = await koutsiSupabase.from('koutsi_group_members').insert(memberIds.map((studentId) => ({ group_id: data.id, student_id: studentId })));
    if (memberErr) throw memberErr;
  }
  return data.id;
}
async function koutsiUpdateGroup(groupId, { name, level, day, time }) {
  const { error } = await koutsiSupabase.from('koutsi_groups').update({ name, level, weekday: day, time }).eq('id', groupId);
  if (error) throw error;
}
// Trainings booked for the group are deleted along with it, so the players' calendars do
// not keep showing sessions for a group that no longer exists.
async function koutsiDeleteGroup(groupId) {
  const { error: tErr } = await koutsiSupabase.from('koutsi_trainings').delete().eq('group_id', groupId);
  if (tErr) throw tErr;
  const { error } = await koutsiSupabase.from('koutsi_groups').delete().eq('id', groupId);
  if (error) throw error;
}
async function koutsiAddGroupMembers(groupId, studentIds) {
  const rows = studentIds.map((studentId) => ({ group_id: groupId, student_id: studentId, ended_at: null }));
  const { error } = await koutsiSupabase.from('koutsi_group_members').upsert(rows, { onConflict: 'group_id,student_id' });
  if (error) throw error;
}
async function koutsiRemoveGroupMember(groupId, studentId) {
  const { error } = await koutsiSupabase.from('koutsi_group_members')
    .update({ ended_at: new Date().toISOString() })
    .eq('group_id', groupId).eq('student_id', studentId);
  if (error) throw error;
}
// ── weekly themes ────────────────────────────────────────────
// Saved as a batch: the coach plans a run of weeks in one editor and presses Tallenna
// once, so a half-saved term is not a state the UI can land in.
async function koutsiSaveThemes(groupId, rows) {
  const clean = (rows || [])
    .filter((r) => r.title && r.title.trim())
    .map((r) => ({ group_id: groupId, iso_year: r.year, iso_week: r.week, title: r.title.trim(), lead: (r.lead || '').trim() || null, updated_at: new Date().toISOString() }));
  if (clean.length === 0) return 0;
  const { error } = await koutsiSupabase.from('koutsi_group_themes').upsert(clean, { onConflict: 'group_id,iso_year,iso_week' });
  if (error) throw error;
  return clean.length;
}
async function koutsiDeleteTheme(themeId) {
  const { error } = await koutsiSupabase.from('koutsi_group_themes').delete().eq('id', themeId);
  if (error) throw error;
}
// Removes every theme the coach dropped from the editor in one round trip.
async function koutsiDeleteThemes(themeIds) {
  if (!themeIds || themeIds.length === 0) return;
  const { error } = await koutsiSupabase.from('koutsi_group_themes').delete().in('id', themeIds);
  if (error) throw error;
}

// ── annual plan ──────────────────────────────────────────────
const KOUTSI_PLAN_MAX_BYTES = 20 * 1024 * 1024;
async function koutsiUploadAnnualPlan(groupId, file) {
  if (file.size > KOUTSI_PLAN_MAX_BYTES) {
    throw new Error(`Tiedosto on liian suuri (${Math.round(file.size / 1048576)} Mt). Enimmäiskoko on 20 Mt.`);
  }
  const { data: prev, error: prevErr } = await koutsiSupabase.from('koutsi_groups')
    .select('id, annual_plan_filename, annual_plan_storage_path, annual_plan_size_bytes, annual_plan_uploaded_at, annual_plan_status')
    .eq('id', groupId).maybeSingle();
  if (prevErr) throw prevErr;
  if (!prev) throw new Error('Ryhmää ei löytynyt.');

  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().slice(0, 5);
  // Reuse the existing key on replacement. Storage upsert then changes the object in
  // place instead of allocating a second key that could be orphaned between two APIs.
  const path = prev.annual_plan_storage_path || `${groupId}/${crypto.randomUUID ? crypto.randomUUID() : Date.now()}.${ext}`;
  const { error: upErr } = await koutsiSupabase.storage.from('koutsi-plans').upload(path, file, {
    contentType: file.type || 'application/pdf', upsert: Boolean(prev.annual_plan_storage_path),
  });
  if (upErr) throw upErr;
  const { error } = await koutsiSupabase.from('koutsi_groups').update({
    annual_plan_filename: file.name,
    annual_plan_storage_path: path,
    annual_plan_size_bytes: file.size,
    annual_plan_uploaded_at: new Date().toISOString(),
    // beta: the upload hands the file to us for review, it does not publish it
    annual_plan_status: 'review',
  }).eq('id', groupId).select('id').single();
  if (error) {
    // An upsert reused the already referenced key, so it cannot create an orphan. A
    // first upload has no metadata yet and must be removed explicitly on failure.
    if (!prev.annual_plan_storage_path) {
      const { error: cleanupErr } = await koutsiSupabase.storage.from('koutsi-plans').remove([path]);
      if (cleanupErr) throw new Error(`${error.message}; uuden vuosisuunnitelman siivous epäonnistui: ${cleanupErr.message}`);
    }
    throw error;
  }
}
async function koutsiAnnualPlanUrl(storagePath, expiresSeconds = 3600) {
  if (!storagePath) return null;
  const { data, error } = await koutsiSupabase.storage.from('koutsi-plans').createSignedUrl(storagePath, expiresSeconds);
  if (error) throw error;
  return data.signedUrl;
}
async function koutsiRemoveAnnualPlan(groupId, _storagePath) {
  const { data: prev, error: prevErr } = await koutsiSupabase.from('koutsi_groups')
    .select('id, annual_plan_filename, annual_plan_storage_path, annual_plan_size_bytes, annual_plan_uploaded_at, annual_plan_status')
    .eq('id', groupId).maybeSingle();
  if (prevErr) throw prevErr;
  if (!prev) throw new Error('Ryhmää ei löytynyt.');

  const { error } = await koutsiSupabase.from('koutsi_groups').update({
    annual_plan_filename: null, annual_plan_storage_path: null,
    annual_plan_size_bytes: null, annual_plan_uploaded_at: null,
    annual_plan_status: 'review',
  }).eq('id', groupId).select('id').single();
  if (error) throw error;
  // As with videos, the server-authorised row is the only source of the object key.
  const path = prev.annual_plan_storage_path || null;
  if (!path) return;

  const { error: storageErr } = await koutsiSupabase.storage.from('koutsi-plans').remove([path]);
  if (!storageErr) return;

  // Keep metadata and Storage in agreement if deletion is denied or interrupted.
  const { error: rollbackErr } = await koutsiSupabase.from('koutsi_groups').update({
    annual_plan_filename: prev.annual_plan_filename,
    annual_plan_storage_path: prev.annual_plan_storage_path,
    annual_plan_size_bytes: prev.annual_plan_size_bytes,
    annual_plan_uploaded_at: prev.annual_plan_uploaded_at,
    annual_plan_status: prev.annual_plan_status,
  }).eq('id', groupId);
  if (rollbackErr) {
    throw new Error(`${storageErr.message}; vuosisuunnitelman metatietojen palautus epäonnistui: ${rollbackErr.message}`);
  }
  throw storageErr;
}

// ── exercises ────────────────────────────────────────────────
async function koutsiAddExercise({ coachId, name, goal, players, playerCount, duration, level, tags }) {
  const { error } = await koutsiSupabase.from('koutsi_exercises').insert({ coach_id: coachId, name, goal, players_label: players, player_count: playerCount, duration, level, tags });
  if (error) throw error;
}
async function koutsiUpdateExercise(exerciseId, { name, goal, players, playerCount, duration, level, tags }) {
  const { error } = await koutsiSupabase.from('koutsi_exercises')
    .update({ name, goal, players_label: players, player_count: playerCount, duration, level, tags })
    .eq('id', exerciseId);
  if (error) throw error;
}
async function koutsiDeleteExercise(exerciseId) {
  const { error } = await koutsiSupabase.from('koutsi_exercises').delete().eq('id', exerciseId);
  if (error) throw error;
}
// Re-copies any starter exercise the coach has since deleted. Returns how many landed.
async function koutsiSeedExercises(coachId = null) {
  const { data, error } = await koutsiSupabase.rpc('koutsi_seed_exercises', { target_coach: coachId || null });
  if (error) throw error;
  return data || 0;
}

// ── invite codes ─────────────────────────────────────────────
// Minted server-side: the code is guaranteed unique and always carries an expiry and a
// use limit, which a browser-generated code never did.
// coachId annetaan vain kun ylläpitäjä toimii toisen valmentajan näkymässä; muuten
// funktio lukee kohteen kutsujan omasta istunnosta, kuten ennenkin.
async function koutsiCreateInviteCode(groupId, { expiresDays = 14, maxUses = 1, coachId = null } = {}) {
  const { data, error } = await koutsiSupabase.rpc('create_koutsi_invite_code', {
    group_id_input: groupId || null, expires_days: expiresDays, max_uses_input: maxUses,
    coach_id_input: coachId || null,
  });
  if (error) throw error;
  return data;
}
async function koutsiListInviteCodes(coachId) {
  const { data, error } = await koutsiSupabase.from('koutsi_group_invite_codes')
    .select('code, group_id, expires_at, max_uses, use_count, revoked_at, created_at')
    .eq('coach_id', coachId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const now = new Date();
  return (data || []).map((c) => ({
    code: c.code, groupId: c.group_id, createdAt: c.created_at,
    expiresAt: c.expires_at, maxUses: c.max_uses, useCount: c.use_count, revokedAt: c.revoked_at,
    active: !c.revoked_at
      && (!c.expires_at || new Date(c.expires_at) > now)
      && (c.max_uses == null || c.use_count < c.max_uses),
  }));
}
async function koutsiRevokeInviteCode(code) {
  const { error } = await koutsiSupabase.from('koutsi_group_invite_codes')
    .update({ revoked_at: new Date().toISOString() }).eq('code', code);
  if (error) throw error;
}
// Valmentajan PYSYVÄ liittymiskoodi. Yksi per valmentaja, ei vanhene eikä kulu.
// RLS päästää vain omaan riviin, joten tämä palauttaa aina kutsujan oman koodin.
async function koutsiMyJoinCode(coachId) {
  const { data, error } = await koutsiSupabase
    .from('koutsi_coach_join_codes').select('code').eq('coach_id', coachId).maybeSingle();
  if (error) throw error;
  return data?.code || null;
}
// ── nimellä lisätty pelaaja ja sen lunastus ───────────────────────────
// Valmentaja voi luoda pelaajan pelkällä nimellä ilman että pelaajan tarvitsee
// tehdä tiliä. Pelaaja lunastaa profiilin myöhemmin valmentajan koodilla,
// jolloin kaikki siihen asti kirjattu työ seuraa mukana.
async function koutsiCreatePlayer(name, age, level, coachId = null) {
  if (!Number.isInteger(age) || age < 18) throw new Error('Koutsi-beta on rajattu vähintään 18-vuotiaille.');
  const { data, error } = await koutsiSupabase.rpc('koutsi_create_player', {
    name_input: name, age_input: age ?? null, level_input: level || null,
    coach_id_input: coachId || null,
  });
  if (error) throw error;
  return data;
}
// The guided setup is one RPC instead of a browser-side chain of inserts. That keeps
// players, new/existing groups, memberships and weekly themes atomic: either the whole
// reviewed setup is stored or none of it is.
async function koutsiBulkSetup({ coachId = null, groups = [], players = [], themes = [] }) {
  if (players.some((player) => !Number.isInteger(player.age) || player.age < 18)) {
    throw new Error('Koutsi-beta on rajattu vähintään 18-vuotiaille.');
  }
  const { data, error } = await koutsiSupabase.rpc('koutsi_bulk_setup', {
    payload: { groups, players, themes },
    coach_id_input: coachId || null,
  });
  if (error) throw error;
  return data;
}
async function koutsiUnclaimedPlayers(code) {
  const { data, error } = await koutsiSupabase.rpc('koutsi_unclaimed_players', { code_input: code });
  if (error) throw error;
  return data || [];
}
async function koutsiClaimPlayer(code, studentId) {
  const { data, error } = await koutsiSupabase.rpc('koutsi_claim_player', {
    code_input: code, student_id_input: studentId,
  });
  if (error) throw error;
  return data;
}
async function koutsiRedeemInviteCode(code) {
  const { data, error } = await koutsiSupabase.rpc('redeem_koutsi_invite_code', { code_input: code });
  if (error) throw error;
  return data;
}
async function koutsiRedeemCoachKey(key) {
  const { data, error } = await koutsiSupabase.rpc('redeem_koutsi_coach_key', { key_input: key });
  if (error) throw error;
  return data;
}
// The link a coach actually sends. Prefilling the code is the difference between the
// player tapping once and the coach dictating six characters over the phone.
function koutsiInviteLink(code) {
  return `https://koutsi.krossi.app/pelaaja?koodi=${encodeURIComponent(code)}`;
}
function koutsiInviteMessage(code, coachName, groupName) {
  const who = coachName ? `${coachName} täällä` : 'Moi';
  const where = groupName ? ` ryhmään ${groupName}` : '';
  return `${who}! Otetaan Krossi Koutsi käyttöön — sieltä näet treenit, kotiläksyt ja palautteet. Suljettu beta on vain vähintään 18-vuotiaille, eikä Koutsiin kirjata terveystietoja.\n\nLiity${where} tästä: ${koutsiInviteLink(code)}\n\n(Jos linkki ei aukea, mene osoitteeseen koutsi.krossi.app/pelaaja ja syötä koodi ${code}.)`;
}

// ── player-side writes ───────────────────────────────────────
// The three free-text fields a player owns — goal, wish, note — each live as one current
// value on the student row, and each used to lose its old text on every edit. They now
// also append to koutsi_player_history, so the Kehitys timeline can show what the value
// used to be. The previous value is read back from the server rather than passed in, so a
// stale tab cannot record a wrong "aiemmin".
const KOUTSI_HISTORY_COLUMNS = { goal: 'goal', wish: 'player_wish', note: 'player_note' };

async function koutsiSavePlayerField(studentId, field, value) {
  const column = KOUTSI_HISTORY_COLUMNS[field];
  const { data: current } = await koutsiSupabase.from('koutsi_students').select(column).eq('id', studentId).maybeSingle();
  const previous = current?.[column] || '';
  if (previous === value) return;
  const { error } = await koutsiSupabase.from('koutsi_students').update({ [column]: value }).eq('id', studentId);
  if (error) throw error;
  // History is a nice-to-have: a failed append must not lose what the player just wrote.
  await koutsiSupabase.from('koutsi_player_history')
    .insert({ student_id: studentId, field, value, previous_value: previous || null, changed_by: studentId });
}

function koutsiSaveGoal(studentId, goal) { return koutsiSavePlayerField(studentId, 'goal', goal); }
function koutsiSaveNote(studentId, playerNote) { return koutsiSavePlayerField(studentId, 'note', playerNote); }
function koutsiSaveWish(studentId, playerWish) { return koutsiSavePlayerField(studentId, 'wish', playerWish); }

// `hiddenFromCoach` is enforced by RLS, not by the client: a hidden mood is simply not
// selectable by the coach, so ticking the box actually withholds it rather than just
// dimming it in one view.
async function koutsiAddMood(studentId, { score, note, hiddenFromCoach }) {
  const { error } = await koutsiSupabase.from('koutsi_moods')
    .insert({ student_id: studentId, score, note: note || null, hidden_from_coach: !!hiddenFromCoach });
  if (error) throw error;
}
async function koutsiSetMoodHidden(moodId, hidden) {
  const { error } = await koutsiSupabase.from('koutsi_moods').update({ hidden_from_coach: hidden }).eq('id', moodId);
  if (error) throw error;
}
async function koutsiDeleteMood(moodId) {
  const { error } = await koutsiSupabase.from('koutsi_moods').delete().eq('id', moodId);
  if (error) throw error;
}
async function koutsiAddMatchNote(studentId, { opponentName, date, note }) {
  const { error } = await koutsiSupabase.from('koutsi_match_notes').insert({ student_id: studentId, opponent_name: opponentName, date, note: note || null });
  if (error) throw error;
}
async function koutsiUpdateMatchNote(noteId, { opponentName, date, note }) {
  const { error } = await koutsiSupabase.from('koutsi_match_notes')
    .update({ opponent_name: opponentName, date, note: note || null }).eq('id', noteId);
  if (error) throw error;
}
async function koutsiDeleteMatchNote(noteId) {
  const { error } = await koutsiSupabase.from('koutsi_match_notes').delete().eq('id', noteId);
  if (error) throw error;
}

// ── profiles ─────────────────────────────────────────────────
// Name and avatar live on the shared Krossi `profiles` row; the coaching blurb lives on
// koutsi_coaches. Both are edited from the same screen, so they save together.
// `profiles.avatar_url` on polku julkiseen `profile-avatars`-ämpäriin. Demo-backend
// tallentaa saman kentän valmiina data-URL:na, joten valmis osoite palautetaan sellaisenaan.
function koutsiAvatarUrl(path) {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  const bucket = koutsiSupabase.storage.from('profile-avatars');
  if (!bucket.getPublicUrl) return '';
  return bucket.getPublicUrl(path).data.publicUrl || '';
}
async function koutsiSaveDisplayName(uid, name) {
  const { error } = await koutsiSupabase.from('profiles').update({ name }).eq('id', uid);
  if (error) throw error;
  await koutsiSupabase.auth.updateUser({ data: { display_name: name, full_name: name } });
}
async function koutsiUploadAvatar(uid, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().slice(0, 5);
  const path = `${uid}/${Date.now()}.${ext}`;
  const { error: upErr } = await koutsiSupabase.storage.from('profile-avatars').upload(path, file, { upsert: true });
  if (upErr) throw upErr;
  const { error } = await koutsiSupabase.from('profiles').update({ avatar_url: path }).eq('id', uid);
  if (error) throw error;
  return path;
}
// Pilotissa pelaaja voi päivittää vain ikänsä. Taustatietokenttä on lukittu, koska se
// pyysi aiemmin suoraan erityisiin henkilötietoryhmiin kuuluvia terveystietoja.
async function koutsiSaveStudentProfile(studentId, { age }) {
  const patch = {};
  if (age !== undefined) patch.age = age;
  if (Object.keys(patch).length === 0) return;
  const { error } = await koutsiSupabase.from('koutsi_students').update(patch).eq('id', studentId);
  if (error) throw error;
}
async function koutsiSaveCoachProfile(coachId, { tagline, bio, experience, specialties }) {
  const { error } = await koutsiSupabase.from('koutsi_coaches')
    .update({ tagline, bio, experience, specialties }).eq('id', coachId);
  if (error) throw error;
}

// ── notifications ────────────────────────────────────────────
async function koutsiLoadNotifications(uid, limit = 30) {
  const { data, error } = await koutsiSupabase.from('koutsi_notifications')
    .select('id, kind, title, body, link_path, created_at, read_at')
    .eq('recipient_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((n) => ({
    id: n.id, kind: n.kind, title: n.title, body: n.body || '',
    linkPath: n.link_path, createdAt: n.created_at, read: Boolean(n.read_at),
    date: koutsiFmtShortDateFromTimestamp(n.created_at),
  }));
}
async function koutsiMarkNotificationsRead(uid) {
  const { error } = await koutsiSupabase.from('koutsi_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', uid).is('read_at', null);
  if (error) throw error;
}
async function koutsiLoadEmailPref(uid) {
  const { data, error } = await koutsiSupabase.from('koutsi_notification_prefs')
    .select('email_enabled').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return data ? data.email_enabled : true; // opted in until they say otherwise
}
async function koutsiSetEmailPref(uid, enabled) {
  const { error } = await koutsiSupabase.from('koutsi_notification_prefs')
    .upsert({ user_id: uid, email_enabled: enabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

// ── account deletion ─────────────────────────────────────────
// Clears every row and file, then removes the auth user. Irreversible by design — the UI
// makes the person type their own name before this is reachable.
async function koutsiDeleteAccount() {
  const { data: { session } } = await koutsiSupabase.auth.getSession();
  if (!session) throw new Error('Istunto vanheni. Kirjaudu uudelleen sisään.');
  const res = await fetch(`${KOUTSI_SUPABASE_URL}/functions/v1/koutsi-delete-account`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: KOUTSI_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || 'Tilin poisto epäonnistui. Ota yhteyttä tukeen.');
  }
  await koutsiSupabase.auth.signOut();
}

// ── club events ──────────────────────────────────────────────
// The calendar has always drawn these (orange dot, "Seuran tapahtuma" in the legend) but
// nothing could create one, so the legend advertised a feature that did not exist.
const KOUTSI_EVENT_KINDS = [
  { value: 'kilpailu', label: 'Kilpailu' },
  { value: 'leiri', label: 'Leiri' },
  { value: 'seura', label: 'Seuran tapahtuma' },
  { value: 'muu', label: 'Muu' },
];
async function koutsiAddClubEvent({ coachId, date, title, kind }) {
  const { error } = await koutsiSupabase.from('koutsi_coach_events')
    .insert({ coach_id: coachId, date, title, kind: kind || 'seura' });
  if (error) throw error;
}
async function koutsiUpdateClubEvent(eventId, { date, title, kind }) {
  const { error } = await koutsiSupabase.from('koutsi_coach_events')
    .update({ date, title, kind: kind || 'seura' }).eq('id', eventId);
  if (error) throw error;
}
async function koutsiDeleteClubEvent(eventId) {
  const { error } = await koutsiSupabase.from('koutsi_coach_events').delete().eq('id', eventId);
  if (error) throw error;
}

// ── attendance summary ───────────────────────────────────────
// Pure: counts sessions the student was expected at (individual + their groups') against
// the absence rows already loaded in state. Only past sessions count, otherwise a season
// planned in advance would read as one long absence.
function koutsiAttendanceSummary(state, studentId, sinceDate) {
  const today = koutsiTodayStr();
  const all = koutsiTrainingsForStudent(state, studentId)
    .filter((t) => t.date <= today && (!sinceDate || t.date >= sinceDate));
  let present = 0, absent = 0;
  const events = [];
  for (const t of all) {
    const entry = (t.absences || []).find((a) => a.studentId === studentId);
    if (!entry) { present += 1; continue; }
    absent += 1;
    events.push({ training: t, reason: 'poissa', note: '', reportedBy: entry.reportedBy || null, updatedAt: entry.updatedAt || null });
  }
  const total = all.length;
  return {
    studentId,
    total, present, absent, injured: 0,
    missed: absent,
    rate: total ? Math.round((present / total) * 100) : null,
    events: events.sort((a, b) => b.training.date.localeCompare(a.training.date)),
  };
}

// ── admin: annual plan review ────────────────────────────────
async function koutsiIsAdmin() {
  const { data, error } = await koutsiSupabase.rpc('koutsi_is_admin');
  if (error) return false; // never block the app on this
  return Boolean(data);
}
async function koutsiPendingAnnualPlans() {
  const { data, error } = await koutsiSupabase.rpc('koutsi_pending_annual_plans');
  if (error) throw error;
  return (data || []).map((r) => ({
    groupId: r.group_id, groupName: r.group_name,
    coachId: r.coach_id, coachName: r.coach_name,
    filename: r.filename, storagePath: r.storage_path,
    sizeBytes: r.size_bytes, uploadedAt: r.uploaded_at,
  }));
}
// ── admin console ────────────────────────────────────────────
// Everything below is gated server-side on koutsi_is_admin(); a non-admin calling any of
// it gets a plain "not allowed" from Postgres.
async function koutsiAdminCoaches() {
  const { data, error } = await koutsiSupabase.rpc('koutsi_admin_coaches');
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.coach_id, name: r.coach_name, email: r.email, joinedAt: r.joined_at,
    studentCount: r.student_count, groupCount: r.group_count, trainingCount: r.training_count,
    codes: r.active_codes || [], pendingPlans: r.pending_plans,
  }));
}
async function koutsiAdminUsers() {
  const { data, error } = await koutsiSupabase.rpc('koutsi_admin_users');
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.user_id,
    name: r.display_name || 'Nimetön',
    email: r.email || '',
    joinedAt: r.joined_at,
    isAdmin: Boolean(r.is_admin),
    isCoach: Boolean(r.is_coach),
    isPlayer: Boolean(r.is_player),
    storageBytes: Number(r.storage_bytes || 0),
    studentCount: r.student_count || 0,
    groupCount: r.group_count || 0,
    trainingCount: r.training_count || 0,
    codes: r.active_codes || [],
    pendingPlans: r.pending_plans || 0,
  }));
}
async function koutsiAdminDeleteUser(userId) {
  const { data: { session } } = await koutsiSupabase.auth.getSession();
  if (!session) throw new Error('Istunto vanheni. Kirjaudu uudelleen sisään.');
  const res = await fetch(`${KOUTSI_SUPABASE_URL}/functions/v1/koutsi-admin-delete-user`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: KOUTSI_SUPABASE_ANON_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || 'Käyttäjän poisto epäonnistui.');
  }
}
// Avaa valmentajan näkymän ylläpitäjälle. Palvelin tarkistaa oikeuden ja kirjaa jäljen
// tauluun koutsi_admin_actions, joten "kenen näkymässä olin" ei jää pelkän muistin varaan.
async function koutsiAdminActAs(coachId) {
  const { data, error } = await koutsiSupabase.rpc('koutsi_admin_act_as', { coach_id_input: coachId });
  if (error) throw error;
  return { id: data.coach_id, name: data.coach_name || 'Valmentaja' };
}
async function koutsiAdminGroups(coachId) {
  const { data, error } = await koutsiSupabase.rpc('koutsi_admin_groups', { coach_id_input: coachId });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.group_id, name: r.group_name, memberCount: r.member_count,
    planFilename: r.plan_filename, planStatus: r.plan_status,
  }));
}
// Splits a pasted list into names. Accepts one per line and also CSV/TSV rows, taking the
// first column — which is what actually comes out of a coach's spreadsheet.
function koutsiParseNameList(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.split(/[,;\t]/)[0].trim())
    .filter((n) => n && !/^(nimi|name|pelaaja)$/i.test(n))
    .slice(0, 200);
}
async function koutsiAdminBulkInviteCodes(coachId, names, groupId, expiresDays = 30) {
  const { data, error } = await koutsiSupabase.rpc('koutsi_admin_bulk_invite_codes', {
    coach_id_input: coachId, names, group_id_input: groupId || null, expires_days: expiresDays,
  });
  if (error) throw error;
  return (data || []).map((r) => ({ label: r.label, code: r.code, link: koutsiInviteLink(r.code) }));
}
// Uploads the file to the group's folder, then records it as published in one step.
async function koutsiAdminUploadAnnualPlan(groupId, file) {
  if (file.size > KOUTSI_PLAN_MAX_BYTES) {
    throw new Error(`Tiedosto on liian suuri (${Math.round(file.size / 1048576)} Mt). Enimmäiskoko on 20 Mt.`);
  }
  const { data: prev, error: prevErr } = await koutsiSupabase.from('koutsi_groups')
    .select('annual_plan_storage_path').eq('id', groupId).maybeSingle();
  if (prevErr) throw prevErr;
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().slice(0, 5);
  const path = prev?.annual_plan_storage_path || `${groupId}/${crypto.randomUUID ? crypto.randomUUID() : Date.now()}.${ext}`;
  const { error: upErr } = await koutsiSupabase.storage.from('koutsi-plans').upload(path, file, {
    contentType: file.type || 'application/pdf', upsert: Boolean(prev?.annual_plan_storage_path),
  });
  if (upErr) throw upErr;
  const { error } = await koutsiSupabase.rpc('koutsi_admin_set_annual_plan', {
    group_id_input: groupId, filename_input: file.name,
    storage_path_input: path, size_bytes_input: file.size,
  });
  if (error) {
    if (!prev?.annual_plan_storage_path) {
      const { error: cleanupErr } = await koutsiSupabase.storage.from('koutsi-plans').remove([path]);
      if (cleanupErr) throw new Error(`${error.message}; uuden vuosisuunnitelman siivous epäonnistui: ${cleanupErr.message}`);
    }
    throw error;
  }
}

async function koutsiPublishAnnualPlan(groupId) {
  const { error } = await koutsiSupabase.rpc('koutsi_publish_annual_plan', { group_id_input: groupId });
  if (error) throw error;
}

// ── data export ──────────────────────────────────────────────
// The privacy policy grants access and portability rights; without this every such request
// is a manual evening's work. Exports only what the caller can already see — RLS decides,
// not this function — as one JSON file the browser saves directly.
async function koutsiExportMyData(uid, role) {
  const tables = role === 'coach'
    ? ['koutsi_coaches', 'koutsi_groups', 'koutsi_group_members', 'koutsi_trainings',
       'koutsi_exercises', 'koutsi_coach_events', 'koutsi_coach_students',
       'koutsi_diary_entries', 'koutsi_homework', 'koutsi_videos', 'koutsi_group_invite_codes',
       'koutsi_pilot_acknowledgements']
    : ['koutsi_students', 'koutsi_coach_students', 'koutsi_group_members', 'koutsi_trainings',
       'koutsi_diary_entries', 'koutsi_homework', 'koutsi_videos', 'koutsi_moods',
       'koutsi_match_notes', 'koutsi_training_absences', 'koutsi_pilot_acknowledgements'];

  const payload = {
    vietyLahde: 'Krossi Koutsi',
    vientipaiva: new Date().toISOString(),
    kayttajaId: uid,
    rooli: role === 'coach' ? 'valmentaja' : 'pelaaja',
    huomio: 'Tiedosto sisältää ne tiedot, jotka näet itse sovelluksessa.',
  };

  const { data: profile } = await koutsiSupabase.from('profiles').select('*').eq('id', uid).maybeSingle();
  payload.profiili = profile || null;

  const { data: prefs } = await koutsiSupabase.from('koutsi_notification_prefs').select('*').eq('user_id', uid).maybeSingle();
  payload.ilmoitusasetukset = prefs || null;

  const { data: notifications } = await koutsiSupabase.from('koutsi_notifications')
    .select('kind, title, body, created_at, read_at').eq('recipient_id', uid).order('created_at', { ascending: false });
  payload.ilmoitukset = notifications || [];

  for (const table of tables) {
    // RLS already narrows each of these to the caller's own rows
    const { data, error } = await koutsiSupabase.from(table).select('*');
    payload[table] = error ? { virhe: error.message } : (data || []);
  }
  return payload;
}
// Triggers the browser's own save dialog. Revoking the object URL afterwards matters on
// a phone, where a stale blob can hold a multi-megabyte export in memory.
function koutsiDownloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

Object.assign(window, {
  koutsiFetchCoachRow, koutsiFetchStudentRow, koutsiFetchCoachLinksForStudent,
  koutsiLoadCoachState, koutsiLoadStudentState,
  koutsiTodayStr, koutsiFmtShortDate, koutsiFmtLongDate, koutsiDateFromStr, koutsiAddDays, koutsiRandomUuid,
  koutsiStudentById, koutsiGroupById, koutsiGroupForStudent, koutsiGroupsForStudent, koutsiCoachById, koutsiTrainingParty,
  koutsiThemeForDate,
  koutsiTrainingsForStudent, koutsiUpcomingTrainingsForStudent, koutsiTrainingsForGroup,
  koutsiTrainingsOnDate, koutsiTrainingsOnDateForStudent, koutsiLevelColor,
  koutsiClubEventsOnDate, koutsiUpcomingClubEvents,
  koutsiAddClubEvent, koutsiUpdateClubEvent, koutsiDeleteClubEvent, KOUTSI_EVENT_KINDS,
  koutsiAttendanceSummary,
  koutsiIsAdmin, koutsiAdminActAs, koutsiPendingAnnualPlans, koutsiPublishAnnualPlan,
  koutsiAdminCoaches, koutsiAdminUsers, koutsiAdminDeleteUser,
  koutsiAdminGroups, koutsiAdminBulkInviteCodes,
  koutsiAdminUploadAnnualPlan, koutsiParseNameList,
  koutsiExportMyData, koutsiDownloadJson,
  koutsiErrorText,
  koutsiAddDiaryEntry, koutsiUpdateDiaryEntry, koutsiDeleteDiaryEntry,
  koutsiToggleHomeworkDone, koutsiAddHomework, koutsiUpdateHomework, koutsiDeleteHomework,
  koutsiAddTraining, koutsiUpdateTraining, koutsiUpdateTrainingSeries,
  koutsiDeleteTraining, koutsiDeleteTrainingSeries, koutsiCountSeriesRemaining, koutsiWeeklyDates,
  koutsiShareVideo, koutsiSetVideoRecipients, koutsiVideoUrl, koutsiDeleteVideo,
  koutsiSetAttendance, koutsiCycleAbsence,
  koutsiSetStudentLevel, koutsiEndCoaching,
  koutsiCreateGroup, koutsiUpdateGroup, koutsiDeleteGroup,
  koutsiAddGroupMembers, koutsiRemoveGroupMember,
  koutsiSaveThemes, koutsiDeleteTheme, koutsiDeleteThemes,
  koutsiCurrentIsoWeek, koutsiIsoWeekOf, koutsiIsoWeekOfDateStr, koutsiIsoWeekStart,
  koutsiAddIsoWeeks, koutsiWeeksInIsoYear, koutsiIsoWeekKey, koutsiIsoWeekRangeLabel, koutsiCompareIsoWeeks,
  koutsiUploadAnnualPlan, koutsiAnnualPlanUrl, koutsiRemoveAnnualPlan,
  koutsiAddExercise, koutsiUpdateExercise, koutsiDeleteExercise, koutsiSeedExercises,
  koutsiCreateInviteCode, koutsiListInviteCodes, koutsiRevokeInviteCode,
  koutsiRedeemInviteCode, koutsiRedeemCoachKey, koutsiInviteLink, koutsiInviteMessage,
  koutsiCreatePlayer, koutsiBulkSetup, koutsiUnclaimedPlayers, koutsiClaimPlayer,
  koutsiMyJoinCode,
  koutsiSaveGoal, koutsiSaveNote, koutsiSaveWish,
  koutsiAddMood, koutsiDeleteMood, koutsiSetMoodHidden,
  koutsiAddMatchNote, koutsiUpdateMatchNote, koutsiDeleteMatchNote,
  koutsiSaveDisplayName, koutsiUploadAvatar, koutsiSaveCoachProfile, koutsiSaveStudentProfile, koutsiAvatarUrl,
  koutsiLoadNotifications, koutsiMarkNotificationsRead, koutsiLoadEmailPref, koutsiSetEmailPref,
  koutsiDeleteAccount,
  KOUTSI_WEEKDAYS, KOUTSI_WEEKDAYS_LONG, KOUTSI_MONTHS, KOUTSI_TAG_LABELS, KOUTSI_TAGS,
  KOUTSI_ABSENCE_REASON_LABELS, KOUTSI_ATTENDANCE_STATUS_LABELS,
});
