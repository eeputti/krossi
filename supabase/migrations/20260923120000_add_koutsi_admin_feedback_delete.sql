-- koutsi_admin_feedback() (20260916150000) gave admins a read-only feedback feed, but
-- koutsi_feedback only has an insert policy (20260916090000) — clearing out handled or
-- spammy entries needed a service-role query. Same security-definer pattern as the read
-- RPC: admin check inside the function, RLS on the table stays insert-only.

create function public.koutsi_admin_delete_feedback(feedback_id_input uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;

  delete from public.koutsi_feedback where id = feedback_id_input;
end;
$function$;

revoke all on function public.koutsi_admin_delete_feedback(uuid) from public, anon;
grant execute on function public.koutsi_admin_delete_feedback(uuid) to authenticated, service_role;
