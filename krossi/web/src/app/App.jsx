// App.jsx — providers + the top-level gate: splash → auth → onboarding → app.
import { Component, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../api/index.js';
import { ConfirmProvider, ErrorState, TennisBall, ToastProvider, confetti, useToast } from '../ui/index.js';
import { AuthScreen } from '../screens/auth/AuthScreen.jsx';
import { OnboardingScreen } from '../screens/auth/OnboardingScreen.jsx';
import { InviteScreen } from '../screens/auth/InviteScreen.jsx';
import { PublicGameScreen } from '../screens/games/PublicGameScreen.jsx';
import { PendingOutcomeCheck } from '../screens/home/PendingOutcomeCheck.jsx';
import { SetPasswordSheet } from '../screens/auth/SetPasswordSheet.jsx';
import { AppShell } from './AppShell.jsx';
import { PaywallProvider } from './paywall.jsx';
import { configureRouter, navigate, useRoute } from './router.js';
import { SessionProvider, useSession } from './session.jsx';

// Where a logged-out visitor was heading (shared game link, invite) — reopened after sign-in.
export const AFTER_AUTH_KEY = 'krossi_after_auth';
// Invite code from /pelaa/kutsu/<code>, claimed once the new player has a profile.
export const INVITE_CODE_KEY = 'krossi_invite_code';
// Where the player was when they started Stripe Checkout (Checkout always returns to /pelaa).
export const AFTER_PAYMENT_KEY = 'krossi_after_payment';

const store = {
  get: (k) => { try { return sessionStorage.getItem(k) || localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); localStorage.setItem(k, v); } catch { /* ignore */ } },
  remove: (k) => { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch { /* ignore */ } },
};
export { store as authStore };

// A remembered destination only counts for a while: a stale one would otherwise fire much later
// for whoever signs in next in this browser. Stored as "<ms>|<path>".
const AFTER_AUTH_TTL_MS = 2 * 60 * 60 * 1000;
function rememberAfterAuth(path) { store.set(AFTER_AUTH_KEY, `${Date.now()}|${path}`); }
/** The remembered destination if it's still fresh (doesn't consume it). */
export function peekAfterAuth() {
  const [at, path] = String(store.get(AFTER_AUTH_KEY) || '').split('|');
  return path && Date.now() - Number(at) < AFTER_AUTH_TTL_MS ? path : null;
}
function takeAfterAuth() {
  const path = peekAfterAuth();
  store.remove(AFTER_AUTH_KEY);
  return path;
}

// Supabase sends failed email links (expired, already used — mail scanners prefetch them) back
// as /pelaa#error=…&error_code=otp_expired. Explain instead of silently showing the login.
const AUTH_LINK_ERRORS = {
  otp_expired: 'Linkki on vanhentunut tai jo käytetty. Pyydä uusi linkki ja avaa se heti.',
  access_denied: 'Linkki ei enää kelpaa. Pyydä uusi linkki.',
};
function useAuthLinkError() {
  const toast = useToast();
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    if (!/(^|&)error(_code|_description)?=/.test(hash)) return;
    const params = new URLSearchParams(hash);
    const code = params.get('error_code') || params.get('error');
    toast(AUTH_LINK_ERRORS[code] || 'Kirjautumislinkki ei toiminut. Yritä uudelleen.', { tone: 'error', duration: 7000 });
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }, [toast]);
}

/** Last line of defence: a render error shows a friendly page instead of a blank screen. */
class AppErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Krossi crashed', error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="gate-error">
        <ErrorState
          title="Hups, jokin meni rikki"
          error={{ userMessage: 'Sivu kaatui odottamattomasti. Lataa sivu uudelleen — tietosi ovat tallessa.' }}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }
}

export function Splash() {
  return (
    <div className="splash" aria-label="Ladataan Krossia">
      <TennisBall size={52} motion="bounce" shadow />
      <div className="splash-word">Krossi</div>
    </div>
  );
}

/** Handles ?stripe=success|cancel after Stripe Checkout redirects back. */
function useStripeReturn() {
  const route = useRoute();
  const { refreshProfile, user } = useSession();
  const toast = useToast();
  const handled = useRef(false);
  useEffect(() => {
    const status = route.query.stripe;
    if (!status || !user || handled.current) return;
    handled.current = true;
    const clean = route.path;
    if (status === 'success') {
      // The webhook may land a moment after the redirect — poll briefly until paid_at shows up.
      let tries = 0;
      const poll = async () => {
        const p = await refreshProfile();
        if (p?.paidAt) {
          toast('Krossi on nyt auki — pelit voi alkaa! 🎾', { icon: 'sparkles', duration: 4200 });
          confetti();
        } else if (++tries < 6) setTimeout(poll, 1500);
        else toast('Maksu vastaanotettu. Avaus voi viedä hetken — päivitä sivu, jos lukko ei aukea.', { tone: 'info', duration: 6000 });
      };
      poll();
    } else if (status === 'cancel') {
      toast('Maksu peruttiin — mitään ei veloitettu.', { tone: 'info' });
    }
    const back = store.get(AFTER_PAYMENT_KEY);
    store.remove(AFTER_PAYMENT_KEY);
    navigate(back && back.startsWith('/pelaa') ? back : clean, { replace: true });
  }, [route.query.stripe, route.path, user, refreshProfile, toast]);
}

function Gate() {
  const session = useSession();
  const route = useRoute();
  useStripeReturn();
  useAuthLinkError();

  // Remember shared-link destinations for after sign-in, and invite codes for after onboarding.
  useEffect(() => {
    if (session.user) return;
    if (route.name === 'game') rememberAfterAuth(route.path);
    if (route.name === 'invite') store.set(INVITE_CODE_KEY, route.params.code);
  }, [session.user, route.name, route.path, route.params.code]);

  useEffect(() => {
    // Wait for a Krossi player profile: krossi_claim_invite needs tennis_preferences.
    if (!session.user || !session.profile || session.needsOnboarding) return;
    const code = store.get(INVITE_CODE_KEY);
    if (code) { store.remove(INVITE_CODE_KEY); api.invites.claim(code).catch(() => {}); }
    const next = takeAfterAuth();
    if (next) { if (next !== route.path) navigate(next, { replace: true }); }
    else if (route.name === 'invite') navigate('/pelaa/koti', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user, session.profile, session.needsOnboarding]);

  if (session.loading) return <Splash />;
  if (!session.user) {
    if (route.name === 'game') return <PublicGameScreen params={route.params} query={route.query} />;
    if (route.name === 'invite') return <InviteScreen params={route.params} query={route.query} />;
    return <AuthScreen />;
  }
  if (session.profileError && !session.profile) {
    return (
      <div className="gate-error">
        <ErrorState error={session.profileError} title="Profiilia ei saatu ladattua" onRetry={() => session.refreshProfile()} />
      </div>
    );
  }
  if (session.needsOnboarding) return <OnboardingScreen />;
  return (
    <>
      <AppShell />
      <PendingOutcomeCheck />
      <SetPasswordSheet />
    </>
  );
}

export function mountApp({ demo = false } = {}) {
  configureRouter({ demo });
  createRoot(document.getElementById('root')).render(
    <AppErrorBoundary>
    <ToastProvider>
      <ConfirmProvider>
        <SessionProvider>
          <PaywallProvider>
            <Gate />
          </PaywallProvider>
        </SessionProvider>
      </ConfirmProvider>
    </ToastProvider>
    </AppErrorBoundary>,
  );
}
