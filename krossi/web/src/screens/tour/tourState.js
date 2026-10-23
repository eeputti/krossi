// tourState.js — the guided tours: is one open, and on which step. Two tours, each with its own state:
//
//   demoTour   krossi.app/demo — the whole app (DemoTour, tourSteps.js)
//   siteTour   krossi.app/varaa — the booking site only (SiteTour, siteTourSteps.js)
//
//   const step = tour.useStep();   null = closed, 0 = the welcome card, 1…steps.length = the steps
//   tour.start()  tour.setStep(n)  tour.close()  tour.seen()
//
// The demo tour remembers per browser that it was closed (skip, ✕, Valmis), so it opens by itself
// only once. The booking site's tour has no memory: it opens on every visit to krossi.app/varaa
// (it is shown to people on the presenter's own phone), once per page load.
import { useSyncExternalStore } from 'react';

function createTour(doneKey) {
  let step = null;
  let opened = false; // this page load
  const listeners = new Set();
  const emit = () => listeners.forEach((l) => l());
  const subscribe = (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };
  return {
    useStep: () => useSyncExternalStore(subscribe, () => step),
    start() { step = 0; opened = true; emit(); },
    setStep(n) { step = n; emit(); },
    close() {
      step = null;
      if (doneKey) {
        try { localStorage.setItem(doneKey, '1'); } catch { /* private mode: the tour just opens again next visit */ }
      }
      emit();
    },
    seen() {
      if (!doneKey) return opened;
      try { return localStorage.getItem(doneKey) === '1'; } catch { return false; }
    },
  };
}

export const demoTour = createTour('krossi_demo_tour_done');
export const siteTour = createTour(null);

// The demo tour's names (Profiili → Näytä opastus).
export const startTour = demoTour.start;

// Where this page load began: a visit that started on the booking site (/varaa) moves into the app
// only to find a partner for the court it just booked, so the demo tour doesn't open by itself then.
const ENTRY_PATH = typeof window !== 'undefined' ? window.location.pathname : '';
export function cameFromSite() { return /^\/varaa(\/|$)/.test(ENTRY_PATH); }

// A page load that is a payment coming back from the bank (MobilePay etc.) shows the booking, not a
// tour. Read before the booking page drops the query.
const ENTRY_SEARCH = typeof window !== 'undefined' ? window.location.search : '';
export function backFromPayment() { return new URLSearchParams(ENTRY_SEARCH).has('payment_intent'); }

/** The landing page used to show the demo in a phone frame (an iframe): no tour there. */
export function inFrame() {
  try { return window.self !== window.top; } catch { return true; }
}
