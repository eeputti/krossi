// auth.js — sign-in, sign-up and session for krossi.app/pelaa.

import { db, rememberUid, trackPixel } from './client.js';
import { ApiError, toApiError } from '../errors.js';

// Every auth email and OAuth flow returns the user to the app, not the landing page.
const redirectTo = () => `${window.location.origin}/pelaa`;

function mapSession(session) {
  if (!session?.user) return null;
  const meta = session.user.user_metadata || {};
  // `name` lets onboarding prefill the name Google / Apple already gave us.
  const name = String(meta.full_name || meta.name || meta.display_name || '').trim() || null;
  return { user: { id: session.user.id, email: session.user.email ?? null, name } };
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
