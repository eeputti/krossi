// profile.js — the signed-in user's own profile, "pelaan nyt", admin flags, account deletion.

import { db, currentUid, requireUid, invokeFunction, trackPixel } from './client.js';
import { PROFILE_COLUMNS, mapProfile, serializeSkill, avatarUrl } from './map.js';
import { ApiError, toApiError, unwrap } from '../errors.js';
import { resizeImage } from '../../lib/image.js';
import { CITIES } from '../../lib/constants.js';

export async function getMine(uid) {
  const id = uid || (await requireUid());
  const data = unwrap(
    await db().from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle(),
    'Profiilia ei voitu ladata.',
  );
  return mapProfile(data);
}

function validate(input) {
  if (!input?.name?.trim()) throw new ApiError('Kerro nimesi, niin muut tietävät kenen kanssa pelaavat.', { code: 'invalid' });
  if (!input.areas?.length) throw new ApiError('Valitse ainakin yksi kaupunki.', { code: 'invalid' });
}

export async function saveMine(uid, input) {
  validate(input);
  const id = uid || (await requireUid());
  const name = input.name.trim();

  const existing = unwrap(
    await db().from('profiles').select('id').eq('id', id).maybeSingle(),
    'Profiilin tallennus epäonnistui.',
  );

  // Only columns the `authenticated` role may UPDATE (see the profiles column grants);
  // an upsert that names any other column is rejected as a whole.
  const profileRow = {
    id,
    name,
    age: input.ageRange || null,
    gender: input.gender || null,
    area: input.areas.join(', '),
    bio: input.bio?.trim() || null,
    hidden_from_feed: Boolean(input.hiddenFromFeed),
  };
  // Stored as a full public URL: the mobile app renders avatar_url as-is.
  if (input.avatarPath) profileRow.avatar_url = avatarUrl(input.avatarPath);
  if (typeof input.playingThisWeek === 'boolean') profileRow.playing_this_week = input.playingThisWeek;

  const fail = 'Profiilin tallennus epäonnistui. Yritä uudelleen.';
  unwrap(await db().from('profiles').upsert(profileRow), fail);
  unwrap(
    await db().from('tennis_preferences').upsert({
      user_id: id,
      skill_level: serializeSkill(input.skillLevel, input.competitionClasses),
      play_style: (input.playStyles || []).join(', '),
      handedness: input.handedness || null,
      backhand_type: input.backhand || null,
    }),
    fail,
  );
  await replaceAvailability(id, input.availability || [], fail);

  // Display name in auth metadata is only used by auth emails; the profile is already
  // saved, so a failure here is logged instead of failing the whole save.
  const { error: metaError } = await db().auth.updateUser({ data: { display_name: name, full_name: name } });
  if (metaError) console.warn('Käyttäjän nimen päivitys kirjautumistietoihin epäonnistui', metaError);

  if (!existing) trackPixel('CompleteRegistration');
  const saved = await getMine(id);
  if (!saved) throw new ApiError(fail);
  return saved;
}

async function replaceAvailability(uid, slots, fail) {
  unwrap(await db().from('availability').delete().eq('user_id', uid), fail);
  const unique = [...new Set(slots)];
  if (unique.length > 0) {
    unwrap(await db().from('availability').insert(unique.map((slot) => ({ user_id: uid, slot }))), fail);
  }
}

export async function uploadAvatar(uid, file) {
  const id = uid || (await requireUid());
  let blob;
  try {
    blob = await resizeImage(file, { max: 800, quality: 0.85 });
  } catch (err) {
    throw toApiError(err, 'Kuvaa ei voitu käsitellä.');
  }
  // A new name per upload, so browsers and CDNs never show a cached old photo.
  const path = `${id}/${Date.now()}.jpg`;
  unwrap(
    await db().storage.from('profile-avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true }),
    'Kuvan lataus epäonnistui.',
  );
  return path;
}

export async function setPlayingThisWeek(uid, playing) {
  const id = uid || (await requireUid());
  unwrap(
    await db().from('profiles').update({ playing_this_week: Boolean(playing) }).eq('id', id),
    'Tilan päivitys epäonnistui.',
  );
}

/** Marks me free to play now and emails players in my city (send-playing-now-email). */
export async function startPlayingNow({ minutes, note } = {}) {
  await requireUid();
  const data = await invokeFunction(
    'send-playing-now-email',
    { body: { minutes, note: note?.trim() || undefined } },
    'Ilmoituksen lähetys epäonnistui. Yritä hetken päästä uudelleen.',
  );
  const result = { sent: Number(data?.sent) || 0 };
  if (data?.warning) result.warning = data.warning;
  return result;
}

// The client has no UPDATE grant on the playing_now_* columns (send-playing-now-email sets
// them server-side), so clearing goes through a SECURITY DEFINER RPC that only touches the
// caller's own row.
export async function stopPlayingNow(uid) {
  if (!uid) await requireUid();
  const { error } = await db().rpc('krossi_stop_playing_now');
  if (error) throw toApiError(error, 'Tilan päivitys epäonnistui.');
}

// One app open per signed-in person per page load (a tab refocus re-emits SIGNED_IN).
let appOpenRecordedFor = null;

export async function recordAppOpen() {
  try {
    const uid = await currentUid();
    if (!uid || appOpenRecordedFor === uid) return;
    appOpenRecordedFor = uid;
    const { error } = await db().rpc('koutsi_record_app_open', { app_input: 'krossi_web' });
    if (error) console.warn('Sovelluksen avauksen kirjaus epäonnistui', error);
  } catch (err) {
    console.warn('Sovelluksen avauksen kirjaus epäonnistui', err);
  }
}

// Permission lookups degrade to "no extra rights" on failure: the database enforces the
// same rules, so a wrong "false" only hides admin UI, it never grants anything.
export async function isAdmin() {
  if (!(await currentUid())) return false;
  const { data, error } = await db().rpc('krossi_is_admin');
  if (error) {
    console.warn('Ylläpito-oikeuden tarkistus epäonnistui', error);
    return false;
  }
  return Boolean(data);
}

export async function myEventCities() {
  if (await isAdmin()) return [...CITIES];
  const { data, error } = await db().rpc('krossi_my_admin_cities');
  if (error) {
    console.warn('Tapahtumakaupunkien haku epäonnistui', error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

export async function deleteAccount() {
  await invokeFunction('delete-account', { body: {} }, 'Tilin poisto epäonnistui. Yritä hetken päästä uudelleen.');
  const { error } = await db().auth.signOut();
  if (error) console.warn('Uloskirjautuminen tilin poiston jälkeen epäonnistui', error);
}
