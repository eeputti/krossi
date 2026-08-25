-- A coach may send one workbook that covers several groups. It is a review submission,
-- not a direct theme import: admins receive it in their queue, open the coach view and
-- make the reviewed changes there.
create table public.koutsi_annual_plan_submissions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  filename text not null check (length(filename) between 1 and 240 and lower(filename) like '%.xlsx'),
  storage_path text not null unique check (
    storage_path ~ '^shared/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]xlsx$'
  ),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  status text not null default 'pending' check (status in ('pending', 'handled')),
  uploaded_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references auth.users(id) on delete set null,
  check (
    (status = 'pending' and handled_at is null and handled_by is null)
    or (status = 'handled' and handled_at is not null)
  )
);

create index koutsi_annual_plan_submissions_coach_status_idx
  on public.koutsi_annual_plan_submissions (coach_id, status, uploaded_at desc);
create index koutsi_annual_plan_submissions_handled_by_idx
  on public.koutsi_annual_plan_submissions (handled_by)
  where handled_by is not null;

alter table public.koutsi_annual_plan_submissions enable row level security;
revoke all on table public.koutsi_annual_plan_submissions from public, anon;
grant select, insert, update on table public.koutsi_annual_plan_submissions to authenticated, service_role;

create policy koutsi_annual_plan_submissions_select
on public.koutsi_annual_plan_submissions
for select to authenticated
using (
  (select auth.uid()) = coach_id
  or (select public.koutsi_is_admin())
);

create policy koutsi_annual_plan_submissions_coach_insert
on public.koutsi_annual_plan_submissions
for insert to authenticated
with check (
  (select auth.uid()) = coach_id
  and status = 'pending'
  and handled_at is null
  and handled_by is null
);

create policy koutsi_annual_plan_submissions_admin_update
on public.koutsi_annual_plan_submissions
for update to authenticated
using ((select public.koutsi_is_admin()))
with check ((select public.koutsi_is_admin()));

-- The existing private plans bucket also holds shared workbooks under
-- shared/<coach-id>/<random-id>.xlsx. A coach can upload/open their own file; admins can
-- open every submission. Delete is only needed for compensating a failed metadata insert.
create policy koutsi_plans_shared_submission_select
on storage.objects
for select to authenticated
using (
  bucket_id = 'koutsi-plans'
  and split_part(name, '/', 1) = 'shared'
  and (
    split_part(name, '/', 2) = (select auth.uid())::text
    or (select public.koutsi_is_admin())
  )
);

create policy koutsi_plans_shared_submission_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'koutsi-plans'
  and split_part(name, '/', 1) = 'shared'
  and split_part(name, '/', 2) = (select auth.uid())::text
  and lower(name) like '%.xlsx'
);

create policy koutsi_plans_shared_submission_delete
on storage.objects
for delete to authenticated
using (
  bucket_id = 'koutsi-plans'
  and split_part(name, '/', 1) = 'shared'
  and split_part(name, '/', 2) = (select auth.uid())::text
);

-- In-app notifications are already drained to Resend every five minutes. Reusing that
-- queue makes delivery retryable and honours the administrator's email preference.
create or replace function koutsi_private.notify_annual_plan_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_coach_name text;
begin
  select coalesce(nullif(btrim(p.name), ''), 'Valmentaja')
    into v_coach_name
    from public.profiles p
   where p.id = new.coach_id;

  insert into public.koutsi_notifications (
    recipient_id, actor_id, kind, title, body, link_path
  )
  select
    a.user_id,
    new.coach_id,
    'annual_plan_submission',
    'Uusi vuosisuunnitelma odottaa',
    coalesce(v_coach_name, 'Valmentaja') || ' lähetti tiedoston ' || new.filename || '.',
    '/valmentaja/yllapito'
  from public.koutsi_admins a;

  return new;
end;
$function$;

revoke all on function koutsi_private.notify_annual_plan_submission() from public, anon, authenticated;

create trigger koutsi_annual_plan_submission_notify_admins
after insert on public.koutsi_annual_plan_submissions
for each row execute function koutsi_private.notify_annual_plan_submission();

create or replace function koutsi_private.notify_annual_plan_handled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'pending' and new.status = 'handled' then
    insert into public.koutsi_notifications (
      recipient_id, actor_id, kind, title, body, link_path
    ) values (
      new.coach_id,
      new.handled_by,
      'annual_plan_handled',
      'Vuosisuunnitelma käsitelty',
      new.filename || ' on käsitelty. Päivitetyt viikkoteemat näkyvät ryhmissäsi.',
      '/valmentaja/ryhmat'
    );
  end if;
  return new;
end;
$function$;

revoke all on function koutsi_private.notify_annual_plan_handled() from public, anon, authenticated;

create trigger koutsi_annual_plan_submission_notify_coach
after update of status on public.koutsi_annual_plan_submissions
for each row execute function koutsi_private.notify_annual_plan_handled();

-- Marking complete records the actual signed-in administrator; the browser never gets to
-- choose handled_by. RLS still performs the same admin check for the UPDATE itself.
create or replace function public.koutsi_admin_handle_annual_plan_submission(
  submission_id_input uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;

  update public.koutsi_annual_plan_submissions
     set status = 'handled',
         handled_at = now(),
         handled_by = auth.uid()
   where id = submission_id_input
     and status = 'pending';

  if not found then
    raise exception 'Vuosisuunnitelmaa ei löytynyt tai se on jo käsitelty';
  end if;
end;
$function$;

revoke all on function public.koutsi_admin_handle_annual_plan_submission(uuid) from public, anon;
grant execute on function public.koutsi_admin_handle_annual_plan_submission(uuid) to authenticated, service_role;

-- The earlier pilot UI parsed and imported a workbook automatically. Shared workbooks
-- now deliberately go through human review in the coach view, so remove that unused
-- write path as well as removing it from the browser.
drop function if exists public.koutsi_admin_import_annual_plan(uuid, jsonb);
drop function if exists koutsi_private.koutsi_admin_import_annual_plan(uuid, jsonb);
