// auth.js (demo) — the visitor is always signed in as Alex. Signing in, up or via OAuth
// does nothing; signing out leaves the demo for the landing page.

import { ME, ME_EMAIL } from './rows.js';
import { run, leaveDemo } from './runtime.js';
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

export async function updatePassword() {
  return run(() => undefined);
}
