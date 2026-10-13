// Behaviour the renewed app adds on top of the old one: when a session counts as over, what a
// player is offered before and after it, the calendar-running-out alert, and timeline wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koutsiTodayStr, koutsiAddDays, koutsiCurrentIsoWeek, koutsiAddIsoWeeks } from '../src/domain/core.js';
import { sessionStatus, calendarEndings, themeWeekRelative, themeWeekLabel } from '../src/domain/week.js';
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
