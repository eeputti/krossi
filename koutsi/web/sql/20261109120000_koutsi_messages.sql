-- 20261109120000_koutsi_messages.sql — Viestit: two-way messages between a coach and one player
-- in the renewed Koutsi (koutsi/web).
--
-- NOT APPLIED — a proposal (plan of 25.10.2026, nothing built yet). Apply only on the user's
-- "aja migraatio" (apply_migration with this name), then move the file to supabase/migrations.
-- Tested in PGlite against a stub of the production schema:
--   koutsi/web/sql/20261109120000_koutsi_messages.check.mjs
-- Everything is additive: two new tables, seven functions, three triggers, two cron jobs. No
-- existing table, function or policy changes, and the old Koutsi reads none of it.
-- Rollback: drop the two tables (cascade), the functions and the two cron jobs.
--
-- Rules the app relies on:
--   * One conversation per coach–player pair (koutsi_threads), tied to the coaching row
--     (koutsi_coach_students) by a foreign key: when a placeholder player is claimed, the
--     conversation follows the new account id (ON UPDATE CASCADE); when the coaching row is
--     deleted (account deletion), the conversation and its messages go with it (ON DELETE CASCADE).
--   * No group chats. A notice to many players is a Tiedote (koutsi_announcements).
--   * Only the two of them read it: not the player's other coaches, not admins (no koutsi_acts_as
--     or koutsi_is_linked_coach here). The coach reads it while the coaching is on; the player
--     keeps the history.
--   * Messages are OFF until the coach turns them on for a player (koutsi_set_messages), one by one
--     or a whole group at once — meant for adult players; minors come later with a guardian.
--     enabled = false is a decision too ("not for this player"), so the app can tell it apart
--     from players nobody has decided about yet (no row).
--   * Writing needs: messages on for the pair, coaching on, the player has an account, and the
--     coach has the feature (koutsi_messages_coach_enabled: beta testers and admins first — opening
--     Viestit to every coach is a one-line replace of that function).
--   * Text only, 1–2000 characters, never edited. The sender can delete their own message. At
--     most 30 messages an hour per sender per conversation.
--   * E-mail: never one mail per message, never the message text. A cron job sends at most one
--     "new messages" mail per unread streak — 15 minutes after the first unread message, not
--     21–07 Finnish time, then at most one reminder a day while new ones keep coming — through
--     the existing koutsi_notify → koutsi_notifications → koutsi-notify (Resend) queue. The mail
--     says only who wrote. Reading in the app first means no mail at all.
--   * Retention: a message is deleted 12 months after it was sent; a conversation 90 days after
--     the coaching ended.

-- ── tables ──────────────────────────────────────────────────────────────────

create table if not exists public.koutsi_threads (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null,
  student_id uuid not null,
  enabled boolean not null,
  enabled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  coach_read_at timestamptz,
  player_read_at timestamptz,
  constraint koutsi_threads_pair unique (coach_id, student_id),
  constraint koutsi_threads_two_people check (coach_id <> student_id),
  constraint koutsi_threads_coaching foreign key (coach_id, student_id)
    references public.koutsi_coach_students (coach_id, student_id) on update cascade on delete cascade
);

create index if not exists koutsi_threads_student_idx on public.koutsi_threads (student_id);

create table if not exists public.koutsi_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.koutsi_threads(id) on delete cascade,
  sender text not null check (sender in ('coach', 'player')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  -- "Vastaa" from a Tiedote, a Toive or a Miten meni? comment: only the id, never a copy of the
  -- text; each side shows the original only if they can still see it themselves.
  ref_kind text check (ref_kind in ('announcement', 'wish', 'mood')),
  ref_id uuid,
  created_at timestamptz not null default now(),
  constraint koutsi_messages_ref_pair check ((ref_kind is null) = (ref_id is null))
);

create index if not exists koutsi_messages_thread_idx on public.koutsi_messages (thread_id, created_at desc);
create index if not exists koutsi_messages_created_idx on public.koutsi_messages (created_at);

-- ── who may ─────────────────────────────────────────────────────────────────

-- The feature gate, per coach: beta testers and admins first.
create or replace function public.koutsi_messages_coach_enabled(p_coach uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_coach is not null and (
    exists (select 1 from public.koutsi_admins a where a.user_id = p_coach)
    or exists (
      select 1 from public.koutsi_beta_testers b
        join auth.users u on lower(u.email) = lower(b.email)
       where u.id = p_coach
    )
  );
$function$;

-- For the coach's app: is Viestit on for me?
create or replace function public.koutsi_messages_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.koutsi_messages_coach_enabled((select auth.uid()));
$function$;

-- Can the signed-in user write in this conversation right now?
create or replace function public.koutsi_thread_open_for_me(p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
      from public.koutsi_threads t
      join public.koutsi_coach_students cs
        on cs.coach_id = t.coach_id and cs.student_id = t.student_id and cs.ended_at is null
     where t.id = p_thread
       and t.enabled
       and (select auth.uid()) in (t.coach_id, t.student_id)
       and public.koutsi_messages_coach_enabled(t.coach_id)
       and exists (select 1 from auth.users u where u.id = t.student_id)
  );
$function$;

-- ── row security ────────────────────────────────────────────────────────────

alter table public.koutsi_threads enable row level security;
alter table public.koutsi_messages enable row level security;

drop policy if exists koutsi_threads_select on public.koutsi_threads;
create policy koutsi_threads_select on public.koutsi_threads
  for select to authenticated
  using (
    student_id = (select auth.uid())
    or (
      coach_id = (select auth.uid())
      and exists (
        select 1 from public.koutsi_coach_students cs
         where cs.coach_id = koutsi_threads.coach_id
           and cs.student_id = koutsi_threads.student_id
           and cs.ended_at is null
      )
    )
  );

-- A message is visible to whoever sees its conversation (the threads policy above applies inside).
drop policy if exists koutsi_messages_select on public.koutsi_messages;
create policy koutsi_messages_select on public.koutsi_messages
  for select to authenticated
  using (exists (select 1 from public.koutsi_threads t where t.id = koutsi_messages.thread_id));

drop policy if exists koutsi_messages_insert on public.koutsi_messages;
create policy koutsi_messages_insert on public.koutsi_messages
  for insert to authenticated
  with check (public.koutsi_thread_open_for_me(thread_id));

drop policy if exists koutsi_messages_delete on public.koutsi_messages;
create policy koutsi_messages_delete on public.koutsi_messages
  for delete to authenticated
  using (
    exists (
      select 1 from public.koutsi_threads t
       where t.id = koutsi_messages.thread_id
         and (
           (koutsi_messages.sender = 'coach' and t.coach_id = (select auth.uid()))
           or (koutsi_messages.sender = 'player' and t.student_id = (select auth.uid()))
         )
    )
  );

-- Conversations are written only by the functions below; messages are never edited.
revoke all on public.koutsi_threads from anon, authenticated;
revoke all on public.koutsi_messages from anon, authenticated;
grant select on public.koutsi_threads to authenticated;
grant select, insert, delete on public.koutsi_messages to authenticated;

-- ── writes ──────────────────────────────────────────────────────────────────

-- The coach turns messages on (or off) for some of their current players — one player, or a
-- group's members at once. Placeholders may be included: the row follows them when they claim.
-- Returns how many conversations changed.
create or replace function public.koutsi_set_messages(p_student_ids uuid[], p_on boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_coach uuid := (select auth.uid());
  v_count integer;
begin
  if v_coach is null then
    raise exception 'authentication required';
  end if;
  if not public.koutsi_messages_coach_enabled(v_coach) then
    raise exception 'Viestit eivät ole vielä käytössä';
  end if;
  if p_on is null or p_student_ids is null or cardinality(p_student_ids) = 0 then
    return 0;
  end if;
  if cardinality(p_student_ids) > 400 then
    raise exception 'Liian monta pelaajaa kerralla';
  end if;
  insert into public.koutsi_threads as t (coach_id, student_id, enabled, enabled_at)
  select v_coach, cs.student_id, p_on, now()
    from public.koutsi_coach_students cs
   where cs.coach_id = v_coach
     and cs.ended_at is null
     and cs.student_id = any (p_student_ids)
  on conflict (coach_id, student_id) do update
     set enabled = excluded.enabled, enabled_at = excluded.enabled_at
   where t.enabled is distinct from excluded.enabled;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- Opening a conversation marks it read for the side that opened it ("Nähty" for the other side).
create or replace function public.koutsi_mark_thread_read(p_thread uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  update public.koutsi_threads t
     set coach_read_at = case when t.coach_id = v_uid then now() else t.coach_read_at end,
         player_read_at = case when t.student_id = v_uid then now() else t.player_read_at end
   where t.id = p_thread
     and (
       t.student_id = v_uid
       or (
         t.coach_id = v_uid
         and exists (
           select 1 from public.koutsi_coach_students cs
            where cs.coach_id = t.coach_id and cs.student_id = t.student_id and cs.ended_at is null
         )
       )
     );
end;
$function$;

-- Before a message is stored: the sender and the time come from the server, never the client,
-- and nobody sends more than 30 an hour in one conversation.
create or replace function public.koutsi_message_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_thread record;
begin
  select coach_id, student_id into v_thread from public.koutsi_threads where id = new.thread_id;
  if not found then
    raise exception 'Keskustelua ei löytynyt';
  end if;
  if v_uid = v_thread.coach_id then
    new.sender := 'coach';
  elsif v_uid = v_thread.student_id then
    new.sender := 'player';
  else
    raise exception 'not allowed';
  end if;
  new.created_at := now();
  if (
    select count(*) from public.koutsi_messages m
     where m.thread_id = new.thread_id and m.sender = new.sender and m.created_at > now() - interval '1 hour'
  ) >= 30 then
    raise exception 'Liian monta viestiä tunnin sisällä. Yritä hetken päästä uudelleen.';
  end if;
  return new;
end;
$function$;

drop trigger if exists koutsi_messages_before_insert on public.koutsi_messages;
create trigger koutsi_messages_before_insert
  before insert on public.koutsi_messages
  for each row execute function public.koutsi_message_before_insert();

-- After a message is added or deleted: the conversation's order (last_message_at), and the
-- sender's own message counts as read by them.
create or replace function public.koutsi_message_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    update public.koutsi_threads
       set last_message_at = new.created_at,
           coach_read_at = case when new.sender = 'coach' then new.created_at else coach_read_at end,
           player_read_at = case when new.sender = 'player' then new.created_at else player_read_at end
     where id = new.thread_id;
    return new;
  end if;
  update public.koutsi_threads t
     set last_message_at = (select max(m.created_at) from public.koutsi_messages m where m.thread_id = old.thread_id)
   where t.id = old.thread_id;
  return old;
end;
$function$;

drop trigger if exists koutsi_messages_after_change on public.koutsi_messages;
create trigger koutsi_messages_after_change
  after insert or delete on public.koutsi_messages
  for each row execute function public.koutsi_message_after_change();

-- ── e-mail: one mail per unread streak, never the text ──────────────────────

-- Run by cron every 10 minutes (p_now only for tests). For each person with unread messages on
-- one side (as a coach, or as a player): if the oldest unread is 15+ minutes old, it is 07–21 in
-- Finland, and no "message" mail went out during this streak (or the last one is a day old and
-- something new came since), queue ONE notification naming who wrote. koutsi_notify skips
-- people without an account; the existing dispatcher sends it unless e-mail is turned off.
create or replace function public.koutsi_queue_message_emails(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hour integer := extract(hour from (p_now at time zone 'Europe/Helsinki'))::integer;
  v_queued integer := 0;
  r record;
  v_names text[];
  v_who text;
  v_n integer;
begin
  if v_hour < 7 or v_hour >= 21 then
    return 0;
  end if;
  for r in
    with unread as (
      select t.coach_id as recipient, 'coach'::text as side, t.student_id as other, m.created_at
        from public.koutsi_threads t
        join public.koutsi_messages m on m.thread_id = t.id
        join public.koutsi_coach_students cs
          on cs.coach_id = t.coach_id and cs.student_id = t.student_id and cs.ended_at is null
       where m.sender = 'player' and m.created_at > coalesce(t.coach_read_at, '-infinity'::timestamptz)
      union all
      select t.student_id, 'player'::text, t.coach_id, m.created_at
        from public.koutsi_threads t
        join public.koutsi_messages m on m.thread_id = t.id
       where m.sender = 'coach' and m.created_at > coalesce(t.player_read_at, '-infinity'::timestamptz)
    ), streaks as (
      select u.recipient, u.side, min(u.created_at) as oldest, max(u.created_at) as newest,
             array_agg(distinct u.other) as others
        from unread u
       group by u.recipient, u.side
      having min(u.created_at) <= p_now - interval '15 minutes'
    )
    select s.*,
           (select max(n.created_at) from public.koutsi_notifications n
             where n.recipient_id = s.recipient and n.kind = 'message'
               and n.link_path like case when s.side = 'coach' then '/valmentaja/%' else '/pelaaja/%' end) as last_mail
      from streaks s
  loop
    continue when r.last_mail is not null and r.last_mail >= r.oldest
      and (r.newest <= r.last_mail or r.last_mail > p_now - interval '24 hours');

    select array_agg(coalesce(nullif(btrim(p.name), ''), case when r.side = 'coach' then 'Pelaaja' else 'Valmentajasi' end)
                     order by p.name)
      into v_names
      from unnest(r.others) as o(id)
      left join public.profiles p on p.id = o.id;
    v_n := coalesce(cardinality(v_names), 0);
    v_who := case
      when v_n <= 1 then coalesce(v_names[1], 'Joku')
      when v_n = 2 then v_names[1] || ' ja ' || v_names[2]
      else v_names[1] || ', ' || v_names[2] || ' ja ' || (v_n - 2)::text || ' muuta'
    end;

    perform public.koutsi_notify(
      r.recipient,
      case when v_n = 1 then r.others[1] else null end,
      'message',
      case when r.side = 'coach' then 'Uusia viestejä pelaajilta' else 'Uusi viesti valmentajaltasi' end,
      v_who || case when v_n = 1 then ' lähetti sinulle viestin Koutsissa.' else ' lähettivät sinulle viestejä Koutsissa.' end,
      case when r.side = 'coach' then '/valmentaja/viestit?uusi=1' else '/pelaaja/viestit?uusi=1' end
    );
    v_queued := v_queued + 1;
  end loop;
  return v_queued;
end;
$function$;

-- ── retention ───────────────────────────────────────────────────────────────

-- Nightly (p_now only for tests): messages older than 12 months, and conversations whose
-- coaching ended over 90 days ago.
create or replace function public.koutsi_prune_messages(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_messages integer;
  v_threads integer;
begin
  delete from public.koutsi_messages where created_at < p_now - interval '12 months';
  get diagnostics v_messages = row_count;
  delete from public.koutsi_threads t
   using public.koutsi_coach_students cs
   where cs.coach_id = t.coach_id and cs.student_id = t.student_id
     and cs.ended_at is not null and cs.ended_at < p_now - interval '90 days';
  get diagnostics v_threads = row_count;
  return v_messages + v_threads;
end;
$function$;

-- ── function rights ─────────────────────────────────────────────────────────

revoke all on function public.koutsi_messages_coach_enabled(uuid) from public, anon, authenticated;
revoke all on function public.koutsi_messages_enabled() from public, anon;
revoke all on function public.koutsi_thread_open_for_me(uuid) from public, anon;
revoke all on function public.koutsi_set_messages(uuid[], boolean) from public, anon;
revoke all on function public.koutsi_mark_thread_read(uuid) from public, anon;
revoke all on function public.koutsi_message_before_insert() from public, anon, authenticated;
revoke all on function public.koutsi_message_after_change() from public, anon, authenticated;
revoke all on function public.koutsi_queue_message_emails(timestamptz) from public, anon, authenticated;
revoke all on function public.koutsi_prune_messages(timestamptz) from public, anon, authenticated;
grant execute on function public.koutsi_messages_enabled() to authenticated;
grant execute on function public.koutsi_thread_open_for_me(uuid) to authenticated;
grant execute on function public.koutsi_set_messages(uuid[], boolean) to authenticated;
grant execute on function public.koutsi_mark_thread_read(uuid) to authenticated;
grant execute on function public.koutsi_queue_message_emails(timestamptz) to service_role;
grant execute on function public.koutsi_prune_messages(timestamptz) to service_role;

-- ── live updates and cron ───────────────────────────────────────────────────

-- An open conversation and the unread badges update live (Realtime respects the policies above).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'koutsi_messages') then
      execute 'alter publication supabase_realtime add table public.koutsi_messages';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'koutsi_threads') then
      execute 'alter publication supabase_realtime add table public.koutsi_threads';
    end if;
  end if;
end $$;

-- Mails every 10 minutes (the dispatcher runs every 5); the prune at 03:37 UTC (the others run
-- at 03:17 and 03:27). Idempotent; skipped where pg_cron is not installed.
do $$
declare v_job record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  for v_job in select jobid from cron.job where jobname in ('koutsi-message-emails', 'koutsi-messages-prune') loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule('koutsi-message-emails', '*/10 * * * *', 'select public.koutsi_queue_message_emails()');
  perform cron.schedule('koutsi-messages-prune', '37 3 * * *', 'select public.koutsi_prune_messages()');
end $$;
