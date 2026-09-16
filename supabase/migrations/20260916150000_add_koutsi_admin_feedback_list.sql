-- Feedback submitted via KoutsiFeedbackModal (koutsi_feedback) had no admin-facing
-- list view: RLS only allows insert, so admins could only read it via the table editor
-- or a service-role query (see 20260916090000). This adds a read RPC, mirroring the
-- koutsi_admin_users() pattern, so the Ylläpito tab can show a real feedback feed.

create function public.koutsi_admin_feedback()
returns table (
  id uuid,
  sender_id uuid,
  sender_name text,
  email text,
  is_coach boolean,
  is_player boolean,
  category text,
  message text,
  created_at timestamptz
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
    f.id,
    u.id,
    coalesce(
      nullif(btrim(p.name), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(u.email, ''), '@', 1),
      'Nimetön'
    )::text,
    u.email::text,
    exists (
      select 1 from public.koutsi_coaches c where c.id = u.id and c.archived_at is null
    ),
    exists (
      select 1 from public.koutsi_students s where s.id = u.id
    ),
    f.category,
    f.message,
    f.created_at
  from public.koutsi_feedback f
  join auth.users u on u.id = f.student_id
  left join public.profiles p on p.id = u.id
  order by f.created_at desc;
end;
$function$;

revoke all on function public.koutsi_admin_feedback() from public, anon;
grant execute on function public.koutsi_admin_feedback() to authenticated, service_role;
