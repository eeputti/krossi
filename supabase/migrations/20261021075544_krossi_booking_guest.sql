-- Krossi: kenttävaraus ilman tiliä (vierasvaraus). Kuka tahansa voi varata julkisen hallin kentän
-- nimellä ja sähköpostilla, kunhan maksaa sen heti: vuoro on varattu vasta, kun maksu on mennyt läpi
-- (sama pito + maksu kuin kirjautuneella pelaajalla). Vahvistus ja varauksen oma linkki
-- (krossi.app/pelaa/varaus/<guest_token>) tulevat sähköpostiin; linkistä näkee varauksen ja voi perua
-- sen samoin ehdoin kuin pelaaja (peruutusraja, 1 €:n peruutuskulu kortille palautuksesta).
--
-- Vieras maksaa aina kortilla / Apple Paylla / Google Paylla / MobilePaylla. Saldo, sarja- ja
-- lahjakortit, jaettu maksu, myyntiin laitto, kausivuorot ja "ilmoita kun vapautuu" vaativat tilin.
--
-- Kaikki vieraan toiminnot kulkevat krossi-booking-funktion kautta (service_role): varauslinkin
-- salainen tunniste (guest_token) on avain, eikä tunnistetta tai sähköpostia näytetä muille.
-- Hallin henkilökunta näkee päivänäkymässä vieraan nimen ja sähköpostin (krossi_booking_staff_day).
--
--   booking_reservations + guest_name, guest_email, guest_token, guest_key, guest_cancelled,
--                          guest_mailed_at
--   uudet: krossi_booking_hold_internal (pidon tarkistukset ja lisäys, yhteinen),
--          krossi_guest_clean_name, krossi_guest_clean_email, krossi_guest_hold_booking,
--          krossi_guest_booking, krossi_guest_release, krossi_guest_cancel,
--          krossi_guest_mail_facts, krossi_guest_mail_claim, krossi_guest_mail_failed,
--          krossi_guest_mails_due
--   create or replace: krossi_hold_booking (sama toiminta, kutsuu yhteistä osaa),
--                      krossi_booking_staff_day (+ vieraan nimi ja sähköposti)
--
-- Väärinkäyttö: vieraalla voi olla kerrallaan kaksi maksamatonta pitoa samasta osoitteesta
-- (guest_key = krossi-bookingin laskema tiiviste, ei IP-osoitetta sellaisenaan) ja hallissa
-- korkeintaan 20 vieraan pitoa yhtä aikaa. Pito syntyy vasta Maksa-napista ja vanhenee hallin
-- pitoajassa. Maksuttomia aikoja ei voi varata vieraana.
--
-- Lisäävä: vanhat edge-funktiot ja sovellus toimivat tämän päällä ennen uusien julkaisua.

-- ── Sarakkeet ────────────────────────────────────────────────────────────────

alter table public.booking_reservations
  add column guest_name text,
  add column guest_email text,
  -- varauksen oma linkki (krossi_split_token-muotoinen, 24 merkkiä)
  add column guest_token text,
  -- maksamattomien pitojen raja: krossi-bookingin tiiviste osoitteesta
  add column guest_key text,
  -- vieras perui itse (peruutuskulu pidetään kuten pelaajan omassa peruutuksessa)
  add column guest_cancelled boolean not null default false,
  -- vahvistusviesti lähetetty (kerran)
  add column guest_mailed_at timestamptz,
  add constraint booking_reservations_guest check (
    guest_token is null
    or (kind = 'booking' and booked_by is null and guest_name is not null and guest_email is not null)
  ),
  add constraint booking_reservations_guest_name check (guest_name is null or length(guest_name) between 2 and 80),
  add constraint booking_reservations_guest_email check (
    guest_email is null or (length(guest_email) <= 254 and guest_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  add constraint booking_reservations_guest_token check (guest_token is null or length(guest_token) between 22 and 64),
  add constraint booking_reservations_guest_cancelled check (not guest_cancelled or guest_token is not null);

create unique index booking_reservations_guest_token_idx on public.booking_reservations (guest_token)
  where guest_token is not null;
-- maksamattomat vieraspidot (raja per osoite ja per halli)
create index booking_reservations_guest_held_idx on public.booking_reservations (venue_id, guest_key)
  where guest_token is not null and status = 'held';


-- ── Pito (yhteinen osa) ──────────────────────────────────────────────────────

-- Kentän pito pelaajalle (uid_input) tai vieraalle (uid_input null, guest_input { name, email, key,
-- token }). Samat tarkistukset kuin ennen: kenttä ja halli näkyvissä, kesto, ruudukko, aukioloaika,
-- päiviä eteenpäin, hinta, myynnissä oleva vuoro, kaksi maksamatonta pitoa kerrallaan. Vain
-- krossi_hold_booking ja krossi_guest_hold_booking kutsuvat tätä.
create function public.krossi_booking_hold_internal(
  uid_input uuid,
  guest_input jsonb,
  court_id_input uuid,
  starts_at_input timestamptz,
  minutes_input integer
)
returns public.booking_reservations
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := uid_input;
  v_guest boolean := uid_input is null;
  v_key text := guest_input ->> 'key';
  v_court public.booking_courts;
  v_venue public.booking_venues;
  v_local timestamp;
  v_end timestamptz;
  v_start_minute integer;
  v_end_minute integer;
  v_price integer;
  v_resale boolean;
  v_row public.booking_reservations;
begin
  if v_guest and (guest_input is null or v_key is null or guest_input ->> 'token' is null) then
    raise exception 'Kirjaudu sisään ensin.';
  end if;

  select * into v_court from public.booking_courts where id = court_id_input and is_active;
  if found then
    select * into v_venue from public.booking_venues where id = v_court.venue_id;
  end if;
  -- Vieras näkee vain julkiset hallit (henkilökunta on aina kirjautunut).
  if v_court.id is null or not (v_venue.is_public or (not v_guest and public.krossi_booking_is_staff(v_venue.id))) then
    raise exception 'Kenttää ei löytynyt.';
  end if;

  if minutes_input is null or not (minutes_input = any (v_venue.durations)) then
    raise exception 'Valitse varauksen kesto.';
  end if;
  if starts_at_input is null then
    raise exception 'Valitse aika kalenterista.';
  end if;

  -- Hallin paikallinen aika: alku osuu ruudukkoon (slot_minutes) ja aukioloaikaan.
  v_local := starts_at_input at time zone v_venue.timezone;
  v_start_minute := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  if extract(second from v_local) <> 0 or v_start_minute % v_venue.slot_minutes <> 0 then
    raise exception 'Valitse aika kalenterista.';
  end if;
  if starts_at_input <= now() then
    raise exception 'Tämä aika on jo mennyt.';
  end if;
  if v_local::date > (now() at time zone v_venue.timezone)::date + v_venue.days_ahead then
    raise exception 'Vuoroja voi varata % päivän päähän.', v_venue.days_ahead;
  end if;
  v_end := starts_at_input + make_interval(mins => minutes_input);
  v_end_minute := (extract(epoch from ((v_end at time zone v_venue.timezone) - v_local::date::timestamp)) / 60)::integer;
  if v_start_minute < (extract(epoch from v_venue.open_from) / 60)::integer
     or v_end_minute > (extract(epoch from v_venue.open_until) / 60)::integer then
    raise exception 'Kenttä on suljettu tähän aikaan.';
  end if;

  v_price := public.krossi_booking_price_internal(v_court.id, starts_at_input, minutes_input);
  if v_price is null then
    raise exception 'Kenttä on suljettu tähän aikaan.';
  end if;

  -- Myynnissä oleva vuoro: vain kokonaan kattava varaus käy, eikä omaa voi ostaa.
  if exists (
    select 1 from public.booking_reservations r
    where r.court_id = v_court.id
      and r.status = 'confirmed'
      and r.listed_at is not null
      and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(starts_at_input, v_end, '[)')
      and (r.starts_at < starts_at_input or r.ends_at > v_end or r.booked_by = v_uid)
  ) then
    raise exception 'Joku ehti varata tämän ajan juuri ennen sinua. Valitse toinen aika.';
  end if;
  v_resale := exists (
    select 1 from public.booking_reservations r
    where r.court_id = v_court.id
      and r.status = 'confirmed'
      and r.listed_at is not null
      and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(starts_at_input, v_end, '[)')
  );
  if not v_resale and v_venue.last_minute_hours is not null and v_venue.last_minute_percent > 0
     and starts_at_input - now() < make_interval(hours => v_venue.last_minute_hours) then
    v_price := round(v_price::numeric * (100 - v_venue.last_minute_percent) / 100)::integer;
  end if;
  -- Vieraan varaus on aina maksettava (maksuttoman ajan voi varata vain kirjautuneena).
  if v_guest and v_price < 50 then
    raise exception 'Tämän ajan voi varata vain kirjautuneena.';
  end if;

  -- Yksi pito kerrallaan per pelaaja / osoite, jotta rinnakkaiset napautukset eivät ohita rajaa.
  if v_guest then
    perform pg_advisory_xact_lock(hashtextextended('krossi_booking_hold:guest:' || v_venue.id::text, 0));
    if (
      select count(*) from public.booking_reservations r
      where r.venue_id = v_venue.id and r.guest_token is not null and r.guest_key = v_key
        and r.status = 'held' and r.hold_expires_at > now()
    ) >= 2 then
      raise exception 'Sinulla on jo kaksi maksamatonta varausta. Maksa ne tai odota hetki.';
    end if;
    if (
      select count(*) from public.booking_reservations r
      where r.venue_id = v_venue.id and r.guest_token is not null
        and r.status = 'held' and r.hold_expires_at > now()
    ) >= 20 then
      raise exception 'Varauksia tehdään juuri nyt paljon. Yritä hetken päästä uudelleen.';
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended('krossi_booking_hold:' || v_uid::text, 0));
    if (
      select count(*) from public.booking_reservations r
      where r.booked_by = v_uid and r.status = 'held' and r.hold_expires_at > now()
    ) >= 2 then
      raise exception 'Sinulla on jo kaksi maksamatonta varausta. Maksa tai peru ne ensin.';
    end if;
  end if;

  -- Vanhentuneet pidot ovat yhä exclusion-constraintissa: vapautetaan ne ensin.
  update public.booking_reservations r
     set status = 'expired'
   where r.court_id = v_court.id
     and r.status = 'held'
     and r.hold_expires_at <= now()
     and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(starts_at_input, v_end, '[)');

  begin
    insert into public.booking_reservations (
      venue_id, court_id, starts_at, ends_at, kind, status, booked_by, price_cents,
      payment_status, hold_expires_at, created_by, paid_at,
      guest_name, guest_email, guest_token, guest_key
    ) values (
      v_venue.id, v_court.id, starts_at_input, v_end, 'booking',
      case when v_price = 0 then 'confirmed' else 'held' end,
      v_uid, v_price,
      case when v_price = 0 then 'free' else 'unpaid' end,
      case when v_price = 0 then null else now() + make_interval(mins => v_venue.hold_minutes) end,
      v_uid,
      case when v_price = 0 then now() end,
      guest_input ->> 'name', guest_input ->> 'email', guest_input ->> 'token', v_key
    )
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'Joku ehti varata tämän ajan juuri ennen sinua. Valitse toinen aika.';
  end;

  if v_row.status = 'confirmed' then
    perform public.krossi_booking_take_over_sales(v_row.id);
  end if;

  return v_row;
end;
$function$;

revoke all on function public.krossi_booking_hold_internal(uuid, jsonb, uuid, timestamptz, integer) from public, anon, authenticated;


-- Pelaajan pito (ennallaan ulospäin).
create or replace function public.krossi_hold_booking(
  court_id_input uuid,
  starts_at_input timestamptz,
  minutes_input integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Täytä ensin pelaajaprofiilisi.';
  end if;
  return public.krossi_booking_json(
    public.krossi_booking_hold_internal(v_uid, null, court_id_input, starts_at_input, minutes_input)
  );
end;
$function$;


-- ── Vieras ───────────────────────────────────────────────────────────────────

-- Vieraan nimi siistittynä (välilyönnit yhdeksi), 2–80 merkkiä; muuten virhe.
create function public.krossi_guest_clean_name(name_input text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_name text := btrim(regexp_replace(coalesce(name_input, ''), '[[:space:][:cntrl:]]+', ' ', 'g'));
begin
  if length(v_name) < 2 then
    raise exception 'Kirjoita nimesi.';
  end if;
  if length(v_name) > 80 then
    raise exception 'Nimi on liian pitkä.';
  end if;
  return v_name;
end;
$function$;

revoke all on function public.krossi_guest_clean_name(text) from public, anon, authenticated;

-- Sähköposti pienillä kirjaimilla; muuten virhe.
create function public.krossi_guest_clean_email(email_input text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_email text := lower(btrim(coalesce(email_input, '')));
begin
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Tarkista sähköpostiosoite.';
  end if;
  return v_email;
end;
$function$;

revoke all on function public.krossi_guest_clean_email(text) from public, anon, authenticated;

-- Vieraan varaus + sen linkki: { booking, token }. Vain krossi-booking (service_role), joka antaa
-- osoitteen tiivisteen (key_input).
create function public.krossi_guest_hold_booking(
  court_id_input uuid,
  starts_at_input timestamptz,
  minutes_input integer,
  name_input text,
  email_input text,
  key_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_token text := public.krossi_split_token();
  v_row public.booking_reservations;
begin
  if nullif(btrim(coalesce(key_input, '')), '') is null or length(key_input) > 128 then
    raise exception 'Varaus epäonnistui. Yritä hetken päästä uudelleen.';
  end if;
  v_row := public.krossi_booking_hold_internal(
    null,
    jsonb_build_object(
      'name', public.krossi_guest_clean_name(name_input),
      'email', public.krossi_guest_clean_email(email_input),
      'key', key_input,
      'token', v_token
    ),
    court_id_input, starts_at_input, minutes_input
  );
  return jsonb_build_object('booking', public.krossi_booking_json(v_row), 'token', v_token);
end;
$function$;

revoke all on function public.krossi_guest_hold_booking(uuid, timestamptz, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.krossi_guest_hold_booking(uuid, timestamptz, integer, text, text, text) to service_role;

-- Varauslinkin näkymä: varaus (krossi_booking_json) + vieras + hallin tiedot, tai null.
create function public.krossi_guest_booking(token_input text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'booking', public.krossi_booking_json(r),
    'guest', jsonb_build_object('name', r.guest_name, 'email', r.guest_email),
    'cancelledByGuest', r.guest_cancelled,
    'venue', jsonb_build_object(
      'slug', v.slug,
      'name', v.name,
      'cancelLimitHours', v.cancel_limit_hours,
      'holdMinutes', v.hold_minutes
    )
  )
  from public.booking_reservations r
  join public.booking_venues v on v.id = r.venue_id
  where token_input is not null and r.guest_token = token_input;
$function$;

revoke all on function public.krossi_guest_booking(text) from public, anon, authenticated;
grant execute on function public.krossi_guest_booking(text) to service_role;

-- Maksamaton pito pois (vieras sulki maksun): pito päättyy heti. Tila 'expired' kuten vanhentunut
-- pito, joten jos maksu ehtii silti perille, krossi_booking_mark_paid ottaa kentän takaisin, jos se on
-- yhä vapaa (muuten maksu palautetaan). → varauksen id tai null.
create function public.krossi_guest_release(token_input text)
returns uuid
language sql
security definer
set search_path = ''
as $function$
  update public.booking_reservations
     set status = 'expired', hold_expires_at = least(hold_expires_at, now())
   where token_input is not null
     and guest_token = token_input
     and status = 'held'
     and payment_status = 'unpaid'
  returning id;
$function$;

revoke all on function public.krossi_guest_release(text) from public, anon, authenticated;
grant execute on function public.krossi_guest_release(text) to service_role;

-- Vieras perui vahvistetun varauksensa ennen peruutusrajaa: krossi_booking_cancel (by null) +
-- guest_cancelled, jotta peruutuskulu pidetään. → palautettavat osat (krossi_booking_paid_parts).
-- Jo peruttu: uusintayritys saa sen, mikä on yhä palauttamatta.
create function public.krossi_guest_cancel(token_input text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
  v_venue public.booking_venues;
begin
  select * into v_row from public.booking_reservations
   where token_input is not null and guest_token = token_input
   for update;
  if not found then
    raise exception 'Varausta ei löytynyt.';
  end if;
  if v_row.status = 'cancelled' and v_row.guest_cancelled then
    return public.krossi_booking_cancel(v_row.id, null, true);
  end if;
  if v_row.status <> 'confirmed' then
    raise exception 'Tätä varausta ei voi enää perua.';
  end if;
  select * into v_venue from public.booking_venues where id = v_row.venue_id;
  if now() >= v_row.starts_at - make_interval(hours => v_venue.cancel_limit_hours) then
    raise exception 'Peruutusaika on mennyt. Ota yhteyttä halliin.';
  end if;
  update public.booking_reservations set guest_cancelled = true where id = v_row.id;
  return public.krossi_booking_cancel(v_row.id, null, true);
end;
$function$;

revoke all on function public.krossi_guest_cancel(text) from public, anon, authenticated;
grant execute on function public.krossi_guest_cancel(text) to service_role;


-- ── Vieraan sähköpostit ──────────────────────────────────────────────────────

-- Mitä vieraalle lähtevä viesti kertoo varauksesta, tai null (ei vierasvarausta).
create function public.krossi_guest_mail_facts(booking_id_input uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'bookingId', r.id,
    'name', r.guest_name,
    'email', r.guest_email,
    'token', r.guest_token,
    'status', r.status,
    'paymentStatus', r.payment_status,
    'startsAt', public.krossi_booking_iso(r.starts_at),
    'endsAt', public.krossi_booking_iso(r.ends_at),
    'priceCents', r.price_cents,
    'courtName', c.name,
    'locationName', l.name,
    'venueName', v.name,
    'timezone', v.timezone,
    'cancelLimitHours', v.cancel_limit_hours,
    'cancellableUntil', public.krossi_booking_iso(r.starts_at - make_interval(hours => v.cancel_limit_hours))
  )
  from public.booking_reservations r
  join public.booking_courts c on c.id = r.court_id
  join public.booking_locations l on l.id = c.location_id
  join public.booking_venues v on v.id = r.venue_id
  where r.id = booking_id_input and r.guest_token is not null;
$function$;

revoke all on function public.krossi_guest_mail_facts(uuid) from public, anon, authenticated;
grant execute on function public.krossi_guest_mail_facts(uuid) to service_role;

-- Vahvistusviesti kerran: leimaa guest_mailed_at vahvistetulle, maksetulle vierasvaraukselle ja
-- palauttaa viestin tiedot, tai null (ei lähetettävää). Lähetys epäonnistui: krossi_guest_mail_failed
-- poistaa leiman, ja krossi-booking-cron yrittää uudelleen (krossi_guest_mails_due).
create function public.krossi_guest_mail_claim(booking_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  update public.booking_reservations
     set guest_mailed_at = now()
   where id = booking_id_input
     and guest_token is not null
     and guest_mailed_at is null
     and status = 'confirmed'
     and payment_status = 'paid'
  returning id into v_id;
  if v_id is null then
    return null;
  end if;
  return public.krossi_guest_mail_facts(v_id);
end;
$function$;

revoke all on function public.krossi_guest_mail_claim(uuid) from public, anon, authenticated;
grant execute on function public.krossi_guest_mail_claim(uuid) to service_role;

create function public.krossi_guest_mail_failed(booking_id_input uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.booking_reservations set guest_mailed_at = null
   where id = booking_id_input and guest_token is not null;
$function$;

revoke all on function public.krossi_guest_mail_failed(uuid) from public, anon, authenticated;
grant execute on function public.krossi_guest_mail_failed(uuid) to service_role;

-- Vahvistetut vierasvaraukset, joiden vahvistusviesti puuttuu (maksettu viimeisen vuorokauden aikana,
-- vuoro ei ole vielä alkanut): krossi-booking-cron lähettää ne.
create function public.krossi_guest_mails_due(limit_input integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(x.id), '[]'::jsonb)
  from (
    select r.id
    from public.booking_reservations r
    where r.guest_token is not null
      and r.guest_mailed_at is null
      and r.status = 'confirmed'
      and r.payment_status = 'paid'
      and r.paid_at > now() - interval '1 day'
      and r.starts_at > now()
    order by r.paid_at
    limit greatest(1, least(coalesce(limit_input, 50), 200))
  ) x;
$function$;

revoke all on function public.krossi_guest_mails_due(integer) from public, anon, authenticated;
grant execute on function public.krossi_guest_mails_due(integer) to service_role;


-- ── Hallin päivä: vieraan nimi ja sähköposti ─────────────────────────────────

create or replace function public.krossi_booking_staff_day(venue_id_input uuid, day_input date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_venue public.booking_venues;
  v_from timestamptz;
  v_to timestamptz;
begin
  if not public.krossi_booking_is_staff(venue_id_input) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  select * into v_venue from public.booking_venues where id = venue_id_input;
  if not found then
    raise exception 'Hallia ei löytynyt.';
  end if;
  if day_input is null then
    raise exception 'Valitse päivä.';
  end if;

  v_from := day_input::timestamp at time zone v_venue.timezone;
  v_to := (day_input + 1)::timestamp at time zone v_venue.timezone;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'courtId', r.court_id,
      'startsAt', public.krossi_booking_iso(r.starts_at),
      'endsAt', public.krossi_booking_iso(r.ends_at),
      'kind', r.kind,
      'status', r.status,
      'title', case
        when r.kind = 'booking' then null
        when r.kind = 'season' then coalesce(s.holder_name, r.title)
        else r.title
      end,
      'bookedBy', case
        when r.kind in ('booking', 'season') and r.booked_by is not null then jsonb_build_object(
          'id', r.booked_by,
          'name', coalesce(nullif(btrim(p.name), ''), 'Pelaaja'),
          'avatarUrl', p.avatar_url,
          'avatarColor', coalesce(p.avatar_color, 'blue'),
          'ageRange', p.age,
          -- '' = pelaajalla on tennis_preferences-rivi ilman tasoa; null = ei riviä
          'skillLevel', tp.skill_level
        )
        -- vieras (ei tiliä): nimi ja sähköposti hallin yhteydenottoa varten
        when r.guest_token is not null then jsonb_build_object(
          'id', null,
          'name', r.guest_name,
          'email', r.guest_email,
          'guest', true,
          'avatarUrl', null,
          'avatarColor', 'blue',
          'ageRange', null,
          'skillLevel', null
        )
      end,
      'priceCents', r.price_cents,
      'paymentStatus', r.payment_status,
      'seasonSlotId', r.season_slot_id,
      'credit', public.krossi_booking_credit_json(r),
      'forSale', r.status = 'confirmed' and r.listed_at is not null
    ) order by r.starts_at, c.sort, c.name, r.id)
    from public.booking_reservations r
    join public.booking_courts c on c.id = r.court_id
    left join public.booking_season_slots s on s.id = r.season_slot_id
    left join public.profiles p on p.id = r.booked_by
    left join lateral (
      select coalesce(t.skill_level, '') as skill_level
      from public.tennis_preferences t
      where t.user_id = r.booked_by
      limit 1
    ) tp on true
    where r.venue_id = v_venue.id
      and r.status in ('held', 'confirmed')
      and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(v_from, v_to, '[)')
      and (r.status = 'confirmed' or r.hold_expires_at > now())
  ), '[]'::jsonb);
end;
$function$;
