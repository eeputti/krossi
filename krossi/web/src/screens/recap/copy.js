// copy.js — Finnish wording for the recap slides and the share card. Pure functions.
import { MONTHS, capitalize } from '../../lib/format.js';

/** Case forms of a period: { name: 'Syyskuu 2026', genitive: 'syyskuun', inessive: 'syyskuussa', unit: 'kuukausi' } */
export function periodWords(period) {
  if (period.type === 'season') {
    return {
      name: `Kausi ${period.year}`,
      genitive: `kauden ${period.year}`,
      inessive: `kaudella ${period.year}`,
      unit: 'kausi',
      thisUnit: 'Tällä kaudella',
    };
  }
  const month = MONTHS[period.month - 1];
  return {
    name: `${capitalize(month)} ${period.year}`,
    genitive: `${month}n`,
    inessive: `${month}ssa`,
    unit: 'kuukausi',
    thisUnit: 'Tässä kuussa',
  };
}

/** 'elokuu 2026' -> 'elokuussa', 'Kausi 2025' -> 'kaudella 2025' (labels from recap.comparedToPrevious). */
export function previousInessive(label) {
  const text = String(label || '').trim();
  const season = /^kausi (\d{4})$/i.exec(text);
  if (season) return `kaudella ${season[1]}`;
  const month = text.split(/\s+/)[0]?.toLowerCase();
  return MONTHS.includes(month) ? `${month}ssa` : 'edellisellä kerralla';
}

export function gamesLine(n, season) {
  if (n >= (season ? 40 : 10)) return 'Kenttäkunto huipussaan!';
  if (n >= (season ? 15 : 5)) return 'Kenttä kutsui — ja sinä vastasit.';
  if (n >= 2) return 'Hyvää menoa, jatketaan!';
  return 'Siitä se lähtee!';
}

export function deltaText(compared) {
  if (!compared) return null;
  const where = previousInessive(compared.previousLabel);
  const d = compared.gamesDelta;
  if (d > 0) return { tone: 'up', text: `+${d} enemmän kuin ${where}` };
  if (d < 0) return { tone: 'down', text: `${-d} vähemmän kuin ${where}` };
  return { tone: 'same', text: `Sama tahti kuin ${where}` };
}

export function winsLine(recap) {
  if (recap.wins === 0) return 'Voitot tulee vielä — jatka samaan malliin.';
  if (recap.winRate >= 0.75) return 'Vastustajat tietää jo nimesi.';
  if (recap.winRate >= 0.5) return 'Plussalla — hyvä!';
  return 'Jokainen tappio opettaa jotain.';
}

export function streakLine(n) {
  if (n >= 4) return 'Rautaa! Rytmi pysyi koko ajan.';
  return 'Hyvä rytmi — jatketaan!';
}

export const TIME_ICON = { aamu: 'sunrise', päivä: 'sun', ilta: 'moon' };

/** Unit words without the number: unit.games(7) -> 'peliä'. */
const pick = (one, many) => (n) => (n === 1 ? one : many);
export const unit = {
  games: pick('peli', 'peliä'),
  wins: pick('voitto', 'voittoa'),
  losses: pick('häviö', 'häviötä'),
  weeks: pick('viikko', 'viikkoa'),
  visits: pick('käynti', 'käyntiä'),
  badges: pick('uusi merkki', 'uutta merkkiä'),
  partners: pick('uusi pelikaveri', 'uutta pelikaveria'),
};

export const percent = (rate) => `${Math.round((rate || 0) * 100)} %`;
