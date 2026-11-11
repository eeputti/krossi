// account.js — sign-in, the shared profiles row, the pilot acknowledgement and account-level
// actions. Mirrors lib/koutsi-auth.jsx and the account parts of lib/koutsi-data.js.

import { db, must, requireSession, callFunction } from './client.js';
import { ApiError, loginError } from '../errors.js';
import { avatarUrl } from './map.js';
import { PILOT_TERMS_VERSION, PILOT_PRIVACY_VERSION, RENEWED_SEEN_KEY } from '../../lib/constants.js';
import { TENNIS_DRAFT_KEY, tennisDraftOf } from '../../domain/tennisProfile.js';
import { PROFILE_DONE_KEY } from '../../domain/profileCompleteness.js';

export const auth = {
  async getSession() {
    const { data, error } = await db().auth.getSession();
    if (error) throw error;
    return data.session || null;
  },
  onChange(cb) {
    const { data } = db().auth.onAuthStateChange((event, session) => cb(event, session));
    return () => data.subscription.unsubscribe();
  },
  async signInWithPassword(email, password) {
    must(await db().auth.signInWithPassword({ email, password }));
  },
  /** Resolves { needsConfirmation } — true when Supabase sent a confirmation mail first. */
  async signUp(email, password, redirectTo) {
    const data = must(await db().auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }));
    return { needsConfirmation: Boolean(data.user && !data.session) };
  },
  async signInWithOAuth(provider, redirectTo) {
    must(await db().auth.signInWithOAuth({ provider, options: { redirectTo } }));
  },
  async resetPassword(email, redirectTo) {
    must(await db().auth.resetPasswordForEmail(email, { redirectTo }));
  },
  async resendConfirmation(email, redirectTo) {
    must(await db().auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } }));
  },
  async updatePassword(password) {
    must(await db().auth.updateUser({ password }));
  },
  /**
   * Profiili → Sähköposti. Sign-ups confirm themselves (no confirmation mail), and the same
   * setting makes this change take effect at once: the new address signs in from now on.
   * → { email, pending }: the address now on the account, and `pending` only if Supabase ever
   * asks for a confirmation link again (then the old address stays until the link is opened).
   */
  async updateEmail(email) {
    const { data, error } = await db().auth.updateUser({ email: String(email || '').trim() });
    if (error) {
      const raw = `${error.code || ''} ${error.message || ''}`;
      if (/email_exists|already been registered|already registered/i.test(raw)) {
        throw new ApiError('Tällä sähköpostilla on jo toinen tili. Valitse toinen osoite.', { code: 'email_taken', cause: error });
      }
      if (/email_address_invalid|invalid format|validate email/i.test(raw)) {
        throw new ApiError('Tarkista sähköpostiosoite.', { code: 'email_invalid', cause: error });
      }
      throw error;
    }
    return { email: data.user?.email || '', pending: data.user?.new_email || null };
  },
  /** Profiili → Kirjautumistavat: → [{ provider: 'email'|'google'|'apple', email }] on this account. */
  async getLogins() {
    const { data, error } = await db().auth.getUser();
    if (error) throw error;
    return (data.user?.identities || []).map((i) => ({ provider: i.provider, email: i.identity_data?.email || i.email || '' }));
  },
  /**
   * Liitä Google / Apple: the browser goes to the provider and comes back to `redirectTo`, where
   * Supabase has added the login to the signed-in account. → { redirecting: true }.
   * Needs "Allow manual linking" on in Supabase Auth.
   */
  async linkLogin(provider, redirectTo) {
    const { error } = await db().auth.linkIdentity({ provider, options: { redirectTo } });
    if (error) throw loginError(error, provider);
    return { redirecting: true };
  },
  /** Irrota: only when another way to sign in stays on the account (Supabase refuses the last one). */
  async unlinkLogin(provider) {
    const { data, error } = await db().auth.getUserIdentities();
    if (error) throw error;
    const identities = data?.identities || [];
    const identity = identities.find((i) => i.provider === provider);
    if (!identity) return;
    if (identities.length < 2) throw loginError({ code: 'single_identity_not_deletable' }, provider, { unlink: true });
    const res = await db().auth.unlinkIdentity(identity);
    if (res.error) throw loginError(res.error, provider, { unlink: true });
  },
  async signOut() {
    const { error } = await db().auth.signOut();
    if (error) throw error;
  },
};

async function uploadAvatarFile(uid, file) {
  const ext = (String(file.name || '').split('.').pop() || 'jpg').toLowerCase().slice(0, 5) || 'jpg';
  const path = `${uid}/${Date.now()}.${ext}`;
  must(await db().storage.from('profile-avatars').upload(path, file, { upsert: true }));
  return path;
}

export const account = {
  /** The shared Krossi profiles row, or null when the person has none yet. */
  async getProfile(uid) {
    const row = must(await db().from('profiles').select('id, name, avatar_url, avatar_color').eq('id', uid).maybeSingle());
    return row ? { id: row.id, name: row.name || '', avatarUrl: avatarUrl(row.avatar_url) } : null;
  },
  /** true when this account has confirmed the current pilot terms. */
  async getPilotAcknowledgement(uid) {
    const data = must(await db().from('koutsi_pilot_acknowledgements')
      .select('terms_version, privacy_version, restricted_data_rules_confirmed_at')
      .eq('user_id', uid).maybeSingle());
    return Boolean(data
      && data.terms_version === PILOT_TERMS_VERSION
      && data.privacy_version === PILOT_PRIVACY_VERSION
      && data.restricted_data_rules_confirmed_at);
  },
  async acceptPilot(uid) {
    const now = new Date().toISOString();
    must(await db().from('koutsi_pilot_acknowledgements').upsert({
      user_id: uid,
      terms_version: PILOT_TERMS_VERSION,
      privacy_version: PILOT_PRIVACY_VERSION,
      restricted_data_rules_confirmed_at: now,
      updated_at: now,
    }, { onConflict: 'user_id' }));
  },
  /**
   * First-time profile, exactly as the old onboarding wrote it: Koutsi-created profiles stay
   * out of Krossi's player feed (hidden_from_feed) and a player is never discoverable there.
   * Never writes tennis_preferences — its absence is how Krossi recognises a Koutsi-only account.
   */
  async createProfile(uid, { name, age, area, avatarFile, role }) {
    const avatarPath = avatarFile ? await uploadAvatarFile(uid, avatarFile) : null;
    must(await db().from('profiles').upsert({
      id: uid, name: name.trim(), age: age || null, area, hidden_from_feed: true, playing_this_week: false,
      ...(role === 'player' ? { is_discoverable: false } : {}),
      ...(avatarPath ? { avatar_url: avatarPath } : {}),
    }));
    await db().auth.updateUser({ data: { display_name: name.trim(), full_name: name.trim() } });
  },
  async saveDisplayName(uid, name) {
    must(await db().from('profiles').update({ name }).eq('id', uid));
    await db().auth.updateUser({ data: { display_name: name, full_name: name } });
  },
  async uploadAvatar(uid, file) {
    const path = await uploadAvatarFile(uid, file);
    must(await db().from('profiles').update({ avatar_url: path }).eq('id', uid));
    return avatarUrl(path);
  },
  async removeAvatar(uid) {
    must(await db().from('profiles').update({ avatar_url: null }).eq('id', uid));
  },
  /**
   * The profile's own words and/or home town — the same row Krossi shows, so both apps agree.
   * Only the keys given are written (a coach's description lives in koutsi_coaches, so a coach
   * never touches profiles.bio).
   */
  async saveAbout(uid, fields) {
    const patch = {};
    if ('bio' in fields) patch.bio = fields.bio || null;
    if ('area' in fields && fields.area) patch.area = fields.area;
    if (Object.keys(patch).length) must(await db().from('profiles').update(patch).eq('id', uid));
  },
  /**
   * A player with no group yet (no koutsi_students row): the profile's own words and the tennis
   * card filled in while waiting. The card waits in the account's own metadata until joining
   * moves it onto the row (player.applyTennisDraft). Nobody else can read it before that.
   */
  async getWaitingProfile(uid) {
    const row = must(await db().from('profiles').select('bio').eq('id', uid).maybeSingle());
    const { user } = must(await db().auth.getUser());
    return { bio: row?.bio || '', tennis: tennisDraftOf(user?.user_metadata?.[TENNIS_DRAFT_KEY]) };
  },
  async saveWaitingProfile(uid, { bio, tennis }) {
    must(await db().from('profiles').update({ bio: (bio || '').trim() || null }).eq('id', uid));
    must(await db().auth.updateUser({ data: { [TENNIS_DRAFT_KEY]: tennisDraftOf(tennis) } }));
  },
  /** The profile reached 100 % once: remembered on the account, so the strip stays away. */
  async markProfileDone() {
    const at = new Date().toISOString();
    must(await db().auth.updateUser({ data: { [PROFILE_DONE_KEY]: at } }));
    return at;
  },
  /** "Krossi Koutsin ilme on uudistunut" was closed: remembered on the account (shared/renewed.jsx). */
  async markRenewedSeen() {
    must(await db().auth.updateUser({ data: { [RENEWED_SEEN_KEY]: new Date().toISOString() } }));
  },
  /** Counts one real app open; never allowed to fail anything. */
  async recordAppOpen(appName) {
    try { await db().rpc('koutsi_record_app_open', { app_input: appName }); } catch { /* analytics only */ }
  },
  // One tap on the Merkitse menu or a quick button (migration 20261014122952_koutsi_ui_events).
  // Fire and forget: a failed count never shows.
  async trackEvent(name) {
    try { await db().rpc('koutsi_track_ui_event', { event_input: name }); } catch { /* analytics only */ }
  },
  async isAdmin() {
    const { data, error } = await db().rpc('koutsi_is_admin');
    if (error) return false; // never block the app on this
    return Boolean(data);
  },
  async submitFeedback(userId, { category, message }) {
    must(await db().from('koutsi_feedback').insert({ student_id: userId, category, message }));
  },
  /** Everything the caller can see (RLS decides), as one JSON payload. */
  async exportMyData(uid, role) {
    const tables = role === 'coach'
      ? ['koutsi_coaches', 'koutsi_groups', 'koutsi_group_members', 'koutsi_group_themes', 'koutsi_group_slots', 'koutsi_trainings',
        'koutsi_exercises', 'koutsi_coach_events', 'koutsi_coach_students',
        'koutsi_diary_entries', 'koutsi_homework', 'koutsi_videos', 'koutsi_group_invite_codes',
        'koutsi_annual_plan_submissions', 'koutsi_feedback', 'koutsi_pilot_acknowledgements']
      : ['koutsi_students', 'koutsi_coach_students', 'koutsi_group_members', 'koutsi_group_themes', 'koutsi_trainings',
        'koutsi_diary_entries', 'koutsi_homework', 'koutsi_videos', 'koutsi_moods',
        'koutsi_match_notes', 'koutsi_player_history', 'koutsi_player_entries', 'koutsi_training_absences', 'koutsi_feedback', 'koutsi_pilot_acknowledgements'];
    const payload = {
      vietyLahde: 'Krossi Koutsi',
      vientipaiva: new Date().toISOString(),
      kayttajaId: uid,
      rooli: role === 'coach' ? 'valmentaja' : 'pelaaja',
      huomio: 'Tiedosto sisältää ne tiedot, jotka näet itse sovelluksessa.',
    };
    const { data: profile } = await db().from('profiles').select('*').eq('id', uid).maybeSingle();
    payload.profiili = profile || null;
    const { data: prefs } = await db().from('koutsi_notification_prefs').select('*').eq('user_id', uid).maybeSingle();
    payload.ilmoitusasetukset = prefs || null;
    const { data: notifications } = await db().from('koutsi_notifications')
      .select('kind, title, body, created_at, read_at').eq('recipient_id', uid).order('created_at', { ascending: false });
    payload.ilmoitukset = notifications || [];
    for (const table of tables) {
      const { data, error } = await db().from(table).select('*');
      payload[table] = error ? { virhe: 'Taulua ei voitu lukea.' } : (data || []);
    }
    return payload;
  },
  /** Clears every Koutsi row and file, then removes the login — which is shared with Krossi. */
  async deleteAccount() {
    await requireSession();
    await callFunction('koutsi-delete-account');
    await db().auth.signOut();
  },
};
