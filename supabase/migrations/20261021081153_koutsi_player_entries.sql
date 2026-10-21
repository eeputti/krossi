-- Renewed Koutsi (koutsi/web): the player's own entries on the Kehitys page —
-- "what I did, when, and how it went" ("Tein tätä ja tätä, silloin, ja näin meni").
--
-- One row per entry. The player writes, edits and deletes their own rows; every coach the
-- player is linked to (koutsi_is_linked_coach, like the goal history, notes and matches) and an
-- admin can read them. Nothing else changes: the old Koutsi never reads this table, and the new
-- app works without it (the Merkintä button stays hidden until the table exists).
--
-- Applied 2026-10-21 with the user's go-ahead (prod version 20261021081153).
--
-- Merges and claims need no change: koutsi_merge_students only removes unclaimed placeholder
-- players and koutsi_claim_player moves a placeholder's rows — neither can have entries, since
-- only a signed-in player writes one. Account deletion removes them with the student row.

create table if not exists public.koutsi_player_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.koutsi_students(id) on delete cascade,
  date date not null default current_date,
  text text not null check (char_length(btrim(text)) between 1 and 2000),
  how text check (how is null or char_length(how) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists koutsi_player_entries_student on public.koutsi_player_entries (student_id, date desc);

alter table public.koutsi_player_entries enable row level security;

create policy koutsi_player_entries_select on public.koutsi_player_entries
  for select using (student_id = (select auth.uid()) or public.koutsi_is_linked_coach(student_id));
create policy koutsi_player_entries_insert on public.koutsi_player_entries
  for insert with check (student_id = (select auth.uid()));
create policy koutsi_player_entries_update on public.koutsi_player_entries
  for update using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy koutsi_player_entries_delete on public.koutsi_player_entries
  for delete using (student_id = (select auth.uid()));

grant select, insert, update, delete on public.koutsi_player_entries to authenticated;
revoke all on public.koutsi_player_entries from anon;

-- Live updates: an open coach view refreshes when the player adds an entry.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'koutsi_player_entries') then
    execute 'alter publication supabase_realtime add table public.koutsi_player_entries';
  end if;
end $$;
