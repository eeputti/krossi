// "Pelaajien tasot": the coach's own scale, how levels read, who sees them, and the old-level switch list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCALE, REMOVE_LEVEL, levelLabel, levelNote, levelVisibilityText, normalizeScale, oldLevelCounts, oldLevelFamily,
  movePlan, oldLevelRows, onScale, playersByStep, parseLevelRange, playerGroupLevel, playerLevelView, playerSeesLevel, rangeValue, relabelPlan, scaleForSave, scaleSteps, scaleSummary,
  stepIndex, stepsInUse, usesLevels,
} from '../src/domain/levels.js';

const SANAT = DEFAULT_SCALE;
const JUKKA = normalizeScale({ kind: 'numerot', size: 6, notes: ['Harrastaja', '', '', '', '', 'C-tason kilpapelaaja'] });

test('scales: words by default, numbers 1–N with notes, or none', () => {
  assert.deepEqual(normalizeScale(null), SANAT);
  assert.deepEqual(normalizeScale({ kind: 'outo' }).kind, 'sanat');
  assert.deepEqual(normalizeScale({ kind: 'numerot' }), SANAT, 'numbers without a size fall back to words');
  assert.equal(normalizeScale({ kind: 'numerot', size: 40 }).size, 10);
  assert.deepEqual(scaleSteps(JUKKA).map((s) => s.value), ['1', '2', '3', '4', '5', '6']);
  assert.equal(scaleSteps(JUKKA)[5].note, 'C-tason kilpapelaaja');
  assert.deepEqual(scaleSteps(SANAT).map((s) => s.value), ['Aloittelija', 'Keskitaso', 'Edistynyt', 'Kilpapelaaja']);
  assert.deepEqual(scaleSteps({ kind: 'ei' }), []);
  assert.equal(usesLevels({ kind: 'ei' }), false);
  assert.equal(scaleSummary(JUKKA), 'Numerot 1–6');
  assert.equal(scaleSummary(SANAT), 'Sanat');
  assert.equal(scaleSummary({ kind: 'ei' }), 'Ei käytössä');
  assert.deepEqual(scaleForSave(JUKKA).notes, ['Harrastaja', '', '', '', '', 'C-tason kilpapelaaja']);
  assert.deepEqual(scaleForSave({ kind: 'numerot', size: 5, notes: ['Alku', ' '] }).notes, ['Alku']);
  assert.equal(normalizeScale({ kind: 'numerot', size: 4, notes: ['x'.repeat(90)] }).notes[0].length, 60);
});

test('levels read as "Taso 4" on numbers and with the step spelling on words', () => {
  assert.equal(levelLabel(JUKKA, '4'), 'Taso 4');
  assert.equal(levelLabel(JUKKA, '3–4'), 'Taso 3–4');
  assert.equal(levelLabel(JUKKA, ' 4 - 3 '), 'Taso 3–4');
  assert.equal(levelLabel(JUKKA, 'Kaikki tasot'), 'Kaikki tasot');
  assert.equal(levelLabel(JUKKA, 'Edistynyt'), 'Edistynyt', 'an old word stays as it was');
  assert.equal(levelLabel(SANAT, 'keskitaso'), 'Keskitaso');
  assert.equal(levelLabel(SANAT, 'keskitaso–edistynyt'), 'Keskitaso–Edistynyt');
  assert.equal(levelLabel(SANAT, '3'), 'Taso 3', 'a number on a words scale still reads as a level');
  assert.equal(levelLabel(SANAT, ''), '');
  assert.equal(levelNote(JUKKA, '6'), 'C-tason kilpapelaaja');
  assert.equal(levelNote(JUKKA, '3'), '');
  assert.equal(stepIndex(SANAT, ' KILPAPELAAJA '), 3);
});

test('group ranges: one step, a range, all, or an old text', () => {
  assert.deepEqual(parseLevelRange(JUKKA, '4'), { from: 3, to: 3 });
  assert.deepEqual(parseLevelRange(JUKKA, '5–3'), { from: 2, to: 4 });
  assert.equal(parseLevelRange(JUKKA, 'kaikki tasot'), 'all');
  assert.equal(parseLevelRange(JUKKA, '7'), null);
  assert.deepEqual(parseLevelRange(SANAT, 'Aloittelija–Keskitaso'), { from: 0, to: 1 });
  assert.equal(parseLevelRange(SANAT, 'keskitaso/edistynyt'), null, 'the old slash form is an old text');
  assert.equal(rangeValue(JUKKA, 4, 2), '3–5');
  assert.equal(rangeValue(JUKKA, 1, 1), '2');
  assert.equal(rangeValue(SANAT, 2, 3), 'Edistynyt–Kilpapelaaja');
  assert.equal(onScale(JUKKA, '3–4', { group: true }), true);
  assert.equal(onScale(JUKKA, '3–4'), false, 'a player has one level');
  assert.equal(onScale(JUKKA, ''), true);
});

test('a player sees their level only at 18 or more, and the coach is told why not', () => {
  assert.equal(playerSeesLevel({ age: 18 }), true);
  assert.equal(playerSeesLevel({ age: 17 }), false);
  assert.equal(playerSeesLevel({ age: null }), false);
  assert.equal(playerSeesLevel({}), false);
  assert.equal(levelVisibilityText({ age: 30 }), 'Pelaaja näkee tasonsa.');
  assert.match(levelVisibilityText({ age: 15 }), /alle 18/);
  assert.match(levelVisibilityText({ age: null }), /ikäänsä ei ole/);
  assert.match(levelVisibilityText({ age: 30, isPlaceholder: true }), /ei ole vielä liittynyt/);
});

test('old texts group by meaning: spelling, case, plural, synonyms and ranges', () => {
  const fam = (t) => oldLevelFamily(t).key;
  assert.equal(fam('aloittelija'), fam('Aloittelija'));
  assert.equal(fam('aloittelijat'), fam('alottelijat'));
  assert.equal(fam('aloittaja'), fam('aloittelija'));
  assert.equal(fam('kilpa'), fam('Kilpapelaaja'));
  assert.equal(fam('kilpataso'), fam('kilpapelaaja'));
  assert.equal(fam('amatööri'), fam('harrastaja'));
  assert.equal(fam('edistynyt/kilpataso'), fam('edistynyt / kilpataso'));
  assert.equal(fam('aloittajat/keskitaso'), fam('aloittaja/keskitaso'));
  assert.equal(oldLevelFamily('edistynyt / kilpataso').label, 'Edistynyt–Kilpapelaaja');
  assert.equal(oldLevelFamily('kilpataso/edistynyt').label, 'Edistynyt–Kilpapelaaja', 'order follows the scale');
  assert.equal(oldLevelFamily('3').label, 'Taso 3');
  assert.notEqual(fam('normi'), fam('harrastaja'), 'an unknown word is left alone');
  assert.equal(oldLevelFamily('normi').label, 'normi');
});

// The spellings real coaches had on 11.11.2026 (counts only, no names).
const REAL_PLAYERS = [
  ['Edistynyt', 11], ['keskitaso', 10], ['edistynyt/kilpataso', 6], ['Kilpapelaaja', 3], ['aloittaja', 2], ['Aloittelija', 2],
  ['edistynyt', 1], ['aloittaja/keskitaso', 1], ['edistynyt / kilpataso', 1],
].flatMap(([level, n]) => Array.from({ length: n }, (_, i) => ({ id: `${level}-${i}`, level })));
const REAL_GROUPS = [
  ['keskitaso', 11], ['Kaikki tasot', 4], ['keskitaso/edistynyt', 3], ['kilpa', 3], ['edistynyt/kilpataso', 2], ['edistynyt / kilpataso', 1],
  ['aloittelijat', 1], ['alottelijat', 1], ['amatööri', 1], ['normi', 1], ['aloittajat/keskitaso', 1], ['3', 1], ['Keskitaso', 1], ['aloittelija', 1],
].flatMap(([level, n]) => Array.from({ length: n }, (_, i) => ({ id: `${level}-${i}`, level })));

test('the switch list on a numbers scale: every old text in a few rows', () => {
  const players = oldLevelRows(JUKKA, REAL_PLAYERS);
  assert.deepEqual(players.map((r) => [r.label, r.ids.length]), [
    ['Aloittelija', 4], ['Aloittelija–Keskitaso', 1], ['Keskitaso', 10], ['Edistynyt', 12], ['Edistynyt–Kilpapelaaja', 7], ['Kilpapelaaja', 3],
  ]);
  const groups = oldLevelRows(JUKKA, REAL_GROUPS, { group: true });
  assert.deepEqual(groups.map((r) => [r.label, r.ids.length]), [
    ['Aloittelija', 3], ['Aloittelija–Keskitaso', 1], ['Harrastaja', 1], ['Keskitaso', 12], ['Keskitaso–Edistynyt', 3],
    ['Edistynyt–Kilpapelaaja', 3], ['Kilpapelaaja', 3], ['normi', 1],
  ], '"3" and "Kaikki tasot" are already on the scale');
  const kilpa = groups.find((r) => r.label === 'Kilpapelaaja');
  assert.deepEqual(kilpa.variants.map((v) => v.text), ['kilpa']);
});

test('the switch list on words: only the odd spellings are old', () => {
  const players = oldLevelRows(SANAT, REAL_PLAYERS);
  assert.deepEqual(players.map((r) => [r.label, r.ids.length]), [['Aloittelija', 2], ['Aloittelija–Keskitaso', 1], ['Edistynyt–Kilpapelaaja', 7]]);
  assert.deepEqual(players[0].variants.map((v) => v.text), ['aloittaja']);
  assert.deepEqual(oldLevelCounts(SANAT, REAL_PLAYERS, REAL_GROUPS), { players: 10, groups: 15 }, '"3" is old on words');
});

test('Erota splits a spelling into a row of its own', () => {
  const rows = oldLevelRows(JUKKA, REAL_GROUPS, { group: true, split: new Set(['kilpa']) });
  assert.ok(!rows.some((r) => r.label === 'Kilpapelaaja'));
  const own = rows.find((r) => r.label === 'kilpa');
  assert.equal(own.ids.length, 3);
});

test('saving the list changes only the chosen rows; Poista taso clears; the plan carries the old value for Kumoa', () => {
  const items = [{ id: 'a', level: 'Edistynyt' }, { id: 'b', level: 'edistynyt' }, { id: 'c', level: 'kilpa' }, { id: 'd', level: 'normi' }, { id: 'e', level: '5' }];
  const rows = oldLevelRows(JUKKA, items);
  const ed = rows.find((r) => r.label === 'Edistynyt').key;
  const normi = rows.find((r) => r.label === 'normi').key;
  const plan = relabelPlan(rows, { [ed]: '4', [normi]: REMOVE_LEVEL }, items).sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(plan, [
    { id: 'a', level: '4', before: 'Edistynyt' }, { id: 'b', level: '4', before: 'edistynyt' }, { id: 'd', level: null, before: 'normi' },
  ]);
});

test('steps in use stop a scale from shrinking under them', () => {
  const students = [{ level: '6' }, { level: '2' }, { level: 'Edistynyt' }];
  const groups = [{ level: '3–5' }, { level: 'Kaikki tasot' }];
  assert.deepEqual(stepsInUse(JUKKA, students, groups).map((s) => s.value), ['2', '3', '5', '6']);
});

test("what a player sees: their own level and note at 18 or more, the group's level by its coach's scale", () => {
  const state = (age, extra = {}) => ({
    coach: { id: 'c1' }, coaches: [{ id: 'c1' }],
    levelScales: { c1: { kind: 'numerot', size: 6, notes: ['', '', '', 'Hyvä kerhopelaaja', '', ''] } },
    students: [{ id: 'me', age, level: '4', ...extra }],
  });
  assert.deepEqual(playerLevelView(state(30)), { label: 'Taso 4', note: 'Hyvä kerhopelaaja' });
  assert.equal(playerLevelView(state(16)), null);
  assert.equal(playerLevelView(state(null)), null);
  assert.equal(playerLevelView(state(30, { level: '' })), null);
  assert.equal(playerLevelView({ ...state(30), levelScales: { c1: { kind: 'ei' } } }), null, 'levels off: nothing');
  assert.deepEqual(playerLevelView({ ...state(30), levelScales: {} }), { label: 'Taso 4', note: '' }, 'no scale row: words, a number still reads');
  const group = { coachId: 'c1', level: '3–5' };
  assert.equal(playerGroupLevel(state(30), group), 'Taso 3–5');
  assert.equal(playerGroupLevel(state(12), group), '');
});

test("picking some of a row moves only them; a step's players move to another level at once", () => {
  const items = [{ id: 'a', level: 'Edistynyt' }, { id: 'b', level: 'Edistynyt' }, { id: 'c', level: 'Edistynyt' }];
  const rows = oldLevelRows(JUKKA, items);
  const plan = relabelPlan(rows, { [rows[0].key]: { level: '5', ids: ['b'] } }, items);
  assert.deepEqual(plan, [{ id: 'b', level: '5', before: 'Edistynyt' }]);
  assert.equal(relabelPlan(rows, { [rows[0].key]: { level: '4', ids: [] } }, items).length, 3, 'not picking: the whole row');
  assert.equal(relabelPlan(rows, { [rows[0].key]: { level: '4', ids: [], picking: true } }, items).length, 0, 'picking, nobody picked yet: no one');
  const players = [{ id: 'p', level: '4' }, { id: 'q', level: '4' }, { id: 'r', level: '' }, { id: 's', level: 'kilpa' }];
  const by = playersByStep(JUKKA, players);
  assert.deepEqual(by.steps[3].ids, ['p', 'q']);
  assert.deepEqual(by.none, ['r']);
  assert.deepEqual(movePlan(['p', 'q'], '5', players), [{ id: 'p', level: '5', before: '4' }, { id: 'q', level: '5', before: '4' }]);
  assert.deepEqual(movePlan(['p'], '4', players), [], 'already there');
  assert.deepEqual(movePlan(['r'], REMOVE_LEVEL, players), [], 'no level to remove');
});
