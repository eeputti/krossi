-- Ylläpito wants to see how often each account actually opens the app, not just when it
-- was created. auth.users already has last_sign_in_at for "last login" — this adds the
-- other half: a per-app open counter, incremented client-side once per real app launch
-- (see koutsi-auth.jsx / krossi-web-app.jsx), not on every tab-refocus token refresh.
-- Shared by all three apps (koutsi-valmentaja, koutsi-pelaaja, krossi-web) since they're
-- all the same Supabase project/auth.users, same pattern as koutsi_admins being reused
-- for krossi_is_admin().
create table public.koutsi_app_opens (
  user_id uuid not null references auth.users(id) on delete cascade,
  app text not null,
  open_count integer not null default 0,
  first_opened_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  primary key (user_id, app)
);

-- No policies: this table is only ever touched through the security-definer functions
-- below, never queried directly by clients.
alter table public.koutsi_app_opens enable row level security;

create function public.koutsi_record_app_open(app_input text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  insert into public.koutsi_app_opens (user_id, app, open_count, first_opened_at, last_opened_at)
  values (auth.uid(), coalesce(nullif(btrim(app_input), ''), 'unknown'), 1, now(), now())
  on conflict (user_id, app) do update
    set open_count = public.koutsi_app_opens.open_count + 1,
        last_opened_at = now();
end;
$function$;

revoke all on function public.koutsi_record_app_open(text) from public, anon;
grant execute on function public.koutsi_record_app_open(text) to authenticated;
