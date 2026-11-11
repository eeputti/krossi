// Profiili → Kirjautumistavat: Liitä sends Supabase the provider and the app's own sign-in address,
// Irrota never takes the last way to sign in, and Supabase's linking errors read in Finnish.
import test from 'node:test';
import assert from 'node:assert/strict';

const { setClientForTests } = await import('../src/api/supabase/client.js');
const { auth } = await import('../src/api/supabase/account.js');
const { loginError } = await import('../src/api/errors.js');

const identity = (provider) => ({ identity_id: `id-${provider}`, provider, identity_data: { email: `${provider}@example.com` } });

function fake({ identities = [], linkError = null, unlinkError = null } = {}) {
  const log = { linked: [], unlinked: [] };
  return {
    log,
    auth: {
      getUser: async () => ({ data: { user: { identities } }, error: null }),
      getUserIdentities: async () => ({ data: { identities }, error: null }),
      linkIdentity: async (opts) => { log.linked.push(opts); return { data: {}, error: linkError }; },
      unlinkIdentity: async (i) => { log.unlinked.push(i.identity_id); return { data: {}, error: unlinkError }; },
    },
  };
}

test('getLogins: one row per way to sign in, with its address', async () => {
  setClientForTests(fake({ identities: [identity('email'), identity('google')] }));
  try {
    assert.deepEqual(await auth.getLogins(), [
      { provider: 'email', email: 'email@example.com' },
      { provider: 'google', email: 'google@example.com' },
    ]);
  } finally { setClientForTests(null); }
});

test('linkLogin: the provider and the sign-in address go to Supabase; the browser leaves', async () => {
  const f = fake();
  setClientForTests(f);
  try {
    assert.deepEqual(await auth.linkLogin('apple', 'https://koutsi.krossi.app/pelaaja'), { redirecting: true });
    assert.deepEqual(f.log.linked, [{ provider: 'apple', options: { redirectTo: 'https://koutsi.krossi.app/pelaaja' } }]);
  } finally { setClientForTests(null); }
});

test('linkLogin: manual linking switched off says so in Finnish', async () => {
  setClientForTests(fake({ linkError: { code: 'manual_linking_disabled', message: 'Manual linking is disabled' } }));
  try {
    await assert.rejects(() => auth.linkLogin('google', 'https://x'), (err) => err.code === 'linking_disabled' && /ei ole vielä käytössä/.test(err.userMessage));
  } finally { setClientForTests(null); }
});

test('unlinkLogin: takes the provider off while another way stays; never the last one', async () => {
  const two = fake({ identities: [identity('email'), identity('google')] });
  setClientForTests(two);
  try {
    await auth.unlinkLogin('google');
    assert.deepEqual(two.log.unlinked, ['id-google']);
  } finally { setClientForTests(null); }
  const one = fake({ identities: [identity('google')] });
  setClientForTests(one);
  try {
    await assert.rejects(() => auth.unlinkLogin('google'), (err) => err.code === 'last_identity');
    assert.deepEqual(one.log.unlinked, []);
  } finally { setClientForTests(null); }
});

test('loginError: what Google / Apple send back after Liitä', () => {
  assert.match(loginError({ error_code: 'identity_already_exists', error_description: 'Identity is already linked to another user' }, 'google').userMessage, /Google-tili on jo käytössä toisella tilillä/);
  assert.match(loginError({ error_code: 'access_denied' }, 'apple').userMessage, /Apple-tilin liittäminen keskeytyi/);
  assert.match(loginError({ error_code: 'server_error' }, 'google').userMessage, /liittäminen ei onnistunut/);
  assert.match(loginError({ code: 'x' }, 'google', { unlink: true }).userMessage, /ei voitu irrottaa/);
});
