// Ylläpito → Avaimet: a key's state in one word and where a removed key's name leads (domain/subscription.js).
// Key names here are made up: real ones never go into this public repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyGives, keyStatus, keyTypedGoesTo, sortKeys } from '../src/domain/subscription.js';

const NOW = new Date('2026-11-11T12:00:00Z');
const key = (over) => ({
  code: 'TESTI', shown: 'Testi', months: 3, maxUses: 5, useCount: 0, expiresAt: null, revokedAt: null,
  createdAt: '2026-10-30T08:00:00Z', note: '', ...over,
});

test('what a key gives', () => {
  assert.equal(keyGives(null), 'Maksuton käyttö');
  assert.equal(keyGives(12), '12 kk ilmaiseksi');
});

test('a key works until it is removed, past its last day or out of uses, checked in that order', () => {
  assert.deepEqual(keyStatus(key(), NOW), { id: 'works', label: 'Toimii', works: true });
  assert.equal(keyStatus(key({ expiresAt: '2026-11-20T00:00:00Z' }), NOW).id, 'works');
  assert.equal(keyStatus(key({ useCount: 4 }), NOW).id, 'works');
  assert.equal(keyStatus(key({ expiresAt: '2026-09-20T00:00:00Z' }), NOW).label, 'Vanhentunut');
  assert.equal(keyStatus(key({ useCount: 5 }), NOW).label, 'Käytetty loppuun');
  assert.equal(keyStatus(key({ revokedAt: '2026-10-30T15:16:00Z' }), NOW).label, 'Poistettu käytöstä');
  // Removed wins over everything else, then the last day, like koutsi_use_code.
  assert.equal(keyStatus(key({ revokedAt: '2026-10-30T15:16:00Z', expiresAt: '2026-09-20T00:00:00Z', useCount: 5 }), NOW).id, 'revoked');
  assert.equal(keyStatus(key({ expiresAt: '2026-09-20T00:00:00Z', useCount: 5 }), NOW).id, 'expired');
});

test('working keys come first, otherwise the order stays', () => {
  const a = key({ code: 'A', revokedAt: '2026-10-30T15:16:00Z' });
  const b = key({ code: 'B' });
  const c = key({ code: 'C', useCount: 5 });
  const d = key({ code: 'D' });
  assert.deepEqual(sortKeys([a, b, c, d], NOW).map((k) => k.code), ['B', 'D', 'A', 'C']);
  assert.deepEqual(sortKeys([], NOW), []);
});

test('a removed key whose name now leads to a working key says so', () => {
  const removed = key({ code: 'TESTI9POISTETTU', shown: 'Testi9', months: null, revokedAt: '2026-10-30T15:16:00Z' });
  const trial = key({ code: 'TESTI9+', shown: 'Testi9+', months: 3 });
  const all = [trial, removed];
  assert.equal(keyTypedGoesTo(removed, all, NOW), trial);
  // A working key, or a name that leads to the key itself, gets no line.
  assert.equal(keyTypedGoesTo(trial, all, NOW), null);
  const usedUp = key({ code: 'KAYTETTY', shown: 'Käytetty', useCount: 5 });
  assert.equal(keyTypedGoesTo(usedUp, [usedUp], NOW), null);
  // The key it would lead to must itself work.
  const deadTrial = { ...trial, revokedAt: '2026-11-01T00:00:00Z' };
  assert.equal(keyTypedGoesTo(removed, [deadTrial, removed], NOW), null);
});

test('typing finds an exact key first; the "+" fallback only when no "+" was typed, oldest first', () => {
  const removed = key({ code: 'X1POISTETTU', shown: 'x1', revokedAt: '2026-10-30T15:16:00Z' });
  const newer = key({ code: 'X1++', shown: 'X1++', createdAt: '2026-11-01T00:00:00Z' });
  const older = key({ code: 'X1+', shown: 'X1+', createdAt: '2026-10-30T08:00:00Z' });
  assert.equal(keyTypedGoesTo(removed, [newer, older, removed], NOW), older);
  const exact = key({ code: 'X1', shown: 'X1' });
  assert.equal(keyTypedGoesTo(removed, [older, exact, removed], NOW), exact);
  // A name with a "+" never falls back.
  const plusRemoved = key({ code: 'Y2+POISTETTU', shown: 'Y2+', revokedAt: '2026-10-30T15:16:00Z' });
  const y2 = key({ code: 'Y2', shown: 'Y2' });
  assert.equal(keyTypedGoesTo(plusRemoved, [y2, plusRemoved], NOW), null);
});
