-- Keep the privileged implementation out of the exposed public schema. PostgREST sees
-- only the SECURITY INVOKER wrapper; the private function still re-checks auth.uid() and
-- koutsi_admins before it can write anything.
create schema if not exists koutsi_private;
revoke all on schema koutsi_private from public, anon;
grant usage on schema koutsi_private to authenticated, service_role;

alter function public.koutsi_admin_import_annual_plan(uuid, jsonb)
  set schema koutsi_private;

revoke all on function koutsi_private.koutsi_admin_import_annual_plan(uuid, jsonb)
  from public, anon;
grant execute on function koutsi_private.koutsi_admin_import_annual_plan(uuid, jsonb)
  to authenticated, service_role;

create function public.koutsi_admin_import_annual_plan(
  coach_id_input uuid,
  themes_input jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select koutsi_private.koutsi_admin_import_annual_plan(coach_id_input, themes_input);
$function$;

revoke all on function public.koutsi_admin_import_annual_plan(uuid, jsonb)
  from public, anon;
grant execute on function public.koutsi_admin_import_annual_plan(uuid, jsonb)
  to authenticated, service_role;
