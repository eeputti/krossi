// profileCompleteness.js — how ready a profile is, for the small "Profiili 50 % valmis" strip on
// Profiili and on Muokkaa profiilia. Six parts per role, all worth the same. The name is not one
// of them (it is required anyway); a player's age and tennis history are left out on purpose:
// both are voluntary and nobody should be nudged into giving them.
// Once a profile has reached 100 % the account remembers it (PROFILE_DONE_KEY in the auth user's
// metadata) and the strip never comes back, even if something is cleared later.

export const PROFILE_DONE_KEY = 'koutsi_profile_done_at';

const filled = (v) => (Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== '');

// id = where Muokkaa profiilia scrolls to (data-kohta), label = the word in "puuttuu …"
const COACH_PARTS = [
  { id: 'kuva', label: 'kuva', has: (p) => filled(p.avatarUrl) },
  { id: 'kuvaus', label: 'kuvaus', has: (p) => filled(p.bio) },
  { id: 'esittely', label: 'esittelyrivi', has: (p) => filled(p.tagline) },
  { id: 'kokemus', label: 'kokemus', has: (p) => filled(p.experience) },
  { id: 'erikoisalat', label: 'erikoisalat', has: (p) => filled(p.specialties) },
  { id: 'kaupunki', label: 'kotikaupunki', has: (p) => filled(p.area) },
];

const PLAYER_PARTS = [
  { id: 'kuva', label: 'kuva', has: (p) => filled(p.avatarUrl) },
  { id: 'esittely', label: 'esittely', has: (p) => filled(p.bio) },
  { id: 'pelikasi', label: 'pelikäsi', has: (p) => filled(p.playsHand), tennis: true },
  { id: 'lempilyonti', label: 'lempilyönti', has: (p) => filled(p.favouriteShot), tennis: true },
  { id: 'aloitusvuosi', label: 'aloitusvuosi', has: (p) => filled(p.playingSince), tennis: true },
  { id: 'kaupunki', label: 'kotikaupunki', has: (p) => filled(p.area) },
];

/**
 * profileProgress(role, person, { tennis }) → { pct, done, total, missing: [{ id, label }] }
 *   role: 'coach' | 'player'   person: the profile's fields (a form's values work too)
 *   tennis: false leaves the player's tennis card out (before its migration)
 */
export function profileProgress(role, person, { tennis = true } = {}) {
  const parts = (role === 'coach' ? COACH_PARTS : PLAYER_PARTS).filter((p) => tennis || !p.tennis);
  const p = person || {};
  const missing = parts.filter((part) => !part.has(p)).map(({ id, label }) => ({ id, label }));
  const done = parts.length - missing.length;
  return { pct: Math.round((done / parts.length) * 100), done, total: parts.length, missing };
}

/** "a", "a ja b", "a, b ja c" */
export function finnishList(words) {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} ja ${words[words.length - 1]}`;
}

/**
 * What is missing, in a few words: up to `max` names, then "ja N muuta".
 *   ['kuva', 'kuvaus', 'kokemus'], 3 → "kuva, kuvaus ja kokemus"
 *   ['kuva', 'kuvaus', 'kokemus'], 1 → "kuva ja 2 muuta"
 */
export function missingText(missing, max = 3) {
  const words = missing.map((m) => m.label);
  const shown = words.slice(0, Math.max(1, max - 1));
  const rest = words.length - shown.length;
  // "ja 1 muuta" reads oddly: one more word is shorter than that anyway
  if (words.length <= max || rest <= 1) return finnishList(words);
  return `${shown.join(', ')} ja ${rest} muuta`;
}

/** "50 % valmis" with a no-break space, as Finnish writes it. */
export const pctText = (pct) => `${pct} % valmis`;
