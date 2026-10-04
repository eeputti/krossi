// playerInfo.js — small pure helpers the players area (and the shared PlayerCard) use to turn
// a Profile / PersonLite into display text. No React here.
import { AGE_RANGES, AVAILABILITY_SLOTS, PLAY_STYLES, SKILL_LEVELS, labelOf } from '../../lib/constants.js';

/** True while "Pelaan nyt" is active. */
export function isPlayingNow(p, now = Date.now()) {
  return Boolean(p?.playingNowUntil && Date.parse(p.playingNowUntil) > now);
}

/** Avatar status: 'now' | 'week' | null */
export function playerStatus(p, now = Date.now()) {
  if (isPlayingNow(p, now)) return 'now';
  if (p?.playingThisWeek) return 'week';
  return null;
}

/** '30–40 v' | 'alle 20 v' | '34 v' (legacy plain number) | '' */
export function ageText(ageRange) {
  if (!ageRange) return '';
  if (ageRange === 'alle20') return 'alle 20 v';
  const known = AGE_RANGES.find((a) => a.value === ageRange);
  return `${known ? known.label : ageRange} v`;
}

/** 1..4 for the level bars, 0 when unknown. */
export function levelRank(level) {
  return SKILL_LEVELS.findIndex((s) => s.value === level) + 1;
}

/** 'Keskitaso' | 'Kilpapelaaja · C1, C2' (short: 'Kilpa · C1/C2') */
export function levelText(p, { short = false } = {}) {
  const lvl = SKILL_LEVELS.find((s) => s.value === p?.skillLevel);
  if (!lvl) return '';
  const classes = p?.competitionClasses || [];
  if (lvl.value === 'kilpapelaaja' && classes.length) {
    return short ? `Kilpa · ${classes.join('/')}` : `${lvl.label} · ${classes.join(', ')}`;
  }
  return short ? lvl.short : lvl.label;
}

export const styleLabel = (v) => labelOf(PLAY_STYLES, v);

/** 'Arki-illat, viikonloppuaamut' (+N) for the card hint line. */
export function availabilityHint(slots = [], max = 2) {
  if (!slots?.length) return '';
  const labels = slots.map((s) => labelOf(AVAILABILITY_SLOTS, s));
  const shown = labels.slice(0, max).map((l, i) => (i === 0 ? l : l.toLowerCase())).join(', ');
  return labels.length > max ? `${shown} +${labels.length - max}` : shown;
}

/** Slots with their times, in the canonical order. */
export function availabilityDetails(slots = []) {
  return AVAILABILITY_SLOTS.filter((s) => slots.includes(s.value));
}

/** 'vielä 1 t 25 min' | 'vielä 12 min' | '' */
export function timeLeft(until, now = Date.now()) {
  const mins = Math.ceil((Date.parse(until) - now) / 60_000);
  if (!(mins > 0)) return '';
  if (mins < 60) return `vielä ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `vielä ${h} t ${m} min` : `vielä ${h} t`;
}

const INESSIVE = {
  Lahti: 'Lahdessa', Turku: 'Turussa', Helsinki: 'Helsingissä', Tampere: 'Tampereella', Oulu: 'Oulussa',
  Jyväskylä: 'Jyväskylässä', Pori: 'Porissa', Kuopio: 'Kuopiossa', Rovaniemi: 'Rovaniemellä', Mikkeli: 'Mikkelissä',
  Espoo: 'Espoossa', Vantaa: 'Vantaalla', Joensuu: 'Joensuussa', Vaasa: 'Vaasassa', Kotka: 'Kotkassa',
  Hämeenlinna: 'Hämeenlinnassa', Seinäjoki: 'Seinäjoella', Lappeenranta: 'Lappeenrannassa', Porvoo: 'Porvoossa',
};

/** 'Lahdessa' — falls back to 'Kaupungissa X' for cities we don't know how to inflect. */
export function cityIn(city, { midSentence = false } = {}) {
  const word = !city ? 'Alueellasi' : INESSIVE[city] || `Kaupungissa ${city}`;
  return midSentence && !INESSIVE[city] ? word[0].toLowerCase() + word.slice(1) : word;
}

/** Case- and accent-insensitive name match for the search box. */
export function normalize(s) {
  return String(s || '').toLocaleLowerCase('fi').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/** Realistic fake players for the paywall teaser (never real users). */
export function lockedPreviewPlayers(now = Date.now()) {
  const base = { avatarUrl: null, competitionClasses: [], gender: null, areas: [], bio: null, playingNowUntil: null, playingThisWeek: false };
  return [
    { ...base, id: 'lock-1', name: 'Aleksi', ageRange: '30-40', skillLevel: 'keskitaso', playStyles: ['pallottelu', 'nelinpeli'], availability: ['arki-illat', 'viikonloppuaamut'], avatarColor: 'blue', playingNowUntil: new Date(now + 80 * 60_000).toISOString(), playingNowNote: 'Kenttä varattu klo 18, tule mukaan!' },
    { ...base, id: 'lock-2', name: 'Emilia', ageRange: '20-30', skillLevel: 'edistynyt', playStyles: ['matsit', 'kaksinpeli'], availability: ['arki-iltapäivät'], avatarColor: 'red', playingThisWeek: true },
    { ...base, id: 'lock-3', name: 'Sofia', ageRange: '20-30', skillLevel: 'kilpapelaaja', competitionClasses: ['B2'], playStyles: ['matsit', 'treenit'], availability: ['aamuvirkku', 'viikonloppuaamut'], avatarColor: 'yellow', playingThisWeek: true },
    { ...base, id: 'lock-4', name: 'Joonas', ageRange: '40-50', skillLevel: 'aloittelija', playStyles: ['pallottelu'], availability: ['viikonloppupäivät'], avatarColor: 'green' },
    { ...base, id: 'lock-5', name: 'Miika', ageRange: '30-40', skillLevel: 'keskitaso', playStyles: ['kaikki käy'], availability: ['joustavasti'], avatarColor: 'blue' },
  ];
}
