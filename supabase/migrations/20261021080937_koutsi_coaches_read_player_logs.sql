-- Every coach of a player sees the player's own logs (koutsi_trainings rows with
-- logged_by = 'player': a run, the gym, own tennis, a tournament).
--
-- A row carries one coach_id (NOT NULL, and koutsi_trainings_player_insert checks it is one of
-- the player's coaches), and koutsi_trainings_select lets only that coach read it. So a player
-- with two coaches had to pick whom an entry was for, and the other coach never saw it. The
-- renewed Koutsi now treats an own log as the player's own — no coach to pick — and this adds
-- the read side: any coach the player currently has (koutsi_is_linked_coach: an active
-- koutsi_coach_students link, or an admin) can read the player's own logs.
--
-- Read only. Coaches still cannot change or delete another coach's rows (koutsi_trainings_update
-- and _delete stay on koutsi_acts_as(coach_id)); the player's own policies are untouched; a
-- coach whose coaching ended stops seeing them. Group and private sessions are not affected
-- (logged_by = 'coach').

drop policy if exists "koutsi_trainings_linked_coach_reads_player_logs" on public.koutsi_trainings;
create policy "koutsi_trainings_linked_coach_reads_player_logs" on public.koutsi_trainings
  for select to authenticated
  using (
    logged_by = 'player'
    and student_id is not null
    and public.koutsi_is_linked_coach(student_id)
  );

comment on policy "koutsi_trainings_linked_coach_reads_player_logs" on public.koutsi_trainings is
  'A player''s own log is readable by every coach the player currently has, not only the coach_id on the row.';
