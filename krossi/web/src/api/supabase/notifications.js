// notifications.js — notification preferences and the push + email fan-out.

import { db, requireUid, isMissingColumn } from './client.js';
import { toApiError } from '../errors.js';

// Contract field -> notification_preferences column. push_enabled / images_enabled belong to
// the mobile app's settings screen and are deliberately never written from the web.
const PREF_COLUMNS = {
  emailEnabled: 'email_enabled',
  playRequests: 'play_requests_enabled',
  messages: 'messages_enabled',
  areaGames: 'area_challenges_enabled',
  gameJoins: 'challenge_joins_enabled',
  gameInvites: 'challenge_invites_enabled',
  playingNow: 'playing_now_emails_enabled',
};

// email_enabled is added by a new migration; until it is deployed the web must keep working.
const EMAIL_COLUMN = PREF_COLUMNS.emailEnabled;

function columnsFor({ withEmail }) {
  return Object.values(PREF_COLUMNS).filter((col) => withEmail || col !== EMAIL_COLUMN);
}

function mapPrefs(row) {
  const prefs = {};
  // A missing row (or column) means "everything on" — the same default the database uses.
  for (const [key, col] of Object.entries(PREF_COLUMNS)) prefs[key] = row?.[col] ?? true;
  return prefs;
}

export async function getPrefs() {
  const uid = await requireUid();
  const select = (withEmail) =>
    db().from('notification_preferences').select(columnsFor({ withEmail }).join(', ')).eq('user_id', uid).maybeSingle();

  let { data, error } = await select(true);
  if (error && isMissingColumn(error, EMAIL_COLUMN)) ({ data, error } = await select(false));
  if (error) throw toApiError(error, 'Ilmoitusasetuksia ei voitu ladata.');
  return mapPrefs(data);
}

export async function savePrefs(prefs) {
  const uid = await requireUid();
  const row = { user_id: uid };
  for (const [key, col] of Object.entries(PREF_COLUMNS)) {
    if (typeof prefs?.[key] === 'boolean') row[col] = prefs[key];
  }
  const upsert = (payload) => db().from('notification_preferences').upsert(payload, { onConflict: 'user_id' });

  let { error } = await upsert(row);
  if (error && isMissingColumn(error, EMAIL_COLUMN)) {
    const { [EMAIL_COLUMN]: _notYetDeployed, ...rest } = row;
    ({ error } = await upsert(rest));
  }
  if (error) throw toApiError(error, 'Ilmoitusasetuksia ei voitu tallentaa.');
}

// The same event goes to both functions: send-push-notification reaches the mobile app,
// krossi-notify sends email. Each decides recipients and honours preferences itself.
const NOTIFY_FUNCTIONS = ['send-push-notification', 'krossi-notify'];

/**
 * Fire-and-forget: never throws, never rejects. The action that triggered the notification
 * has already succeeded, so a failed notification must not surface as an error.
 */
export async function emit(event) {
  const results = await Promise.allSettled(
    NOTIFY_FUNCTIONS.map(async (name) => db().functions.invoke(name, { body: event })),
  );
  results.forEach((result, i) => {
    const failure = result.status === 'rejected' ? result.reason : result.value?.error;
    if (failure) console.warn(`Ilmoituksen lähetys epäonnistui (${NOTIFY_FUNCTIONS[i]}, ${event?.type})`, failure);
  });
}
