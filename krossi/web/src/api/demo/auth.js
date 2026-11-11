// auth.js (demo) — the visitor is always signed in as Alex. Signing in, up or via OAuth
// does nothing; signing out leaves the demo for the landing page.

import { ME, ME_EMAIL } from './rows.js';
import { run, leaveDemo } from './runtime.js';
import { ApiError } from '../errors.js';
import { startAmbientActivity } from './actions.js';

const session = () => ({ user: { id: ME, email: ME_EMAIL } });
const nothing = () => undefined;

export async function getSession() {
  // The app asks for the session once on load: a good moment to let the world come alive.
  if (typeof window !== 'undefined') startAmbientActivity();
  return run(session);
}

/** (cb) -> unsubscribe, returned directly. The demo session never changes, so cb never fires. */
export function onChange() {
  return () => {};
}

/** (email, password) -> void */
export async function signInWithPassword() {
  await run(nothing);
}

/** (email, password) -> { needsConfirmation } — already "signed in", nothing to confirm. */
export async function signUp() {
  return run(() => ({ needsConfirmation: false }));
}

/** (email) -> void */
export async function resetPassword() {
  await run(nothing);
}

/** ('google'|'apple') -> void */
export async function signInWithOAuth() {
  await run(nothing);
}

export async function signOut() {
  await run(nothing);
  leaveDemo();
}

export async function getIdentities() {
  return run(() => ['email']);
}

/** (email) -> { email, pending } — the demo account keeps the new address until a reload. */
export async function updateEmail(email) {
  return run(() => ({ email: String(email || '').trim().toLowerCase(), pending: null }));
}

// Kirjautumistavat: the demo links without leaving the page (no Google / Apple visit).
let demoLinked = [];
export async function getLogins() {
  return run(() => [{ provider: 'email', email: ME_EMAIL }, ...demoLinked.map((p) => ({ provider: p, email: p === 'apple' ? 'alex@privaterelay.appleid.com' : 'alex.krossi@gmail.com' }))]);
}
export async function linkLogin(provider) {
  return run(() => { if (!demoLinked.includes(provider)) demoLinked.push(provider); return { redirecting: false }; });
}
export async function unlinkLogin(provider) {
  return run(() => { demoLinked = demoLinked.filter((p) => p !== provider); });
}

/** Salasana: the demo account has a password and takes any change. */
export async function getPasswordState() {
  return run(() => ({ hasPassword: true, email: ME_EMAIL }));
}
export async function changePassword({ next } = {}) {
  if (String(next || '').length < 8) throw new ApiError('Salasanan pitää olla vähintään 8 merkkiä.', { code: 'weak_password' });
  return run(() => undefined);
}

export async function updatePassword() {
  return run(() => undefined);
}
