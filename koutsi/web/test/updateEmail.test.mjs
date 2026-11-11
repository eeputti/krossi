// Profiili → Sähköposti: the new address goes to Supabase Auth as typed (trimmed), the answer says
// whether it is already in use, and an address that belongs to another account reads in Finnish.
import test from 'node:test';
import assert from 'node:assert/strict';

const { setClientForTests } = await import('../src/api/supabase/client.js');
const { auth } = await import('../src/api/supabase/account.js');

function fake(answer) {
  const sent = [];
  return {
    sent,
    auth: { updateUser: async (attrs) => { sent.push(attrs); return answer(attrs); } },
  };
}

test('updateEmail: trims the address and returns the one now on the account', async () => {
  const f = fake(({ email }) => ({ data: { user: { email, new_email: null } }, error: null }));
  setClientForTests(f);
  try {
    const res = await auth.updateEmail('  uusi@example.com ');
    assert.deepEqual(f.sent, [{ email: 'uusi@example.com' }]);
    assert.deepEqual(res, { email: 'uusi@example.com', pending: null });
  } finally { setClientForTests(null); }
});

test('updateEmail: a confirmation link (if ever switched on) is reported as pending', async () => {
  const f = fake(({ email }) => ({ data: { user: { email: 'vanha@example.com', new_email: email } }, error: null }));
  setClientForTests(f);
  try {
    assert.deepEqual(await auth.updateEmail('uusi@example.com'), { email: 'vanha@example.com', pending: 'uusi@example.com' });
  } finally { setClientForTests(null); }
});

test('updateEmail: an address on another account says so in Finnish', async () => {
  const f = fake(() => ({ data: { user: null }, error: { code: 'email_exists', message: 'A user with this email address has already been registered' } }));
  setClientForTests(f);
  try {
    await assert.rejects(() => auth.updateEmail('toinen@example.com'), (err) => err.code === 'email_taken' && /jo toinen tili/.test(err.userMessage));
  } finally { setClientForTests(null); }
});
