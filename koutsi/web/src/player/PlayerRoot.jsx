// PlayerRoot.jsx — the player's gates (same order as the old KoutsiPelaajaRoot):
// auth → recovery → profile → student row → join code → pilot acknowledgement → app.
// An invite link (?koodi=…&oppilas=…) is prefilled; opened on a device where someone else is
// signed in, it shows a warning instead of being silently swallowed.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useSession } from '../app/session.jsx';
import { AuthScreen, GateError, KoutsiWordmark, OnboardingScreen, PilotGate, SetPasswordScreen, Splash } from '../shared/gates.jsx';
import { Button, Field, Icon, Input } from '../ui/index.js';
import { PlayerApp } from './PlayerApp.jsx';

/**
 * Redeems a coach's code. A personal link (?oppilas=) claims that exact placeholder. A shared
 * code that matches exactly one not-yet-joined name asks "oletko sinä?"; if nothing matches,
 * the player is asked whether they're already on the list before any names are shown — the
 * last word is always the player's, never the algorithm's.
 */
export function JoinCodeForm({ onJoined, autoFocus }) {
  const params = new URLSearchParams(window.location.search);
  const [code, setCode] = useState(() => (params.get('koodi') || '').trim().toUpperCase());
  const targetStudent = params.get('oppilas') || '';
  const [phase, setPhase] = useState('form'); // form | suggestion | ask | roster
  const [submitted, setSubmitted] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [roster, setRoster] = useState([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const finish = (r) => {
    setInfo(`Liityit${r?.group_name ? ` ryhmään ${r.group_name}` : ''}${r?.coach_name ? ` — valmentaja ${r.coach_name}` : ''}!`);
    // The invite is used: take it out of the address, or PlayerRoot would read it as someone
    // else's link and show the "olet jo kirjautuneena toisena käyttäjänä" warning to the new player.
    const url = new URL(window.location.href);
    if (url.searchParams.has('koodi') || url.searchParams.has('oppilas')) {
      url.searchParams.delete('koodi'); url.searchParams.delete('oppilas');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
    setTimeout(() => onJoined(), 1200);
  };
  const attempt = async (fn) => {
    setError(''); setBusy(true);
    try { await fn(); } catch (err) { setError(err.userMessage || 'Koodi ei kelvannut.'); setPhase('form'); } finally { setBusy(false); }
  };
  const submit = (e) => {
    e.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    setSubmitted(normalized);
    attempt(async () => {
      if (targetStudent) return finish(await api.invites.claim(normalized, targetStudent));
      const match = await api.invites.matchUnclaimed(normalized);
      if (match?.direct) return finish(await api.invites.claim(normalized, match.id));
      if (match) { setSuggestion(match); setPhase('suggestion'); return undefined; }
      setPhase('ask');
      return undefined;
    });
  };
  if (info) return <div className="auth-alert auth-alert-success" role="status"><Icon name="check-circle" size={18} /><span>{info}</span></div>;
  if (phase === 'suggestion') {
    return (
      <div className="stack-3">
        <p className="k-body-text">Valmentajasi listalla on jo pelaaja nimeltä <strong>{suggestion.name}</strong>. Oletko sinä?</p>
        {error && <p className="field-msg field-msg-error">{error}</p>}
        <div className="sheet-actions">
          <Button variant="soft" size="lg" disabled={busy} onClick={() => attempt(async () => finish(await api.invites.redeem(submitted)))}>Ei, olen uusi</Button>
          <Button variant="dark" size="lg" loading={busy} onClick={() => attempt(async () => finish(await api.invites.claim(submitted, suggestion.id)))}>Kyllä, minä</Button>
        </div>
      </div>
    );
  }
  if (phase === 'ask') {
    return (
      <div className="stack-3">
        <p className="k-body-text">Emme tunnistaneet sinua nimesi perusteella. Onko valmentajasi silti jo lisännyt sinut listalle?</p>
        {error && <p className="field-msg field-msg-error">{error}</p>}
        <Button variant="dark" size="lg" block loading={busy} onClick={() => attempt(async () => { setRoster(await api.invites.unclaimedForCode(submitted)); setPhase('roster'); })}>Olen ehkä jo listalla — näytä nimet</Button>
        <Button variant="outline" size="lg" block disabled={busy} onClick={() => attempt(async () => finish(await api.invites.redeem(submitted)))}>En, olen uusi pelaaja</Button>
      </div>
    );
  }
  if (phase === 'roster') {
    return (
      <div className="stack-3">
        <p className="k-body-text">{roster.length ? 'Valitse itsesi listalta:' : 'Valmentajallasi ei ole juuri nyt ketään odottamassa listalla.'}</p>
        {error && <p className="field-msg field-msg-error">{error}</p>}
        {roster.map((s) => <Button key={s.id} variant="outline" block disabled={busy} onClick={() => attempt(async () => finish(await api.invites.claim(submitted, s.id)))}>{s.name}</Button>)}
        <Button variant="dark" size="lg" block loading={busy} onClick={() => attempt(async () => finish(await api.invites.redeem(submitted)))}>En löydy listalta — olen uusi</Button>
      </div>
    );
  }
  return (
    <form className="stack-3" onSubmit={submit}>
      {error && <p className="field-msg field-msg-error" role="alert">{error}</p>}
      <Field label="Liittymiskoodi" htmlFor="join-code">
        <Input id="join-code" size="lg" className="k-code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Esim. VHDC6P" autoFocus={autoFocus} autoComplete="off" autoCapitalize="characters" />
      </Field>
      <Button type="submit" variant="dark" size="lg" block disabled={!code.trim()} loading={busy}>{targetStudent ? 'Aktivoi oma pelaajaprofiili' : 'Liity'}</Button>
    </form>
  );
}

function InviteCodeScreen({ onJoined }) {
  const { signOut } = useSession();
  return (
    <div className="k-center-page">
      <div className="k-gate-card">
        <KoutsiWordmark size="sm" />
        <h1 className="k-gate-title">Liity valmentajasi ryhmään</h1>
        <p className="k-gate-lead">Syötä valmentajaltasi saamasi liittymiskoodi — tai avaa hänen lähettämänsä linkki, niin koodi täyttyy itsestään.</p>
        <JoinCodeForm onJoined={onJoined} autoFocus />
        <div className="k-gate-note">
          <strong>Etkö tiedä koodia?</strong>
          <p>Koutsiin pääsee valmentajan kutsulla. Jos olet alle 18-vuotias, pyydä valmentajalta juuri sinulle tehty henkilökohtainen linkki. Alle 13-vuotias tarvitsee lisäksi huoltajan hyväksynnän.</p>
        </div>
        <Button variant="ghost" block onClick={signOut}>Kirjaudu ulos</Button>
      </div>
    </div>
  );
}

function InviteMismatchBanner({ onDismiss }) {
  const { signOut } = useSession();
  return (
    <div className="k-mismatch" role="alert">
      <span className="grow">Avasit kutsulinkin, mutta olet jo kirjautuneena toisena käyttäjänä. Jos linkki ei ollut sinulle, kirjaudu ulos ennen kuin jatkat.</span>
      <Button variant="outline" size="sm" onClick={signOut}>Kirjaudu ulos</Button>
      <Button variant="ghost" size="sm" onClick={onDismiss}>Sulje</Button>
    </div>
  );
}

export function PlayerRoot() {
  const session = useSession();
  const { uid } = session;
  const [row, setRow] = useState(undefined); // undefined = checking, null = no coach yet
  const [rowError, setRowError] = useState(null);
  const [mismatch, setMismatch] = useState(false);

  const check = useCallback(async () => {
    if (!uid) return;
    setRowError(null);
    try { setRow((await api.player.fetchRow(uid)) || null); } catch (err) { setRowError(err); }
  }, [uid]);

  useEffect(() => {
    if (!uid || session.needsOnboarding) { setRow(undefined); return; }
    check();
  }, [uid, session.needsOnboarding, check]);

  // An invite in the URL while this account already has a student row: either the same link
  // again (harmless) or someone else's link on this device (not harmless). Always surface it.
  useEffect(() => {
    if (!row) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.get('koodi') && !url.searchParams.get('oppilas')) return;
    setMismatch(true);
    url.searchParams.delete('koodi'); url.searchParams.delete('oppilas');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [row]);

  if (session.loading) return <Splash />;
  if (session.recoveryMode && session.session) return <SetPasswordScreen />;
  if (!session.session) return <AuthScreen role="player" />;
  if (session.profileError) return <GateError message="Profiilitietojasi ei saatu haettua. Tarkista verkkoyhteys ja yritä uudelleen." onRetry={session.retryProfile} onSignOut={session.signOut} />;
  if (session.needsOnboarding) return <OnboardingScreen role="player" />;
  if (rowError) return <GateError error={rowError} onRetry={check} onSignOut={session.signOut} />;
  if (row === undefined) return <Splash />;
  if (!row) return <InviteCodeScreen onJoined={check} />;
  if (session.pilotError) return <GateError message="Pilotin käyttörajausta ei saatu tarkistettua. Tarkista verkkoyhteys ja yritä uudelleen." onRetry={session.retryPilot} onSignOut={session.signOut} />;
  if (!session.pilotAccepted) return <PilotGate role="player" />;
  return (
    <PlayerApp
      studentId={uid}
      banner={mismatch ? <InviteMismatchBanner onDismiss={() => setMismatch(false)} /> : null}
    />
  );
}
