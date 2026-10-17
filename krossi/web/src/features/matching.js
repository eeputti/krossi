// matching.js — kuinka hyvin toinen pelaaja sopii minulle pelikaveriksi ("sopivuus").
//
// Pure functions only, like gamification.js: no I/O and no clock — `now` comes in. The score is a
// weighted sum of plain profile facts, so it works from the first three players in a city (there
// is nothing to learn from yet) and every point it gives can be said back to the player as a
// reason ("Sama taso · ehditte arki-iltaisin").
//
// Factors (weights sum to 100)
// - level    40  same level 1, one step apart 0.5, further 0. Two competition players compare
//                classes instead: a shared class 1, one letter apart (B ↔ C) 0.6, further 0.3.
// - time     30  any shared slot 0.6, rising to 1 when one's slots are all the other's too;
//                'joustavasti' on either side 0.8.
// - now      15  Pelaan nyt 1, plays this week 0.6.
// - style    10  a shared play style 1; 'kaikki käy' on either side 0.8.
// - partner   5  we have played together before.
// Missing data (no slots or styles on either side, an unknown level) counts as half, so an
// incomplete profile neither wins nor sinks. A player who joined in the last 30 days gets up to
// 5 points extra, fading out, so a newcomer is seen and gets a first game. The total is capped at
// 100. Ties keep the input order: the backends list the most recently active players first.

import { AVAILABILITY_SLOTS, SKILL_ORDER } from '../lib/constants.js';
import { plural } from '../lib/format.js';

const DAY_MS = 86_400_000;
const NEWCOMER_DAYS = 30;
const FLEX = 'joustavasti';
const ANY_STYLE = 'kaikki käy';

export const WEIGHTS = Object.freeze({ level: 40, time: 30, now: 15, style: 10, partner: 5, newcomer: 5 });

/** A score this high or more is worth suggesting on its own (Pelataanko? → Sopivat sinulle). */
export const SUGGEST_MIN = 55;

const SLOT_ORDER = AVAILABILITY_SLOTS.map((s) => s.value);

// "Ehditte arki-iltaisin": when, as an adverb.
const SLOT_WHEN = {
  aamuvirkku: 'aikaisin aamulla',
  arkiaamut: 'arkiaamuisin',
  arkipäivät: 'arkipäivisin',
  'arki-iltapäivät': 'arki-iltapäivisin',
  'arki-illat': 'arki-iltaisin',
  viikonloppuaamut: 'viikonloppuaamuisin',
  viikonloppupäivät: 'viikonloppupäivisin',
  viikonloppuiltapäivät: 'viikonloppuiltapäivisin',
  viikonloppuillat: 'viikonloppuiltaisin',
};

// "Tykkää myös matseista": the style, in the elative.
const STYLE_FROM = {
  pallottelu: 'pallottelusta',
  treenit: 'treeneistä',
  matsit: 'matseista',
  kaksinpeli: 'kaksinpeleistä',
  nelinpeli: 'nelinpeleistä',
};

const isPlayingNow = (p, now) => Boolean(p?.playingNowUntil && Date.parse(p.playingNowUntil) > now);

function levelFit(me, other) {
  const a = SKILL_ORDER.indexOf(me?.skillLevel);
  const b = SKILL_ORDER.indexOf(other?.skillLevel);
  if (a < 0 || b < 0) return { fit: 0.5 };
  const mine = me.competitionClasses || [];
  const theirs = other.competitionClasses || [];
  if (me.skillLevel === 'kilpapelaaja' && other.skillLevel === 'kilpapelaaja' && mine.length && theirs.length) {
    if (mine.some((c) => theirs.includes(c))) return { fit: 1, reason: 'Sama kilpailuluokka' };
    // A1–E3: the letter is the class, the digit a step inside it.
    const letters = (cs) => cs.map((c) => c.charCodeAt(0));
    const gap = Math.min(...letters(mine).flatMap((x) => letters(theirs).map((y) => Math.abs(x - y))));
    return gap <= 1 ? { fit: 0.6, reason: 'Lähes sama luokka' } : { fit: 0.3 };
  }
  const gap = Math.abs(a - b);
  if (gap === 0) return { fit: 1, reason: 'Sama taso' };
  if (gap === 1) return { fit: 0.5, reason: 'Lähes sama taso' };
  return { fit: 0 };
}

function timeFit(me, other) {
  const mine = me?.availability || [];
  const theirs = other?.availability || [];
  if (!mine.length || !theirs.length) return { fit: 0.5 };
  if (theirs.includes(FLEX)) return { fit: 0.8, reason: 'Joustava aikataulu' };
  if (mine.includes(FLEX)) return { fit: 0.8 };
  const shared = SLOT_ORDER.filter((s) => mine.includes(s) && theirs.includes(s));
  if (!shared.length) return { fit: 0 };
  const fit = 0.6 + 0.4 * (shared.length / Math.min(mine.length, theirs.length));
  return { fit, reason: `Ehditte ${SLOT_WHEN[shared[0]]}` };
}

function nowFit(other, now) {
  if (isPlayingNow(other, now)) return { fit: 1 };
  return { fit: other?.playingThisWeek ? 0.6 : 0 };
}

function styleFit(me, other) {
  const mine = me?.playStyles || [];
  const theirs = other?.playStyles || [];
  if (!mine.length || !theirs.length) return { fit: 0.5 };
  const shared = mine.filter((s) => s !== ANY_STYLE && theirs.includes(s));
  if (shared.length) return { fit: 1, reason: `Tykkää myös ${STYLE_FROM[shared[0]] || shared[0]}` };
  if (mine.includes(ANY_STYLE) || theirs.includes(ANY_STYLE)) return { fit: 0.8 };
  return { fit: 0 };
}

function partnerFit(other, partners) {
  const n = partners?.get(other?.id) || 0;
  if (!n) return { fit: 0 };
  return { fit: 1, reason: plural(n, 'yhteinen peli', 'yhteistä peliä') };
}

function newcomerFit(other, now) {
  const joined = Date.parse(other?.createdAt || '');
  const days = (now - joined) / DAY_MS;
  if (!(days >= 0 && days < NEWCOMER_DAYS)) return { fit: 0 };
  return { fit: 1 - days / NEWCOMER_DAYS, reason: 'Uusi Krossissa' };
}

/** Partner[] (api.players.listPartners) or a ready Map → Map<id, gamesTogether>. */
function partnerMap(partners) {
  if (partners instanceof Map) return partners;
  return new Map((partners || []).map((p) => [p.player?.id, p.gamesTogether || 0]));
}

/**
 * @typedef {{ key: 'level'|'time'|'partner'|'style'|'newcomer', text: string }} Reason
 */

/**
 * How well `other` fits me as somebody to play with.
 * Reasons come in the order a player reads them best: level, time, games together, style, newcomer.
 * @returns {{ score: number, reasons: Reason[], fit: Record<keyof WEIGHTS, number> }}   score 0–100 (rounded), fit 0–1 per factor
 */
export function matchScore(me, other, { now = Date.now(), partners } = {}) {
  const map = partnerMap(partners);
  const parts = [
    ['level', levelFit(me, other)],
    ['time', timeFit(me, other)],
    ['partner', partnerFit(other, map)],
    ['style', styleFit(me, other)],
    ['newcomer', newcomerFit(other, now)],
    ['now', nowFit(other, now)],
  ];
  const raw = parts.reduce((sum, [key, { fit }]) => sum + WEIGHTS[key] * fit, 0);
  return {
    score: Math.round(Math.min(100, raw)),
    reasons: parts.filter(([, p]) => p.reason).map(([key, p]) => ({ key, text: p.reason })),
    fit: Object.fromEntries(parts.map(([key, { fit }]) => [key, fit])),
  };
}

/**
 * Players with their score, best fit first; ties keep the input order.
 * @returns {{ player: Object, score: number, reasons: string[] }[]}
 */
export function rankPlayers(me, players, { now = Date.now(), partners } = {}) {
  const map = partnerMap(partners);
  return (players || [])
    .map((player, i) => ({ player, i, ...matchScore(me, player, { now, partners: map }) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ i, ...rest }) => rest);
}

/**
 * The few players worth suggesting by name: a high score, and never somebody two levels away or
 * with no time in common, however active they are.
 */
export function suggestPlayers(me, players, { now = Date.now(), partners, max = 3 } = {}) {
  return rankPlayers(me, players, { now, partners })
    .filter((r) => r.score >= SUGGEST_MIN && r.fit.level >= 0.5 && r.fit.time > 0)
    .slice(0, max);
}

/**
 * ['Sama taso', 'ehditte arki-iltaisin'] — the first `max` reason texts, ready to read in a row.
 * `skip` leaves out what the screen already shows next to them (the level, beside a name that has
 * its level printed).
 */
export function reasonTexts(reasons, { max = 2, skip = [] } = {}) {
  return (reasons || [])
    .filter((r) => !skip.includes(r.key))
    .slice(0, max)
    .map(({ text }, i) => (i === 0 ? text[0].toLocaleUpperCase('fi') + text.slice(1) : text[0].toLocaleLowerCase('fi') + text.slice(1)));
}

/** 'Sama taso · ehditte arki-iltaisin' */
export function reasonLine(reasons, options) {
  return reasonTexts(reasons, options).join(' · ');
}
