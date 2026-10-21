// checkin.js — where a "Treenit ohi! Miten meni?" comes from, and what has already been asked.
//
//   ?fiilis=<trainingId>[&arvo=1-5]   the after-session e-mail's number buttons
//   ?toive=1                          the e-mail's "Lähetä valmentajalle toive" link
//
// The parameters are read once, before signing in can send the page away, kept in
// sessionStorage until the player app has opened, and removed from the address bar at once.
// Skips are shared with the Home screen's check-in card; "asked" stops the pop-up from opening
// by itself twice for the same session.

const PENDING_KEY = 'koutsi_pending_checkin';
const PENDING_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const SKIP_KEY = (studentId) => `koutsi_checkin_skip_${studentId}`;
const ASKED_KEY = (studentId) => `koutsi_checkin_asked_${studentId}`;

// `npm run dev:koutsi` → /demo/pelaaja?esikatsele=fiilis opens the pop-up in the demo by itself.
export const previewCheckIn = process.env.NODE_ENV !== 'production'
  && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('esikatsele') === 'fiilis';

export function capturePendingCheckIn() {
  try {
    const url = new URL(window.location.href);
    const training = url.searchParams.get('fiilis');
    const wish = url.searchParams.get('toive');
    if (!training && !wish) return;
    const score = Number(url.searchParams.get('arvo'));
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({
      training: training || null,
      score: Number.isInteger(score) && score >= 1 && score <= 5 ? score : null,
      wish: Boolean(wish),
      at: Date.now(),
    }));
    ['fiilis', 'arvo', 'toive'].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  } catch {
    // storage blocked: the e-mail link then just opens the app
  }
}

/** The check-in an e-mail link asked for, once; null if none or it is hours old. */
export function takePendingCheckIn() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    const pending = JSON.parse(raw);
    return Date.now() - (pending.at || 0) < PENDING_MAX_AGE_MS ? pending : null;
  } catch {
    return null;
  }
}

const readSet = (key) => {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
};
const writeSet = (key, set) => {
  try { localStorage.setItem(key, JSON.stringify([...set].slice(-30))); } catch { /* private mode */ }
};

export const readSkipped = (studentId) => readSet(SKIP_KEY(studentId));
export function markSkipped(studentId, trainingId) {
  const next = readSkipped(studentId).add(trainingId);
  writeSet(SKIP_KEY(studentId), next);
  return next;
}

export const wasAsked = (studentId, trainingId) => readSet(ASKED_KEY(studentId)).has(trainingId);
export function markAsked(studentId, trainingId) {
  writeSet(ASKED_KEY(studentId), readSet(ASKED_KEY(studentId)).add(trainingId));
}
