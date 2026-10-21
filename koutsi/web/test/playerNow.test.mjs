// The player's Merkitse lead: which ended sessions are asked about (one slide each), when a mood
// answers a session, and the next session otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koutsiTodayStr, koutsiAddDays } from '../src/domain/core.js';
import { endedSessions, merkitseLead, moodAnswers, firstOpenSlide, spanLabel, ambitionById } from '../src/domain/playerNow.js';

const today = koutsiTodayStr();
const at = (hhmm, date = today) => new Date(`${date}T${hhmm}:00`);
const group = { id: 'g1', name: 'kilparyhmä', durationMinutes: 60, memberIds: ['s1'], themes: [] };
const session = (id, time, date = today, extra = {}) => ({ id, date, time, type: 'Ryhmätreeni', groupId: 'g1', loggedBy: 'coach', absences: [], ...extra });
const student = (moods = []) => ({ id: 's1', name: 'Maria K.', moods, homework: [], matchNotes: [], diary: [], videos: [] });
const stateOf = (trainings) => ({ groups: [group], trainings, students: [] });
const ids = (list) => list.map((x) => x.training.id);

test('three sessions in a row: one slide each, once the last is over', () => {
  const state = stateOf([session('a', '17:00'), session('b', '18:00'), session('c', '19:00'), session('d', '17:00', koutsiAddDays(today, 2))]);
  assert.deepEqual(ids(endedSessions(state, student(), { now: at('18:30') })), ['a'], 'only what has ended');
  const all = endedSessions(state, student(), { now: at('20:05') });
  assert.deepEqual(ids(all), ['a', 'b', 'c']);
  assert.equal(spanLabel(all), '17:00–20:00');
  assert.equal(firstOpenSlide(all), 0);
});

test('a mood tied to one session answers that one only; the others stay open', () => {
  const state = stateOf([session('a', '17:00'), session('b', '18:00'), session('c', '19:00')]);
  const moods = [{ id: 'm1', score: 4, at: at('20:06').toISOString(), trainingId: 'a' }];
  const list = endedSessions(state, student(moods), { now: at('20:10') });
  assert.deepEqual(ids(list), ['a', 'b', 'c'], 'answered slides keep their place');
  assert.equal(list[0].mood.id, 'm1');
  assert.equal(firstOpenSlide(list), 1);
  const done = [...moods, { id: 'm2', score: 3, at: at('20:07').toISOString(), trainingId: 'b' }, { id: 'm3', score: 5, at: at('20:08').toISOString(), trainingId: 'c' }];
  assert.deepEqual(endedSessions(state, student(done), { now: at('20:10') }), [], 'all rated: nothing waits');
});

test('an untied mood ("Kaikista kerralla", the old e-mail) answers every session that began before it', () => {
  const state = stateOf([session('a', '17:00'), session('b', '18:00'), session('c', '19:00')]);
  const moods = [{ id: 'm1', score: 4, at: at('20:06').toISOString(), trainingId: null }];
  assert.deepEqual(endedSessions(state, student(moods), { now: at('20:10') }), []);
  assert.equal(moodAnswers({ at: at('16:00').toISOString() }, session('a', '17:00')), false, 'a feeling from before does not count');
});

test('before the training_id column only the latest session is asked about, as before', () => {
  const state = stateOf([session('a', '17:00'), session('b', '18:00')]);
  assert.deepEqual(ids(endedSessions(state, student(), { now: at('19:30'), perSession: false })), ['b']);
});

test('absences, skips and own logs are never asked about; only the latest day counts', () => {
  const yesterday = koutsiAddDays(today, -1);
  const state = stateOf([
    session('y', '17:00', yesterday),
    session('a', '17:00', today, { absences: [{ studentId: 's1' }] }),
    session('b', '18:00'),
    session('own', '12:00', today, { loggedBy: 'player', studentId: 's1', groupId: null }),
  ]);
  assert.deepEqual(ids(endedSessions(state, student(), { now: at('19:30') })), ['b']);
  assert.deepEqual(ids(endedSessions(state, student(), { now: at('19:30'), skipped: new Set(['b']) })), ['y'], 'skipped today → yesterday is next');
  assert.deepEqual(ids(endedSessions(state, student(), { now: at('09:00', koutsiAddDays(today, 4)) })), [], 'older than three days');
});

test('the lead says what is next when nothing waits', () => {
  const tomorrow = koutsiAddDays(today, 1);
  const state = stateOf([session('a', '17:00'), session('n', '18:00', tomorrow), session('m', '19:00', tomorrow)]);
  const before = merkitseLead(state, student(), { now: at('12:00') });
  assert.deepEqual(ids(before.ended), []);
  assert.equal(before.next.id, 'a');
  assert.equal(before.then.id, 'n');
  const after = merkitseLead(state, student(), { now: at('18:10') });
  assert.deepEqual(ids(after.ended), ['a']);
  assert.equal(after.next.id, 'n');
});

test('ambitions have Finnish labels', () => {
  assert.equal(ambitionById('huippu').label, 'Tähtään huipulle');
  assert.equal(ambitionById('nope'), null);
});
