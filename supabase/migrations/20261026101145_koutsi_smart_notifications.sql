-- koutsi_smart_notifications — notices about what matters, never a pile of them.
--
-- The owner, 2026-10-26: players get a notice about the things that matter, never ten (or even
-- five) e-mails or notices in a row. Two rules:
--
-- 1. The bell: a burst is one notice. The same coach doing the same kind of thing for the same
--    person within 10 minutes updates the notice already waiting (with a count) instead of adding
--    another. Session changes are one kind: a new group adds its whole calendar and a new time
--    cancels and re-adds every coming session, which used to mean 12–24 notices per player; now
--    it is one ("Uusia treenejä kalenterissasi" / "Treenisi muuttuivat"). The one-per-group
--    summaries of Jatka kalenteria and Uusi kausi stay as they are.
-- 2. E-mail: everything waiting for a person goes out as ONE mail, at most one mail per person in
--    3 hours, and none between 21 and 7 (Helsinki). A cancelled session can't wait: it goes at
--    once. "Miten meni?" keeps its own mail (it has the 1–5 buttons).
--
-- Notifications stay paused (koutsi_notifications_paused()); turning them back on is its own step.

alter table public.koutsi_notifications add column if not exists burst_count integer not null default 1;

create or replace function public.koutsi_notify(p_recipient uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_link text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_prev record;
  v_n integer;
  v_session boolean := p_kind in ('training_added', 'training_cancelled')
                       and p_title in ('Uusi treeni kalenterissasi', 'Treeni peruttu');
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  if not exists (select 1 from auth.users u where u.id = p_recipient) then
    return;
  end if;
  -- Paused: nothing for players or coaches; Koutsi admins still hear about feedback and plans.
  if public.koutsi_notifications_paused()
     and not exists (select 1 from public.koutsi_admins a where a.user_id = p_recipient) then
    return;
  end if;

  -- A burst is one notice (rule 1). Only a notice not yet e-mailed is updated; after its mail a
  -- new one starts, and the e-mail rules below decide when that one goes.
  if v_session or p_kind in ('diary', 'homework', 'video', 'announcement') then
    select n.id, n.kind, n.title, n.burst_count into v_prev
      from koutsi_notifications n
     where n.recipient_id = p_recipient
       and n.actor_id is not distinct from p_actor
       and n.created_at > now() - interval '10 minutes'
       and n.email_status in ('pending', 'skipped')
       and (case when v_session
                 then n.kind in ('training_added', 'training_cancelled')
                      and n.title in ('Uusi treeni kalenterissasi', 'Treeni peruttu', 'Uusia treenejä kalenterissasi', 'Treenejä peruttu', 'Treenisi muuttuivat')
                 else n.kind = p_kind end)
     order by n.created_at desc
     limit 1
     for update;
    if found then
      v_n := v_prev.burst_count + 1;
      update koutsi_notifications n
         set burst_count = v_n,
             read_at = null,
             title = case
               when v_session and (v_prev.kind <> p_kind or v_prev.title = 'Treenisi muuttuivat') then 'Treenisi muuttuivat'
               when v_session and p_kind = 'training_added' then 'Uusia treenejä kalenterissasi'
               when v_session then 'Treenejä peruttu'
               when p_kind = 'diary' then v_n || ' uutta merkintää valmentajaltasi'
               when p_kind = 'homework' then 'Sait ' || v_n || ' uutta kotiläksyä'
               when p_kind = 'video' then 'Valmentajasi jakoi ' || v_n || ' videota'
               else v_n || ' tiedotetta valmentajaltasi'
             end,
             body = case
               when v_session and (v_prev.kind <> p_kind or v_prev.title = 'Treenisi muuttuivat') then 'Valmentajasi muutti treenejäsi. Katso uudet ajat Koutsin kalenterista.'
               when v_session and p_kind = 'training_added' then 'Valmentajasi lisäsi useita treenejä. Katso ne Koutsin kalenterista.'
               when v_session then 'Useita treenejä poistui kalenteristasi. Katso muutokset Koutsista.'
               else 'Uusin: ' || left(coalesce(p_body, ''), 480)
             end
       where n.id = v_prev.id;
      return;
    end if;
  end if;

  insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path)
  values (p_recipient, p_actor, p_kind, p_title, left(coalesce(p_body, ''), 500), p_link);
end;
$function$;

-- Rule 2: one mail per person per round, at most one in 3 hours, quiet 21–07 (Helsinki).
create or replace function public.koutsi_claim_notification_batch(batch_size integer default 25)
 returns table(id uuid, email text, recipient_name text, kind text, title text, body text, link_path text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_hour integer := extract(hour from (now() at time zone 'Europe/Helsinki'))::integer;
  v_quiet boolean := v_hour >= 21 or v_hour < 7;
  v_ids uuid[];
begin
  with ready as (
    select n.recipient_id
      from koutsi_notifications n
     where n.email_status = 'pending'
       and n.email_attempts < 3
       and n.created_at < now() - interval '2 minutes'
     group by n.recipient_id
    having bool_or(n.kind in ('training_cancelled', 'session_checkin'))
        or (not v_quiet
            and coalesce((select max(s.emailed_at) from koutsi_notifications s
                           where s.recipient_id = n.recipient_id and s.email_status = 'sent'), '-infinity'::timestamptz)
                < now() - interval '3 hours')
     order by min(n.created_at)
     limit greatest(coalesce(batch_size, 25), 1)
  ), claimed as (
    update koutsi_notifications n
       set email_status = 'sending',
           email_attempts = n.email_attempts + 1
     where n.recipient_id in (select r.recipient_id from ready r)
       and n.email_status = 'pending'
       and n.email_attempts < 3
       and n.created_at < now() - interval '2 minutes'
    returning n.id
  )
  select array_agg(c.id) into v_ids from claimed c;

  if v_ids is null then
    return;
  end if;

  return query
  with c as (
    select n.id, n.recipient_id, n.kind, n.title, n.body, n.link_path, n.created_at
      from koutsi_notifications n where n.id = any(v_ids)
  ), per as (
    select r.recipient_id,
           (array_agg(r.id order by r.created_at desc))[1] as keep_id,
           count(*)::integer as cnt,
           string_agg(r.title, ' · ' order by r.created_at) as titles,
           bool_or(coalesce(r.link_path, '') like '/valmentaja%') as coach_side
      from c r
     where r.kind <> 'session_checkin'
     group by r.recipient_id
  ), outgoing as (
    select c.id, c.recipient_id, c.kind, c.title, c.body, c.link_path
      from c where c.kind = 'session_checkin'
    union all
    select p.keep_id, p.recipient_id,
           case when p.cnt = 1 then k.kind else 'digest' end,
           case when p.cnt = 1 then k.title else p.cnt || ' uutta asiaa Koutsissa' end,
           case when p.cnt = 1 then k.body else p.titles end,
           case when p.cnt = 1 then k.link_path when p.coach_side then '/valmentaja' else '/pelaaja' end
      from per p join c k on k.id = p.keep_id
  )
  select o.id, u.email::text, coalesce(pr.name, 'Pelaaja')::text, o.kind, o.title, o.body, o.link_path
    from outgoing o
    join auth.users u on u.id = o.recipient_id
    left join profiles pr on pr.id = o.recipient_id
    left join koutsi_notification_prefs np on np.user_id = o.recipient_id
   where u.email is not null
     and coalesce(np.email_enabled, true);

  -- The rows folded into someone's mail count as mailed with it.
  update koutsi_notifications n
     set email_status = 'sent', emailed_at = now(), email_error = 'merged'
   where n.id = any(v_ids)
     and n.kind <> 'session_checkin'
     and n.id not in (
       select (array_agg(x.id order by x.created_at desc))[1]
         from koutsi_notifications x
        where x.id = any(v_ids) and x.kind <> 'session_checkin'
        group by x.recipient_id
     );

  -- No address or e-mail turned off: nothing to send.
  update koutsi_notifications n
     set email_status = 'skipped'
   where n.id = any(v_ids)
     and n.email_status = 'sending'
     and not exists (
       select 1 from auth.users u
         left join koutsi_notification_prefs np on np.user_id = n.recipient_id
        where u.id = n.recipient_id and u.email is not null and coalesce(np.email_enabled, true)
     );
end;
$function$;

revoke all on function public.koutsi_claim_notification_batch(integer) from public, anon, authenticated;
