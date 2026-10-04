// admin.js — Ylläpito: stats, user list, deleting users, city admins.
// Visible to accounts in koutsi_admins (the admin role is shared with Krossi Koutsi);
// every RPC checks the role itself.

import { db, requireUid, rpc, SUPABASE_URL, SUPABASE_ANON_KEY } from './client.js';
import { ApiError, toApiError } from '../errors.js';

export async function stats() {
  await requireUid();
  return (await rpc('krossi_admin_stats', undefined, 'Tilastoja ei voitu ladata.')) || {};
}

/**
 * @typedef {Object} AdminUser
 * @property {string} id
 * @property {string|null} name
 * @property {string|null} email
 * @property {string|null} joinedAt
 * @property {string|null} lastSignInAt
 * @property {number} appOpenCount
 * @property {string|null} lastAppOpenAt
 * @property {boolean} isAdmin
 * @property {string|null} area
 * @property {boolean} hiddenFromFeed
 * @property {string|null} paidAt
 * @property {number} challengesCreated
 * @property {number} matchesRecorded
 * @property {string[]} adminCities
 */
export async function users() {
  await requireUid();
  const rows = (await rpc('krossi_admin_users', undefined, 'Käyttäjiä ei voitu ladata.')) || [];
  return rows.map((r) => ({
    id: r.user_id,
    name: r.display_name ?? null,
    email: r.email ?? null,
    joinedAt: r.joined_at ?? null,
    lastSignInAt: r.last_sign_in_at ?? null,
    appOpenCount: r.app_open_count || 0,
    lastAppOpenAt: r.last_app_open_at ?? null,
    isAdmin: Boolean(r.is_admin),
    area: r.area ?? null,
    hiddenFromFeed: Boolean(r.hidden_from_feed),
    paidAt: r.paid_at ?? null,
    challengesCreated: r.challenges_created || 0,
    matchesRecorded: r.matches_recorded || 0,
    adminCities: r.admin_cities || [],
  }));
}

// Called with fetch like the legacy app: the function's own Finnish error text is in the
// JSON body, which functions.invoke would hide behind a generic status error.
export async function deleteUser(userId) {
  await requireUid();
  const { data } = await db().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('Kirjaudu uudelleen sisään.', { code: 'auth_required' });
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/krossi-admin-delete-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ user_id: userId }),
    });
  } catch (err) {
    throw toApiError(err, 'Tilin poisto epäonnistui.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw toApiError(new Error(body.error || `HTTP ${res.status}`), 'Tilin poisto epäonnistui.');
}

export async function setCityAdmin(userId, cities) {
  await requireUid();
  await rpc('krossi_admin_set_city_admin', { target_user_id_input: userId, cities_input: cities || [] }, 'Oikeuksien tallennus epäonnistui.');
}
