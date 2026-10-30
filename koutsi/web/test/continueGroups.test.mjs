// "Jatka kalenteria": groups go on with the same times, with breaks (tauko) as day ranges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakDays, breakProblem, fmtDay, nextTermEnd, planContinue, validBreaks } from '../src/domain/continueGroups.js';

const TODAY = '2026-10-30'; // Friday
const tr = (id, groupId, date, time = '17:00', extra = {}) => ({ id, groupId, date, time, type: 'Ryhmätreeni', loggedBy: 'coach', ...extra });
const monGroup = { id: 'g1', name: 'Kilpa 1', day: 'Ma', time: '17:00', slots: [] };
// Mondays 30.11.–14.12. are in the calendar now
const autumn = [tr('a1', 'g1', '2026-11-30'), tr('a2', 'g1', '2026-12-07'), tr('a3', 'g1', '2026-12-14')];

test('Christmas break after the calendar: the spring starts after the break, same weekday and time', () => {
  const plan = planContinue({ groups: [monGroup], trainings: autumn, until: '2027-01-25', breaks: [{ from: '2026-12-19', to: '2027-01-10' }], today: TODAY });
  assert.deepEqual(plan.groups[0].add, ['2027-01-11', '2027-01-18', '2027-01-25']);
  assert.equal(plan.added, 3);
  assert.deepEqual(plan.cancel, []);
  assert.deepEqual(plan.breaks, [{ from: '2026-12-19', to: '2027-01-10', cancelled: 0, next: '2027-01-11' }]);
  assert.equal(plan.groups[0].last, '2027-01-25');
});

test('a break over sessions already in the calendar cancels them, and the calendar goes on after it', () => {
  const plan = planContinue({ groups: [monGroup], trainings: autumn, until: '2026-12-28', breaks: [{ from: '2026-12-05', to: '2026-12-20' }], today: TODAY });
  assert.deepEqual(plan.cancel.map((t) => t.id), ['a2', 'a3']);
  assert.deepEqual(plan.groups[0].add, ['2026-12-21', '2026-12-28'], 'continues from the last kept session, skipping the break');
  assert.deepEqual(plan.breaks[0], { from: '2026-12-05', to: '2026-12-20', cancelled: 2, next: '2026-12-21' });
});

test('a break only: nothing added when the calendar already reaches the day', () => {
  const plan = planContinue({ groups: [monGroup], trainings: autumn, until: '2026-12-14', breaks: [{ from: '2026-12-07', to: '2026-12-07' }], today: TODAY });
  assert.equal(plan.added, 0);
  assert.deepEqual(plan.cancel.map((t) => t.id), ['a2']);
  assert.equal(plan.breaks[0].next, '2026-12-14');
});

test('past sessions, own entries and other groups are never cancelled', () => {
  const trainings = [
    tr('old', 'g1', '2026-10-26'),
    tr('own', 'g1', '2026-11-02', '09:00', { loggedBy: 'player' }),
    tr('other', 'g2', '2026-11-03'),
    tr('mine', 'g1', '2026-11-02'),
  ];
  const plan = planContinue({ groups: [monGroup], trainings, until: '2026-11-09', breaks: [{ from: '2026-10-01', to: '2026-11-05' }], today: TODAY });
  assert.deepEqual(plan.cancel.map((t) => t.id), ['mine']);
});

test('every weekly time of a group goes on, and a day already in the calendar is not doubled', () => {
  const group = { ...monGroup, slots: [{ day: 'Ke', time: '18:30' }] };
  const trainings = [tr('m', 'g1', '2026-11-02'), tr('w', 'g1', '2026-11-04', '18:30'), tr('x', 'g1', '2026-11-11', '18:30')];
  const plan = planContinue({ groups: [group], trainings, until: '2026-11-18', breaks: [], today: TODAY });
  assert.deepEqual(plan.groups[0].add, ['2026-11-09', '2026-11-16', '2026-11-18']);
});

test('a group with no sessions starts from today on its weekday; one without a weekly time gets nothing', () => {
  const plan = planContinue({ groups: [monGroup, { id: 'g3', name: 'Ilman aikaa', day: '', time: '' }], trainings: [], until: '2026-11-16', breaks: [], today: TODAY });
  assert.deepEqual(plan.groups[0].add, ['2026-11-02', '2026-11-09', '2026-11-16']);
  assert.deepEqual(plan.groups[1].add, []);
  assert.equal(plan.groups[1].last, null);
});

test('several breaks: each says when the sessions go on', () => {
  const plan = planContinue({
    groups: [monGroup], trainings: autumn, until: '2027-03-08',
    breaks: [{ from: '2027-02-22', to: '2027-02-28' }, { from: '2026-12-19', to: '2027-01-06' }], today: TODAY,
  });
  assert.deepEqual(plan.breaks.map((b) => [b.from, b.next]), [['2026-12-19', '2027-01-11'], ['2027-02-22', '2027-03-01']]);
  assert.ok(!plan.groups[0].add.includes('2027-02-22'));
});

test('breakDays lists only the days between today and the end day', () => {
  assert.deepEqual(breakDays([{ from: '2026-12-30', to: '2027-01-02' }], TODAY, '2027-01-01'), ['2026-12-30', '2026-12-31', '2027-01-01']);
  assert.deepEqual(breakDays([{ from: '2026-10-28', to: '2026-10-31' }], TODAY, '2027-01-01'), ['2026-10-30', '2026-10-31']);
  assert.deepEqual(breakDays([{ from: '2026-12-01', to: '' }], TODAY, '2027-01-01'), []);
});

test('break rows: half-filled, backwards and past ones are named; good ones pass', () => {
  assert.equal(breakProblem([{ from: '2026-12-19', to: '' }], TODAY), 'Valitse tauon alku- ja loppupäivä.');
  assert.equal(breakProblem([{ from: '2026-12-19', to: '2026-12-01' }], TODAY), 'Tauon loppupäivä on ennen alkua.');
  assert.equal(breakProblem([{ from: '2026-10-01', to: '2026-10-10' }], TODAY), 'Tauko on jo mennyt. Valitse tulevat päivät.');
  assert.equal(breakProblem([{ from: '2026-12-19', to: '2027-01-06' }], TODAY), null);
  assert.equal(breakProblem([], TODAY), null);
  assert.deepEqual(validBreaks([{ from: '2026-12-19', to: '2026-12-01' }, { from: '2026-12-19', to: '2026-12-19' }]), [{ from: '2026-12-19', to: '2026-12-19' }]);
});

test('next term end and the summary day', () => {
  assert.equal(nextTermEnd('2026-12-20'), '2027-05-31');
  assert.equal(nextTermEnd('2026-10-30'), '2026-12-20');
  assert.equal(nextTermEnd('2027-05-31'), '2027-08-31');
  assert.equal(fmtDay('2026-12-19', TODAY), 'la 19.12.');
  assert.equal(fmtDay('2027-01-07', TODAY), 'to 7.1.2027');
});
