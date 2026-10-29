import test from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_CHOICES, withChoice } from '../src/domain/emailPrefs.js';

test('every e-mail choice has a unique id the database knows', () => {
  // 'vapaat' comes with Vapaat ajat (koutsi/web/sql/20261029180000_koutsi_open_slots.sql); its choice shows
  // only to a player who has free times, which needs that same migration.
  const known = new Set(['valmentaja', 'tiedotteet', 'treenit', 'muistutus', 'mitenmeni', 'ottelut', 'poissaolot', 'vapaat']);
  const ids = [...EMAIL_CHOICES.player, ...EMAIL_CHOICES.coach].map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach((id) => assert.ok(known.has(id), id));
  assert.equal(EMAIL_CHOICES.player.find((c) => c.id === 'vapaat').only, 'openSlots');
});

test('withChoice turns categories off and back on without duplicates', () => {
  assert.deepEqual(withChoice([], 'muistutus', false), ['muistutus']);
  assert.deepEqual(withChoice(['muistutus'], 'muistutus', false), ['muistutus']);
  assert.deepEqual(withChoice(['muistutus', 'treenit'], 'muistutus', true), ['treenit']);
  assert.deepEqual(withChoice(null, 'treenit', true), []);
});
