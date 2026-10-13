// media.js — videos, the exercise bank and annual plans (files in private buckets).
// Same storage paths, RLS assumptions and cleanup/rollback rules as the old lib/koutsi-data.js.

import * as tus from 'tus-js-client';
import { db, must, randomUuid, requireSession, SUPABASE_URL, SUPABASE_ANON_KEY } from './client.js';
import { ApiError } from '../errors.js';
import { VIDEO_MAX_BYTES, VIDEO_TUS_CHUNK_BYTES, PLAN_MAX_BYTES } from '../../lib/constants.js';

const from = (table) => db().from(table);
const bucket = (name) => db().storage.from(name);

// A file is stored once under the uploader's folder and referenced by one koutsi_videos row
// per recipient; storage RLS authorises reads through those rows.
async function uploadVideoFile(uploaderId, shareId, file, onProgress) {
  if (file.size > VIDEO_MAX_BYTES) {
    throw new ApiError(`Video on liian suuri (${Math.round(file.size / 1048576)} Mt). Tiedostolatauksen raja on 50 Mt — jaa pitkä video linkkinä.`);
  }
  const mimeType = file.type || 'video/mp4';
  const mimeExtensions = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v', 'video/mpeg': 'mpeg' };
  const fileExtension = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  const ext = mimeExtensions[mimeType] || fileExtension || 'mp4';
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

export const videos = {
  async share({ shareId, title, date, tags, studentIds, addedById, file, externalUrl, onProgress }) {
    const resolvedShareId = shareId || randomUuid();
    // A retry after a lost response must not insert a second copy for a recipient.
    const existing = must(await from('koutsi_videos').select('student_id').eq('share_id', resolvedShareId)) || [];
    const already = new Set(existing.map((r) => r.student_id));
    const pending = (studentIds || []).filter((id) => !already.has(id));
    if (!pending.length) return resolvedShareId;
    const uploaded = file ? await uploadVideoFile(addedById, resolvedShareId, file, onProgress) : null;
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
    if (!path || references > 1) return;
    const { error: storageErr } = await bucket('koutsi-videos').remove([path]);
    if (!storageErr) return;
    // keep row and file in agreement: put the last reference back
    await from('koutsi_videos').insert(video);
    throw storageErr;
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
