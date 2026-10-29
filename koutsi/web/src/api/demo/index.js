// index.js — the in-memory demo backend. Implements api/contract.js over one state object
// built by seed.js; nothing is persisted and nothing reaches Supabase. Semantics mirror the
// real backend (and the old demo) closely enough that every screen behaves the same: themes
// are one per group per week and `onlyNew` never overwrites, series deletes never touch the
// past, only placeholders can be deleted or merged away, and so on.

import { seed, refreshThemes, weeklySessions, newId, COACH, PLAYER, STARTER_EXERCISES } from './seed.js';
import { ApiError } from '../errors.js';
import {
  koutsiTodayStr, koutsiWeeklyDates, koutsiFmtShortDate, koutsiInitialOf, koutsiHueFromId,
  koutsiRoundTimeToQuarterHour, koutsiRoundToQuarterHourMinutes, koutsiClampGroupTrainingWeeks,
  KOUTSI_DEFAULT_GROUP_TRAINING_WEEKS, KOUTSI_THEME_TITLE_MAX, KOUTSI_THEME_LEAD_MAX, koutsiAddDays,
} from '../../domain/core.js';
import { writePlan } from '../../domain/plan.js';
import { coachViewOfArchives } from '../../domain/archive.js';
import { activeGroups, playerSeasonMessage, seasonDates } from '../../domain/season.js';
import { seedMessages } from './messagesSeed.js';
import { MESSAGE_MAX } from '../../domain/messages.js';
import { addOpenSlots, bookOpenSlot, openSlotsView, removeOpenSlot } from './openSlots.js';

let role = 'coach';
let state = null;
let latencyMs = 140;

/** configureDemo({ role: 'coach' | 'player', latency }) — called by the demo entry files. */
export function configureDemo(opts = {}) {
  if (opts.role) role = opts.role;
  if (opts.latency != null) latencyMs = opts.latency;
  state = null;
}

const uid = () => (role === 'player' ? PLAYER : COACH);
// `npm run dev:koutsi` → /demo/pelaaja?esikatsele=putki: three sessions in a row ended just now,
// so the player's Merkitse and Koti show one "Miten meni?" slide each.
const previewPutki = process.env.NODE_ENV !== 'production'
  && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('esikatsele') === 'putki';
function addPutki(s) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const first = Math.max(6, d.getHours() - 3);
  const mine = s.groups.filter((g) => g.memberIds.includes(PLAYER));
  [mine[0], mine[1] || mine[0], null].forEach((g, i) => s.trainings.push({
    id: newId('tr'), date: today, time: `${pad(first + i)}:00`, type: g ? 'Ryhmätreeni' : 'Yksityistunti', durationMinutes: 60,
    loggedBy: 'coach', notes: '', endDate: null, studentId: g ? null : PLAYER, groupId: g ? g.id : null, coachId: COACH, seriesId: null, absences: [],
  }));
  return s;
}
const S = () => { if (!state) state = seedMessages(previewPutki ? addPutki(seed()) : seed(), role); return state; };
const clone = (v) => JSON.parse(JSON.stringify(v));
const wait = () => new Promise((r) => setTimeout(r, latencyMs));
const nowIso = () => new Date().toISOString();
const findStudent = (id) => S().students.find((s) => s.id === id);
const findGroup = (id) => S().groups.find((g) => g.id === id);
// Six letters/digits like the real codes (no I/O/0/1, read aloud over the phone).
const demoCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const notAllowed = () => { throw new ApiError('Tätä ei voi tehdä demossa.', { code: 'demo' }); };
const messageListeners = new Set();
const emitMessages = (threadId) => { setTimeout(() => messageListeners.forEach((cb) => cb({ threadId })), 0); };

// Sub-records live inside their student; edits look them up by id across all of them.
function eachList(key, fn) { S().students.forEach((s) => { s[key] = fn(s[key] || [], s); }); }
const removeById = (key, id) => eachList(key, (list) => list.filter((x) => x.id !== id));
const patchById = (key, id, patch) => eachList(key, (list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));

function coachState() {
  const s = clone(S());
  s.groups.forEach(refreshThemes);
  return { coach: s.coach, coaches: [s.coach], students: s.students, groups: s.groups, trainings: s.trainings, exercises: s.exercises, clubEvents: s.clubEvents, weekNotes: s.weekNotes || [], announcements: s.announcements || [], announcementsReady: true, entriesReady: true, moodSessionsReady: true, longGoalReady: true, archiveReady: true, seasons: s.seasons || [], seasonDraft: s.seasonDraft || null, seasonsReady: true, sends: s.sends || [], videoLibrary: s.videoLibrary || [], sendsReady: true };
}

/** The notices a player sees: to one of their groups or to them, still in date. */
function announcementsFor(s, me, groupIds) {
  const today = koutsiTodayStr();
  return (s.announcements || []).filter((a) => a.until >= today
    && ((a.groupIds || []).some((id) => groupIds.has(id)) || (a.studentIds || []).includes(me.id)));
}

function playerState(studentId) {
  const s = clone(S());
  s.groups.forEach(refreshThemes);
  const me = s.students.find((x) => x.id === studentId) || s.students[0];
  const groups = s.groups.filter((g) => g.memberIds.includes(me.id));
  const rosterIds = new Set(groups.flatMap((g) => g.memberIds));
  const roster = s.students.filter((x) => x.id !== me.id && rosterIds.has(x.id))
    .map((x) => ({ id: x.id, initial: x.initial, hue: x.hue, avatarUrl: x.avatarUrl || '', name: x.name, level: x.level || null, rosterOnly: true }));
  const groupIds = new Set(groups.map((g) => g.id));
  // RLS: a player sees their own and their groups' sessions; hidden moods are theirs to see.
  const trainings = s.trainings.filter((t) => t.studentId === me.id || (t.groupId && groupIds.has(t.groupId)));
  return { coach: s.coach, coaches: s.coaches, students: [me, ...roster], groups, trainings, exercises: s.exercises, clubEvents: s.clubEvents, announcements: announcementsFor(s, me, groupIds), announcementsReady: true, entriesReady: true, moodSessionsReady: true, longGoalReady: true, archiveReady: true, tennisProfileReady: true };
}

function hideHiddenMoods(snapshot) {
  snapshot.students.forEach((st) => { st.moods = (st.moods || []).filter((m) => !m.hiddenFromCoach); });
  return snapshot;
}

function student(id, name, { age = null, level = null, placeholder = true } = {}) {
  return {
    id, name, initial: koutsiInitialOf(name), hue: koutsiHueFromId(id), avatarUrl: '', isPlaceholder: placeholder,
    age, ageRange: null, ageValue: age == null ? '' : String(age), ageLabel: age == null ? '' : `${age} v`,
    level, goal: '', lastSession: '', focus: '', playerNote: '', playerWish: '', ambition: '', longGoal: '', bio: '', area: '', playsHand: '', favouriteShot: '', playingSince: null, tennisStory: '', joinedAt: null, welcomeSeenAt: null,
    diary: [], homework: [], videos: [], moods: [], matchNotes: [], goalHistory: [], wishHistory: [], noteHistory: [], longGoalHistory: [], ambitionHistory: [], archive: [], entries: [],
  };
}

function addHistory(st, field, value) {
  const key = { goal: 'goalHistory', wish: 'wishHistory', note: 'noteHistory', long_goal: 'longGoalHistory', ambition: 'ambitionHistory' }[field];
  const column = { goal: 'goal', wish: 'playerWish', note: 'playerNote', long_goal: 'longGoal', ambition: 'ambition' }[field];
  const previous = st[column] || '';
  if (previous === value) return;
  st[column] = value;
  st[key] = [{ id: newId('hist'), at: nowIso(), field, value, previousValue: previous, byPlayer: true }, ...(st[key] || [])];
}

// Same checks as the real backend (api/supabase/coaching.js entryRow).
function demoEntry({ date, text, how }) {
  const body = (text || '').trim();
  if (!body) throw new ApiError('Kirjoita, mitä teit.');
  if (body.length > 2000) throw new ApiError('Merkintä on liian pitkä (enintään 2000 merkkiä).');
  if ((how || '').trim().length > 1000) throw new ApiError('"Miten meni" on liian pitkä (enintään 1000 merkkiä).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new ApiError('Valitse päivä.');
  return { date, text: body, how: (how || '').trim() };
}
const sortEntries = (st) => { st.entries = (st.entries || []).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.at).localeCompare(String(a.at))); };

const validAge = (age) => age == null || (Number.isInteger(age) && age >= 1 && age < 120);

const findVideo = (id) => (S().videoLibrary || []).find((v) => v.id === id);
/** One sending to Lähetetyt (log = { groupIds, refId? }); returns its id for the copies. */
function logSend(kind, text, ids, log, at) {
  const id = newId('send');
  S().sends = [{ id, kind, videoId: null, refId: log.refId || id, title: text, groupIds: [...new Set(log.groupIds || [])], studentIds: ids, at }, ...(S().sends || [])];
  return id;
}

const SIGNUP = () => (role === 'player' ? 'https://koutsi.krossi.app/pelaaja' : 'https://koutsi.krossi.app/valmentaja');

export const backend = {
  auth: {
    async getSession() { return { user: { id: uid(), email: 'demo@krossi.app' } }; },
    onChange() { return () => {}; },
    signInWithPassword: notAllowed,
    signUp: notAllowed,
    signInWithOAuth: notAllowed,
    resetPassword: notAllowed,
    resendConfirmation: notAllowed,
    updatePassword: notAllowed,
    // "Kirjaudu ulos" in the demo ends the tour and opens the real service.
    async signOut() { window.location.href = SIGNUP(); },
  },

  account: {
    async getProfile(id) { return { id, name: S().profileName[id] || 'Demo', avatarUrl: '' }; },
    async getPilotAcknowledgement() { return true; },
    async acceptPilot() {},
    createProfile: notAllowed,
    async saveDisplayName(id, name) {
      await wait();
      if (id === COACH) Object.assign(S().coach, { name, initial: koutsiInitialOf(name) });
      const st = findStudent(id);
      if (st) Object.assign(st, { name, initial: koutsiInitialOf(name) });
      S().profileName[id] = name;
    },
    async uploadAvatar(id, file) {
      await wait();
      const url = URL.createObjectURL(file);
      if (id === COACH) S().coach.avatarUrl = url;
      const st = findStudent(id);
      if (st) st.avatarUrl = url;
      return url;
    },
    async removeAvatar(id) {
      await wait();
      if (id === COACH) S().coach.avatarUrl = '';
      const st = findStudent(id);
      if (st) st.avatarUrl = '';
    },
    async saveAbout(id, fields) {
      await wait();
      const patch = {};
      if ('bio' in fields) patch.bio = fields.bio || '';
      if ('area' in fields && fields.area) patch.area = fields.area;
      if (id === COACH) Object.assign(S().coach, patch);
      const st = findStudent(id);
      if (st) Object.assign(st, patch);
    },
    async recordAppOpen() {},
    async trackEvent() {},
    async isAdmin() { return false; },
    async submitFeedback() { await wait(); },
    async exportMyData() { return clone(S()); },
    async deleteAccount() { window.location.href = SIGNUP(); },
  },

  coach: {
    async fetchRow(id) { return id === COACH ? { id } : null; },
    // Vapaat ajat first: what the player demo booked becomes a lesson before the snapshot is taken
    async load() { await wait(); const slots = openSlotsView(S(), 'coach'); return { ...coachViewOfArchives(hideHiddenMoods(coachState())), ...slots }; },
    async redeemKey() { return { ok: true }; },
    async markWelcomeSeen() { S().coach.welcomeSeenAt = nowIso(); },
    async saveProfile(coachId, patch) { await wait(); Object.assign(S().coach, patch); },
    async saveWeekNote(coachId, { year, week, score, note }) {
      await wait();
      const st = S();
      const rest = (st.weekNotes || []).filter((n) => !(n.year === year && n.week === week));
      st.weekNotes = [...rest, { id: newId('wn'), year, week, score, note: note || '', updatedAt: nowIso() }];
    },
    // The demo has no second role to join; the switch only opens the player demo.
    subscribe() { return () => {}; },
  },

  player: {
    async fetchRow(id) { return findStudent(id) ? { id } : null; },
    async load(studentId) { await wait(); const slots = openSlotsView(S(), 'player', studentId); return { ...playerState(studentId), ...slots }; },
    subscribe() { return () => {}; },
    async markWelcomeSeen(id) { const st = findStudent(id); if (st) st.welcomeSeenAt = nowIso(); },
    async saveGoal(id, v) { await wait(); addHistory(findStudent(id), 'goal', v); },
    async saveNote(id, v) { await wait(); addHistory(findStudent(id), 'note', v); },
    async saveWish(id, v) { await wait(); addHistory(findStudent(id), 'wish', v); },
    async saveAim(id, { ambition, longGoal }) {
      await wait();
      const st = findStudent(id);
      addHistory(st, 'ambition', ambition || '');
      addHistory(st, 'long_goal', longGoal || '');
    },
    async saveTennis(id, { playsHand, favouriteShot, playingSince, tennisStory }) {
      await wait();
      Object.assign(findStudent(id), { playsHand: playsHand || '', favouriteShot: favouriteShot || '', playingSince: playingSince ?? null, tennisStory: tennisStory || '' });
    },
    async saveAge(id, age) {
      await wait();
      const st = findStudent(id);
      Object.assign(st, { age, ageValue: age == null ? '' : String(age), ageLabel: age == null ? '' : `${age} v` });
    },
    async addMood(id, { score, note, hiddenFromCoach, trainingId }) {
      await wait();
      const at = nowIso();
      const mood = { id: newId('m'), at, date: koutsiFmtShortDate(at.slice(0, 10)), score, note: note || '', hiddenFromCoach: !!hiddenFromCoach, trainingId: trainingId || null };
      findStudent(id).moods.unshift(mood);
      return { id: mood.id };
    },
    async updateMood(moodId, { score, note, hiddenFromCoach }) {
      await wait();
      patchById('moods', moodId, {
        ...(score != null ? { score } : {}),
        ...(note !== undefined ? { note: note || '' } : {}),
        ...(hiddenFromCoach !== undefined ? { hiddenFromCoach: !!hiddenFromCoach } : {}),
      });
    },
    async setMoodHidden(moodId, hidden) { patchById('moods', moodId, { hiddenFromCoach: !!hidden }); },
    async deleteMood(moodId) { removeById('moods', moodId); },
    async addMatchNote(id, n) {
      await wait();
      findStudent(id).matchNotes.unshift({
        id: newId('n'), at: nowIso(), opponentName: n.opponentName, date: n.date, note: n.note || '',
        durationMinutes: n.durationMinutes || null, result: n.result || null, format: n.format || null, score: n.score || '',
        partnerName: n.format === 'nelinpeli' ? (n.partnerName || '') : '', opponent2Name: n.format === 'nelinpeli' ? (n.opponent2Name || '') : '',
        tournamentId: n.tournamentId || null,
      });
    },
    async updateMatchNote(noteId, n) {
      await wait();
      patchById('matchNotes', noteId, {
        opponentName: n.opponentName, date: n.date, note: n.note || '', durationMinutes: n.durationMinutes || null,
        result: n.result || null, format: n.format || null, score: n.score || '',
        partnerName: n.format === 'nelinpeli' ? (n.partnerName || '') : '', opponent2Name: n.format === 'nelinpeli' ? (n.opponent2Name || '') : '',
        tournamentId: n.tournamentId || null,
      });
    },
    async deleteMatchNote(noteId) { removeById('matchNotes', noteId); },
    async addSelfTraining({ studentId, coachId, date, endDate, time, type, durationMinutes, notes }) {
      await wait();
      S().trainings.push({
        id: newId('tr'), date, endDate: endDate || null, time, type, durationMinutes: durationMinutes || null, loggedBy: 'player',
        notes: notes || '', studentId, groupId: null, coachId: coachId || COACH, seriesId: null, absences: [],
      });
    },
    async updateSelfTraining(id, { coachId, date, endDate, time, type, durationMinutes, notes }) {
      await wait();
      const t = S().trainings.find((x) => x.id === id && x.loggedBy === 'player');
      if (!t) throw new ApiError('Merkintää ei löytynyt. Se on ehkä poistettu.', { code: 'not_found' });
      Object.assign(t, { coachId: coachId || t.coachId, date, endDate: endDate || null, time, type, durationMinutes: durationMinutes || null, notes: notes || '' });
    },
    async deleteSelfTraining(id) { S().trainings = S().trainings.filter((t) => t.id !== id); },
    async addEntry(id, entry) {
      await wait();
      const st = findStudent(id);
      st.entries = [{ id: newId('e'), at: nowIso(), ...demoEntry(entry) }, ...(st.entries || [])];
      sortEntries(st);
    },
    async updateEntry(entryId, entry) {
      await wait();
      if (!S().students.some((st) => (st.entries || []).some((e) => e.id === entryId))) throw new ApiError('Merkintää ei löytynyt. Se on ehkä poistettu.', { code: 'not_found' });
      patchById('entries', entryId, demoEntry(entry));
      S().students.forEach(sortEntries);
    },
    async deleteEntry(entryId) { removeById('entries', entryId); },
    async archiveItem(studentId, key) {
      await wait();
      const st = findStudent(studentId);
      st.archive = [{ key, archivedAt: nowIso(), removedAt: null }, ...(st.archive || []).filter((a) => a.key !== key)];
    },
    async unarchiveItem(studentId, key) { const st = findStudent(studentId); st.archive = (st.archive || []).filter((a) => a.key !== key); },
    async forgetArchived(studentId, key) { const st = findStudent(studentId); (st.archive || []).forEach((a) => { if (a.key === key) a.removedAt = nowIso(); }); },
    async deleteHistory(historyId) {
      S().students.forEach((st) => ['goalHistory', 'wishHistory', 'noteHistory', 'longGoalHistory', 'ambitionHistory'].forEach((k) => { st[k] = (st[k] || []).filter((h) => h.id !== historyId); }));
    },
  },

  students: {
    async create(coachId, { name, age, level }) {
      await wait();
      if (!validAge(age)) throw new ApiError('Jos annat pelaajan iän, sen pitää olla 1–119 vuotta.');
      const id = newId('demo-s');
      S().students.push(student(id, name, { age: age ?? null, level: level || null }));
      return id;
    },
    async bulkSetup(coachId, { groups = [], players = [], themes = [], weeksAhead } = {}) {
      await wait();
      if (players.some((p) => !validAge(p.age))) throw new ApiError('Jos annat pelaajan iän, sen pitää olla 1–119 vuotta.');
      const s = S();
      const groupIds = {};
      groups.forEach((row) => {
        let group = row.existing_id ? findGroup(row.existing_id) : null;
        if (row.existing_id && !group) throw new ApiError('Ryhmää ei löytynyt.');
        if (!group) {
          group = { id: newId('g'), coachId: COACH, name: row.name, level: row.level || 'Kaikki tasot', day: row.day || 'Ma', time: row.time, durationMinutes: row.duration_minutes || 60, memberIds: [], slots: [], themes: [], annualPlan: null };
          refreshThemes(group);
          s.groups.push(group);
          s.trainings.push(...weeklySessions(group, koutsiTodayStr(), koutsiClampGroupTrainingWeeks(weeksAhead ?? KOUTSI_DEFAULT_GROUP_TRAINING_WEEKS)));
        }
        groupIds[row.client_id] = group.id;
      });
      const created = players.map((row) => {
        const id = newId('demo-s');
        s.students.push(student(id, row.name, { age: row.age ?? null, level: row.level || null }));
        (row.group_refs || []).forEach((ref) => {
          const group = findGroup(groupIds[ref]);
          if (group && !group.memberIds.includes(id)) group.memberIds.push(id);
        });
        return { id, name: row.name };
      });
      themes.forEach((row) => {
        const group = findGroup(groupIds[row.group_ref]);
        if (!group) return;
        const hit = group.themes.find((t) => t.year === row.year && t.week === row.week);
        if (hit) Object.assign(hit, { title: row.title, lead: row.lead || '' });
        else group.themes.push({ id: newId('t'), year: row.year, week: row.week, title: row.title, lead: row.lead || '' });
        refreshThemes(group);
      });
      return { players_created: created.length, players: created, group_ids: groupIds };
    },
    async setLevel(id, level) { await wait(); findStudent(id).level = level; },
    async updatePlaceholder(id, { name, age, level }) {
      await wait();
      const st = findStudent(id);
      if (!st) return;
      if (name !== undefined) Object.assign(st, { name, initial: koutsiInitialOf(name) });
      if (age !== undefined) Object.assign(st, { age, ageValue: age == null ? '' : String(age), ageLabel: age == null ? '' : `${age} v` });
      if (level !== undefined) st.level = level;
    },
    async endCoaching(coachId, studentId) {
      await wait();
      const s = S();
      s.students = s.students.filter((x) => x.id !== studentId);
      s.groups.forEach((g) => { g.memberIds = g.memberIds.filter((id) => id !== studentId); });
    },
    async merge(coachId, keepId, removeId) {
      await wait();
      const s = S();
      const keep = findStudent(keepId);
      const remove = findStudent(removeId);
      if (!keep || !remove) throw new ApiError('Pelaajaa ei löytynyt.');
      if (!remove.isPlaceholder) throw new ApiError('Vain vielä liittymättömän pelaajan voi yhdistää toiseen.');
      s.groups.forEach((g) => {
        if (!g.memberIds.includes(removeId)) return;
        g.memberIds = g.memberIds.filter((id) => id !== removeId);
        if (!g.memberIds.includes(keepId)) g.memberIds.push(keepId);
      });
      s.trainings.forEach((t) => {
        if (t.studentId === removeId) t.studentId = keepId;
        t.absences = (t.absences || []).filter((a) => a.studentId !== removeId || !t.absences.some((b) => b.studentId === keepId))
          .map((a) => (a.studentId === removeId ? { ...a, studentId: keepId } : a));
      });
      ['diary', 'homework', 'videos', 'moods', 'matchNotes'].forEach((key) => { keep[key] = [...(keep[key] || []), ...(remove[key] || [])]; });
      s.students = s.students.filter((x) => x.id !== removeId);
      return { kept_id: keepId, removed_id: removeId };
    },
    async deletePlaceholder(coachId, studentId) {
      await wait();
      const s = S();
      const st = findStudent(studentId);
      if (!st || !st.isPlaceholder) throw new ApiError('Tätä pelaajaa ei voi poistaa — hän on jo lunastanut oman tilinsä.');
      s.students = s.students.filter((x) => x.id !== studentId);
      s.groups.forEach((g) => { g.memberIds = g.memberIds.filter((id) => id !== studentId); });
    },
    async placeholderJoinCode(studentId) {
      return `DEMO${String(studentId).replace(/[^A-Z0-9]/gi, '').slice(-2).toUpperCase().padStart(2, '0')}`;
    },
  },

  groups: {
    async create(coachId, { name, level, place = '', day, time, durationMinutes, memberIds = [], weeksAhead }) {
      await wait();
      const group = { id: newId('g'), coachId: COACH, name, level, place: place || '', day, time, durationMinutes: durationMinutes || 60, memberIds: [...memberIds], slots: [], themes: [], annualPlan: null };
      refreshThemes(group);
      S().groups.push(group);
      S().trainings.push(...weeklySessions(group, koutsiTodayStr(), koutsiClampGroupTrainingWeeks(weeksAhead ?? KOUTSI_DEFAULT_GROUP_TRAINING_WEEKS)));
      return group.id;
    },
    async update(groupId, { name, level, place, day, time, durationMinutes, weeksAhead }) {
      await wait();
      const s = S();
      const group = findGroup(groupId);
      const duration = durationMinutes || 60;
      const changed = group.day !== day || group.time !== time || (group.durationMinutes || 60) !== duration;
      Object.assign(group, { name, level, day, time, durationMinutes: duration, ...(place !== undefined ? { place: place || '' } : {}) });
      if (!changed) return;
      const today = koutsiTodayStr();
      const slotSeries = new Set((group.slots || []).map((sl) => sl.seriesId).filter(Boolean));
      s.trainings = s.trainings.filter((t) => !(t.groupId === groupId && t.date >= today && !slotSeries.has(t.seriesId)));
      s.trainings.push(...weeklySessions(group, today, koutsiClampGroupTrainingWeeks(weeksAhead ?? KOUTSI_DEFAULT_GROUP_TRAINING_WEEKS)));
    },
    async remove(groupId) {
      await wait();
      const s = S();
      s.groups = s.groups.filter((g) => g.id !== groupId);
      s.trainings = s.trainings.filter((t) => t.groupId !== groupId);
    },
    async addMembers(groupId, ids) {
      await wait();
      const g = findGroup(groupId);
      g.memberIds = [...new Set([...g.memberIds, ...ids])];
    },
    async removeMember(groupId, studentId) {
      await wait();
      const g = findGroup(groupId);
      g.memberIds = g.memberIds.filter((id) => id !== studentId);
    },
    async addSlot({ groupId, day, time, durationMinutes, weeksAhead }) {
      await wait();
      const g = findGroup(groupId);
      const slot = { id: newId('slot'), day, time: koutsiRoundTimeToQuarterHour(time), durationMinutes: koutsiRoundToQuarterHourMinutes(durationMinutes || 60) };
      const sessions = weeklySessions({ ...g, day: slot.day, time: slot.time, durationMinutes: slot.durationMinutes }, koutsiTodayStr(), koutsiClampGroupTrainingWeeks(weeksAhead ?? KOUTSI_DEFAULT_GROUP_TRAINING_WEEKS));
      slot.seriesId = sessions[0]?.seriesId || null;
      g.slots = [...(g.slots || []), slot];
      S().trainings.push(...sessions);
      return slot.id;
    },
    async deleteSlot(slotId) {
      await wait();
      const s = S();
      let seriesId = null;
      s.groups.forEach((g) => {
        const hit = (g.slots || []).find((sl) => sl.id === slotId);
        if (hit) seriesId = hit.seriesId;
        g.slots = (g.slots || []).filter((sl) => sl.id !== slotId);
      });
      const today = koutsiTodayStr();
      if (seriesId) s.trainings = s.trainings.filter((t) => !(t.seriesId === seriesId && t.date >= today));
    },
    async extendSeries(groupId, untilDate, skipDates = []) {
      await wait();
      const s = S();
      const g = findGroup(groupId);
      const skip = new Set(skipDates);
      let added = 0;
      for (const slot of [{ day: g.day, time: g.time, durationMinutes: g.durationMinutes }, ...(g.slots || [])]) {
        const existing = s.trainings.filter((t) => t.groupId === groupId && t.time === slot.time && t.loggedBy !== 'player');
        const last = existing.map((t) => t.date).sort().pop() || koutsiTodayStr();
        const seriesId = existing.find((t) => t.date === last)?.seriesId || newId('ser');
        const dates = koutsiWeeklyDates(koutsiAddDays(last, 7), untilDate, 60).filter((d) => !skip.has(d));
        dates.forEach((date) => s.trainings.push({ id: newId('tr'), date, time: slot.time, type: 'Ryhmätreeni', durationMinutes: slot.durationMinutes, loggedBy: 'coach', notes: '', endDate: null, studentId: null, groupId, coachId: COACH, seriesId, absences: [] }));
        added += dates.length;
      }
      return { added };
    },
  },

  // "Uusi kausi": the draft stays with the coach until publish; publishing writes the new season's
  // own group rows (the old season keeps its groups, sessions and attendance as they were).
  seasons: {
    async saveDraft(coachId, draft) { await wait(); S().seasonDraft = clone(draft); },
    async removeDraft() { await wait(); S().seasonDraft = null; },
    async update(seasonId, { name, endsOn, breaks }) {
      await wait();
      const season = (S().seasons || []).find((x) => x.id === seasonId);
      if (!season) throw new ApiError('Kautta ei löytynyt.');
      if (name !== undefined) season.name = name;
      if (endsOn !== undefined) season.endsOn = endsOn;
      if (breaks !== undefined) season.breaks = clone(breaks);
    },
    async publish(coachId, draft) {
      await wait();
      const s = S();
      if (!draft?.name?.trim() || !draft.startsOn || !draft.endsOn || draft.endsOn < draft.startsOn) throw new ApiError('Tarkista kauden nimi ja päivät.');
      const active = activeGroups(draft);
      if (!active.length) throw new ApiError('Kaudella ei ole yhtään ryhmää.');
      const season = { id: newId('season'), coachId: COACH, name: draft.name.trim(), startsOn: draft.startsOn, endsOn: draft.endsOn, breaks: clone(draft.breaks || []) };
      const ids = {};
      (draft.newPlayers || []).forEach((p) => {
        if (!active.some((dg) => (draft.members[dg.key] || []).includes(p.key))) return;
        ids[p.key] = newId('demo-s');
        s.students.push(student(ids[p.key], p.name));
      });
      let sessions = 0;
      const created = active.map((dg) => {
        const group = {
          id: newId('g'), coachId: COACH, seasonId: season.id, continuesFrom: dg.fromId || null, name: dg.name.trim(), level: dg.level || 'Kaikki tasot',
          day: dg.day, time: dg.time, durationMinutes: dg.durationMinutes || 60, slots: [], themes: [], annualPlan: null,
          memberIds: [...new Set((draft.members[dg.key] || []).map((ref) => ids[ref] || ref))].filter((id) => s.students.some((x) => x.id === id)),
        };
        refreshThemes(group);
        s.groups.push(group);
        const seriesId = newId('ser');
        const dates = seasonDates(dg, season);
        dates.forEach((date) => s.trainings.push({ id: newId('tr'), date, time: dg.time, type: 'Ryhmätreeni', durationMinutes: group.durationMinutes, loggedBy: 'coach', notes: '', endDate: null, studentId: null, groupId: group.id, coachId: COACH, seriesId, absences: [] }));
        sessions += dates.length;
        return { group, dg };
      });
      s.seasons = [...(s.seasons || []), season];
      s.seasonDraft = null;
      // every player gets one notification about their own groups; the demo player sees theirs
      const mine = created.filter(({ group }) => group.memberIds.includes(PLAYER)).map(({ dg }) => dg);
      if (mine.length) {
        s.playerNotifications.unshift({ id: newId('pn'), kind: 'season_published', title: `${season.name}: ryhmäsi ovat valmiina`, body: playerSeasonMessage(draft, mine, koutsiFmtShortDate), linkPath: '/pelaaja', createdAt: nowIso(), read: false });
      }
      return { seasonId: season.id, groups: created.length, sessions };
    },
  },

  themes: {
    async save(rows, { onlyNew = false } = {}) {
      await wait();
      const clean = (rows || []).filter((r) => r.title && r.title.trim());
      if (clean.some((r) => r.title.trim().length > KOUTSI_THEME_TITLE_MAX || (r.lead || '').trim().length > KOUTSI_THEME_LEAD_MAX)) {
        throw new ApiError(`Viikkoteeman teksti on liian pitkä: teema enintään ${KOUTSI_THEME_TITLE_MAX} ja tarkennus enintään ${KOUTSI_THEME_LEAD_MAX} merkkiä.`);
      }
      let written = 0;
      clean.forEach((r) => {
        const g = findGroup(r.groupId);
        if (!g) return;
        const hit = g.themes.find((t) => t.year === r.year && t.week === r.week);
        if (hit && onlyNew) return;
        if (hit) Object.assign(hit, { title: r.title.trim(), lead: (r.lead || '').trim() });
        else g.themes.push({ id: newId('t'), year: r.year, week: r.week, title: r.title.trim(), lead: (r.lead || '').trim() });
        refreshThemes(g);
        written += 1;
      });
      return written;
    },
    async remove(ids) {
      await wait();
      const set = new Set(ids || []);
      S().groups.forEach((g) => { g.themes = g.themes.filter((t) => !set.has(t.id)); refreshThemes(g); });
    },
  },

  trainings: {
    async add({ coachId, studentId, groupId, date, time, type, repeatUntil, durationMinutes = null }) {
      await wait();
      const seriesId = repeatUntil && repeatUntil > date ? newId('ser') : null;
      const dates = seriesId ? koutsiWeeklyDates(date, repeatUntil) : [date];
      const group = groupId ? findGroup(groupId) : null;
      dates.forEach((d) => S().trainings.push({
        id: newId('tr'), date: d, time, type, durationMinutes: durationMinutes || group?.durationMinutes || null, loggedBy: 'coach', notes: '', endDate: null,
        studentId: studentId || null, groupId: groupId || null, coachId: coachId || COACH, seriesId, absences: [],
      }));
      return dates.length;
    },
    async update(id, { date, time, type, durationMinutes }) {
      await wait();
      S().trainings = S().trainings.map((t) => (t.id === id ? { ...t, date, time, type, ...(durationMinutes !== undefined ? { durationMinutes: durationMinutes || null } : {}) } : t));
    },
    async updateSeries(seriesId, { time, type, durationMinutes }, fromDate) {
      await wait();
      const floor = fromDate || koutsiTodayStr();
      S().trainings = S().trainings.map((t) => (t.seriesId === seriesId && t.date >= floor ? { ...t, time, type, ...(durationMinutes !== undefined ? { durationMinutes: durationMinutes || null } : {}) } : t));
    },
    async remove(id) { await wait(); S().trainings = S().trainings.filter((t) => t.id !== id); },
    async removeSeries(seriesId, fromDate) {
      await wait();
      const today = koutsiTodayStr();
      const floor = !fromDate || fromDate < today ? today : fromDate;
      S().trainings = S().trainings.filter((t) => !(t.seriesId === seriesId && t.date >= floor));
    },
    async countSeriesRemaining(seriesId, fromDate) {
      const floor = fromDate || koutsiTodayStr();
      return S().trainings.filter((t) => t.seriesId === seriesId && t.date >= floor).length;
    },
    async setPlan(id, plan) {
      await wait();
      const t = S().trainings.find((x) => x.id === id && x.loggedBy === 'coach');
      if (!t) throw new ApiError('Treeniä ei löytynyt. Se on ehkä poistettu.', { code: 'not_found' });
      t.notes = writePlan(plan) || '';
    },
  },

  attendance: {
    async set(trainingIds, studentId, status) {
      await wait();
      if (!['paikalla', 'poissa'].includes(status)) throw new ApiError('Pilotissa voi merkitä vain läsnäolon tai poissaolon.');
      const ids = new Set(trainingIds || []);
      S().trainings.forEach((t) => {
        if (!ids.has(t.id)) return;
        const rest = (t.absences || []).filter((a) => a.studentId !== studentId);
        if (status === 'poissa') rest.push({ studentId, reason: 'poissa', note: '', reportedBy: uid(), updatedAt: nowIso() });
        t.absences = rest;
      });
    },
  },

  // Vapaat ajat (./openSlots.js): Anna has it on; the two demo pages share the slots in the browser.
  openSlots: {
    async add(coachId, slots) { await wait(); if (role === 'player') notAllowed(); return addOpenSlots(S(), slots); },
    async remove(slotId) { await wait(); if (role === 'player') notAllowed(); removeOpenSlot(S(), slotId); },
    async book(slotId) { await wait(); if (role !== 'player') notAllowed(); return bookOpenSlot(S(), slotId, PLAYER); },
  },

  notes: {
    async add(coachId, studentId, text) {
      await wait();
      const at = nowIso();
      findStudent(studentId).diary.unshift({ id: newId('d'), at, date: koutsiFmtShortDate(at.slice(0, 10)), text });
    },
    async addMany(coachId, studentIds, text, log = null) {
      await wait();
      const at = nowIso();
      const ids = [...new Set(studentIds)];
      const sendId = log ? logSend('note', text, ids, log, at) : null;
      ids.forEach((studentId) => findStudent(studentId).diary.unshift({ id: newId('d'), at, date: koutsiFmtShortDate(at.slice(0, 10)), text, sendId }));
      return ids.length;
    },
    async update(id, text) { await wait(); patchById('diary', id, { text }); },
    async remove(id) { await wait(); removeById('diary', id); },
  },

  homework: {
    async add(studentId, text) { await wait(); findStudent(studentId).homework.unshift({ id: newId('h'), at: nowIso(), text, done: false, doneAt: null }); },
    async addMany(studentIds, text, log = null) {
      await wait();
      const at = nowIso();
      const ids = [...new Set(studentIds)];
      const sendId = log ? logSend('homework', text, ids, log, at) : null;
      ids.forEach((studentId) => findStudent(studentId).homework.unshift({ id: newId('h'), at, text, done: false, doneAt: null, sendId, coachId: sendId ? COACH : null }));
      return ids.length;
    },
    async update(id, text) { await wait(); patchById('homework', id, { text }); },
    async remove(id) { await wait(); removeById('homework', id); },
    async toggleDone(id, done) { await wait(); patchById('homework', id, { done, doneAt: done ? nowIso() : null }); },
  },

  videos: {
    async share({ shareId, title, date, tags, studentIds, addedById, file, externalUrl, onProgress }) {
      await wait();
      const resolved = shareId || newId('vs');
      const url = file ? URL.createObjectURL(file) : null;
      if (file && onProgress) onProgress(100);
      (studentIds || []).forEach((sid) => {
        const st = findStudent(sid);
        if (!st || st.videos.some((v) => v.shareId === resolved)) return;
        st.videos.unshift({ id: newId('v'), shareId: resolved, recipientIds: [...studentIds], at: nowIso(), title, date, tags: tags || [], hue: koutsiHueFromId(resolved), addedBy: addedById === sid ? 'player' : 'coach', storagePath: url, externalUrl: externalUrl || null, mimeType: file ? file.type : null });
      });
      return resolved;
    },
    async setRecipients(shareId, studentIds) {
      await wait();
      const s = S();
      let source = null;
      s.students.forEach((st) => { const hit = st.videos.find((v) => v.shareId === shareId); if (hit && !source) source = hit; });
      if (!source) return;
      const recipients = [...new Set(studentIds || [])];
      s.students.forEach((st) => {
        st.videos = st.videos.filter((v) => v.shareId !== shareId || recipients.includes(st.id));
        if (recipients.includes(st.id) && !st.videos.some((v) => v.shareId === shareId)) st.videos.unshift({ ...source, id: newId('v') });
        st.videos.forEach((v) => { if (v.shareId === shareId) v.recipientIds = recipients; });
      });
    },
    async url(storagePath) { return storagePath || null; },
    async remove(id) { await wait(); removeById('videos', id); },

    // the coach's own videos (koutsi_coach_videos in the real backend)
    async save({ id = null, title, tags = [], file = null, externalUrl = null, onProgress }) {
      await wait();
      const videoId = id || newId('vid');
      if (findVideo(videoId)) return videoId;
      if (file && onProgress) onProgress(100);
      const name = String(title || '').trim().slice(0, 200) || 'Video';
      S().videoLibrary = [{
        id: videoId, title: name, tags: tags || [], at: nowIso(), hue: koutsiHueFromId(videoId),
        storagePath: file ? URL.createObjectURL(file) : null, externalUrl: file ? null : (externalUrl || null),
        mimeType: file ? file.type : null, sizeBytes: file ? file.size : null,
      }, ...(S().videoLibrary || [])];
      return videoId;
    },
    async shareSaved({ videoId, studentIds, groupIds = [], date = koutsiTodayStr() }) {
      await wait();
      const video = findVideo(videoId);
      if (!video) throw new ApiError('Videota ei enää löydy. Päivitä sivu.');
      const pending = [...new Set(studentIds || [])].filter((sid) => findStudent(sid) && !findStudent(sid).videos.some((v) => v.shareId === videoId));
      if (!pending.length) return { sendId: null, added: 0 };
      const at = nowIso();
      const sendId = newId('send');
      S().sends = [{ id: sendId, kind: 'video', videoId, refId: videoId, title: video.title, groupIds: [...new Set(groupIds)], studentIds: pending, at }, ...(S().sends || [])];
      pending.forEach((sid) => findStudent(sid).videos.unshift({
        id: newId('v'), shareId: videoId, recipientIds: pending, at, title: video.title, date, tags: video.tags || [], hue: video.hue,
        addedBy: 'coach', storagePath: video.storagePath, externalUrl: video.externalUrl, mimeType: video.mimeType,
      }));
      return { sendId, added: pending.length };
    },
    async updateSaved(videoId, { title, tags = [] }) {
      await wait();
      const name = String(title || '').trim();
      if (!name) throw new ApiError('Anna videolle nimi.');
      const video = findVideo(videoId);
      if (video) Object.assign(video, { title: name, tags });
      eachList('videos', (list) => list.map((v) => (v.shareId === videoId ? { ...v, title: name, tags } : v)));
      (S().sends || []).forEach((x) => { if (x.videoId === videoId) x.title = name; });
    },
    async removeSaved(videoId) {
      await wait();
      eachList('videos', (list) => list.filter((v) => v.shareId !== videoId));
      S().videoLibrary = (S().videoLibrary || []).filter((v) => v.id !== videoId);
      S().sends = (S().sends || []).filter((x) => x.videoId !== videoId);
    },
  },

  // Lähetetyt: a sending as a whole (see the real backend's coaching.js `sends`)
  sends: {
    async update(sendId, text) {
      await wait();
      const body = String(text || '').trim();
      if (!body) throw new ApiError('Kirjoita teksti.');
      const send = (S().sends || []).find((x) => x.id === sendId);
      if (!send) throw new ApiError('Lähetystä ei enää löydy. Päivitä sivu.');
      if (send.kind === 'video') throw new ApiError('Videon nimen voi vaihtaa Videoista.');
      eachList(send.kind === 'homework' ? 'homework' : 'diary', (list) => list.map((x) => (x.sendId === sendId ? { ...x, text: body } : x)));
      send.title = body;
    },
    async remove(sendId) {
      await wait();
      const send = (S().sends || []).find((x) => x.id === sendId);
      if (!send) return;
      if (send.kind === 'video') {
        const keep = new Set((S().sends || []).filter((x) => x.id !== sendId && x.videoId === send.videoId).flatMap((x) => x.studentIds));
        const drop = new Set(send.studentIds.filter((id) => !keep.has(id)));
        eachList('videos', (list, st) => (drop.has(st.id) ? list.filter((v) => v.shareId !== send.videoId) : list));
      } else {
        eachList(send.kind === 'homework' ? 'homework' : 'diary', (list) => list.filter((x) => x.sendId !== sendId));
      }
      S().sends = S().sends.filter((x) => x.id !== sendId);
    },
  },

  exercises: {
    async add(coachId, e) { await wait(); S().exercises.push({ id: newId('e'), coachId: COACH, ...e, tags: e.tags || [], video: null }); },
    async update(id, patch) { await wait(); S().exercises = S().exercises.map((e) => (e.id === id ? { ...e, ...patch } : e)); },
    async remove(id) { await wait(); S().exercises = S().exercises.filter((e) => e.id !== id); },
    async setVideo({ exerciseId, title, file, externalUrl, onProgress }) {
      await wait();
      if (file && onProgress) onProgress(100);
      const e = S().exercises.find((x) => x.id === exerciseId);
      if (e) e.video = { title, storagePath: file ? URL.createObjectURL(file) : null, externalUrl: externalUrl || null, mimeType: file ? file.type : null, sizeBytes: file ? file.size : null };
    },
    async removeVideo(id) { await wait(); const e = S().exercises.find((x) => x.id === id); if (e) e.video = null; },
    async seedStarters() {
      await wait();
      const have = new Set(S().exercises.map((e) => e.name));
      const added = STARTER_EXERCISES.filter((t) => !have.has(t.name));
      added.forEach((t) => S().exercises.push({ id: newId('e'), coachId: COACH, ...t, video: null }));
      return added.length;
    },
  },

  announcements: {
    async add(coachId, { text, groupIds = [], studentIds = [], until }) {
      await wait();
      const body = (text || '').trim();
      if (!body) throw new ApiError('Kirjoita tiedote.');
      if (!groupIds.length && !studentIds.length) throw new ApiError('Valitse, kenelle tiedote menee.');
      const row = { id: newId('an'), coachId, text: body, groupIds: [...groupIds], studentIds: [...studentIds], until: until || koutsiTodayStr(), at: nowIso() };
      S().announcements = [row, ...(S().announcements || [])];
      return { id: row.id };
    },
    async remove(id) { await wait(); S().announcements = (S().announcements || []).filter((a) => a.id !== id); },
  },

  // Viestit: the conversations live in memory like everything else; a change tells this page's
  // listeners (the badges, an open conversation) right away.
  messages: {
    async overview(who) {
      await wait();
      const st = S();
      const mine = (t) => (who === 'player' ? t.studentId === PLAYER : t.coachId === COACH);
      const threads = st.threads.filter(mine).map((t) => {
        const list = st.messages.filter((m) => m.threadId === t.id).sort((a, b) => a.at.localeCompare(b.at));
        const last = list[list.length - 1] || null;
        const readAt = who === 'player' ? t.playerReadAt : t.coachReadAt;
        const theirs = who === 'player' ? 'coach' : 'player';
        return {
          ...clone(t), lastMessageAt: last ? last.at : null,
          last: last ? { body: last.body.slice(0, 200), sender: last.sender, refKind: last.refKind } : null,
          unread: list.filter((m) => m.sender === theirs && (!readAt || m.at > readAt)).length,
        };
      });
      return { ready: true, enabled: who === 'player' ? threads.some((t) => t.enabled) : Boolean(st.messagesOn), threads };
    },
    async list(threadId) {
      await wait();
      return clone(S().messages.filter((m) => m.threadId === threadId).sort((a, b) => a.at.localeCompare(b.at)))
        .map(({ threadId: _t, ...m }) => m);
    },
    async send(threadId, { body, refKind = null, refId = null }) {
      await wait();
      const st = S();
      const t = st.threads.find((x) => x.id === threadId);
      const text = String(body || '').trim();
      if (!t || !t.enabled) throw new ApiError('Viestit eivät ole käytössä tässä keskustelussa.');
      if (findStudent(t.studentId)?.isPlaceholder) throw new ApiError('Pelaaja ei ole vielä liittynyt Koutsiin. Viestit toimivat, kun hän liittyy.');
      if (!text) throw new ApiError('Kirjoita viesti.');
      if (text.length > MESSAGE_MAX) throw new ApiError(`Viesti on liian pitkä (enintään ${MESSAGE_MAX} merkkiä).`);
      const sender = role === 'player' ? 'player' : 'coach';
      const row = { id: newId('m'), threadId, sender, body: text, refKind: refKind && refId ? refKind : null, refId: refKind && refId ? refId : null, at: nowIso() };
      st.messages.push(row);
      if (sender === 'coach') t.coachReadAt = row.at; else t.playerReadAt = row.at;
      emitMessages(threadId);
      const { threadId: _t, ...out } = row;
      return clone(out);
    },
    async remove(messageId) {
      await wait();
      const st = S();
      const m = st.messages.find((x) => x.id === messageId);
      if (!m) return;
      if (m.sender !== (role === 'player' ? 'player' : 'coach')) throw new ApiError('Voit poistaa vain omia viestejäsi.');
      st.messages = st.messages.filter((x) => x.id !== messageId);
      emitMessages(m.threadId);
    },
    async markRead(threadId) {
      const t = S().threads.find((x) => x.id === threadId);
      if (!t) return;
      if (role === 'player') t.playerReadAt = nowIso(); else t.coachReadAt = nowIso();
      emitMessages(threadId);
    },
    async setEnabled(studentIds, on) {
      await wait();
      if (role === 'player') notAllowed();
      const st = S();
      let changed = 0;
      for (const id of studentIds || []) {
        if (!findStudent(id)) continue;
        const t = st.threads.find((x) => x.studentId === id && x.coachId === COACH);
        if (t) {
          if (t.enabled !== Boolean(on)) { t.enabled = Boolean(on); t.enabledAt = nowIso(); changed += 1; }
        } else {
          st.threads.push({ id: `demo-th-${id}`, coachId: COACH, studentId: id, enabled: Boolean(on), enabledAt: nowIso(), coachReadAt: null, playerReadAt: null });
          changed += 1;
        }
      }
      if (changed) emitMessages(null);
      return changed;
    },
    subscribe(cb) {
      messageListeners.add(cb);
      return () => { messageListeners.delete(cb); };
    },
  },

  events: {
    async add(coachId, { date, endDate, title, kind }) { await wait(); S().clubEvents.push({ id: newId('ce'), date, endDate: endDate || null, title, kind: kind || 'seura' }); },
    async update(id, { date, endDate, title, kind }) { await wait(); S().clubEvents = S().clubEvents.map((e) => (e.id === id ? { ...e, date, endDate: endDate || null, title, kind } : e)); },
    async remove(id) { await wait(); S().clubEvents = S().clubEvents.filter((e) => e.id !== id); },
  },

  invites: {
    async myJoinCode() { return S().joinCode; },
    async rotateJoinCode() { await wait(); S().joinCode = demoCode(); return S().joinCode; },
    async create(groupId, { maxUses = 1, expiresDays = 14 } = {}) {
      await wait();
      const code = { code: demoCode(), groupId: groupId || null, createdAt: nowIso(), expiresAt: new Date(Date.now() + expiresDays * 86400000).toISOString(), maxUses, useCount: 0, revokedAt: null, active: true };
      S().inviteCodes.unshift(code);
      return { code: code.code, expires_at: code.expiresAt };
    },
    async list() { return clone(S().inviteCodes); },
    async revoke(code) { const hit = S().inviteCodes.find((c) => c.code === code); if (hit) Object.assign(hit, { revokedAt: nowIso(), active: false }); },
    // The demo player really joins: the first group they aren't in yet (so "Liity ryhmään" shows it).
    async redeem() {
      await wait();
      const group = S().groups.find((g) => !g.memberIds.includes(PLAYER));
      if (role === 'player' && group) group.memberIds.push(PLAYER);
      return { coach_id: COACH, coach_name: S().coach.name, group_id: group?.id || null, group_name: group?.name || null, already_linked: true };
    },
    async claim(code, studentId) {
      await wait();
      const st = findStudent(studentId);
      if (!st || !st.isPlaceholder) throw new ApiError('Tätä profiilia ei voi lunastaa. Pyydä valmentajalta uusi koodi.');
      st.isPlaceholder = false;
      return { coach_id: COACH, coach_name: S().coach.name, claimed: true };
    },
    async matchUnclaimed() {
      const placeholders = S().students.filter((x) => x.isPlaceholder);
      return placeholders.length === 1 ? { id: placeholders[0].id, name: placeholders[0].name } : null;
    },
    async unclaimedForCode() { return S().students.filter((x) => x.isPlaceholder).map((x) => ({ id: x.id, name: x.name })); },
  },

  plans: {
    async upload(groupId, file) { await wait(); const g = findGroup(groupId); g.annualPlan = { filename: file.name, storagePath: URL.createObjectURL(file), sizeBytes: file.size, status: 'review', date: koutsiTodayStr() }; },
    async url(storagePath) { return storagePath || null; },
    async remove(groupId) { await wait(); findGroup(groupId).annualPlan = null; },
    async uploadShared(coachId, file) {
      await wait();
      const row = { id: newId('ap'), coachId, filename: file.name, storagePath: URL.createObjectURL(file), sizeBytes: file.size, status: 'pending', uploadedAt: nowIso(), handledAt: null };
      S().annualPlanSubmissions.unshift(row);
      return row;
    },
    async submissions() { return clone(S().annualPlanSubmissions); },
  },

  notifications: {
    async list() { return clone(role === 'player' ? S().playerNotifications : S().notifications).map((n) => ({ ...n, date: koutsiFmtShortDate(n.createdAt.slice(0, 10)) })); },
    async markRead() { (role === 'player' ? S().playerNotifications : S().notifications).forEach((n) => { n.read = true; }); },
    async getEmailPrefs() { const s = S(); return { enabled: s.emailPref !== false, off: [...(s.emailOff || [])] }; },
    async setEmailPrefs(id, { enabled, off }) { const s = S(); s.emailPref = Boolean(enabled); s.emailOff = [...(off || [])]; },
    subscribe() { return () => {}; },
  },

  admin: {
    users: notAllowed, feedback: notAllowed, deleteFeedback: notAllowed, deleteUser: notAllowed, actAs: notAllowed,
    groups: notAllowed, bulkInviteCodes: notAllowed, pendingPlans: notAllowed, publishPlan: notAllowed,
    handleSubmission: notAllowed, uploadPlan: notAllowed, usage: notAllowed, usageOverview: notAllowed,
  },
};
