// messages.js — Viestit: one conversation per coach–player pair (supabase table koutsi_threads,
// messages in koutsi_messages). Pure helpers for both apps: unread counts, the coach's
// "Vastaamatta", list previews and times, the conversation as day separators and bubble groups,
// "Nähty", who messages are on for, and the gentle health-word check before sending.
//
//   Thread  { id, coachId, studentId, enabled, enabledAt, lastMessageAt, coachReadAt, playerReadAt,
//             last: { body, sender: 'coach' | 'player', refKind } | null, unread }
//   Message { id, sender: 'coach' | 'player', body, refKind, refId, at }
// `viewer` is the side looking: 'coach' or 'player'.

import { koutsiAddDays } from './core.js';

export const MESSAGE_MAX = 2000;
const WEEKDAY = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
const GROUP_GAP_MS = 10 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');
/** Local 'YYYY-MM-DD' of a timestamp. */
export const localDay = (at) => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** '18:42' */
export const clockOf = (at) => { const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dateLabel = (day) => { const [, m, d] = day.split('-').map(Number); return `${d}.${m}.`; };
const weekdayOf = (day) => { const [y, m, d] = day.split('-').map(Number); return WEEKDAY[new Date(y, m - 1, d).getDay()]; };

/** The separator above a day's messages: "Tänään", "Eilen", "ma 26.10." */
export function dayLabel(day, now = new Date()) {
  const today = localDay(now);
  if (day === today) return 'Tänään';
  if (day === koutsiAddDays(today, -1)) return 'Eilen';
  return `${weekdayOf(day)} ${dateLabel(day)}`;
}

/** A list row's time: "18:42" today, "eilen", "ma" within the week, else "21.10." */
export function listTime(at, now = new Date()) {
  if (!at) return '';
  const day = localDay(at);
  const today = localDay(now);
  if (day === today) return clockOf(at);
  if (day === koutsiAddDays(today, -1)) return 'eilen';
  if (day > koutsiAddDays(today, -7)) return weekdayOf(day);
  return dateLabel(day);
}

const other = (viewer) => (viewer === 'coach' ? 'player' : 'coach');

/** Unread messages over all conversations (the badge). */
export const unreadTotal = (threads) => (threads || []).reduce((n, t) => n + (t.unread || 0), 0);

/** The coach's "Vastaamatta": the player wrote last. Newest first. */
export function unanswered(threads, viewer = 'coach') {
  return (threads || [])
    .filter((t) => t.last && t.last.sender === other(viewer))
    .sort((a, b) => String(b.lastMessageAt || '').localeCompare(String(a.lastMessageAt || '')));
}

/** Conversations with something in them, newest first (an empty one only once it is opened). */
export function sortThreads(threads) {
  return [...(threads || [])].sort((a, b) => String(b.lastMessageAt || b.enabledAt || '').localeCompare(String(a.lastMessageAt || a.enabledAt || '')));
}

/** "Sinä: Kiitos!" for one's own last message, the text otherwise. */
export function previewOf(thread, viewer) {
  if (!thread?.last) return '';
  const body = String(thread.last.body || '').replace(/\s+/g, ' ').trim();
  return thread.last.sender === viewer ? `Sinä: ${body}` : body;
}

/** "Maria K.", "Maria K. ja Jussi T.", "Maria K., Jussi T. ja 2 muuta" */
export function namesLine(names) {
  const list = (names || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} ja ${list[1]}`;
  return `${list[0]}, ${list[1]} ja ${list.length - 2} muuta`;
}

/**
 * The conversation for the screen: day separators and groups of one side's messages in a row
 * (ten minutes at most between them). [{ kind: 'day', key, label } | { kind: 'group', key, mine, bubbles, time }]
 */
export function timeline(messages, viewer, now = new Date()) {
  const items = [];
  let day = null;
  let group = null;
  for (const m of [...(messages || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    const d = localDay(m.at);
    if (d !== day) {
      day = d;
      group = null;
      items.push({ kind: 'day', key: `day-${d}`, label: dayLabel(d, now) });
    }
    const mine = m.sender === viewer;
    if (!group || group.mine !== mine || new Date(m.at) - new Date(group.lastAt) > GROUP_GAP_MS) {
      group = { kind: 'group', key: `g-${m.id}`, mine, sender: m.sender, bubbles: [], time: '', lastAt: m.at };
      items.push(group);
    }
    group.bubbles.push(m);
    group.lastAt = m.at;
    group.time = clockOf(m.at);
  }
  return items;
}

/** "Nähty" under one's own latest message, once the other side has opened the conversation since. */
export function seen(thread, messages, viewer) {
  const list = [...(messages || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const last = list[list.length - 1];
  if (!thread || !last || last.sender !== viewer) return false;
  const theirRead = viewer === 'coach' ? thread.playerReadAt : thread.coachReadAt;
  return Boolean(theirRead) && new Date(theirRead) >= new Date(last.at);
}

/**
 * Who messages are on for, for the coach: 'on' | 'off' (decided: not this player) | 'unset'
 * (nobody has decided). A placeholder can be turned on; it works once they join.
 */
export function messagingOf(threads, studentId) {
  const t = (threads || []).find((x) => x.studentId === studentId);
  if (!t) return 'unset';
  return t.enabled ? 'on' : 'off';
}

/** A group's switch in "Viestit käyttöön": 'on' (everyone), 'some', 'off'. */
export function groupMessaging(group, threads) {
  const ids = group?.memberIds || [];
  if (!ids.length) return 'off';
  const on = ids.filter((id) => messagingOf(threads, id) === 'on').length;
  if (on === ids.length) return 'on';
  return on > 0 ? 'some' : 'off';
}

/**
 * What a reply quotes, as this viewer can see it: { label, text } — text null when the original is
 * gone or hidden from them (a deleted wish, a pruned notice, a "Vain minulle" feeling).
 * `student` is the player of the conversation (the coach's roster row, or the player themself).
 */
export function refQuote(state, student, refKind, refId, viewer) {
  if (!refKind || !refId) return null;
  if (refKind === 'wish') {
    const h = (student?.wishHistory || []).find((x) => x.id === refId);
    return { label: viewer === 'player' ? 'Toiveesi' : 'Toive', text: h?.value || null };
  }
  if (refKind === 'mood') {
    const m = (student?.moods || []).find((x) => x.id === refId);
    return { label: 'Miten meni?', text: m ? (m.note || `Fiilis ${m.score}/5`) : null };
  }
  if (refKind === 'announcement') {
    const a = (state?.announcements || []).find((x) => x.id === refId);
    return { label: 'Tiedote', text: a?.text || null };
  }
  return null;
}

/** "wish:<id>" (a reply link's ?vastaa=) → { kind, id } */
export function parseRef(value) {
  const [kind, id] = String(value || '').split(':');
  return ['wish', 'mood', 'announcement'].includes(kind) && id ? { kind, id } : null;
}

/**
 * Words that usually mean health information (illness, injury, medication). Body parts are left out
 * on purpose — "polvet koukkuun" is tennis. A hit only shows a reminder; nothing is blocked or stored.
 */
const HEALTH = /(kipe[äa]|kipu|sairas|sairau|sairast|flunss|kuume|vamma|loukkaan|loukkaantu|murtu|reväht|revähd|nyrjäh|venähd|leikkaus|lääk|diagnoo|astma|diabet|korona|covid|migreen|masennu|ahdistu|terveyskesk|sairaala|fysioterap|fyssari)/i;
export const looksLikeHealth = (text) => HEALTH.test(String(text || ''));
