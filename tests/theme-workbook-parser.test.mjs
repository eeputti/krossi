import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};
await import('../lib/koutsi-theme-import.js');

const parse = window.koutsiParseThemeWorkbookData;

test('parses a long annual-plan table containing several groups', () => {
  const result = parse([{ sheet: 'Vuosisuunnitelma', data: [
    ['Ryhmä', 'Vuosi', 'Viikko', 'Teema', 'Tarkennus'],
    ['Aikuiset', 2026, 35, 'Syöttö', 'Heiton rytmi'],
    ['Juniorit', 2026, 'vko 35', 'Liikkuminen', 'Ensimmäinen askel'],
  ] }], { fallbackYear: 2026 });

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rows.map(({ groupName, year, week, title, lead }) => ({ groupName, year, week, title, lead })), [
    { groupName: 'Aikuiset', year: 2026, week: 35, title: 'Syöttö', lead: 'Heiton rytmi' },
    { groupName: 'Juniorit', year: 2026, week: 35, title: 'Liikkuminen', lead: 'Ensimmäinen askel' },
  ]);
});

test('parses a wide matrix with one group per column', () => {
  const result = parse([{ sheet: 'Syksy', data: [
    ['Viikko', 'Aikuiset', 'Juniorit'],
    [36, 'Verkkopeli', 'Peruslyönnit'],
    [37, 'Palautus', 'Syöttö'],
  ] }], { fallbackYear: 2026 });

  assert.deepEqual(result.issues, []);
  assert.equal(result.rows.length, 4);
  assert.deepEqual(result.rows[2], {
    groupName: 'Aikuiset', year: 2026, week: 37, title: 'Palautus', lead: '', sheet: 'Syksy', sourceRow: 3,
  });
});

test('parses one sheet per group and uses a date cell for the ISO week', () => {
  const result = parse([
    { sheet: 'Aikuiset', data: [['Viikko', 'Teema'], [new Date('2026-08-24T00:00:00Z'), 'Syöttö']] },
    { sheet: 'Juniorit', data: [['Vko', 'Teema', 'Painotus'], [35, 'Liikkuminen', 'Tasapaino']] },
  ], { fallbackYear: 2026 });

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rows.map(({ groupName, year, week, title, lead }) => ({ groupName, year, week, title, lead })), [
    { groupName: 'Aikuiset', year: 2026, week: 35, title: 'Syöttö', lead: '' },
    { groupName: 'Juniorit', year: 2026, week: 35, title: 'Liikkuminen', lead: 'Tasapaino' },
  ]);
});
