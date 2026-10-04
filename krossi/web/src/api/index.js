// index.js — the backend registry. main.jsx installs the Supabase backend, demo.jsx the
// in-memory one; screens import `api` and never know which is behind it.

import { API_CONTRACT } from './contract.js';

export const api = {};
export let isDemo = false;

export function installBackend(impl, { demo = false } = {}) {
  for (const domain of Object.keys(API_CONTRACT)) {
    if (!impl[domain]) throw new Error(`Backend is missing domain "${domain}"`);
    api[domain] = impl[domain];
  }
  isDemo = demo;
}

export { ApiError } from './errors.js';
