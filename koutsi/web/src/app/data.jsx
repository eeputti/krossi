// data.jsx — holds the signed-in role's state snapshot and the write helper every screen uses.
//
//   const { state, reload, run, mutate, ownerId } = useData();
//   const ok = (await run(() => api.groups.update(id, fields), 'Ryhmä päivitetty.')).ok;
//
// - Only the most recently *started* load lands in state (two quick actions can resolve out of order).
// - run(): a failed write shows its Finnish error and resolves { ok: false }. A successful write
//   followed by a failed refresh is still reported as saved — the old app reported it as a failed
//   save, which invited a retry and a duplicate row. The refresh gets at most REFRESH_WAIT_MS:
//   on a slow phone connection the sheet closes and says "saved" while the rest lands in the
//   background (`refreshed` resolves when it has). { waitForRefresh: true } when the next step needs
//   the new row in state (open the group just created).
// - The realtime echo of our own write is skipped (the write already reloaded); changes made
//   elsewhere (the player, another tab) reload after a short debounce. Returning to the tab or
//   coming back online refetches too: realtime does not replay what a sleeping phone missed.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../ui/index.js';
import { useResync } from './hooks.js';
import { seasonView } from '../domain/season.js';

const DataContext = createContext(null);
const REFRESH_WAIT_MS = 1500;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export function DataProvider({ ownerId, load, subscribe, children, fallback, renderError }) {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const seq = useRef(0);
  const lastLocalWrite = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    // the lists show the active season's groups; every group stays in allGroups (domain/season.js)
    const next = seasonView(await load(ownerId));
    if (mine === seq.current) { setState(next); setError(null); }
    return next;
  }, [load, ownerId]);

  const initial = useCallback(async () => {
    setError(null);
    try { await reload(); } catch (err) { setError(err); }
  }, [reload]);

  useEffect(() => { setState(null); initial(); }, [initial]);

  useEffect(() => {
    if (!subscribe) return undefined;
    let timer = null;
    const unsubscribe = subscribe(ownerId, () => {
      if (Date.now() - lastLocalWrite.current < 2500) return; // our own write's echo
      clearTimeout(timer);
      timer = setTimeout(() => { reload().catch(() => {}); }, 700);
    });
    return () => { clearTimeout(timer); unsubscribe?.(); };
  }, [subscribe, ownerId, reload]);

  useResync(() => { if (state) reload().catch(() => {}); });

  const run = useCallback(async (fn, successMessage, { refresh = true, waitForRefresh = false } = {}) => {
    let result;
    lastLocalWrite.current = Date.now();
    try {
      result = await fn();
    } catch (err) {
      toast(err);
      return { ok: false, error: err };
    }
    lastLocalWrite.current = Date.now();
    if (refresh) {
      const refreshed = reload();
      const outcome = await Promise.race([
        refreshed.then(() => 'done', () => 'failed'),
        ...(waitForRefresh ? [] : [sleep(REFRESH_WAIT_MS).then(() => 'slow')]),
      ]);
      if (outcome === 'failed') {
        toast('Tallennettu. Näkymän päivitys ei onnistunut — päivitä sivu, jos muutos ei näy.', { tone: 'info', duration: 5000 });
        return { ok: true, result, refreshed: Promise.resolve() };
      }
      if (successMessage) toast(successMessage);
      return { ok: true, result, refreshed: refreshed.then(() => {}, () => {}) };
    }
    if (successMessage) toast(successMessage);
    return { ok: true, result, refreshed: Promise.resolve() };
  }, [reload, toast]);

  /** Optimistic local change (e.g. an attendance tap); the next reload replaces it with the truth. */
  const mutate = useCallback((updater) => setState((s) => (s ? updater(s) : s)), []);

  const value = useMemo(() => ({ state, reload, run, mutate, ownerId }), [state, reload, run, mutate, ownerId]);

  if (!state) {
    if (error) return renderError ? renderError(error, initial) : null;
    return fallback || null;
  }
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>');
  return ctx;
}

/** The app's data, or null outside it (a gate screen before the app, e.g. the player's profile while waiting for a code). */
export function useOptionalData() {
  return useContext(DataContext);
}
