// subscriptionStore.js — the signed-in coach's subscription status for any screen that needs it
// (Profiili → Tilaus, the Merkitse notice when the trial has ended), read once per coach and shared.
// SubscriptionCard publishes a fresher one after Stripe.
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { NO_SUBSCRIPTION } from '../domain/subscription.js';

let owner = null; // whose status this is
let pending = null;
let current = NO_SUBSCRIPTION;
const listeners = new Set();

function publish(uid, status) {
  if (uid !== owner) return;
  current = status;
  listeners.forEach((fn) => fn(status));
}

/** The status, read from the backend once per coach (again with `fresh`). Never throws. */
export function loadPlanStatus(uid, { fresh = false } = {}) {
  if (uid !== owner) { owner = uid; pending = null; current = NO_SUBSCRIPTION; }
  if (!pending || fresh) {
    pending = api.subscription.status().catch(() => NO_SUBSCRIPTION).then((s) => { publish(uid, s); return s; });
  }
  return pending;
}

/** A status read elsewhere (after Stripe) for everyone listening. */
export function setPlanStatus(uid, status) {
  if (uid !== owner) { owner = uid; }
  pending = Promise.resolve(status);
  publish(uid, status);
}

/** The coach's status; NO_SUBSCRIPTION until it is read. */
export function usePlanStatus(uid) {
  const [status, setStatus] = useState(() => (uid === owner ? current : NO_SUBSCRIPTION));
  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    const listen = (s) => { if (alive) setStatus(s); };
    listeners.add(listen);
    loadPlanStatus(uid).then(listen);
    return () => { alive = false; listeners.delete(listen); };
  }, [uid]);
  return status;
}
