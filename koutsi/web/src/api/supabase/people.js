// people.js — joining (codes, claims), notifications and Ylläpito.
// Same RPCs and tables as the old lib/koutsi-data.js.

import { db, must, callFunction, randomUuid, isMissingFunction, SUPABASE_URL } from './client.js';
import { ApiError } from '../errors.js';
import { koutsiFmtShortDateFromTimestamp, koutsiInviteLink } from '../../domain/core.js';
import { avatarUrl } from './map.js';

const from = (table) => db().from(table);
const rpc = async (name, args) => must(await db().rpc(name, args));

export const invites = {
  // The coach's permanent code: one per coach, never expires, RLS returns only one's own.
  async myJoinCode(coachId) {
    return must(await from('koutsi_coach_join_codes').select('code').eq('coach_id', coachId).maybeSingle())?.code || null;
  },
  async rotateJoinCode() { return rpc('koutsi_rotate_join_code'); },
  // Group codes are minted server-side: unique, with an expiry and a use limit. coachId only
  // when an admin acts in another coach's view.
  async create(groupId, { expiresDays = 14, maxUses = 1, coachId = null } = {}) {
    return rpc('create_koutsi_invite_code', {
      group_id_input: groupId || null, expires_days: expiresDays, max_uses_input: maxUses, coach_id_input: coachId || null,
    });
  },
  async list(coachId) {
    const data = must(await from('koutsi_group_invite_codes')
      .select('code, group_id, expires_at, max_uses, use_count, revoked_at, created_at')
      .eq('coach_id', coachId).order('created_at', { ascending: false })) || [];
    const now = new Date();
    return data.map((c) => ({
      code: c.code, groupId: c.group_id, createdAt: c.created_at,
      expiresAt: c.expires_at, maxUses: c.max_uses, useCount: c.use_count, revokedAt: c.revoked_at,
      active: !c.revoked_at && (!c.expires_at || new Date(c.expires_at) > now) && (c.max_uses == null || c.use_count < c.max_uses),
    }));
  },
  async revoke(code) {
    must(await from('koutsi_group_invite_codes').update({ revoked_at: new Date().toISOString() }).eq('code', code));
  },
  async redeem(code) { return rpc('redeem_koutsi_invite_code', { code_input: code }); },
  async claim(code, studentId) { return rpc('koutsi_claim_player', { code_input: code, student_id_input: studentId }); },
  // { id, name, direct } | null — never a list, so a shared code can't browse the roster.
  async matchUnclaimed(code) { return (await rpc('koutsi_match_unclaimed_player', { code_input: code })) || null; },
  // Only after the player says "I think I'm already on the list".
  async unclaimedForCode(code) { return (await rpc('koutsi_unclaimed_players_for_code', { code_input: code })) || []; },
};

let notifSeq = 0;
export const notifications = {
  async list(uid, limit = 40) {
    const data = must(await from('koutsi_notifications')
      .select('id, kind, title, body, link_path, created_at, read_at')
      .eq('recipient_id', uid).order('created_at', { ascending: false }).limit(limit)) || [];
    return data.map((n) => ({
      id: n.id, kind: n.kind, title: n.title, body: n.body || '',
      linkPath: n.link_path, createdAt: n.created_at, read: Boolean(n.read_at),
      date: koutsiFmtShortDateFromTimestamp(n.created_at),
    }));
  },
  async markRead(uid) {
    must(await from('koutsi_notifications').update({ read_at: new Date().toISOString() }).eq('recipient_id', uid).is('read_at', null));
  },
  async getEmailPref(uid) {
    const data = must(await from('koutsi_notification_prefs').select('email_enabled').eq('user_id', uid).maybeSingle());
    return data ? data.email_enabled : true; // opted in until they say otherwise
  },
  async setEmailPref(uid, enabled) {
    must(await from('koutsi_notification_prefs')
      .upsert({ user_id: uid, email_enabled: enabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }));
  },
  subscribe(uid, cb) {
    const channel = db().channel(`koutsi-notif-${uid}-${notifSeq++}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'koutsi_notifications', filter: `recipient_id=eq.${uid}` }, () => cb())
      .subscribe();
    return () => { db().removeChannel(channel); };
  },
};

export const admin = {
  async users() {
    const [rows, submissions] = await Promise.all([
      rpc('koutsi_admin_users'),
      from('koutsi_annual_plan_submissions').select('coach_id, status').eq('status', 'pending').then(must),
    ]);
    const pendingShared = new Map();
    for (const s of submissions || []) pendingShared.set(s.coach_id, (pendingShared.get(s.coach_id) || 0) + 1);
    return (rows || []).map((r) => ({
      id: r.user_id, name: r.display_name || 'Nimetön', email: r.email || '',
      joinedAt: r.joined_at, lastSignInAt: r.last_sign_in_at,
      appOpenCount: r.app_open_count || 0, lastAppOpenAt: r.last_app_open_at,
      isAdmin: Boolean(r.is_admin), isCoach: Boolean(r.is_coach), isPlayer: Boolean(r.is_player),
      storageBytes: Number(r.storage_bytes || 0),
      studentCount: r.student_count || 0, groupCount: r.group_count || 0, trainingCount: r.training_count || 0,
      codes: r.active_codes || [],
      pendingPlans: (r.pending_plans || 0) + (pendingShared.get(r.user_id) || 0),
      pendingStudents: r.pending_students || [],
    }));
  },
  async feedback() {
    return ((await rpc('koutsi_admin_feedback')) || []).map((r) => ({
      id: r.id, senderId: r.sender_id, senderName: r.sender_name || 'Nimetön', email: r.email || '',
      isCoach: Boolean(r.is_coach), isPlayer: Boolean(r.is_player), category: r.category, message: r.message, createdAt: r.created_at,
    }));
  },
  async deleteFeedback(feedbackId) { await rpc('koutsi_admin_delete_feedback', { feedback_id_input: feedbackId }); },
  async deleteUser(userId) { await callFunction('koutsi-admin-delete-user', { user_id: userId }); },
  // Server checks koutsi_admins and writes an audit row (koutsi_admin_actions).
  async actAs(coachId) {
    const data = await rpc('koutsi_admin_act_as', { coach_id_input: coachId });
    return { id: data.coach_id, name: data.coach_name || 'Valmentaja' };
  },
  async groups(coachId) {
    return ((await rpc('koutsi_admin_groups', { coach_id_input: coachId })) || []).map((r) => ({
      id: r.group_id, name: r.group_name, memberCount: r.member_count, planFilename: r.plan_filename, planStatus: r.plan_status,
    }));
  },
  async bulkInviteCodes(coachId, names, groupId, expiresDays = 30) {
    return ((await rpc('koutsi_admin_bulk_invite_codes', {
      coach_id_input: coachId, names, group_id_input: groupId || null, expires_days: expiresDays,
    })) || []).map((r) => ({ label: r.label, code: r.code, link: koutsiInviteLink(r.code) }));
  },
  async pendingPlans() {
    return ((await rpc('koutsi_pending_annual_plans')) || []).map((r) => ({
      groupId: r.group_id, groupName: r.group_name, coachId: r.coach_id, coachName: r.coach_name,
      filename: r.filename, storagePath: r.storage_path, sizeBytes: r.size_bytes, uploadedAt: r.uploaded_at,
    }));
  },
  async publishPlan(groupId) { await rpc('koutsi_publish_annual_plan', { group_id_input: groupId }); },
  async handleSubmission(submissionId) { await rpc('koutsi_admin_handle_annual_plan_submission', { submission_id_input: submissionId }); },
  // Uploads to the group's folder, then records it as published in one step.
  async uploadPlan(groupId, file) {
    const prev = must(await from('koutsi_groups').select('annual_plan_storage_path').eq('id', groupId).maybeSingle());
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().slice(0, 5);
    const path = prev?.annual_plan_storage_path || `${groupId}/${randomUuid()}.${ext}`;
    must(await db().storage.from('koutsi-plans').upload(path, file, { contentType: file.type || 'application/pdf', upsert: Boolean(prev?.annual_plan_storage_path) }));
    const { error } = await db().rpc('koutsi_admin_set_annual_plan', {
      group_id_input: groupId, filename_input: file.name, storage_path_input: path, size_bytes_input: file.size,
    });
    if (error) {
      if (!prev?.annual_plan_storage_path) await db().storage.from('koutsi-plans').remove([path]);
      throw error;
    }
  },
  // Taps per event (account.trackEvent) over the last `days` days, or all time for null.
  async usage(days = null) {
    const { data, error } = await db().rpc('koutsi_admin_ui_events', { days_input: days });
    if (error && isMissingFunction(error)) {
      throw new ApiError('Käytön seuranta otetaan käyttöön, kun tietokantamuutos on ajettu.', { code: 'not_deployed' });
    }
    if (error) throw error;
    return (data || []).map((r) => ({
      event: r.event, clicks: r.clicks || 0, users: r.users || 0, adminClicks: r.admin_clicks || 0, lastAt: r.last_at,
    }));
  },
};

export { avatarUrl, SUPABASE_URL };
