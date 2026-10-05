// chatUtils.js — pure helpers for the inbox and chat (previews, grouping, links). No React, no api.
import { chatDayLabel, firstName, formatTime } from '../../lib/format.js';

const GROUP_GAP_MS = 6 * 60_000; // bubbles further apart than this start a new group

/** "Mikko liittyi peliin 🎾" — or "Liityit peliin 🎾" when it was me. */
export function joinText(message, meId) {
  if (message.senderId && message.senderId === meId) return 'Liityit peliin 🎾';
  const name = message.meta?.joinerName || message.sender?.name || firstName(String(message.text || '').split(' ')[0]);
  return `${firstName(name)} liittyi peliin 🎾`;
}

/** Inbox preview line, kind-aware: 'Sinä: Kuva 📷', 'Mikko: 👍', 'Laura liittyi peliin 🎾'. */
export function previewText(conversation, meId) {
  const last = conversation.lastMessage;
  if (!last) return 'Sano moi 👋';
  if (last.kind === 'join') {
    if (last.senderId === meId) return 'Liityit peliin 🎾';
    const name = String(last.text || '').replace(/\s*liittyi peliin!?\s*$/i, '').trim();
    return `${firstName(name || 'Pelaaja')} liittyi peliin 🎾`;
  }
  const body = last.kind === 'image' ? 'Kuva 📷' : last.kind === 'thumbs' ? '👍' : String(last.text || '').replace(/\s+/g, ' ').trim();
  if (last.senderId && last.senderId === meId) return `Sinä: ${body}`;
  if (conversation.isGroup && last.senderId) {
    const sender = conversation.participants.find((p) => p.id === last.senderId);
    if (sender) return `${firstName(sender.name)}: ${body}`;
  }
  return body;
}

const dayKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/**
 * Turns a flat, oldest-first message list into render items:
 *   { type: 'day', key, label }
 *   { type: 'system', key, message }                     'join' messages (centred pills)
 *   { type: 'group', key, mine, sender, messages[] }     consecutive bubbles of one sender
 */
export function buildTimeline(messages, meId, now = new Date()) {
  const items = [];
  let lastDay = null;
  let group = null;
  let prevAt = 0;
  for (const m of messages) {
    const day = dayKey(m.createdAt);
    if (day !== lastDay) {
      items.push({ type: 'day', key: `day-${day}`, label: chatDayLabel(m.createdAt, now) });
      lastDay = day;
      group = null;
    }
    const at = Date.parse(m.createdAt) || 0;
    if (m.kind === 'join') {
      items.push({ type: 'system', key: m.key || m.id, message: m });
      group = null;
    } else if (group && group.senderId === m.senderId && at - prevAt < GROUP_GAP_MS && !group.messages[group.messages.length - 1].failed) {
      group.messages.push(m);
    } else {
      group = { type: 'group', key: `g-${m.key || m.id}`, senderId: m.senderId, mine: m.senderId === meId, sender: m.sender, messages: [m] };
      items.push(group);
    }
    prevAt = at;
  }
  return items;
}

/** Bubble position inside its group: 'single' | 'first' | 'middle' | 'last'. */
export function bubblePosition(index, count) {
  if (count === 1) return 'single';
  if (index === 0) return 'first';
  if (index === count - 1) return 'last';
  return 'middle';
}

/** Time shown under a group: '18.32'. */
export const groupTime = (group) => formatTime(group.messages[group.messages.length - 1].createdAt);

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

/** Splits text into [{ text }, { url }] parts so links can be rendered as <a>. */
export function linkParts(text) {
  const s = String(text || '');
  const out = [];
  let last = 0;
  s.replace(URL_RE, (match, _g, offset) => {
    if (offset > last) out.push({ text: s.slice(last, offset) });
    out.push({ url: match });
    last = offset + match.length;
    return match;
  });
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

/** Only emoji (1–3 of them), e.g. '🎾🔥' — rendered big without a bubble. */
export function isEmojiOnly(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 12) return false;
  return /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u.test(t);
}

/**
 * Merges a server message into the local list (realtime or a send() result):
 * dedupes by id, swaps in for the matching pending bubble of mine, otherwise inserts it
 * before any still-local (pending/failed) bubbles so those stay at the bottom.
 */
export function mergeMessage(list, msg, meId, tmpId = null) {
  if (list.some((m) => m.id === msg.id)) return tmpId ? list.filter((m) => m.id !== tmpId) : list;
  let idx = tmpId ? list.findIndex((m) => m.id === tmpId) : -1;
  if (idx < 0 && msg.senderId === meId) {
    idx = list.findIndex((m) => m.local && !m.failed && m.kind === msg.kind && (msg.kind !== 'text' || m.text === msg.text));
  }
  if (idx >= 0) {
    const copy = [...list];
    copy[idx] = { ...msg, key: list[idx].key || list[idx].id }; // stable React key: no re-mount, no replayed animation
    return copy;
  }
  const firstLocal = list.findIndex((m) => m.local);
  if (firstLocal < 0) return [...list, msg];
  return [...list.slice(0, firstLocal), msg, ...list.slice(firstLocal)];
}

const at = (m) => Date.parse(m.createdAt) || 0;

/**
 * Folds a fresh server snapshot (the resync after the tab slept or went offline) into the list
 * on screen instead of replacing it:
 *   - known messages take the server's version but keep their React key (a sent bubble keeps
 *     its tmp key: no re-mount, no replayed slide-in animation);
 *   - messages the screen got after the snapshot was read (realtime, or a send that just
 *     finished) stay;
 *   - missed messages are added, and one that is the server copy of a still-pending bubble of
 *     mine replaces that bubble (via mergeMessage), so it never shows twice.
 * Server messages end up oldest first; pending/failed bubbles stay at the bottom.
 */
export function mergeSnapshot(list, fresh, meId) {
  const byId = new Map(fresh.map((m) => [m.id, m]));
  let out = list.map((m) => {
    const f = byId.get(m.id);
    if (!f) return m;
    return m.key && m.key !== f.id ? { ...f, key: m.key } : f;
  });
  const known = new Set(list.map((m) => m.id));
  for (const f of fresh) if (!known.has(f.id)) out = mergeMessage(out, f, meId);
  // More than a page arrived while away: what was on screen no longer connects to the
  // snapshot, so drop it rather than leave a silent gap in the thread.
  if (fresh.length && !list.some((m) => !m.local && byId.has(m.id))) {
    const oldest = at(fresh[0]);
    out = out.filter((m) => m.local || at(m) >= oldest);
  }
  const sent = out.filter((m) => !m.local).sort((a, b) => at(a) - at(b)); // stable: ties keep their order
  return [...sent, ...out.filter((m) => m.local)];
}
