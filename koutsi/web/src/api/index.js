// index.js — the backend registry. The entry files install the Supabase or the in-memory
// demo backend; screens import `api` and never know which is behind it.
//
// Every async function is wrapped so whatever it throws reaches the UI as an ApiError with a
// Finnish message — the backends can simply `throw error` like the old data layer did.

import { API_CONTRACT, SYNC_FUNCTIONS } from './contract.js';
import { toApiError } from './errors.js';

export const api = {};
export let isDemo = false;

function wrap(domain, name, fn) {
  if (SYNC_FUNCTIONS.has(`${domain}.${name}`)) return fn;
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      throw toApiError(err);
    }
  };
}

export function installBackend(impl, { demo = false } = {}) {
  for (const [domain, names] of Object.entries(API_CONTRACT)) {
    if (!impl[domain]) throw new Error(`Backend is missing domain "${domain}"`);
    api[domain] = {};
    for (const name of names) {
      if (typeof impl[domain][name] !== 'function') throw new Error(`Backend is missing ${domain}.${name}`);
      api[domain][name] = wrap(domain, name, impl[domain][name].bind(impl[domain]));
    }
  }
  isDemo = demo;
}

export { ApiError, toApiError } from './errors.js';
