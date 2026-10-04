// profile.js (demo) — Alex's own profile, "pelaan nyt", roles and account deletion.
// Same validation and messages as api/supabase/profile.js and the send-playing-now-email
// edge function.

import { ApiError } from '../errors.js';
import { AGE_RANGES, COMPETITION_CLASSES, PLAY_STYLES, SKILL_ORDER, AVAILABILITY_SLOTS } from '../../lib/constants.js';
import { ME } from './rows.js';
import { run, leaveDemo, objectUrlFor } from './runtime.js';
import { db, me, profileOf, visiblePlayers } from './store.js';
import { toProfile } from './views.js';
import { schedulePlayingNowAnswer } from './actions.js';

const MIN = 60 * 1000;

// send-playing-now-email limits
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 360;
const DEFAULT_DURATION_MINUTES = 120;
const MAX_NOTE_LENGTH = 200;
const MIN_MINUTES_BETWEEN_BROADCASTS = 60;

const PLAY_STYLE_VALUES = new Set(PLAY_STYLES.map((s) => s.value));
const SLOT_VALUES = new Set(AVAILABILITY_SLOTS.map((s) => s.value));
const AGE_VALUES = new Set(AGE_RANGES.map((a) => a.value));

export async function getMine(uid) {
  return run(() => toProfile(profileOf(uid || ME)));
}

function validate(input) {
  if (!input?.name?.trim()) throw new ApiError('Kerro nimesi, niin muut tietävät kenen kanssa pelaavat.', { code: 'invalid' });
  if (!input.areas?.length) throw new ApiError('Valitse ainakin yksi kaupunki.', { code: 'invalid' });
}

/** Normalises the input the way the database round trip does (parseSkill, parsePlayStyles …). */
function applyInput(row, input) {
  const areas = [...new Set(input.areas.map((a) => String(a).trim()).filter(Boolean))];
  const skillLevel = SKILL_ORDER.includes(input.skillLevel) ? input.skillLevel : 'keskitaso';
  const styles = [...new Set((input.playStyles || []).filter((s) => PLAY_STYLE_VALUES.has(s)))];

  row.name = input.name.trim();
  row.ageRange = input.ageRange || null;
  if (row.ageRange && !AGE_VALUES.has(row.ageRange) && !/^\d+$/.test(row.ageRange)) row.ageRange = null;
  row.gender = input.gender === 'mies' || input.gender === 'nainen' ? input.gender : null;
  row.areas = areas;
  row.city = areas[0] || '';
  row.bio = input.bio?.trim() || null;
  row.skillLevel = skillLevel;
  row.competitionClasses = skillLevel === 'kilpapelaaja'
    ? [...new Set((input.competitionClasses || []).filter((c) => COMPETITION_CLASSES.includes(c)))]
      .sort((a, b) => COMPETITION_CLASSES.indexOf(a) - COMPETITION_CLASSES.indexOf(b))
    : [];
  row.playStyles = styles.length > 0 ? styles : ['kaikki käy'];
  row.availability = [...new Set((input.availability || []).filter((s) => SLOT_VALUES.has(s)))];
  row.handedness = input.handedness || null;
  row.backhand = input.backhand || null;
  row.hiddenFromFeed = Boolean(input.hiddenFromFeed);
  if (typeof input.playingThisWeek === 'boolean') row.playingThisWeek = input.playingThisWeek;
  if (input.avatarPath) row.avatarUrl = db.uploads.get(input.avatarPath) || row.avatarUrl;
}

export async function saveMine(uid, input) {
  return run(() => {
    validate(input);
    const row = profileOf(uid || ME);
    if (!row) throw new ApiError('Profiilin tallennus epäonnistui. Yritä uudelleen.');
    applyInput(row, input);
    return toProfile(row);
  });
}

// A neutral placeholder for environments without URL.createObjectURL (Node tests).
const PLACEHOLDER_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#155440"/>'
  + '<circle cx="40" cy="32" r="14" fill="#CFE414"/><rect x="18" y="52" width="44" height="20" rx="10" fill="#CFE414"/></svg>',
);

/** Nothing is uploaded: the picked file is shown from an object URL under a fake storage path. */
export async function uploadAvatar(uid, file) {
  return run(() => {
    // resizeImage() rejects non-images; production then shows this fallback message.
    if (!file || !/^image\//.test(file.type || 'image/')) throw new ApiError('Kuvaa ei voitu käsitellä.');
    const path = `${uid || ME}/${Date.now()}.jpg`;
    db.uploads.set(path, objectUrlFor(file, PLACEHOLDER_AVATAR));
    return path;
  });
}

export async function setPlayingThisWeek(uid, playing) {
  return run(() => {
    const row = profileOf(uid || ME);
    if (row) row.playingThisWeek = Boolean(playing);
  });
}

export async function startPlayingNow({ minutes, note } = {}) {
  return run(() => {
    const row = me();
    const now = Date.now();
    if (db.playingNowBroadcastAt) {
      const waitMs = MIN_MINUTES_BETWEEN_BROADCASTS * MIN - (now - db.playingNowBroadcastAt);
      if (waitMs > 0) throw new ApiError(`Voit lähettää uuden ilmoituksen ${Math.ceil(waitMs / MIN)} minuutin päästä.`);
    }
    const city = row.areas[0];
    if (!city) throw new ApiError('Lisää alue profiiliisi ennen ilmoituksen lähetystä.');

    const requested = Number(minutes);
    const duration = Number.isFinite(requested)
      ? Math.min(Math.max(requested, MIN_DURATION_MINUTES), MAX_DURATION_MINUTES)
      : DEFAULT_DURATION_MINUTES;
    row.playingNowUntil = new Date(now + duration * MIN).toISOString();
    row.playingNowNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, MAX_NOTE_LENGTH) : null;
    db.playingNowBroadcastAt = now;

    schedulePlayingNowAnswer();
    return { sent: visiblePlayers().filter((p) => p.areas.includes(city)).length };
  });
}

export async function stopPlayingNow(uid) {
  return run(() => {
    const row = profileOf(uid || ME);
    if (!row) return;
    row.playingNowUntil = null;
    row.playingNowNote = null;
  });
}

export async function recordAppOpen() {
  try {
    await run(() => undefined);
  } catch (err) {
    console.warn('Sovelluksen avauksen kirjaus epäonnistui', err);
  }
}

/** Alex is a regular, paid player — no admin rights in the demo. */
export async function isAdmin() {
  return run(() => false);
}

export async function myEventCities() {
  return run(() => []);
}

/** Nothing to delete in the demo: like a real deletion, it ends the session (leaves the demo). */
export async function deleteAccount() {
  await run(() => undefined);
  leaveDemo();
}

export async function getKoutsiAgeGroup() {
  return run(() => null);
}
