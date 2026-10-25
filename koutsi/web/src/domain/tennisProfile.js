// tennisProfile.js — the player's tennis profile (migration 20261025194643): playing hand,
// favourite shot, the year they started, and a few words of their tennis history. The values are
// the database's check-constraint values; the labels use the drill bank's words (kämmen, rysty).

export const PLAYS_HAND = [
  { value: 'oikea', label: 'Oikea', fact: 'Oikeakätinen' },
  { value: 'vasen', label: 'Vasen', fact: 'Vasenkätinen' },
];

export const FAVOURITE_SHOTS = [
  { value: 'forehand', label: 'Kämmen' },
  { value: 'rysty', label: 'Rysty' },
  { value: 'syotto', label: 'Syöttö' },
  { value: 'palautus', label: 'Palautus' },
  { value: 'lentolyonti', label: 'Lentolyönti' },
  { value: 'smash', label: 'Smash' },
  { value: 'pudotus', label: 'Pudotus' },
  { value: 'lobbi', label: 'Lobbi' },
];

export const TENNIS_STORY_MAX = 300;
export const FIRST_YEAR = 1930;

/** '2012' → 2012; '' → null; anything else (or a future year) → NaN, which the form shows as an error. */
export function parseStartYear(text, now = new Date()) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const y = Number(t);
  return Number.isInteger(y) && y >= FIRST_YEAR && y <= now.getFullYear() ? y : NaN;
}

/** Short facts for a profile line or chips: "Vasenkätinen", "Lempilyönti rysty", "Pelannut vuodesta 2012". */
export function tennisFacts(student) {
  if (!student) return [];
  const hand = PLAYS_HAND.find((h) => h.value === student.playsHand);
  const shot = FAVOURITE_SHOTS.find((s) => s.value === student.favouriteShot);
  return [
    hand?.fact,
    shot ? `Lempilyönti ${shot.label.toLowerCase()}` : null,
    student.playingSince ? `Pelannut vuodesta ${student.playingSince}` : null,
  ].filter(Boolean);
}
