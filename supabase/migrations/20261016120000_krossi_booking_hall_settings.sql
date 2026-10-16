-- Krossi-kenttävaraus: hallin asetukset sovelluksessa (/pelaa/halli/:venue?nakyma=asetukset).
--
-- Vaiheen 2 (20261016100000_krossi_booking_seasons_billing_wallet.sql) kaudet, sarjakorttituotteet,
-- lahjakorttien summat ja hallin laskutustiedot olivat vain seed-SQL:ää. Nyt hallin henkilökunta
-- (krossi_booking_is_staff: hallin booking_staff tai Krossin ylläpito) muokkaa niitä sovelluksessa
-- näiden SECURITY DEFINER -funktioiden kautta; tauluihin ei edelleenkään pääse suoraan.
-- Tarkistukset ja suomenkieliset virheet ovat samat ja samassa järjestyksessä kuin sovelluksen
-- src/features/seasons.js:ssä (checkSeason, checkPassProduct, checkGiftSettings,
-- checkBillingSettings): Y-tunnuksen tarkiste, IBANin mod 97, BIC.
--
-- Muutokset koskevat uusia hakemuksia, hyväksyntöjä, tilauksia ja laskuja: voimassa olevan
-- kausivuoron viikot ja hinta, maksetun sarjakortin sisältö ja tehdyn laskun myyjätiedot pysyvät.
--   * Kauden päivien pitää kattaa sen voimassa olevien kausivuorojen viikot.
--   * Kautta, jolla on kausivuoroja tai hakemuksia, ei voi poistaa (haun voi sulkea).
--   * Sarjakorttia, jota on tilattu, ei voi poistaa (sen voi piilottaa myynnistä). Maksamattomat
--     tilaukset saavat tuotteen uuden sisällön ja hinnan; vanhalla summalla maksettu tilaus
--     palautetaan kuten ennenkin (krossi_wallet_order_paid → 'duplicate').
--   * Seuraavan laskun numeron pitää olla suurempi kuin yksikään jo käytetty.
--
-- Päätöksen sähköposti: booking_season_slots.notified_at = milloin pelaajalle lähti sähköposti
-- hallin päätöksestä hänen hakemukseensa (hyväksytty tai hylätty). krossi-billing ('seasonDecided',
-- hallin henkilökunta heti päätöksen jälkeen) varaa lähetyksen krossi_season_decision_claim:lla —
-- kerran, enintään vuorokausi päätöksestä — ja vapauttaa sen krossi_season_decision_release:lla,
-- jos posti ei lähtenyt.
--
-- create or replace: krossi_season_slot_json (+ notifiedAt). Koutsiin (sama tietokanta) ei kosketa.

alter table public.booking_season_slots add column notified_at timestamptz;

comment on column public.booking_season_slots.notified_at is
  'Milloin pelaajalle lähti sähköposti hallin päätöksestä (krossi-billing seasonDecided).';


-- ── SeasonSlot + notifiedAt ──────────────────────────────────────────────────

create or replace function public.krossi_season_slot_json(s public.booking_season_slots)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', s.id,
    'venueId', s.venue_id,
    'seasonId', s.season_id,
    'seasonName', se.name,
    'sport', s.sport,
    'courtId', s.court_id,
    'courtName', c.name,
    'locationId', coalesce(c.location_id, s.location_id),
    'locationName', coalesce(l.name, ''),
    'weekday', s.weekday,
    'startTime', to_char(s.start_time, 'HH24:MI'),
    'minutes', s.minutes,
    'startsOn', public.krossi_booking_date(s.starts_on),
    'endsOn', public.krossi_booking_date(se.ends_on),
    'skipDates', coalesce((select jsonb_agg(public.krossi_booking_date(d) order by d) from unnest(s.skip_dates) d), '[]'::jsonb),
    'status', s.status,
    'billing', s.billing,
    'priceCents', s.price_cents,
    'weeks', s.weeks,
    'holderName', s.holder_name,
    'holder', case when s.holder_id is not null then public.krossi_booking_person_json(s.holder_id) end,
    'billingEmail', s.billing_email,
    'billingAddress', s.billing_address,
    'note', s.note,
    'declineReason', s.decline_reason,
    'nextAt', case when s.status = 'active' then (
      select public.krossi_booking_iso(min(r.starts_at)) from public.booking_reservations r
      where r.season_slot_id = s.id and r.status = 'confirmed' and r.starts_at > now()
    ) end,
    'invoice', case when s.billing = 'invoice' then (
      select jsonb_build_object('id', i.id, 'number', i.number, 'dueOn', public.krossi_booking_date(i.due_on),
        'amountCents', i.amount_cents, 'status', i.status)
      from public.booking_invoices i
      where i.season_slot_id = s.id and i.status <> 'void'
      order by i.created_at desc, i.number desc
      limit 1
    ) end,
    'charges', case when s.billing = 'card' then coalesce((
      select jsonb_agg(public.krossi_billing_charge_json(ch) order by ch.month)
      from public.booking_season_charges ch where ch.season_slot_id = s.id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'createdAt', public.krossi_booking_iso(s.created_at),
    'decidedAt', public.krossi_booking_iso(s.decided_at),
    'notifiedAt', public.krossi_booking_iso(s.notified_at)
  )
  from public.booking_seasons se
  left join public.booking_courts c on c.id = s.court_id
  left join public.booking_locations l on l.id = coalesce(c.location_id, s.location_id)
  where se.id = s.season_id;
$function$;

revoke all on function public.krossi_season_slot_json(public.booking_season_slots) from public, anon, authenticated;


-- ── Tarkisteet ───────────────────────────────────────────────────────────────

-- Y-tunnus tallennusmuodossa ('1234567-1') tai null, jos se ei ole kelvollinen. Kelpaa myös
-- '12345671', vanha kuusinumeroinen '123456-7' (etunolla) ja ALV-tunnus 'FI12345671'. Tarkiste:
-- numerot kertoimilla 7, 9, 10, 5, 8, 4, 2, summan jakojäännös 11:llä vähennetään 11:stä
-- (0 → 0; jakojäännös 1 ei ole koskaan kelvollinen).
create function public.krossi_business_id(input text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v text := upper(regexp_replace(coalesce(input, ''), '[[:space:]]', '', 'g'));
  v_weights integer[] := array[7, 9, 10, 5, 8, 4, 2];
  v_sum integer := 0;
  v_rest integer;
begin
  if v ~ '^FI[0-9]{8}$' then
    v := substr(v, 3);
  end if;
  if v ~ '^[0-9]{8}$' then
    v := substr(v, 1, 7) || '-' || substr(v, 8, 1);
  end if;
  if v ~ '^[0-9]{6}-[0-9]$' then
    v := '0' || v;
  end if;
  if v !~ '^[0-9]{7}-[0-9]$' then
    return null;
  end if;
  for i in 1..7 loop
    v_sum := v_sum + substr(v, i, 1)::integer * v_weights[i];
  end loop;
  v_rest := v_sum % 11;
  if v_rest = 1 or (case when v_rest = 0 then 0 else 11 - v_rest end) <> substr(v, 9, 1)::integer then
    return null;
  end if;
  return v;
end;
$function$;

revoke all on function public.krossi_business_id(text) from public, anon, authenticated;

-- IBAN tallennusmuodossa (isot kirjaimet, ei välejä) tai null (ISO 13616): neljä ensimmäistä
-- merkkiä loppuun, kirjaimet luvuiksi 10–35, luvun jakojäännös 97:llä = 1. Suomalainen on 18 merkkiä.
create function public.krossi_iban(input text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v text := upper(regexp_replace(coalesce(input, ''), '[[:space:]-]', '', 'g'));
  v_moved text;
  v_ch text;
  v_digits text;
  v_rest integer := 0;
begin
  if v !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' or (left(v, 2) = 'FI' and length(v) <> 18) then
    return null;
  end if;
  v_moved := substr(v, 5) || left(v, 4);
  for i in 1..length(v_moved) loop
    v_ch := substr(v_moved, i, 1);
    v_digits := case when v_ch ~ '[A-Z]' then (ascii(v_ch) - 55)::text else v_ch end;
    for j in 1..length(v_digits) loop
      v_rest := (v_rest * 10 + substr(v_digits, j, 1)::integer) % 97;
    end loop;
  end loop;
  return case when v_rest = 1 then v end;
end;
$function$;

revoke all on function public.krossi_iban(text) from public, anon, authenticated;


-- ── Kaudet ───────────────────────────────────────────────────────────────────

-- Kauden voimassa olevien kausivuorojen ensimmäinen ja viimeinen pelattava viikko (hallin päivinä).
create function public.krossi_season_booked_range(season_id_input uuid)
returns table (first_day date, last_day date)
language sql
stable
set search_path = ''
as $function$
  select min((r.starts_at at time zone v.timezone)::date), max((r.starts_at at time zone v.timezone)::date)
  from public.booking_reservations r
  join public.booking_season_slots x on x.id = r.season_slot_id
  join public.booking_venues v on v.id = r.venue_id
  where x.season_id = season_id_input and x.status = 'active' and r.status = 'confirmed';
$function$;

revoke all on function public.krossi_season_booked_range(uuid) from public, anon, authenticated;

-- StaffSeason (api/contract.js): Season + kausivuorot, hakemukset, pelattavat viikot ja voiko poistaa.
create function public.krossi_season_staff_json(s public.booking_seasons)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select public.krossi_season_json(s) || jsonb_build_object(
    'activeSlots', (select count(*)::integer from public.booking_season_slots x where x.season_id = s.id and x.status = 'active'),
    'requests', (select count(*)::integer from public.booking_season_slots x where x.season_id = s.id and x.status = 'requested'),
    'bookedFrom', public.krossi_booking_date(b.first_day),
    'bookedUntil', public.krossi_booking_date(b.last_day),
    'removable', not exists (select 1 from public.booking_season_slots x where x.season_id = s.id)
  )
  from public.krossi_season_booked_range(s.id) b;
$function$;

revoke all on function public.krossi_season_staff_json(public.booking_seasons) from public, anon, authenticated;

-- StaffSeason[]: hallin kaikki kaudet (myös päättyneet), aikaisin ensin.
create function public.krossi_season_staff_seasons(venue_id_input uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.krossi_booking_is_staff(venue_id_input) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  return coalesce((
    select jsonb_agg(public.krossi_season_staff_json(s) order by s.starts_on, s.id)
    from public.booking_seasons s
    where s.venue_id = venue_id_input
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.krossi_season_staff_seasons(uuid) from public, anon, authenticated;
grant execute on function public.krossi_season_staff_seasons(uuid) to authenticated, service_role;

-- Uusi kausi (season_id_input null) tai muutos. Pyhät rajataan kauden päiviin, kukin kerran.
create function public.krossi_season_save(
  season_id_input uuid,
  venue_id_input uuid,
  name_input text,
  starts_on_input date,
  ends_on_input date,
  skip_dates_input date[],
  discount_percent_input integer,
  requests_open_input boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_season public.booking_seasons;
  v_name text := btrim(coalesce(name_input, ''));
  v_skip date[];
  v_first date;
  v_last date;
begin
  if not public.krossi_booking_is_staff(venue_id_input) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  if season_id_input is not null then
    select * into v_season from public.booking_seasons where id = season_id_input and venue_id = venue_id_input for update;
    if not found then
      raise exception 'Kautta ei löytynyt.';
    end if;
  end if;
  if v_name = '' then
    raise exception 'Anna kaudelle nimi.';
  end if;
  if length(v_name) > 80 then
    raise exception 'Kauden nimi saa olla enintään 80 merkkiä.';
  end if;
  if starts_on_input is null or ends_on_input is null then
    raise exception 'Tarkista kauden päivät.';
  end if;
  if ends_on_input < starts_on_input then
    raise exception 'Kauden pitää päättyä alkamisen jälkeen.';
  end if;
  if ends_on_input - starts_on_input > 400 then
    raise exception 'Kausi voi olla enintään 400 päivää.';
  end if;
  if season_id_input is null and ends_on_input < public.krossi_booking_today(venue_id_input) then
    raise exception 'Kausi on jo päättynyt. Tarkista päivät.';
  end if;
  if season_id_input is not null then
    select b.first_day, b.last_day into v_first, v_last from public.krossi_season_booked_range(season_id_input) b;
    if v_first is not null and (starts_on_input > v_first or ends_on_input < v_last) then
      raise exception 'Kauden kausivuoroja pelataan %–%, joten kausi ei voi alkaa myöhemmin eikä päättyä aiemmin.',
        to_char(v_first, 'FMDD.FMMM.YYYY'), to_char(v_last, 'FMDD.FMMM.YYYY');
    end if;
  end if;
  if discount_percent_input is null or discount_percent_input not between 0 and 90 then
    raise exception 'Kausialennus on 0–90 %%.';
  end if;
  select coalesce(array_agg(distinct d order by d), '{}') into v_skip
  from unnest(coalesce(skip_dates_input, '{}'::date[])) d
  where d between starts_on_input and ends_on_input;
  if cardinality(v_skip) > 100 then
    raise exception 'Pyhiä voi olla enintään 100.';
  end if;

  if season_id_input is null then
    insert into public.booking_seasons (venue_id, name, starts_on, ends_on, skip_dates, discount_percent, requests_open)
    values (venue_id_input, v_name, starts_on_input, ends_on_input, v_skip, discount_percent_input, coalesce(requests_open_input, true))
    returning * into v_season;
  else
    update public.booking_seasons
       set name = v_name, starts_on = starts_on_input, ends_on = ends_on_input, skip_dates = v_skip,
           discount_percent = discount_percent_input, requests_open = coalesce(requests_open_input, true)
     where id = v_season.id
    returning * into v_season;
  end if;
  return public.krossi_season_staff_json(v_season);
end;
$function$;

revoke all on function public.krossi_season_save(uuid, uuid, text, date, date, date[], integer, boolean) from public, anon, authenticated;
grant execute on function public.krossi_season_save(uuid, uuid, text, date, date, date[], integer, boolean) to authenticated, service_role;

-- Poistaa kauden, jos mikään kausivuoro tai hakemus ei viittaa siihen (vahinkojen korjaamiseen).
create function public.krossi_season_remove(season_id_input uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_season public.booking_seasons;
begin
  select * into v_season from public.booking_seasons where id = season_id_input for update;
  if not found then
    raise exception 'Kautta ei löytynyt.';
  end if;
  if not public.krossi_booking_is_staff(v_season.venue_id) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  if exists (select 1 from public.booking_season_slots x where x.season_id = v_season.id) then
    raise exception 'Kaudella on kausivuoroja tai hakemuksia, joten sitä ei voi poistaa. Sulje haku, niin uusia ei tule.';
  end if;
  delete from public.booking_seasons where id = v_season.id;
end;
$function$;

revoke all on function public.krossi_season_remove(uuid) from public, anon, authenticated;
grant execute on function public.krossi_season_remove(uuid) to authenticated, service_role;


-- ── Sarjakortit ja lahjakortit ────────────────────────────────────────────────

-- StaffPassProduct: PassProduct + myynnissä, myydyt (maksetut) kortit ja voiko poistaa.
create function public.krossi_wallet_product_json(p public.booking_pass_products)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p.id,
    'venueId', p.venue_id,
    'name', p.name,
    'sport', p.sport,
    'uses', p.uses,
    'minutesPerUse', p.minutes_per_use,
    'validDays', p.valid_days,
    'priceCents', p.price_cents,
    'description', p.description,
    'active', p.is_active,
    'sold', (select count(*)::integer from public.booking_passes x where x.product_id = p.id and x.status = 'active'),
    'removable', not exists (select 1 from public.booking_passes x where x.product_id = p.id)
  );
$function$;

revoke all on function public.krossi_wallet_product_json(public.booking_pass_products) from public, anon, authenticated;

-- GiftSettings: hallin lahjakorttien summat (taulun oletukset, jos halli ei ole asettanut omiaan).
create function public.krossi_wallet_gift_json(venue_id_input uuid)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'amounts', to_jsonb(coalesce(s.gift_amounts, '{2500,5000,10000}'::integer[])),
    'minCents', coalesce(s.gift_min_cents, 1000),
    'maxCents', coalesce(s.gift_max_cents, 30000),
    'validDays', coalesce(s.gift_valid_days, 365)
  )
  from (select 1) one
  left join public.booking_billing_settings s on s.venue_id = venue_id_input;
$function$;

revoke all on function public.krossi_wallet_gift_json(uuid) from public, anon, authenticated;

-- { passes: StaffPassProduct[] (myynnissä ja piilotetut, kaupan järjestyksessä), gift: GiftSettings }
create function public.krossi_wallet_staff_products(venue_id_input uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.krossi_booking_is_staff(venue_id_input) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  return jsonb_build_object(
    'passes', coalesce((
      select jsonb_agg(public.krossi_wallet_product_json(p) order by p.sort, p.price_cents, p.id)
      from public.booking_pass_products p
      where p.venue_id = venue_id_input
    ), '[]'::jsonb),
    'gift', public.krossi_wallet_gift_json(venue_id_input)
  );
end;
$function$;

revoke all on function public.krossi_wallet_staff_products(uuid) from public, anon, authenticated;
grant execute on function public.krossi_wallet_staff_products(uuid) to authenticated, service_role;

-- Uusi sarjakortti (product_id_input null) tai muutos. Maksamattomat tilaukset saavat uuden
-- sisällön ja hinnan (tilaus maksetaan aina tuotteen nykyisellä hinnalla).
create function public.krossi_wallet_save_product(
  product_id_input uuid,
  venue_id_input uuid,
  name_input text,
  sport_input text,
  uses_input integer,
  minutes_per_use_input integer,
  valid_days_input integer,
  price_cents_input integer,
  description_input text,
  active_input boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product public.booking_pass_products;
  v_name text := btrim(coalesce(name_input, ''));
  v_description text := btrim(coalesce(description_input, ''));
begin
  if not public.krossi_booking_is_staff(venue_id_input) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  if product_id_input is not null then
    select * into v_product from public.booking_pass_products where id = product_id_input and venue_id = venue_id_input for update;
    if not found then
      raise exception 'Sarjakorttia ei löytynyt.';
    end if;
  end if;
  if v_name = '' then
    raise exception 'Anna sarjakortille nimi.';
  end if;
  if length(v_name) > 80 then
    raise exception 'Nimi saa olla enintään 80 merkkiä.';
  end if;
  if sport_input is null or sport_input not in ('tennis', 'padel', 'sulkapallo', 'squash') then
    raise exception 'Valitse laji.';
  end if;
  if not exists (
    select 1 from public.booking_courts c where c.venue_id = venue_id_input and c.sport = sport_input and c.is_active
  ) then
    raise exception 'Hallissa ei ole tämän lajin kenttiä.';
  end if;
  if uses_input is null or uses_input not between 1 and 200 then
    raise exception 'Kertoja on 1–200.';
  end if;
  if minutes_per_use_input is null or minutes_per_use_input not between 30 and 480 or minutes_per_use_input % 30 <> 0 then
    raise exception 'Kerran pituus on 30 min – 8 h puolen tunnin välein.';
  end if;
  if valid_days_input is null or valid_days_input not between 1 and 1825 then
    raise exception 'Voimassaolo on 1–1825 päivää.';
  end if;
  if price_cents_input is null or price_cents_input not between 50 and 1000000 then
    raise exception 'Hinta on 0,50–10 000 €.';
  end if;
  if length(v_description) > 300 then
    raise exception 'Kuvaus saa olla enintään 300 merkkiä.';
  end if;

  if product_id_input is null then
    insert into public.booking_pass_products (
      venue_id, name, sport, uses, minutes_per_use, valid_days, price_cents, description, is_active, sort
    ) values (
      venue_id_input, v_name, sport_input, uses_input, minutes_per_use_input, valid_days_input, price_cents_input,
      nullif(v_description, ''), coalesce(active_input, true),
      coalesce((select max(p.sort) + 1 from public.booking_pass_products p where p.venue_id = venue_id_input), 1)
    )
    returning * into v_product;
  else
    update public.booking_pass_products
       set name = v_name, sport = sport_input, uses = uses_input, minutes_per_use = minutes_per_use_input,
           valid_days = valid_days_input, price_cents = price_cents_input, description = nullif(v_description, ''),
           is_active = coalesce(active_input, true)
     where id = v_product.id
    returning * into v_product;
    update public.booking_passes
       set name = v_product.name, sport = v_product.sport, minutes_total = v_product.uses * v_product.minutes_per_use,
           minutes_left = v_product.uses * v_product.minutes_per_use, price_cents = v_product.price_cents
     where product_id = v_product.id and status = 'pending';
  end if;
  return public.krossi_wallet_product_json(v_product);
end;
$function$;

revoke all on function public.krossi_wallet_save_product(uuid, uuid, text, text, integer, integer, integer, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.krossi_wallet_save_product(uuid, uuid, text, text, integer, integer, integer, integer, text, boolean) to authenticated, service_role;

-- Poistaa sarjakortin, jota ei ole koskaan tilattu (muuten se piilotetaan myynnistä).
create function public.krossi_wallet_remove_product(product_id_input uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product public.booking_pass_products;
begin
  select * into v_product from public.booking_pass_products where id = product_id_input for update;
  if not found then
    raise exception 'Sarjakorttia ei löytynyt.';
  end if;
  if not public.krossi_booking_is_staff(v_product.venue_id) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  if exists (select 1 from public.booking_passes x where x.product_id = v_product.id) then
    raise exception 'Tätä sarjakorttia on jo tilattu, joten sitä ei voi poistaa. Piilota se myynnistä.';
  end if;
  delete from public.booking_pass_products where id = v_product.id;
end;
$function$;

revoke all on function public.krossi_wallet_remove_product(uuid) from public, anon, authenticated;
grant execute on function public.krossi_wallet_remove_product(uuid) to authenticated, service_role;

-- Lahjakorttien valmiit summat, oman summan rajat ja voimassaolo (täysiä euroja, kuten ostossa).
create function public.krossi_wallet_save_gift_settings(
  venue_id_input uuid,
  amounts_input integer[],
  min_cents_input integer,
  max_cents_input integer,
  valid_days_input integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_amounts integer[];
begin
  if not public.krossi_booking_is_staff(venue_id_input) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  if min_cents_input is null or min_cents_input % 100 <> 0 or min_cents_input not between 100 and 100000 then
    raise exception 'Pienin summa on 1–1000 € täysinä euroina.';
  end if;
  if max_cents_input is null or max_cents_input % 100 <> 0 or max_cents_input not between 100 and 100000 then
    raise exception 'Suurin summa on 1–1000 € täysinä euroina.';
  end if;
  if min_cents_input > max_cents_input then
    raise exception 'Pienin summa ei voi olla suurempi kuin suurin.';
  end if;
  select coalesce(array_agg(distinct a order by a), '{}') into v_amounts
  from unnest(coalesce(amounts_input, '{}'::integer[])) a;
  if cardinality(v_amounts) not between 1 and 6 then
    raise exception 'Valitse 1–6 valmista summaa.';
  end if;
  if exists (
    select 1 from unnest(v_amounts) a
    where a is null or a % 100 <> 0 or a not between min_cents_input and max_cents_input
  ) then
    raise exception 'Valmiiden summien pitää olla täysiä euroja välillä %–% €.', min_cents_input / 100, max_cents_input / 100;
  end if;
  if valid_days_input is null or valid_days_input not between 30 and 1825 then
    raise exception 'Voimassaolo on 30–1825 päivää.';
  end if;
  insert into public.booking_billing_settings (venue_id, gift_amounts, gift_min_cents, gift_max_cents, gift_valid_days, updated_at)
  values (venue_id_input, v_amounts, min_cents_input, max_cents_input, valid_days_input, now())
  on conflict (venue_id) do update
     set gift_amounts = excluded.gift_amounts, gift_min_cents = excluded.gift_min_cents,
         gift_max_cents = excluded.gift_max_cents, gift_valid_days = excluded.gift_valid_days, updated_at = now();
  return public.krossi_wallet_gift_json(venue_id_input);
end;
$function$;

revoke all on function public.krossi_wallet_save_gift_settings(uuid, integer[], integer, integer, integer) from public, anon, authenticated;
grant execute on function public.krossi_wallet_save_gift_settings(uuid, integer[], integer, integer, integer) to authenticated, service_role;


-- ── Laskutustiedot ───────────────────────────────────────────────────────────

-- Suurin hallin jo käyttämä laskun numero (0 = ei laskuja).
create function public.krossi_billing_last_number(venue_id_input uuid)
returns bigint
language sql
stable
set search_path = ''
as $function$
  select coalesce(max(i.number::bigint), 0)
  from public.booking_invoices i
  where i.venue_id = venue_id_input and i.number ~ '^[0-9]{1,9}$';
$function$;

revoke all on function public.krossi_billing_last_number(uuid) from public, anon, authenticated;

-- BillingSettings (taulun oletukset, jos hallilla ei ole vielä riviä).
create function public.krossi_billing_settings_json(venue_id_input uuid)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'venueId', venue_id_input,
    'sellerName', coalesce(s.seller_name, ''),
    'businessId', s.business_id,
    'address', s.address,
    'iban', s.iban,
    'bic', s.bic,
    'email', s.email,
    'phone', s.phone,
    'vatPercent', coalesce(s.vat_percent, 14.0),
    'paymentTermsDays', coalesce(s.payment_terms_days, 14),
    'nextInvoiceNumber', coalesce(s.next_invoice_number, 1001),
    'lastInvoiceNumber', public.krossi_billing_last_number(venue_id_input),
    'ready', coalesce(nullif(btrim(s.seller_name), '') is not null and s.iban is not null, false),
    'updatedAt', public.krossi_booking_iso(s.updated_at)
  )
  from (select 1) one
  left join public.booking_billing_settings s on s.venue_id = venue_id_input;
$function$;

revoke all on function public.krossi_billing_settings_json(uuid) from public, anon, authenticated;

create function public.krossi_billing_settings(venue_id_input uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.krossi_booking_is_staff(venue_id_input) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  return public.krossi_billing_settings_json(venue_id_input);
end;
$function$;

revoke all on function public.krossi_billing_settings(uuid) from public, anon, authenticated;
grant execute on function public.krossi_billing_settings(uuid) to authenticated, service_role;

-- Tallentaa laskutustiedot. Tyhjä kenttä tallentuu tyhjänä (laskuun tarvitaan vain nimi ja IBAN);
-- täytetyt tarkistetaan ja tallennetaan siistittyinä. next_invoice_number_input null = ennallaan.
create function public.krossi_billing_save_settings(
  venue_id_input uuid,
  seller_name_input text,
  business_id_input text,
  address_input text,
  iban_input text,
  bic_input text,
  email_input text,
  phone_input text,
  vat_percent_input numeric,
  payment_terms_days_input integer,
  next_invoice_number_input integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_name text := btrim(coalesce(seller_name_input, ''));
  v_address text := btrim(coalesce(address_input, ''));
  v_business_raw text := btrim(coalesce(business_id_input, ''));
  v_iban_raw text := btrim(coalesce(iban_input, ''));
  v_bic_raw text := btrim(coalesce(bic_input, ''));
  v_email text := btrim(coalesce(email_input, ''));
  v_phone text := btrim(coalesce(phone_input, ''));
  v_business text;
  v_iban text;
  v_bic text;
  v_last bigint;
begin
  if not public.krossi_booking_is_staff(venue_id_input) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  -- Laskun teko (krossi_season_activate) kasvattaa numeroa samalla rivillä: lukitaan se ensin.
  perform 1 from public.booking_billing_settings where venue_id = venue_id_input for update;

  if length(v_name) > 120 then
    raise exception 'Nimi saa olla enintään 120 merkkiä.';
  end if;
  if v_business_raw <> '' then
    v_business := public.krossi_business_id(v_business_raw);
    if v_business is null then
      raise exception 'Tarkista Y-tunnus (muoto 1234567-8).';
    end if;
  end if;
  if length(v_address) > 200 then
    raise exception 'Osoite saa olla enintään 200 merkkiä.';
  end if;
  if v_iban_raw <> '' then
    v_iban := public.krossi_iban(v_iban_raw);
    if v_iban is null then
      raise exception 'Tarkista tilinumero (IBAN).';
    end if;
  end if;
  if v_bic_raw <> '' then
    v_bic := upper(regexp_replace(v_bic_raw, '[[:space:]]', '', 'g'));
    if v_bic !~ '^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$' then
      raise exception 'Tarkista BIC-koodi.';
    end if;
    if left(v_iban, 2) = 'FI' and substr(v_bic, 5, 2) <> 'FI' then
      raise exception 'Suomalaisen tilinumeron BIC-koodissa on FI (esim. NDEAFIHH).';
    end if;
  end if;
  if v_email <> '' and (length(v_email) > 200 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Tarkista sähköpostiosoite.';
  end if;
  if v_phone <> '' and v_phone !~ '^[0-9+() -]{5,40}$' then
    raise exception 'Tarkista puhelinnumero.';
  end if;
  if vat_percent_input is null or vat_percent_input not between 0 and 50 or vat_percent_input <> round(vat_percent_input, 1) then
    raise exception 'ALV-prosentti on 0–50 (esim. 14 tai 25,5).';
  end if;
  if payment_terms_days_input is null or payment_terms_days_input not between 0 and 90 then
    raise exception 'Maksuaika on 0–90 päivää.';
  end if;
  if next_invoice_number_input is not null then
    if next_invoice_number_input not between 1 and 999999999 then
      raise exception 'Tarkista seuraavan laskun numero.';
    end if;
    v_last := public.krossi_billing_last_number(venue_id_input);
    if next_invoice_number_input <= v_last then
      raise exception 'Seuraavan laskun numeron pitää olla suurempi kuin viimeisimmän laskun (%).', v_last;
    end if;
  end if;

  insert into public.booking_billing_settings as cur (
    venue_id, seller_name, business_id, address, iban, bic, email, phone, vat_percent, payment_terms_days,
    next_invoice_number, updated_at
  ) values (
    venue_id_input, nullif(v_name, ''), v_business, nullif(v_address, ''), v_iban, v_bic, nullif(v_email, ''),
    nullif(v_phone, ''), vat_percent_input, payment_terms_days_input, coalesce(next_invoice_number_input, 1001), now()
  )
  on conflict (venue_id) do update
     set seller_name = excluded.seller_name, business_id = excluded.business_id, address = excluded.address,
         iban = excluded.iban, bic = excluded.bic, email = excluded.email, phone = excluded.phone,
         vat_percent = excluded.vat_percent, payment_terms_days = excluded.payment_terms_days,
         next_invoice_number = coalesce(next_invoice_number_input, cur.next_invoice_number),
         updated_at = now();
  return public.krossi_billing_settings_json(venue_id_input);
end;
$function$;

revoke all on function public.krossi_billing_save_settings(uuid, text, text, text, text, text, text, text, numeric, integer, integer) from public, anon, authenticated;
grant execute on function public.krossi_billing_save_settings(uuid, text, text, text, text, text, text, text, numeric, integer, integer) to authenticated, service_role;


-- ── Päätöksen sähköposti ─────────────────────────────────────────────────────

-- Vain service_role (krossi-billing 'seasonDecided'): varaa pelaajan sähköpostin hallin päätöksestä
-- hänen hakemukseensa — kerran ja enintään vuorokausi päätöksen jälkeen — ja palauttaa viestin
-- sisällön: SeasonSlot + { holderId, venueName, venueSlug, replyTo (hallin laskutussähköposti) }.
-- null = ei lähetettävää (hallin itse lisäämä vuoro, jo lähetetty, kesken tai liian vanha päätös).
create function public.krossi_season_decision_claim(slot_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_slot public.booking_season_slots;
begin
  update public.booking_season_slots
     set notified_at = now()
   where id = slot_id_input
     and holder_id is not null
     and status in ('active', 'declined')
     and notified_at is null
     and decided_at > now() - interval '1 day'
  returning * into v_slot;
  if not found then
    return null;
  end if;
  return public.krossi_season_slot_json(v_slot) || (
    select jsonb_build_object('holderId', v_slot.holder_id, 'venueName', v.name, 'venueSlug', v.slug, 'replyTo', s.email)
    from public.booking_venues v
    left join public.booking_billing_settings s on s.venue_id = v.id
    where v.id = v_slot.venue_id
  );
end;
$function$;

revoke all on function public.krossi_season_decision_claim(uuid) from public, anon, authenticated;
grant execute on function public.krossi_season_decision_claim(uuid) to service_role;

-- Vain service_role: posti ei lähtenyt, joten varaus puretaan (seuraava yritys saa lähettää).
create function public.krossi_season_decision_release(slot_id_input uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.booking_season_slots set notified_at = null where id = slot_id_input;
$function$;

revoke all on function public.krossi_season_decision_release(uuid) from public, anon, authenticated;
grant execute on function public.krossi_season_decision_release(uuid) to service_role;
