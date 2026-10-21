-- Renewed Koutsi (koutsi/web) — APPLIED 2026-10-21 with the user's OK ("aja migraatio"), prod version 20261021083503.
--
-- 1. The player's long-term aim: what kind of player they want to be (ambition: just for fun /
--    to get better / to compete / to reach the top) and, in their own words, where they are
--    heading ("Pelata A-tasolla 2028"). Only the player writes them, like goal / wish / note;
--    every coach of the player reads them with the student row. A change of the long-term goal
--    is kept in koutsi_player_history (field 'long_goal'), so Kehitys shows how it has changed.
-- 2. Which session a feeling is about (koutsi_moods.training_id), so a player who had three
--    sessions in a row can rate each one. Null = not tied to a session (as every mood so far).
--
-- The old Koutsi is not affected: it never selects these columns by name, and it reads
-- koutsi_player_history only for the fields 'goal', 'wish' and 'note'. The new app works without
-- this migration: the long-term goal stays hidden and only the latest session is asked about.

alter table public.koutsi_students
  add column if not exists long_goal text,
  add column if not exists ambition text;

alter table public.koutsi_students
  drop constraint if exists koutsi_students_long_goal_length,
  add constraint koutsi_students_long_goal_length check (long_goal is null or char_length(long_goal) <= 500),
  drop constraint if exists koutsi_students_ambition_check,
  add constraint koutsi_students_ambition_check check (ambition is null or ambition in ('harrastus', 'kehitys', 'kilpailu', 'huippu'));

-- Same function as before, plus the two new player-owned columns in the coach branch.
create or replace function public.koutsi_enforce_student_column_ownership()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.koutsi_claiming', true), '') = 'on' then
    return new;
  end if;
  if auth.uid() = old.id then
    new.background := old.background;
    new.last_session_note := old.last_session_note;
    new.focus := old.focus;
    new.level := old.level;
  else
    new.goal := old.goal;
    new.player_note := old.player_note;
    new.player_wish := old.player_wish;
    new.long_goal := old.long_goal;
    new.ambition := old.ambition;
  end if;
  new.pilot_age_group := old.pilot_age_group;
  new.minor_notice_confirmed_at := old.minor_notice_confirmed_at;
  new.minor_notice_confirmed_by := old.minor_notice_confirmed_by;
  new.guardian_approval_confirmed_at := old.guardian_approval_confirmed_at;
  new.guardian_approval_confirmed_by := old.guardian_approval_confirmed_by;
  return new;
end;
$function$;

alter table public.koutsi_player_history drop constraint if exists koutsi_player_history_field_check;
alter table public.koutsi_player_history add constraint koutsi_player_history_field_check
  check (field = any (array['goal'::text, 'wish'::text, 'note'::text, 'long_goal'::text]));

alter table public.koutsi_moods
  add column if not exists training_id uuid references public.koutsi_trainings(id) on delete set null;
create index if not exists koutsi_moods_training on public.koutsi_moods (training_id) where training_id is not null;
