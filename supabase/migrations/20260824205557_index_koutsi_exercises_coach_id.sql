-- Exercise lists are always loaded per coach, and this also covers the coach foreign key.
create index if not exists koutsi_exercises_coach_id_idx
  on public.koutsi_exercises (coach_id);
