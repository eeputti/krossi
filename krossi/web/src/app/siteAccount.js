// siteAccount.js — has the booking site's demo visitor signed in? The demo's session is the demo
// player all along; on krossi.app/varaa the visitor still starts as a guest (no own bookings, a name
// and an email for the booking) until they make an account or sign in there (AccountSheet). Kept in
// memory like the rest of the demo: a reload starts over.
import { useSyncExternalStore } from 'react';

let signedIn = false;
const listeners = new Set();

export function signInDemoSite() {
  signedIn = true;
  listeners.forEach((fn) => fn());
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const read = () => signedIn;

export function useDemoSiteSignedIn() {
  return useSyncExternalStore(subscribe, read, read);
}
