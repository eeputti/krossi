// The player's tennis profile: the values match the database checks, the facts read well.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FAVOURITE_SHOTS, PLAYS_HAND, parseStartYear, tennisFacts } from '../src/domain/tennisProfile.js';

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
