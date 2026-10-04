// notifications.js (demo) — preferences live in memory and nothing is ever sent:
// emit() only logs the event (in the browser console), like a dry run of the real fan-out.

import { run } from './runtime.js';
import { db } from './store.js';
import { notify } from './actions.js';

const PREF_KEYS = ['emailEnabled', 'playRequests', 'messages', 'areaGames', 'gameJoins', 'gameInvites', 'playingNow'];

export async function getPrefs() {
  return run(() => Object.fromEntries(PREF_KEYS.map((key) => [key, db.notificationPrefs[key] ?? true])));
}

export async function savePrefs(prefs) {
  return run(() => {
    for (const key of PREF_KEYS) {
      if (typeof prefs?.[key] === 'boolean') db.notificationPrefs[key] = prefs[key];
    }
  });
}

/** Never throws, never rejects. */
export async function emit(event) {
  try {
    await run(() => notify(event));
  } catch (err) {
    console.warn('Ilmoituksen lähetys epäonnistui (demo)', err);
  }
}
