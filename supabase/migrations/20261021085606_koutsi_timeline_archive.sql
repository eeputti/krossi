-- Renewed Koutsi (koutsi/web) — APPLIED 2026-10-21 with the user's OK ("aja migraatio"), prod version 20261021085606.
--
-- 1. The player's Kehitys archive: "Muokkaa" → Piilota moves any timeline item into the player's
--    own Arkisto (one row per item, keyed by the timeline event's id, e.g. 'mood-<uuid>'). The
--    player writes their own rows; every linked coach can read them, so the coach's app leaves out
--    what the player archived and made themselves (domain/archive.js). removed_at = deleted from
--    the archive (for the coach's items, which the player cannot delete: they stay hidden).
-- 2. The player may delete lines of their own goal / wish / note history (from the archive).
-- 3. Changes of the "Mihin tähtäät?" aim are kept in koutsi_player_history (field 'ambition').
--
-- The old Koutsi never reads the new table, and reads only the fields 'goal', 'wish' and 'note'
-- from koutsi_player_history. Without this migration the new app hides "Muokkaa" and "Arkisto".

create table if not exists public.koutsi_timeline_archive (
  student_id uuid not null references public.koutsi_students(id) on delete cascade,
  item_key text not null check (char_length(item_key) between 1 and 120),
  archived_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (student_id, item_key)
);

alter table public.koutsi_timeline_archive enable row level security;

create policy koutsi_timeline_archive_select on public.koutsi_timeline_archive
  for select using (student_id = (select auth.uid()) or public.koutsi_is_linked_coach(student_id));
create policy koutsi_timeline_archive_insert on public.koutsi_timeline_archive
  for insert with check (student_id = (select auth.uid()));
create policy koutsi_timeline_archive_update on public.koutsi_timeline_archive
  for update using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy koutsi_timeline_archive_delete on public.koutsi_timeline_archive
  for delete using (student_id = (select auth.uid()));

grant select, insert, update, delete on public.koutsi_timeline_archive to authenticated;
revoke all on public.koutsi_timeline_archive from anon;

drop policy if exists koutsi_player_history_delete on public.koutsi_player_history;
create policy koutsi_player_history_delete on public.koutsi_player_history
  for delete using (student_id = (select auth.uid()));
grant delete on public.koutsi_player_history to authenticated;

alter table public.koutsi_player_history drop constraint if exists koutsi_player_history_field_check;
alter table public.koutsi_player_history add constraint koutsi_player_history_field_check
  check (field = any (array['goal'::text, 'wish'::text, 'note'::text, 'long_goal'::text, 'ambition'::text]));
