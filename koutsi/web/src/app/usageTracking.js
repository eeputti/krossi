// usageTracking.js — starts the anonymous usage tracker shared with the old Koutsi
// (lib/koutsi-usage.js) for Ylläpito → Käyttö. Only the production entries call this; the
// demos never load the tracker. __KOUTSI_USAGE_WORDS__ is the app's own wording, filled in by
// build.mjs.
import '../../../../lib/koutsi-usage.js';
import { db } from '../api/supabase/client.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/constants.js';

/* global __KOUTSI_USAGE_WORDS__ */
export function startUsageTracking(role) {
  try {
    window.koutsiUsage?.start({
      app: 'uusi',
      role,
      url: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      words: typeof __KOUTSI_USAGE_WORDS__ === 'string' ? __KOUTSI_USAGE_WORDS__ : '',
      onToken(cb) {
        // only the token is read here; the session handling in app/session.jsx is untouched
        db().auth.onAuthStateChange((_event, session) => cb(session?.access_token));
        db().auth.getSession().then(({ data }) => cb(data?.session?.access_token), () => {});
      },
    });
  } catch { /* analytics only */ }
}
