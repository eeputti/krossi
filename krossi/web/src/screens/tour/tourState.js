// tourState.js — the demo's guided tour (krossi.app/demo): is it open, and on which step.
//
//   const step = useTourStep();   null = closed, 0 = the welcome card, 1…STEPS.length = the steps
//   startTour()                   Profiili → Näytä opastus (and the first visit, see DemoTour)
//   setTourStep(n)  closeTour()
//
// Closing (skip, ✕, Valmis) is remembered per browser so the tour opens by itself only once.
import { useSyncExternalStore } from 'react';

const DONE_KEY = 'krossi_demo_tour_done';
let step = null;
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useTourStep() {
  return useSyncExternalStore(subscribe, () => step);
}

export function startTour() { step = 0; emit(); }
export function setTourStep(n) { step = n; emit(); }
export function closeTour() {
  step = null;
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* private mode: the tour just opens again next visit */ }
  emit();
}

export function tourSeen() {
  try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return false; }
}

/** The landing page shows the demo in a phone frame (an iframe): no tour there. */
export function inFrame() {
  try { return window.self !== window.top; } catch { return true; }
}
