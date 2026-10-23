// "Uusi kausi": season dates and breaks, the draft copied from the current season, what the
// review counts as a change, Koti's nudge, and the demo's publish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDraftGroup, addSignups, draftFromSeason, draftSummary, easterSunday, nextSeasonPreset, placePlayer,
  seasonDates, seasonName, seasonNudge, updateDraftGroup, breakDates, rangeLabel,
} from '../src/domain/season.js';
import { backend as demo, configureDemo } from '../src/api/demo/index.js';

const g = (id, day, time, memberIds, extra = {}) => ({ id, name: `Ryhmä ${id}`, level: '', day, time, durationMinutes: 60, memberIds, seasonId: 's1', ...extra });
const st = (id, extra = {}) => ({ id, name: `Pelaaja ${id}`, isPlaceholder: false, ...extra });
const AUTUMN = { id: 's1', name: 'Syksy 2026', startsOn: '2026-09-07', endsOn: '2026-12-13', breaks: [] };
const state = () => ({
  seasonsReady: true,
  seasons: [AUTUMN],
  seasonDraft: null,
  students: [st('a'), st('b'), st('c', { isPlaceholder: true }), st('d')],
  groups: [g('ma', 'Ma', '16:00', ['a', 'b']), g('ke', 'Ke', '17:30', ['b', 'c']), g('pe', 'Pe', '17:00', ['a', 'd'])],
  trainings: [],
});

test('Easter and the spring preset after an autumn season', () => {
  assert.equal(easterSunday(2026), '2026-04-05');
  assert.equal(easterSunday(2027), '2027-03-28');
  const p = nextSeasonPreset(AUTUMN);
  assert.equal(p.name, 'Kevät 2027');
  assert.equal(p.startsOn, '2027-01-11');
  assert.equal(p.endsOn, '2027-05-23');
  const byKey = Object.fromEntries(p.breaks.map((b) => [b.key, b]));
  assert.deepEqual([byKey.hiihtoloma.from, byKey.hiihtoloma.to], ['2027-03-01', '2027-03-07']);
  assert.deepEqual([byKey.paasiainen.from, byKey.paasiainen.to], ['2027-03-26', '2027-03-29']);
  assert.equal(byKey.vappu.from, '2027-05-01');
  assert.equal(byKey.helatorstai.from, '2027-05-06');
  assert.ok(p.breaks.every((b) => b.on));
  assert.equal(rangeLabel('2027-03-26', '2027-03-29'), '26.–29.3.');
  assert.equal(seasonName('2027-08-23'), 'Syksy 2027');
});

test('a spring season continues to an autumn one', () => {
  const p = nextSeasonPreset({ endsOn: '2027-05-23' });
  assert.equal(p.name, 'Syksy 2027');
  assert.equal(p.startsOn, '2027-08-30');
  assert.ok(p.breaks.some((b) => b.key === 'syysloma'));
});

test('season sessions run weekly and skip the breaks that are on', () => {
  const season = nextSeasonPreset(AUTUMN);
  const monday = seasonDates({ day: 'Ma' }, season);
  assert.equal(monday[0], '2027-01-11');
  assert.ok(!monday.includes('2027-03-01'), 'hiihtoloma');
  assert.ok(!monday.includes('2027-03-29'), '2. pääsiäispäivä');
  assert.equal(monday[monday.length - 1], '2027-05-17');
  const off = { ...season, breaks: season.breaks.map((b) => ({ ...b, on: false })) };
  assert.equal(seasonDates({ day: 'Ma' }, off).length, monday.length + 2);
  assert.equal(breakDates(off.breaks).size, 0);
});

test('the draft starts as a copy: nothing changes until the coach says so', () => {
  const s = state();
  const draft = draftFromSeason(s, AUTUMN);
  assert.equal(draft.groups.length, 3);
  assert.ok(draft.groups.every((dg) => dg.status === 'jatkuu'));
  assert.deepEqual(draft.members['k-ma'], ['a', 'b']);
  const sum = draftSummary(s, draft);
  assert.equal(sum.changes, 0);
  assert.equal(sum.players.total, 4);
  assert.equal(sum.players.noAccount, 1);
  assert.ok(sum.sessions > 50);
});

test('moves, ended groups, leavers and sign-ups are counted once', () => {
  const s = state();
  let draft = draftFromSeason(s, AUTUMN);
  // Friday ends: a stays in Ma (not a move), d is left without a group (not continuing)
  draft = updateDraftGroup(draft, 'k-pe', { status: 'loppuu' });
  // b leaves Wednesday's group but keeps Monday: that is a move
  draft = placePlayer(draft, 'b', ['k-ma']);
  // a new group; c moves there
  draft = addDraftGroup(draft, { name: 'Keltainen', day: 'La', time: '10:00' });
  const newKey = draft.groups.find((dg) => dg.status === 'uusi').key;
  draft = placePlayer(draft, 'c', [newKey]);
  // sign-ups: one existing name, one new
  draft = addSignups(draft, [{ name: 'Pelaaja a', existingId: 'a', groupKey: newKey }, { name: 'Ville S.', existingId: null, groupKey: newKey }]);
  const sum = draftSummary(s, draft);
  assert.deepEqual(sum.groups.ended.map((dg) => dg.key), ['k-pe']);
  assert.equal(sum.groups.added.length, 1);
  assert.deepEqual(sum.players.moved.map((m) => m.student.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(sum.players.leaving.map((x) => x.id), ['d']);
  assert.deepEqual(sum.players.newPlayers.map((p) => p.name), ['Ville S.']);
  assert.equal(sum.players.noAccount, 2); // c (placeholder) + Ville
  assert.ok(draft.members[newKey].includes('a'), 'an existing name keeps the existing player');
});

test('Koti nudges near the season end, then shows the draft, then the published season', () => {
  const s = state();
  assert.equal(seasonNudge(s, '2026-09-20'), null, 'too early');
  assert.equal(seasonNudge(s, '2026-10-23').kind, 'plan');
  s.seasonDraft = { ...draftFromSeason(s, AUTUMN) };
  assert.equal(seasonNudge(s, '2026-10-23').kind, 'draft');
  s.seasons = [...s.seasons, { id: 's2', name: 'Kevät 2027', startsOn: '2027-01-11', endsOn: '2027-05-23', breaks: [] }];
  assert.equal(seasonNudge(s, '2026-10-23').kind, 'published');
  assert.equal(seasonNudge({ ...s, seasonsReady: false }, '2026-10-23'), null);
});

test('demo: publishing writes the new season and leaves the old one as it was', async () => {
  configureDemo({ role: 'coach', latency: 0 });
  const before = await demo.coach.load('demo-coach');
  assert.equal(before.seasonsReady, true);
  const autumn = before.seasons[0];
  assert.ok(before.groups.every((x) => x.seasonId === autumn.id));
  let draft = draftFromSeason(before, autumn);
  draft = placePlayer(draft, 'demo-s-siiri', draft.groups.filter((dg) => dg.name === 'Juniorit kilpa').map((dg) => dg.key));
  await demo.seasons.saveDraft('demo-coach', draft);
  assert.equal((await demo.coach.load('demo-coach')).seasonDraft.name, draft.name);
  const res = await demo.seasons.publish('demo-coach', draft);
  const after = await demo.coach.load('demo-coach');
  assert.equal(res.groups, before.groups.length);
  assert.equal(after.seasons.length, 2);
  assert.equal(after.seasonDraft, null);
  const spring = after.groups.filter((x) => x.seasonId === res.seasonId);
  assert.equal(spring.length, before.groups.length);
  assert.ok(spring.filter((x) => x.name === 'Juniorit kilpa').every((x) => x.memberIds.includes('demo-s-siiri')));
  assert.ok(!spring.find((x) => x.name === 'Juniorit vihreä').memberIds.includes('demo-s-siiri'));
  // the old season keeps its groups, members and sessions
  const oldVihrea = after.groups.find((x) => x.seasonId === autumn.id && x.name === 'Juniorit vihreä');
  assert.ok(oldVihrea.memberIds.includes('demo-s-siiri'));
  assert.equal(after.trainings.filter((t) => spring.some((x) => x.id === t.groupId)).length, res.sessions);
  assert.ok(after.trainings.filter((t) => spring.some((x) => x.id === t.groupId)).every((t) => t.date >= draft.startsOn && t.date <= draft.endsOn));
  configureDemo({ role: 'coach', latency: 0 });
});
