// "Pelaajilta" on the coach's Koti (domain/week.js playerActivity): what players did lately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koutsiAddDays } from '../src/domain/core.js';
import { playerActivity } from '../src/domain/week.js';

const today = '2026-10-25';
const at = (daysAgo) => `${koutsiAddDays(today, -daysAgo)}T18:00:00.000Z`;
const student = (id, extra = {}) => ({ id, name: `Pelaaja ${id}`, moods: [], wishHistory: [], noteHistory: [], matchNotes: [], homework: [], entries: [], ...extra });

test('a player\'s own Kehitys entry ("Oma merkintä") reaches the coach, newest first', () => {
  const state = {
    students: [
      student('a', {
        entries: [
          { id: 'e1', at: at(1), date: koutsiAddDays(today, -1), text: 'Seinää vasten 30 min', how: 'Rysty kulki' },
          { id: 'e-old', at: at(30), date: koutsiAddDays(today, -30), text: 'Vanha merkintä', how: '' },
          { id: 'e-empty', at: at(2), date: koutsiAddDays(today, -2), text: '', how: '' },
        ],
        wishHistory: [{ at: at(3), value: 'Verkkopeliä' }],
      }),
    ],
    trainings: [],
  };
  const items = playerActivity(state, 14, today);
  assert.deepEqual(items.map((i) => i.kind), ['entry', 'wish']);
  assert.equal(items[0].text, 'Seinää vasten 30 min');
  assert.equal(items[0].how, 'Rysty kulki');
  assert.equal(items[0].student.id, 'a');
});
