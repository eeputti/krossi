-- Lähetetyt and the coach's own videos (new Koutsi).
-- Applied 26.10.2026 after the user's "aja migraatio" as version 20261026084331 (the comments were
-- trimmed in the applied copy; the SQL is the same).
-- Check: koutsi/web/sql/20261026084331_koutsi_sends_and_video_library.check.mjs
--
-- A coach could not see what they had sent: a shared video or a homework showed only on each
-- player's own page, one player at a time, and a homework did not even record which coach gave
-- it or that twelve copies went out together.
--
-- 1. koutsi_coach_videos — the coach's own videos ("Harjoitteet ja videot" → Videot). Every video
--    the coach shares lands here and stays, also after no player has it any more, so it can be
--    shared again without uploading it again. Its id is the share_id of the koutsi_videos rows
--    that let players watch it: the file is stored once, in the coach's own storage folder (the
--    existing storage policies already let the coach read and delete it).
-- 2. koutsi_sends — one row per sending: a video, a homework or a note (Huomio) to some groups and
--    players. The coach's Lähetetyt page and a group's "Ryhmälle lähetetty" read it. Only the coach
--    (or an admin acting as them) reads or writes it; players never see it.
-- 3. koutsi_homework.coach_id / send_id and koutsi_diary_entries.send_id tie each player's copy to
--    its sending: "3/8 tehty", change or remove every copy at once. Both are nullable, so the old
--    app and a player's own rows go on exactly as before.
--
-- Tiedotteet are already one row per sending (koutsi_announcements) and need nothing new.
-- Production had 0 koutsi_videos and 0 koutsi_homework rows on 26.10.2026: nothing to convert.

-- ── 1. The coach's videos ─────────────────────────────────────────────────────────────────────
create table if not exists public.koutsi_coach_videos (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  title text not null,
  tags text[] not null default '{}',
  storage_path text,
  external_url text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  constraint koutsi_coach_videos_title_check check (char_length(btrim(title)) between 1 and 200),
  constraint koutsi_coach_videos_one_source_check check ((storage_path is null) <> (external_url is null)),
  constraint koutsi_coach_videos_external_url_check check (external_url is null or external_url ~* '^https?://'),
  -- the same rule as koutsi_videos: a file must live in the coach's own folder
  constraint koutsi_coach_videos_storage_owner_check check (storage_path is null or split_part(storage_path, '/', 1) = coach_id::text),
  constraint koutsi_coach_videos_size_bytes_check check (size_bytes is null or size_bytes > 0)
);

create index if not exists koutsi_coach_videos_coach_idx on public.koutsi_coach_videos (coach_id, created_at desc);

alter table public.koutsi_coach_videos enable row level security;

drop policy if exists koutsi_coach_videos_select on public.koutsi_coach_videos;
create policy koutsi_coach_videos_select on public.koutsi_coach_videos
  for select to authenticated using (public.koutsi_acts_as(coach_id));
drop policy if exists koutsi_coach_videos_insert on public.koutsi_coach_videos;
create policy koutsi_coach_videos_insert on public.koutsi_coach_videos
  for insert to authenticated with check (public.koutsi_acts_as(coach_id));
drop policy if exists koutsi_coach_videos_update on public.koutsi_coach_videos;
create policy koutsi_coach_videos_update on public.koutsi_coach_videos
  for update to authenticated using (public.koutsi_acts_as(coach_id)) with check (public.koutsi_acts_as(coach_id));
drop policy if exists koutsi_coach_videos_delete on public.koutsi_coach_videos;
create policy koutsi_coach_videos_delete on public.koutsi_coach_videos
  for delete to authenticated using (public.koutsi_acts_as(coach_id));

revoke all on public.koutsi_coach_videos from anon;
revoke update on public.koutsi_coach_videos from authenticated;
grant select, insert, delete on public.koutsi_coach_videos to authenticated;
-- only the name and the topics change after saving; the file and the owner never do
grant update (title, tags) on public.koutsi_coach_videos to authenticated;

-- ── 2. Sendings ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.koutsi_sends (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  kind text not null,
  -- a video's sendings go with the video
  video_id uuid references public.koutsi_coach_videos(id) on delete cascade,
  -- sendings of the same thing share it: the video's id, or the first sending's id for a homework
  -- or a note sent on later with "Lähetä myös muille"
  ref_id uuid not null,
  -- the video's name or the text as it was sent
  title text not null,
  group_ids uuid[] not null default '{}',
  student_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint koutsi_sends_kind_check check (kind in ('video', 'homework', 'note')),
  constraint koutsi_sends_video_check check ((kind = 'video') = (video_id is not null) and (video_id is null or ref_id = video_id)),
  constraint koutsi_sends_title_check check (char_length(btrim(title)) between 1 and 4000),
  constraint koutsi_sends_audience_check check (cardinality(student_ids) between 1 and 400 and cardinality(group_ids) <= 60)
);

create index if not exists koutsi_sends_coach_idx on public.koutsi_sends (coach_id, created_at desc);
create index if not exists koutsi_sends_ref_idx on public.koutsi_sends (ref_id);
create index if not exists koutsi_sends_video_idx on public.koutsi_sends (video_id) where video_id is not null;

alter table public.koutsi_sends enable row level security;

drop policy if exists koutsi_sends_select on public.koutsi_sends;
create policy koutsi_sends_select on public.koutsi_sends
  for select to authenticated using (public.koutsi_acts_as(coach_id));

-- Like a tiedote: only the coach's own groups, current players and videos.
drop policy if exists koutsi_sends_insert on public.koutsi_sends;
create policy koutsi_sends_insert on public.koutsi_sends
  for insert to authenticated
  with check (
    public.koutsi_acts_as(coach_id)
    and (video_id is null or exists (
      select 1 from public.koutsi_coach_videos v where v.id = koutsi_sends.video_id and v.coach_id = koutsi_sends.coach_id
    ))
    and not exists (
      select 1 from unnest(group_ids) as gid
      where not exists (select 1 from public.koutsi_groups g where g.id = gid and g.coach_id = koutsi_sends.coach_id)
    )
    and not exists (
      select 1 from unnest(student_ids) as sid
      where not exists (
        select 1 from public.koutsi_coach_students cs
        where cs.student_id = sid and cs.coach_id = koutsi_sends.coach_id and cs.ended_at is null
      )
    )
  );

drop policy if exists koutsi_sends_update on public.koutsi_sends;
create policy koutsi_sends_update on public.koutsi_sends
  for update to authenticated using (public.koutsi_acts_as(coach_id)) with check (public.koutsi_acts_as(coach_id));

drop policy if exists koutsi_sends_delete on public.koutsi_sends;
create policy koutsi_sends_delete on public.koutsi_sends
  for delete to authenticated using (public.koutsi_acts_as(coach_id));

revoke all on public.koutsi_sends from anon;
revoke update on public.koutsi_sends from authenticated;
grant select, insert, delete on public.koutsi_sends to authenticated;
-- an edited homework or note keeps its log line in step; who got it never changes afterwards
grant update (title) on public.koutsi_sends to authenticated;

-- A deleted player leaves no trace in a sending; a sending left with nobody is deleted (its text
-- may have been about that one player).
create or replace function public.koutsi_scrub_send_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  delete from public.koutsi_sends
   where student_ids @> array[old.id] and cardinality(array_remove(student_ids, old.id)) = 0;
  update public.koutsi_sends set student_ids = array_remove(student_ids, old.id) where student_ids @> array[old.id];
  return old;
end;
$function$;

revoke all on function public.koutsi_scrub_send_student() from public, anon, authenticated;

drop trigger if exists koutsi_students_scrub_sends on public.koutsi_students;
create trigger koutsi_students_scrub_sends
  after delete on public.koutsi_students
  for each row execute function public.koutsi_scrub_send_student();

-- ── 3. Each copy knows its sending ────────────────────────────────────────────────────────────
alter table public.koutsi_homework
  add column if not exists coach_id uuid references public.koutsi_coaches(id) on delete set null,
  add column if not exists send_id uuid references public.koutsi_sends(id) on delete set null;

alter table public.koutsi_diary_entries
  add column if not exists send_id uuid references public.koutsi_sends(id) on delete set null;

create index if not exists koutsi_homework_send_idx on public.koutsi_homework (send_id) where send_id is not null;
create index if not exists koutsi_diary_entries_send_idx on public.koutsi_diary_entries (send_id) where send_id is not null;
