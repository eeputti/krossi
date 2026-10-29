// The numbers a coach reads at one glance (domain/glance.js): the week on Koti's top card, a
// player's month on the player card, and the month calendar with the sessions they missed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koutsiAddIsoWeeks, koutsiCurrentIsoWeek, koutsiPad } from '../src/domain/core.js';
import { weekDates } from '../src/domain/week.js';
import { coachMonthCalendar, playerMonthFacts, weekGlance } from '../src/domain/glance.js';

const student = (id, extra = {}) => ({ id, name: `Pelaaja ${id}`, moods: [], matchNotes: [], entries: [], diary: [], homework: [], ...extra });
const group = (id, memberIds, extra = {}) => ({ id, name: id, day: 'Ma', time: '17:00', durationMinutes: 60, memberIds, slots: [], themes: [], ...extra });
const session = (id, groupId, date, absences = []) => ({ id, date, time: '17:00', type: 'Ryhmätreeni', groupId, loggedBy: 'coach', durationMinutes: 60, absences });
const away = (studentId, by = null) => ({ studentId, reason: 'poissa', reportedBy: by, updatedAt: '' });
const ownLog = (id, studentId, date, notes = 'Lenkki — 5 km') => ({ id, date, time: '07:00', type: 'Fysiikka', groupId: null, studentId, loggedBy: 'player', durationMinutes: 30, notes, absences: [] });

// last week: every session in it is held by now
const lastWeek = koutsiAddIsoWeeks(koutsiCurrentIsoWeek(), -1);
const [mon, tue, wed] = weekDates(lastWeek);

test('the week: held sessions, attendance, own trainings and who trained the most', () => {
  const state = {
    students: [student('s1'), student('s2')],
    groups: [group('g1', ['s1', 's2'])],
    clubEvents: [],
    trainings: [session('a', 'g1', mon), session('b', 'g1', wed, [away('s2')]), ownLog('o1', 's1', tue)],
  };
  const g = weekGlance(state, lastWeek);
  assert.equal(g.days.length, 7);
  assert.equal(g.days[0].sessions.length, 1);
  assert.equal(g.days[0].sessions[0].status, 'past');
  assert.equal(g.held, 2);
  assert.equal(g.sessions, 2);
  assert.equal(g.attendance, 3 / 4);
  assert.equal(g.own, 1);
  // s1: Monday, Wednesday and the own run = 3; s2 trained once, under the bar of two
  assert.deepEqual(g.active.map((a) => [a.student.id, a.times]), [['s1', 3]]);
  assert.deepEqual(g.missedTwice, []);
});

test('a player away from both of their last two sessions is listed, facts only', () => {
  const state = {
    students: [student('s1'), student('s2')],
    groups: [group('g1', ['s1', 's2'])],
    clubEvents: [],
    trainings: [session('a', 'g1', mon, [away('s2')]), session('b', 'g1', wed, [away('s2', 's2')])],
  };
  assert.deepEqual(weekGlance(state, lastWeek).missedTwice.map((s) => s.id), ['s2']);
});

// two months back: a whole month in the past
const back = new Date();
back.setDate(1);
back.setMonth(back.getMonth() - 2);
const Y = back.getFullYear();
const M = back.getMonth();
const day = (d) => `${Y}-${koutsiPad(M + 1)}-${koutsiPad(d)}`;

test("a player's month: attendance, training days a week, own trainings and feeling", () => {
  const s1 = student('s1', { moods: [{ id: 'm1', at: `${day(3)}T19:00:00Z`, score: 4 }, { id: 'm2', at: `${day(10)}T19:00:00Z`, score: 5 }] });
  const state = {
    students: [s1],
    groups: [group('g1', ['s1'])],
    clubEvents: [],
    trainings: [
      session('a', 'g1', day(3)), session('b', 'g1', day(10)), session('c', 'g1', day(17), [away('s1', 's1')]), session('d', 'g1', day(24)),
      ownLog('o1', 's1', day(5)), ownLog('o2', 's1', day(12)),
    ],
  };
  const { current } = playerMonthFacts(state, s1, Y, M);
  assert.equal(current.held, 4);
  assert.equal(current.present, 3);
  assert.equal(current.rate, 75);
  assert.equal(current.own, 2);
  assert.equal(current.moodAverage, 4.5);
  const days = new Date(Y, M + 1, 0).getDate();
  assert.ok(Math.abs(current.perWeek - 5 / (days / 7)) < 1e-9);
});

test('the coach\'s calendar shows the missed session, and who told about it', () => {
  const s1 = student('s1');
  const state = {
    students: [s1],
    groups: [group('g1', ['s1'])],
    clubEvents: [],
    trainings: [session('a', 'g1', day(3)), session('c', 'g1', day(17), [away('s1', 's1')]), ownLog('o1', 's1', day(5))],
  };
  const cal = coachMonthCalendar(state, s1, Y, M);
  const byDate = new Map(cal.weeks.flat().filter((d) => d.inMonth).map((d) => [d.date, d.items]));
  assert.deepEqual(byDate.get(day(3)).map((x) => x.kind), ['coach']);
  assert.deepEqual(byDate.get(day(5)).map((x) => x.kind), ['own']);
  assert.deepEqual(byDate.get(day(17)).map((x) => [x.kind, x.sub]), [['absent', 'Poissa, ilmoitti itse']]);
  assert.equal(cal.missed, 1);
});
