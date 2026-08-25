alter table public.koutsi_coach_events
  add column if not exists end_date date;

alter table public.koutsi_coach_events
  drop constraint if exists koutsi_coach_events_end_date_not_before_start;

alter table public.koutsi_coach_events
  add constraint koutsi_coach_events_end_date_not_before_start
  check (end_date is null or end_date >= date);
