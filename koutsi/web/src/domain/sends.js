// sends.js — Lähetetyt: everything a coach has sent to players as one list, newest first, and the
// helpers the pages share: who it went to (groups by name, the rest by first name), who has done a
// homework, who already has it (they can't be picked again in "Lähetä myös muille"), a group's own
// sendings and the coach's own videos with where each has gone.
//
//   Send     { id, kind: 'video' | 'homework' | 'note', videoId, refId, title, groupIds, studentIds, at }
//            (state.sends, koutsi_sends; a copy — a homework, a note — carries its sendId)
//   Notice   state.announcements (a tiedote is one row already: groupIds + the players named apart)
//   Item     what the list shows: { key, kind: 'video' | 'homework' | 'note' | 'notice', id, refId, videoId,
//            title, at, groupIds, studentIds, until?, copies: [{ studentId, id, done, doneAt }] }

import { koutsiAddDays } from './core.js';

const pad = (n) => String(n).padStart(2, '0');
const WEEKDAY = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const newestFirst = (a, b) => String(b.at || '').localeCompare(String(a.at || ''));

/** Local 'YYYY-MM-DD' of a timestamp. */
export const localDay = (at) => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** '18:42' */
export const clockOf = (at) => { const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** The heading above a day's sendings: "Tänään", "Eilen", "ma 19.10." */
export function sentDayLabel(day, now = new Date()) {
  const today = localDay(now);
  if (day === today) return 'Tänään';
  if (day === koutsiAddDays(today, -1)) return 'Eilen';
  const [y, m, d] = day.split('-').map(Number);
  return `${WEEKDAY[new Date(y, m - 1, d).getDay()]} ${d}.${m}.`;
}

/** "Tänään 18:42", "Eilen 19:05", "ma 19.10." — one sending's time on its own. */
export function sentWhen(at, now = new Date()) {
  if (!at) return '';
  const label = sentDayLabel(localDay(at), now);
  return label === 'Tänään' || label === 'Eilen' ? `${label} ${clockOf(at)}` : label;
}

/**
 * The groups a sending went to as a whole, so the list can say "Juniorit kilpa" instead of five names:
 * every group whose current members all got it, biggest first, each only if it adds somebody.
 */
export function groupsCovering(groups, ids) {
  const picked = new Set(ids || []);
  const covered = new Set();
  const out = [];
  [...(groups || [])]
    .filter((g) => (g.memberIds || []).length > 0)
    .sort((a, b) => b.memberIds.length - a.memberIds.length)
    .forEach((g) => {
      if (!g.memberIds.every((id) => picked.has(id))) return;
      if (g.memberIds.every((id) => covered.has(id))) return;
      out.push(g.id);
      g.memberIds.forEach((id) => covered.add(id));
    });
  return out;
}

/** A group's name, with its weekday when another of the coach's groups has the same name. */
export function groupName(groups, group) {
  if (!group) return '';
  const twin = (groups || []).some((g) => g.id !== group.id && g.name === group.name);
  return twin && group.day ? `${group.name} (${group.day.toLowerCase()})` : group.name;
}

const allGroupsOf = (state) => state.allGroups || state.groups || [];
const studentOf = (state, id) => (state.students || []).find((s) => s.id === id);

/** Everyone a sending reaches: its players, and for a tiedote also its groups' current members. */
export function audienceIds(state, item) {
  if (item.kind !== 'notice') return [...new Set(item.studentIds || [])];
  const groups = allGroupsOf(state).filter((g) => (item.groupIds || []).includes(g.id));
  return [...new Set([...groups.flatMap((g) => g.memberIds || []), ...(item.studentIds || [])])];
}

/**
 * Who it went to, in one line: the groups by name, then anyone else by first name —
 * "Juniorit kilpa", "Juniorit kilpa, Aikuiset jatko + Aino", "Aino, Onni ja 3 muuta".
 */
export function recipientsLabel(state, item) {
  const all = allGroupsOf(state);
  const groups = (item.groupIds || []).map((id) => all.find((g) => g.id === id)).filter(Boolean);
  const inGroups = new Set(groups.flatMap((g) => g.memberIds || []));
  const rest = (item.studentIds || []).filter((id) => !inGroups.has(id))
    .map((id) => studentOf(state, id)).filter(Boolean).map((s) => firstName(s.name) || s.name);
  const groupText = groups.length <= 2
    ? groups.map((g) => groupName(all, g)).join(', ')
    : `${groups.slice(0, 2).map((g) => groupName(all, g)).join(', ')} ja ${groups.length - 2} muuta ryhmää`;
  const names = (list, max) => (list.length <= max
    ? (list.length > 1 ? `${list.slice(0, -1).join(', ')} ja ${list[list.length - 1]}` : list.join(''))
    : `${list.slice(0, max - 1).join(', ')} ja ${list.length - (max - 1)} muuta`);
  if (!groups.length) return rest.length ? names(rest, 3) : 'Ei enää ketään';
  if (!rest.length) return groupText;
  return `${groupText} + ${rest.length <= 2 ? rest.join(', ') : `${rest.length} muuta`}`;
}

/** Every copy of a sending still there, by sendId: who got it, and for a homework who has done it. */
function copiesBySend(state) {
  const out = new Map();
  const add = (sendId, copy) => { if (!out.has(sendId)) out.set(sendId, []); out.get(sendId).push(copy); };
  for (const s of state.students || []) {
    for (const h of s.homework || []) if (h.sendId) add(h.sendId, { studentId: s.id, id: h.id, done: Boolean(h.done), doneAt: h.doneAt || null });
    for (const d of s.diary || []) if (d.sendId) add(d.sendId, { studentId: s.id, id: d.id, done: false, doneAt: null });
  }
  return out;
}

/** Everything the coach has sent, newest first: videos, homework, notes and tiedotteet. */
export function sentItems(state) {
  const copies = copiesBySend(state);
  const items = (state.sends || []).map((x) => ({
    key: `send-${x.id}`, kind: x.kind, id: x.id, refId: x.refId, videoId: x.videoId || null, title: x.title, at: x.at,
    groupIds: x.groupIds || [], studentIds: x.studentIds || [], copies: copies.get(x.id) || [],
  }));
  for (const a of state.announcements || []) {
    items.push({
      key: `notice-${a.id}`, kind: 'notice', id: a.id, refId: a.id, videoId: null, title: a.text, at: a.at,
      groupIds: a.groupIds || [], studentIds: a.studentIds || [], until: a.until, copies: [],
    });
  }
  return items.sort(newestFirst);
}

/** "3/8 tehty" for a homework; null for anything else. */
export function homeworkProgress(item) {
  if (item.kind !== 'homework' || !item.copies.length) return null;
  return { done: item.copies.filter((c) => c.done).length, total: item.copies.length };
}

/** The list's filter: 'kaikki' | 'video' | 'laksy' | 'huomio' | 'tiedote', and a group (its sendings, by id). */
const FILTER_KIND = { video: 'video', laksy: 'homework', huomio: 'note', tiedote: 'notice' };
export const SENT_FILTERS = [
  { value: 'kaikki', label: 'Kaikki' },
  { value: 'video', label: 'Videot' },
  { value: 'laksy', label: 'Kotiläksyt' },
  { value: 'huomio', label: 'Huomiot' },
  { value: 'tiedote', label: 'Tiedotteet' },
];
export function filterSent(items, { kind = 'kaikki', groupId = null } = {}) {
  return items.filter((it) => (kind === 'kaikki' || it.kind === FILTER_KIND[kind])
    && (!groupId || (it.groupIds || []).includes(groupId)));
}

/** The list in days: [{ day, label, items }], newest day first. */
export function sentByDay(items, now = new Date()) {
  const days = [];
  for (const it of items) {
    const day = localDay(it.at);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(it);
    else days.push({ day, label: sentDayLabel(day, now), items: [it] });
  }
  return days;
}

/**
 * Who already has it — they show as "Saanut" and can't be picked again: Map studentId → when.
 * A video: everyone who has it now (however it reached them). A homework or note: everyone with a
 * copy from any sending of the same thing. A tiedote: its groups' members and the players named.
 */
export function receivedBy(state, item) {
  const out = new Map();
  if (item.kind === 'video') {
    for (const s of state.students || []) {
      const v = (s.videos || []).find((x) => x.shareId === item.videoId);
      if (v) out.set(s.id, v.at);
    }
    return out;
  }
  if (item.kind === 'notice') {
    audienceIds(state, item).forEach((id) => out.set(id, item.at));
    return out;
  }
  const sendIds = new Set((state.sends || []).filter((x) => x.refId === item.refId).map((x) => x.id));
  const key = item.kind === 'homework' ? 'homework' : 'diary';
  for (const s of state.students || []) {
    const copy = (s[key] || []).find((x) => x.sendId && sendIds.has(x.sendId));
    if (copy) out.set(s.id, copy.at);
  }
  return out;
}

/** The other sendings of the same thing, oldest first ("Lähetetty myös"). */
export function relatedSends(state, item) {
  if (item.kind === 'notice') return [];
  return (state.sends || [])
    .filter((x) => x.id !== item.id && (item.kind === 'video' ? x.videoId === item.videoId : x.refId === item.refId))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * The coach's own videos for the Videot tab, newest first, each with who has it now (holderIds) and
 * its sendings (newest first).
 */
export function libraryItems(state) {
  const holders = new Map();
  for (const s of state.students || []) {
    for (const v of s.videos || []) {
      if (v.addedBy === 'player') continue;
      if (!holders.has(v.shareId)) holders.set(v.shareId, []);
      holders.get(v.shareId).push(s.id);
    }
  }
  return (state.videoLibrary || []).map((v) => {
    const sends = (state.sends || []).filter((x) => x.videoId === v.id).sort(newestFirst);
    return { ...v, holderIds: holders.get(v.id) || [], sends, lastSentAt: sends[0]?.at || null };
  }).sort(newestFirst);
}

/** "Jaettu: Juniorit kilpa, Aino · ma 19.10." / "Ei vielä jaettu" — a video's line in the list. */
export function libraryLine(state, video, now = new Date()) {
  if (!video.holderIds.length) return video.sends.length ? 'Ei kenelläkään nyt' : 'Ei vielä jaettu';
  const groupIds = groupsCovering(state.groups, video.holderIds);
  const who = recipientsLabel(state, { groupIds, studentIds: video.holderIds });
  return video.lastSentAt ? `${who} (${sentWhen(video.lastSentAt, now)})` : who;
}

/**
 * What notes.addMany / homework.addMany take to put a sending in Lähetetyt, or null while the
 * database has no Lähetetyt yet (state.sendsReady false): the coach and the groups it went to as a whole.
 * refId: "Lähetä myös muille" — the sending it continues.
 */
export function sendLogFor(state, coachId, ids, refId = null) {
  if (!state?.sendsReady) return null;
  return { coachId, groupIds: groupsCovering(state.groups, ids), ...(refId ? { refId } : {}) };
}
