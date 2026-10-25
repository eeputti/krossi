// Suunnittele: the theme grid (groups × weeks) and absences planned ahead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  absenceCandidates, absenceChanges, absenceRangeIds, byWeek, commonTheme, gridWeeks, knownAbsences,
  pickSummary, themeGrid, themeWritePlan, trainingCells,
} from '../src/domain/planning.js';

const w = (week, year = 2026) => ({ year, week });
// Mondays of ISO weeks 44–47 in 2026
const MON = { 44: '2026-10-26', 45: '2026-11-02', 46: '2026-11-09', 47: '2026-11-16' };
const tr = (id, groupId, date, time = '17:00', extra = {}) => ({ id, groupId, date, time, type: 'Ryhmä', loggedBy: 'coach', absences: [], ...extra });

test('gridWeeks rolls over the year', () => {
  assert.deepEqual(gridWeeks(w(52), 3), [w(52), w(53), w(1, 2027)]);
});

test('themeGrid: sessions, a break week and weeks past the calendar', () => {
  const groups = [
    { id: 'b', name: 'B', day: 'Ti', time: '17:00', memberIds: [], themes: [{ id: 't1', ...w(44), title: 'Syöttö', lead: '' }] },
    { id: 'a', name: 'A', day: 'Ma', time: '16:00', memberIds: [], themes: [] },
  ];
  const trainings = [
    tr('1', 'a', MON[44]), tr('2', 'a', MON[46]), // a: break in week 45, nothing after 46
    tr('3', 'b', '2026-10-27'), tr('own', 'b', '2026-11-03', '10:00', { loggedBy: 'player' }),
  ];
  const rows = themeGrid(groups, trainings, gridWeeks(w(44), 4));
  assert.deepEqual(rows.map((r) => r.group.id), ['a', 'b'], 'Monday group first');
  const a = rows[0].cells;
  assert.deepEqual(a.map((c) => c.sessions), [true, false, true, false]);
  assert.deepEqual(a.map((c) => c.gap), [null, 'break', null, 'ended']);
  const b = rows[1].cells;
  assert.equal(b[0].theme.title, 'Syöttö');
  assert.equal(b[1].sessions, false, "a player's own log is not a session of the group");
  assert.equal(trainingCells(a).length, 2);
});

const cell = (groupId, week, theme = null) => ({ key: `${groupId}|${week}`, group: { id: groupId }, week: w(week), theme, sessions: true });

test('commonTheme: one shared title (any case), else null', () => {
  assert.equal(commonTheme([]), null);
  assert.equal(commonTheme([cell('a', 44, { title: 'Syöttö' }), cell('b', 44)]), null);
  const c = commonTheme([cell('a', 44, { title: 'Syöttö', lead: 'x' }), cell('a', 45, { title: 'syöttö ', lead: 'y' })]);
  assert.equal(c.title, 'Syöttö');
  assert.equal(c.mixedLead, true);
  assert.equal(commonTheme([cell('a', 44, { title: 'Syöttö' }), cell('a', 45, { title: 'Volley' })]), null);
});

test('themeWritePlan: empty cells are fresh, other themes need consent, the same theme is skipped', () => {
  const cells = [
    cell('a', 44),
    cell('a', 45, { title: 'Volley', lead: '' }),
    cell('b', 44, { title: 'Syöttö', lead: 'Heitto' }),
    cell('b', 45, { title: 'Syöttö', lead: '' }),
  ];
  const p = themeWritePlan(cells, ' Syöttö ', '');
  assert.deepEqual(p.fresh.map((r) => `${r.groupId}${r.week}`), ['a44']);
  assert.deepEqual(p.replace.map((r) => `${r.groupId}${r.week}`), ['a45']);
  assert.deepEqual(p.conflicts.map((c) => c.key), ['a|45']);
  assert.deepEqual(p.same.map((r) => `${r.groupId}${r.week}`), ['b44', 'b45'], 'an empty lead keeps the own one');

  const lead = themeWritePlan(cells, 'Syöttö', 'Uusi');
  assert.deepEqual(lead.replace.map((r) => `${r.groupId}${r.week}:${r.lead}`), ['a45:Uusi', 'b44:Uusi', 'b45:Uusi']);
  assert.deepEqual(lead.conflicts.map((c) => c.key), ['a|45', 'b|44'], 'another lead on the same title asks too');
});

test('themeWritePlan: renaming the theme the coach opened is not a conflict', () => {
  const cells = [cell('a', 44, { title: 'Syöttö', lead: '' }), cell('a', 45, { title: 'Syöttö', lead: '' })];
  const p = themeWritePlan(cells, 'Syöttö ja palautus', '', 'syöttö');
  assert.equal(p.replace.length, 2);
  assert.equal(p.conflicts.length, 0);
  assert.deepEqual(pickSummary(cells), { groups: 1, weeks: 2, cells: 2 });
});

// ── absences ahead ──
const NOW = new Date(2026, 9, 26, 16, 30); // Mon 26.10.2026 16:30
const absState = () => ({
  students: [{ id: 'lumi', name: 'Lumi P.' }, { id: 'aino', name: 'Aino S.' }],
  groups: [
    { id: 'or', name: 'Oranssi', day: 'Ma', time: '16:00', durationMinutes: 60, memberIds: ['lumi', 'aino'] },
    { id: 'ki', name: 'Kilpa', day: 'Ke', time: '17:00', durationMinutes: 90, memberIds: ['lumi'] },
  ],
  trainings: [
    tr('past', 'or', '2026-10-19', '16:00'),
    tr('now', 'or', MON[44], '16:00'), // on now (ends 17:00): still markable
    tr('ke44', 'ki', '2026-10-28', '17:00', { absences: [{ studentId: 'lumi', reportedBy: 'lumi' }] }),
    tr('ma45', 'or', MON[45], '16:00'),
    tr('ke45', 'ki', '2026-11-04', '17:00', { absences: [{ studentId: 'aino', reportedBy: 'coach' }] }),
    tr('ma46', 'or', MON[46], '16:00'),
    tr('ma47', 'or', MON[47], '16:00'),
    tr('ma49', 'or', '2026-11-30', '16:00'),
    tr('self', null, '2026-10-27', '18:00', { loggedBy: 'player', studentId: 'lumi' }),
  ],
});

test('absenceCandidates: coming coach-run sessions within the window, own marks noticed', () => {
  const c = absenceCandidates(absState(), 'lumi', { now: NOW, days: 28 });
  assert.deepEqual(c.map((x) => x.training.id), ['now', 'ke44', 'ma45', 'ke45', 'ma46', 'ma47']);
  const ke44 = c.find((x) => x.training.id === 'ke44');
  assert.equal(ke44.absent, true);
  assert.equal(ke44.byPlayer, true);
  assert.equal(c.find((x) => x.training.id === 'ke45').absent, false, "another player's absence is not hers");
  const later = absenceCandidates(absState(), 'lumi', { now: new Date(2026, 9, 26, 17, 5), days: 28 });
  assert.equal(later[0].training.id, 'ke44', 'a session that has ended drops out');
});

test('absenceRangeIds: next, this week, 2 and 4 weeks', () => {
  const c = absenceCandidates(absState(), 'lumi', { now: NOW, days: 42 });
  assert.deepEqual(absenceRangeIds(c, 'next', NOW), ['now']);
  assert.deepEqual(absenceRangeIds(c, 'week', NOW), ['now', 'ke44']);
  assert.deepEqual(absenceRangeIds(c, '2vk', NOW), ['now', 'ke44', 'ma45', 'ke45']);
  assert.deepEqual(absenceRangeIds(c, '4vk', NOW), ['now', 'ke44', 'ma45', 'ke45', 'ma46', 'ma47']);
});

test('absenceChanges: newly ticked go away, unticked come back', () => {
  const c = absenceCandidates(absState(), 'lumi', { now: NOW, days: 28 });
  assert.deepEqual(absenceChanges(c, ['ke44', 'ma45', 'ma46']), { away: ['ma45', 'ma46'], back: [] });
  assert.deepEqual(absenceChanges(c, ['ma45']), { away: ['ma45'], back: ['ke44'] });
  assert.deepEqual(byWeek(c).map((b) => [b.week.week, b.items.length]), [[44, 2], [45, 2], [46, 1], [47, 1]]);
});

test('knownAbsences: who is away at coming sessions', () => {
  const k = knownAbsences(absState(), { now: NOW, days: 28 });
  assert.deepEqual(k.map((x) => [x.training.id, x.students.map((s) => s.id)]), [['ke44', ['lumi']], ['ke45', ['aino']]]);
});
