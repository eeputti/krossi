// Behaviour the renewed app adds on top of the old one: when a session counts as over, what a
// player is offered before and after it, the calendar-running-out alert, and timeline wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koutsiTodayStr, koutsiAddDays, koutsiCurrentIsoWeek, koutsiAddIsoWeeks } from '../src/domain/core.js';
import {
  sessionStatus, calendarEndings, themeWeekRelative, themeWeekLabel, merkitseContext, attendanceSession, presentPlayerIds,
  todayTimeline, minutesLabel, groupWeekBoard, weekDates,
} from '../src/domain/week.js';
import { upcomingSessions, checkInCandidate } from '../src/domain/player.js';
import { koutsiBuildTimeline } from '../src/domain/timeline.js';

const today = koutsiTodayStr();
const at = (hhmm) => new Date(`${today}T${hhmm}:00`);
const group = { id: 'g1', name: 'tiistai aikuiset', day: 'Ti', time: '17:00', durationMinutes: 90, memberIds: ['s1'], themes: [] };
const session = (id, date, time = '17:00', extra = {}) => ({ id, date, time, type: 'Ryhmätreeni', groupId: 'g1', loggedBy: 'coach', absences: [], ...extra });
const student = (extra = {}) => ({ id: 's1', name: 'Maria K.', moods: [], homework: [], matchNotes: [], diary: [], videos: [], ...extra });

test('a session is upcoming until it starts, running until its end, then over', () => {
  const t = session('t1', today);
  assert.equal(sessionStatus(t, group, at('16:59')), 'upcoming');
  assert.equal(sessionStatus(t, group, at('17:00')), 'now');
  assert.equal(sessionStatus(t, group, at('18:29')), 'now');
  assert.equal(sessionStatus(t, group, at('18:30')), 'past');
  assert.equal(sessionStatus(session('t2', koutsiAddDays(today, -1)), group, at('09:00')), 'past');
  assert.equal(sessionStatus(session('t3', koutsiAddDays(today, 1)), group, at('23:00')), 'upcoming');
});

test("a session that ended earlier today is no longer the player's next one", () => {
  const state = { groups: [group], trainings: [session('t1', today), session('t2', koutsiAddDays(today, 7))], students: [student()] };
  assert.deepEqual(upcomingSessions(state, 's1', at('16:00')).map((t) => t.id), ['t1', 't2']);
  assert.deepEqual(upcomingSessions(state, 's1', at('19:00')).map((t) => t.id), ['t2']);
});

test('"Miten treeni meni?" is asked once a session is over, and not again after a mood', () => {
  const t = session('t1', today);
  const state = { groups: [group], trainings: [t], students: [] };
  assert.equal(checkInCandidate(state, student(), new Set(), at('18:00')), null, 'not while it is still running');
  assert.equal(checkInCandidate(state, student(), new Set(), at('18:31'))?.id, 't1');
  const after = student({ moods: [{ id: 'm1', score: 4, at: at('18:45').toISOString() }] });
  assert.equal(checkInCandidate(state, after, new Set(), at('19:00')), null);
  const absent = { ...state, trainings: [{ ...t, absences: [{ studentId: 's1', reason: 'poissa' }] }] };
  assert.equal(checkInCandidate(absent, student(), new Set(), at('19:00')), null, 'not for a session the player missed');
  assert.equal(checkInCandidate(state, student(), new Set(['t1']), at('19:00')), null, 'not after dismissing it');
});

test('the calendar alert lists groups whose sessions run out within six weeks', () => {
  const g2 = { ...group, id: 'g2', name: 'torstai aikuiset', day: 'To' };
  const state = {
    groups: [group, g2],
    trainings: [
      session('a', koutsiAddDays(today, 7)), session('b', koutsiAddDays(today, 20)),
      session('c', koutsiAddDays(today, 7), '18:00', { groupId: 'g2' }), session('d', koutsiAddDays(today, 120), '18:00', { groupId: 'g2' }),
      // a player's own log on the group's day doesn't keep its calendar alive
      session('e', koutsiAddDays(today, 200), '12:00', { loggedBy: 'player' }),
    ],
  };
  const endings = calendarEndings(state, 42);
  assert.deepEqual(endings.map((e) => [e.group.id, e.last]), [['g1', koutsiAddDays(today, 20)]]);
});

test('week labels say which week it is relative to today', () => {
  const now = koutsiCurrentIsoWeek();
  assert.equal(themeWeekRelative(now), 'Tämä viikko');
  assert.equal(themeWeekRelative(koutsiAddIsoWeeks(now, 1)), 'Ensi viikko');
  assert.equal(themeWeekRelative(koutsiAddIsoWeeks(now, -1)), 'Viime viikko');
  assert.equal(themeWeekRelative(koutsiAddIsoWeeks(now, 3)), '');
  assert.match(themeWeekLabel(now), /^vko \d+ · .+ \(tämä viikko\)$/);
});

test("the timeline speaks to its reader and shows what a player's own session was", () => {
  const s = student({ joinedAt: `${koutsiAddDays(today, -30)}T10:00:00Z` });
  const own = { id: 'o1', date: koutsiAddDays(today, -1), time: '12:00', type: 'Omatoiminen harjoitus', loggedBy: 'player', durationMinutes: 30, notes: 'Rystyn varjolyöntejä', studentId: 's1', absences: [] };
  const mine = koutsiBuildTimeline(s, [own], []);
  assert.equal(mine.find((e) => e.kind === 'start').title, 'Aloitit Krossi Koutsissa');
  assert.equal(mine.find((e) => e.id === 'training-o1').body, '30 min · Rystyn varjolyöntejä');
  const coachView = koutsiBuildTimeline(s, [own], [], { viewer: 'coach' });
  assert.equal(coachView.find((e) => e.kind === 'start').title, 'Aloitti Krossi Koutsissa');
  // a coach-run session never shows the coach's free-text notes as if the player wrote them
  const coachSession = { ...session('c1', koutsiAddDays(today, -2)), notes: 'sisäinen muistiinpano', studentId: null };
  assert.equal(koutsiBuildTimeline(s, [coachSession], []).find((e) => e.id === 'training-c1').body.includes('sisäinen'), false);
});

test('a check-in counts only feelings given after the session began', async () => {
  const { moodAfter } = await import('../src/player/checkin.js');
  const t = session('t1', today, '17:00');
  const before = { id: 'm0', score: 2, at: at('16:00').toISOString() };
  const after = { id: 'm1', score: 4, at: at('18:40').toISOString() };
  assert.equal(moodAfter(student({ moods: [before] }), t), null);
  assert.equal(moodAfter(student({ moods: [after, before] }), t)?.id, 'm1');
});

test('"Viikko paketissa" counts held sessions, attendance, feelings and wishes of that week', async () => {
  const { weekRecap, weekDates } = await import('../src/domain/week.js');
  const week = koutsiCurrentIsoWeek();
  const [monday] = weekDates(week);
  const g = { ...group, memberIds: ['s1', 's2'] };
  const s2 = { ...student(), id: 's2', name: 'Leo K.' };
  const s1 = student({
    moods: [{ id: 'm1', score: 5, at: `${monday}T18:00:00` }, { id: 'm0', score: 1, at: `${koutsiAddDays(monday, -3)}T18:00:00` }],
    wishHistory: [{ at: `${monday}T19:00:00`, value: 'Lisää verkkopeliä' }],
  });
  const state = {
    groups: [g], students: [s1, s2],
    trainings: [
      session('a', monday, '10:00', { absences: [{ studentId: 's2', reason: 'poissa' }] }),
      session('b', koutsiAddDays(monday, 7), '10:00'), // next week
    ],
  };
  const recap = weekRecap(state, week, new Date(`${koutsiAddDays(monday, 6)}T23:00:00`));
  assert.equal(recap.sessions, 1);
  assert.equal(recap.held, 1);
  assert.equal(recap.done, true);
  assert.equal(recap.attendance, 0.5);
  assert.equal(recap.moodCount, 1);
  assert.equal(recap.moodAverage, 5);
  assert.deepEqual(recap.wishes.map((w) => w.text), ['Lisää verkkopeliä']);
});

test('the recap opens once the week is over, not after a diary entry or once closed', async () => {
  const { recapWeekDue, weekDates } = await import('../src/domain/week.js');
  const week = koutsiCurrentIsoWeek();
  const [monday] = weekDates(week);
  const state = { groups: [group], students: [student()], trainings: [session('a', monday, '00:00')], weekNotes: [] };
  const after = new Date(`${koutsiAddDays(monday, 6)}T23:59:00`);
  const never = () => false;
  // the week's only session (Monday 00:00–01:30) is over by Sunday evening
  assert.deepEqual(recapWeekDue(state, never, after), week);
  assert.equal(recapWeekDue({ ...state, weekNotes: [{ ...week, score: 4 }] }, never, after), null, 'already in the diary');
  assert.equal(recapWeekDue(state, () => true, after), null, 'already closed');
  // a session still to come on Sunday night keeps this week's recap closed (and last week had none)
  const later = { ...state, trainings: [...state.trainings, session('b', koutsiAddDays(monday, 6), '23:30')] };
  if (koutsiTodayStr() < koutsiAddDays(monday, 6)) {
    assert.equal(recapWeekDue(later, never, new Date(`${monday}T12:00:00`)), null, 'not while sessions are still to come');
  }
});

test('the Merkitse menu leads with the session on now, then one just over, then the day', () => {
  const state = { groups: [group], students: [student()], trainings: [session('t1', today, '09:00'), session('t2', today, '17:00')] };
  const ctx = (hhmm) => merkitseContext(state, at(hhmm));
  const kind = (hhmm) => ctx(hhmm)?.kind;
  const sunday = new Date(at('12:00')).getDay() === 0;
  assert.equal(kind('08:00'), 'next');
  assert.equal(ctx('08:00').items[0].training.id, 't1');
  assert.equal(kind('09:30'), 'now');
  assert.equal(kind('11:00'), 'ended', 'within two hours of the end (10:30)');
  assert.equal(kind('12:31'), 'next', 'more than two hours after: the next session today');
  assert.equal(ctx('12:31').items[0].training.id, 't2');
  assert.equal(kind('18:00'), 'now');
  assert.equal(kind('19:00'), 'ended');
  assert.equal(ctx('19:00').items[0].training.id, 't2', 'the latest one first');
  assert.equal(kind('21:00'), sunday ? 'week' : 'day', "after the day's last session: the day's summary (on Sundays the week's)");
  assert.equal(merkitseContext({ ...state, trainings: [] }, at('12:00'))?.kind ?? null, sunday ? 'week' : null);
});

test('a note after a session goes to the players who were there; Läsnäolo opens today\'s session', () => {
  const g = { ...group, memberIds: ['s1', 's2'] };
  const s2 = { ...student(), id: 's2', name: 'Onni V.' };
  const t = session('t1', today, '09:00', { absences: [{ studentId: 's2', reason: 'poissa' }] });
  const state = { groups: [g], students: [student(), s2], trainings: [t, session('t2', today, '17:00')] };
  assert.deepEqual(presentPlayerIds(state, t), ['s1']);
  assert.equal(attendanceSession(state, at('09:30')).training.id, 't1');
  assert.equal(attendanceSession(state, at('14:00')).training.id, 't1', "today's latest held session");
  assert.equal(attendanceSession(state, at('08:00')).training.id, 't1', "before anything: today's next one");
  assert.equal(attendanceSession({ ...state, trainings: [] }, at('12:00')), null);
});

test("today's timeline says which sessions are over, running and still to come", () => {
  const g2 = { ...group, id: 'g2', name: 'keskiviikon keijot', time: '15:00', durationMinutes: 60, memberIds: ['s1', 's2'] };
  const state = {
    groups: [group, g2],
    students: [student(), student({ id: 's2', name: 'Leo K.' })],
    trainings: [
      session('late', today, '19:00'),
      session('early', today, '15:00', { groupId: 'g2', absences: [{ studentId: 's2', reason: 'poissa' }] }),
      session('mid', today, '17:00'),
      session('own', today, '12:00', { loggedBy: 'player', groupId: null, studentId: 's1' }),
    ],
  };
  const line = todayTimeline(state, at('17:30'));
  assert.deepEqual(line.map((x) => [x.training.id, x.status]), [['early', 'past'], ['mid', 'now'], ['late', 'upcoming']], "a player's own log is not on the coach's timeline");
  assert.equal(line[0].end, '16:00');
  assert.deepEqual([line[0].roster, line[0].present, line[0].progress], [2, 1, 1]);
  assert.equal(line[1].minutesLeft, 60);
  assert.equal(Math.round(line[1].progress * 100), 33);
  assert.equal(line[2].minutesUntil, 90);
  assert.equal(minutesLabel(25), '25 min');
  assert.equal(minutesLabel(60), '1 h');
  assert.equal(minutesLabel(115), '1 h 55 min');
});

test('the Ryhmät week board puts every group under the days it trains, and shows a missing session', () => {
  const week = koutsiCurrentIsoWeek();
  const [mon, tue, wed, thu] = weekDates(week);
  const nextWeek = weekDates(koutsiAddIsoWeeks(week, 1));
  const tueGroup = { ...group, slots: [{ id: 'x', day: 'To', time: '18:00', durationMinutes: 60 }] };
  const wedGroup = { ...group, id: 'g2', name: 'keskiviikon keijot', day: 'Ke', time: '15:00', durationMinutes: 60, slots: [] };
  const newGroup = { ...group, id: 'g3', name: 'uusi ryhmä', day: 'Ma', time: '10:00', slots: [] };
  const noDay = { ...group, id: 'g4', name: 'leiri', day: '', time: '', slots: [] };
  const empty = { ...group, id: 'g5', name: 'ilman treenejä', day: 'Pe', time: '09:00', slots: [] };
  const state = {
    groups: [tueGroup, wedGroup, newGroup, noDay, empty],
    students: [],
    trainings: [
      session('t-tue', tue), // Tuesday's session is there, Thursday's extra slot is not
      session('t-moved', thu, '12:00', { groupId: 'g2' }), // Wednesday's session moved to Thursday
      session('t-new', nextWeek[0], '10:00', { groupId: 'g3' }), // starts next week
      session('t-own', mon, '09:00', { groupId: null, loggedBy: 'player', studentId: 's1' }),
    ],
  };
  const { days, loose } = groupWeekBoard(state, week);
  const cell = (date) => days.find((d) => d.date === date).items.map((it) => `${it.group.id}${it.missing ? `:${it.why}` : ''}`);
  assert.deepEqual(cell(mon), [], 'a group that starts next week is not on this week, nor a player\'s own log');
  assert.deepEqual(cell(tue), ['g1']);
  assert.deepEqual(cell(wed), ['g2:day'], "the moved session's usual day says there is no session that day");
  assert.deepEqual(cell(thu), ['g2', 'g1:day'], 'the moved session sits on its new day, by time');
  assert.deepEqual(cell(days[4].date), ['g5:none'], 'a group with nothing on the calendar still shows on its day');
  assert.deepEqual(loose.map((g) => g.id), ['g4']);
  const later = groupWeekBoard(state, koutsiAddIsoWeeks(week, 2));
  assert.deepEqual(later.days[1].items.map((it) => `${it.group.id}:${it.why}`), ['g1:week'], 'a calendar that ran out shows on the day');
  assert.equal(later.days[0].items[0].group.id, 'g3');
  assert.equal(later.days[0].items[0].why, 'week');
});
