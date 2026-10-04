// session.jsx — who is signed in, their profile, and their roles.
//
//   const { user, profile, paid, isAdmin, canCreateEvents, eventCities, refreshProfile, setProfile } = useSession();
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(null); // null = still checking
  const [eventCities, setEventCities] = useState([]);
  const trackedUid = useRef(null);
  const loadedUid = useRef(null);

  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); return null; }
    try {
      const p = await api.profile.getMine(uid);
      setProfile(p);
      setProfileError(null);
      return p;
    } catch (err) {
      setProfileError(err);
      return null;
    }
  }, []);

  const applySession = useCallback(async (s, { force = false } = {}) => {
    setSession(s);
    const uid = s?.user?.id || null;
    if (!uid) {
      loadedUid.current = null;
      setProfile(null); setIsAdmin(false); setEventCities([]); setLoading(false);
      return;
    }
    // Token refreshes / tab refocus fire auth events with the same user — don't reload for those.
    if (loadedUid.current === uid && !force) return;
    loadedUid.current = uid;
    setLoading(true);
    if (trackedUid.current !== uid) { trackedUid.current = uid; api.profile.recordAppOpen().catch(() => {}); }
    await loadProfile(uid);
    setLoading(false);
    setIsAdmin(null);
    api.profile.isAdmin().then(setIsAdmin).catch(() => setIsAdmin(false));
    api.profile.myEventCities().then(setEventCities).catch(() => setEventCities([]));
  }, [loadProfile]);

  useEffect(() => {
    let alive = true;
    api.auth.getSession()
      .then((s) => { if (alive) applySession(s); })
      .catch(() => { if (alive) { setSession(null); setLoading(false); } });
    const unsubscribe = api.auth.onChange((event, s) => {
      if (!alive) return;
      if (event === 'SIGNED_OUT') { applySession(null); return; }
      applySession(s);
    });
    return () => { alive = false; unsubscribe?.(); };
  }, [applySession]);

  const refreshProfile = useCallback(() => loadProfile(session?.user?.id), [loadProfile, session?.user?.id]);

  const value = useMemo(() => {
    const user = session?.user || null;
    return {
      session, user, profile, loading, profileError,
      paid: Boolean(profile?.paidAt),
      isAdmin,
      eventCities,
      canCreateEvents: Boolean(isAdmin) || eventCities.length > 0,
      needsOnboarding: Boolean(user && !profile && !loading && !profileError),
      refreshProfile,
      setProfile,
    };
  }, [session, profile, loading, profileError, isAdmin, eventCities, refreshProfile]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
