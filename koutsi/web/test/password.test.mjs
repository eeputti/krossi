// Profiili → Salasana: the current password is checked (by signing in with it) before the new one
// is saved; a Google / Apple account sets a first one without it; Supabase's refusals read in Finnish.
import test from 'node:test';
import assert from 'node:assert/strict';

const { setClientForTests } = await import('../src/api/supabase/client.js');
const { auth } = await import('../src/api/supabase/account.js');

function fake({ user = { email: 'anna@example.com', identities: [{ provider: 'email' }], user_metadata: {} }, signInError = null, updateError = null } = {}) {
  const log = { signIns: [], updates: [] };
  return {
    log,
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      signInWithPassword: async (creds) => { log.signIns.push(creds); return { data: {}, error: signInError }; },
      updateUser: async (attrs) => { log.updates.push(attrs); return { data: { user }, error: updateError }; },
    },
  };
}

test('getPasswordState: an e-mail sign-up has a password; a Google account only once it was set here', async () => {
  setClientForTests(fake());
  try { assert.deepEqual(await auth.getPasswordState(), { hasPassword: true, email: 'anna@example.com' }); } finally { setClientForTests(null); }
  setClientForTests(fake({ user: { email: 'g@example.com', identities: [{ provider: 'google' }], user_metadata: {} } }));
  try { assert.equal((await auth.getPasswordState()).hasPassword, false); } finally { setClientForTests(null); }
  setClientForTests(fake({ user: { email: 'g@example.com', identities: [{ provider: 'google' }], user_metadata: { password_set: true } } }));
  try { assert.equal((await auth.getPasswordState()).hasPassword, true); } finally { setClientForTests(null); }
});

test('changePassword: checks the current password with the account e-mail, then saves the new one', async () => {
  const f = fake();
  setClientForTests(f);
  try {
    await auth.changePassword({ current: 'vanha-salasana', next: 'uusi-salasana' });
    assert.deepEqual(f.log.signIns, [{ email: 'anna@example.com', password: 'vanha-salasana' }]);
    assert.deepEqual(f.log.updates, [{ password: 'uusi-salasana', data: { password_set: true } }]);
  } finally { setClientForTests(null); }
});

test('changePassword: a wrong current password saves nothing', async () => {
  const f = fake({ signInError: { code: 'invalid_credentials', message: 'Invalid login credentials' } });
  setClientForTests(f);
  try {
    await assert.rejects(() => auth.changePassword({ current: 'väärä', next: 'uusi-salasana' }), (err) => err.code === 'wrong_password' && /Nykyinen salasana ei täsmää/.test(err.userMessage));
    assert.deepEqual(f.log.updates, []);
  } finally { setClientForTests(null); }
});

test('changePassword: a first password (Google / Apple account) needs no current one', async () => {
  const f = fake({ user: { email: 'g@example.com', identities: [{ provider: 'google' }], user_metadata: {} } });
  setClientForTests(f);
  try {
    await auth.changePassword({ current: null, next: 'uusi-salasana' });
    assert.deepEqual(f.log.signIns, []);
    assert.equal(f.log.updates.length, 1);
  } finally { setClientForTests(null); }
});

test('changePassword: too short, or the same as before, says so in Finnish', async () => {
  const f = fake();
  setClientForTests(f);
  try {
    await assert.rejects(() => auth.changePassword({ current: 'x', next: 'lyhyt' }), (err) => err.code === 'weak_password');
    assert.deepEqual(f.log.signIns, [], 'nothing is tried with a too short password');
  } finally { setClientForTests(null); }
  setClientForTests(fake({ updateError: { code: 'same_password', message: 'New password should be different from the old password.' } }));
  try {
    await assert.rejects(() => auth.changePassword({ current: 'sama-salasana', next: 'sama-salasana' }), (err) => err.code === 'same_password' && /ei voi olla sama/.test(err.userMessage));
  } finally { setClientForTests(null); }
});
