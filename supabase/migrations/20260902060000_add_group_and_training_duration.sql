-- A group's weekly slot has always had a day and a time but no length, so the coach app
-- could never show an end time or know when one session's calendar block should stop.
-- Add a quarter-hour-only duration to both the group (its standing slot) and to
-- individual training rows (the materialized calendar occurrences, so a training keeps
-- its original length even if the group's default duration changes later).

alter table public.koutsi_groups
  add column duration_minutes integer not null default 60,
  add constraint koutsi_groups_duration_minutes_check
    check (duration_minutes > 0 and duration_minutes <= 480 and duration_minutes % 15 = 0);

alter table public.koutsi_trainings
  add column duration_minutes integer,
  add constraint koutsi_trainings_duration_minutes_check
    check (duration_minutes is null or (duration_minutes > 0 and duration_minutes <= 480 and duration_minutes % 15 = 0));

comment on column public.koutsi_groups.duration_minutes is
  'Standing session length for the group''s weekly slot, in minutes. Always a multiple of 15.';
comment on column public.koutsi_trainings.duration_minutes is
  'Session length in minutes for this occurrence. Null for older/private sessions that predate this column.';
