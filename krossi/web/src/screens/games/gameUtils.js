// gameUtils.js — pure helpers shared by the games screens and GameCard (labels, prices,
// countdowns, day grouping, filters, share text). No React, no api.
import {
  COURT_SURFACES, GAME_DURATION_HOURS, LOCATION_TYPES, MATCH_TYPES, SKILL_LEVELS, SKILL_ORDER, labelOf,
} from '../../lib/constants.js';
import { dayDiff, formatDayMonth, formatEuro, formatTime, WEEKDAYS_SHORT } from '../../lib/format.js';

export const matchLabel = (type) => labelOf(MATCH_TYPES, type) || 'Tennis';
export const matchDesc = (type) => MATCH_TYPES.find((m) => m.value === type)?.desc || '';
export const gameTitle = (game) => game?.title || matchLabel(game?.matchType);
// Mobile-created games may list several surfaces: 'kova,massa' -> 'Kova / Massa'.
export const surfaceList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
export const surfaceLabel = (v) => surfaceList(v).map((s) => labelOf(COURT_SURFACES, s)).join(' / ');
export const levelLabel = (v) => labelOf(SKILL_LEVELS, v);
const isCompetitionClass = (v) => /^[A-E][1-3]$/.test(v || '');
/** Chip text: 'keskitaso' | 'B2' (competition classes keep their case). */
export const levelShort = (v) => (isCompetitionClass(v) ? v : levelLabel(v).toLowerCase());
/** Position on the level ladder; a competition class counts as kilpapelaaja. */
const levelRank = (v) => (isCompetitionClass(v) ? SKILL_ORDER.indexOf('kilpapelaaja') : SKILL_ORDER.indexOf(v));

/** 'Kispi Areena' — or null when the place is still open ('Avoin' / empty). */
export function venueName(game) {
  const name = String(game?.locationName || '').trim();
  return name && name.toLowerCase() !== 'avoin' ? name : null;
}

/** 'Kispi Areena, Lahti' | 'Lahti' | 'Paikka sovitaan' */
export function placeLine(game) {
  const venue = venueName(game);
  if (venue && game.city && !venue.includes(game.city)) return `${venue}, ${game.city}`;
  return venue || (game?.city ? `${game.city} · paikka sovitaan` : 'Paikka sovitaan');
}

/** 'Sisällä' | 'Ulkona' | null ('missä vain' says nothing useful on a card). */
export function locationShort(type) {
  if (type === 'missä vain') return null;
  return labelOf(LOCATION_TYPES, type) || null;
}

/** Total players incl. the creator. */
export const totalPlayers = (game) => (game?.capacity ?? 1) + 1;
export const playersIn = (game) => 1 + (game?.participants?.length || 0);

/** '18' for full hours, otherwise '18.30' — used in running text ("klo 18"). */
export function shortTime(iso) {
  const d = new Date(iso);
  return d.getMinutes() === 0 ? String(d.getHours()) : formatTime(iso);
}

/** 'tänään' | 'huomenna' | 'ylihuomenna' | 'la 4.10.' (lower-case, for running text). */
export function dayWord(iso, now = new Date()) {
  const diff = dayDiff(iso, now);
  if (diff === 0) return 'tänään';
  if (diff === 1) return 'huomenna';
  if (diff === 2) return 'ylihuomenna';
  return `${WEEKDAYS_SHORT[new Date(iso).getDay()]} ${formatDayMonth(iso)}`;
}

/** 'huomenna klo 18' | 'aika sovitaan' */
export function whenText(iso, now = new Date()) {
  return iso ? `${dayWord(iso, now)} klo ${shortTime(iso)}` : 'aika sovitaan';
}

const MIN = 60_000;
export function isOver(game, now = Date.now()) {
  if (!game?.scheduledAt) return game?.expiresAt ? Date.parse(game.expiresAt) < now : false;
  return Date.parse(game.scheduledAt) + GAME_DURATION_HOURS * 60 * MIN < now;
}

/** Hero countdown: 'Alkaa huomenna klo 18' | 'Alkaa 25 min päästä' | 'Käynnissä nyt' | 'Aika sovitaan' */
export function countdownLabel(iso, now = Date.now()) {
  if (!iso) return 'Aika sovitaan';
  const start = Date.parse(iso);
  const mins = Math.round((start - now) / MIN);
  if (mins <= 0) return start + GAME_DURATION_HOURS * 60 * MIN > now ? 'Käynnissä nyt' : 'Peli on päättynyt';
  if (mins < 60) return `Alkaa ${mins} min päästä`;
  return `Alkaa ${whenText(iso, new Date(now))}`;
}

/** Relative countdown for the game page: 'Alkaa 3 t 20 min päästä' | 'Alkaa 4 päivän päästä'. */
export function countdownRelative(iso, now = Date.now()) {
  if (!iso) return null;
  const start = Date.parse(iso);
  const mins = Math.round((start - now) / MIN);
  if (mins <= 0) return start + GAME_DURATION_HOURS * 60 * MIN > now ? 'Käynnissä nyt' : 'Peli on päättynyt';
  if (mins < 60) return `Alkaa ${mins} min päästä`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `Alkaa ${h} t${m ? ` ${m} min` : ''} päästä`;
  }
  const days = dayDiff(iso, new Date(now));
  return days === 1 ? 'Alkaa huomenna' : `Alkaa ${days} päivän päästä`;
}

/** '1 paikka vapaana' | '3 paikkaa vapaana' | 'Täynnä' */
export function spotsLabel(game) {
  const n = game?.spotsLeft ?? 0;
  if (game?.status === 'filled' || n <= 0) return 'Täynnä';
  return n === 1 ? '1 paikka vapaana' : `${n} paikkaa vapaana`;
}
export const isFull = (game) => game?.status === 'filled' || (game?.spotsLeft ?? 0) <= 0;

/** Price one player pays: number | 0 (creator covers) | null (not given). */
export function pricePerPlayer(game) {
  const price = Number(game?.courtPrice);
  if (!price) return game?.creatorCoversFull ? 0 : null;
  if (game.kind === 'event') return price;
  if (game.creatorCoversFull) return 0;
  return Math.round((price / totalPlayers(game)) * 2) / 2;
}

/** '7 € / pelaaja' | 'Järjestäjä tarjoaa' | 'Maksuton' | null */
export function priceLabel(game) {
  const per = pricePerPlayer(game);
  if (game?.kind === 'event') return per ? `${formatEuro(per)} / hlö` : 'Maksuton';
  if (per === 0) return 'Järjestäjä tarjoaa';
  if (per == null) return null;
  return `${formatEuro(per)} / pelaaja`;
}

/** Day sections for the open-games list: [{ key, label, games }] with 'Aika sovitaan' last. */
export function groupByDay(games, now = new Date()) {
  const sections = new Map();
  for (const g of games) {
    let key = 'open';
    let label = 'Aika sovitaan';
    if (g.scheduledAt) {
      const diff = dayDiff(g.scheduledAt, now);
      key = `d${diff}`;
      label = diff <= 0 ? 'Tänään' : diff === 1 ? 'Huomenna'
        : `${WEEKDAYS_SHORT[new Date(g.scheduledAt).getDay()]} ${formatDayMonth(g.scheduledAt)}`;
    }
    if (!sections.has(key)) sections.set(key, { key, label, games: [] });
    sections.get(key).games.push(g);
  }
  const list = [...sections.values()];
  const open = list.filter((s) => s.key === 'open');
  return [...list.filter((s) => s.key !== 'open'), ...open];
}

// ── filters ──────────────────────────────────────────────────────────────────

export const EMPTY_FILTERS = Object.freeze({ city: '', matchTypes: [], locationTypes: [], surfaces: [], level: '' });

export function applyFilters(games, f) {
  const lvl = f?.level ? SKILL_ORDER.indexOf(f.level) : -1;
  return games.filter((g) => {
    if (f?.matchTypes?.length && !f.matchTypes.includes(g.matchType)) return false;
    if (f?.locationTypes?.length && g.locationType !== 'missä vain' && !f.locationTypes.includes(g.locationType)) return false;
    if (f?.surfaces?.length && !surfaceList(g.courtSurface).some((s) => f.surfaces.includes(s))) return false;
    if (lvl >= 0 && g.minSkillLevel && levelRank(g.minSkillLevel) > lvl) return false;
    return true;
  });
}

export function activeFilterCount(f, homeCity) {
  return (f?.matchTypes?.length ? 1 : 0) + (f?.locationTypes?.length ? 1 : 0) + (f?.surfaces?.length ? 1 : 0)
    + (f?.level ? 1 : 0) + (f?.city && f.city !== homeCity ? 1 : 0);
}

const INESSIVE = {
  Lahti: 'Lahdessa', Turku: 'Turussa', Helsinki: 'Helsingissä', Tampere: 'Tampereella', Oulu: 'Oulussa',
  Jyväskylä: 'Jyväskylässä', Pori: 'Porissa', Kuopio: 'Kuopiossa', Rovaniemi: 'Rovaniemellä', Mikkeli: 'Mikkelissä',
};
/** 'Lahdessa' — falls back to 'kaupungissa X'. */
export const inCity = (city) => INESSIVE[city] || (city ? `kaupungissa ${city}` : 'lähelläsi');

// ── links & sharing ──────────────────────────────────────────────────────────

export function mapsUrl(game) {
  const q = game?.lat != null && game?.lng != null
    ? `${game.lat},${game.lng}`
    : [venueName(game), game?.city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** 'Pelataanko? 🎾 Kaksinpeli huomenna klo 18, Kispi Areena' */
export function shareText(game, now = new Date()) {
  const where = venueName(game) || game?.city || '';
  return `Pelataanko? 🎾 ${gameTitle(game)} ${whenText(game?.scheduledAt, now)}${where ? `, ${where}` : ''}`;
}

// ── cross-screen refresh ─────────────────────────────────────────────────────

/** Fired after creating / joining / leaving / cancelling so lists underneath an overlay refresh. */
export const GAMES_CHANGED = 'krossi:games-changed';
export function notifyGamesChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(GAMES_CHANGED));
}
