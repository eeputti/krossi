-- Which parts of the renewed Koutsi coaches actually use. The coach app counts one row per tap
-- on the Merkitse menu, the quick buttons on the session/group/player pages, and each saved
-- note, homework or video (account.trackEvent). A row holds only the user and an event name
-- like 'merkitse.huomio' — never what was written or who it was for.
--
-- Ylläpito → Käyttö reads the tally through koutsi_admin_ui_events(), which keeps the admins'
-- own taps apart so testing doesn't inflate the numbers.
--
-- Additive only: a new table and two functions. The old Koutsi never calls them.

create table public.koutsi_ui_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null check (event ~ '^[a-z0-9._-]{1,64}$'),
  created_at timestamptz not null default now()
);

create index koutsi_ui_events_created_at_idx on public.koutsi_ui_events (created_at);
create index koutsi_ui_events_user_id_idx on public.koutsi_ui_events (user_id);

-- No policies: only the security-definer functions below touch this table.
alter table public.koutsi_ui_events enable row level security;

create function public.koutsi_track_ui_event(event_input text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  -- an unknown shape is dropped silently: analytics must never break a tap
  if event_input is null or event_input !~ '^[a-z0-9._-]{1,64}$' then
    return;
  end if;
  insert into public.koutsi_ui_events (user_id, event) values (auth.uid(), event_input);
end;
$function$;

revoke all on function public.koutsi_track_ui_event(text) from public, anon;
grant execute on function public.koutsi_track_ui_event(text) to authenticated;

create function public.koutsi_admin_ui_events(days_input integer default null)
returns table (
  event text,
  clicks integer,
  users integer,
  admin_clicks integer,
  last_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;

  return query
  select
    e.event,
    (count(*) filter (where a.user_id is null))::integer,
    (count(distinct e.user_id) filter (where a.user_id is null))::integer,
    (count(*) filter (where a.user_id is not null))::integer,
    max(e.created_at)
  from public.koutsi_ui_events e
  left join public.koutsi_admins a on a.user_id = e.user_id
  where days_input is null or e.created_at >= now() - make_interval(days => days_input)
  group by e.event
  order by 2 desc, 4 desc;
end;
$function$;

revoke all on function public.koutsi_admin_ui_events(integer) from public, anon;
grant execute on function public.koutsi_admin_ui_events(integer) to authenticated;
