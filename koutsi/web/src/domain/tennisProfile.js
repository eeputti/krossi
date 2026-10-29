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

// Before the first group there is no player row for the tennis card, so the card filled in while
// waiting stays on the account (auth user metadata, this key) and moves onto the row on joining.
export const TENNIS_DRAFT_KEY = 'koutsi_tennis_draft';

/** The tennis card as a clean draft: only known, non-empty values; null when nothing is set. */
export function tennisDraftOf(x) {
  if (!x || typeof x !== 'object') return null;
  const d = {};
  if (PLAYS_HAND.some((h) => h.value === x.playsHand)) d.playsHand = x.playsHand;
  if (FAVOURITE_SHOTS.some((s) => s.value === x.favouriteShot)) d.favouriteShot = x.favouriteShot;
  if (Number.isInteger(x.playingSince) && x.playingSince >= FIRST_YEAR) d.playingSince = x.playingSince;
  const story = String(x.tennisStory || '').trim().slice(0, TENNIS_STORY_MAX);
  if (story) d.tennisStory = story;
  return Object.keys(d).length ? d : null;
}

/** The row's card with the draft laid over it: what the player wrote while waiting wins, an empty draft field keeps the row's value. */
export function mergeTennisDraft(row, draft) {
  const d = tennisDraftOf(draft) || {};
  return {
    playsHand: d.playsHand || row?.playsHand || '',
    favouriteShot: d.favouriteShot || row?.favouriteShot || '',
    playingSince: d.playingSince ?? row?.playingSince ?? null,
    tennisStory: d.tennisStory || row?.tennisStory || '',
  };
}
