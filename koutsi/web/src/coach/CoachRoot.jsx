// CoachRoot.jsx — the coach's gates (same order as the old KoutsiValmentajaRoot):
// auth → recovery → pilot acknowledgement → profile → coach row → coach key (or, once the database
// has koutsi_coach_plans, the free trial without a key: TrialStart) → acting check → app.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useSession } from '../app/session.jsx';
import { navigate } from '../app/router.js';
import { AuthScreen, GateError, OnboardingScreen, PilotGate, SetPasswordScreen, Splash, KoutsiWordmark } from '../shared/gates.jsx';
import { Button, Field, Input } from '../ui/index.js';
import { SUPPORT_EMAIL } from '../lib/constants.js';
import { CoachApp } from './CoachApp.jsx';
import { TrialStart } from './TrialStart.jsx';
import { keyWelcome } from '../domain/subscription.js';
import { KeyWelcome } from './KeyWelcome.jsx';

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
  // Without a key (koutsi_coach_plans, once the database has it and sign-ups are open): the free
  // trial first, the key one tap away. Until then this page is exactly the key page.
  const [selfServe, setSelfServe] = useState(undefined);
  const [withKey, setWithKey] = useState(false);
  const [welcome, setWelcome] = useState(null);
  useEffect(() => {
    let alive = true;
    api.subscription.status()
      .then((s) => { if (alive) setSelfServe(Boolean(s.ready && s.selfServe)); })
      .catch(() => { if (alive) setSelfServe(false); });
    return () => { alive = false; };
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setError(''); setBusy(true);
    // a valmentaja-avain that gives more months (a surprise) or an old coach key (api.subscription.useCode)
    try {
      const done = await api.subscription.useCode(key.trim());
      const surprise = keyWelcome(done);
      if (surprise) { setWelcome(surprise); setBusy(false); return; }
      await onRedeemed();
    } catch (err) { setError(err.userMessage); } finally { setBusy(false); }
  };
  if (selfServe === undefined) return <Splash />;
  if (welcome) {
    return (
      <div className="k-center-page">
        <div className="k-gate-card"><KeyWelcome welcome={welcome} onDone={onRedeemed} /></div>
      </div>
    );
  }
  if (selfServe && !withKey) return <TrialStart onStarted={onRedeemed} onUseKey={() => setWithKey(true)} />;
  return (
    <div className="k-center-page">
      <div className="k-gate-card">
        <KoutsiWordmark size="sm" />
        <h1 className="k-gate-title">Tiliäsi ei ole vielä liitetty valmentajaksi</h1>
        {selfServe
          ? <p className="k-gate-lead">Syötä Krossilta saamasi valmentaja-avain.</p>
          : <p className="k-gate-lead">Jos olet valmentaja, syötä Krossilta saamasi valmentaja-avain. Jos sinulla ei vielä ole avainta, <a href={`mailto:${SUPPORT_EMAIL}?subject=Valmentaja-avain%20Koutsiin`}>pyydä se sähköpostilla</a>.</p>}
        <form className="auth-form" onSubmit={submit}>
          <Field label="Valmentaja-avain" htmlFor="coach-key" error={error || null}>
            <Input id="coach-key" size="lg" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoFocus autoComplete="off" />
          </Field>
          <Button type="submit" variant="dark" size="lg" block missing={!key.trim() ? 'Kirjoita valmentaja-avain.' : null} loading={busy}>Vahvista</Button>
          {/* a key starts the trial on the subscription terms (koutsi_use_code records the acceptance) */}
          <p className="k-fine"><span>Jatkamalla vahvistat olevasi vähintään 18-vuotias ja hyväksyt <a href="/tilausehdot" target="_blank" rel="noopener">tilausehdot</a> ja <a href="/kasittelysopimus" target="_blank" rel="noopener">käsittelysopimuksen</a>.</span></p>
        </form>
        {selfServe
          ? <Button variant="ghost" block onClick={() => { setWithKey(false); setError(''); }}>Takaisin</Button>
          : <Button variant="ghost" block onClick={signOut}>Kirjaudu ulos</Button>}
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
    navigate('/valmentaja/koti', { replace: true });
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
