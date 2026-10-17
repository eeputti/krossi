// notifications.js — "Ilmoitukset" behind the bell on Koti.
//
// Krossi has no in-app notification store (only push to the mobile app and email), so the list is
// built from what the player's data already says, newest first:
//   invite    someone invited me to a game            -> the game
//   request   a play request waiting for an answer     -> Viestit
//   message   a conversation with an unread message    -> the chat
//   outcome   a game of mine is over, no answer yet    -> "Pelasitteko?"
//   soon      a game I'm in starts within 24 hours     -> the game
//   newGame   someone opened a game in my cities (7 d) -> the game
//   share     a friend sent me the payment link of a court they booked -> the link (pay my part)
//   splitPaid a friend paid their part of my court (7 d), it came back to me -> Omat varaukset
//   sold      a booking I put on sale was booked by somebody (7 d)     -> Varaa kenttä
//   resultConfirm  someone logged a result with me as their opponent       -> "Vahvistatko tuloksen?"
//   resultAnswered the opponent confirmed / disputed a result I logged (7 d) -> Profiili
// `at` orders the list and decides what is new: whatever came after the bell was last opened.

import { GAME_DURATION_HOURS } from '../lib/constants.js';
import { dayDiff, firstName, formatGameTime, formatTime } from '../lib/format.js';
import { centsLabel, giveBackOf, giveBackShort, shareRequestOf } from './booking.js';

const HOUR = 3_600_000;
const SOON_MS = 24 * HOUR;
const NEW_GAME_MS = 7 * 24 * HOUR;
const SOLD_MS = 7 * 24 * HOUR;
const SPLIT_PAID_MS = 7 * 24 * HOUR;
const ANSWERED_MS = 7 * 24 * HOUR;
const MAX_NEW_GAMES = 5;
export const MAX_NOTIFICATIONS = 30;

const norm = (s) => String(s || '').trim().toLocaleLowerCase('fi');
const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const titleOf = (game) => game?.title || { kaksinpeli: 'Kaksinpeli', nelinpeli: 'Nelinpeli', pallottelu: 'Pallottelu' }[game?.matchType] || 'Tennis';
const placeOf = (game) => [game?.locationName && game.locationName !== 'Avoin' ? game.locationName : '', game?.city].filter(Boolean).join(', ');
const join = (...parts) => parts.filter(Boolean).join(' · ');

/** 'tänään klo 18' | 'huomenna klo 9.30' (the soon-reminder's title; it is always within 24 h). */
function startsText(iso, now) {
  const d = new Date(iso);
  return `${dayDiff(iso, new Date(now)) === 0 ? 'tänään' : 'huomenna'} klo ${d.getMinutes() === 0 ? d.getHours() : formatTime(iso)}`;
}

function messagePreview(last) {
  if (!last) return '';
  if (last.kind === 'thumbs') return '👍';
  if (last.kind === 'image') return 'Kuva';
  return last.text || '';
}

/** "6–4 3–6 6–3": my games first. */
function scoreText(sets) {
  return (sets || []).map((s) => `${s.my}–${s.opp}`).join(' ');
}

/**
 * buildNotifications({ invites, requests, conversations, outcomes, upcoming, open, areas, bookings, toConfirm, results, uid, now })
 *   invites: GameInvite[]   requests: PlayRequest[]   conversations: Conversation[]
 *   outcomes: Game[] (pendingOutcomes)   upcoming: Game[] (listMine().upcoming)   open: Game[] (listOpen)
 *   areas: string[] my cities   bookings: Booking[] (booking.listMine, upcoming and past)
 *   (booking.listMine().past)   toConfirm: MatchResult[] (results.listToConfirm)   results: MatchResult[] (results.listMine)
 *   uid: my id
 * -> [{ id, kind, at, title, body, person, game?, to? }]  newest first, at most MAX_NOTIFICATIONS
 */
export function buildNotifications({
  invites = [], requests = [], conversations = [], outcomes = [], upcoming = [], open = [], areas = [], bookings = [],
  toConfirm = [], results = [], uid = null, now = Date.now(),
} = {}) {
  const items = [];
  const cities = new Set(areas.map(norm).filter(Boolean));

  for (const r of toConfirm) {
    items.push({
      id: `resultConfirm:${r.id}`, kind: 'resultConfirm', at: ms(r.createdAt) || now, person: r.loggedBy || null, result: r,
      title: `${firstName(r.loggedBy?.name)} kirjasi tuloksen kanssasi`,
      body: join(scoreText(r.sets), 'vahvista tai kerro, ettei pidä paikkaansa'),
    });
  }

  for (const r of results) {
    if (!r.isMine || !r.answeredAt || !['confirmed', 'disputed'].includes(r.confirmation) || now - ms(r.answeredAt) > ANSWERED_MS) continue;
    const who = firstName(r.answeredBy?.name || r.opponentName);
    const disputed = r.confirmation === 'disputed';
    items.push({
      id: `resultAnswered:${r.id}:${r.answeredAt}`, kind: 'resultAnswered', at: ms(r.answeredAt), person: r.answeredBy || null, to: '/pelaa/profiili',
      title: disputed ? `${who}: tulos ei pidä paikkaansa` : `${who} vahvisti tuloksen`,
      body: join(scoreText(r.sets), disputed ? 'korjaa tulos profiilissasi' : ''),
    });
  }

  for (const b of bookings) {
    for (const l of b.split?.lines || []) {
      if (l.kind !== 'friend' || l.status !== 'paid' || !l.paidAt || now - ms(l.paidAt) > SPLIT_PAID_MS) continue;
      const who = l.person ? firstName(l.person.name) : l.name || 'Kaveri';
      items.push({
        id: `splitPaid:${l.id}`, kind: 'splitPaid', at: ms(l.paidAt), person: l.person || null, to: '/pelaa/omat-varaukset',
        title: `${who} maksoi osuutensa ${centsLabel(l.cents)}`,
        body: join('Summa palautetaan sinulle', formatGameTime(b.startsAt, new Date(now)), b.courtName),
      });
    }
  }

  for (const b of bookings) {
    if (!b.soldAt || now - ms(b.soldAt) > SOLD_MS) continue;
    const back = giveBackShort(giveBackOf(b));
    items.push({
      id: `sold:${b.id}`, kind: 'sold', at: ms(b.soldAt), person: null, to: '/pelaa/varaa',
      title: 'Vuorosi myytiin',
      body: join(back, formatGameTime(b.startsAt, new Date(now)), b.courtName),
    });
  }

  for (const inv of invites) {
    const g = inv.game;
    if (!g) continue;
    items.push({
      id: `invite:${inv.id}`, kind: 'invite', at: ms(g.createdAt) || now, person: g.creator, game: g,
      title: `${firstName(g.creator?.name)} kutsui sinut peliin`,
      body: join(titleOf(g), formatGameTime(g.scheduledAt, new Date(now))),
    });
  }

  for (const r of requests) {
    items.push({
      id: `request:${r.id}`, kind: 'request', at: ms(r.createdAt) || now, person: r.from, to: '/pelaa/viestit',
      title: `${firstName(r.from?.name)} pyytää pelaamaan`,
      body: r.message ? `“${r.message}”` : '',
    });
  }

  for (const c of conversations) {
    const last = c.lastMessage;
    if (!c.unread || !last || (uid && last.senderId === uid)) continue;
    const sender = (c.participants || []).find((p) => p.id === last.senderId) || c.participants?.[0] || null;
    const link = last.kind === 'text' ? shareRequestOf(last.text) : null;
    if (link) {
      // A court's payment link: straight to paying my part.
      items.push({
        id: `share:${link.token}`, kind: 'share', at: ms(last.createdAt) || now, person: sender, to: `/pelaa/maksa/${link.token}`,
        title: `${firstName(sender?.name || c.title)} pyytää osuuttasi kenttävuorosta`,
        body: link.text,
      });
      continue;
    }
    items.push({
      id: `message:${c.id}:${last.createdAt}`, kind: 'message', at: ms(last.createdAt) || ms(c.updatedAt) || now,
      person: sender, to: `/pelaa/viestit/${c.id}`,
      title: c.isGroup ? `Uusi viesti: ${c.title}` : `${firstName(c.title)} lähetti viestin`,
      body: c.isGroup && sender ? `${firstName(sender.name)}: ${messagePreview(last)}` : messagePreview(last),
    });
  }

  for (const g of outcomes) {
    const end = Number.isFinite(ms(g.scheduledAt)) ? ms(g.scheduledAt) + GAME_DURATION_HOURS * HOUR : ms(g.expiresAt);
    items.push({
      id: `outcome:${g.id}`, kind: 'outcome', at: Number.isFinite(end) ? Math.min(end, now) : now, person: null, game: g,
      title: `Pelasitteko? ${titleOf(g)}`,
      body: join(formatGameTime(g.scheduledAt, new Date(now)), 'vastaa, niin putkesi pysyy ajan tasalla'),
    });
  }

  for (const g of upcoming) {
    const start = ms(g.scheduledAt);
    if (!Number.isFinite(start) || g.status === 'cancelled' || start <= now || start - now > SOON_MS) continue;
    items.push({
      id: `soon:${g.id}`, kind: 'soon', at: Math.max(start - SOON_MS, ms(g.createdAt) || 0), person: null, game: g,
      title: `Peli ${startsText(g.scheduledAt, now)}`,
      body: join(titleOf(g), placeOf(g)),
    });
  }

  const fresh = open
    .filter((g) => !g.isMine && !g.iJoined && g.status === 'open' && cities.has(norm(g.city)))
    .filter((g) => now - ms(g.createdAt) < NEW_GAME_MS && !(ms(g.scheduledAt) < now))
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .slice(0, MAX_NEW_GAMES);
  for (const g of fresh) {
    items.push({
      id: `game:${g.id}`, kind: 'newGame', at: ms(g.createdAt), person: g.creator, game: g,
      title: `${firstName(g.creator?.name)} avasi pelin`,
      body: join(titleOf(g), g.scheduledAt ? formatGameTime(g.scheduledAt, new Date(now)) : 'aika sovitaan', g.city),
    });
  }

  // An invite to a game also listed as new is the same news once.
  const invited = new Set(items.filter((i) => i.kind === 'invite').map((i) => i.game.id));
  return items
    .filter((i) => !(i.kind === 'newGame' && invited.has(i.game.id)))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_NOTIFICATIONS);
}

/** How many of the items came after the bell was last opened (`seenAt`, ms; 0 = never). */
export function countNew(items, seenAt = 0) {
  return items.filter((i) => i.at > seenAt).length;
}
