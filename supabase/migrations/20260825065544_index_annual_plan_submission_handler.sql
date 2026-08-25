create index if not exists koutsi_annual_plan_submissions_handled_by_idx
  on public.koutsi_annual_plan_submissions (handled_by)
  where handled_by is not null;
