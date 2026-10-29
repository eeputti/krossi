// The player's tennis profile: the values match the database checks, the facts read well.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FAVOURITE_SHOTS, PLAYS_HAND, TENNIS_STORY_MAX, mergeTennisDraft, parseStartYear, tennisDraftOf, tennisFacts } from '../src/domain/tennisProfile.js';

test('facts: hand, shot and start year in that order, empty ones skipped', () => {
  assert.deepEqual(tennisFacts({ playsHand: 'vasen', favouriteShot: 'rysty', playingSince: 2012 }),
    ['Vasenkätinen', 'Lempilyönti rysty', 'Pelannut vuodesta 2012']);
  assert.deepEqual(tennisFacts({ playsHand: '', favouriteShot: 'lentolyonti', playingSince: null }), ['Lempilyönti lentolyönti']);
  assert.deepEqual(tennisFacts({ playsHand: 'jotain', favouriteShot: '' }), []);
  assert.deepEqual(tennisFacts(null), []);
});

test('start year: empty is fine, a future or odd year is not', () => {
  const now = new Date(2026, 9, 25);
  assert.equal(parseStartYear('', now), null);
  assert.equal(parseStartYear(' 2012 ', now), 2012);
  assert.equal(parseStartYear('2026', now), 2026);
  assert.ok(Number.isNaN(parseStartYear('2027', now)));
  assert.ok(Number.isNaN(parseStartYear('1929', now)));
  assert.ok(Number.isNaN(parseStartYear('12', now)));
});

test('the values are exactly the ones the migration allows', async () => {
  const sql = await readFile(new URL('../../../supabase/migrations/20261025194643_koutsi_player_tennis_profile.sql', import.meta.url), 'utf8');
  for (const { value } of [...PLAYS_HAND, ...FAVOURITE_SHOTS]) assert.ok(sql.includes(`'${value}'`), value);
  const shots = sql.match(/favourite_shot in\s*\(([^)]*)\)/)[1].match(/'[^']+'/g);
  assert.equal(shots.length, FAVOURITE_SHOTS.length);
});

test('waiting draft: keeps only known, non-empty values', () => {
  assert.equal(tennisDraftOf(null), null);
  assert.equal(tennisDraftOf({ playsHand: '', favouriteShot: '', playingSince: null, tennisStory: '  ' }), null);
  assert.deepEqual(tennisDraftOf({ playsHand: 'vasen', favouriteShot: 'smash', playingSince: 2015, tennisStory: ' Junnuna seurassa. ' }),
    { playsHand: 'vasen', favouriteShot: 'smash', playingSince: 2015, tennisStory: 'Junnuna seurassa.' });
  assert.deepEqual(tennisDraftOf({ playsHand: 'molemmat', favouriteShot: 'kaikki', playingSince: NaN, tennisStory: 'x'.repeat(400) }),
    { tennisStory: 'x'.repeat(TENNIS_STORY_MAX) });
});

test('waiting draft onto the row: the draft wins, its empty fields keep the row', () => {
  const row = { playsHand: 'oikea', favouriteShot: 'forehand', playingSince: 2010, tennisStory: 'Vanha' };
  assert.deepEqual(mergeTennisDraft(row, { favouriteShot: 'rysty' }),
    { playsHand: 'oikea', favouriteShot: 'rysty', playingSince: 2010, tennisStory: 'Vanha' });
  assert.deepEqual(mergeTennisDraft(null, { playsHand: 'vasen', tennisStory: 'Uusi' }),
    { playsHand: 'vasen', favouriteShot: '', playingSince: null, tennisStory: 'Uusi' });
});
