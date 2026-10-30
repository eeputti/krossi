// Sending to players on a weak connection: when the copies' insert loses its answer (timeout,
// dropped connection) but the rows landed, the send counts as done and its Lähetetyt line stays,
// so the coach's retry can't give players a second copy. Real failures still drop the line.
import test from 'node:test';
import assert from 'node:assert/strict';

const { setClientForTests } = await import('../src/api/supabase/client.js');
const { homework, notes } = await import('../src/api/supabase/coaching.js');

// A tiny stand-in for supabase-js: every query goes through `answer(query)`.
function fakeClient(answer) {
  const log = [];
  return {
    log,
    from(table) {
      const q = { table, op: 'select', eq: null };
      const run = () => { log.push({ ...q }); return answer(q); };
      const b = {
        insert(rows) { q.op = 'insert'; q.rows = rows; return Promise.resolve(run()); },
        select() { return b; },
        delete() { q.op = 'delete'; return b; },
        eq(k, v) { q.eq = [k, v]; return b; },
        limit() { return Promise.resolve(run()); },
        then(ok, fail) { return Promise.resolve(run()).then(ok, fail); },
      };
      return b;
    },
  };
}

const ok = { data: null, error: null };
const timeout = { data: null, error: { name: 'AbortError', message: 'AbortError: The user aborted a request.' } };
const log = { coachId: 'c1', groupIds: ['g1'] };

test('copies that landed although the answer was lost count as sent', async () => {
  const fake = fakeClient((q) => {
    if (q.table === 'koutsi_homework' && q.op === 'insert') return timeout;
    if (q.table === 'koutsi_homework' && q.op === 'select') return { data: [{ id: 'h1' }], error: null };
    return ok;
  });
  setClientForTests(fake);
  assert.equal(await homework.addMany(['s1', 's2'], 'Syötä 20 kertaa', log), 2);
  assert.ok(!fake.log.some((q) => q.table === 'koutsi_sends' && q.op === 'delete'), 'the Lähetetyt line stays');
  setClientForTests(null);
});

test('copies that never landed take their Lähetetyt line with them', async () => {
  const fake = fakeClient((q) => {
    if (q.table === 'koutsi_diary_entries' && q.op === 'insert') return timeout;
    if (q.table === 'koutsi_diary_entries' && q.op === 'select') return { data: [], error: null };
    return ok;
  });
  setClientForTests(fake);
  await assert.rejects(notes.addMany('c1', ['s1'], 'Hyvä treeni', log));
  assert.ok(fake.log.some((q) => q.table === 'koutsi_sends' && q.op === 'delete'));
  setClientForTests(null);
});

test('when we cannot tell, the line stays and the error is shown', async () => {
  const fake = fakeClient((q) => {
    if (q.table === 'koutsi_homework' && q.op === 'insert') return timeout;
    if (q.table === 'koutsi_homework' && q.op === 'select') return timeout;
    return ok;
  });
  setClientForTests(fake);
  await assert.rejects(homework.addMany(['s1'], 'Venyttele', log));
  assert.ok(!fake.log.some((q) => q.table === 'koutsi_sends' && q.op === 'delete'));
  setClientForTests(null);
});

test('a refused insert drops the line without asking again', async () => {
  const fake = fakeClient((q) => {
    if (q.table === 'koutsi_homework' && q.op === 'insert') return { data: null, error: { code: '42501', message: 'permission denied' } };
    return ok;
  });
  setClientForTests(fake);
  await assert.rejects(homework.addMany(['s1'], 'Venyttele', log));
  assert.ok(fake.log.some((q) => q.table === 'koutsi_sends' && q.op === 'delete'));
  assert.ok(!fake.log.some((q) => q.table === 'koutsi_homework' && q.op === 'select'));
  setClientForTests(null);
});
