// session.jsx — who is signed in, their shared profile and the pilot acknowledgement.
//
//   const { user, profile, loading, needsOnboarding, pilotAccepted, recoveryMode, signOut } = useSession();
//
// Same behaviour as the old KoutsiAuthProvider (lib/koutsi-auth.jsx), which was tuned on the
// pilot: the first render waits for getSession() so a stray early auth event can't flash the
// gates; a returning tab (same user, new SIGNED_IN) never remounts the app; a failed profile
// fetch is an error, not "new user"; a recovery link leads to a new password, not the app.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';

const SessionContext = createContext(null);

const recoveryInUrl = () => window.location.hash.includes('type=recovery') || new URLSearchParams(window.location.search).get('type') === 'recovery';

export function SessionProvider({ appName, children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [pilotAccepted, setPilotAccepted] = useState(false);
  const [pilotError, setPilotError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(recoveryInUrl);
  const appliedUid = useRef(undefined); // undefined = nothing applied yet, null = signed out
  const initialChecked = useRef(false);

  const loadProfile = useCallback(async (uid) => {
    try {
      setProfile(await api.account.getProfile(uid));
      setProfileError(null);
    } catch (err) {
      setProfile(null);
      setProfileError(err);
    }
  }, []);
  const loadPilot = useCallback(async (uid) => {
    try {
      setPilotAccepted(await api.account.getPilotAcknowledgement(uid));
      setPilotError(null);
    } catch (err) {
      setPilotAccepted(false);
      setPilotError(err);
    }
  }, []);

  const applySession = useCallback((s) => {
    setSession(s);
    const uid = s?.user?.id || null;
    if (uid === appliedUid.current) return; // same person returning — keep the app mounted
    appliedUid.current = uid;
    if (!uid) {
      setProfile(null); setPilotAccepted(false); setPilotError(null); setProfileError(null); setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([loadProfile(uid), loadPilot(uid)]).finally(() => setLoading(false));
    // One app open per person picking the app up; deferred so it can never touch auth state.
    setTimeout(() => { api.account.recordAppOpen(appName).catch(() => {}); }, 0);
  }, [appName, loadProfile, loadPilot]);

  useEffect(() => {
    let alive = true;
    api.auth.getSession()
      .then((s) => { initialChecked.current = true; if (alive) applySession(s); })
      .catch(() => { initialChecked.current = true; if (alive) setLoading(false); });
    const unsubscribe = api.auth.onChange((event, s) => {
      if (!alive || !initialChecked.current) return;
      if (event === 'PASSWORD_RECOVERY') { setSession(s); setRecoveryMode(true); setLoading(false); return; }
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') { setSession(s); return; }
      applySession(s);
    });
    return () => { alive = false; unsubscribe?.(); };
  }, [applySession]);

  const uid = session?.user?.id || null;
  const retryProfile = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    await loadProfile(uid);
    setLoading(false);
  }, [uid, loadProfile]);
  const retryPilot = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    await loadPilot(uid);
    setLoading(false);
  }, [uid, loadPilot]);
  const acceptPilot = useCallback(async () => {
    await api.account.acceptPilot(uid);
    setPilotAccepted(true);
    setPilotError(null);
  }, [uid]);
  const refreshProfile = useCallback(() => (uid ? loadProfile(uid) : Promise.resolve()), [uid, loadProfile]);
  const signOut = useCallback(() => api.auth.signOut().catch(() => {}), []);

  const value = useMemo(() => ({
    session, user: session?.user || null, uid, profile, loading,
    needsOnboarding: Boolean(uid && !profile && !profileError && !loading),
    profileError, retryProfile,
    pilotAccepted, pilotError, retryPilot, acceptPilot,
    recoveryMode,
    endRecovery: () => {
      setRecoveryMode(false);
      // drop the recovery fragment so a refresh doesn't reopen the reset screen
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search.replace(/([?&])type=recovery&?/, '$1').replace(/[?&]$/, ''));
    },
    refreshProfile, setProfile, signOut,
  }), [session, uid, profile, loading, profileError, retryProfile, pilotAccepted, pilotError, retryPilot, acceptPilot, recoveryMode, refreshProfile, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
