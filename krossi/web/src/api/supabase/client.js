// client.js — the one supabase-js client of the web app, plus small helpers every domain
// module shares (current user id, RPC/edge-function wrappers, schema-drift detection).
//
// The client is created lazily on first use so that importing this module has no side
// effects: Node can import the whole backend in tests without a browser or network.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/constants.js';
import { ApiError, toApiError, unwrap } from '../errors.js';

let client = null;

// Cached id of the signed-in user. `undefined` = not looked up yet, `null` = signed out.
// Kept fresh by the auth listener below so domain functions never call auth.getUser().
let cachedUid;

export function db() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    });
    client.auth.onAuthStateChange((_event, session) => {
      cachedUid = session?.user?.id ?? null;
    });
  }
  return client;
}

/** Test seam for node:test (test/supabase-backend.test.mjs); the app never calls it. */
export function setClientForTests(fake) {
  client = fake;
  cachedUid = undefined;
}

export function rememberUid(uid) {
  cachedUid = uid ?? null;
}

/** Current user id, or null when signed out. */
export async function currentUid() {
  if (cachedUid !== undefined) return cachedUid;
  const { data, error } = await db().auth.getSession();
  if (error) throw toApiError(error);
  cachedUid = data.session?.user?.id ?? null;
  return cachedUid;
}

/** Current user id; throws a friendly ApiError when nobody is signed in. */
export async function requireUid() {
  const uid = await currentUid();
  if (!uid) throw new ApiError('Kirjaudu sisään ensin.', { code: 'auth_required' });
  return uid;
}

/** Calls a Postgres function and returns its data, throwing ApiError on failure. */
export async function rpc(name, args, fallback) {
  return unwrap(await db().rpc(name, args), fallback);
}

// PostgREST answers PGRST202 when a function is not in its schema cache; plain Postgres
// answers 42883. Both mean "not deployed yet" for the RPCs the infra work adds.
export function isMissingFunction(error) {
  const code = error?.code || error?.cause?.code;
  const message = String(error?.message || error?.cause?.message || '');
  return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(message);
}

// 42703 = undefined column (select), PGRST204 = unknown column in an insert/upsert payload.
export function isMissingColumn(error, column) {
  const message = String(error?.message || '');
  return (error?.code === '42703' || error?.code === 'PGRST204') && message.includes(column);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids from URLs are user input: a malformed one would make Postgres raise 22P02. */
export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// `.in(column, ids)` puts every id in the request URL; long lists are split so the URL
// stays well below proxy limits, and the chunks are fetched in parallel.
const IN_CHUNK = 100;

export async function selectIn(ids, buildQuery, fallback) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) chunks.push(unique.slice(i, i + IN_CHUNK));
  const results = await Promise.all(chunks.map((chunk) => buildQuery(chunk)));
  return results.flatMap((result) => unwrap(result, fallback) || []);
}

export function isDuplicate(error) {
  return error?.code === '23505' || /duplicate key/i.test(String(error?.message || ''));
}

export function isRlsViolation(error) {
  return error?.code === '42501' || /row-level security/i.test(String(error?.message || ''));
}

/**
 * Invokes an edge function. Our functions answer errors as `{ error: "<suomeksi>" }` with a
 * non-2xx status; supabase-js only exposes that body through `error.context`, so it is read
 * here to give the user the function's own message instead of "non-2xx status code".
 */
export async function invokeFunction(name, { body, method = 'POST' } = {}, fallback) {
  const { data, error } = await db().functions.invoke(name, { body, method });
  if (!error) return data;
  const detail = await readFunctionErrorBody(error);
  throw toApiError(detail ? Object.assign(new Error(detail), { cause: error }) : error, fallback);
}

async function readFunctionErrorBody(error) {
  const response = error?.context;
  if (!response || typeof response.clone !== 'function') return null;
  try {
    const body = await response.clone().json();
    return typeof body?.error === 'string' ? body.error : null;
  } catch {
    return null; // body was not JSON; the generic message is used instead
  }
}

/** Meta pixel events, same as the legacy app. Never lets analytics break a real action. */
export function trackPixel(event) {
  try {
    if (typeof window !== 'undefined' && typeof window.fbq === 'function') window.fbq('track', event);
  } catch (err) {
    console.warn('Meta pixel -tapahtuma epäonnistui', err);
  }
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
