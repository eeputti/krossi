-- koutsi_pause_notifications — Koutsi sends no notifications to players or coaches for now.
--
-- The owner decided on 2026-10-26: "pelaajat eivät saa vielä saada mitään ilmoitusta, ei
-- valmentajakaan". Every Koutsi notice (coach's note, homework, video, notice board, new or
-- cancelled session, a player's match note, "Miten meni?") goes through koutsi_notify(), which
-- writes the bell row; the koutsi-notify-dispatch cron job e-mails those rows. Stopping the row
-- stops both the bell and the e-mail. Koutsi admins (the owner) keep their own notices
-- (player feedback, annual plans).
--
-- Turning notifications back on later: replace koutsi_notifications_paused() with one that
-- returns false. Nothing else changes.

create or replace function public.koutsi_notifications_paused()
returns boolean
language sql
stable
set search_path = ''
as $$ select true $$;

revoke all on function public.koutsi_notifications_paused() from public, anon, authenticated;

create or replace function public.koutsi_notify(p_recipient uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_link text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path)
  values (p_recipient, p_actor, p_kind, p_title, left(coalesce(p_body, ''), 500), p_link);
end;
$function$;

-- Nothing already waiting for its e-mail may go out either.
update public.koutsi_notifications n
   set email_status = 'skipped'
 where n.email_status = 'pending'
   and not exists (select 1 from public.koutsi_admins a where a.user_id = n.recipient_id);
