-- A coach can attach one playable video to an exercise. The source is either a private
-- Storage object or an external HTTPS link, matching the two video choices elsewhere in
-- Koutsi. Keeping the metadata on the exercise makes the card's "has video" state cheap.
alter table public.koutsi_exercises
  add column if not exists video_title text,
  add column if not exists video_storage_path text,
  add column if not exists video_external_url text,
  add column if not exists video_mime_type text,
  add column if not exists video_size_bytes bigint;

alter table public.koutsi_exercises
  drop constraint if exists koutsi_exercises_video_source_check,
  add constraint koutsi_exercises_video_source_check check (
    (
      video_storage_path is null
      and video_external_url is null
      and video_title is null
      and video_mime_type is null
      and video_size_bytes is null
    )
    or (
      video_storage_path is not null
      and video_external_url is null
      and nullif(btrim(video_title), '') is not null
      and video_mime_type like 'video/%'
      and video_size_bytes > 0
    )
    or (
      video_storage_path is null
      and video_external_url is not null
      and nullif(btrim(video_title), '') is not null
      and video_mime_type is null
      and video_size_bytes is null
    )
  ),
  drop constraint if exists koutsi_exercises_video_external_url_check,
  add constraint koutsi_exercises_video_external_url_check check (
    video_external_url is null or video_external_url ~* '^https?://'
  ),
  drop constraint if exists koutsi_exercises_video_storage_owner_check,
  add constraint koutsi_exercises_video_storage_owner_check check (
    video_storage_path is null
    or split_part(video_storage_path, '/', 1) = coach_id::text
  );

create index if not exists koutsi_exercises_video_storage_path_idx
  on public.koutsi_exercises (video_storage_path)
  where video_storage_path is not null;

-- Exercises are already visible to their coach and to that coach's linked players. Give
-- the referenced private object exactly the same read boundary. Upload and deletion stay
-- under the existing uploader-folder and admin-acting policies.
drop policy if exists koutsi_exercise_videos_storage_select on storage.objects;
create policy koutsi_exercise_videos_storage_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'koutsi-videos'
  and exists (
    select 1
      from public.koutsi_exercises exercise
     where exercise.video_storage_path = storage.objects.name
       and (
         public.koutsi_acts_as(exercise.coach_id)
         or public.koutsi_is_my_coach(exercise.coach_id)
       )
  )
);
