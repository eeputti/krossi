// social.js — blocking and reporting other players.

import { db, requireUid, isDuplicate, selectIn } from './client.js';
import { PERSON_COLUMNS, mapPerson } from './map.js';
import { emit } from './notifications.js';
import { ApiError, toApiError, unwrap } from '../errors.js';

export async function listBlocked() {
  const uid = await requireUid();
  const rows = unwrap(
    await db()
      .from('blocked_profiles')
      .select(`id, blocked_id, created_at, profile:profiles!blocked_profiles_blocked_id_fkey(${PERSON_COLUMNS})`)
      .eq('blocker_id', uid)
      .order('created_at', { ascending: false }),
    'Estettyjä pelaajia ei voitu ladata.',
  );
  return (rows || []).map((r) => ({ rowId: r.id, user: mapPerson(r.profile, r.blocked_id) }));
}

export async function block(userId) {
  const uid = await requireUid();
  const { error } = await db().from('blocked_profiles').insert({ blocker_id: uid, blocked_id: userId });
  // Unique (blocker, blocked): blocking twice is not an error for the user.
  if (error && !isDuplicate(error)) throw toApiError(error, 'Esto epäonnistui.');
  // Their pending play requests to me go away too (receivers may set status 'ignored').
  const { error: ignoreError } = await db().from('connection_requests')
    .update({ status: 'ignored' }).eq('receiver_id', uid).eq('sender_id', userId).eq('status', 'pending');
  if (ignoreError) console.warn('Estetyn pelaajan pyyntöjen ohitus epäonnistui', ignoreError);
}

export async function unblock(rowId) {
  await requireUid();
  unwrap(await db().from('blocked_profiles').delete().eq('id', rowId), 'Eston poisto epäonnistui.');
}

// A shared conversation is attached to the report as context for whoever handles it.
async function sharedConversationId(uid, otherId) {
  const { data: mine, error } = await db().from('conversation_participants').select('conversation_id').eq('user_id', uid);
  if (error) throw error;
  const shared = await selectIn((mine || []).map((r) => r.conversation_id), (chunk) =>
    db().from('conversation_participants').select('conversation_id').eq('user_id', otherId).in('conversation_id', chunk).limit(1));
  return shared[0]?.conversation_id || null;
}

export async function report(userId, reason) {
  const uid = await requireUid();
  const text = String(reason || '').trim();
  if (!text) throw new ApiError('Kerro lyhyesti, mikä on vialla.', { code: 'invalid' });
  // Context only: the report is still sent if the lookup fails.
  const conversationId = await sharedConversationId(uid, userId).catch((err) => {
    console.warn('Yhteisen keskustelun haku ilmoitukseen epäonnistui', err);
    return null;
  });
  const row = unwrap(
    await db()
      .from('reports')
      .insert({ reporter_id: uid, reported_id: userId, reason: text, conversation_id: conversationId })
      .select('id')
      .single(),
    'Ilmoituksen lähetys epäonnistui.',
  );
  emit({ type: 'account_report', reportId: row.id, reporterId: uid, reportedId: userId });
}
