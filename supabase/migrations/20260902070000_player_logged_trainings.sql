-- Every koutsi_trainings row has so far come from the coach: a player had no way to log
-- their own practice (self-directed drills, physical training, another sport) alongside
-- what the coach assigns. Adds who logged a session and a free-text note, then lets a
-- player insert/edit/delete their own individual (non-group) sessions.
--
-- Reuses the existing free-text `type` column for the category label ("Omatoiminen
-- harjoitus" / "Fysiikka" / "Muu liikunta") instead of adding a second column — `type` is
-- already what every screen displays directly (koutsiTrainingsView, the Kehitys timeline,
-- the coach's calendar), so a player-logged session needs no extra plumbing to show up.
--
-- coach_id stays NOT NULL, so a player can only log practice once they have an active
-- coach — koutsi_is_my_coach() is the same check koutsi_coach_events already uses to
-- authorise a student reading their coach's events.

alter table public.koutsi_trainings
  add column logged_by text not null default 'coach'
    check (logged_by in ('coach', 'player')),
  add column notes text;

comment on column public.koutsi_trainings.logged_by is
  'Who created this session: the coach (or an admin acting as one), or the player logging their own practice.';
comment on column public.koutsi_trainings.notes is
  'Free-text note on a player-logged session, e.g. what they did or who they played with.';

create policy "koutsi_trainings_player_insert" on public.koutsi_trainings
  for insert to authenticated
  with check (
    logged_by = 'player'
    and student_id = (select auth.uid())
    and group_id is null
    and public.koutsi_is_my_coach(coach_id)
  );

create policy "koutsi_trainings_player_update" on public.koutsi_trainings
  for update to authenticated
  using (logged_by = 'player' and student_id = (select auth.uid()))
  with check (
    logged_by = 'player'
    and student_id = (select auth.uid())
    and group_id is null
    and public.koutsi_is_my_coach(coach_id)
  );

create policy "koutsi_trainings_player_delete" on public.koutsi_trainings
  for delete to authenticated
  using (logged_by = 'player' and student_id = (select auth.uid()));
