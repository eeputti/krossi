-- A player could log a tournament ("Turnaus" self-training entry, see
-- 20260902070000_player_logged_trainings.sql / 20260902073000_self_training_tournament_end_date.sql)
-- and log individual matches (20260902071500_match_note_result_fields.sql), but nothing tied
-- the two together — a tournament with three matches showed up as four unrelated calendar
-- entries. Lets a match note optionally point at the koutsi_trainings row for the tournament
-- it was played at, so the app can group and count matches under their tournament.

alter table public.koutsi_match_notes
  add column if not exists tournament_id uuid references public.koutsi_trainings(id) on delete set null;

comment on column public.koutsi_match_notes.tournament_id is
  'Optional link to the koutsi_trainings row (type = ''Turnaus'') this match was played at.';

create index if not exists koutsi_match_notes_tournament_id_idx on public.koutsi_match_notes(tournament_id);

-- Re-declare insert/update WITH CHECK so a match can only be linked to a Turnaus entry the
-- same player owns — koutsi_match_notes' own RLS (student_id = auth.uid()) says nothing
-- about tournament_id, so without this a player could attach their match note to any
-- other player's training row by guessing/enumerating its id.
drop policy if exists "koutsi_match_notes_insert" on public.koutsi_match_notes;
create policy "koutsi_match_notes_insert" on public.koutsi_match_notes
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and (
      tournament_id is null
      or exists (
        select 1 from public.koutsi_trainings t
        where t.id = tournament_id and t.student_id = (select auth.uid()) and t.type = 'Turnaus'
      )
    )
  );

drop policy if exists "koutsi_match_notes_update" on public.koutsi_match_notes;
create policy "koutsi_match_notes_update" on public.koutsi_match_notes
  for update to authenticated
  using (student_id = (select auth.uid()))
  with check (
    student_id = (select auth.uid())
    and (
      tournament_id is null
      or exists (
        select 1 from public.koutsi_trainings t
        where t.id = tournament_id and t.student_id = (select auth.uid()) and t.type = 'Turnaus'
      )
    )
  );
