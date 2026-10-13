// client.js — the one supabase-js client of the renewed Koutsi, plus helpers every domain
// module shares.
//
// Created lazily so importing the backend has no side effects (Node tests import it with a
// fake client). Same URL, key and default storage key as the old Koutsi, so on the same
// origin both apps share one signed-in session.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/constants.js';
import { ApiError } from '../errors.js';

let client = null;

export function db() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    });
  }
  return client;
}

/** Test seam for node:test; the app never calls it. */
export function setClientForTests(fake) {
  client = fake;
}

/** Throws the Supabase `{ error }` if present (the API wrapper turns it Finnish), else returns data. */
export function must({ data, error }) {
  if (error) throw error;
  return data;
}

export async function currentSession() {
  const { data, error } = await db().auth.getSession();
  if (error) throw error;
  return data.session || null;
}

export async function requireSession() {
  const session = await currentSession();
  if (!session) throw new ApiError('Istunto vanheni. Kirjaudu uudelleen sisään.', { code: 'auth_required' });
  return session;
}

// PostgREST answers PGRST202 when a function is not in its schema cache; plain Postgres
// answers 42883. Both mean "not deployed yet".
export function isMissingFunction(error) {
  const code = error?.code || error?.cause?.code;
  const message = String(error?.message || error?.cause?.message || '');
  return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(message);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// `.in(column, ids)` puts every id in the request URL; long lists are split so the URL stays
// well below proxy limits, and the chunks are fetched in parallel. Any failed chunk throws:
// a missing chunk must never read as "no rows".
const IN_CHUNK = 100;
export async function selectIn(ids, buildQuery) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) chunks.push(unique.slice(i, i + IN_CHUNK));
  const results = await Promise.all(chunks.map((chunk) => buildQuery(chunk)));
  return results.flatMap((result) => must(result) || []);
}

// PostgREST caps a response at max-rows (1000 by default) and says nothing about it. Tables
// that grow without bound (a year of weekly sessions for 19 groups is ~1000 rows) are read
// page by page instead; `buildQuery()` must return a fresh, ordered query each call.
const PAGE = 1000;
export async function selectAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const page = must(await buildQuery().range(from, from + PAGE - 1)) || [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** Calls an edge function with the user's JWT; our functions answer `{ error: "<suomeksi>" }`. */
export async function callFunction(name, body) {
  const session = await requireSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiError(payload.error || 'Toiminto epäonnistui. Yritä hetken päästä uudelleen.');
  }
  return res.json().catch(() => ({}));
}

export function randomUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
