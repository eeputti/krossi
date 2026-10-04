// App.jsx — providers + the top-level gate: splash → auth → onboarding → app.
import { useEffect, useRef } from 'react';
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

  // Remember shared-link destinations for after sign-in, and invite codes for after onboarding.
  useEffect(() => {
    if (session.user) return;
    if (route.name === 'game') store.set(AFTER_AUTH_KEY, route.path);
    if (route.name === 'invite') store.set(INVITE_CODE_KEY, route.params.code);
  }, [session.user, route.name, route.path, route.params.code]);

  useEffect(() => {
    if (!session.user || !session.profile) return;
    const code = store.get(INVITE_CODE_KEY);
    if (code) { store.remove(INVITE_CODE_KEY); api.invites.claim(code).catch(() => {}); }
    const next = store.get(AFTER_AUTH_KEY);
    if (next) { store.remove(AFTER_AUTH_KEY); if (next !== route.path) navigate(next, { replace: true }); }
    else if (route.name === 'invite') navigate('/pelaa/koti', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user, session.profile]);

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
    <ToastProvider>
      <ConfirmProvider>
        <SessionProvider>
          <PaywallProvider>
            <Gate />
          </PaywallProvider>
        </SessionProvider>
      </ConfirmProvider>
    </ToastProvider>,
  );
}
