-- Lets a player mark a tournament on their own calendar. koutsi_coach_events was
-- considered for this (it already has end_date), but its SELECT policy shows every row
-- to a coach's *entire* roster ("Seuran tapahtuma") — a player's personal tournament
-- would leak onto every other player's calendar under that coach. koutsi_trainings is
-- already scoped per-student (see 20260902070000_player_logged_trainings.sql), so a
-- multi-day self-logged entry just needs an optional end date, same idea as
-- koutsi_coach_events.end_date.
alter table public.koutsi_trainings
  add column end_date date
    check (end_date is null or end_date >= date);

comment on column public.koutsi_trainings.end_date is
  'Optional last day for a player-logged multi-day entry (e.g. a tournament). Null for a single-day session.';
