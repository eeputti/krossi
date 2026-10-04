// router.js — a tiny History-API router.
//
// Screens always speak in canonical '/pelaa/…' paths. In the demo the browser URL lives under
// '/demo/…' instead; the translation happens only here, so no screen needs to know.
//
//   const { name, params, query, state } = useRoute();
//   navigate('/pelaa/peli/123');                       push
//   navigate('/pelaa/pelit?nakyma=omat', { replace: true })
//   navigate('/pelaa/uusi-peli', { overlay: true })     keeps the current page underneath (Sheet routes)
//   goBack('/pelaa/pelit')                             back if there is in-app history, else go to fallback
//   <Link to="/pelaa/pelaajat">…</Link>
//   appUrl('/pelaa/peli/123')                          absolute URL for sharing

import { createElement, useSyncExternalStore } from 'react';
import { matchRoute } from './routes.js';

const CANON = '/pelaa';
let base = CANON;
const listeners = new Set();
const scrollPositions = new Map();
let snapshot = null;
let lastNavigation = 'initial'; // 'push' | 'replace' | 'pop' | 'initial'

export function configureRouter({ demo = false } = {}) {
  base = demo ? '/demo' : CANON;
  snapshot = read();
}

function toBrowser(path) {
  if (base === CANON || !path.startsWith(CANON)) return path;
  return base + path.slice(CANON.length);
}
function toCanonical(pathname) {
  if (base !== CANON && (pathname === base || pathname.startsWith(`${base}/`))) return CANON + pathname.slice(base.length);
  return pathname;
}

function read() {
  const { pathname, search } = window.location;
  let path = toCanonical(pathname).replace(/\/+$/, '') || '/';
  if (path === CANON) path = `${CANON}/koti`;
  const query = Object.fromEntries(new URLSearchParams(search));
  const state = window.history.state || {};
  const match = matchRoute(path);
  return { path, query, search, state, name: match?.name || 'notFound', params: match?.params || {}, route: match?.route || null, key: state.key || 'root' };
}

function emit() {
  snapshot = read();
  listeners.forEach((l) => l());
}

let keySeq = 0;
const newKey = () => `${Date.now().toString(36)}-${(keySeq++).toString(36)}`;

/** navigate(to, { replace, state, overlay }) — `to` is a canonical path, optionally with ?query. */
export function navigate(to, { replace = false, state = {}, overlay = false } = {}) {
  const current = snapshot || read();
  const url = new URL(to, window.location.origin);
  if (scrollPositions.size > 60) scrollPositions.clear();
  scrollPositions.set(current.key, window.scrollY);
  const idx = (window.history.state?.idx ?? 0) + (replace ? 0 : 1);
  const bg = overlay ? (current.state.bg || `${current.path}${current.search}`) : undefined;
  const next = { ...state, key: newKey(), idx, ...(bg ? { bg } : {}) };
  const href = toBrowser(url.pathname) + url.search + url.hash;
  if (replace) window.history.replaceState(next, '', href);
  else window.history.pushState(next, '', href);
  lastNavigation = replace ? 'replace' : 'push';
  emit();
}

/** Back within the app when possible; otherwise replace with `fallback`. */
export function goBack(fallback = '/pelaa/koti') {
  if ((window.history.state?.idx ?? 0) > 0) window.history.back();
  else navigate(fallback, { replace: true });
}

/** Absolute shareable URL for a canonical path (keeps the demo inside the demo). */
export function appUrl(path) {
  return window.location.origin + toBrowser(path);
}

/** How the current route was reached — AppShell uses it for scroll restoration and transitions. */
export function navigationType() { return lastNavigation; }
export function savedScroll(key) { return scrollPositions.get(key); }

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => { lastNavigation = 'pop'; emit(); });
}

export function useRoute() {
  return useSyncExternalStore(subscribe, () => snapshot || (snapshot = read()));
}

/** <Link to="/pelaa/…" replace overlay className>…</Link> — a real <a> so cmd-click works. */
export function Link({ to, replace, overlay, state, onClick, children, ...rest }) {
  return createElement('a', {
    href: toBrowser(to),
    onClick: (e) => {
      onClick?.(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(to, { replace, overlay, state });
    },
    ...rest,
  }, children);
}
