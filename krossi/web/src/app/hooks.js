// hooks.js — small shared React hooks.
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useAsync(fn, deps) — runs `fn` on mount and whenever deps change.
 * Returns { data, error, loading, reload, setData }. Stale responses (deps changed meanwhile)
 * are ignored. `reload({ silent: true })` refetches without flipping `loading` (no skeleton flash).
 */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  const run = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const load = useCallback(async ({ silent = false } = {}) => {
    const id = ++run.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fnRef.current();
      if (id === run.current) setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      if (id === run.current) setState((s) => ({ data: silent ? s.data : undefined, error, loading: false }));
      return undefined;
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, deps);
  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), []);
  return { ...state, reload: load, setData };
}

/** useMediaQuery('(min-width: 900px)') */
export function useMediaQuery(query) {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export const useIsDesktop = () => useMediaQuery('(min-width: 900px)');

/** useNow(ms) — re-renders every `ms` so relative times ("5 min sitten") stay fresh. */
export function useNow(ms = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** useLocalState(key, initial) — useState persisted to localStorage (per browser, best effort). */
export function useLocalState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
  }, [key, value]);
  return [value, setValue];
}

/** useBusy() — wraps an async action: const [busy, run] = useBusy(); run(() => api.x()) */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const run = useCallback(async (fn) => {
    setBusy(true);
    try { return await fn(); } finally { if (mounted.current) setBusy(false); }
  }, []);
  return [busy, run];
}

/**
 * useResync(fn) — calls fn when the tab becomes visible again or the device comes back online.
 * Realtime doesn't replay changes missed while the socket slept, so live views refetch here.
 */
export function useResync(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let last = 0;
    const fire = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - last < 2000) return; // visibilitychange + online often arrive together
      last = now;
      ref.current?.();
    };
    document.addEventListener('visibilitychange', fire);
    window.addEventListener('online', fire);
    return () => {
      document.removeEventListener('visibilitychange', fire);
      window.removeEventListener('online', fire);
    };
  }, []);
}
