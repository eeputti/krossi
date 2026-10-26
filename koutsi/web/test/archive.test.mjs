// The player's Kehitys archive (what leaves whose view, what "Poista" does) and the month calendar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koutsiTodayStr, koutsiAddDays } from '../src/domain/core.js';
import { koutsiBuildTimeline } from '../src/domain/timeline.js';
import { archiveMap, archivedEvents, coachViewOfArchives, deletePlan, playerOwnsEvent } from '../src/domain/archive.js';
import { monthCalendar, weekStrip } from '../src/domain/monthCal.js';

const today = koutsiTodayStr();
const group = { id: 'g1', name: 'kilparyhmä', durationMinutes: 90, memberIds: ['s1'], themes: [] };
const coachSession = { id: 'c1', date: today, time: '17:00', type: 'Ryhmätreeni', groupId: 'g1', loggedBy: 'coach', absences: [] };
const ownRun = { id: 'o1', date: today, time: '08:00', type: 'Fysiikka', notes: 'Lenkki — 5 km', durationMinutes: 30, groupId: null, studentId: 's1', loggedBy: 'player', absences: [] };
const student = (extra = {}) => ({
  id: 's1', name: 'Maria K.', joinedAt: null,
  moods: [{ id: 'm1', score: 4, at: `${today}T19:00:00`, note: '' }],
  matchNotes: [{ id: 'n1', date: today, at: `${today}T21:00:00`, opponentName: 'Sofia L.', result: 'voitto', score: '6-4' }],
  diary: [{ id: 'd1', at: `${today}T20:00:00`, text: 'Hyvä nousu syötössä.' }],
  homework: [], videos: [], entries: [],
  goalHistory: [{ id: 'g9', at: `${today}T10:00:00`, value: 'Uusi', previousValue: 'Vanha', byPlayer: true }],
  wishHistory: [], noteHistory: [], longGoalHistory: [], ambitionHistory: [{ id: 'a1', at: `${today}T10:01:00`, value: 'kilpailu', previousValue: 'kehitys', byPlayer: true }],
  archive: [], ...extra,
});
// late in the day, so today's 17:00 session has happened (a session still to come is not history)
const lateToday = new Date(); lateToday.setHours(23, 59, 0, 0);
const events = (st) => koutsiBuildTimeline(st, [coachSession, ownRun], [], { now: lateToday });

test('what the player made is theirs; the coach\'s notes and sessions are not', () => {
  const byId = new Map(events(student()).map((e) => [e.id, e]));
  assert.equal(playerOwnsEvent(byId.get('mood-m1')), true);
  assert.equal(playerOwnsEvent(byId.get('match-n1')), true);
  assert.equal(playerOwnsEvent(byId.get('goal-g9')), true);
  assert.equal(playerOwnsEvent(byId.get('training-o1')), true, 'an own logged run');
  assert.equal(playerOwnsEvent(byId.get('training-c1')), false, "the coach's session");
  assert.equal(playerOwnsEvent(byId.get('diary-d1')), false, "the coach's note");
  assert.deepEqual(deletePlan(byId.get('mood-m1')), { action: 'mood', id: 'm1' });
  assert.deepEqual(deletePlan(byId.get('training-o1')), { action: 'training', id: 'o1' });
  assert.deepEqual(deletePlan(byId.get('diary-d1')), { action: 'forget', id: null }, 'the coach keeps their note');
});

test('a change of aim is on the timeline as a goal change, from what to what', () => {
  const aim = events(student()).find((e) => e.id === 'aim-a1');
  assert.equal(aim.kind, 'goal');
  assert.equal(aim.title, 'Tähtäin vaihtui');
  assert.equal(aim.body, 'Pelaan kilpaa');
  assert.equal(aim.previous, 'Haluan kehittyä');
});

test('the archive list holds archived items, newest first, not the ones deleted from it', () => {
  const st = student({ archive: [
    { key: 'mood-m1', archivedAt: `${today}T20:00:00`, removedAt: null },
    { key: 'diary-d1', archivedAt: `${today}T21:00:00`, removedAt: null },
    { key: 'match-n1', archivedAt: `${today}T22:00:00`, removedAt: `${today}T22:30:00` },
  ] });
  const list = archivedEvents(archiveMap(st.archive), events(st));
  assert.deepEqual(list.map((e) => e.id), ['diary-d1', 'mood-m1']);
});

test("the coach no longer sees what the player archived and made, but keeps their own records", () => {
  const st = student({ archive: [
    { key: 'mood-m1', archivedAt: today, removedAt: null },
    { key: 'training-o1', archivedAt: today, removedAt: null },
    { key: 'training-c1', archivedAt: today, removedAt: null },
    { key: 'diary-d1', archivedAt: today, removedAt: null },
  ] });
  const view = coachViewOfArchives({ students: [st], trainings: [coachSession, ownRun], groups: [group] });
  assert.equal(view.students[0].moods.length, 0, 'the mood is gone');
  assert.equal(view.students[0].diary.length, 1, "the coach's note stays");
  assert.deepEqual(view.trainings.map((t) => t.id), ['c1'], "the own run is gone, the coach's session stays");
  const untouched = { students: [student()], trainings: [coachSession], groups: [group] };
  assert.equal(coachViewOfArchives(untouched), untouched, 'nothing archived: the same state');
});

test('the month calendar shows what was done each day, and leaves archived items out', () => {
  const state = { groups: [group], trainings: [coachSession, ownRun], students: [] };
  const now = new Date(`${today}T23:00:00`);
  const [y, m] = today.split('-').map(Number);
  const cal = monthCalendar(state, student(), y, m - 1, { now });
  const day = cal.weeks.flat().find((d) => d.date === today);
  assert.deepEqual(day.items.map((x) => x.kind), ['own', 'coach', 'match'], 'by time: the run, the session, the match');
  assert.equal(day.items[0].activity, 'lenkki');
  assert.equal(cal.activeDays, 1);
  assert.equal(cal.sessions, 1);
  assert.ok(cal.weeks.every((w) => w.length === 7), 'Monday-first full weeks');
  const hidden = new Set(['training-o1']);
  const without = monthCalendar(state, student(), y, m - 1, { now, hidden }).weeks.flat().find((d) => d.date === today);
  assert.deepEqual(without.items.map((x) => x.kind), ['coach', 'match']);
  const week = weekStrip(state, student(), { now });
  assert.equal(week.length, 7);
  assert.equal(week.find((d) => d.isToday).items.length, 3);
  assert.ok(week.filter((d) => d.date > today).every((d) => d.isFuture && d.items.length === 0));
  // tomorrow's session isn't "done" yet
  const later = { ...coachSession, id: 'c2', date: koutsiAddDays(today, 1) };
  const cal2 = monthCalendar({ ...state, trainings: [later] }, student({ matchNotes: [] }), y, m - 1, { now });
  assert.equal(cal2.sessions, 0);
});
