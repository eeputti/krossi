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

// ── Excel-like editing ──
import {
  boundsOf, cellsIn, changesToWrites, clipFromText, clipOf, clipToText, effectiveChanges, fillChanges,
  pasteChanges, pickedRect, rectOf, snapshotOf, undoWrites, withLead,
} from '../src/domain/planning.js';

// 3 groups × 4 weeks (44–47); group c has a break in week 46
const xlGroups = () => [
  { id: 'a', name: 'A', day: 'Ma', time: '16:00', memberIds: [], themes: [{ id: 'ta44', ...w(44), title: 'Syöttö', lead: 'Heitto' }, { id: 'ta45', ...w(45), title: 'Palautus', lead: '' }] },
  { id: 'b', name: 'B', day: 'Ti', time: '16:00', memberIds: [], themes: [] },
  { id: 'c', name: 'C', day: 'Ke', time: '16:00', memberIds: [], themes: [{ id: 'tc47', ...w(47), title: 'Volley', lead: '' }] },
];
const xlTrainings = () => {
  const out = [];
  for (const [g, day] of [['a', 0], ['b', 1], ['c', 2]]) {
    for (const wk of [44, 45, 46, 47]) {
      if (g === 'c' && wk === 46) continue; // c: break
      const d = new Date(`${MON[wk]}T12:00:00`); d.setDate(d.getDate() + day);
      out.push(tr(`${g}${wk}`, g, d.toISOString().slice(0, 10)));
    }
  }
  return out;
};
const xlRows = (groups = xlGroups()) => themeGrid(groups, xlTrainings(), gridWeeks(w(44), 4));
const keysOf = (cells) => cells.map((c) => c.key);
const at = (rows, r, c) => rows[r].cells[c];

test('cellsIn / pickedRect: blocks skip break weeks; a scattered pick is no block', () => {
  const rows = xlRows();
  const rect = rectOf({ r: 2, c: 3 }, { r: 1, c: 1 });
  assert.deepEqual(rect, { r0: 1, r1: 2, c0: 1, c1: 3 });
  const cells = cellsIn(rows, rect);
  assert.equal(cells.length, 5, 'c46 (break) is left out');
  assert.deepEqual(pickedRect(rows, keysOf(cells)), rect);
  assert.equal(pickedRect(rows, [at(rows, 0, 0).key, at(rows, 2, 3).key]), null);
  assert.deepEqual(boundsOf(rows, [at(rows, 0, 0).key, at(rows, 2, 3).key]), { r0: 0, r1: 2, c0: 0, c1: 3 });
});

test('withLead keeps the own lead on the same title; effectiveChanges drops no-ops', () => {
  const rows = xlRows();
  const a44 = at(rows, 0, 0);
  assert.deepEqual(withLead(a44, { title: 'syöttö' }), { title: 'syöttö', lead: 'Heitto' });
  assert.deepEqual(withLead(a44, { title: 'Volley' }), { title: 'Volley', lead: '' });
  assert.equal(withLead(a44, { title: '   ' }), null);
  const eff = effectiveChanges([
    { cell: a44, theme: { title: 'Syöttö', lead: 'Heitto' } }, // same → dropped
    { cell: at(rows, 1, 0), theme: null }, // empty already → dropped
    { cell: at(rows, 0, 1), theme: null }, // clears Palautus
    { cell: at(rows, 1, 1), theme: { title: 'Syöttö', lead: '' } },
  ]);
  assert.equal(eff.length, 2);
  assert.deepEqual(changesToWrites(eff), {
    save: [{ groupId: 'b', year: 2026, week: 45, title: 'Syöttö', lead: '' }],
    remove: ['ta45'],
  });
});

test('fillChanges: drag right repeats the pattern; drag down copies; empty sources and breaks skipped', () => {
  const rows = xlRows();
  // a44..a45 (Syöttö, Palautus) dragged to week 47 → a46 Syöttö, a47 Palautus
  const right = fillChanges(rows, { r0: 0, r1: 0, c0: 0, c1: 1 }, { r: 0, c: 3 });
  assert.deepEqual(right.rect, { r0: 0, r1: 0, c0: 0, c1: 3 });
  assert.deepEqual(right.changes.map((x) => `${x.cell.key}=${x.theme.title}`), ['a|2026-46=Syöttö', 'a|2026-47=Palautus']);
  // a45 dragged down to c → b45, c45 get Palautus
  const down = fillChanges(rows, { r0: 0, r1: 0, c0: 1, c1: 1 }, { r: 2, c: 1 });
  assert.deepEqual(down.changes.map((x) => x.cell.key), ['b|2026-45', 'c|2026-45']);
  // a45 dragged down over c46 column? week 46 of c is a break: nothing written there
  const breakCol = fillChanges(rows, { r0: 0, r1: 0, c0: 2, c1: 2 }, { r: 2, c: 2 });
  assert.equal(breakCol.changes.length, 0, 'a46 is empty: nothing to copy');
  // diagonal drag picks the longer axis
  assert.deepEqual(fillChanges(rows, { r0: 0, r1: 0, c0: 0, c1: 0 }, { r: 1, c: 3 }).rect, { r0: 0, r1: 0, c0: 0, c1: 3 });
  assert.equal(fillChanges(rows, { r0: 0, r1: 0, c0: 0, c1: 0 }, { r: 0, c: 0 }).changes.length, 0);
});

test('copy as text, paste from Excel: one value fills the pick, a block keeps its shape', () => {
  const rows = xlRows();
  const clip = clipOf(rows, [at(rows, 0, 0).key, at(rows, 0, 1).key]);
  assert.equal(clipToText(clip), 'Syöttö\tPalautus');
  assert.deepEqual(clipFromText('Syöttö\tPalautus\r\nVolley\t\n'), [[{ title: 'Syöttö', lead: '' }, { title: 'Palautus', lead: '' }], [{ title: 'Volley', lead: '' }, null]]);
  assert.deepEqual(clipFromText(''), []);
  // one value into three picked cells
  const picked = [at(rows, 1, 0), at(rows, 1, 1), at(rows, 2, 0)];
  assert.deepEqual(pasteChanges(rows, [[{ title: 'Liikkuminen', lead: '' }]], { r: 1, c: 0 }, picked).map((x) => x.cell.key), ['b|2026-44', 'b|2026-45', 'c|2026-44']);
  // a 2×2 block at b45: c46 is a break → skipped, null never clears
  const block = clipFromText('X\tY\nZ\t');
  assert.deepEqual(pasteChanges(rows, block, { r: 1, c: 1 }).map((x) => `${x.cell.key}=${x.theme.title}`), ['b|2026-45=X', 'b|2026-46=Y', 'c|2026-45=Z']);
  // pasting the same title over a cell with a lead keeps the lead
  assert.equal(pasteChanges(rows, [[{ title: 'Syöttö', lead: '' }]], { r: 0, c: 0 })[0].theme.lead, 'Heitto');
});

test('undoWrites puts back what was there and removes what was added', () => {
  const groups = xlGroups();
  const rows = xlRows(groups);
  const changes = effectiveChanges([
    { cell: at(rows, 0, 0), theme: { title: 'Uusi', lead: '' } }, // replaced Syöttö/Heitto
    { cell: at(rows, 1, 0), theme: { title: 'Uusi', lead: '' } }, // was empty
    { cell: at(rows, 2, 3), theme: null }, // cleared Volley
  ]);
  const snap = snapshotOf(changes);
  // the groups after the write
  groups[0].themes[0] = { id: 'ta44', ...w(44), title: 'Uusi', lead: '' };
  groups[1].themes.push({ id: 'new-b44', ...w(44), title: 'Uusi', lead: '' });
  groups[2].themes = [];
  const undo = undoWrites(groups, snap);
  assert.deepEqual(undo.save, [
    { groupId: 'a', year: 2026, week: 44, title: 'Syöttö', lead: 'Heitto' },
    { groupId: 'c', year: 2026, week: 47, title: 'Volley', lead: '' },
  ]);
  assert.deepEqual(undo.remove, ['new-b44']);
});
