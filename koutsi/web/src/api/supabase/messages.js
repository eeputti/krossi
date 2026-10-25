// messages.js — Viestit over koutsi_threads / koutsi_messages (migration
// koutsi/web/sql/20261109120000_koutsi_messages.sql, NOT applied yet). Until it is, overview()
// answers { ready: false } and both apps keep Viestit hidden. Row security decides everything:
// the two people of a conversation read it, the server sets who sent a message and when.

import { db, isMissingFunction, isMissingTable, must } from './client.js';
import { ApiError } from '../errors.js';
import { MESSAGE_MAX } from '../../domain/messages.js';

const from = (table) => db().from(table);

function mapThread(r) {
  return {
    id: r.id, coachId: r.coach_id, studentId: r.student_id, enabled: Boolean(r.enabled), enabledAt: r.enabled_at,
    lastMessageAt: r.last_message_at, coachReadAt: r.coach_read_at, playerReadAt: r.player_read_at,
    last: r.last_sender ? { body: r.last_body || '', sender: r.last_sender, refKind: r.last_ref_kind || null } : null,
    unread: r.unread || 0,
  };
}
const mapMessage = (r) => ({ id: r.id, sender: r.sender, body: r.body, refKind: r.ref_kind || null, refId: r.ref_id || null, at: r.created_at });
const missing = (error) => isMissingFunction(error) || isMissingTable(error);

let channelSeq = 0;
export const messages = {
  async overview(role) {
    // The gate is asked only once the database has Viestit: before the migration this is one quiet miss.
    const rows = await db().rpc('koutsi_thread_overview');
    if (rows.error) {
      if (!missing(rows.error)) console.warn('messages unavailable:', rows.error.message || rows.error);
      return { ready: false, enabled: false, threads: [] };
    }
    const threads = (rows.data || []).map(mapThread);
    if (role !== 'coach') return { ready: true, enabled: threads.some((t) => t.enabled), threads };
    const gate = await db().rpc('koutsi_messages_enabled');
    return { ready: true, enabled: !gate.error && gate.data === true, threads };
  },
  async list(threadId) {
    const rows = must(await from('koutsi_messages').select('id, sender, body, ref_kind, ref_id, created_at')
      .eq('thread_id', threadId).order('created_at', { ascending: false }).limit(500)) || [];
    return rows.reverse().map(mapMessage);
  },
  async send(threadId, { body, refKind = null, refId = null }) {
    const text = String(body || '').trim();
    if (!text) throw new ApiError('Kirjoita viesti.');
    if (text.length > MESSAGE_MAX) throw new ApiError(`Viesti on liian pitkä (enintään ${MESSAGE_MAX} merkkiä).`);
    const row = must(await from('koutsi_messages')
      .insert({ thread_id: threadId, body: text, ref_kind: refKind && refId ? refKind : null, ref_id: refKind && refId ? refId : null })
      .select('id, sender, body, ref_kind, ref_id, created_at').single());
    return mapMessage(row);
  },
  async remove(messageId) {
    must(await from('koutsi_messages').delete().eq('id', messageId));
  },
  async markRead(threadId) {
    must(await db().rpc('koutsi_mark_thread_read', { p_thread: threadId }));
  },
  async setEnabled(studentIds, on) {
    return must(await db().rpc('koutsi_set_messages', { p_student_ids: studentIds, p_on: Boolean(on) })) || 0;
  },
  // Any new or deleted message and any change of a conversation (read markers, on/off) the user may see.
  subscribe(cb) {
    const channel = db().channel(`koutsi-messages-${Date.now().toString(36)}-${channelSeq++}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'koutsi_messages' }, (p) => cb({ threadId: p.new?.thread_id || p.old?.thread_id || null }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'koutsi_threads' }, (p) => cb({ threadId: p.new?.id || p.old?.id || null }))
      .subscribe();
    return () => { db().removeChannel(channel); };
  },
};
