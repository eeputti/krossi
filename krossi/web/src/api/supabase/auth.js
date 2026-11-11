// auth.js — sign-in, sign-up and session for krossi.app/pelaa.

import { db, rememberUid, trackPixel } from './client.js';
import { ApiError, loginError, toApiError } from '../errors.js';

// Every auth email and OAuth flow returns the user to the app, not the landing page.
const redirectTo = () => `${window.location.origin}/pelaa`;

function mapSession(session) {
  if (!session?.user) return null;
  const meta = session.user.user_metadata || {};
  // `name` lets onboarding prefill the name Google / Apple already gave us.
  const name = String(meta.full_name || meta.name || meta.display_name || '').trim() || null;
  // bookingProfile: the booking site's quick account (a name only) — onboarding treats it as new.
  return { user: { id: session.user.id, email: session.user.email ?? null, name, bookingProfile: meta.krossi_booking_profile === true } };
}

export async function getSession() {
  const { data, error } = await db().auth.getSession();
  if (error) throw toApiError(error, 'Kirjautumistietoja ei voitu lukea.');
  rememberUid(data.session?.user?.id ?? null);
  return mapSession(data.session);
}

/**
 * Returns the unsubscribe function directly. The callback is invoked without awaiting it:
 * supabase-js holds its auth lock while notifying, so an async listener that queried the
 * database from inside the notification would deadlock.
 */
export function onChange(cb) {
  const { data } = db().auth.onAuthStateChange((event, session) => {
    rememberUid(session?.user?.id ?? null);
    cb(event, mapSession(session));
  });
  return () => data.subscription.unsubscribe();
}

export async function signInWithPassword(email, password) {
  const { error } = await db().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw toApiError(error, 'Kirjautuminen epäonnistui.');
}

export async function signUp(email, password) {
  if (!password || password.length < 8) {
    throw new ApiError('Salasanan pitää olla vähintään 8 merkkiä.', { code: 'weak_password' });
  }
  const { data, error } = await db().auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: redirectTo() },
  });
  if (error) throw toApiError(error, 'Tilin luonti epäonnistui.');
  trackPixel('Lead');
  return { needsConfirmation: Boolean(data.user && !data.session) };
}

export async function resetPassword(email) {
  const { error } = await db().auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo() });
  if (error) throw toApiError(error, 'Palautuslinkin lähetys epäonnistui.');
}

export async function signInWithOAuth(provider) {
  const { error } = await db().auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } });
  if (error) {
    const name = provider === 'apple' ? 'Apple' : 'Google';
    throw toApiError(error, `${name}-kirjautuminen epäonnistui.`);
  }
}

export async function signOut() {
  const { error } = await db().auth.signOut();
  rememberUid(null);
  if (error) throw toApiError(error, 'Uloskirjautuminen epäonnistui.');
}

export async function getIdentities() {
  const { data, error } = await db().auth.getUser();
  if (error) throw toApiError(error, 'Kirjautumistapoja ei voitu ladata.');
  return [...new Set((data.user?.identities || []).map((i) => i.provider))];
}

/**
 * Asetukset → Sähköposti. Sign-ups confirm themselves (no confirmation mail), and the same
 * setting makes this change take effect at once. → { email, pending }: `pending` only if Supabase
 * ever asks for a confirmation link again (the old address stays until the link is opened).
 */
export async function updateEmail(email) {
  const { data, error } = await db().auth.updateUser({ email: String(email || '').trim() });
  if (error) {
    const raw = `${error.code || ''} ${error.message || ''}`;
    if (/email_exists|already been registered|already registered/i.test(raw)) {
      throw new ApiError('Tällä sähköpostilla on jo toinen tili. Valitse toinen osoite.', { code: 'email_taken' });
    }
    if (/email_address_invalid|invalid format|validate email/i.test(raw)) {
      throw new ApiError('Tarkista sähköpostiosoite.', { code: 'invalid' });
    }
    throw toApiError(error, 'Sähköpostia ei voitu vaihtaa. Yritä hetken päästä uudelleen.');
  }
  return { email: data.user?.email || '', pending: data.user?.new_email || null };
}

/** Asetukset → Tili: → [{ provider: 'email'|'google'|'apple', email }] on this account. */
export async function getLogins() {
  const { data, error } = await db().auth.getUser();
  if (error) throw toApiError(error, 'Kirjautumistapoja ei voitu ladata.');
  return (data.user?.identities || []).map((i) => ({ provider: i.provider, email: i.identity_data?.email || i.email || '' }));
}

/**
 * Liitä Google / Apple: the browser goes to the provider and back to /pelaa, where Supabase has
 * added the login to the signed-in account. Needs "Allow manual linking" on in Supabase Auth.
 */
export async function linkLogin(provider) {
  const { error } = await db().auth.linkIdentity({ provider, options: { redirectTo: redirectTo() } });
  if (error) throw loginError(error, provider);
  return { redirecting: true };
}

/** Irrota: only while another way to sign in stays on the account. */
export async function unlinkLogin(provider) {
  const { data, error } = await db().auth.getUserIdentities();
  if (error) throw toApiError(error, 'Kirjautumistapoja ei voitu ladata.');
  const identities = data?.identities || [];
  const identity = identities.find((i) => i.provider === provider);
  if (!identity) return;
  if (identities.length < 2) throw loginError({ code: 'single_identity_not_deletable' }, provider, { unlink: true });
  const res = await db().auth.unlinkIdentity(identity);
  if (res.error) throw loginError(res.error, provider, { unlink: true });
}

export async function updatePassword(newPassword) {
  if (!newPassword || newPassword.length < 8) throw new ApiError('Salasanan pitää olla vähintään 8 merkkiä.', { code: 'invalid' });
  const { error } = await db().auth.updateUser({ password: newPassword });
  if (error) throw toApiError(error, 'Salasanan vaihto epäonnistui. Pyydä uusi palautuslinkki.');
}
