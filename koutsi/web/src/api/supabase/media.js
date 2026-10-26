// media.js — videos, the exercise bank and annual plans (files in private buckets).
// Same storage paths, RLS assumptions and cleanup/rollback rules as the old lib/koutsi-data.js.

import * as tus from 'tus-js-client';
import { db, isMissingTable, must, randomUuid, requireSession, SUPABASE_URL, SUPABASE_ANON_KEY } from './client.js';
import { koutsiTodayStr } from '../../domain/core.js';
import { ApiError } from '../errors.js';
import { VIDEO_MAX_BYTES, VIDEO_TUS_CHUNK_BYTES, PLAN_MAX_BYTES } from '../../lib/constants.js';

const from = (table) => db().from(table);
const bucket = (name) => db().storage.from(name);

// A file is stored once under the uploader's folder and referenced by one koutsi_videos row
// per recipient; storage RLS authorises reads through those rows.
const cancelled = () => new ApiError('Lataus peruttiin.', { code: 'cancelled' });

async function uploadVideoFile(uploaderId, shareId, file, onProgress, signal = null) {
  if (file.size > VIDEO_MAX_BYTES) {
    throw new ApiError(`Video on liian suuri (${Math.round(file.size / 1048576)} Mt). Tiedostolatauksen raja on 50 Mt — jaa pitkä video linkkinä.`);
  }
  const mimeExtensions = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v', 'video/mpeg': 'mpeg' };
  const fileExtension = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  // The bucket takes only the types above. Phones also hand over 'video/3gpp', '' or other
  // MP4-family types: they go up as mp4 (same container), so the upload isn't refused.
  const byExtension = { mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v' };
  const mimeType = mimeExtensions[file.type] ? file.type : byExtension[fileExtension] || 'video/mp4';
  const ext = mimeExtensions[mimeType];
  const path = `${uploaderId}/${shareId}.${ext}`;
  const report = typeof onProgress === 'function' ? onProgress : () => {};
  report(0);

  // Bigger files go straight from the browser to Supabase's storage host with TUS, which
  // retries 6 MiB chunks and resumes after an interruption.
  if (file.size > VIDEO_TUS_CHUNK_BYTES && tus.isSupported !== false) {
    const session = await requireSession();
    const projectId = new URL(SUPABASE_URL).hostname.split('.')[0];
    await new Promise((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        fingerprint: () => Promise.resolve(`koutsi-video-${uploaderId}-${shareId}-${file.name}-${file.size}-${file.lastModified}`),
        metadata: { bucketName: 'koutsi-videos', objectName: path, contentType: mimeType, cacheControl: '3600' },
        chunkSize: VIDEO_TUS_CHUNK_BYTES,
        onError: reject,
        onProgress: (uploaded, total) => report(total > 0 ? Math.round((uploaded / total) * 100) : 0),
        onSuccess: resolve,
      });
      signal?.addEventListener('abort', () => { upload.abort(true).catch(() => {}); reject(cancelled()); }, { once: true });
      upload.findPreviousUploads()
        .then((previous) => { if (previous.length) upload.resumeFromPreviousUpload(previous[0]); upload.start(); })
        .catch(reject);
    });
    report(100);
    return { path, mimeType, sizeBytes: file.size };
  }

  must(await bucket('koutsi-videos').upload(path, file, { contentType: mimeType, cacheControl: '3600', upsert: false }));
  report(100);
  return { path, mimeType, sizeBytes: file.size };
}

// A file one of the coach's own videos (koutsi_coach_videos) still holds must stay when the last
// player's copy goes. Without the table (migration not run) nothing holds it.
async function libraryHolds(path) {
  const { count, error } = await from('koutsi_coach_videos').select('id', { count: 'exact', head: true }).eq('storage_path', path);
  if (error) {
    if (isMissingTable(error)) return false;
    throw error;
  }
  return (count || 0) > 0;
}

export const videos = {
  async share({ shareId, title, date, tags, studentIds, addedById, file, externalUrl, onProgress, signal = null }) {
    const resolvedShareId = shareId || randomUuid();
    // A retry after a lost response must not insert a second copy for a recipient.
    const existing = must(await from('koutsi_videos').select('student_id').eq('share_id', resolvedShareId)) || [];
    const already = new Set(existing.map((r) => r.student_id));
    const pending = (studentIds || []).filter((id) => !already.has(id));
    if (!pending.length) return resolvedShareId;
    const uploaded = file ? await uploadVideoFile(addedById, resolvedShareId, file, onProgress, signal) : null;
    // Peruuta while a small file was still going up: nothing gets shared, and the file goes too.
    if (signal?.aborted) {
      if (uploaded) await bucket('koutsi-videos').remove([uploaded.path]).catch(() => {});
      throw cancelled();
    }
    const rows = pending.map((studentId) => ({
      share_id: resolvedShareId, student_id: studentId, added_by_id: addedById, title, date, tags,
      storage_path: uploaded ? uploaded.path : null,
      mime_type: uploaded ? uploaded.mimeType : null,
      size_bytes: uploaded ? uploaded.sizeBytes : null,
      external_url: externalUrl || null,
    }));
    const { error } = await from('koutsi_videos').insert(rows);
    if (error) {
      // don't leave the object behind if the rows that authorise it never landed
      if (uploaded) await bucket('koutsi-videos').remove([uploaded.path]);
      throw error;
    }
    return resolvedShareId;
  },
  async setRecipients(shareId, studentIds) {
    must(await db().rpc('koutsi_set_video_recipients', { share_id_input: shareId, student_ids_input: studentIds }));
  },
  // The bucket is private: playback goes through a signed URL.
  async url(storagePath, expiresSeconds = 3600) {
    if (!storagePath) return null;
    return must(await bucket('koutsi-videos').createSignedUrl(storagePath, expiresSeconds)).signedUrl;
  },
  async remove(videoId) {
    const video = must(await from('koutsi_videos').select('*').eq('id', videoId).maybeSingle());
    if (!video) return;
    // Only the path read back under RLS may choose the object to delete.
    const path = video.storage_path || null;
    let references = 0;
    if (path) {
      const { count, error } = await from('koutsi_videos').select('id', { count: 'exact', head: true }).eq('storage_path', path);
      if (error) throw error;
      references = count || 0;
    }
    must(await from('koutsi_videos').delete().eq('id', videoId));
    if (!path || references > 1 || await libraryHolds(path)) return;
    const { error: storageErr } = await bucket('koutsi-videos').remove([path]);
    if (!storageErr) return;
    // keep row and file in agreement: put the last reference back
    await from('koutsi_videos').insert(video);
    throw storageErr;
  },

  // ── The coach's own videos ("Harjoitteet ja videot" → Videot; koutsi_coach_videos) ──
  // save({ coachId, id?, title, tags, file | externalUrl, onProgress, signal }) → id. The file goes up
  // once, to the coach's own folder; the id is also the share_id of every player's copy.
  async save({ coachId, id = null, title, tags = [], file = null, externalUrl = null, onProgress, signal = null }) {
    const videoId = id || randomUuid();
    const name = String(title || '').trim().slice(0, 200) || 'Video';
    // a retry after a lost response must not upload or insert twice
    if (must(await from('koutsi_coach_videos').select('id').eq('id', videoId).maybeSingle())) return videoId;
    const uploaded = file ? await uploadVideoFile(coachId, videoId, file, onProgress, signal) : null;
    if (signal?.aborted) {
      if (uploaded) await bucket('koutsi-videos').remove([uploaded.path]).catch(() => {});
      throw cancelled();
    }
    const { error } = await from('koutsi_coach_videos').insert({
      id: videoId, coach_id: coachId, title: name, tags: tags || [],
      storage_path: uploaded ? uploaded.path : null, external_url: uploaded ? null : (externalUrl || null),
      mime_type: uploaded ? uploaded.mimeType : null, size_bytes: uploaded ? uploaded.sizeBytes : null,
    });
    if (error) {
      if (uploaded) await bucket('koutsi-videos').remove([uploaded.path]).catch(() => {});
      throw error;
    }
    return videoId;
  },
  // shareSaved({ coachId, videoId, studentIds, groupIds, date }) → { sendId, added }: the players who
  // don't have it yet get it (one row each — the file stays one, each gets a notification) and the
  // sending goes to Lähetetyt. Players who already have it are left as they are.
  async shareSaved({ coachId, videoId, studentIds, groupIds = [], date = koutsiTodayStr() }) {
    const video = must(await from('koutsi_coach_videos').select('*').eq('id', videoId).maybeSingle());
    if (!video) throw new ApiError('Videota ei enää löydy. Päivitä sivu.');
    const existing = must(await from('koutsi_videos').select('student_id').eq('share_id', videoId)) || [];
    const have = new Set(existing.map((r) => r.student_id));
    const pending = [...new Set((studentIds || []).filter(Boolean))].filter((id) => !have.has(id));
    if (!pending.length) return { sendId: null, added: 0 };
    const sendId = randomUuid();
    must(await from('koutsi_sends').insert({
      id: sendId, coach_id: coachId, kind: 'video', video_id: videoId, ref_id: videoId, title: video.title,
      group_ids: [...new Set(groupIds || [])], student_ids: pending,
    }));
    const { error } = await from('koutsi_videos').insert(pending.map((studentId) => ({
      share_id: videoId, student_id: studentId, added_by_id: coachId, title: video.title, date, tags: video.tags || [],
      storage_path: video.storage_path, external_url: video.external_url, mime_type: video.mime_type, size_bytes: video.size_bytes,
    })));
    if (error) {
      await from('koutsi_sends').delete().eq('id', sendId).then(() => {}, () => {});
      throw error;
    }
    return { sendId, added: pending.length };
  },
  // updateSaved(videoId, { title, tags }): the name and topics everywhere the video shows
  async updateSaved(videoId, { title, tags = [] }) {
    const name = String(title || '').trim();
    if (!name) throw new ApiError('Anna videolle nimi.');
    if (name.length > 200) throw new ApiError('Nimi on liian pitkä (enintään 200 merkkiä).');
    must(await from('koutsi_coach_videos').update({ title: name, tags }).eq('id', videoId));
    must(await from('koutsi_videos').update({ title: name, tags }).eq('share_id', videoId));
    must(await from('koutsi_sends').update({ title: name }).eq('video_id', videoId));
  },
  // removeSaved(videoId): the video goes for good — from every player, from Lähetetyt and the file.
  async removeSaved(videoId) {
    const video = must(await from('koutsi_coach_videos').select('*').eq('id', videoId).maybeSingle());
    if (!video) return;
    must(await from('koutsi_videos').delete().eq('share_id', videoId));
    must(await from('koutsi_coach_videos').delete().eq('id', videoId)); // its sendings go with it
    if (!video.storage_path) return;
    const { error } = await bucket('koutsi-videos').remove([video.storage_path]);
    // the rows are gone already; a file left behind is unreachable and harmless
    if (error) console.warn('video file not removed:', error.message || error);
  },
};

export const exercises = {
  async add(coachId, { name, goal, players, playerCount, duration, level, tags }) {
    must(await from('koutsi_exercises').insert({ coach_id: coachId, name, goal, players_label: players, player_count: playerCount, duration, level, tags }));
  },
  async update(exerciseId, { name, goal, players, playerCount, duration, level, tags }) {
    must(await from('koutsi_exercises').update({ name, goal, players_label: players, player_count: playerCount, duration, level, tags }).eq('id', exerciseId));
  },
  async remove(exerciseId) {
    const exercise = must(await from('koutsi_exercises').select('*').eq('id', exerciseId).maybeSingle());
    if (!exercise) return;
    must(await from('koutsi_exercises').delete().eq('id', exerciseId));
    const path = exercise.video_storage_path || null;
    if (!path) return;
    const { error: storageErr } = await bucket('koutsi-videos').remove([path]);
    if (!storageErr) return;
    await from('koutsi_exercises').insert(exercise);
    throw storageErr;
  },
  async setVideo({ exerciseId, coachId, title, file, externalUrl, onProgress }) {
    const exercise = must(await from('koutsi_exercises').select('*').eq('id', exerciseId).single());
    const uploaded = file ? await uploadVideoFile(coachId, `exercise-${randomUuid()}`, file, onProgress) : null;
    const next = {
      video_title: title,
      video_storage_path: uploaded ? uploaded.path : null,
      video_external_url: externalUrl || null,
      video_mime_type: uploaded ? uploaded.mimeType : null,
      video_size_bytes: uploaded ? uploaded.sizeBytes : null,
    };
    const previous = {
      video_title: exercise.video_title || null,
      video_storage_path: exercise.video_storage_path || null,
      video_external_url: exercise.video_external_url || null,
      video_mime_type: exercise.video_mime_type || null,
      video_size_bytes: exercise.video_size_bytes || null,
    };
    const { error } = await from('koutsi_exercises').update(next).eq('id', exerciseId);
    if (error) {
      if (uploaded) await bucket('koutsi-videos').remove([uploaded.path]);
      throw error;
    }
    const oldPath = previous.video_storage_path;
    if (!oldPath || oldPath === next.video_storage_path) return;
    const { error: storageErr } = await bucket('koutsi-videos').remove([oldPath]);
    if (!storageErr) return;
    await from('koutsi_exercises').update(previous).eq('id', exerciseId);
    if (uploaded) await bucket('koutsi-videos').remove([uploaded.path]);
    throw storageErr;
  },
  async removeVideo(exerciseId) {
    const exercise = must(await from('koutsi_exercises').select('*').eq('id', exerciseId).single());
    if (!exercise.video_storage_path && !exercise.video_external_url) return;
    const previous = {
      video_title: exercise.video_title || null,
      video_storage_path: exercise.video_storage_path || null,
      video_external_url: exercise.video_external_url || null,
      video_mime_type: exercise.video_mime_type || null,
      video_size_bytes: exercise.video_size_bytes || null,
    };
    must(await from('koutsi_exercises').update({
      video_title: null, video_storage_path: null, video_external_url: null, video_mime_type: null, video_size_bytes: null,
    }).eq('id', exerciseId));
    if (!previous.video_storage_path) return;
    const { error: storageErr } = await bucket('koutsi-videos').remove([previous.video_storage_path]);
    if (!storageErr) return;
    await from('koutsi_exercises').update(previous).eq('id', exerciseId);
    throw storageErr;
  },
  // Re-copies any starter exercise the coach has since deleted. Resolves to how many landed.
  async seedStarters(coachId) {
    return must(await db().rpc('koutsi_seed_exercises', { target_coach: coachId || null })) || 0;
  },
};

function tooBig(file) {
  return new ApiError(`Tiedosto on liian suuri (${Math.round(file.size / 1048576)} Mt). Enimmäiskoko on 20 Mt.`);
}

export const plans = {
  // A group's annual plan. The upload hands the file to the Koutsi team for review ('review').
  async upload(groupId, file) {
    if (file.size > PLAN_MAX_BYTES) throw tooBig(file);
    const prev = must(await from('koutsi_groups')
      .select('id, annual_plan_filename, annual_plan_storage_path, annual_plan_size_bytes, annual_plan_uploaded_at, annual_plan_status')
      .eq('id', groupId).maybeSingle());
    if (!prev) throw new ApiError('Ryhmää ei löytynyt.');
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().slice(0, 5);
    // Reuse the existing key on replacement so an upsert changes the object in place.
    const path = prev.annual_plan_storage_path || `${groupId}/${randomUuid()}.${ext}`;
    must(await bucket('koutsi-plans').upload(path, file, { contentType: file.type || 'application/pdf', upsert: Boolean(prev.annual_plan_storage_path) }));
    const { error } = await from('koutsi_groups').update({
      annual_plan_filename: file.name,
      annual_plan_storage_path: path,
      annual_plan_size_bytes: file.size,
      annual_plan_uploaded_at: new Date().toISOString(),
      annual_plan_status: 'review',
    }).eq('id', groupId).select('id').single();
    if (error) {
      if (!prev.annual_plan_storage_path) await bucket('koutsi-plans').remove([path]);
      throw error;
    }
  },
  async url(storagePath, expiresSeconds = 3600) {
    if (!storagePath) return null;
    return must(await bucket('koutsi-plans').createSignedUrl(storagePath, expiresSeconds)).signedUrl;
  },
  async remove(groupId) {
    const prev = must(await from('koutsi_groups')
      .select('id, annual_plan_filename, annual_plan_storage_path, annual_plan_size_bytes, annual_plan_uploaded_at, annual_plan_status')
      .eq('id', groupId).maybeSingle());
    if (!prev) throw new ApiError('Ryhmää ei löytynyt.');
    must(await from('koutsi_groups').update({
      annual_plan_filename: null, annual_plan_storage_path: null, annual_plan_size_bytes: null,
      annual_plan_uploaded_at: null, annual_plan_status: 'review',
    }).eq('id', groupId).select('id').single());
    const path = prev.annual_plan_storage_path || null;
    if (!path) return;
    const { error: storageErr } = await bucket('koutsi-plans').remove([path]);
    if (!storageErr) return;
    await from('koutsi_groups').update({
      annual_plan_filename: prev.annual_plan_filename, annual_plan_storage_path: prev.annual_plan_storage_path,
      annual_plan_size_bytes: prev.annual_plan_size_bytes, annual_plan_uploaded_at: prev.annual_plan_uploaded_at,
      annual_plan_status: prev.annual_plan_status,
    }).eq('id', groupId);
    throw storageErr;
  },
  // A shared workbook for many groups: a review submission, not a direct theme import.
  async uploadShared(coachId, file) {
    if (!file || !/\.xlsx$/i.test(file.name || '')) throw new ApiError('Valitse .xlsx-muotoinen Excel-tiedosto.');
    if (file.size < 1 || file.size > PLAN_MAX_BYTES) throw tooBig(file);
    const path = `shared/${coachId}/${randomUuid()}.xlsx`;
    must(await bucket('koutsi-plans').upload(path, file, {
      contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: false,
    }));
    const { data, error } = await from('koutsi_annual_plan_submissions').insert({
      coach_id: coachId, filename: file.name.slice(0, 240), storage_path: path, size_bytes: file.size,
    }).select('id, coach_id, filename, storage_path, size_bytes, status, uploaded_at, handled_at').single();
    if (!error) return data;
    await bucket('koutsi-plans').remove([path]);
    throw error;
  },
  async submissions(coachId = null, pendingOnly = false) {
    let query = from('koutsi_annual_plan_submissions')
      .select('id, coach_id, filename, storage_path, size_bytes, status, uploaded_at, handled_at')
      .order('uploaded_at', { ascending: false });
    if (coachId) query = query.eq('coach_id', coachId);
    if (pendingOnly) query = query.eq('status', 'pending');
    return (must(await query) || []).map((row) => ({
      id: row.id, coachId: row.coach_id, filename: row.filename, storagePath: row.storage_path,
      sizeBytes: Number(row.size_bytes || 0), status: row.status, uploadedAt: row.uploaded_at, handledAt: row.handled_at,
    }));
  },
};
