-- Make one logical video share addressable across all of its recipients. The file itself
-- is still stored once; koutsi_videos contains one authorising row per recipient.
alter table public.koutsi_videos
  add column if not exists share_id uuid;

-- Existing uploaded files were already shared by reusing storage_path. Existing link
-- shares were inserted in one statement, so their identical created_at groups them
-- without accidentally merging two later shares of the same URL.
with grouped as (
  select
    id,
    min(id::text) over (
      partition by
        case
          when storage_path is not null then 'file:' || storage_path
          else 'link:' || coalesce(added_by_id::text, '') || ':' || coalesce(external_url, '') || ':' ||
               title || ':' || date::text || ':' || created_at::text
        end
    )::uuid as resolved_share_id
  from public.koutsi_videos
)
update public.koutsi_videos v
   set share_id = g.resolved_share_id
  from grouped g
 where g.id = v.id
   and v.share_id is null;

alter table public.koutsi_videos
  alter column share_id set default gen_random_uuid(),
  alter column share_id set not null;

create unique index if not exists koutsi_videos_share_student_uidx
  on public.koutsi_videos (share_id, student_id);

create index if not exists koutsi_videos_storage_path_idx
  on public.koutsi_videos (storage_path)
  where storage_path is not null;

-- Every row must point to exactly one source. Uploaded objects must live under the
-- uploader's folder, so a recipient cannot manufacture a row that grants access to an
-- object owned by somebody else. Profiles can be deleted later (ON DELETE SET NULL), so
-- the folder check deliberately permits a null historical added_by_id.
alter table public.koutsi_videos
  drop constraint if exists koutsi_videos_one_source_check,
  add constraint koutsi_videos_one_source_check check (
    (storage_path is not null and external_url is null)
    or (storage_path is null and external_url is not null)
  ),
  drop constraint if exists koutsi_videos_external_url_check,
  add constraint koutsi_videos_external_url_check check (
    external_url is null or external_url ~* '^https?://'
  ),
  drop constraint if exists koutsi_videos_storage_owner_check,
  add constraint koutsi_videos_storage_owner_check check (
    storage_path is null
    or added_by_id is null
    or split_part(storage_path, '/', 1) = added_by_id::text
  ),
  drop constraint if exists koutsi_videos_size_bytes_check,
  add constraint koutsi_videos_size_bytes_check check (
    size_bytes is null or size_bytes > 0
  );

-- One authorisation predicate for INSERT/UPDATE/DELETE. A player may manage only their
-- own upload. A coach may manage a share only while actively linked to the recipient.
-- Admin acting mode may act as a coach, but never impersonates a player upload.
create or replace function public.koutsi_can_write_video(
  student_id_input uuid,
  added_by_id_input uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
     and added_by_id_input is not null
     and (
       (
         student_id_input = added_by_id_input
         and added_by_id_input = (select auth.uid())
       )
       or exists (
         select 1
           from public.koutsi_coach_students cs
           join public.koutsi_coaches c
             on c.id = cs.coach_id
            and c.archived_at is null
          where cs.student_id = student_id_input
            and cs.coach_id = added_by_id_input
            and cs.ended_at is null
            and public.koutsi_acts_as(added_by_id_input)
       )
     );
$function$;

revoke all on function public.koutsi_can_write_video(uuid, uuid) from public, anon;
grant execute on function public.koutsi_can_write_video(uuid, uuid) to authenticated, service_role;

drop policy if exists koutsi_videos_insert on public.koutsi_videos;
create policy koutsi_videos_insert
on public.koutsi_videos for insert
to authenticated
with check (
  public.koutsi_can_write_video(student_id, added_by_id)
  and (
    storage_path is null
    or split_part(storage_path, '/', 1) = added_by_id::text
  )
);

drop policy if exists koutsi_videos_update on public.koutsi_videos;
create policy koutsi_videos_update
on public.koutsi_videos for update
to authenticated
using (public.koutsi_can_write_video(student_id, added_by_id))
with check (
  public.koutsi_can_write_video(student_id, added_by_id)
  and (
    storage_path is null
    or split_part(storage_path, '/', 1) = added_by_id::text
  )
);

drop policy if exists koutsi_videos_delete on public.koutsi_videos;
create policy koutsi_videos_delete
on public.koutsi_videos for delete
to authenticated
using (public.koutsi_can_write_video(student_id, added_by_id));

-- A linked coach may watch a player's upload, but must not be able to delete the player's
-- underlying object directly. The uploader-folder policy and the existing tightly scoped
-- admin policy remain responsible for deletion.
drop policy if exists koutsi_videos_object_delete on storage.objects;
create policy koutsi_videos_object_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'koutsi-videos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Atomically change the audience of a coach-uploaded video. This keeps one file and one
-- logical share while adding/removing only the recipient authorisation rows.
create or replace function public.koutsi_set_video_recipients(
  share_id_input uuid,
  student_ids_input uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_video public.koutsi_videos%rowtype;
  v_student_ids uuid[];
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  select v.*
    into v_video
    from public.koutsi_videos v
   where v.share_id = share_id_input
   order by v.created_at, v.id
   limit 1;

  if not found then
    raise exception 'video share not found';
  end if;

  if v_video.added_by_id is null
     or not exists (
       select 1
         from public.koutsi_coaches c
        where c.id = v_video.added_by_id
          and c.archived_at is null
     )
     or not public.koutsi_acts_as(v_video.added_by_id)
  then
    raise exception 'not allowed';
  end if;

  select coalesce(array_agg(distinct requested_id), '{}'::uuid[])
    into v_student_ids
    from unnest(coalesce(student_ids_input, '{}'::uuid[])) requested_id;

  if cardinality(v_student_ids) = 0 then
    raise exception 'choose at least one recipient';
  end if;

  if exists (
    select 1
      from unnest(v_student_ids) requested_id
     where not exists (
       select 1
         from public.koutsi_coach_students cs
        where cs.coach_id = v_video.added_by_id
          and cs.student_id = requested_id
          and cs.ended_at is null
     )
  ) then
    raise exception 'recipient is not linked to this coach';
  end if;

  delete from public.koutsi_videos v
   where v.share_id = share_id_input
     and not (v.student_id = any(v_student_ids));

  insert into public.koutsi_videos (
    share_id, student_id, added_by_id, title, date, tags,
    storage_path, external_url, mime_type, size_bytes, created_at
  )
  select
    v_video.share_id, requested_id, v_video.added_by_id, v_video.title,
    v_video.date, v_video.tags, v_video.storage_path, v_video.external_url,
    v_video.mime_type, v_video.size_bytes, v_video.created_at
  from unnest(v_student_ids) requested_id
  where not exists (
    select 1
      from public.koutsi_videos existing
     where existing.share_id = share_id_input
       and existing.student_id = requested_id
  );
end;
$function$;

revoke all on function public.koutsi_set_video_recipients(uuid, uuid[]) from public, anon;
grant execute on function public.koutsi_set_video_recipients(uuid, uuid[]) to authenticated, service_role;

-- This project is currently on Supabase Free, whose global upload ceiling is 50 MiB.
-- Keep the bucket and the UI honest; long analyses are shared as an external private link.
update storage.buckets
   set file_size_limit = 52428800
 where id = 'koutsi-videos';
