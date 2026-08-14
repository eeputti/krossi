// koutsi-data.js — real Supabase-backed data layer for the Koutsi app (koutsi.krossi.app).
// Exposes the same window.koutsiXxx helper names the UI (koutsi-valmentaja-app.jsx /
// koutsi-pelaaja-app.jsx) already calls, but backed by the shared Supabase project
// (see lib/koutsi-auth.jsx for the client + auth gate) instead of localStorage.
// The old sales-demo version of this file is lib/koutsi-demo-data.js.
//
// The load functions below assemble the exact same nested `state` shape the demo used
// ({coach, coaches, students, groups, trainings, exercises, clubEvents}), so every
// presentational component built against the demo keeps working unchanged — only the
// data-fetching/mutation layer here, and each app's own App() root, changed.

// ── deterministic display helpers (not persisted — purely cosmetic) ───────
function koutsiHueFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
function koutsiInitialOf(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }

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

function koutsiStudentById(state, id) { return state.students.find((s) => s.id === id) || null; }
function koutsiGroupById(state, id) { return state.groups.find((g) => g.id === id) || null; }
function koutsiGroupForStudent(state, studentId) { return state.groups.find((g) => g.memberIds.includes(studentId)) || null; }
function koutsiGroupsForStudent(state, studentId) { return state.groups.filter((g) => g.memberIds.includes(studentId)); }
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
const KOUTSI_ABSENCE_REASON_LABELS = { poissa: 'Poissa', vamma: 'Loukkaantunut' };

// ── row -> UI-shape mappers ─────────────────────────────────
function koutsiMapGroup(g, memberIds) {
  return {
    id: g.id, coachId: g.coach_id, name: g.name, level: g.level, day: g.weekday, time: g.time ? g.time.slice(0, 5) : '',
    memberIds,
    theme: g.theme_title ? { title: g.theme_title, lead: g.theme_lead || '' } : null,
    annualPlan: g.annual_plan_filename ? { filename: g.annual_plan_filename, date: g.annual_plan_uploaded_at ? g.annual_plan_uploaded_at.slice(0, 10) : koutsiTodayStr() } : null,
  };
}
function koutsiMapTraining(t, absenceRows) {
  return {
    id: t.id, date: t.date, time: t.time ? t.time.slice(0, 5) : '', type: t.type,
    studentId: t.student_id, groupId: t.group_id, coachId: t.coach_id,
    absences: absenceRows.filter((a) => a.training_id === t.id).map((a) => ({ studentId: a.student_id, reason: a.reason })),
  };
}
function koutsiMapExercise(e) {
  return { id: e.id, coachId: e.coach_id, name: e.name, goal: e.goal, players: e.players_label, playerCount: e.player_count, duration: e.duration, level: e.level, tags: e.tags || [] };
}
function koutsiMapCoachEvent(e) { return { id: e.id, date: e.date, title: e.title, kind: e.kind }; }
function koutsiMapStudent(studentRow, profileRow, diaryRows, homeworkRows, videoRows, moodRows) {
  return {
    id: studentRow.id, initial: koutsiInitialOf(profileRow?.name), hue: koutsiHueFromId(studentRow.id),
    name: profileRow?.name || 'Pelaaja', age: studentRow.age, level: studentRow.level,
    goal: studentRow.goal || '', lastSession: studentRow.last_session_note || '', focus: studentRow.focus || '',
    background: studentRow.background || '', playerNote: studentRow.player_note || '', playerWish: studentRow.player_wish || '',
    diary: diaryRows.filter((d) => d.student_id === studentRow.id).map((d) => ({ id: d.id, date: koutsiFmtShortDateFromTimestamp(d.created_at), text: d.text })),
    homework: homeworkRows.filter((h) => h.student_id === studentRow.id).map((h) => ({ id: h.id, text: h.text, done: h.done })),
    videos: videoRows.filter((v) => v.student_id === studentRow.id).map((v) => ({ id: v.id, title: v.title, hue: koutsiHueFromId(v.id), date: v.date, tags: v.tags || [], addedBy: v.added_by_id === studentRow.id ? 'player' : 'coach', storagePath: v.storage_path })),
    moods: moodRows.filter((m) => m.student_id === studentRow.id).map((m) => ({ id: m.id, date: koutsiFmtShortDateFromTimestamp(m.created_at), score: m.score, note: m.note || '' })),
  };
}
function koutsiMapCoach(coachRow, profileRow) {
  return {
    id: coachRow.id, initial: koutsiInitialOf(profileRow?.name), hue: koutsiHueFromId(coachRow.id),
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
    { data: diaryRows }, { data: homeworkRows }, { data: videoRows }, { data: moodRows },
  ] = await Promise.all([
    studentIds.length ? koutsiSupabase.from('koutsi_students').select('*').in('id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length ? koutsiSupabase.from('profiles').select('id, name').in('id', studentIds) : Promise.resolve({ data: [] }),
    koutsiSupabase.from('koutsi_groups').select('*').eq('coach_id', coachId),
    koutsiSupabase.from('koutsi_exercises').select('*').eq('coach_id', coachId),
    koutsiSupabase.from('koutsi_coach_events').select('*').eq('coach_id', coachId),
    koutsiSupabase.from('koutsi_trainings').select('*').eq('coach_id', coachId),
    studentIds.length ? koutsiSupabase.from('koutsi_diary_entries').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length ? koutsiSupabase.from('koutsi_homework').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length ? koutsiSupabase.from('koutsi_videos').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length ? koutsiSupabase.from('koutsi_moods').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
  ]);

  const groupIds = (groupRows || []).map((g) => g.id);
  const { data: memberRows } = groupIds.length
    ? await koutsiSupabase.from('koutsi_group_members').select('group_id, student_id').in('group_id', groupIds).is('ended_at', null)
    : { data: [] };
  const trainingIds = (trainingRows || []).map((t) => t.id);
  const { data: absenceRows } = trainingIds.length
    ? await koutsiSupabase.from('koutsi_training_absences').select('*').in('training_id', trainingIds)
    : { data: [] };

  const profileByStudentId = new Map((studentProfiles || []).map((p) => [p.id, p]));
  const students = (studentRows || []).map((s) => koutsiMapStudent(s, profileByStudentId.get(s.id), diaryRows || [], homeworkRows || [], videoRows || [], moodRows || []));
  const groups = (groupRows || []).map((g) => koutsiMapGroup(g, (memberRows || []).filter((m) => m.group_id === g.id).map((m) => m.student_id)));
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
    { data: groupRows }, { data: allGroupMemberRows },
    { data: exerciseRows }, { data: eventRows },
    { data: individualTrainingRows }, { data: groupTrainingRows },
    { data: diaryRows }, { data: homeworkRows }, { data: videoRows }, { data: moodRows },
  ] = await Promise.all([
    coachIds.length ? koutsiSupabase.from('koutsi_coaches').select('*').in('id', coachIds) : Promise.resolve({ data: [] }),
    coachIds.length ? koutsiSupabase.from('profiles').select('id, name').in('id', coachIds) : Promise.resolve({ data: [] }),
    groupIds.length ? koutsiSupabase.from('koutsi_groups').select('*').in('id', groupIds) : Promise.resolve({ data: [] }),
    groupIds.length ? koutsiSupabase.from('koutsi_group_members').select('group_id, student_id').in('group_id', groupIds).is('ended_at', null) : Promise.resolve({ data: [] }),
    coachIds.length ? koutsiSupabase.from('koutsi_exercises').select('*').in('coach_id', coachIds) : Promise.resolve({ data: [] }),
    coachIds.length ? koutsiSupabase.from('koutsi_coach_events').select('*').in('coach_id', coachIds) : Promise.resolve({ data: [] }),
    koutsiSupabase.from('koutsi_trainings').select('*').eq('student_id', studentId),
    groupIds.length ? koutsiSupabase.from('koutsi_trainings').select('*').in('group_id', groupIds) : Promise.resolve({ data: [] }),
    koutsiSupabase.from('koutsi_diary_entries').select('*').eq('student_id', studentId),
    koutsiSupabase.from('koutsi_homework').select('*').eq('student_id', studentId),
    koutsiSupabase.from('koutsi_videos').select('*').eq('student_id', studentId),
    koutsiSupabase.from('koutsi_moods').select('*').eq('student_id', studentId),
  ]);

  const trainingRows = [...(individualTrainingRows || []), ...(groupTrainingRows || [])];
  const trainingIds = trainingRows.map((t) => t.id);
  const { data: absenceRows } = trainingIds.length
    ? await koutsiSupabase.from('koutsi_training_absences').select('*').in('training_id', trainingIds)
    : { data: [] };

  const coachProfileById = new Map((coachProfiles || []).map((p) => [p.id, p]));
  const coaches = (coachRows || []).map((c) => koutsiMapCoach(c, coachProfileById.get(c.id)));
  const groups = (groupRows || []).map((g) => koutsiMapGroup(g, (allGroupMemberRows || []).filter((m) => m.group_id === g.id).map((m) => m.student_id)));
  const trainings = trainingRows.map((t) => koutsiMapTraining(t, absenceRows || []));
  const student = koutsiMapStudent(studentRow, profileRow, diaryRows || [], homeworkRows || [], videoRows || [], moodRows || []);

  return { coach: coaches[0] || null, coaches, students: [student], groups, trainings, exercises: (exerciseRows || []).map(koutsiMapExercise), clubEvents: (eventRows || []).map(koutsiMapCoachEvent) };
}

// ── mutations — each writes to Supabase; the caller reloads state afterwards ──
async function koutsiAddDiaryEntry(coachId, studentId, text) {
  const { error } = await koutsiSupabase.from('koutsi_diary_entries').insert({ coach_id: coachId, student_id: studentId, text });
  if (error) throw error;
}
async function koutsiToggleHomeworkDone(homeworkId, done) {
  const { error } = await koutsiSupabase.from('koutsi_homework').update({ done }).eq('id', homeworkId);
  if (error) throw error;
}
async function koutsiAddHomework(studentId, text) {
  const { error } = await koutsiSupabase.from('koutsi_homework').insert({ student_id: studentId, text });
  if (error) throw error;
}
async function koutsiAddTraining({ coachId, studentId, groupId, date, time, type }) {
  const { error } = await koutsiSupabase.from('koutsi_trainings').insert({ coach_id: coachId, student_id: studentId, group_id: groupId, date, time, type });
  if (error) throw error;
}
// One shared video becomes one row per recipient student (denormalized, matches the
// "share with several players" UX) — no real file is attached yet, see koutsi_videos
// migration notes for why storage_path stays null until real upload exists.
async function koutsiShareVideo({ title, date, tags, studentIds, addedById }) {
  const rows = studentIds.map((studentId) => ({ student_id: studentId, added_by_id: addedById, title, date, tags }));
  const { error } = await koutsiSupabase.from('koutsi_videos').insert(rows);
  if (error) throw error;
}
// Cycles a member's status for one training: paikalla → poissa → loukkaantunut → paikalla.
// `currentReason` is read by the caller from the already-loaded state (undefined | 'poissa' | 'vamma').
async function koutsiCycleAbsence(trainingId, studentId, currentReason) {
  if (!currentReason) {
    const { error } = await koutsiSupabase.from('koutsi_training_absences').insert({ training_id: trainingId, student_id: studentId, reason: 'poissa' });
    if (error) throw error;
  } else if (currentReason === 'poissa') {
    const { error } = await koutsiSupabase.from('koutsi_training_absences').update({ reason: 'vamma' }).eq('training_id', trainingId).eq('student_id', studentId);
    if (error) throw error;
  } else {
    const { error } = await koutsiSupabase.from('koutsi_training_absences').delete().eq('training_id', trainingId).eq('student_id', studentId);
    if (error) throw error;
  }
}
async function koutsiSaveBackground(studentId, text) {
  const { error } = await koutsiSupabase.from('koutsi_students').update({ background: text }).eq('id', studentId);
  if (error) throw error;
}
async function koutsiSetStudentLevel(studentId, level) {
  const { error } = await koutsiSupabase.from('koutsi_students').update({ level }).eq('id', studentId);
  if (error) throw error;
}
async function koutsiUploadAnnualPlan(groupId, filename) {
  const { error } = await koutsiSupabase.from('koutsi_groups').update({ annual_plan_filename: filename, annual_plan_uploaded_at: new Date().toISOString() }).eq('id', groupId);
  if (error) throw error;
}
async function koutsiRemoveAnnualPlan(groupId) {
  const { error } = await koutsiSupabase.from('koutsi_groups').update({ annual_plan_filename: null, annual_plan_storage_path: null, annual_plan_uploaded_at: null }).eq('id', groupId);
  if (error) throw error;
}
async function koutsiAddExercise({ coachId, name, goal, players, playerCount, duration, level, tags }) {
  const { error } = await koutsiSupabase.from('koutsi_exercises').insert({ coach_id: coachId, name, goal, players_label: players, player_count: playerCount, duration, level, tags });
  if (error) throw error;
}
async function koutsiSaveTheme(groupId, { title, lead }) {
  const { error } = await koutsiSupabase.from('koutsi_groups').update({ theme_title: title, theme_lead: lead }).eq('id', groupId);
  if (error) throw error;
}
async function koutsiCreateGroup({ coachId, name, level, day, time, memberIds }) {
  const { data, error } = await koutsiSupabase.from('koutsi_groups').insert({ coach_id: coachId, name, level, weekday: day, time }).select('id').single();
  if (error) throw error;
  if (memberIds.length > 0) {
    const { error: memberErr } = await koutsiSupabase.from('koutsi_group_members').insert(memberIds.map((studentId) => ({ group_id: data.id, student_id: studentId })));
    if (memberErr) throw memberErr;
  }
}
async function koutsiAddGroupMembers(groupId, studentIds) {
  const { error } = await koutsiSupabase.from('koutsi_group_members').insert(studentIds.map((studentId) => ({ group_id: groupId, student_id: studentId })));
  if (error) throw error;
}
function koutsiGenerateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}
async function koutsiCreateInviteCode(coachId, groupId) {
  const code = koutsiGenerateInviteCode();
  const { error } = await koutsiSupabase.from('koutsi_group_invite_codes').insert({ code, coach_id: coachId, group_id: groupId || null });
  if (error) throw error;
  return code;
}
async function koutsiRedeemInviteCode(code) {
  const { data, error } = await koutsiSupabase.rpc('redeem_koutsi_invite_code', { code_input: code });
  if (error) throw error;
  return data;
}
async function koutsiSaveGoal(studentId, goal) {
  const { error } = await koutsiSupabase.from('koutsi_students').update({ goal }).eq('id', studentId);
  if (error) throw error;
}
async function koutsiSaveNote(studentId, playerNote) {
  const { error } = await koutsiSupabase.from('koutsi_students').update({ player_note: playerNote }).eq('id', studentId);
  if (error) throw error;
}
async function koutsiSaveWish(studentId, playerWish) {
  const { error } = await koutsiSupabase.from('koutsi_students').update({ player_wish: playerWish }).eq('id', studentId);
  if (error) throw error;
}
async function koutsiAddMood(studentId, { score, note }) {
  const { error } = await koutsiSupabase.from('koutsi_moods').insert({ student_id: studentId, score, note: note || null });
  if (error) throw error;
}

Object.assign(window, {
  koutsiFetchCoachRow, koutsiFetchStudentRow, koutsiFetchCoachLinksForStudent,
  koutsiLoadCoachState, koutsiLoadStudentState,
  koutsiTodayStr, koutsiFmtShortDate, koutsiFmtLongDate, koutsiDateFromStr,
  koutsiStudentById, koutsiGroupById, koutsiGroupForStudent, koutsiGroupsForStudent, koutsiCoachById, koutsiTrainingParty,
  koutsiTrainingsForStudent, koutsiUpcomingTrainingsForStudent, koutsiTrainingsForGroup,
  koutsiTrainingsOnDate, koutsiTrainingsOnDateForStudent, koutsiLevelColor,
  koutsiClubEventsOnDate, koutsiUpcomingClubEvents,
  koutsiAddDiaryEntry, koutsiToggleHomeworkDone, koutsiAddHomework, koutsiAddTraining, koutsiShareVideo, koutsiCycleAbsence,
  koutsiSaveBackground, koutsiSetStudentLevel, koutsiUploadAnnualPlan, koutsiRemoveAnnualPlan, koutsiAddExercise, koutsiSaveTheme,
  koutsiCreateGroup, koutsiAddGroupMembers, koutsiCreateInviteCode, koutsiRedeemInviteCode,
  koutsiSaveGoal, koutsiSaveNote, koutsiSaveWish, koutsiAddMood,
  KOUTSI_WEEKDAYS, KOUTSI_WEEKDAYS_LONG, KOUTSI_MONTHS, KOUTSI_TAG_LABELS, KOUTSI_TAGS, KOUTSI_ABSENCE_REASON_LABELS,
});
