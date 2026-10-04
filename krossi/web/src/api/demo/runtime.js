// runtime.js — the plumbing every demo domain shares: fake network latency, deep copies,
// scheduled "other people do something" timers, a tiny event bus for realtime, and
// guarded access to browser-only APIs (the demo backend is also imported by Node tests).

// Tests shrink these to keep runs fast; the browser uses the defaults.
export const timing = {
  latencyMin: 120,   // ms, every API call waits a random time in [latencyMin, latencyMax]
  latencyMax: 350,
  autoScale: 1,      // multiplier for scheduled replies / joins (0.01 = 100x faster)
};

/** Overrides timing values, e.g. `configureTiming({ latencyMin: 0, latencyMax: 0, autoScale: 0.01 })`. */
export function configureTiming(partial) {
  Object.assign(timing, partial);
}

const clone = typeof structuredClone === 'function'
  ? (value) => structuredClone(value)
  : (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` like a server would: after a short random latency, and returns a deep copy
 * of its result so screens can never mutate the in-memory tables by accident.
 * Anything `fn` throws becomes the rejection of the returned promise.
 */
export async function run(fn) {
  const { latencyMin, latencyMax } = timing;
  const wait = latencyMin + Math.random() * Math.max(0, latencyMax - latencyMin);
  if (wait > 0) await sleep(wait);
  return clone(await fn());
}

export { clone };

// ── Scheduled background activity ─────────────────────────────────────────────
// "Mikko replies in 3 s", "someone joins your new game" … Timers are tracked so a store
// reset can cancel them, and unref'd so they never keep a Node test process alive.

const pendingTimers = new Set();

/** Calls `fn` after a random delay in [minMs, maxMs] (scaled by timing.autoScale). */
export function later(minMs, maxMs, fn) {
  const ms = (minMs + Math.random() * (maxMs - minMs)) * timing.autoScale;
  const handle = setTimeout(() => {
    pendingTimers.delete(handle);
    try {
      fn();
    } catch (err) {
      console.error('[demo] scheduled activity failed', err);
    }
  }, ms);
  handle.unref?.();
  pendingTimers.add(handle);
  return handle;
}

export function cancelScheduled() {
  for (const handle of pendingTimers) clearTimeout(handle);
  pendingTimers.clear();
}

// ── Realtime bus ──────────────────────────────────────────────────────────────
// Stands in for Supabase realtime: messages.subscribe() listens per conversation,
// messages.subscribeInbox() hears about every new message or conversation change.
// Delivery is deferred a tick, like a websocket push arriving after the insert returns.

const conversationListeners = new Map(); // conversationId -> Set<fn(Message)>
const inboxListeners = new Set();        // Set<fn()>

function deliver(listener, ...args) {
  try {
    listener(...args);
  } catch (err) {
    console.error('[demo] realtime listener failed', err);
  }
}

export function listenConversation(conversationId, onMessage) {
  if (!conversationListeners.has(conversationId)) conversationListeners.set(conversationId, new Set());
  conversationListeners.get(conversationId).add(onMessage);
  return () => {
    const set = conversationListeners.get(conversationId);
    if (!set) return;
    set.delete(onMessage);
    if (set.size === 0) conversationListeners.delete(conversationId);
  };
}

export function listenInbox(onChange) {
  inboxListeners.add(onChange);
  return () => inboxListeners.delete(onChange);
}

/** Pushes a Message view to its conversation's subscribers and pings the inbox. */
export function broadcastMessage(message) {
  setTimeout(() => {
    for (const listener of [...(conversationListeners.get(message.conversationId) || [])]) {
      deliver(listener, clone(message));
    }
    for (const listener of [...inboxListeners]) deliver(listener);
  }, 0);
}

/** Tells inbox subscribers that something changed (read state, deletion, new conversation). */
export function broadcastInboxChange() {
  setTimeout(() => {
    for (const listener of [...inboxListeners]) deliver(listener);
  }, 0);
}

// ── Browser-only APIs, guarded for Node ───────────────────────────────────────

/** Object URL for a picked File so the demo can show it without uploading anything. */
export function objectUrlFor(file, fallback) {
  const isBlob = typeof Blob !== 'undefined' && file instanceof Blob;
  if (!isBlob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return fallback;
  try {
    return URL.createObjectURL(file);
  } catch (err) {
    console.warn('[demo] could not create an object URL for the file', err);
    return fallback;
  }
}

/** "Signing out" of the demo just takes the visitor back to the landing page. */
export function leaveDemo() {
  if (typeof window !== 'undefined' && window.location) window.location.assign('/');
}

/** Stand-in for notifications.emit: the demo sends nothing, it just logs the event. */
export function logNotifyEvent(event) {
  // Browser console only: Node test runs stay quiet.
  if (typeof window !== 'undefined' && typeof console !== 'undefined') console.debug('[demo] notify', event);
}

// ── Ids ───────────────────────────────────────────────────────────────────────

let idCounter = 0;

/** Ids for rows created at runtime ('g-new-1', 'msg-new-2' …); seed ids are fixed strings. */
export function newId(prefix) {
  idCounter += 1;
  return `${prefix}-new-${idCounter}`;
}
