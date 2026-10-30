-- 20261030070237_no_middle_dots.sql — no middle dot "·" in the texts the database writes for people.
-- "A · B" becomes "A, B" in: the Koutsi notifications (Uusi treeni kalenterissasi, Treeni peruttu,
-- Treeni siirtyi, <nimi> ei pääse / pääseekin, Treenit ohi! Miten meni?) and Krossi's booking label
-- (saldo and sarjakortti history), the kausivuoro invoice line and the monthly card charge description.
-- Nothing else changes.
--
-- APPLIED 30.10.2026 on the user's go-ahead (apply_migration no_middle_dots); every body was checked
-- against the live one first (same apart from the separator).
-- Each function is its live definition of 29.10.2026 (pg_get_functiondef) with only that separator
-- changed; if one has been replaced since, redo the change on the new live version instead. Grants are
-- restated as they are live (service_role only). The Laskutus functions (koutsi_send_invoice,
-- koutsi_invoice_paid_online) are left to the billing work. Rows already written (old notifications,
-- saldo history, sent invoices) keep their dots.

-- ── Koutsi notifications ────────────────────────────────────────────────────

-- "Juniorit vihreä, ti 4.11. klo 17:00"
create or replace function public.koutsi_on_training_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_student uuid; v_what text;
begin
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then
    return new;
  end if;
  if new.logged_by = 'player' then
    return new;
  end if;
  select coalesce(g.name, new.type) into v_what from (select 1) x left join koutsi_groups g on g.id = new.group_id;
  for v_student in select * from koutsi_training_audience(new) loop
    perform koutsi_notify(v_student, new.coach_id, 'training_added',
      'Uusi treeni kalenterissasi',
      coalesce(v_what, new.type) || ', ' || public.koutsi_session_when(new.date, new.time),
      '/pelaaja');
  end loop;
  return new;
end; $function$;

create or replace function public.koutsi_on_training_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_student uuid; v_what text;
begin
  if old.date < current_date then
    return old;
  end if;
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then
    return old;
  end if;
  if old.logged_by = 'player' then
    return old;
  end if;
  select coalesce(g.name, old.type) into v_what from (select 1) x left join koutsi_groups g on g.id = old.group_id;
  for v_student in select * from koutsi_training_audience(old) loop
    perform koutsi_notify(v_student, old.coach_id, 'training_cancelled',
      'Treeni peruttu',
      coalesce(v_what, old.type) || ', ' || public.koutsi_session_when(old.date, old.time),
      '/pelaaja');
  end loop;
  return old;
end; $function$;

-- "Juniorit vihreä, ti 4.11. klo 18:00 (oli klo 17:00)"
create or replace function public.koutsi_on_training_moved()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_student uuid;
  v_what text;
  v_was text;
begin
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then
    return new;
  end if;
  if new.logged_by = 'player' then
    return new;
  end if;
  if new.date = old.date and new.time = old.time then
    return new;
  end if;
  -- a time fixed afterwards on a session that is over is no news to anyone
  if public.koutsi_session_started(old.date, old.time) and public.koutsi_session_started(new.date, new.time) then
    return new;
  end if;
  select coalesce(g.name, new.type) into v_what from (select 1) x left join koutsi_groups g on g.id = new.group_id;
  v_was := case when new.date = old.date then 'klo ' || to_char(old.time, 'HH24:MI')
                else public.koutsi_session_when(old.date, old.time) end;
  for v_student in select * from koutsi_training_audience(new) loop
    perform koutsi_notify(v_student, new.coach_id, 'training_moved',
      'Treeni siirtyi',
      coalesce(v_what, new.type) || ', ' || public.koutsi_session_when(new.date, new.time) || ' (oli ' || v_was || ')',
      '/pelaaja');
  end loop;
  return new;
end;
$function$;

-- The body of "<nimi> ei pääse" and "<nimi> pääseekin". koutsi_on_absence_withdrawn finds an unread
-- "ei pääse" by this text: one written just before applying and taken back within its 10 minutes is
-- not removed silently, the coach gets "pääseekin" instead. Harmless, and only in those minutes.
create or replace function public.koutsi_absence_notice(p_training_id uuid, p_student uuid, out coach_id uuid, out who text, out what text)
returns record
language sql
stable
security definer
set search_path to 'public'
as $function$
  select t.coach_id,
         coalesce(nullif(btrim(p.name), ''), nullif(btrim(s.display_name), ''), 'Pelaaja'),
         coalesce(g.name, t.type) || ', ' || public.koutsi_session_when(t.date, t.time)
    from koutsi_trainings t
    left join koutsi_groups g on g.id = t.group_id
    left join profiles p on p.id = p_student
    left join koutsi_students s on s.id = p_student
   where t.id = p_training_id
     and t.logged_by <> 'player'
     and not public.koutsi_session_started(t.date, t.time)
$function$;

-- "Juniorit vihreä, 4.11. klo 17:00. Toivottavasti oli hyvä valmennus! …"
create or replace function public.koutsi_queue_session_checkins()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_session record;
  v_student uuid;
  v_queued integer := 0;
begin
  for v_session in
    select t.id, t.date, t.time, t.type, t.coach_id, g.name as group_name,
           (t.date + t.time) at time zone 'Europe/Helsinki' as starts_at,
           ((t.date + t.time) at time zone 'Europe/Helsinki')
             + make_interval(mins => coalesce(t.duration_minutes, g.duration_minutes, 60)) as ends_at
      from public.koutsi_trainings t
      left join public.koutsi_groups g on g.id = t.group_id
     where t.logged_by = 'coach'
       and t.date between ((now() at time zone 'Europe/Helsinki')::date - 1) and (now() at time zone 'Europe/Helsinki')::date
  loop
    continue when v_session.ends_at > now() - interval '15 minutes'
               or v_session.ends_at < now() - interval '3 hours';

    for v_student in
      select a.id
        from public.koutsi_training_audience(
               (select t from public.koutsi_trainings t where t.id = v_session.id)
             ) as a(id)
    loop
      continue when not exists (select 1 from auth.users u where u.id = v_student);
      continue when exists (
        select 1 from public.koutsi_training_absences ab
         where ab.training_id = v_session.id and ab.student_id = v_student
      );
      continue when exists (
        select 1 from public.koutsi_moods m
         where m.student_id = v_student and m.created_at >= v_session.starts_at
      );
      continue when exists (
        select 1 from public.koutsi_session_checkin_log l
         where l.student_id = v_student and (l.training_id = v_session.id or l.session_date = v_session.date)
      );

      insert into public.koutsi_session_checkin_log (training_id, student_id, session_date)
      values (v_session.id, v_student, v_session.date);

      -- no actor: the question comes from Koutsi, not from the coach
      perform public.koutsi_notify(
        v_student, null, 'session_checkin',
        'Treenit ohi! Miten meni?',
        coalesce(v_session.group_name, v_session.type) || ', ' || to_char(v_session.date, 'FMDD.FMMM.') || ' klo '
          || to_char(v_session.time, 'HH24:MI')
          || '. Toivottavasti oli hyvä valmennus! Kerro yhdellä napautuksella, millaiset fiilikset jäi.',
        '/pelaaja?uusi=1&fiilis=' || v_session.id
      );
      v_queued := v_queued + 1;
    end loop;
  end loop;
  return v_queued;
end;
$function$;

revoke all on function public.koutsi_on_training_insert() from public, anon, authenticated;
grant execute on function public.koutsi_on_training_insert() to service_role;
revoke all on function public.koutsi_on_training_delete() from public, anon, authenticated;
grant execute on function public.koutsi_on_training_delete() to service_role;
revoke all on function public.koutsi_on_training_moved() from public, anon, authenticated;
grant execute on function public.koutsi_on_training_moved() to service_role;
revoke all on function public.koutsi_absence_notice(uuid, uuid) from public, anon, authenticated;
grant execute on function public.koutsi_absence_notice(uuid, uuid) to service_role;
revoke all on function public.koutsi_queue_session_checkins() from public, anon, authenticated;
grant execute on function public.koutsi_queue_session_checkins() to service_role;

-- ── Krossi bookings and billing ─────────────────────────────────────────────

-- "Tennis 2, Janus-Areena, ti 6.10. klo 19.00", in the saldo and sarjakortti history:
-- "Peruttu: …", "Osuus: …", "<nimi> maksoi osuutensa: …".
create or replace function public.krossi_booking_label(r public.booking_reservations)
returns text
language sql
stable
set search_path to ''
as $function$
  select c.name || ', ' || l.name || ', '
    || (array['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'])[extract(isodow from r.starts_at at time zone v.timezone)::integer]
    || ' ' || to_char(r.starts_at at time zone v.timezone, 'FMDD.FMMM.')
    || ' klo ' || to_char(r.starts_at at time zone v.timezone, 'FMHH24.MI')
  from public.booking_courts c
  join public.booking_locations l on l.id = c.location_id
  join public.booking_venues v on v.id = c.venue_id
  where c.id = r.court_id;
$function$;

-- Invoice line "Kausivuoro ti 19.00–20.00, Tennis 2, Janus-Areena, 6.10.2026–15.12.2026"
create or replace function public.krossi_season_activate(slot_id_input uuid, court_id_input uuid, price_cents_input integer, skip_conflicts_input boolean, actor_input uuid)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  v_slot public.booking_season_slots;
  v_season public.booking_seasons;
  v_venue public.booking_venues;
  v_court public.booking_courts;
  v_settings public.booking_billing_settings;
  v_today date;
  v_from date;
  v_quote jsonb;
  v_conflicts integer;
  v_dates text;
  v_free jsonb;
  v_count integer;
  v_price integer;
  v_number integer;
  v_lines jsonb;
  v_first date;
  v_last date;
begin
  select * into v_slot from public.booking_season_slots where id = slot_id_input for update;
  select * into v_season from public.booking_seasons where id = v_slot.season_id;
  select * into v_venue from public.booking_venues where id = v_slot.venue_id;
  select * into v_court from public.booking_courts
   where id = coalesce(court_id_input, v_slot.court_id) and venue_id = v_venue.id and is_active and sport = v_slot.sport;
  if not found then
    raise exception 'Kenttää ei löytynyt.';
  end if;

  if v_slot.billing = 'card' then
    if price_cents_input is not null then
      raise exception 'Kortilta veloitettavan kausivuoron hinta tulee kauden hinnoista.';
    end if;
    if v_slot.holder_id is null or not exists (select 1 from public.booking_saved_cards k where k.user_id = v_slot.holder_id) then
      raise exception 'Pelaajalla ei ole tallennettua korttia kuukausiveloituksiin.';
    end if;
  else
    select * into v_settings from public.booking_billing_settings where venue_id = v_venue.id;
    if v_settings.venue_id is null or nullif(btrim(coalesce(v_settings.seller_name, '')), '') is null or v_settings.iban is null then
      raise exception 'Hallin laskutustiedot puuttuvat (nimi ja tilinumero). Lisää ne ennen laskutusta.';
    end if;
  end if;
  if price_cents_input is not null and price_cents_input < 0 then
    raise exception 'Tarkista hinta.';
  end if;

  v_today := public.krossi_booking_today(v_venue.id);
  if v_season.ends_on < v_today then
    raise exception 'Kausi on jo päättynyt.';
  end if;
  v_from := greatest(v_slot.starts_on, v_today);

  -- Vanhentuneet pidot ovat yhä exclusion-constraintissa: vapautetaan kentän pidot kauden ajalta.
  update public.booking_reservations r
     set status = 'expired'
   where r.court_id = v_court.id
     and r.status = 'held'
     and r.hold_expires_at <= now()
     and r.ends_at > v_from::timestamp at time zone v_venue.timezone;

  v_quote := public.krossi_season_quote_internal(v_season.id, v_court.id, null, v_court.sport, v_slot.weekday,
    v_slot.start_time, v_slot.minutes, v_from);

  select count(*)::integer,
         string_agg(to_char((w.value ->> 'date')::date, 'FMDD.FMMM.'), ', ' order by w.value ->> 'date')
           filter (where w.i <= 6)
    into v_conflicts, v_dates
  from (
    select value, row_number() over (order by value ->> 'date') as i
    from jsonb_array_elements(v_quote -> 'weeks')
    where value -> 'conflict' <> 'null'::jsonb
  ) w;
  if v_conflicts > 0 and not coalesce(skip_conflicts_input, false) then
    raise exception 'Kenttä on varattu % (%). Ohita ne viikot tai valitse toinen kenttä.',
      case when v_conflicts = 1 then 'yhtenä viikkona' else v_conflicts || ' viikkona' end,
      v_dates || case when v_conflicts > 6 then '…' else '' end;
  end if;

  select coalesce(jsonb_agg(value order by value ->> 'date'), '[]'::jsonb) into v_free
  from jsonb_array_elements(v_quote -> 'weeks')
  where value -> 'conflict' = 'null'::jsonb;
  v_count := jsonb_array_length(v_free);
  if v_count = 0 then
    raise exception 'Kenttä ei ole vapaana yhtenäkään kauden viikkona.';
  end if;
  v_price := coalesce(price_cents_input, (v_quote ->> 'cents')::integer);
  v_first := (v_free -> 0 ->> 'date')::date;
  v_last := (v_free -> (v_count - 1) ->> 'date')::date;

  update public.booking_season_slots
     set court_id = v_court.id,
         location_id = v_court.location_id,
         starts_on = v_first,
         skip_dates = (
           select coalesce(array_agg(distinct d order by d), '{}')
           from (
             select d from unnest(v_slot.skip_dates) d where d < v_from
             union select x::date from jsonb_array_elements_text(v_quote -> 'skipped') x
             union select (w.value ->> 'date')::date from jsonb_array_elements(v_quote -> 'weeks') w
               where w.value -> 'conflict' <> 'null'::jsonb
           ) all_dates
         ),
         price_cents = v_price,
         weeks = v_count,
         status = 'active',
         decided_at = now(),
         decided_by = actor_input
   where id = v_slot.id
  returning * into v_slot;

  begin
    insert into public.booking_reservations (
      venue_id, court_id, starts_at, ends_at, kind, status, booked_by, title, price_cents, payment_status,
      season_slot_id, created_by
    )
    select v_venue.id, v_court.id, (w.value ->> 'startsAt')::timestamptz, (w.value ->> 'endsAt')::timestamptz, 'season',
      'confirmed', v_slot.holder_id, 'Kausivuoro',
      round((w.value ->> 'cents')::numeric * (100 - (v_quote ->> 'discountPercent')::integer) / 100)::integer,
      'none', v_slot.id, actor_input
    from jsonb_array_elements(v_free) w;
  exception when exclusion_violation then
    raise exception 'Kenttä ehti varautua juuri nyt. Päivitä ja yritä uudelleen.';
  end;

  if v_slot.billing = 'invoice' then
    update public.booking_billing_settings
       set next_invoice_number = next_invoice_number + 1, updated_at = now()
     where venue_id = v_venue.id
    returning next_invoice_number - 1 into v_number;

    v_lines := jsonb_build_array(jsonb_build_object(
      'text', 'Kausivuoro '
        || (array['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'])[v_slot.weekday] || ' '
        || to_char(v_slot.start_time, 'FMHH24.MI') || '–' || to_char(v_slot.start_time + make_interval(mins => v_slot.minutes), 'FMHH24.MI')
        || ', ' || v_court.name || ', ' || (select l.name from public.booking_locations l where l.id = v_court.location_id)
        || ', ' || to_char(v_first, 'FMDD.FMMM.YYYY') || '–' || to_char(v_last, 'FMDD.FMMM.YYYY'),
      'quantity', v_count,
      'unit', 'krt',
      'unitCents', round((v_quote ->> 'fullCents')::numeric / v_count)::integer,
      'totalCents', (v_quote ->> 'fullCents')::integer
    ));
    if v_price <> (v_quote ->> 'fullCents')::integer then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'text', case when price_cents_input is not null and price_cents_input <> (v_quote ->> 'cents')::integer
          then 'Sovittu kausihinta' else 'Kausialennus ' || (v_quote ->> 'discountPercent') || ' %' end,
        'quantity', 1,
        'unit', '',
        'unitCents', null,
        'totalCents', v_price - (v_quote ->> 'fullCents')::integer
      ));
    end if;

    insert into public.booking_invoices (
      venue_id, season_slot_id, number, reference, issued_on, due_on, amount_cents, vat_percent, lines, recipient,
      seller, created_by
    ) values (
      v_venue.id, v_slot.id, v_number::text, public.krossi_reference_number(v_number::text), v_today,
      v_today + v_settings.payment_terms_days, v_price, v_settings.vat_percent, v_lines,
      jsonb_build_object('name', v_slot.holder_name, 'email', v_slot.billing_email, 'address', v_slot.billing_address),
      jsonb_build_object('name', v_settings.seller_name, 'businessId', v_settings.business_id, 'address', v_settings.address,
        'iban', v_settings.iban, 'bic', v_settings.bic, 'email', v_settings.email, 'phone', v_settings.phone),
      actor_input
    );
  else
    insert into public.booking_season_charges (venue_id, season_slot_id, month, weeks, amount_cents, due_on)
    select v_venue.id, v_slot.id, m.value ->> 'month', (m.value ->> 'count')::integer, (m.value ->> 'cents')::integer,
      greatest(((m.value ->> 'month') || '-01')::date, v_today)
    from jsonb_array_elements(v_quote -> 'months') m;
  end if;
end;
$function$;

-- Stripe description of the monthly kausivuoro card charge: "Kausivuoro Matti Meikäläinen, 2026-11, Lahden
-- Tennishalli" (same text as krossi-billing's on-session payment).
create or replace function public.krossi_billing_due_charges(venue_id_input uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'chargeId', c.id,
    'venueId', c.venue_id,
    'seasonSlotId', c.season_slot_id,
    'userId', s.holder_id,
    'month', c.month,
    'amountCents', c.amount_cents,
    'status', c.status,
    'attempts', c.attempts,
    'paymentIntentId', c.stripe_payment_intent_id,
    'customerId', k.stripe_customer_id,
    'paymentMethodId', k.stripe_payment_method_id,
    'stripeAccountId', v.stripe_account_id,
    'platformFeeBps', v.platform_fee_bps,
    'description', 'Kausivuoro ' || s.holder_name || ', ' || c.month || ', ' || v.name
  ) order by c.due_on, c.id), '[]'::jsonb)
  from public.booking_season_charges c
  join public.booking_season_slots s on s.id = c.season_slot_id
  join public.booking_venues v on v.id = c.venue_id
  left join public.booking_saved_cards k on k.user_id = s.holder_id
  where (venue_id_input is null or c.venue_id = venue_id_input)
    and s.status = 'active'
    and s.billing = 'card'
    and c.due_on <= (now() at time zone v.timezone)::date
    and (
      c.status = 'scheduled'
      or (c.status = 'failed' and c.attempts < 4 and (c.last_attempt_at is null or c.last_attempt_at < now() - interval '20 hours'))
      or (c.status = 'processing' and c.last_attempt_at < now() - interval '1 hour')
    );
$function$;

revoke all on function public.krossi_booking_label(public.booking_reservations) from public, anon, authenticated;
grant execute on function public.krossi_booking_label(public.booking_reservations) to service_role;
revoke all on function public.krossi_season_activate(uuid, uuid, integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.krossi_season_activate(uuid, uuid, integer, boolean, uuid) to service_role;
revoke all on function public.krossi_billing_due_charges(uuid) from public, anon, authenticated;
grant execute on function public.krossi_billing_due_charges(uuid) to service_role;
