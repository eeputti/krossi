// bookingAccount.js — the booking site's account glue (krossi.app/varaa):
//
//   This visit's guest bookings: a court booked without an account is remembered in this tab
//   (sessionStorage) and moves to the account as soon as the visitor signs in or makes one here
//   (useClaimVisitBookings, in the Gate). Only this tab's: a shared computer's next user never gets
//   somebody's booking. From the confirmation email's link, moving it is a button on its own page.
//
//   Back to the booking after Google / Apple: the sign-in leaves the page and returns to /pelaa, so
//   the booking page's path waits here (this tab, 30 minutes) and the Gate goes back to it.
//
//   BOOKINGS_CHANGED: a window event when my bookings changed outside the booking page (a claim).
import { useEffect, useRef } from 'react';
import { api, isDemo } from '../api/index.js';
import { useToast } from '../ui/index.js';
import { useSession } from './session.jsx';
import { useDemoSiteSignedIn } from './siteAccount.js';

const TOKENS_KEY = 'krossi_visit_guest_bookings';
const RETURN_KEY = 'krossi_booking_return';
const RETURN_TTL_MS = 30 * 60 * 1000;
export const BOOKINGS_CHANGED = 'krossi:bookings-changed';

const tab = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode: nothing to remember */ } },
  remove: (k) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

const visitTokens = () => {
  try { return JSON.parse(tab.get(TOKENS_KEY) || '[]').filter((t) => typeof t === 'string'); } catch { return []; }
};

/** A guest booking made in this tab: it moves to the account once the visitor has one. */
export function rememberGuestBooking(token) {
  if (!token) return;
  tab.set(TOKENS_KEY, JSON.stringify([...new Set([...visitTokens(), token])].slice(-10)));
}

function forgetGuestBookings(tokens) {
  const left = visitTokens().filter((t) => !tokens.includes(t));
  if (left.length) tab.set(TOKENS_KEY, JSON.stringify(left));
  else tab.remove(TOKENS_KEY);
}

export const notifyBookingsChanged = () => window.dispatchEvent(new Event(BOOKINGS_CHANGED));

/**
 * Moves guest bookings to my account: `tokens`, or this visit's. → the bookings moved. A booking
 * that can't move (cancelled, another account's) is forgotten; a network failure is tried again later.
 */
export async function claimGuestBookings(tokens = visitTokens()) {
  const moved = [];
  const done = [];
  for (const token of tokens) {
    try {
      moved.push(await api.booking.claimGuest(token));
      done.push(token);
    } catch (err) {
      if (err?.code !== 'network') done.push(token);
    }
  }
  forgetGuestBookings(done);
  if (moved.length) notifyBookingsChanged();
  return moved;
}

/**
 * In the Gate: this visit's guest bookings move to the account once there is one (with a profile). The
 * demo's visitor counts as signed in only after signing in on the booking site.
 */
export function useClaimVisitBookings() {
  const { user, profile } = useSession();
  const demoSignedIn = useDemoSiteSignedIn();
  const signedIn = isDemo ? demoSignedIn : Boolean(user && profile);
  const toast = useToast();
  const busy = useRef(false);
  useEffect(() => {
    if (!signedIn || busy.current || !visitTokens().length) return;
    busy.current = true;
    claimGuestBookings()
      .then((moved) => {
        if (moved.length) toast(moved.length === 1 ? 'Varauksesi on nyt tililläsi.' : 'Varauksesi ovat nyt tililläsi.', { icon: 'check' });
      })
      .finally(() => { busy.current = false; });
  }, [signedIn, toast]);
}

/** Before Google / Apple: come back to `path` (the booking page) after the sign-in. */
export function rememberBookingReturn(path) {
  if (path) tab.set(RETURN_KEY, `${Date.now()}|${path}`);
}

export function peekBookingReturn() {
  const [at, path] = String(tab.get(RETURN_KEY) || '').split('|');
  return path && Date.now() - Number(at) < RETURN_TTL_MS ? path : null;
}

export function takeBookingReturn() {
  const path = peekBookingReturn();
  tab.remove(RETURN_KEY);
  return path;
}
