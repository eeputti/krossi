// The player's week (Treenit): own logs keep the old categories in `type` and say what was done
// first in `notes`; the week puts coach sessions and own logs on one grid, tournaments, matches
// and club events over the days; a tap on the grid lands on a quarter hour — and the demo edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITIES, activityById, ownEntry, ownNotes, dayGrid, layBars, playerWeek, defaultLogTime } from '../src/domain/ownWeek.js';
import { koutsiIsoWeekOfDateStr } from '../src/domain/core.js';
import { weekDates } from '../src/domain/week.js';
import { backend as demo, configureDemo } from '../src/api/demo/index.js';

test('every activity that writes a row uses one of the old categories', () => {
  const old = ['Omatoiminen harjoitus', 'Fysiikka', 'Muu liikunta', 'Turnaus'];
  for (const a of ACTIVITIES) {
    if (a.match) { assert.equal(a.type, undefined); continue; }
    assert.ok(old.includes(a.type), `${a.id}: ${a.type}`);
    if (!a.allDay) assert.ok(a.duration % 15 === 0 && a.duration > 0, a.id);
  }
});

test('what was done reads back from the notes, old rows included', () => {
  for (const [activity, text] of [['lenkki', '5 km rauhallisesti'], ['sali', ''], ['liikkuvuus', 'Rullaus'], ['kotilaksy', '20 kakkossyöttöä'], ['tennis', 'Seinää vasten'], ['muu', 'Sulkapallo']]) {
    const a = activityById(activity);
    const e = ownEntry({ type: a.type, notes: ownNotes(activity, text) });
    assert.equal(e.activity, activity);
    assert.equal(e.text, text);
  }
  assert.equal(ownNotes('lenkki', '  5 km '), 'Lenkki — 5 km');
  assert.equal(ownNotes('lenkki', ''), 'Lenkki');
  // written by the old app or before this change
  assert.deepEqual(ownEntry({ type: 'Fysiikka', notes: 'Kuntosali — jalat ja keskivartalo.' }), { activity: 'sali', title: 'Kuntosali', text: 'jalat ja keskivartalo.' });
  assert.deepEqual(ownEntry({ type: 'Fysiikka', notes: 'Juoksu 5 km' }), { activity: 'fysiikka', title: 'Fysiikka', text: 'Juoksu 5 km' });
  assert.deepEqual(ownEntry({ type: 'Muu liikunta', notes: '' }), { activity: 'muu', title: 'Muu laji', text: '' });
  assert.deepEqual(ownEntry({ type: 'Turnaus', notes: 'PM-kisat' }), { activity: 'turnaus', title: 'PM-kisat', text: '' });
  // a word inside another word is not an activity
  assert.equal(ownEntry({ type: 'Fysiikka', notes: 'Lenkkipolku metsässä' }).activity, 'fysiikka');
});

test('the day grid runs 8–21 unless something falls outside, and a tap lands on a quarter hour', () => {
  const g = dayGrid([]);
  assert.equal(g.startH, 8);
  assert.equal(g.endH, 21);
  assert.deepEqual(g.at(9 * 60 + 30), { h: 1.5, g: 0 });
  assert.equal(g.minuteAt(56 * 2.6, 56), 10 * 60 + 30);
  assert.equal(g.minuteAt(-20, 56), 8 * 60);
  assert.equal(g.minuteAt(56 * 40, 56), 21 * 60 - 15);
  const early = dayGrid([{ start: 6 * 60 + 30, end: 7 * 60 }, { start: 21 * 60, end: 22 * 60 + 30 }]);
  assert.equal(early.startH, 6);
  assert.equal(early.endH, 23);
});

test('bars over the days stack only when they overlap', () => {
  const dates = weekDates({ year: 2026, week: 43 });
  const { bars, rows } = layBars([
    { key: 'a', date: '2026-10-17', endDate: '2026-10-20' },
    { key: 'b', date: '2026-10-21', endDate: null },
    { key: 'c', date: '2026-10-20', endDate: '2026-10-21' },
    { key: 'd', date: '2026-11-02', endDate: null },
  ], dates);
  assert.equal(rows, 2);
  const by = Object.fromEntries(bars.map((b) => [b.key, b]));
  assert.equal(by.d, undefined);
  assert.deepEqual([by.a.from, by.a.to, by.a.before, by.a.row], [0, 1, true, 0]);
  assert.deepEqual([by.c.from, by.c.to, by.c.row], [1, 2, 1]);
  assert.equal(by.b.row, 0);
});

test('a log made now starts an hour ago, on a quarter hour', () => {
  const now = new Date(2026, 9, 21, 18, 40);
  assert.equal(defaultLogTime('2026-10-21', now, '2026-10-21'), '17:30');
  assert.equal(defaultLogTime('2026-10-20', now, '2026-10-21'), '17:00');
  assert.equal(defaultLogTime('2026-10-21', new Date(2026, 9, 21, 5, 0), '2026-10-21'), '06:00');
});

test('demo: the player logs a run, sees it on the week with the coach sessions, edits and removes it', async () => {
  configureDemo({ role: 'player', latency: 0 });
  let state = await demo.player.load('demo-s-maria');
  const me = state.students[0];
  const date = state.trainings.find((t) => t.loggedBy !== 'player' && t.groupId).date;
  const week = koutsiIsoWeekOfDateStr(date);
  const before = playerWeek(state, me, week).summary;
  await demo.player.addSelfTraining({ studentId: me.id, coachId: state.coaches[0].id, date, endDate: null, time: '07:00', type: 'Fysiikka', durationMinutes: 30, notes: ownNotes('lenkki', '5 km') });
  state = await demo.player.load('demo-s-maria');
  const w = playerWeek(state, state.students[0], week);
  assert.equal(w.summary.own, before.own + 1);
  assert.equal(w.summary.ownMinutes, before.ownMinutes + 30);
  assert.ok(w.summary.coach > 0);
  assert.equal(w.grid.startH, 7);
  const day = w.days.find((d) => d.date === date);
  const run = day.items.find((it) => it.kind === 'own' && it.activity === 'lenkki');
  assert.equal(run.title, 'Lenkki');
  assert.equal(run.tone, 'own');
  assert.ok(day.items.some((it) => it.kind === 'coach'));

  await demo.player.updateSelfTraining(run.training.id, { coachId: state.coaches[0].id, date, endDate: null, time: '08:15', type: 'Fysiikka', durationMinutes: 45, notes: ownNotes('sali', '') });
  state = await demo.player.load('demo-s-maria');
  const edited = state.trainings.find((t) => t.id === run.training.id);
  assert.equal(edited.time, '08:15');
  assert.equal(ownEntry(edited).activity, 'sali');
  await assert.rejects(demo.player.updateSelfTraining(state.trainings.find((t) => t.loggedBy !== 'player').id, { date, time: '08:00', type: 'Fysiikka' }), /Merkintää ei löytynyt/);
  await demo.player.deleteSelfTraining(run.training.id);
  state = await demo.player.load('demo-s-maria');
  assert.equal(playerWeek(state, state.students[0], week).summary.own, before.own);
});

test("a coach's timeline names the player's run, not its category", async () => {
  const { koutsiBuildTimeline } = await import('../src/domain/timeline.js');
  const s = { id: 's1', name: 'Maria', joinedAt: null, diary: [], homework: [], videos: [], moods: [], matchNotes: [], goalHistory: [], wishHistory: [], noteHistory: [] };
  const run = { id: 'r1', date: '2026-10-01', time: '07:00', type: 'Fysiikka', loggedBy: 'player', durationMinutes: 30, notes: ownNotes('lenkki', '5 km'), studentId: 's1', absences: [] };
  const old = { ...run, id: 'r2', notes: 'Juoksu' };
  const tl = koutsiBuildTimeline(s, [run, old], [], { viewer: 'coach' });
  assert.deepEqual([tl.find((e) => e.id === 'training-r1').title, tl.find((e) => e.id === 'training-r1').body], ['Lenkki', '30 min, 5 km']);
  assert.deepEqual([tl.find((e) => e.id === 'training-r2').title, tl.find((e) => e.id === 'training-r2').body], ['Fysiikka', '30 min, Juoksu']);
});
