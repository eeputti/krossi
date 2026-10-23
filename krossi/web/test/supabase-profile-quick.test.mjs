// The booking site's quick account (api.profile.createForBooking): a profile row with just a name and
// the hall's city, hidden from the player lists and marked for onboarding — never over an existing one.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setClientForTests } from '../src/api/supabase/client.js';
import * as profile from '../src/api/supabase/profile.js';

const UID = '00000000-0000-4000-8000-000000000001';

function fakeClient({ existing = null } = {}) {
  const log = { inserted: [], meta: [] };
  let row = existing;
  return {
    log,
    from(table) {
      assert.equal(table, 'profiles');
      const q = {
        select() { return q; },
        eq() { return q; },
        async maybeSingle() { return { data: row, error: null }; },
        async insert(r) {
          log.inserted.push(r);
          row = { ...r, avatar_url: null, avatar_color: 'blue', tennis_preferences: null, availability: [] };
          return { error: null };
        },
      };
      return q;
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: UID, email: 'me@example.com' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      updateUser: async ({ data }) => { log.meta.push(data); return { data: {}, error: null }; },
    },
  };
}

test('createForBooking: a hidden profile with the name and the hall\'s city; the auth name marked as quick', async () => {
  const fake = fakeClient();
  setClientForTests(fake);
  const saved = await profile.createForBooking({ name: '  Ville   Varaaja ', city: 'Lahti' });
  assert.deepEqual(fake.log.inserted, [{ id: UID, name: 'Ville Varaaja', area: 'Lahti', hidden_from_feed: true }]);
  assert.deepEqual(fake.log.meta, [{ display_name: 'Ville Varaaja', full_name: 'Ville Varaaja', krossi_booking_profile: true }]);
  assert.equal(saved.name, 'Ville Varaaja');
  assert.equal(saved.isKrossiPlayer, false, 'onboarding still asks the rest');
});

test('createForBooking: an existing profile stays as it is; an unknown city falls back; a too short name is refused', async () => {
  const fake = fakeClient({ existing: { id: UID, name: 'Pelaaja Olemassa', area: 'Turku', avatar_color: 'red', tennis_preferences: { skill_level: 'B1' } } });
  setClientForTests(fake);
  const saved = await profile.createForBooking({ name: 'Toinen Nimi', city: 'Lahti' });
  assert.equal(fake.log.inserted.length, 0);
  assert.equal(saved.name, 'Pelaaja Olemassa');

  const fresh = fakeClient();
  setClientForTests(fresh);
  await profile.createForBooking({ name: 'Ville', city: 'Atlantis' });
  assert.equal(fresh.log.inserted[0].area, 'Lahti');
  await assert.rejects(profile.createForBooking({ name: ' V ' }), (err) => err.userMessage === 'Kirjoita nimesi.');
});
