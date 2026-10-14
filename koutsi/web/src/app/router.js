// router.js — a tiny History-API router shared by the coach and player apps.
//
// Screens always speak in canonical paths ('/valmentaja/…' or '/pelaaja/…'). In local
// development the demo lives under '/demo/valmentaja/…'; that prefix is added and removed
// only here, so no screen needs to know. On demo.koutsi.krossi.app the paths are the real
// ones (the host decides it is a demo), so there is no prefix at all.
//
//   const { name, params, query, state } = useRoute();
//   navigate('/valmentaja/ryhma/123');                   push
//   navigate('/valmentaja/ryhmat', { replace: true })
//   navigate('/valmentaja/teemat', { overlay: true })     keeps the current page underneath (Sheet routes)
//   goBack('/valmentaja/ryhmat')                         back if there is in-app history, else go to fallback
//   <Link to="/valmentaja/pelaajat">…</Link>

import { createElement, useSyncExternalStore } from 'react';

let config = { canon: '/valmentaja', home: '/valmentaja/koti', routes: [] };
let prefix = '';
let compiled = [];
const listeners = new Set();
const scrollPositions = new Map();
let snapshot = null;
let lastNavigation = 'initial'; // 'push' | 'replace' | 'pop' | 'initial'

/**
 * configureRouter({ canon, home, routes, prefix })
 *   canon: '/valmentaja' | '/pelaaja'      home: where '/valmentaja' itself lands
 *   routes: [{ name, pattern, tab, type }]  prefix: '' or '/demo' (dev only)
 */
export function configureRouter(next) {
  config = { ...config, ...next };
  prefix = next.prefix || '';
  compiled = config.routes.map((route) => {
    const keys = [];
    const re = new RegExp(`^${route.pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
    return { route, re, keys };
  });
  snapshot = read();
}

export function homePath() { return config.home; }
export function canonBase() { return config.canon; }

export function matchRoute(path) {
  for (const { route, re, keys } of compiled) {
    const m = re.exec(path);
    if (m) {
      const params = {};
      try {
        keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      } catch {
        return null; // malformed %-escape -> not found instead of a crash
      }
      return { name: route.name, route, params };
    }
  }
  return null;
}

function toBrowser(path) {
  return prefix && path.startsWith('/') ? prefix + path : path;
}
function toCanonical(pathname) {
  if (prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))) return pathname.slice(prefix.length) || '/';
  return pathname;
}

function read() {
  const { pathname, search } = window.location;
  let path = toCanonical(pathname).replace(/\/+$/, '') || '/';
  if (path === config.canon) path = config.home;
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
  // While a sheet is open the body is position:fixed and window.scrollY reads 0.
  const sheetY = document.body.classList.contains('sheet-open') ? Number(document.body.dataset.scrollY || 0) : null;
  scrollPositions.set(current.key, sheetY ?? window.scrollY);
  const idx = (window.history.state?.idx ?? 0) + (replace ? 0 : 1);
  const bg = overlay ? (current.state.bg || `${current.path}${current.search}`) : undefined;
  // A detail page keeps the tab it was opened from lit (a session opened from Viikko stays
  // under Viikko); a tab route always lights its own tab.
  const target = matchRoute(url.pathname.replace(/\/+$/, '') || '/');
  const tab = target && target.route.type !== 'tab' ? (state.tab || current.state.tab || current.route?.tab) : undefined;
  const next = { ...state, key: newKey(), idx, ...(bg ? { bg } : {}), ...(tab ? { tab } : {}) };
  const href = toBrowser(url.pathname) + url.search + url.hash;
  if (replace) window.history.replaceState(next, '', href);
  else window.history.pushState(next, '', href);
  lastNavigation = replace ? 'replace' : 'push';
  emit();
}

/** Back within the app when possible; otherwise replace with `fallback` (default: home). */
export function goBack(fallback) {
  if ((window.history.state?.idx ?? 0) > 0) window.history.back();
  else navigate(fallback || config.home, { replace: true });
}

/** Drops one query parameter from the address bar without a history entry. */
export function dropQueryParam(name) {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  emit();
}

/** Absolute URL for a canonical path (keeps the demo inside the demo). */
export function appUrl(path) {
  return window.location.origin + toBrowser(path);
}

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

/** <Link to="/valmentaja/…" replace overlay className>…</Link> — a real <a> so cmd-click works. */
export function Link({ to, replace, overlay, state, onClick, children, ...rest }) {
  return createElement('a', {
    href: toBrowser(to),
    onClick: (e) => {
      onClick?.(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      // Tapping the tab you're already on scrolls to the top instead of stacking history.
      const here = snapshot || read();
      if (!overlay && `${here.path}${here.search}` === to) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      navigate(to, { replace, overlay, state });
    },
    ...rest,
  }, children);
}
