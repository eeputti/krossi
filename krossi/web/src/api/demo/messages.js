// messages.js (demo) — conversations, play requests, chat and "realtime", mirroring
// api/supabase/messages.js. Other people answer a few seconds after Alex writes.

import { ApiError } from '../errors.js';
import { ME } from './rows.js';
import {
  run, objectUrlFor, listenConversation, listenInbox, broadcastInboxChange,
} from './runtime.js';
import { db, conversationRow, myConversations } from './store.js';
import { toConversation, toMessage, toPlayRequest } from './views.js';
import {
  dbError, forbidden, notify, postMessage, findOrCreateDirect, scheduleReply, scheduleRequestFollowUp,
} from './actions.js';

const MAX_MESSAGE_LENGTH = 1000; // messages_content_check
const MESSAGE_PAGE = 500;
const INBOX_DEBOUNCE_MS = 250;

/** A conversation I take part in (RLS), or null. */
function myConversation(id) {
  const conversation = conversationRow(id);
  return conversation && conversation.participantIds.includes(ME) ? conversation : null;
}

function requireMine(id) {
  const conversation = myConversation(id);
  // Inserting into someone else's conversation fails the messages insert policy.
  if (!conversation) throw forbidden();
  return conversation;
}

// ── Conversations ────────────────────────────────────────────────────────────

function conversationList() {
  return myConversations()
    .map(toConversation)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function listConversations() {
  return run(conversationList);
}

export async function getConversation(id) {
  return run(() => {
    const conversation = myConversation(id);
    return conversation ? toConversation(conversation) : null;
  });
}

export async function deleteConversation(id) {
  return run(() => {
    if (!myConversation(id)) throw dbError('Keskustelua ei löytynyt tai sinulla ei ole oikeutta poistaa sitä.', 'Keskustelua ei voitu poistaa.');
    db.conversations.delete(id);
    db.messages.delete(id);
    db.pendingReplies.delete(id);
    db.archivedIds = db.archivedIds.filter((x) => x !== id);
    broadcastInboxChange();
  });
}

export async function markRead(conversationId) {
  return run(() => {
    const conversation = myConversation(conversationId);
    if (!conversation) return; // mark_conversation_read updates zero rows
    conversation.lastReadAt[ME] = new Date().toISOString();
    broadcastInboxChange();
  });
}

export async function unreadCount() {
  return run(() => {
    const hidden = new Set(db.archivedIds);
    const unread = conversationList().filter((c) => c.unread && !hidden.has(c.id)).length;
    return unread + pendingRequests().length;
  });
}

// ── Play requests ────────────────────────────────────────────────────────────

function pendingRequests() {
  return [...db.playRequests.values()]
    .filter((r) => r.toId === ME && r.status === 'pending')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function listRequests() {
  return run(() => pendingRequests().map(toPlayRequest));
}

function pendingRequestToMe(id, raw, fallback) {
  const request = db.playRequests.get(id);
  if (!request || request.toId !== ME || request.status !== 'pending') throw dbError(raw, fallback);
  return request;
}

/** accept_connection_request: find-or-create the 1:1 chat, the request text becomes its first message. */
export async function acceptRequest(id) {
  return run(() => {
    const request = pendingRequestToMe(id, 'Pyyntöä ei löytynyt tai sitä ei voi hyväksyä.', 'Pyynnön hyväksyminen epäonnistui.');
    const conversation = findOrCreateDirect(request.fromId);
    postMessage(conversation.id, request.fromId, { text: request.message });
    request.status = 'accepted';
    scheduleRequestFollowUp(conversation.id, request.fromId);
    return conversation.id;
  });
}

export async function ignoreRequest(id) {
  return run(() => {
    const request = pendingRequestToMe(id, 'Pyyntöä ei löytynyt tai sitä ei voi ohittaa.', 'Pyynnön ohittaminen epäonnistui.');
    request.status = 'ignored';
    broadcastInboxChange();
  });
}

// ── Chat ─────────────────────────────────────────────────────────────────────

export async function listMessages(conversationId) {
  return run(() => {
    if (!myConversation(conversationId)) return []; // RLS: nothing visible
    return (db.messages.get(conversationId) || []).slice(-MESSAGE_PAGE).map(toMessage);
  });
}

export async function send(conversationId, text) {
  return run(() => {
    const content = String(text ?? '').trim();
    if (!content) throw new ApiError('Kirjoita viesti ensin.', { code: 'invalid' });
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new ApiError(`Viesti on liian pitkä (enintään ${MAX_MESSAGE_LENGTH} merkkiä).`, { code: 'invalid' });
    }
    const conversation = requireMine(conversationId);
    const row = postMessage(conversation.id, ME, { text: content });
    notify({ type: 'new_message', conversationId, senderId: ME, hasImage: false, isThumbsUp: false });
    scheduleReply(conversation, { kind: 'text', text: content });
    return toMessage(row);
  });
}

export async function sendThumbs(conversationId) {
  return run(() => {
    const conversation = requireMine(conversationId);
    const row = postMessage(conversation.id, ME, { kind: 'thumbs', text: '👍' });
    notify({ type: 'new_message', conversationId, senderId: ME, hasImage: false, isThumbsUp: true });
    scheduleReply(conversation, { kind: 'thumbs' });
    return toMessage(row);
  });
}

// Shown where URL.createObjectURL is missing (Node tests): a small court-green tile.
const PLACEHOLDER_IMAGE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#1E6B52"/>'
  + '<rect x="16" y="12" width="128" height="96" fill="none" stroke="#fff" stroke-width="3"/>'
  + '<line x1="80" y1="12" x2="80" y2="108" stroke="#fff" stroke-width="3"/><circle cx="112" cy="40" r="8" fill="#CFE414"/></svg>',
);

/** Nothing is uploaded: the photo is shown from an object URL of the picked file. */
export async function sendImage(conversationId, file) {
  return run(() => {
    // resizeImage() rejects non-images; production then shows this fallback message.
    if (!file || !/^image\//.test(file.type || 'image/')) throw new ApiError('Kuvaa ei voitu käsitellä.');
    const conversation = requireMine(conversationId);
    const row = postMessage(conversation.id, ME, { kind: 'image', imageUrl: objectUrlFor(file, PLACEHOLDER_IMAGE) });
    notify({ type: 'new_message', conversationId, senderId: ME, hasImage: true, isThumbsUp: false });
    scheduleReply(conversation, { kind: 'image' });
    return toMessage(row);
  });
}

// ── Realtime ─────────────────────────────────────────────────────────────────

/** (conversationId, onMessage) -> unsubscribe, returned directly (not a Promise). */
export function subscribe(conversationId, onMessage) {
  let active = true;
  const stop = listenConversation(conversationId, (message) => {
    if (active) onMessage(message);
  });
  return () => {
    active = false;
    stop();
  };
}

/** Calls onChange (debounced like production) on any new message, conversation or request change. */
export function subscribeInbox(onChange) {
  let timer = null;
  let active = true;
  const stop = listenInbox(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (active) onChange();
    }, INBOX_DEBOUNCE_MS);
    timer.unref?.();
  });
  return () => {
    active = false;
    clearTimeout(timer);
    stop();
  };
}

// ── Archive (per browser; in the demo, per page load) ────────────────────────

export async function getArchived() {
  return run(() => [...db.archivedIds]);
}

export async function setArchived(ids) {
  return run(() => {
    db.archivedIds = [...new Set((ids || []).filter((id) => typeof id === 'string'))];
  });
}
