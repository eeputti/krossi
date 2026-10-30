-- 20261030131000_koutsi_mail_and_key_fixes.sql — three fixes found in the review of 30.10.2026.
--
-- NOT APPLIED — a proposal (30.10.2026). Apply only on the user's go-ahead (apply_migration with this name),
-- then move the file to supabase/migrations. Tested in PGlite on top of the live definitions, read from the
-- migration files: koutsi/web/sql/20261030131000_koutsi_mail_and_key_fixes.check.mjs
-- Function bodies only (create or replace): no table, policy, trigger or data changes.
-- Rollback: run the four functions again from where they come from (named at each one below).
--
-- 1. E-mail batching (koutsi_claim_notification_batch). The rule: at most one digest mail per person in
--    3 hours and no mail 21–07 Helsinki, except training_cancelled, session_checkin and session_reminder
--    (always at once); training_moved, player_absence and player_back skip the 3-hour wait but keep the
--    quiet hours. Until now a person with ONE due row got EVERY waiting row: a coach's huomio written at
--    21:05 went out at 21:17 next to "Miten meni?". Now each row is taken only when it is itself due.
-- 2. A failed digest is not lost (koutsi_claim_notification_batch + koutsi_mark_notifications_sent). The
--    rows folded into a digest were marked sent before anything was sent; when the mail then failed they
--    were gone and the retry waited 3 hours. Now they wait in 'sending' with their mail
--    (email_error = 'merged:<id of the mail row>') and koutsi_mark_notifications_sent settles them with
--    it: sent (email_error 'merged', as before) or back to the queue. A crash leaves them in 'sending'
--    and koutsi_requeue_stuck_notifications puts them back like any other row.
-- 3. A burst of session changes keeps the right kind (koutsi_notify). The merge never updated `kind`, so
--    "Treenisi muuttuivat" kept the first row's kind: a group's new time (the app deletes the coming
--    sessions and adds them again: cancelled + added) went out at once even at night when the
--    cancellation came first, and waited for the 3-hour digest when an addition came first. A mixed
--    burst ("Treenisi muuttuivat") is now 'training_moved' — it is a change of times, not a
--    cancellation: no 3-hour wait, quiet hours kept. Only cancellations ("Treeni peruttu" /
--    "Treenejä peruttu") stay 'training_cancelled' and go at once. The e-mail choice is the same
--    ('treenit') for all three kinds.
-- 4. A free-use valmentaja-avain is for a new account only (koutsi_use_code). A key name works with "+"
--    (a trial) and without it (free use, the old coach keys). A coach on the trial, after it, or with a
--    subscription could type the trial key without "+" in Profiili → Tilaus and get free use for good.
--    A key without months is now refused for a coach whose plan is trial / active / past_due / ended.
--    Signing up with a key is unchanged; key rows are not touched.

-- ── 3. koutsi_notify ─────────────────────────────────────────────────────────
-- From 20261026183340_koutsi_move_and_absence_notices.sql; only change: `kind` in the merge update.
create or replace function public.koutsi_notify(p_recipient uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_link text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_prev record;
  v_n integer;
  v_session boolean := p_kind in ('training_added', 'training_cancelled', 'training_moved')
                       and p_title in ('Uusi treeni kalenterissasi', 'Treeni peruttu', 'Treeni siirtyi');
  v_absence boolean := p_kind in ('player_absence', 'player_back');
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  if not exists (select 1 from auth.users u where u.id = p_recipient) then
    return;
  end if;
  if public.koutsi_notifications_paused()
     and not exists (select 1 from public.koutsi_admins a where a.user_id = p_recipient) then
    return;
  end if;
  if v_session or v_absence or p_kind in ('diary', 'homework', 'video', 'announcement') then
    select n.id, n.kind, n.title, n.body, n.burst_count into v_prev
      from koutsi_notifications n
     where n.recipient_id = p_recipient
       and n.actor_id is not distinct from p_actor
       and n.created_at > now() - interval '10 minutes'
       and n.email_status in ('pending', 'skipped')
       and (case when v_session
                 then n.kind in ('training_added', 'training_cancelled', 'training_moved')
                      and n.title in ('Uusi treeni kalenterissasi', 'Treeni peruttu', 'Treeni siirtyi', 'Uusia treenejä kalenterissasi', 'Treenejä peruttu', 'Treenisi muuttuivat')
                 else n.kind = p_kind end)
     order by n.created_at desc
     limit 1
     for update;
    if found then
      v_n := v_prev.burst_count + 1;
      update koutsi_notifications n
         set burst_count = v_n,
             read_at = null,
             -- "Treenisi muuttuivat" is a change of times: no 3-hour wait, but the quiet hours hold
             -- (a cancellation alone stays 'training_cancelled' and goes at once)
             kind = case
               when v_session and (v_prev.kind <> p_kind or v_prev.title = 'Treenisi muuttuivat' or p_kind = 'training_moved') then 'training_moved'
               else n.kind
             end,
             title = case
               when v_session and (v_prev.kind <> p_kind or v_prev.title = 'Treenisi muuttuivat' or p_kind = 'training_moved') then 'Treenisi muuttuivat'
               when v_session and p_kind = 'training_added' then 'Uusia treenejä kalenterissasi'
               when v_session then 'Treenejä peruttu'
               when v_absence then p_title || ' ' || v_n || ' treeniin'
               when p_kind = 'diary' then v_n || ' uutta huomiota valmentajaltasi'
               when p_kind = 'homework' then 'Sait ' || v_n || ' uutta kotiläksyä'
               when p_kind = 'video' then 'Valmentajasi jakoi ' || v_n || ' videota'
               else v_n || ' tiedotetta valmentajaltasi'
             end,
             body = case
               when v_session and (v_prev.kind <> p_kind or v_prev.title = 'Treenisi muuttuivat' or p_kind = 'training_moved') then 'Valmentajasi muutti treenejäsi. Katso uudet ajat Koutsin kalenterista.'
               when v_session and p_kind = 'training_added' then 'Valmentajasi lisäsi useita treenejä. Katso ne Koutsin kalenterista.'
               when v_session then 'Useita treenejä poistui kalenteristasi. Katso muutokset Koutsista.'
               when v_absence then left(coalesce(v_prev.body, '') || E'\n' || coalesce(p_body, ''), 500)
               else 'Uusin: ' || left(coalesce(p_body, ''), 480)
             end,
             link_path = case
               when v_absence then '/valmentaja/pelaaja/' || p_actor
               else n.link_path
             end
       where n.id = v_prev.id;
      return;
    end if;
  end if;
  insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path)
  values (p_recipient, p_actor, p_kind, p_title, left(coalesce(p_body, ''), 500), p_link);
end;
$function$;

-- ── 1 + 2. koutsi_claim_notification_batch ───────────────────────────────────
-- From 20261026183340_koutsi_move_and_absence_notices.sql. Changes: rows are taken one by one when due
-- (`due`), and the rows folded into a digest wait in 'sending' for their mail instead of being marked sent.
-- Same output as before (koutsi-notify reads id, email, recipient_name, kind, title, body, link_path).
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
  -- the kinds a person turned off in Profiili → Sähköpostit are not mailed (the bell keeps them)
  update koutsi_notifications n
     set email_status = 'skipped'
   where n.email_status = 'pending'
     and exists (select 1 from koutsi_notification_prefs np
                  where np.user_id = n.recipient_id
                    and public.koutsi_email_category(n.kind) = any(np.email_off));

  with waiting as (
    select n.id, n.recipient_id, n.kind, n.created_at
      from koutsi_notifications n
     where n.email_status = 'pending'
       and n.email_attempts < 3
       and n.created_at < now() - interval '2 minutes'
  ), last_mail as (
    select s.recipient_id, max(s.emailed_at) as at
      from koutsi_notifications s
     where s.email_status = 'sent'
       and s.recipient_id in (select w.recipient_id from waiting w)
     group by s.recipient_id
  ), due as (
    -- a row goes only when it is itself due: a cancellation, a reminder and "Miten meni?" at once; a moved
    -- session and a player's absence outside the quiet hours; everything else outside the quiet hours
    -- and 3 hours after the person's last mail
    select w.id, w.recipient_id, w.created_at
      from waiting w
      left join last_mail l on l.recipient_id = w.recipient_id
     where w.kind in ('training_cancelled', 'session_checkin', 'session_reminder')
        or (not v_quiet
            and (w.kind in ('training_moved', 'player_absence', 'player_back')
                 or coalesce(l.at, '-infinity'::timestamptz) < now() - interval '3 hours'))
  ), ready as (
    select d.recipient_id
      from due d
     group by d.recipient_id
     order by min(d.created_at)
     limit greatest(coalesce(batch_size, 25), 1)
  ), claimed as (
    update koutsi_notifications n
       set email_status = 'sending',
           email_attempts = n.email_attempts + 1,
           email_error = null
      from due d
      join ready r on r.recipient_id = d.recipient_id
     where n.id = d.id
       and n.email_status = 'pending'
    returning n.id
  )
  select array_agg(c.id) into v_ids from claimed c;

  if v_ids is null then
    return;
  end if;

  -- The rows folded into a person's digest wait with it: koutsi_mark_notifications_sent marks them sent
  -- when the digest is sent, and puts them back in the queue when sending fails.
  update koutsi_notifications n
     set email_error = 'merged:' || k.keep_id::text
    from (select x.id,
                 first_value(x.id) over (partition by x.recipient_id order by x.created_at desc, x.id desc) as keep_id
            from koutsi_notifications x
           where x.id = any(v_ids)
             and x.kind not in ('session_checkin', 'session_reminder')) k
   where n.id = k.id
     and k.id <> k.keep_id;

  return query
  with c as (
    select n.id, n.recipient_id, n.kind, n.title, n.body, n.link_path, n.created_at
      from koutsi_notifications n where n.id = any(v_ids)
  ), per as (
    select r.recipient_id,
           (array_agg(r.id order by r.created_at desc, r.id desc))[1] as keep_id,
           count(*)::integer as cnt,
           string_agg('• ' || r.title, E'\n' order by r.created_at) as titles,
           bool_or(coalesce(r.link_path, '') like '/valmentaja%') as coach_side
      from c r
     where r.kind not in ('session_checkin', 'session_reminder')
     group by r.recipient_id
  ), outgoing as (
    select c.id, c.recipient_id, c.kind, c.title, c.body, c.link_path
      from c where c.kind in ('session_checkin', 'session_reminder')
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

  -- no address or e-mail turned off: nothing goes out, the bell keeps them
  update koutsi_notifications n
     set email_status = 'skipped',
         email_error = case when n.email_error like 'merged:%' then null else n.email_error end
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
grant execute on function public.koutsi_claim_notification_batch(integer) to service_role;

-- ── 2. koutsi_mark_notifications_sent ────────────────────────────────────────
-- From 20260914083405_capture_untracked_notification_admin_and_misc_functions.sql. Change: the rows folded
-- into a mail (email_error = 'merged:<its id>') follow it. Called by koutsi-notify only (service role).
create or replace function public.koutsi_mark_notifications_sent(ids uuid[], failed_error text DEFAULT NULL::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_folded text[] := array(select 'merged:' || i::text from unnest(coalesce(ids, '{}'::uuid[])) as i);
begin
  if failed_error is null then
    update koutsi_notifications
       set email_status = 'sent', emailed_at = now(), email_error = null
     where id = any(ids);
    update koutsi_notifications
       set email_status = 'sent', emailed_at = now(), email_error = 'merged'
     where email_status = 'sending'
       and email_error = any(v_folded);
  else
    update koutsi_notifications
       set email_status = case when email_attempts >= 3 then 'failed' else 'pending' end,
           email_error = left(failed_error, 500)
     where id = any(ids)
        or (email_status = 'sending' and email_error = any(v_folded));
  end if;
end;
$function$;
revoke all on function public.koutsi_mark_notifications_sent(uuid[], text) from public, anon, authenticated;
grant execute on function public.koutsi_mark_notifications_sent(uuid[], text) to service_role;

-- ── 4. koutsi_use_code ───────────────────────────────────────────────────────
-- From 20261030082914_koutsi_trial_codes_plus.sql; only change: the free-use guard for a coach (marked).
create or replace function public.koutsi_use_code(p_code text, p_terms_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_input text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9+]', '', 'g');
  v_code public.koutsi_trial_codes%rowtype;
  v_is_coach boolean;
  v_plan text;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if replace(v_input, '+', '') = '' then
    raise exception 'Kirjoita valmentaja-avain.';
  end if;

  select * into v_code from public.koutsi_trial_codes c where c.code = v_input for update;
  if not found then
    -- An old coach key goes on exactly as before ('invalid coach key' → "Väärä valmentaja-avain." in the app).
    if exists (select 1 from public.koutsi_coach_invite_codes k where k.code = upper(btrim(p_code))) then
      return public.redeem_koutsi_coach_key(p_code) || jsonb_build_object('kind', 'key');
    end if;
    -- The "+" forgotten: the key that is the same with a "+".
    if position('+' in v_input) = 0 then
      select * into v_code from public.koutsi_trial_codes c
       where c.code <> v_input and replace(c.code, '+', '') = v_input
       order by c.created_at
       limit 1
       for update;
    end if;
    if not found then
      return public.redeem_koutsi_coach_key(p_code) || jsonb_build_object('kind', 'key');
    end if;
  end if;

  if v_code.revoked_at is not null then
    raise exception 'Tämä valmentaja-avain on poistettu käytöstä.';
  end if;
  if v_code.expires_at is not null and v_code.expires_at < now() then
    raise exception 'Tämä valmentaja-avain on vanhentunut.';
  end if;
  if v_code.use_count >= v_code.max_uses then
    raise exception 'Tämä valmentaja-avain on jo käytetty.';
  end if;

  v_is_coach := exists (select 1 from public.koutsi_coaches c where c.id = v_uid);
  if v_is_coach then
    if exists (select 1 from public.koutsi_trial_code_uses u where u.code = v_code.code and u.coach_id = v_uid) then
      raise exception 'Olet jo käyttänyt tämän valmentaja-avaimen.';
    end if;
    v_plan := public.koutsi_coach_plan(v_uid);
    if v_plan = 'free' then
      raise exception 'Koutsi on sinulle jo maksuton, joten avainta ei tarvita.';
    end if;
    if v_plan in ('active', 'past_due') then
      raise exception 'Sinulla on jo tilaus. Ota yhteyttä, niin katsotaan avain yhdessä.';
    end if;
    -- NEW: free use (a key without months) only when the account is made; never for a coach on the trial,
    -- after it or with a subscription (the same key name with "+" is the trial).
    if v_code.months is null and exists (
         select 1 from public.koutsi_coach_plans p
          where p.coach_id = v_uid and p.plan in ('trial', 'active', 'past_due', 'ended')) then
      raise exception 'Tämä avain toimii vain uuden tilin luonnissa.';
    end if;
  else
    if p_terms_version is null or btrim(p_terms_version) = '' then
      raise exception 'Tilausehtojen hyväksyntä puuttuu. Päivitä sivu ja yritä uudelleen.';
    end if;
    if not exists (select 1 from public.profiles pr where pr.id = v_uid) then
      raise exception 'profile required';
    end if;
    if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
      raise exception 'Vahvista ensin sähköpostiosoitteesi vahvistusviestin linkistä.';
    end if;
    insert into public.koutsi_coaches (id) values (v_uid) on conflict (id) do nothing;
  end if;

  if v_code.months is null then
    insert into public.koutsi_coach_plans (coach_id, plan, terms_version, terms_accepted_at, trial_code)
    values (v_uid, 'free', nullif(left(btrim(coalesce(p_terms_version, '')), 40), ''), case when v_is_coach then null else now() end, v_code.code)
    on conflict (coach_id) do update
      set plan = 'free', trial_ends_at = null, trial_code = excluded.trial_code, updated_at = now();
  else
    insert into public.koutsi_coach_plans (coach_id, plan, trial_ends_at, terms_version, terms_accepted_at, trial_code)
    values (v_uid, 'trial', now() + make_interval(months => v_code.months), left(btrim(coalesce(p_terms_version, '')), 40), now(), v_code.code)
    on conflict (coach_id) do update
      set plan = 'trial',
          trial_ends_at = greatest(coalesce(public.koutsi_coach_plans.trial_ends_at, now()), now() + make_interval(months => v_code.months)),
          trial_code = excluded.trial_code,
          trial_reminded_at = null,
          updated_at = now();
  end if;

  insert into public.koutsi_trial_code_uses (code, coach_id) values (v_code.code, v_uid);
  update public.koutsi_trial_codes set use_count = use_count + 1 where code = v_code.code;
  if not v_is_coach then
    perform public.koutsi_seed_exercises(v_uid);
  end if;

  return public.koutsi_plan_status() || jsonb_build_object('kind', 'code', 'months', v_code.months);
end;
$function$;
revoke all on function public.koutsi_use_code(text, text) from public, anon;
grant execute on function public.koutsi_use_code(text, text) to authenticated;
