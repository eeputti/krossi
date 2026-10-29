// PlayerRoot.jsx — the player's gates (same order as the old KoutsiPelaajaRoot):
// auth → recovery → profile → student row → join code → pilot acknowledgement → app.
// An invite link (?koodi=…&oppilas=…) is prefilled; opened on a device where someone else is
// signed in, it shows a warning instead of being silently swallowed.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useSession } from '../app/session.jsx';
import { AuthScreen, GateError, KoutsiWordmark, PilotGate, SetPasswordScreen, Splash } from '../shared/gates.jsx';
import { ShareTextButton } from '../shared/bits.jsx';
import { TENNIS_DRAFT_KEY } from '../domain/tennisProfile.js';
import { Button, Field, Icon, Input } from '../ui/index.js';
import { PlayerApp } from './PlayerApp.jsx';
import { PlayerOnboarding } from './PlayerOnboarding.jsx';
import { WaitingProfileSheet } from './WaitingProfileSheet.jsx';

/**
 * Redeems a coach's code. A personal link (?oppilas=) claims that exact placeholder. A shared
 * code that matches exactly one not-yet-joined name asks "oletko sinä?"; if nothing matches,
 * the player is asked whether they're already on the list before any names are shown — the
 * last word is always the player's, never the algorithm's.
 * inline: a player already in the app joining one more group (JoinGroupSheet) — no match means
 * "just join", and onJoined(result) is called at once (the sheet says it and stays open).
 * initialCode: prefilled instead of the address's ?koodi=.
 */
export function JoinCodeForm({ onJoined, autoFocus, inline = false, initialCode = null }) {
  const params = new URLSearchParams(window.location.search);
  const [code, setCode] = useState(() => ((inline ? initialCode : initialCode ?? params.get('koodi')) || '').trim().toUpperCase());
  const targetStudent = inline ? '' : params.get('oppilas') || '';
  const [phase, setPhase] = useState('form'); // form | suggestion | ask | roster
  const [submitted, setSubmitted] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [roster, setRoster] = useState([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const finish = (r) => {
    if (inline) { onJoined(r); return; }
    setInfo(`Liityit${r?.group_name ? ` ryhmään ${r.group_name}` : ''}${r?.coach_name ? ` — valmentaja ${r.coach_name}` : ''}!`);
    // The invite is used: take it out of the address, or PlayerRoot would read it as someone
    // else's link and show the "olet jo kirjautuneena toisena käyttäjänä" warning to the new player.
    const url = new URL(window.location.href);
    if (url.searchParams.has('koodi') || url.searchParams.has('oppilas')) {
      url.searchParams.delete('koodi'); url.searchParams.delete('oppilas');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
    setTimeout(() => onJoined(r), 1200);
  };
  const attempt = async (fn) => {
    setError(''); setBusy(true);
    try { await fn(); } catch (err) { setError(err?.userMessage || 'Koodi ei kelvannut.'); setPhase('form'); } finally { setBusy(false); }
  };
  const submit = (e) => {
    e.preventDefault();
    if (busy) return;
    const normalized = code.trim().toUpperCase().replace(/\s+/g, '');
    if (!normalized) { setError('Kirjoita valmentajalta saamasi koodi.'); return; }
    setSubmitted(normalized);
    attempt(async () => {
      if (targetStudent) return finish(await api.invites.claim(normalized, targetStudent));
      const match = await api.invites.matchUnclaimed(normalized);
      if (match?.direct) return finish(await api.invites.claim(normalized, match.id));
      if (match) { setSuggestion(match); setPhase('suggestion'); return undefined; }
      if (inline) return finish(await api.invites.redeem(normalized));
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
        <Input id="join-code" size="lg" className="k-code-input" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }} placeholder="Esim. VHDC6P" autoFocus={autoFocus} autoComplete="off" autoCapitalize="characters" />
      </Field>
      <Button type="submit" variant="dark" size="lg" block className={code.trim() ? undefined : 'is-incomplete'} loading={busy}>{targetStudent ? 'Aktivoi oma pelaajaprofiili' : 'Liity'}</Button>
    </form>
  );
}

// The message the player sends from their own phone (share sheet) or pastes (desktop).
const ASK_CODE_MESSAGE = 'Hei! Tein tilin Koutsiin (koutsi.krossi.app). Lähetätkö minulle liittymislinkin, niin pääsen mukaan ryhmään?';

function InviteCodeScreen({ onJoined }) {
  const { signOut, user } = useSession();
  const [profileOpen, setProfileOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const filled = saved || Boolean(user?.user_metadata?.[TENNIS_DRAFT_KEY]);
  return (
    <div className="k-center-page">
      <div className="k-gate-card">
        <KoutsiWordmark size="sm" />
        <h1 className="k-gate-title">Liity valmentajasi ryhmään</h1>
        <p className="k-gate-lead">Syötä valmentajaltasi saamasi liittymiskoodi — tai avaa hänen lähettämänsä linkki, niin koodi täyttyy itsestään.</p>
        <JoinCodeForm onJoined={onJoined} autoFocus />
        <div className="k-gate-note k-gate-note-ask">
          <strong>Eikö sinulla ole vielä koodia?</strong>
          <p>Ei hätää — tilisi on valmis. Voit täydentää profiiliasi odottaessa tai sulkea sivun. Kun saat valmentajalta linkin, avaa se, niin koodi täyttyy itsestään ja pääset mukaan.</p>
          {saved && <p className="k-gate-saved" role="status"><Icon name="check-circle" size={16} />Profiili tallennettu. Valmentajasi näkee sen, kun liityt ryhmään.</p>}
          <div className="k-gate-note-actions">
            <ShareTextButton text={ASK_CODE_MESSAGE} title="Koutsin liittymislinkki" label="Pyydä koodi valmentajalta" variant="outline" size="md" icon="send" block />
            <Button variant="outline" size="md" icon="user" block onClick={() => setProfileOpen(true)}>{filled ? 'Muokkaa profiiliasi' : 'Täydennä profiiliasi'}</Button>
          </div>
        </div>
        <p className="k-fine">Alle 18-vuotiaana pyydä valmentajalta juuri sinulle tehty henkilökohtainen linkki. Alle 13-vuotias tarvitsee lisäksi huoltajan hyväksynnän.</p>
        <Button variant="ghost" block onClick={signOut}>Kirjaudu ulos</Button>
      </div>
      <WaitingProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} onSaved={(filled) => { setSaved(filled); setProfileOpen(false); }} />
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
  const [joinCode, setJoinCode] = useState(null);

  const check = useCallback(async () => {
    if (!uid) return;
    setRowError(null);
    try {
      const found = (await api.player.fetchRow(uid)) || null;
      // the tennis card filled in while waiting for a code moves onto the new row before the app
      // loads; a failure leaves it on the account for the next start
      if (found) await api.player.applyTennisDraft(uid).catch(() => {});
      setRow(found);
    } catch (err) { setRowError(err); }
  }, [uid]);

  useEffect(() => {
    if (!uid || session.needsOnboarding) { setRow(undefined); return; }
    check();
  }, [uid, session.needsOnboarding, check]);

  // An invite in the URL while this account already has a student row. A shared code (a group's
  // or the coach's link) is one more group for this player: it opens "Liity ryhmään" with the code
  // filled in. A personal link (?oppilas=) was made for one player — maybe someone else on this
  // device — so that one still warns.
  useEffect(() => {
    if (!row) return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('koodi');
    const personal = url.searchParams.get('oppilas');
    if (!code && !personal) return;
    if (personal) setMismatch(true);
    else setJoinCode(code.trim().toUpperCase());
    url.searchParams.delete('koodi'); url.searchParams.delete('oppilas');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [row]);

  if (session.loading) return <Splash />;
  if (session.recoveryMode && session.session) return <SetPasswordScreen />;
  if (!session.session) return <AuthScreen role="player" />;
  if (session.profileError) return <GateError message="Profiilitietojasi ei saatu haettua. Tarkista verkkoyhteys ja yritä uudelleen." onRetry={session.retryProfile} onSignOut={session.signOut} />;
  if (session.needsOnboarding) return <PlayerOnboarding />;
  if (rowError) return <GateError error={rowError} onRetry={check} onSignOut={session.signOut} />;
  if (row === undefined) return <Splash />;
  if (!row) return <InviteCodeScreen onJoined={check} />;
  if (session.pilotError) return <GateError message="Pilotin käyttörajausta ei saatu tarkistettua. Tarkista verkkoyhteys ja yritä uudelleen." onRetry={session.retryPilot} onSignOut={session.signOut} />;
  if (!session.pilotAccepted) return <PilotGate role="player" />;
  return (
    <PlayerApp
      studentId={uid}
      banner={mismatch ? <InviteMismatchBanner onDismiss={() => setMismatch(false)} /> : null}
      joinCode={joinCode}
    />
  );
}
