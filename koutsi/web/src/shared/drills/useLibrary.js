// useLibrary.js — Krossi's drill library, loaded once from /koutsi-uusi/drills.json (written by
// build.mjs from domain/drills/library.js) when a screen first needs it. Opening the app does
// not wait for it; the drill bank shows the coach's own drills first and the library a moment later.
import { useEffect, useReducer, useState } from 'react';

const URL = '/koutsi-uusi/drills.json';

/** How many drills the library has, known at build time (for counts on screens that don't load it). */
// eslint-disable-next-line no-undef
export const DRILL_COUNT = typeof __KOUTSI_DRILL_COUNT__ !== 'undefined' ? __KOUTSI_DRILL_COUNT__ : 0;

let library = null;
let loading = null;
const listeners = new Set();

/** Starts (or joins) the download; resolves to the list. A failed download can be retried. */
export function loadDrillLibrary() {
  if (library) return Promise.resolve(library);
  if (!loading) {
    loading = fetch(URL, { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`drills.json ${res.status}`);
        return res.json();
      })
      .then((list) => {
        library = Array.isArray(list) ? list : [];
        listeners.forEach((fn) => fn());
        return library;
      })
      .catch((err) => {
        loading = null;
        throw err;
      });
  }
  return loading;
}

/**
 * { library, failed, retry } — library is null until loaded. `enabled: false` waits (e.g. the
 * Kotiläksy sheet loads it only when it opens for a homework).
 */
export function useDrillLibrary(enabled = true) {
  const [, rerender] = useReducer((n) => n + 1, 0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled || library) return undefined;
    let alive = true;
    const done = () => { if (alive) rerender(); };
    listeners.add(done);
    loadDrillLibrary().catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; listeners.delete(done); };
  }, [enabled]);
  const retry = () => {
    setFailed(false);
    loadDrillLibrary().then(rerender).catch(() => setFailed(true));
  };
  return { library, failed: failed && !library, retry };
}
