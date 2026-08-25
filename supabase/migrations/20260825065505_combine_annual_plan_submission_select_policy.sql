-- Keep coach/admin visibility in one permissive SELECT policy. This has the same access
-- result as two policies, but Postgres evaluates one policy per row instead of two.
drop policy if exists koutsi_annual_plan_submissions_coach_select
  on public.koutsi_annual_plan_submissions;
drop policy if exists koutsi_annual_plan_submissions_admin_select
  on public.koutsi_annual_plan_submissions;
drop policy if exists koutsi_annual_plan_submissions_select
  on public.koutsi_annual_plan_submissions;

create policy koutsi_annual_plan_submissions_select
on public.koutsi_annual_plan_submissions
for select to authenticated
using (
  (select auth.uid()) = coach_id
  or (select public.koutsi_is_admin())
);
