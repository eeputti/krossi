// CoachRoot.jsx — the coach's gates (same order as the old KoutsiValmentajaRoot):
// auth → recovery → pilot acknowledgement → profile → coach row → coach key → acting check → app.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useSession } from '../app/session.jsx';
import { navigate } from '../app/router.js';
import { AuthScreen, GateError, OnboardingScreen, PilotGate, SetPasswordScreen, Splash, KoutsiWordmark } from '../shared/gates.jsx';
import { Button, Field, Input } from '../ui/index.js';
import { SUPPORT_EMAIL } from '../lib/constants.js';
import { CoachApp } from './CoachApp.jsx';

const ACTING_KEY = 'koutsiActingCoach'; // same key as the old app: a hint only, re-checked server-side

const CoachContext = createContext(null);
/** { coachId, uid, acting: { id, name } | null, actAs(id), exitActing(), isAdmin } */
export function useCoach() {
  const ctx = useContext(CoachContext);
  if (!ctx) throw new Error('useCoach must be used inside the coach app');
  return ctx;
}

function CoachKeyGate({ onRedeemed }) {
  const { signOut } = useSession();
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setError(''); setBusy(true);
    try { await api.coach.redeemKey(key.trim()); await onRedeemed(); } catch (err) { setError(err.userMessage); } finally { setBusy(false); }
  };
  return (
    <div className="k-center-page">
      <div className="k-gate-card">
        <KoutsiWordmark size="sm" />
        <h1 className="k-gate-title">Tiliäsi ei ole vielä liitetty valmentajaksi</h1>
        <p className="k-gate-lead">Jos olet valmentaja, syötä Krossilta saamasi valmentaja-avain. Jos sinulla ei vielä ole avainta, <a href={`mailto:${SUPPORT_EMAIL}?subject=Valmentaja-avain%20Koutsiin`}>pyydä se sähköpostilla</a>.</p>
        <form className="auth-form" onSubmit={submit}>
          <Field label="Valmentaja-avain" htmlFor="coach-key" error={error || null}>
            <Input id="coach-key" size="lg" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoFocus autoComplete="off" />
          </Field>
          <Button type="submit" variant="dark" size="lg" block disabled={!key.trim()} loading={busy}>Vahvista</Button>
        </form>
        <Button variant="ghost" block onClick={signOut}>Kirjaudu ulos</Button>
      </div>
    </div>
  );
}

export function CoachRoot() {
  const session = useSession();
  const { uid } = session;
  const [coachRow, setCoachRow] = useState(undefined); // undefined = checking, null = not a coach
  const [rowError, setRowError] = useState(null);
  const [acting, setActing] = useState(undefined); // undefined = validating
  const [actingFor, setActingFor] = useState(null);
  const [isAdmin, setIsAdmin] = useState(null);

  const checkRow = useCallback(async () => {
    if (!uid) return;
    setRowError(null);
    try { setCoachRow(await api.coach.fetchRow(uid)); } catch (err) { setRowError(err); }
  }, [uid]);

  useEffect(() => {
    if (!uid || !session.pilotAccepted || session.needsOnboarding) { setCoachRow(undefined); return; }
    checkRow();
  }, [uid, session.pilotAccepted, session.needsOnboarding, checkRow]);

  useEffect(() => {
    if (!uid) { setIsAdmin(null); return; }
    api.account.isAdmin().then(setIsAdmin).catch(() => setIsAdmin(false));
  }, [uid]);

  // sessionStorage is only a hint: the target is rendered only after the server confirms it.
  useEffect(() => {
    if (!uid) { setActing(undefined); setActingFor(null); return undefined; }
    let cancelled = false;
    let cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(ACTING_KEY) || 'null'); } catch { cached = null; }
    if (!cached?.id) { setActing(null); setActingFor(uid); return undefined; }
    setActing(undefined);
    api.admin.actAs(cached.id)
      .then((verified) => { if (!cancelled) { setActing(verified); setActingFor(uid); } })
      .catch(() => {
        try { sessionStorage.removeItem(ACTING_KEY); } catch { /* private mode */ }
        if (!cancelled) { setActing(null); setActingFor(uid); }
      });
    return () => { cancelled = true; };
  }, [uid]);

  useEffect(() => {
    if (!uid || actingFor !== uid || acting === undefined) return;
    try {
      if (acting) sessionStorage.setItem(ACTING_KEY, JSON.stringify(acting));
      else sessionStorage.removeItem(ACTING_KEY);
    } catch { /* private mode: the state still lives in memory */ }
  }, [uid, acting, actingFor]);

  const actAs = useCallback(async (coachId) => {
    const verified = await api.admin.actAs(coachId);
    navigate('/valmentaja/viikko', { replace: true });
    setActing(verified);
    setActingFor(uid);
  }, [uid]);
  const exitActing = useCallback(() => {
    navigate('/valmentaja/yllapito', { replace: true });
    setActing(null);
    setActingFor(uid);
  }, [uid]);

  if (session.loading) return <Splash />;
  if (session.recoveryMode && session.session) return <SetPasswordScreen />;
  if (!session.session) return <AuthScreen role="coach" />;
  if (session.pilotError) return <GateError message="Pilotin käyttörajausta ei saatu tarkistettua. Tarkista verkkoyhteys ja yritä uudelleen." onRetry={session.retryPilot} onSignOut={session.signOut} />;
  if (!session.pilotAccepted) return <PilotGate role="coach" />;
  if (session.profileError) return <GateError message="Profiilitietojasi ei saatu haettua. Tarkista verkkoyhteys ja yritä uudelleen." onRetry={session.retryProfile} onSignOut={session.signOut} />;
  if (session.needsOnboarding) return <OnboardingScreen role="coach" />;
  if (rowError) return <GateError error={rowError} onRetry={checkRow} onSignOut={session.signOut} />;
  if (coachRow === undefined) return <Splash />;
  if (!coachRow) return <CoachKeyGate onRedeemed={checkRow} />;
  if (actingFor !== uid || acting === undefined) return <Splash />;

  const coachId = acting ? acting.id : uid;
  const value = { coachId, uid, acting, actAs, exitActing, isAdmin: Boolean(isAdmin) && !acting, adminChecked: isAdmin !== null };
  return (
    <CoachContext.Provider value={value}>
      <CoachApp key={coachId} />
    </CoachContext.Provider>
  );
}
