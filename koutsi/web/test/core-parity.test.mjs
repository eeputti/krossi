// Runs the old Koutsi data layer (lib/koutsi-data.js, a classic global script) in a vm next to
// the renewed app's domain module and checks they compute exactly the same things. The two
// apps run side by side on the same tables during the beta, so a week, theme or summary that
// came out differently would show a coach two different truths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as core from '../src/domain/core.js';

const here = dirname(fileURLToPath(import.meta.url));
const legacySource = readFileSync(join(here, '../../../lib/koutsi-data.js'), 'utf8');

function loadLegacy() {
  const window = {};
  const context = vm.createContext({ window, console, crypto: globalThis.crypto, URLSearchParams, Date, Math, Intl });
  vm.runInContext(legacySource, context, { filename: 'koutsi-data.js' });
  return window;
}
const old = loadLegacy();

const group = (id, name, day, time, themes = []) => ({ id, name, day, time, durationMinutes: 60, memberIds: [], themes, level: 'Keskitaso' });
const T = (year, week, title, lead = '') => ({ id: `${year}-${week}-${title}`, year, week, title, lead });

const GROUPS = [
  group('g1', 'tiistai aikuiset', 'Ti', '17:00', [T(2026, 39, 'Syöttö / smash'), T(2026, 40, 'Syöttö / smash eli iskulyönti'), T(2026, 41, 'Verkkopeli')]),
  group('g2', 'tiistai aikuiset', 'Ti', '18:00', [T(2026, 40, 'syöttö /  smash eli iskulyönti ', 'Heitto'), T(2026, 42, 'Liikkuminen')]),
  group('g3', 'maanantai juniorit', 'Ma', '16:00', [T(2026, 38, 'Kämmen'), T(2026, 40, 'Syötön heitto')]),
  group('g4', 'perjantai juniorit', 'Pe', '15:00', []),
  group('g5', 'torstai aikuiset', 'To', '19:30', [T(2025, 52, 'Vuoden viimeinen'), T(2026, 1, 'Uusi vuosi')]),
];
const TRAININGS = [
  { id: 't1', date: '2026-10-06', time: '17:00', groupId: 'g1' },
  { id: 't2', date: '2026-10-13', time: '17:00', groupId: 'g1' },
  { id: 't3', date: '2026-10-20', time: '17:00', groupId: 'g1' },
  { id: 't4', date: '2026-10-05', time: '16:00', groupId: 'g3' },
  { id: 't5', date: '2026-10-19', time: '16:00', groupId: 'g3' },
  { id: 't6', date: '2026-10-09', time: '15:00', groupId: 'g4' },
];
const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
// The old file runs in another vm realm, so its arrays/objects never deep-equal ours by
// prototype; compare their JSON instead.
const same = (a, b, msg) => assert.deepEqual(plain(a), plain(b), msg);

test('ISO week helpers agree, including the 53-week year 2026', () => {
  for (const year of [2024, 2025, 2026, 2027, 2028]) assert.equal(core.koutsiWeeksInIsoYear(year), old.koutsiWeeksInIsoYear(year));
  assert.equal(core.koutsiWeeksInIsoYear(2026), 53);
  for (const d of ['2026-01-01', '2026-12-31', '2027-01-03', '2027-01-04', '2026-10-13', '2025-12-29']) {
    same(core.koutsiIsoWeekOfDateStr(d), old.koutsiIsoWeekOfDateStr(d), d);
  }
  for (const n of [-60, -1, 0, 1, 12, 53]) {
    same(core.koutsiAddIsoWeeks({ year: 2026, week: 41 }, n), old.koutsiAddIsoWeeks({ year: 2026, week: 41 }, n));
  }
  assert.equal(core.koutsiIsoWeekRangeLabel(2026, 41), old.koutsiIsoWeekRangeLabel(2026, 41));
});

test('theme planning helpers agree', () => {
  const week = { year: 2026, week: 40 };
  same(core.koutsiThemeClusters(GROUPS, week), old.koutsiThemeClusters(GROUPS, week));
  same(core.koutsiThemeHistory(GROUPS, { year: 2026, week: 42 }), old.koutsiThemeHistory(GROUPS, { year: 2026, week: 42 }));
  same(core.koutsiThemeLibrary(GROUPS), old.koutsiThemeLibrary(GROUPS));
  same(core.koutsiGroupNameChips(GROUPS), old.koutsiGroupNameChips(GROUPS));
  for (const g of GROUPS) {
    same(core.koutsiLatestThemeBefore(g, { year: 2026, week: 42 }), old.koutsiLatestThemeBefore(g, { year: 2026, week: 42 }));
    same(core.koutsiSplitThemes(g.themes, { year: 2026, week: 41 }), old.koutsiSplitThemes(g.themes, { year: 2026, week: 41 }));
    assert.equal(core.koutsiGroupScheduleLabel(g), old.koutsiGroupScheduleLabel(g));
  }
  const now = new Date(2026, 9, 13, 16, 30);
  same(core.koutsiWeekThemeStatus(GROUPS, TRAININGS, { year: 2026, week: 42 }, now), old.koutsiWeekThemeStatus(GROUPS, TRAININGS, { year: 2026, week: 42 }, now));
  same(core.koutsiSortGroupsBySchedule(GROUPS).map((g) => g.id), old.koutsiSortGroupsBySchedule(GROUPS).map((g) => g.id));
  assert.equal(core.koutsiThemeKey('  Syöttö /  SMASH '), 'syöttö / smash');
});

test('schedule and time helpers agree', () => {
  for (const t of ['07:07', '23:59', '00:08', '12:52', '']) assert.equal(core.koutsiRoundTimeToQuarterHour(t), old.koutsiRoundTimeToQuarterHour(t));
  for (const m of [0, 7, 44, 90, 500, 'x']) assert.equal(core.koutsiRoundToQuarterHourMinutes(m), old.koutsiRoundToQuarterHourMinutes(m));
  same(core.koutsiWeeklyDates('2026-10-13', '2027-03-01'), old.koutsiWeeklyDates('2026-10-13', '2027-03-01'));
  assert.equal(core.koutsiNextWeekday('2026-10-13', 'Pe'), old.koutsiNextWeekday('2026-10-13', 'Pe'));
  assert.equal(core.koutsiTimeRangeLabel('17:00', 90), '17:00–18:30');
  for (const w of [0, 12, 99, 'x']) assert.equal(core.koutsiClampGroupTrainingWeeks(w), old.koutsiClampGroupTrainingWeeks(w));
});

test('state selectors and summaries agree', () => {
  const state = {
    students: [{ id: 's1', name: 'Venla', matchNotes: [{ date: '2026-10-02', result: 'voitto', durationMinutes: 60 }] }],
    groups: [{ ...GROUPS[0], memberIds: ['s1'] }],
    trainings: [
      ...TRAININGS.map((t) => ({ ...t, absences: t.id === 't1' ? [{ studentId: 's1' }] : [], loggedBy: 'coach', durationMinutes: 60, type: 'Ryhmätreeni' })),
      { id: 'p1', date: '2026-10-03', time: '09:00', studentId: 's1', groupId: null, loggedBy: 'player', type: 'Fysiikka', durationMinutes: 45, absences: [] },
    ],
    clubEvents: [],
  };
  same(core.koutsiTrainingsForStudent(state, 's1'), old.koutsiTrainingsForStudent(state, 's1'));
  same(core.koutsiAttendanceSummary(state, 's1'), old.koutsiAttendanceSummary(state, 's1'));
  same(core.koutsiMonthlySummary(state, 's1', 2026, 9), old.koutsiMonthlySummary(state, 's1', 2026, 9));
});

test('invite texts agree, so a coach sends the same link from either app', () => {
  assert.equal(core.koutsiInviteLink('ABC123', 's1'), old.koutsiInviteLink('ABC123', 's1'));
  assert.equal(core.koutsiInviteMessage('ABC123', 'Alpo', 'tiistai aikuiset'), old.koutsiInviteMessage('ABC123', 'Alpo', 'tiistai aikuiset'));
  assert.equal(core.koutsiThemeShareMessage(T(2026, 41, 'Verkkopeli', 'Lähestyminen')), old.koutsiThemeShareMessage(T(2026, 41, 'Verkkopeli', 'Lähestyminen')));
  same(core.koutsiParseNameList('Nimi\nMatti Meikäläinen;12\nLiisa\t9\n'), old.koutsiParseNameList('Nimi\nMatti Meikäläinen;12\nLiisa\t9\n'));
});
