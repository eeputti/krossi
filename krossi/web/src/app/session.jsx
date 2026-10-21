// session.jsx — who is signed in, their profile, and their roles.
//
//   const { user, profile, paid, isAdmin, canCreateEvents, eventCities, refreshProfile, setProfile } = useSession();
//   ready — the first session check is done (a later sign-in reloads the profile with loading true, ready stays).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(null); // null = still checking
  const [eventCities, setEventCities] = useState([]);
  const [recovery, setRecovery] = useState(false); // opened a password-reset link
  const trackedUid = useRef(null);
  const loadedUid = useRef(null);
  // Only the latest load (or setProfile) counts: a slow load started before the booking site's quick
  // account saved its profile must not put an empty one back.
  const profileSeq = useRef(0);

  const loadProfile = useCallback(async (uid) => {
    const seq = ++profileSeq.current;
    if (!uid) { setProfile(null); return null; }
    try {
      const p = await api.profile.getMine(uid);
      if (seq === profileSeq.current) { setProfile(p); setProfileError(null); }
      return p;
    } catch (err) {
      if (seq === profileSeq.current) setProfileError(err);
      return null;
    }
  }, []);

  const setProfileNow = useCallback((p) => {
    profileSeq.current += 1;
    setProfile(p);
    setProfileError(null);
  }, []);

  const applySession = useCallback(async (s, { force = false } = {}) => {
    setSession(s);
    const uid = s?.user?.id || null;
    if (!uid) {
      loadedUid.current = null;
      setProfile(null); setIsAdmin(false); setEventCities([]); setLoading(false); setReady(true);
      return;
    }
    // Token refreshes / tab refocus fire auth events with the same user — don't reload for those.
    if (loadedUid.current === uid && !force) return;
    loadedUid.current = uid;
    setLoading(true);
    if (trackedUid.current !== uid) { trackedUid.current = uid; api.profile.recordAppOpen().catch(() => {}); }
    await loadProfile(uid);
    setLoading(false);
    setReady(true);
    setIsAdmin(null);
    api.profile.isAdmin().then(setIsAdmin).catch(() => setIsAdmin(false));
    api.profile.myEventCities().then(setEventCities).catch(() => setEventCities([]));
  }, [loadProfile]);

  useEffect(() => {
    let alive = true;
    api.auth.getSession()
      .then((s) => { if (alive) applySession(s); })
      .catch(() => { if (alive) { setSession(null); setLoading(false); setReady(true); } });
    const unsubscribe = api.auth.onChange((event, s) => {
      if (!alive) return;
      if (event === 'SIGNED_OUT') { setRecovery(false); applySession(null); return; }
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      applySession(s);
    });
    return () => { alive = false; unsubscribe?.(); };
  }, [applySession]);

  const refreshProfile = useCallback(() => loadProfile(session?.user?.id), [loadProfile, session?.user?.id]);

  const value = useMemo(() => {
    const user = session?.user || null;
    return {
      session, user, profile, loading, ready, profileError,
      paid: Boolean(profile?.paidAt),
      isAdmin,
      eventCities,
      canCreateEvents: Boolean(isAdmin) || eventCities.length > 0,
      // No profile yet, or a profile Krossi Koutsi created (shared table) without Krossi player data.
      needsOnboarding: Boolean(user && !loading && !profileError && (!profile || profile.isKrossiPlayer === false)),
      refreshProfile,
      setProfile: setProfileNow,
      recovery,
      endRecovery: () => setRecovery(false),
    };
  }, [session, profile, loading, ready, profileError, isAdmin, eventCities, refreshProfile, setProfileNow, recovery]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
