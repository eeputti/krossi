// admin.js (demo) — Ylläpito is for admins only and the demo player is not one: every call
// fails the same way the admin RPCs / krossi-admin-delete-user do for a regular player.

import { run } from './runtime.js';
import { dbError } from './actions.js';

export async function stats() {
  return run(() => {
    throw dbError('not allowed', 'Tilastoja ei voitu ladata.');
  });
}

export async function users() {
  return run(() => {
    throw dbError('not allowed', 'Käyttäjiä ei voitu ladata.');
  });
}

export async function deleteUser() {
  return run(() => {
    throw dbError('not allowed', 'Tilin poisto epäonnistui.');
  });
}

export async function setCityAdmin() {
  return run(() => {
    throw dbError('not allowed', 'Oikeuksien tallennus epäonnistui.');
  });
}
