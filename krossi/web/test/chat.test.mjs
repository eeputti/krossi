// Chat list merging: realtime/send results (mergeMessage) and the resync snapshot (mergeSnapshot).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergeMessage, mergeSnapshot } from '../src/screens/messages/chatUtils.js';

const ME = 'me';
const t = (min) => new Date(Date.UTC(2026, 9, 5, 12, min)).toISOString();
const msg = (id, min, extra = {}) => ({ id, senderId: 'other', kind: 'text', text: id, createdAt: t(min), ...extra });
const mine = (id, min, text, extra = {}) => msg(id, min, { senderId: ME, text, ...extra });
const local = (id, min, text, extra = {}) => mine(id, min, text, { key: id, local: true, ...extra });
const ids = (list) => list.map((m) => m.id);

describe('mergeSnapshot', () => {
  test('a sent bubble keeps its tmp key, so it is not re-mounted', () => {
    // Sent during this visit: deliver() swapped tmp-1 for s1 and kept the key.
    const curr = mergeMessage([msg('a', 0), local('tmp-1', 1, 'moi')], mine('s1', 1, 'moi'), ME, 'tmp-1');
    assert.equal(curr[1].key, 'tmp-1');
    const out = mergeSnapshot(curr, [msg('a', 0), mine('s1', 1, 'moi')], ME);
    assert.deepEqual(ids(out), ['a', 's1']);
    assert.equal(out[1].key, 'tmp-1');
    assert.equal(out[0].key, undefined);
  });

  test('known messages take the server version', () => {
    const out = mergeSnapshot([msg('a', 0, { meta: null })], [msg('a', 0, { meta: { x: 1 } })], ME);
    assert.deepEqual(out[0].meta, { x: 1 });
  });

  test('messages that arrived after the snapshot was read stay', () => {
    // 'late' came by realtime and 's2' by a finished send while the fetch was in flight.
    const curr = [msg('a', 0), msg('late', 5), mine('s2', 6, '👍', { kind: 'thumbs', key: 'tmp-2' })];
    const out = mergeSnapshot(curr, [msg('a', 0)], ME);
    assert.deepEqual(ids(out), ['a', 'late', 's2']);
    assert.equal(out[2].key, 'tmp-2');
  });

  test('missed messages are added in time order before pending bubbles', () => {
    const curr = [msg('a', 0), msg('late', 9), local('tmp-3', 10, 'hei')];
    const out = mergeSnapshot(curr, [msg('a', 0), msg('b', 2), msg('c', 3)], ME);
    assert.deepEqual(ids(out), ['a', 'b', 'c', 'late', 'tmp-3']);
  });

  test('a pending bubble the server already has is replaced, not duplicated', () => {
    const curr = [msg('a', 0), local('tmp-4', 1, 'moi')];
    const out = mergeSnapshot(curr, [msg('a', 0), mine('s4', 1, 'moi')], ME);
    assert.deepEqual(ids(out), ['a', 's4']);
    assert.equal(out[1].key, 'tmp-4');
    assert.equal(out[1].local, undefined);
    // deliver() finishing afterwards is then a no-op.
    assert.deepEqual(ids(mergeMessage(out, mine('s4', 1, 'moi'), ME, 'tmp-4')), ['a', 's4']);
  });

  test('a failed bubble stays at the bottom', () => {
    const curr = [msg('a', 0), local('tmp-5', 1, 'moi', { failed: true })];
    const out = mergeSnapshot(curr, [msg('a', 0), msg('b', 2)], ME);
    assert.deepEqual(ids(out), ['a', 'b', 'tmp-5']);
  });

  test('a snapshot that no longer reaches the screen replaces the older messages (no silent gap)', () => {
    const curr = [msg('a', 0), msg('b', 1), local('tmp-6', 2, 'moi')];
    const out = mergeSnapshot(curr, [msg('x', 30), msg('y', 31)], ME);
    assert.deepEqual(ids(out), ['x', 'y', 'tmp-6']);
  });

  test('an empty snapshot keeps the thread', () => {
    const curr = [msg('a', 0)];
    assert.deepEqual(ids(mergeSnapshot(curr, [], ME)), ['a']);
  });
});
