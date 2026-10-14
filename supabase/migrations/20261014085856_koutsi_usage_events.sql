-- Ylläpito → Käyttö: what the Koutsi apps are actually used for, without knowing by whom.
--
-- Both Koutsi apps (the old lib/ app and the renewed koutsi/web) send small batches of
-- events from lib/koutsi-usage.js: which page was opened, which control was tapped (its UI
-- text only when the text is the app's own wording, never a name), errors people ran into,
-- and when the tab was hidden. A row carries a random per-visit session id, never a user id,
-- name or e-mail. The caller must be signed in (keeps strangers from filling the table), and
-- the function only looks at who they are to mark admins' and test accounts' own events as
-- is_test, so testing doesn't skew the numbers.
--
-- Rows older than 180 days are deleted every night (pg_cron). The privacy notice
-- (koutsi-tietosuoja.html, "Käyttötilastot") says the same.
--
-- Additive only: two new tables and three functions; nothing existing changes.
-- Applied to production 2026-10-14 with the user's go-ahead (version 20261014085856).

create table public.koutsi_usage_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  session_id uuid not null,
  app text not null check (app in ('vanha', 'uusi')),
  role text not null check (role in ('valmentaja', 'pelaaja')),
  device text not null check (device in ('puhelin', 'tabletti', 'kone')),
  kind text not null check (kind in ('view', 'click', 'error', 'hide')),
  path text not null check (char_length(path) between 1 and 80),
  label text check (char_length(label) <= 80),
  target text check (target in ('nappi', 'linkki', 'välilehti', 'valinta', 'kenttä', 'kortti')),
  x smallint check (x between 0 and 1000),
  y smallint check (y between 0 and 1000),
  detail text check (char_length(detail) <= 300),
  is_test boolean not null default false
);

create index koutsi_usage_events_at_idx on public.koutsi_usage_events (at);
create index koutsi_usage_events_session_idx on public.koutsi_usage_events (session_id, at);

-- No policies: only the security-definer functions below touch this table.
alter table public.koutsi_usage_events enable row level security;
revoke all on public.koutsi_usage_events from anon, authenticated;

-- Accounts whose events count as testing besides the admins (koutsi_admins).
create table public.koutsi_usage_test_accounts (
  email text primary key check (email = lower(email)),
  note text,
  created_at timestamptz not null default now()
);
alter table public.koutsi_usage_test_accounts enable row level security;  -- no policies: functions only
revoke all on public.koutsi_usage_test_accounts from anon, authenticated;

insert into public.koutsi_usage_test_accounts (email, note) values
  ('eelispuro+pelaaja@gmail.com', 'omistajan testipelaaja')
on conflict (email) do nothing;

-- ── writing ─────────────────────────────────────────────────────────────────
-- batch = { s: session uuid, a: 'vanha'|'uusi', r: 'valmentaja'|'pelaaja', d: device,
--           e: [{ k: kind, p: path, l: label, g: target, x, y, m: detail, t: ms ago }] }
-- Anything malformed is dropped quietly: analytics must never break the app.
create function public.koutsi_track_usage(batch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_session uuid;
  v_test boolean;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if batch is null or jsonb_typeof(batch) <> 'object' or jsonb_typeof(batch->'e') <> 'array' then
    return;
  end if;
  if coalesce(batch->>'s', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(batch->>'a', '') not in ('vanha', 'uusi')
     or coalesce(batch->>'r', '') not in ('valmentaja', 'pelaaja')
     or coalesce(batch->>'d', '') not in ('puhelin', 'tabletti', 'kone') then
    return;
  end if;
  v_session := (batch->>'s')::uuid;

  v_test := exists (select 1 from public.koutsi_admins a where a.user_id = v_uid)
         or exists (
              select 1 from auth.users u
                join public.koutsi_usage_test_accounts t on t.email = lower(u.email)
               where u.id = v_uid
            );

  insert into public.koutsi_usage_events (at, session_id, app, role, device, kind, path, label, target, x, y, detail, is_test)
  select
    now() - make_interval(secs => (case when e->>'t' ~ '^[0-9]{1,15}$' then least((e->>'t')::bigint, 86400000) else 0 end) / 1000.0),
    v_session, batch->>'a', batch->>'r', batch->>'d',
    e->>'k',
    left(e->>'p', 80),
    nullif(left(btrim(coalesce(e->>'l', '')), 80), ''),
    case when e->>'g' in ('nappi', 'linkki', 'välilehti', 'valinta', 'kenttä', 'kortti') then e->>'g' end,
    case when e->>'x' ~ '^[0-9]{1,4}$' and (e->>'x')::integer <= 1000 then (e->>'x')::smallint end,
    case when e->>'y' ~ '^[0-9]{1,4}$' and (e->>'y')::integer <= 1000 then (e->>'y')::smallint end,
    nullif(left(coalesce(e->>'m', ''), 300), ''),
    v_test
  from jsonb_array_elements(batch->'e') with ordinality as x(e, n)
  where x.n <= 100
    and jsonb_typeof(e) = 'object'
    and e->>'k' in ('view', 'click', 'error', 'hide')
    and coalesce(e->>'p', '') <> '';
end;
$function$;

revoke all on function public.koutsi_track_usage(jsonb) from public, anon;
grant execute on function public.koutsi_track_usage(jsonb) to authenticated;

-- ── reading (Ylläpito) ──────────────────────────────────────────────────────
-- Everything the Käyttö view shows, in one call. Every aggregate keeps app and role apart so
-- the view can filter (valmentaja/pelaaja, vanha/uusi) without asking again; a session
-- belongs to exactly one app and role, so the view may sum session counts across them.
-- Times are bucketed in Europe/Helsinki.
create function public.koutsi_admin_usage(days_input integer default 30, include_test boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  -- whole days in Helsinki: "30 days" is today and the 29 days before it
  v_since timestamptz := (date_trunc('day', now() at time zone 'Europe/Helsinki')
                          - make_interval(days => greatest(1, least(coalesce(days_input, 30), 400)) - 1)) at time zone 'Europe/Helsinki';
  v_result jsonb;
begin
  if not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;

  with ev as (
    select e.*,
           (e.at at time zone 'Europe/Helsinki') as local_at,
           lead(e.at) over (partition by e.session_id order by e.at, e.id) as next_at
      from public.koutsi_usage_events e
     where e.at >= v_since
       and (include_test or not e.is_test)
  ),
  recent as (
    select session_id, max(at) as last_at
      from ev
     group by session_id
     order by max(at) desc
     limit 40
  )
  select jsonb_build_object(
    'since', v_since,
    'testEvents', (select count(*) from public.koutsi_usage_events t where t.at >= v_since and t.is_test),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('app', app, 'role', role, 'sessions', sessions, 'views', views,
                                          'clicks', clicks, 'errors', errors, 'days', days))
        from (select app, role, count(distinct session_id) as sessions,
                     count(*) filter (where kind = 'view' and label is distinct from 'paluu') as views,
                     count(*) filter (where kind = 'click') as clicks,
                     count(*) filter (where kind = 'error') as errors,
                     count(distinct local_at::date) as days
                from ev group by app, role) x), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(d order by d->>'day')
        from (select jsonb_build_object('day', local_at::date, 'app', app, 'role', role,
                                        'sessions', count(distinct session_id)) as d
                from ev group by local_at::date, app, role) x), '[]'::jsonb),
    'heat', coalesce((
      select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'app', app, 'role', role, 'sessions', sessions))
        from (select extract(isodow from local_at)::integer as dow, extract(hour from local_at)::integer as hour,
                     app, role, count(distinct session_id) as sessions
                from ev group by 1, 2, 3, 4) x), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('device', device, 'app', app, 'role', role, 'sessions', sessions))
        from (select device, app, role, count(distinct session_id) as sessions from ev group by 1, 2, 3) x), '[]'::jsonb),
    'views', coalesce((
      select jsonb_agg(jsonb_build_object('app', app, 'role', role, 'path', path, 'views', views,
                                          'sessions', sessions, 'seconds', seconds) order by views desc)
        from (select app, role, path,
                     count(*) filter (where label is distinct from 'paluu') as views,
                     count(distinct session_id) as sessions,
                     round(avg(least(extract(epoch from (next_at - at)), 600)) filter (where next_at is not null))::integer as seconds
                from ev where kind = 'view'
               group by app, role, path
               order by 4 desc
               limit 120) x), '[]'::jsonb),
    'clicks', coalesce((
      select jsonb_agg(jsonb_build_object('app', app, 'role', role, 'path', path, 'label', label, 'target', target,
                                          'clicks', clicks, 'sessions', sessions) order by clicks desc)
        from (select app, role, path, label, target, count(*) as clicks, count(distinct session_id) as sessions
                from ev where kind = 'click'
               group by app, role, path, label, target
               order by 6 desc
               limit 400) x), '[]'::jsonb),
    'errors', coalesce((
      select jsonb_agg(jsonb_build_object('app', app, 'role', role, 'path', path, 'label', label, 'message', detail,
                                          'count', n, 'sessions', sessions, 'firstAt', first_at, 'lastAt', last_at)
                       order by last_at desc)
        from (select app, role, path, label, detail, count(*) as n, count(distinct session_id) as sessions,
                     min(at) as first_at, max(at) as last_at
                from ev where kind = 'error'
               group by app, role, path, label, detail
               order by max(at) desc
               limit 100) x), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(s order by s->>'lastAt' desc)
        from (select jsonb_build_object(
                       'id', r.session_id, 'lastAt', r.last_at,
                       'app', min(e.app), 'role', min(e.role), 'device', min(e.device),
                       'events', jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'path', e.path,
                                                              'label', e.label, 'target', e.target, 'message', e.detail)
                                           order by e.at, e.id)) as s
                from recent r
                join lateral (select * from ev where ev.session_id = r.session_id order by ev.at, ev.id limit 150) e on true
               group by r.session_id, r.last_at) x), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.koutsi_admin_usage(integer, boolean) from public, anon;
grant execute on function public.koutsi_admin_usage(integer, boolean) to authenticated;

-- ── retention ───────────────────────────────────────────────────────────────
create function public.koutsi_prune_usage_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_deleted integer;
begin
  delete from public.koutsi_usage_events where at < now() - interval '180 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke all on function public.koutsi_prune_usage_events() from public, anon, authenticated;
grant execute on function public.koutsi_prune_usage_events() to service_role;

-- Every night at 03:17 UTC. Idempotent: an existing job of the same name is replaced.
do $$
declare v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'koutsi-usage-prune' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule('koutsi-usage-prune', '17 3 * * *', 'select public.koutsi_prune_usage_events()');
end;
$$;
