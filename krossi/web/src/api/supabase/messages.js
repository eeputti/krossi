// messages.js — conversations, play requests and chat (incl. photos and realtime).

import { db, requireUid, currentUid, selectIn, isUuid } from './client.js';
import {
  PERSON_COLUMNS, MESSAGE_COLUMNS, THUMBS_UP_CONTENT, mapPerson, mapMessage, lastMessagePreview,
} from './map.js';
import { emit } from './notifications.js';
import { ApiError, toApiError, unwrap } from '../errors.js';
import { resizeImage } from '../../lib/image.js';

const LOAD_FAIL = 'Viestejä ei voitu ladata.';
const SEND_FAIL = 'Viestin lähetys epäonnistui. Yritä uudelleen.';
const MAX_MESSAGE_LENGTH = 1000; // messages_content_check
// The newest messages are what a chat shows; older history beyond this is not loaded.
const MESSAGE_PAGE = 500;

// ── People cache ─────────────────────────────────────────────────────────────
// Realtime rows carry only sender_id; the sender is looked up once and remembered.

const people = new Map();

function remember(person) {
  if (person?.id) people.set(person.id, person);
  return person;
}

async function personById(id) {
  if (people.has(id)) return people.get(id);
  const { data, error } = await db().from('profiles').select(PERSON_COLUMNS).eq('id', id).maybeSingle();
  if (error) console.warn('Lähettäjän tietoja ei voitu ladata', error);
  const person = mapPerson(data, id);
  // An unreadable profile (unpaid viewer) is not cached, so paying later shows real names.
  return data ? remember(person) : person;
}

// ── Conversations ────────────────────────────────────────────────────────────

/**
 * Port of the legacy fetchWebConversations, with two fixes: participants whose profile the
 * viewer can't read (unpaid) still count as people, and image messages get a preview.
 */
async function loadConversations(uid, onlyId = null) {
  let mine = db()
    .from('conversation_participants')
    .select('conversation_id, last_read_at, conversation:conversations(id, updated_at, last_message, challenge_id, is_group)')
    .eq('user_id', uid);
  if (onlyId) mine = mine.eq('conversation_id', onlyId);
  const rows = (unwrap(await mine, LOAD_FAIL) || []).filter((r) => r.conversation);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.conversation_id);
  const gameIds = rows.map((r) => r.conversation.challenge_id).filter(Boolean);
  const [participants, latest, games] = await Promise.all([
    selectIn(ids, (chunk) =>
      db().from('conversation_participants')
        .select(`conversation_id, user_id, profile:profiles!conversation_participants_user_id_fkey(${PERSON_COLUMNS})`)
        .in('conversation_id', chunk), LOAD_FAIL),
    // Newest first, so the first row seen per conversation is its latest message. The
    // limit matches PostgREST's max-rows; a conversation quiet for longer simply shows
    // its stored last_message and no unread dot.
    selectIn(ids, (chunk) =>
      db().from('messages').select('conversation_id, sender_id, created_at, image_url')
        .in('conversation_id', chunk).order('created_at', { ascending: false }).limit(1000), LOAD_FAIL),
    selectIn(gameIds, (chunk) => db().from('challenges').select('id, title').in('id', chunk), LOAD_FAIL),
  ]);

  const othersByConversation = new Map();
  for (const p of participants) {
    if (p.user_id === uid) continue;
    const list = othersByConversation.get(p.conversation_id) || [];
    list.push(remember(mapPerson(p.profile, p.user_id)));
    othersByConversation.set(p.conversation_id, list);
  }
  const latestByConversation = new Map();
  for (const m of latest) if (!latestByConversation.has(m.conversation_id)) latestByConversation.set(m.conversation_id, m);
  const gameTitle = new Map(games.map((g) => [g.id, g.title?.trim() || null]));

  return rows
    .map((row) => {
      const others = othersByConversation.get(row.conversation_id) || [];
      if (others.length === 0) return null; // everyone else has left; nothing to show
      const conv = row.conversation;
      const last = latestByConversation.get(row.conversation_id);
      const isGroup = Boolean(conv.is_group) || others.length > 1;
      const title = isGroup
        ? gameTitle.get(conv.challenge_id) || (others.length === 1 ? others[0].name : 'Ryhmäkeskustelu')
        : others[0].name;
      const unread = Boolean(
        last?.sender_id && last.sender_id !== uid && (!row.last_read_at || new Date(last.created_at) > new Date(row.last_read_at)),
      );
      return {
        id: row.conversation_id,
        isGroup,
        title,
        participants: others,
        lastMessage: lastMessagePreview(conv.last_message, {
          senderId: last?.sender_id ?? null,
          createdAt: last?.created_at ?? conv.updated_at,
          hasImage: Boolean(last?.image_url) && !conv.last_message,
        }),
        updatedAt: conv.updated_at,
        unread,
        gameId: conv.challenge_id ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function listConversations() {
  return loadConversations(await requireUid());
}

export async function getConversation(id) {
  if (!isUuid(id)) return null;
  const [conversation] = await loadConversations(await requireUid(), id);
  return conversation || null;
}

export async function deleteConversation(id) {
  await requireUid();
  unwrap(await db().rpc('delete_conversation_for_all', { conversation_id_input: id }), 'Keskustelua ei voitu poistaa.');
  const archived = await getArchived();
  if (archived.includes(id)) await setArchived(archived.filter((x) => x !== id));
}

export async function markRead(conversationId) {
  const uid = await requireUid();
  unwrap(await db().rpc('mark_conversation_read', { p_conversation_id: conversationId, p_user_id: uid }), LOAD_FAIL);
}

export async function unreadCount() {
  const uid = await requireUid();
  const [conversations, requests, archived, blocked] = await Promise.all([
    loadConversations(uid),
    db().from('connection_requests').select('sender_id').eq('receiver_id', uid).eq('status', 'pending'),
    getArchived(),
    blockedSenderIds(uid),
  ]);
  if (requests.error) throw toApiError(requests.error, LOAD_FAIL);
  const hidden = new Set(archived);
  const openRequests = (requests.data || []).filter((r) => !blocked.has(r.sender_id)).length;
  return conversations.filter((c) => c.unread && !hidden.has(c.id)).length + openRequests;
}

// ── Play requests ────────────────────────────────────────────────────────────

// Nothing in the database stops a blocked player from sending requests, so hide them here.
async function blockedSenderIds(uid) {
  const { data, error } = await db().from('blocked_profiles').select('blocked_id').eq('blocker_id', uid);
  if (error) console.warn('Estettyjen haku epäonnistui', error);
  return new Set((data || []).map((r) => r.blocked_id));
}

export async function listRequests() {
  const uid = await requireUid();
  const [result, blocked] = await Promise.all([
    db()
      .from('connection_requests')
      .select(`id, sender_id, message, created_at, sender:profiles!connection_requests_sender_id_fkey(${PERSON_COLUMNS})`)
      .eq('receiver_id', uid)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    blockedSenderIds(uid),
  ]);
  const rows = unwrap(result, 'Pelipyyntöjä ei voitu ladata.');
  return (rows || []).filter((r) => !blocked.has(r.sender_id)).map((r) => ({
    id: r.id,
    from: mapPerson(r.sender, r.sender_id),
    message: r.message || '',
    createdAt: r.created_at,
  }));
}

export async function acceptRequest(id) {
  await requireUid();
  return unwrap(await db().rpc('accept_connection_request', { request_id_input: id }), 'Pyynnön hyväksyminen epäonnistui.');
}

export async function ignoreRequest(id) {
  await requireUid();
  unwrap(await db().rpc('ignore_connection_request', { request_id_input: id }), 'Pyynnön ohittaminen epäonnistui.');
}

// ── Chat ─────────────────────────────────────────────────────────────────────

export async function listMessages(conversationId) {
  await requireUid();
  // Fetched newest-first and reversed: an ascending query would return the *oldest* page
  // and silently drop the latest messages of a long chat.
  const rows = unwrap(
    await db()
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(MESSAGE_PAGE),
    LOAD_FAIL,
  ) || [];
  return rows.reverse().map((row) => {
    const sender = mapPerson(row.profile, row.sender_id);
    if (row.profile) remember(sender);
    return mapMessage(row, sender);
  });
}

async function insertMessage(conversationId, fields) {
  const { data, error } = await db()
    .from('messages')
    .insert({ conversation_id: conversationId, ...fields })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw toApiError(error, SEND_FAIL);
  return mapMessage(data);
}

export async function send(conversationId, text) {
  const uid = await requireUid();
  const content = String(text ?? '').trim();
  if (!content) throw new ApiError('Kirjoita viesti ensin.', { code: 'invalid' });
  if (content.length > MAX_MESSAGE_LENGTH) {
    throw new ApiError(`Viesti on liian pitkä (enintään ${MAX_MESSAGE_LENGTH} merkkiä).`, { code: 'invalid' });
  }
  const message = await insertMessage(conversationId, { content });
  emit({ type: 'new_message', conversationId, senderId: uid, hasImage: false, isThumbsUp: false });
  return message;
}

export async function sendThumbs(conversationId) {
  const uid = await requireUid();
  const message = await insertMessage(conversationId, { content: THUMBS_UP_CONTENT });
  emit({ type: 'new_message', conversationId, senderId: uid, hasImage: false, isThumbsUp: true });
  return message;
}

export async function sendImage(conversationId, file) {
  const uid = await requireUid();
  let blob;
  try {
    blob = await resizeImage(file, { max: 1600, quality: 0.82 });
  } catch (err) {
    throw toApiError(err, 'Kuvaa ei voitu käsitellä.');
  }
  // Same layout as the mobile app: the first folder must be my uid (storage RLS).
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  unwrap(
    await db().storage.from('chat-images').upload(path, blob, { contentType: 'image/jpeg', upsert: false }),
    'Kuvan lähetys epäonnistui.',
  );
  // The mobile app sends photos with image_url = storage path and no content.
  const message = await insertMessage(conversationId, { image_url: path });
  emit({ type: 'new_message', conversationId, senderId: uid, hasImage: true, isThumbsUp: false });
  return message;
}

// ── Realtime ─────────────────────────────────────────────────────────────────

// supabase.channel(topic) returns an existing channel for a reused topic, and a channel
// can't take new listeners once subscribed — so every subscription gets its own topic.
let channelSeq = 0;
const topic = (name) => `${name}:${++channelSeq}:${Date.now().toString(36)}`;

/** Returns the unsubscribe function directly (not a Promise). */
export function subscribe(conversationId, onMessage) {
  let active = true;
  const channel = db()
    .channel(topic(`chat-${conversationId}`))
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      async ({ new: row }) => {
        try {
          const sender = await personById(row.sender_id);
          if (active) onMessage(mapMessage(row, sender));
        } catch (err) {
          console.warn('Reaaliaikaisen viestin käsittely epäonnistui', err);
        }
      },
    )
    .subscribe();
  return () => {
    active = false;
    db().removeChannel(channel);
  };
}

/** Calls onChange (debounced) on any new message, conversation change or play request. */
export function subscribeInbox(onChange) {
  let timer = null;
  const notify = () => {
    clearTimeout(timer);
    timer = setTimeout(() => onChange(), 250);
  };
  let channel = db()
    .channel(topic('inbox'))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, notify)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, notify);
  // The uid is normally cached by the time the inbox mounts; without it the request
  // listener is skipped rather than subscribing to everyone's requests.
  const uidPromise = currentUid().catch(() => null);
  let removed = false;
  uidPromise.then((uid) => {
    if (removed) return;
    if (uid) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'connection_requests', filter: `receiver_id=eq.${uid}` },
        notify,
      );
    }
    channel.subscribe();
  });
  return () => {
    removed = true;
    clearTimeout(timer);
    db().removeChannel(channel);
  };
}

// ── Archive (per browser) ────────────────────────────────────────────────────
// Same localStorage key as the legacy web app, so people keep their archive.

const archiveKey = (uid) => `krossi_archived_conversations_${uid}`;

export async function getArchived() {
  const uid = await currentUid();
  if (!uid) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(archiveKey(uid)) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch (err) {
    console.warn('Arkiston luku epäonnistui', err);
    return [];
  }
}

export async function setArchived(ids) {
  const uid = await requireUid();
  try {
    localStorage.setItem(archiveKey(uid), JSON.stringify([...new Set(ids)]));
  } catch (err) {
    throw toApiError(err, 'Arkistointi ei onnistunut tässä selaimessa.');
  }
}
