// Viikkohallinta (domain/board.js): which sessions need something, side-by-side lanes for
// overlapping sessions, the grid's hours with empty stretches folded, and club events as bars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koutsiAddIsoWeeks, koutsiIsoWeekOfDateStr, koutsiTodayStr, koutsiAddDays } from '../src/domain/core.js';
import { weekDates } from '../src/domain/week.js';
import { assignLanes, eventRangeLabel, gridHours, weekBoard, weekEvents } from '../src/domain/board.js';

// a week that is wholly ahead, so nothing in it counts as held yet
const week = koutsiAddIsoWeeks(koutsiIsoWeekOfDateStr(koutsiTodayStr()), 2);
const [mon, tue, wed] = weekDates(week);
const later = weekDates(koutsiAddIsoWeeks(week, 3))[1];
const group = (id, extra) => ({ id, name: id, day: 'Ti', time: '17:00', durationMinutes: 60, memberIds: ['s1'], slots: [], themes: [], ...extra });
const session = (id, groupId, date, time = '17:00', extra = {}) => ({ id, date, time, type: 'Ryhmätreeni', groupId, loggedBy: 'coach', absences: [], ...extra });

test('a session is fine with a theme and players, and says what is missing otherwise', () => {
  const groups = [
    group('ok', { themes: [{ year: week.year, week: week.week, title: 'Kakkossyöttö' }] }),
    group('no-theme'),
    group('no-players', { memberIds: [] }),
  ];
  const state = {
    groups, students: [], clubEvents: [],
    trainings: groups.flatMap((g) => [session(`${g.id}-1`, g.id, tue), session(`${g.id}-2`, g.id, later)]),
  };
  const items = weekBoard(state, week).days[1].items;
  const byGroup = Object.fromEntries(items.map((it) => [it.group.id, it]));
  assert.equal(byGroup.ok.tone, 'ok');
  assert.deepEqual(byGroup['no-theme'].issues.map((i) => i.id), ['theme']);
  assert.ok(byGroup['no-players'].issues.some((i) => i.id === 'players'));
});

test("a group's last session on the calendar warns that the calendar runs out", () => {
  const g = group('g1');
  const state = { groups: [g], students: [], clubEvents: [], trainings: [session('only', 'g1', tue)] };
  const it = weekBoard(state, week).days[1].items[0];
  assert.equal(it.tone, 'issue');
  assert.ok(it.issues.some((i) => i.id === 'last'));
  // the week after: the usual session is missing and the calendar has run out
  const next = weekBoard(state, koutsiAddIsoWeeks(week, 1)).days[1].items[0];
  assert.equal(next.kind, 'missing');
  assert.deepEqual(next.issues.map((i) => i.id), ['ended']);
});

test('a missing session in a week off is quiet when the calendar goes on after it', () => {
  const g = group('g1');
  const state = { groups: [g], students: [], clubEvents: [], trainings: [session('before', 'g1', koutsiAddDays(tue, -7)), session('after', 'g1', koutsiAddDays(tue, 7))] };
  const it = weekBoard(state, week).days[1].items[0];
  assert.equal(it.kind, 'missing');
  assert.equal(it.tone, 'missing');
  assert.deepEqual(it.issues, []);
});

test('private lessons are on the week, a player\'s own log is not', () => {
  const state = {
    groups: [], students: [{ id: 's1', name: 'Maria K.' }], clubEvents: [],
    trainings: [
      { id: 'p1', date: wed, time: '15:30', type: 'Yksityistunti', durationMinutes: 45, groupId: null, studentId: 's1', loggedBy: 'coach', absences: [] },
      { id: 'own', date: wed, time: '09:00', type: 'Fysiikka', groupId: null, studentId: 's1', loggedBy: 'player', absences: [] },
    ],
  };
  const board = weekBoard(state, week);
  assert.deepEqual(board.days[2].items.map((it) => [it.kind, it.student?.name, it.end - it.start]), [['private', 'Maria K.', 45]]);
  assert.equal(board.sessions, 1);
});

test('overlapping sessions share the column side by side', () => {
  const items = assignLanes([
    { id: 'a', start: 16 * 60, end: 17 * 60 },
    { id: 'b', start: 16 * 60 + 30, end: 17 * 60 + 30 },
    { id: 'c', start: 17 * 60, end: 18 * 60 },
    { id: 'd', start: 19 * 60, end: 20 * 60 },
  ]);
  const lanes = Object.fromEntries(items.map((it) => [it.id, `${it.lane}/${it.lanes}`]));
  assert.deepEqual(lanes, { a: '0/2', b: '1/2', c: '0/2', d: '0/1' });
});

test('the grid spans the sessions in whole hours and folds long empty stretches', () => {
  const grid = gridHours([{ start: 2 * 60 + 30, end: 3 * 60 + 30 }, { start: 13 * 60, end: 14 * 60 }, { start: 18 * 60, end: 19 * 60 + 30 }]);
  assert.equal(grid.startH, 2);
  assert.equal(grid.endH, 20);
  assert.deepEqual(grid.rows.map((r) => `${r.type}:${r.from}-${r.to}`), ['hours:2-4', 'fold:4-13', 'hours:13-14', 'fold:14-18', 'hours:18-20']);
  assert.deepEqual(grid.at(13 * 60 + 30), { h: 2.5, g: 1 });
  assert.deepEqual(grid.at(18 * 60), { h: 3, g: 2 });
  // a short gap is kept, and a lone session still gets a few hours of room
  assert.deepEqual(gridHours([{ start: 16 * 60, end: 17 * 60 }, { start: 18 * 60, end: 19 * 60 }]).rows.map((r) => r.type), ['hours']);
  const lone = gridHours([{ start: 17 * 60, end: 18 * 60 }]);
  assert.equal(lone.endH - lone.startH, 4);
  assert.equal(lone.folds, 0);
});

test('club events become bars over the days they cover, stacked when they overlap', () => {
  const dates = weekDates(week);
  const { bars, rows } = weekEvents({ clubEvents: [
    { id: 'camp', title: 'Leiri', date: koutsiAddDays(mon, -2), endDate: tue, kind: 'leiri' },
    { id: 'cup', title: 'Kisat', date: mon, endDate: null, kind: 'kilpailu' },
    { id: 'far', title: 'Muu', date: koutsiAddDays(mon, 30), endDate: null, kind: 'seura' },
  ] }, dates);
  assert.deepEqual(bars.map((b) => [b.event.id, b.from, b.to, b.row]), [['camp', 0, 1, 0], ['cup', 0, 0, 1]]);
  assert.equal(rows, 2);
  // the camp began last week, so its bar says it goes on from the left edge
  assert.deepEqual(bars.map((b) => [b.before, b.after]), [[true, false], [false, false]]);
});

test('an event names its days, the month once when both ends share it', () => {
  assert.equal(eventRangeLabel({ date: '2026-10-24', endDate: null }), 'la 24.10.');
  assert.equal(eventRangeLabel({ date: '2026-10-16', endDate: '2026-10-18' }), 'pe 16.–su 18.10.');
  assert.equal(eventRangeLabel({ date: '2026-10-29', endDate: '2026-11-01' }), 'to 29.10.–su 1.11.');
  assert.equal(eventRangeLabel({ date: '2026-10-24', endDate: '2026-10-24' }), 'la 24.10.');
});
