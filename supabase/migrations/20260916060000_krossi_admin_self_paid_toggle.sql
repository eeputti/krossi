-- Lets a Krossi admin flip their OWN paid_at on/off from the profile screen,
-- so they can preview the free vs. paid experience without paying via Stripe.
-- `authenticated` has no UPDATE grant on profiles.paid_at (see the column-grants
-- lockdown that keeps regular users from self-granting paid status), so this
-- has to go through a SECURITY DEFINER function the same way krossi_admin_* do.
create or replace function public.krossi_set_own_paid_status(p_paid boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_paid_at timestamptz;
begin
  if not public.krossi_is_admin() then
    raise exception 'not allowed';
  end if;

  v_paid_at := case when p_paid then now() else null end;

  update public.profiles set paid_at = v_paid_at where id = (select auth.uid());

  return v_paid_at;
end;
$function$;

revoke all on function public.krossi_set_own_paid_status(boolean) from public, anon;
grant execute on function public.krossi_set_own_paid_status(boolean) to authenticated;
