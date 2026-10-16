-- Krossi: kenttävarauksen vaihe 2 — kausivuorot, laskutus, sarjakortit ja lahjakortit.
--
-- Kausivuoro (season slot) = sama kenttä, viikonpäivä ja kellonaika joka viikko koko kauden,
-- pois lukien kauden pyhät ja viikot, joina kenttä oli jo varattu. Pelaaja hakee vakiovuoroa
-- sovelluksessa, hallin henkilökunta hyväksyy (tai lisää vuoron itse esim. seuralle). Hyväksytyn
-- vuoron viikot ovat oikeita booking_reservations-rivejä (kind 'season'), joten sama
-- exclusion-constraint estää päällekkäiset varaukset.
--
-- Kausihinta (sama sääntö kuin sovelluksen src/features/seasons.js:ssä): jokaisen kalenterikuukauden
-- viikkojen normaalihinnat (krossi_booking_price_internal) summataan, kauden alennus vähennetään ja
-- tulos pyöristetään senteiksi: round(summa * (100 - alennus) / 100). Kauden hinta = kuukausien summa.
--
-- Laskutus: kausivuoro maksetaan joko laskulla (booking_invoices: numero, viitenumero 7-3-1,
-- eräpäivä, rivit, hallin laskutustiedot talteen laskulle) tai kuukausittain pelaajan tallennetulta
-- kortilta (booking_season_charges; Stripe off-session -veloitukset tekee edge-funktio
-- krossi-billing). Epäonnistunut veloitus jää tilaan 'failed' viestin kanssa: pelaaja maksaa sen
-- sovelluksessa ja henkilökunta näkee sen laskutusnäkymässä.
--
-- Sarjakortit (booking_passes) ovat minuuttisaldoa (esim. 10 × 1 h = 600 min, voimassa 12 kk) ja
-- maksavat koko varauksen. Lahjakortit (booking_gift_cards) ovat koodeja; lunastettu arvo menee
-- pelaajan lahjakorttisaldoon hallissa ja voi maksaa varauksen kokonaan tai osittain (kortille jää
-- silloin vähintään 50 senttiä). Kaikki saldon muutokset ovat booking_credit_events-taulussa
-- (historia). Pidossa oleva varaus varaa lahjakorttiosuutensa (gift_cents), ja saldo vähennetään
-- vasta kun varaus maksetaan (krossi_booking_mark_paid) — vanhentunut pito vapauttaa osuuden itsestään.
--
-- Muutokset vaiheen 1 tauluihin ja funktioihin (20261016074110_krossi_court_booking.sql):
--   booking_reservations: kind + 'season', payment_status + 'credit', uudet sarakkeet
--     season_slot_id, pass_id, pass_minutes, gift_cents
--   create or replace: krossi_booking_json (+ credit), krossi_booking_day (oma kausivuoro = mine),
--     krossi_booking_staff_day (kausivuoron haltija, seasonSlotId, credit),
--     krossi_booking_mark_cancelled (palauttaa sarjakortin minuutit / lahjakorttisaldon)
--   drop + create: krossi_booking_mark_paid (uusi valinnainen amount_input: veloitettu summa;
--     erotus hinnasta otetaan lahjakorttisaldosta)
-- Koutsiin (sama tietokanta) ei kosketa.

-- ── Taulut ───────────────────────────────────────────────────────────────────

-- Hallin laskutustiedot (laskulle) ja lahjakorttien asetukset. Ilman nimeä ja tilinumeroa
-- laskua ei voi tehdä.
create table public.booking_billing_settings (
  venue_id uuid primary key references public.booking_venues(id) on delete cascade,
  seller_name text,
  business_id text,
  address text,
  iban text,
  bic text,
  email text,
  phone text,
  vat_percent numeric(4, 1) not null default 14.0,
  payment_terms_days integer not null default 14,
  next_invoice_number integer not null default 1001,
  gift_amounts integer[] not null default '{2500,5000,10000}',
  gift_min_cents integer not null default 1000,
  gift_max_cents integer not null default 30000,
  gift_valid_days integer not null default 365,
  updated_at timestamptz not null default now(),
  constraint booking_billing_settings_iban check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,30}$'),
  constraint booking_billing_settings_vat check (vat_percent between 0 and 50),
  constraint booking_billing_settings_terms check (payment_terms_days between 0 and 90),
  constraint booking_billing_settings_number check (next_invoice_number between 1 and 999999999),
  constraint booking_billing_settings_gift check (
    gift_min_cents >= 100 and gift_max_cents >= gift_min_cents and gift_max_cents <= 100000
    and gift_valid_days between 30 and 1825
  )
);

create table public.booking_seasons (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.booking_venues(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  -- pyhät, joina kausivuoroja ei pelata
  skip_dates date[] not null default '{}',
  -- kausihinta = normaalihinnat miinus tämä prosentti
  discount_percent integer not null default 0,
  requests_open boolean not null default true,
  created_at timestamptz not null default now(),
  constraint booking_seasons_name check (length(btrim(name)) between 1 and 80),
  constraint booking_seasons_dates check (starts_on <= ends_on and ends_on - starts_on <= 400),
  constraint booking_seasons_discount check (discount_percent between 0 and 90)
);

create index booking_seasons_venue_id_idx on public.booking_seasons (venue_id, starts_on);

-- status: 'requested' (pelaajan hakemus) → 'active' | 'declined' | 'withdrawn'; 'active' → 'ended'
create table public.booking_season_slots (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.booking_venues(id) on delete cascade,
  season_id uuid not null references public.booking_seasons(id) on delete cascade,
  sport text not null default 'tennis',
  -- null = hakemus mihin tahansa vapaaseen kenttään (henkilökunta valitsee)
  court_id uuid,
  location_id uuid,
  weekday integer not null,
  start_time time not null,
  minutes integer not null,
  starts_on date not null,
  skip_dates date[] not null default '{}',
  status text not null,
  billing text not null,
  price_cents integer not null default 0,
  weeks integer not null default 0,
  holder_id uuid references public.profiles(id) on delete set null,
  holder_name text not null,
  billing_email text,
  billing_address text,
  note text,
  decline_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  constraint booking_season_slots_sport check (sport in ('tennis', 'padel', 'sulkapallo', 'squash')),
  constraint booking_season_slots_court_fk foreign key (court_id, venue_id)
    references public.booking_courts (id, venue_id),
  constraint booking_season_slots_location_fk foreign key (location_id, venue_id)
    references public.booking_locations (id, venue_id),
  constraint booking_season_slots_weekday check (weekday between 1 and 7),
  constraint booking_season_slots_minutes check (minutes between 1 and 1440),
  constraint booking_season_slots_status check (status in ('requested', 'active', 'declined', 'withdrawn', 'ended')),
  constraint booking_season_slots_billing check (billing in ('invoice', 'card')),
  constraint booking_season_slots_price check (price_cents >= 0 and weeks >= 0),
  constraint booking_season_slots_holder check (length(btrim(holder_name)) between 1 and 80),
  constraint booking_season_slots_active_court check (status not in ('active', 'ended') or court_id is not null),
  constraint booking_season_slots_card_holder check (billing <> 'card' or holder_id is not null or status <> 'requested'),
  constraint booking_season_slots_texts check (
    (note is null or length(note) <= 500) and (decline_reason is null or length(decline_reason) <= 300)
    and (billing_email is null or length(billing_email) <= 200) and (billing_address is null or length(billing_address) <= 300)
  )
);

create index booking_season_slots_venue_idx on public.booking_season_slots (venue_id, status);
create index booking_season_slots_holder_idx on public.booking_season_slots (holder_id) where holder_id is not null;

create table public.booking_invoices (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.booking_venues(id),
  season_slot_id uuid not null references public.booking_season_slots(id),
  number text not null,
  reference text not null,
  issued_on date not null,
  due_on date not null,
  amount_cents integer not null,
  vat_percent numeric(4, 1) not null,
  -- [{ text, quantity, unit, unitCents, totalCents }]
  lines jsonb not null,
  -- { name, email, address }
  recipient jsonb not null,
  -- hallin laskutustiedot laskun tekohetkellä: { name, businessId, address, iban, bic, email, phone }
  seller jsonb not null,
  status text not null default 'open',
  paid_on date,
  sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint booking_invoices_number_key unique (venue_id, number),
  constraint booking_invoices_status check (status in ('open', 'paid', 'void')),
  constraint booking_invoices_amount check (amount_cents >= 0),
  constraint booking_invoices_dates check (due_on >= issued_on),
  constraint booking_invoices_paid check ((status = 'paid') = (paid_on is not null))
);

create index booking_invoices_slot_idx on public.booking_invoices (season_slot_id);
create index booking_invoices_venue_idx on public.booking_invoices (venue_id, created_at desc);

create table public.booking_season_charges (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.booking_venues(id),
  season_slot_id uuid not null references public.booking_season_slots(id) on delete cascade,
  month text not null,
  weeks integer not null,
  amount_cents integer not null,
  due_on date not null,
  status text not null default 'scheduled',
  attempts integer not null default 0,
  failure_message text,
  stripe_payment_intent_id text unique,
  last_attempt_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint booking_season_charges_month_key unique (season_slot_id, month),
  constraint booking_season_charges_month check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint booking_season_charges_status check (status in ('scheduled', 'processing', 'paid', 'failed', 'void')),
  constraint booking_season_charges_amount check (amount_cents >= 0 and weeks >= 0),
  constraint booking_season_charges_paid check ((status = 'paid') = (paid_at is not null))
);

create index booking_season_charges_due_idx on public.booking_season_charges (venue_id, due_on)
  where status in ('scheduled', 'processing', 'failed');

-- Kortti, jolta kausivuorojen kuukausimaksut veloitetaan (Stripe PaymentMethod, off-session).
create table public.booking_saved_cards (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_payment_method_id text not null,
  brand text not null,
  last4 text not null,
  exp_month integer,
  exp_year integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_saved_cards_pm check (stripe_payment_method_id ~ '^pm_[A-Za-z0-9]+$'),
  constraint booking_saved_cards_last4 check (last4 ~ '^[0-9]{4}$')
);

create table public.booking_pass_products (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.booking_venues(id) on delete cascade,
  name text not null,
  sport text not null default 'tennis',
  uses integer not null,
  minutes_per_use integer not null,
  valid_days integer not null default 365,
  price_cents integer not null,
  description text,
  is_active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  constraint booking_pass_products_sport check (sport in ('tennis', 'padel', 'sulkapallo', 'squash')),
  constraint booking_pass_products_name check (length(btrim(name)) between 1 and 80),
  constraint booking_pass_products_uses check (uses between 1 and 200 and minutes_per_use between 30 and 480 and minutes_per_use % 30 = 0),
  constraint booking_pass_products_valid check (valid_days between 1 and 1825),
  constraint booking_pass_products_price check (price_cents >= 50)
);

-- status: 'pending' (tilattu, ei maksettu) → 'active' (maksettu); 'void' = mitätöity
create table public.booking_passes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.booking_venues(id),
  product_id uuid not null references public.booking_pass_products(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  sport text not null,
  minutes_total integer not null,
  minutes_left integer not null,
  valid_until date,
  status text not null default 'pending',
  price_cents integer not null,
  stripe_payment_intent_id text unique,
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  constraint booking_passes_status check (status in ('pending', 'active', 'void')),
  constraint booking_passes_minutes check (minutes_left >= 0 and minutes_left <= minutes_total),
  constraint booking_passes_active check (status <> 'active' or (valid_until is not null and purchased_at is not null))
);

create index booking_passes_user_idx on public.booking_passes (user_id, venue_id);

-- status: 'pending' (ei maksettu, ei koodia) → 'active' (koodi annettu) → 'redeemed'; 'void'
create table public.booking_gift_cards (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.booking_venues(id),
  code text unique,
  amount_cents integer not null,
  buyer_id uuid references public.profiles(id) on delete set null,
  recipient_name text,
  message text,
  status text not null default 'pending',
  valid_until date,
  stripe_payment_intent_id text unique,
  paid_at timestamptz,
  redeemed_by uuid references public.profiles(id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint booking_gift_cards_status check (status in ('pending', 'active', 'redeemed', 'void')),
  constraint booking_gift_cards_amount check (amount_cents > 0),
  constraint booking_gift_cards_code check (code is null or code ~ '^KRSI-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  constraint booking_gift_cards_issued check (status = 'pending' or (code is not null and valid_until is not null)),
  constraint booking_gift_cards_texts check (
    (recipient_name is null or length(recipient_name) <= 60) and (message is null or length(message) <= 300)
  )
);

create index booking_gift_cards_buyer_idx on public.booking_gift_cards (buyer_id, venue_id);

-- Sarjakorttien ja lahjakorttisaldon historia. Lahjakorttisaldo = rivien (pass_id is null) cents-summa.
create table public.booking_credit_events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.booking_venues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  pass_id uuid references public.booking_passes(id) on delete cascade,
  gift_card_id uuid references public.booking_gift_cards(id) on delete set null,
  booking_id uuid references public.booking_reservations(id) on delete set null,
  minutes integer not null default 0,
  cents integer not null default 0,
  label text not null,
  created_at timestamptz not null default now(),
  constraint booking_credit_events_kind check (kind in ('purchase', 'use', 'refund', 'redeem', 'adjust')),
  constraint booking_credit_events_target check ((pass_id is null) = (minutes = 0))
);

create index booking_credit_events_user_idx on public.booking_credit_events (user_id, venue_id, created_at desc);
create index booking_credit_events_pass_idx on public.booking_credit_events (pass_id) where pass_id is not null;

-- Lahjakorttikoodien arvaamisen jarru: epäonnistuneet lunastusyritykset.
create table public.booking_gift_redeem_attempts (
  id bigserial primary key,
  user_id uuid not null,
  attempted_at timestamptz not null default now()
);

create index booking_gift_redeem_attempts_user_idx on public.booking_gift_redeem_attempts (user_id, attempted_at desc);

-- ── Muutokset varauksiin ─────────────────────────────────────────────────────

alter table public.booking_reservations
  drop constraint booking_reservations_kind,
  add constraint booking_reservations_kind check (kind in ('booking', 'block', 'league', 'season')),
  drop constraint booking_reservations_payment_status,
  add constraint booking_reservations_payment_status
    check (payment_status in ('unpaid', 'paid', 'refunded', 'free', 'credit', 'none')),
  add column season_slot_id uuid references public.booking_season_slots(id) on delete cascade,
  add column pass_id uuid references public.booking_passes(id),
  add column pass_minutes integer not null default 0,
  add column gift_cents integer not null default 0,
  add constraint booking_reservations_season check ((kind = 'season') = (season_slot_id is not null)),
  add constraint booking_reservations_gift check (gift_cents >= 0 and gift_cents <= price_cents),
  add constraint booking_reservations_pass check ((pass_id is null) = (pass_minutes = 0));

create index booking_reservations_season_slot_idx on public.booking_reservations (season_slot_id, starts_at)
  where season_slot_id is not null;

alter table public.booking_billing_settings enable row level security;
alter table public.booking_seasons enable row level security;
alter table public.booking_season_slots enable row level security;
alter table public.booking_invoices enable row level security;
alter table public.booking_season_charges enable row level security;
alter table public.booking_saved_cards enable row level security;
alter table public.booking_pass_products enable row level security;
alter table public.booking_passes enable row level security;
alter table public.booking_gift_cards enable row level security;
alter table public.booking_credit_events enable row level security;
alter table public.booking_gift_redeem_attempts enable row level security;

-- Ei suoraa pääsyä asiakkaille: kaikki kulkee alla olevien funktioiden kautta.
revoke all on table public.booking_billing_settings, public.booking_seasons, public.booking_season_slots,
  public.booking_invoices, public.booking_season_charges, public.booking_saved_cards, public.booking_pass_products,
  public.booking_passes, public.booking_gift_cards, public.booking_credit_events, public.booking_gift_redeem_attempts
  from anon, authenticated;
grant all on table public.booking_billing_settings, public.booking_seasons, public.booking_season_slots,
  public.booking_invoices, public.booking_season_charges, public.booking_saved_cards, public.booking_pass_products,
  public.booking_passes, public.booking_gift_cards, public.booking_credit_events, public.booking_gift_redeem_attempts
  to service_role;
grant usage, select on sequence public.booking_gift_redeem_attempts_id_seq to service_role;


-- ── Apufunktiot ──────────────────────────────────────────────────────────────

-- 'YYYY-MM-DD'
create function public.krossi_booking_date(d date)
returns text
language sql
immutable
set search_path = ''
as $function$
  select to_char($1, 'YYYY-MM-DD');
$function$;

revoke all on function public.krossi_booking_date(date) from public, anon, authenticated;

-- Hallin paikallinen päivä nyt.
create function public.krossi_booking_today(venue_id_input uuid)
returns date
language sql
stable
set search_path = ''
as $function$
  select (now() at time zone coalesce((select v.timezone from public.booking_venues v where v.id = venue_id_input), 'Europe/Helsinki'))::date;
$function$;

revoke all on function public.krossi_booking_today(uuid) from public, anon, authenticated;

-- Suomalainen viitenumero: perusosa + tarkiste (painot 7, 3, 1 oikealta).
create function public.krossi_reference_number(base text)
returns text
language sql
immutable
set search_path = ''
as $function$
  with digits as (
    select substr(reverse(regexp_replace($1, '[^0-9]', '', 'g')), i, 1)::integer as d, i
    from generate_series(1, length(regexp_replace($1, '[^0-9]', '', 'g'))) as i
  )
  select regexp_replace($1, '[^0-9]', '', 'g')
    || ((10 - (coalesce(sum(d * (array[7, 3, 1])[((i - 1) % 3) + 1]), 0) % 10)) % 10)::text
  from digits;
$function$;

revoke all on function public.krossi_reference_number(text) from public, anon, authenticated;

-- 'KRSI-7F3K-9QPA': kahdeksan merkkiä aakkostosta ilman 0/O ja 1/I (luettavissa ääneen tiskillä).
-- Satunnaisuus gen_random_uuid():stä (versio 4): tavut 0–5 ja 9–10 ovat kokonaan satunnaisia.
create function public.krossi_gift_code()
returns text
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_body text := '';
  v_i integer;
begin
  foreach v_i in array array[0, 1, 2, 3, 4, 5, 9, 10] loop
    v_body := v_body || substr(v_alphabet, (get_byte(v_bytes, v_i) % 32) + 1, 1);
  end loop;
  return 'KRSI-' || substr(v_body, 1, 4) || '-' || substr(v_body, 5, 4);
end;
$function$;

revoke all on function public.krossi_gift_code() from public, anon, authenticated;

-- Varauksen nimike historiaan: 'Tennis 2 · Janus-Areena · ti 6.10. klo 19.00' (hallin ajassa).
create function public.krossi_booking_label(r public.booking_reservations)
returns text
language sql
stable
set search_path = ''
as $function$
  select c.name || ' · ' || l.name || ' · '
    || (array['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'])[extract(isodow from r.starts_at at time zone v.timezone)::integer]
    || ' ' || to_char(r.starts_at at time zone v.timezone, 'FMDD.FMMM.')
    || ' klo ' || to_char(r.starts_at at time zone v.timezone, 'FMHH24.MI')
  from public.booking_courts c
  join public.booking_locations l on l.id = c.location_id
  join public.booking_venues v on v.id = c.venue_id
  where c.id = r.court_id;
$function$;

revoke all on function public.krossi_booking_label(public.booking_reservations) from public, anon, authenticated;

-- PersonLite-pohja (kuten krossi_booking_staff_day): sovelluksen map.js tekee avatar-polusta URL:n.
create function public.krossi_booking_person_json(user_id_input uuid)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p.id,
    'name', coalesce(nullif(btrim(p.name), ''), 'Pelaaja'),
    'avatarUrl', p.avatar_url,
    'avatarColor', coalesce(p.avatar_color, 'blue'),
    'ageRange', p.age,
    'skillLevel', (select coalesce(t.skill_level, '') from public.tennis_preferences t where t.user_id = p.id limit 1)
  )
  from public.profiles p
  where p.id = user_id_input;
$function$;

revoke all on function public.krossi_booking_person_json(uuid) from public, anon, authenticated;

-- Lahjakorttisaldo, jonka pelaaja voi käyttää nyt: tapahtumien summa miinus muiden voimassa
-- olevien pitojen varaama osuus.
create function public.krossi_wallet_gift_available(user_id_input uuid, venue_id_input uuid, except_booking_input uuid)
returns integer
language sql
stable
set search_path = ''
as $function$
  select (
    coalesce((
      select sum(e.cents) from public.booking_credit_events e
      where e.user_id = user_id_input and e.venue_id = venue_id_input and e.pass_id is null
    ), 0)
    - coalesce((
      select sum(r.gift_cents) from public.booking_reservations r
      where r.booked_by = user_id_input
        and r.venue_id = venue_id_input
        and r.kind = 'booking'
        and r.status = 'held'
        and r.hold_expires_at > now()
        and r.payment_status = 'unpaid'
        and r.gift_cents > 0
        and r.id is distinct from except_booking_input
    ), 0)
  )::integer;
$function$;

revoke all on function public.krossi_wallet_gift_available(uuid, uuid, uuid) from public, anon, authenticated;

-- BookingCredit tai null.
create function public.krossi_booking_credit_json(r public.booking_reservations)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case
    when r.pass_id is not null then jsonb_build_object(
      'kind', 'pass', 'cents', r.price_cents, 'minutes', r.pass_minutes,
      'name', (select p.name from public.booking_passes p where p.id = r.pass_id))
    when r.gift_cents > 0 then jsonb_build_object('kind', 'gift', 'cents', r.gift_cents, 'minutes', 0, 'name', null)
  end;
$function$;

revoke all on function public.krossi_booking_credit_json(public.booking_reservations) from public, anon, authenticated;


-- ── Vaiheen 1 funktiot: kausivuorot ja krediitti mukaan ──────────────────────

-- Booking + credit.
create or replace function public.krossi_booking_json(r public.booking_reservations)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', r.id,
    'venueId', r.venue_id,
    'venueName', v.name,
    'locationName', l.name,
    'mapKey', l.map_key,
    'courtId', r.court_id,
    'courtName', c.name,
    'courtMapId', c.map_id,
    'sport', c.sport,
    'startsAt', public.krossi_booking_iso(r.starts_at),
    'endsAt', public.krossi_booking_iso(r.ends_at),
    'status', case when r.status = 'held' and r.hold_expires_at <= now() then 'expired' else r.status end,
    'priceCents', r.price_cents,
    'paymentStatus', r.payment_status,
    'holdExpiresAt', case when r.status = 'held' then public.krossi_booking_iso(r.hold_expires_at) end,
    'cancellableUntil', public.krossi_booking_iso(r.starts_at - make_interval(hours => v.cancel_limit_hours)),
    'cancelledAt', public.krossi_booking_iso(r.cancelled_at),
    'createdAt', public.krossi_booking_iso(r.created_at),
    'credit', public.krossi_booking_credit_json(r)
  )
  from public.booking_courts c
  join public.booking_locations l on l.id = c.location_id
  join public.booking_venues v on v.id = c.venue_id
  where c.id = r.court_id;
$function$;

-- { date, busy } — pelaajan oma kausivuoro on 'mine' kuten oma varaus.
create or replace function public.krossi_booking_day(venue_id_input uuid, day_input date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_venue public.booking_venues;
  v_from timestamptz;
  v_to timestamptz;
begin
  select * into v_venue from public.booking_venues where id = venue_id_input;
  if not found or not (v_venue.is_public or public.krossi_booking_is_staff(v_venue.id)) then
    raise exception 'Hallia ei löytynyt.';
  end if;
  if day_input is null then
    raise exception 'Valitse päivä.';
  end if;

  v_from := day_input::timestamp at time zone v_venue.timezone;
  v_to := (day_input + 1)::timestamp at time zone v_venue.timezone;

  return jsonb_build_object(
    'date', to_char(day_input, 'YYYY-MM-DD'),
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'courtId', r.court_id,
        'startsAt', public.krossi_booking_iso(r.starts_at),
        'endsAt', public.krossi_booking_iso(r.ends_at),
        'kind', r.kind,
        'mine', coalesce(r.kind in ('booking', 'season') and r.booked_by = v_uid, false),
        'title', case when r.kind = 'booking' then null else r.title end
      ) order by r.starts_at, r.court_id, r.id)
      from public.booking_reservations r
      where r.venue_id = v_venue.id
        and r.status in ('held', 'confirmed')
        and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(v_from, v_to, '[)')
        and (r.status = 'confirmed' or r.hold_expires_at > now())
    ), '[]'::jsonb)
  );
end;
$function$;

-- StaffItem[]: kausivuoron rivillä otsikkona haltijan nimi ja bookedBy, jos haltija on Krossin pelaaja.
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
      'bookedBy', case when r.kind in ('booking', 'season') and r.booked_by is not null then jsonb_build_object(
        'id', r.booked_by,
        'name', coalesce(nullif(btrim(p.name), ''), 'Pelaaja'),
        'avatarUrl', p.avatar_url,
        'avatarColor', coalesce(p.avatar_color, 'blue'),
        'ageRange', p.age,
        -- '' = pelaajalla on tennis_preferences-rivi ilman tasoa; null = ei riviä
        'skillLevel', tp.skill_level
      ) end,
      'priceCents', r.price_cents,
      'paymentStatus', r.payment_status,
      'seasonSlotId', r.season_slot_id,
      'credit', public.krossi_booking_credit_json(r)
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

-- Stripe sanoo maksun onnistuneen (ks. vaihe 1). Uutta: amount_input = maksun summa sentteinä.
-- Hinnan ja maksetun summan erotus otetaan pelaajan lahjakorttisaldosta silloin, kun varaus
-- vahvistuu; jos saldo ei enää riitä (pito ehti vanhentua ja saldo käytettiin muualla), tulos on
-- 'lost' ja maksu palautetaan. Ilman summaa (vaiheen 1 edge-funktiot, jotka veloittavat aina koko
-- hinnan) saldoa ei käytetä. Jo maksettu varaus (myös sarjakortilla tai lahjakortilla, 'credit')
-- → 'duplicate'.
drop function public.krossi_booking_mark_paid(uuid, text);

create function public.krossi_booking_mark_paid(
  booking_id_input uuid,
  payment_intent_id_input text,
  amount_input integer default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
  v_intent text := nullif(btrim(coalesce(payment_intent_id_input, '')), '');
  v_gift integer;
  v_confirm boolean := false;
begin
  if v_intent is null then
    raise exception 'Maksun tunniste puuttuu.';
  end if;
  select * into v_row from public.booking_reservations where id = booking_id_input for update;
  if not found or v_row.kind <> 'booking' then
    raise exception 'Varausta ei löytynyt.';
  end if;

  if v_row.payment_status <> 'unpaid' then
    if v_row.payment_status in ('free', 'credit') or v_row.stripe_payment_intent_id is distinct from v_intent then
      return 'duplicate';
    end if;
    return case when v_row.status = 'confirmed' then 'confirmed' else 'cancelled' end;
  end if;

  -- Lahjakorttiosuus: hinta miinus kortilla maksettu summa (yli maksettu tai summa puuttuu = ei saldoa).
  v_gift := case
    when amount_input is null then 0
    else greatest(0, v_row.price_cents - amount_input)
  end;

  if v_row.status in ('held', 'confirmed') then
    v_confirm := true;
  elsif v_row.starts_at > now()
     and (v_row.status = 'expired'
          or (v_row.status = 'cancelled' and v_row.cancelled_by is not null and v_row.cancelled_by = v_row.booked_by)) then
    -- Pito vanheni tai pelaaja vapautti sen ennen kuin maksu ehti perille: otetaan kenttä
    -- takaisin, jos se on yhä vapaa eikä aika ole alkanut.
    update public.booking_reservations r
       set status = 'expired'
     where r.court_id = v_row.court_id
       and r.status = 'held'
       and r.hold_expires_at <= now()
       and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(v_row.starts_at, v_row.ends_at, '[)');
    begin
      update public.booking_reservations
         set status = 'confirmed', cancelled_at = null, cancelled_by = null
       where id = v_row.id;
      v_confirm := true;
    exception when exclusion_violation then
      null; -- joku muu ehti varata kentän
    end;
  end if;

  if v_confirm and v_gift > 0 then
    perform pg_advisory_xact_lock(hashtextextended('krossi_wallet:' || v_row.booked_by::text, 0));
    if public.krossi_wallet_gift_available(v_row.booked_by, v_row.venue_id, v_row.id) < v_gift then
      v_confirm := false;
    end if;
  end if;

  if v_confirm then
    update public.booking_reservations
       set status = 'confirmed', payment_status = 'paid', stripe_payment_intent_id = v_intent,
           hold_expires_at = null, gift_cents = v_gift
     where id = v_row.id
    returning * into v_row;
    if v_gift > 0 then
      insert into public.booking_credit_events (venue_id, user_id, kind, booking_id, cents, label)
      values (v_row.venue_id, v_row.booked_by, 'use', v_row.id, -v_gift, public.krossi_booking_label(v_row));
    end if;
    return 'confirmed';
  end if;

  update public.booking_reservations
     set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), stripe_payment_intent_id = v_intent
   where id = v_row.id;
  return 'lost';
end;
$function$;

revoke all on function public.krossi_booking_mark_paid(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.krossi_booking_mark_paid(uuid, text, integer) to service_role;

-- Kirjaa peruutuksen (ks. vaihe 1). refunded_input = pelaaja saa rahansa / krediittinsä takaisin:
-- maksettu tai krediitillä maksettu varaus palauttaa sarjakortin minuutit tai lahjakorttiosuuden
-- saldoon (kerran — vain kun tila muuttuu 'refunded':ksi). Stripe-osuuden palauttaa kutsuja.
create or replace function public.krossi_booking_mark_cancelled(
  booking_id_input uuid,
  refunded_input boolean,
  refund_id_input text,
  by_input uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
  v_give_back boolean;
begin
  select * into v_row from public.booking_reservations where id = booking_id_input and kind = 'booking' for update;
  if not found then
    raise exception 'Varausta ei löytynyt.';
  end if;
  v_give_back := coalesce(refunded_input, false) and v_row.payment_status in ('paid', 'credit');

  update public.booking_reservations
     set status = 'cancelled',
         cancelled_at = coalesce(cancelled_at, now()),
         cancelled_by = coalesce(cancelled_by, by_input),
         payment_status = case
           when coalesce(refunded_input, false) and payment_status in ('paid', 'unpaid', 'credit') then 'refunded'
           else payment_status
         end,
         stripe_refund_id = coalesce(nullif(btrim(coalesce(refund_id_input, '')), ''), stripe_refund_id)
   where id = v_row.id;

  if v_give_back and v_row.pass_id is not null and v_row.pass_minutes > 0 then
    update public.booking_passes set minutes_left = least(minutes_total, minutes_left + v_row.pass_minutes)
     where id = v_row.pass_id;
    insert into public.booking_credit_events (venue_id, user_id, kind, pass_id, booking_id, minutes, label)
    values (v_row.venue_id, v_row.booked_by, 'refund', v_row.pass_id, v_row.id, v_row.pass_minutes,
            'Peruttu: ' || public.krossi_booking_label(v_row));
  elsif v_give_back and v_row.gift_cents > 0 and v_row.booked_by is not null then
    insert into public.booking_credit_events (venue_id, user_id, kind, booking_id, cents, label)
    values (v_row.venue_id, v_row.booked_by, 'refund', v_row.id, v_row.gift_cents,
            'Peruttu: ' || public.krossi_booking_label(v_row));
  end if;
end;
$function$;


-- ── Kausivuorot ──────────────────────────────────────────────────────────────

-- Season
create function public.krossi_season_json(s public.booking_seasons)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', s.id,
    'venueId', s.venue_id,
    'name', s.name,
    'startsOn', public.krossi_booking_date(s.starts_on),
    'endsOn', public.krossi_booking_date(s.ends_on),
    'skipDates', coalesce((select jsonb_agg(public.krossi_booking_date(d) order by d) from unnest(s.skip_dates) d), '[]'::jsonb),
    'discountPercent', s.discount_percent,
    'requestsOpen', s.requests_open
  );
$function$;

revoke all on function public.krossi_season_json(public.booking_seasons) from public, anon, authenticated;

-- CardCharge
create function public.krossi_billing_charge_json(c public.booking_season_charges)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', c.id,
    'seasonSlotId', c.season_slot_id,
    'month', c.month,
    'weeks', c.weeks,
    'amountCents', c.amount_cents,
    'dueOn', public.krossi_booking_date(c.due_on),
    'status', c.status,
    'attempts', c.attempts,
    'failureMessage', c.failure_message,
    'paidAt', public.krossi_booking_iso(c.paid_at),
    'holderName', coalesce((select s.holder_name from public.booking_season_slots s where s.id = c.season_slot_id), '')
  );
$function$;

revoke all on function public.krossi_billing_charge_json(public.booking_season_charges) from public, anon, authenticated;

-- SeasonSlot
create function public.krossi_season_slot_json(s public.booking_season_slots)
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
    'decidedAt', public.krossi_booking_iso(s.decided_at)
  )
  from public.booking_seasons se
  left join public.booking_courts c on c.id = s.court_id
  left join public.booking_locations l on l.id = coalesce(c.location_id, s.location_id)
  where se.id = s.season_id;
$function$;

revoke all on function public.krossi_season_slot_json(public.booking_season_slots) from public, anon, authenticated;

-- Viikonpäivä, aloitusaika ('HH:MM' hallin ruudukossa ja aukioloajassa) ja kesto (hallin kestoista).
create function public.krossi_season_check_time(v public.booking_venues, weekday_input integer, start_time_input text, minutes_input integer)
returns time
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_start integer;
begin
  if weekday_input is null or weekday_input not between 1 and 7 then
    raise exception 'Valitse viikonpäivä.';
  end if;
  if start_time_input is null or start_time_input !~ '^[0-2][0-9]:[0-5][0-9]$' then
    raise exception 'Valitse aloitusaika.';
  end if;
  if minutes_input is null or not (minutes_input = any (v.durations)) then
    raise exception 'Valitse vuoron kesto.';
  end if;
  v_start := substr(start_time_input, 1, 2)::integer * 60 + substr(start_time_input, 4, 2)::integer;
  if v_start % v.slot_minutes <> 0 or v_start >= 1440 then
    raise exception 'Valitse aloitusaika.';
  end if;
  if v_start < (extract(epoch from v.open_from) / 60)::integer
     or v_start + minutes_input > (extract(epoch from v.open_until) / 60)::integer then
    raise exception 'Halli on suljettu tähän aikaan.';
  end if;
  return start_time_input::time;
end;
$function$;

revoke all on function public.krossi_season_check_time(public.booking_venues, integer, text, integer) from public, anon, authenticated;

-- Ensimmäinen voimassa oleva varaus, pito tai esto kentällä aikana [alku, loppu): { kind, title } tai null.
create function public.krossi_season_week_conflict(court_id_input uuid, starts_at_input timestamptz, ends_at_input timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object('kind', r.kind, 'title', case when r.kind = 'booking' then null else r.title end)
  from public.booking_reservations r
  where r.court_id = court_id_input
    and r.status in ('held', 'confirmed')
    and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(starts_at_input, ends_at_input, '[)')
    and (r.status = 'confirmed' or r.hold_expires_at > now())
  order by r.starts_at, r.id
  limit 1;
$function$;

revoke all on function public.krossi_season_week_conflict(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Sisäinen: SeasonQuote (api/contract.js). Kauden viikot viikonpäivälle from_date_input:sta alkaen
-- (kauden alusta aikaisintaan), pyhät pois; vain viikot, jotka eivät ole alkaneet. court_id_input
-- = tämä kenttä; muuten se lajin kenttä (toimipaikasta, jos annettu), jolla on vähiten esteitä
-- (hallin järjestyksessä ensimmäinen tasatilanteessa). courts = lajin kentät esteineen kysytyn
-- kentän toimipaikasta, annetusta toimipaikasta tai koko hallista. Ei näkyvyystarkistusta.
create function public.krossi_season_quote_internal(
  season_id_input uuid,
  court_id_input uuid,
  location_id_input uuid,
  sport_input text,
  weekday_input integer,
  start_time_input time,
  minutes_input integer,
  from_date_input date
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_season public.booking_seasons;
  v_tz text;
  v_from date;
  v_first date;
  v_sport text := coalesce(sport_input, 'tennis');
  v_dates date[];
  v_skipped date[];
  v_courts jsonb;
  v_court uuid := court_id_input;
  v_location uuid := location_id_input;
  v_weeks jsonb;
  v_months jsonb;
  v_full integer;
  v_cents integer;
  v_count integer;
begin
  select * into v_season from public.booking_seasons where id = season_id_input;
  select v.timezone into v_tz from public.booking_venues v where v.id = v_season.venue_id;
  if court_id_input is not null then
    select c.sport, c.location_id into v_sport, v_location from public.booking_courts c where c.id = court_id_input;
  end if;
  v_from := greatest(v_season.starts_on, coalesce(from_date_input, v_season.starts_on));
  v_first := v_from + ((weekday_input - extract(isodow from v_from)::integer + 7) % 7);

  select coalesce(array_agg(x.d order by x.d) filter (where not (x.d = any (v_season.skip_dates))), '{}'),
         coalesce(array_agg(x.d order by x.d) filter (where x.d = any (v_season.skip_dates)), '{}')
    into v_dates, v_skipped
  from (
    select g::date as d
    from generate_series(v_first::timestamp, v_season.ends_on::timestamp, interval '7 days') g
  ) x
  where ((x.d + start_time_input) at time zone v_tz) > now();

  -- Kentät esteineen
  select coalesce(jsonb_agg(jsonb_build_object('courtId', c.id, 'conflicts', (
      select count(*)::integer
      from unnest(v_dates) d
      cross join lateral (select (d + start_time_input) at time zone v_tz as s) w
      where public.krossi_booking_price_internal(c.id, w.s, minutes_input) is null
         or public.krossi_season_week_conflict(c.id, w.s, w.s + make_interval(mins => minutes_input)) is not null
    )) order by l.sort, l.name, l.id, c.sort, c.name, c.id), '[]'::jsonb)
    into v_courts
  from public.booking_courts c
  join public.booking_locations l on l.id = c.location_id
  where c.is_active
    and c.venue_id = v_season.venue_id
    and c.sport = v_sport
    and (v_location is null or c.location_id = v_location);

  if v_court is null then
    select (e.value ->> 'courtId')::uuid into v_court
    from jsonb_array_elements(v_courts) with ordinality as e(value, i)
    order by (e.value ->> 'conflicts')::integer, e.i
    limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'date', public.krossi_booking_date(w.d),
      'startsAt', public.krossi_booking_iso(w.s),
      'endsAt', public.krossi_booking_iso(w.s + make_interval(mins => minutes_input)),
      'cents', w.cents,
      'conflict', coalesce(w.busy, case when w.cents is null then jsonb_build_object('kind', 'closed', 'title', null) end)
    ) order by w.d), '[]'::jsonb)
    into v_weeks
  from (
    select d, s,
      public.krossi_booking_price_internal(v_court, s, minutes_input) as cents,
      public.krossi_season_week_conflict(v_court, s, s + make_interval(mins => minutes_input)) as busy
    from unnest(v_dates) d
    cross join lateral (select (d + start_time_input) at time zone v_tz as s) t
    where v_court is not null
  ) w;

  select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'count', m.n, 'cents', m.cents) order by m.month), '[]'::jsonb),
         coalesce(sum(m.full_cents), 0)::integer,
         coalesce(sum(m.cents), 0)::integer,
         coalesce(sum(m.n), 0)::integer
    into v_months, v_full, v_cents, v_count
  from (
    select substr(w.value ->> 'date', 1, 7) as month,
           count(*)::integer as n,
           sum((w.value ->> 'cents')::integer) as full_cents,
           round(sum((w.value ->> 'cents')::integer)::numeric * (100 - v_season.discount_percent) / 100)::integer as cents
    from jsonb_array_elements(v_weeks) w
    where w.value -> 'conflict' = 'null'::jsonb
    group by 1
  ) m;

  return jsonb_build_object(
    'seasonId', v_season.id,
    'courtId', v_court,
    'weekday', weekday_input,
    'startTime', to_char(start_time_input, 'HH24:MI'),
    'minutes', minutes_input,
    'weeks', v_weeks,
    'skipped', coalesce((select jsonb_agg(public.krossi_booking_date(d) order by d) from unnest(v_skipped) d), '[]'::jsonb),
    'count', v_count,
    'fullCents', v_full,
    'discountPercent', v_season.discount_percent,
    'cents', v_cents,
    'months', v_months,
    'courts', v_courts
  );
end;
$function$;

revoke all on function public.krossi_season_quote_internal(uuid, uuid, uuid, text, integer, time, integer, date) from public, anon, authenticated;

-- Season[]: hallin kaudet, jotka eivät ole vielä päättyneet, aikaisin ensin. Myös kirjautumaton.
create function public.krossi_seasons(venue_id_input uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1 from public.booking_venues v
    where v.id = venue_id_input and (v.is_public or public.krossi_booking_is_staff(v.id))
  ) then
    raise exception 'Hallia ei löytynyt.';
  end if;
  return coalesce((
    select jsonb_agg(public.krossi_season_json(s) order by s.starts_on, s.id)
    from public.booking_seasons s
    where s.venue_id = venue_id_input and s.ends_on >= public.krossi_booking_today(venue_id_input)
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.krossi_seasons(uuid) from public, anon, authenticated;
grant execute on function public.krossi_seasons(uuid) to anon, authenticated, service_role;

-- Kausi ja sen halli (näkyvä kutsujalle), muuten 'Kautta ei löytynyt.'
create function public.krossi_season_visible(season_id_input uuid)
returns public.booking_seasons
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_season public.booking_seasons;
begin
  select s.* into v_season
  from public.booking_seasons s
  join public.booking_venues v on v.id = s.venue_id
  where s.id = season_id_input and (v.is_public or public.krossi_booking_is_staff(v.id));
  if not found then
    raise exception 'Kautta ei löytynyt.';
  end if;
  return v_season;
end;
$function$;

revoke all on function public.krossi_season_visible(uuid) from public, anon, authenticated;

-- Kenttä / toimipaikka kuuluu hallin kenttiin (ja on käytössä).
create function public.krossi_season_check_place(venue_id_input uuid, court_id_input uuid, location_id_input uuid)
returns void
language plpgsql
stable
set search_path = ''
as $function$
begin
  if court_id_input is not null and not exists (
    select 1 from public.booking_courts c where c.id = court_id_input and c.venue_id = venue_id_input and c.is_active
  ) then
    raise exception 'Kenttää ei löytynyt.';
  end if;
  if location_id_input is not null and not exists (
    select 1 from public.booking_locations l where l.id = location_id_input and l.venue_id = venue_id_input
  ) then
    raise exception 'Kenttää ei löytynyt.';
  end if;
end;
$function$;

revoke all on function public.krossi_season_check_place(uuid, uuid, uuid) from public, anon, authenticated;

-- SeasonQuote kirjautuneelle (from_date_input null = tänään).
create function public.krossi_season_quote(
  season_id_input uuid,
  court_id_input uuid,
  location_id_input uuid,
  weekday_input integer,
  start_time_input text,
  minutes_input integer,
  from_date_input date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_season public.booking_seasons;
  v_venue public.booking_venues;
  v_time time;
begin
  if (select auth.uid()) is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  v_season := public.krossi_season_visible(season_id_input);
  select * into v_venue from public.booking_venues where id = v_season.venue_id;
  v_time := public.krossi_season_check_time(v_venue, weekday_input, start_time_input, minutes_input);
  perform public.krossi_season_check_place(v_venue.id, court_id_input, location_id_input);
  return public.krossi_season_quote_internal(v_season.id, court_id_input, location_id_input, 'tennis', weekday_input, v_time,
    minutes_input, greatest(coalesce(from_date_input, public.krossi_booking_today(v_venue.id)), public.krossi_booking_today(v_venue.id)));
end;
$function$;

revoke all on function public.krossi_season_quote(uuid, uuid, uuid, integer, text, integer, date) from public, anon, authenticated;
grant execute on function public.krossi_season_quote(uuid, uuid, uuid, integer, text, integer, date) to authenticated, service_role;

-- Pelaajan hakemus. Kortilla maksettava vaatii tallennetun kortin. Enintään 3 avointa hakemusta.
create function public.krossi_season_request(
  season_id_input uuid,
  court_id_input uuid,
  location_id_input uuid,
  weekday_input integer,
  start_time_input text,
  minutes_input integer,
  billing_input text,
  note_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_season public.booking_seasons;
  v_venue public.booking_venues;
  v_time time;
  v_quote jsonb;
  v_sport text := 'tennis';
  v_location uuid := location_id_input;
  v_slot public.booking_season_slots;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Täytä ensin pelaajaprofiilisi.';
  end if;
  v_season := public.krossi_season_visible(season_id_input);
  select * into v_venue from public.booking_venues where id = v_season.venue_id;
  if not v_season.requests_open or v_season.ends_on < public.krossi_booking_today(v_venue.id) then
    raise exception 'Tämän kauden vakiovuorohaku on suljettu.';
  end if;
  if billing_input is null or billing_input not in ('invoice', 'card') then
    raise exception 'Valitse, miten kausivuoro maksetaan.';
  end if;
  if billing_input = 'card' and not exists (select 1 from public.booking_saved_cards k where k.user_id = v_uid) then
    raise exception 'Tallenna ensin kortti, jolta kuukausimaksut veloitetaan.';
  end if;
  v_time := public.krossi_season_check_time(v_venue, weekday_input, start_time_input, minutes_input);
  perform public.krossi_season_check_place(v_venue.id, court_id_input, location_id_input);
  if court_id_input is not null then
    select c.sport, c.location_id into v_sport, v_location from public.booking_courts c where c.id = court_id_input;
  end if;

  v_quote := public.krossi_season_quote_internal(v_season.id, court_id_input, location_id_input, v_sport, weekday_input,
    v_time, minutes_input, public.krossi_booking_today(v_venue.id));
  if (v_quote ->> 'count')::integer = 0 then
    raise exception 'Tälle ajalle ei ole kaudella yhtään vapaata viikkoa. Kokeile toista aikaa tai kenttää.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('krossi_season_request:' || v_uid::text, 0));
  if exists (
    select 1 from public.booking_season_slots s
    where s.holder_id = v_uid and s.status = 'requested' and s.season_id = v_season.id
      and s.weekday = weekday_input and s.start_time = v_time
  ) then
    raise exception 'Sinulla on jo hakemus tälle ajalle.';
  end if;
  if (select count(*) from public.booking_season_slots s where s.holder_id = v_uid and s.status = 'requested') >= 3 then
    raise exception 'Sinulla on jo kolme avointa hakemusta. Odota hallin vastausta.';
  end if;

  insert into public.booking_season_slots (
    venue_id, season_id, sport, court_id, location_id, weekday, start_time, minutes, starts_on, skip_dates, status,
    billing, price_cents, weeks, holder_id, holder_name, billing_email, note, created_by
  ) values (
    v_venue.id, v_season.id, v_sport, court_id_input, v_location, weekday_input, v_time, minutes_input,
    coalesce((v_quote -> 'weeks' -> 0 ->> 'date')::date, public.krossi_booking_today(v_venue.id)),
    coalesce((select array_agg(x::date) from jsonb_array_elements_text(v_quote -> 'skipped') x), '{}'),
    'requested', billing_input, (v_quote ->> 'cents')::integer, (v_quote ->> 'count')::integer, v_uid,
    coalesce((select left(nullif(btrim(p.name), ''), 80) from public.profiles p where p.id = v_uid), 'Pelaaja'),
    (select left(u.email, 200) from auth.users u where u.id = v_uid),
    left(nullif(btrim(coalesce(note_input, '')), ''), 500),
    v_uid
  )
  returning * into v_slot;
  return public.krossi_season_slot_json(v_slot);
end;
$function$;

revoke all on function public.krossi_season_request(uuid, uuid, uuid, integer, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.krossi_season_request(uuid, uuid, uuid, integer, text, integer, text, text) to authenticated, service_role;

-- SeasonSlot[]: omat hakemukset ensin, sitten voimassa olevat (seuraava viikko ensin), sitten muut.
create function public.krossi_my_season_slots()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.rank, x.next_at nulls last, x.created_at desc)
    from (
      select public.krossi_season_slot_json(s) as j,
        case s.status when 'requested' then 0 when 'active' then 1 else 2 end as rank,
        case when s.status = 'active' then (
          select min(r.starts_at) from public.booking_reservations r
          where r.season_slot_id = s.id and r.status = 'confirmed' and r.starts_at > now()
        ) end as next_at,
        s.created_at
      from public.booking_season_slots s
      where s.holder_id = v_uid and s.status <> 'withdrawn'
    ) x
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.krossi_my_season_slots() from public, anon, authenticated;
grant execute on function public.krossi_my_season_slots() to authenticated, service_role;

create function public.krossi_season_withdraw(slot_id_input uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_slot public.booking_season_slots;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  select * into v_slot from public.booking_season_slots where id = slot_id_input and holder_id = v_uid for update;
  if not found then
    raise exception 'Hakemusta ei löytynyt.';
  end if;
  if v_slot.status <> 'requested' then
    raise exception 'Hakemus on jo käsitelty.';
  end if;
  update public.booking_season_slots set status = 'withdrawn', decided_at = now(), decided_by = v_uid where id = v_slot.id;
end;
$function$;

revoke all on function public.krossi_season_withdraw(uuid) from public, anon, authenticated;
grant execute on function public.krossi_season_withdraw(uuid) to authenticated, service_role;

-- SeasonSlot[] hallin henkilökunnalle: hakemukset (vanhin ensin), voimassa olevat (viikonpäivä,
-- kellonaika), muut (uusin päätös ensin).
create function public.krossi_season_staff_list(venue_id_input uuid)
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
    select jsonb_agg(public.krossi_season_slot_json(s) order by
      case s.status when 'requested' then 0 when 'active' then 1 else 2 end,
      case when s.status = 'requested' then s.created_at end,
      case when s.status = 'active' then s.weekday end,
      case when s.status = 'active' then s.start_time end,
      s.decided_at desc nulls last,
      s.id)
    from public.booking_season_slots s
    where s.venue_id = venue_id_input and s.status <> 'withdrawn'
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.krossi_season_staff_list(uuid) from public, anon, authenticated;
grant execute on function public.krossi_season_staff_list(uuid) to authenticated, service_role;

-- Sisäinen: vie kausivuoron viikot kalenteriin ja laskuttaa sen (hyväksyntä ja henkilökunnan oma
-- lisäys). Kaikki tai ei mitään: tarkistukset ensin, viikot yhdellä insertillä (exclusion-constraint
-- valvoo samanaikaiset varaukset), sitten lasku tai kuukausiveloitukset.
create function public.krossi_season_activate(
  slot_id_input uuid,
  court_id_input uuid,
  price_cents_input integer,
  skip_conflicts_input boolean,
  actor_input uuid
)
returns void
language plpgsql
set search_path = ''
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
        || ' · ' || v_court.name || ', ' || (select l.name from public.booking_locations l where l.id = v_court.location_id)
        || ' · ' || to_char(v_first, 'FMDD.FMMM.YYYY') || '–' || to_char(v_last, 'FMDD.FMMM.YYYY'),
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

revoke all on function public.krossi_season_activate(uuid, uuid, integer, boolean, uuid) from public, anon, authenticated;

-- Henkilökunta hyväksyy hakemuksen (valitsee kentän, jos hakemus ei nimennyt). Kortilla maksettavan
-- hinta tulee aina kauden hinnoista; laskulla maksettavalle voi antaa sovitun hinnan.
create function public.krossi_season_approve(slot_id_input uuid, court_id_input uuid, price_cents_input integer, skip_conflicts_input boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_slot public.booking_season_slots;
begin
  select * into v_slot from public.booking_season_slots where id = slot_id_input;
  if not found then
    raise exception 'Hakemusta ei löytynyt.';
  end if;
  if not public.krossi_booking_is_staff(v_slot.venue_id) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('krossi_season_slot:' || v_slot.id::text, 0));
  select * into v_slot from public.booking_season_slots where id = slot_id_input;
  if v_slot.status <> 'requested' then
    raise exception 'Hakemus on jo käsitelty.';
  end if;
  perform public.krossi_season_activate(v_slot.id, court_id_input, price_cents_input, skip_conflicts_input, (select auth.uid()));
  select * into v_slot from public.booking_season_slots where id = slot_id_input;
  return public.krossi_season_slot_json(v_slot);
end;
$function$;

revoke all on function public.krossi_season_approve(uuid, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.krossi_season_approve(uuid, uuid, integer, boolean) to authenticated, service_role;

-- Henkilökunta lisää kausivuoron itse (seura, yritys, tiskillä sovittu): laskulla, voimassa heti.
create function public.krossi_season_create(
  venue_id_input uuid,
  season_id_input uuid,
  court_id_input uuid,
  weekday_input integer,
  start_time_input text,
  minutes_input integer,
  holder_name_input text,
  billing_email_input text,
  billing_address_input text,
  price_cents_input integer,
  skip_conflicts_input boolean,
  from_date_input date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_venue public.booking_venues;
  v_season public.booking_seasons;
  v_court public.booking_courts;
  v_time time;
  v_name text := left(btrim(coalesce(holder_name_input, '')), 80);
  v_email text := nullif(btrim(coalesce(billing_email_input, '')), '');
  v_slot public.booking_season_slots;
begin
  if not public.krossi_booking_is_staff(venue_id_input) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  select * into v_venue from public.booking_venues where id = venue_id_input;
  select * into v_season from public.booking_seasons where id = season_id_input and venue_id = venue_id_input;
  if not found then
    raise exception 'Kautta ei löytynyt.';
  end if;
  if v_season.ends_on < public.krossi_booking_today(v_venue.id) then
    raise exception 'Kausi on jo päättynyt.';
  end if;
  v_time := public.krossi_season_check_time(v_venue, weekday_input, start_time_input, minutes_input);
  if v_name = '' then
    raise exception 'Kirjoita vuoron haltija, esim. seuran tai pelaajan nimi.';
  end if;
  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Tarkista laskutuksen sähköpostiosoite.';
  end if;
  select * into v_court from public.booking_courts where id = court_id_input and venue_id = v_venue.id and is_active;
  if not found then
    raise exception 'Kenttää ei löytynyt.';
  end if;

  insert into public.booking_season_slots (
    venue_id, season_id, sport, court_id, location_id, weekday, start_time, minutes, starts_on, status, billing,
    holder_name, billing_email, billing_address, created_by
  ) values (
    v_venue.id, v_season.id, v_court.sport, v_court.id, v_court.location_id, weekday_input, v_time, minutes_input,
    greatest(coalesce(from_date_input, public.krossi_booking_today(v_venue.id)), public.krossi_booking_today(v_venue.id)),
    'requested', 'invoice', v_name, v_email, left(nullif(btrim(coalesce(billing_address_input, '')), ''), 300), v_uid
  )
  returning * into v_slot;

  perform public.krossi_season_activate(v_slot.id, v_court.id, price_cents_input, skip_conflicts_input, v_uid);
  select * into v_slot from public.booking_season_slots where id = v_slot.id;
  return public.krossi_season_slot_json(v_slot);
end;
$function$;

revoke all on function public.krossi_season_create(uuid, uuid, uuid, integer, text, integer, text, text, text, integer, boolean, date) from public, anon, authenticated;
grant execute on function public.krossi_season_create(uuid, uuid, uuid, integer, text, integer, text, text, text, integer, boolean, date) to authenticated, service_role;

create function public.krossi_season_decline(slot_id_input uuid, reason_input text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_slot public.booking_season_slots;
begin
  select * into v_slot from public.booking_season_slots where id = slot_id_input for update;
  if not found then
    raise exception 'Hakemusta ei löytynyt.';
  end if;
  if not public.krossi_booking_is_staff(v_slot.venue_id) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  if v_slot.status <> 'requested' then
    raise exception 'Hakemus on jo käsitelty.';
  end if;
  update public.booking_season_slots
     set status = 'declined', decline_reason = left(nullif(btrim(coalesce(reason_input, '')), ''), 300),
         decided_at = now(), decided_by = (select auth.uid())
   where id = v_slot.id;
end;
$function$;

revoke all on function public.krossi_season_decline(uuid, text) from public, anon, authenticated;
grant execute on function public.krossi_season_decline(uuid, text) to authenticated, service_role;

-- Päättää kausivuoron: tulevat viikot vapautuvat, eräpäivää odottavat kuukausiveloitukset perutaan.
-- Lasku jää ennalleen (mahdollinen hyvitys tehdään erikseen).
create function public.krossi_season_end(slot_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_slot public.booking_season_slots;
  v_released integer;
begin
  select * into v_slot from public.booking_season_slots where id = slot_id_input for update;
  if not found then
    raise exception 'Kausivuoroa ei löytynyt.';
  end if;
  if not public.krossi_booking_is_staff(v_slot.venue_id) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  if v_slot.status <> 'active' then
    raise exception 'Kausivuoro ei ole voimassa.';
  end if;
  with released as (
    update public.booking_reservations
       set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid
     where season_slot_id = v_slot.id and status = 'confirmed' and starts_at > now()
    returning 1
  )
  select count(*)::integer into v_released from released;
  update public.booking_season_charges
     set status = 'void'
   where season_slot_id = v_slot.id and status in ('scheduled', 'failed')
     and due_on > public.krossi_booking_today(v_slot.venue_id);
  update public.booking_season_slots set status = 'ended', decided_at = now(), decided_by = v_uid where id = v_slot.id;
  return jsonb_build_object('released', v_released);
end;
$function$;

revoke all on function public.krossi_season_end(uuid) from public, anon, authenticated;
grant execute on function public.krossi_season_end(uuid) to authenticated, service_role;

-- Vapauttaa yhden kausivuoron viikon (esim. hallin tapahtuma). Rahaa ei liiku.
-- (Sovellus kutsuu tämän jälkeen krossi-bookingin 'freed'-toimintoa hälytyksiä varten.)
create function public.krossi_season_release_week(reservation_id_input uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
begin
  select * into v_row from public.booking_reservations where id = reservation_id_input and kind = 'season' for update;
  if not found then
    raise exception 'Kausivuoron viikkoa ei löytynyt.';
  end if;
  if not public.krossi_booking_is_staff(v_row.venue_id) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  if v_row.status <> 'confirmed' then
    return;
  end if;
  if v_row.starts_at <= now() then
    raise exception 'Alkanutta vuoroa ei voi enää vapauttaa.';
  end if;
  update public.booking_reservations
     set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid())
   where id = v_row.id;
end;
$function$;

revoke all on function public.krossi_season_release_week(uuid) from public, anon, authenticated;
grant execute on function public.krossi_season_release_week(uuid) to authenticated, service_role;


-- ── Laskutus ─────────────────────────────────────────────────────────────────

-- Invoice (vatCents = ALV:n osuus verollisesta summasta).
create function public.krossi_billing_invoice_json(i public.booking_invoices)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', i.id,
    'venueId', i.venue_id,
    'seasonSlotId', i.season_slot_id,
    'number', i.number,
    'reference', i.reference,
    'issuedOn', public.krossi_booking_date(i.issued_on),
    'dueOn', public.krossi_booking_date(i.due_on),
    'amountCents', i.amount_cents,
    'vatPercent', i.vat_percent,
    'vatCents', round(i.amount_cents::numeric * i.vat_percent / (100 + i.vat_percent))::integer,
    'lines', i.lines,
    'recipient', i.recipient,
    'seller', i.seller,
    'status', i.status,
    'paidOn', public.krossi_booking_date(i.paid_on),
    'sentAt', public.krossi_booking_iso(i.sent_at),
    'createdAt', public.krossi_booking_iso(i.created_at)
  );
$function$;

revoke all on function public.krossi_billing_invoice_json(public.booking_invoices) from public, anon, authenticated;

create function public.krossi_billing_invoices(venue_id_input uuid)
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
    select jsonb_agg(public.krossi_billing_invoice_json(i) order by i.created_at desc, i.number desc)
    from public.booking_invoices i
    where i.venue_id = venue_id_input
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.krossi_billing_invoices(uuid) from public, anon, authenticated;
grant execute on function public.krossi_billing_invoices(uuid) to authenticated, service_role;

-- Yksi lasku hallin henkilökunnalle tai kausivuoron haltijalle; muille null.
create function public.krossi_billing_invoice(invoice_id_input uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  return (
    select public.krossi_billing_invoice_json(i)
    from public.booking_invoices i
    join public.booking_season_slots s on s.id = i.season_slot_id
    where i.id = invoice_id_input
      and (s.holder_id = v_uid or public.krossi_booking_is_staff(i.venue_id))
  );
end;
$function$;

revoke all on function public.krossi_billing_invoice(uuid) from public, anon, authenticated;
grant execute on function public.krossi_billing_invoice(uuid) to authenticated, service_role;

create function public.krossi_billing_mark_invoice_paid(invoice_id_input uuid, paid_on_input date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_invoice public.booking_invoices;
  v_day date;
begin
  select * into v_invoice from public.booking_invoices where id = invoice_id_input for update;
  if not found then
    raise exception 'Laskua ei löytynyt.';
  end if;
  if not public.krossi_booking_is_staff(v_invoice.venue_id) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  if v_invoice.status = 'void' then
    raise exception 'Mitätöityä laskua ei voi merkitä maksetuksi.';
  end if;
  v_day := coalesce(paid_on_input, public.krossi_booking_today(v_invoice.venue_id));
  if v_day > public.krossi_booking_today(v_invoice.venue_id) then
    raise exception 'Tarkista maksupäivä.';
  end if;
  if v_invoice.status = 'open' then
    update public.booking_invoices set status = 'paid', paid_on = v_day where id = v_invoice.id
    returning * into v_invoice;
  end if;
  return public.krossi_billing_invoice_json(v_invoice);
end;
$function$;

revoke all on function public.krossi_billing_mark_invoice_paid(uuid, date) from public, anon, authenticated;
grant execute on function public.krossi_billing_mark_invoice_paid(uuid, date) to authenticated, service_role;

-- Vain service_role (krossi-billing, kun sähköposti lähti).
create function public.krossi_billing_mark_invoice_sent(invoice_id_input uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.booking_invoices set sent_at = now() where id = invoice_id_input;
$function$;

revoke all on function public.krossi_billing_mark_invoice_sent(uuid) from public, anon, authenticated;
grant execute on function public.krossi_billing_mark_invoice_sent(uuid) to service_role;

-- SavedCard | null
create function public.krossi_billing_card()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  return (
    select jsonb_build_object('brand', k.brand, 'last4', k.last4, 'expMonth', k.exp_month, 'expYear', k.exp_year)
    from public.booking_saved_cards k where k.user_id = v_uid
  );
end;
$function$;

revoke all on function public.krossi_billing_card() from public, anon, authenticated;
grant execute on function public.krossi_billing_card() to authenticated, service_role;

-- Vain service_role (krossi-billing, kun Stripe vahvisti SetupIntentin): tallentaa / vaihtaa kortin.
create function public.krossi_billing_save_card(
  user_id_input uuid,
  customer_input text,
  payment_method_input text,
  brand_input text,
  last4_input text,
  exp_month_input integer,
  exp_year_input integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.booking_saved_cards (user_id, stripe_customer_id, stripe_payment_method_id, brand, last4, exp_month, exp_year)
  values (user_id_input, customer_input, payment_method_input, coalesce(nullif(btrim(brand_input), ''), 'card'), last4_input,
          exp_month_input, exp_year_input)
  on conflict (user_id) do update
    set stripe_customer_id = excluded.stripe_customer_id,
        stripe_payment_method_id = excluded.stripe_payment_method_id,
        brand = excluded.brand,
        last4 = excluded.last4,
        exp_month = excluded.exp_month,
        exp_year = excluded.exp_year,
        updated_at = now();
  return (
    select jsonb_build_object('brand', k.brand, 'last4', k.last4, 'expMonth', k.exp_month, 'expYear', k.exp_year)
    from public.booking_saved_cards k where k.user_id = user_id_input
  );
end;
$function$;

revoke all on function public.krossi_billing_save_card(uuid, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.krossi_billing_save_card(uuid, text, text, text, text, integer, integer) to service_role;

-- Poistaa oman kortin (ei, jos kortilta veloitetaan voimassa olevaa kausivuoroa). Palauttaa
-- Stripen payment method -tunnisteen, jotta krossi-billing voi irrottaa sen asiakkaasta.
create function public.krossi_billing_remove_card()
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_pm text;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  if exists (
    select 1 from public.booking_season_slots s
    where s.holder_id = v_uid and s.billing = 'card' and s.status = 'active'
  ) then
    raise exception 'Kausivuorosi kuukausimaksut veloitetaan tältä kortilta. Tallenna uusi kortti tilalle tai pyydä hallilta laskua.';
  end if;
  delete from public.booking_saved_cards where user_id = v_uid returning stripe_payment_method_id into v_pm;
  return v_pm;
end;
$function$;

revoke all on function public.krossi_billing_remove_card() from public, anon, authenticated;
grant execute on function public.krossi_billing_remove_card() to authenticated, service_role;

-- CardCharge[] henkilökunnalle: epäonnistuneet ensin, sitten erääntyneet, sitten eräpäivän mukaan.
create function public.krossi_billing_charges(venue_id_input uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_today date := public.krossi_booking_today(venue_id_input);
begin
  if not public.krossi_booking_is_staff(venue_id_input) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  return coalesce((
    select jsonb_agg(public.krossi_billing_charge_json(c) order by
      case when c.status = 'failed' then 0 when c.status in ('scheduled', 'processing') and c.due_on <= v_today then 1 else 2 end,
      c.due_on, c.id)
    from public.booking_season_charges c
    where c.venue_id = venue_id_input
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.krossi_billing_charges(uuid) from public, anon, authenticated;
grant execute on function public.krossi_billing_charges(uuid) to authenticated, service_role;

-- Vain service_role (krossi-billing, kuukausiajo): veloitettavat kuukaudet — erääntyneet, voimassa
-- olevan kortilla maksettavan kausivuoron; epäonnistunut yritetään uudelleen aikaisintaan 20 h päästä
-- ja enintään 4 kertaa; kesken jäänyt ('processing') tunnin päästä. venue_id_input null = kaikki hallit.
create function public.krossi_billing_due_charges(venue_id_input uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
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
    'description', 'Kausivuoro ' || s.holder_name || ', ' || c.month || ' · ' || v.name
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

revoke all on function public.krossi_billing_due_charges(uuid) from public, anon, authenticated;
grant execute on function public.krossi_billing_due_charges(uuid) to service_role;

-- Vain service_role: veloitusyritys alkaa. Palauttaa yrityksen numeron (idempotenssiavaimeen) tai
-- null, jos kuukausi ei ole enää veloitettavissa (toinen ajo ehti, maksettu, peruttu).
create function public.krossi_billing_charge_attempt(charge_id_input uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempts integer;
begin
  update public.booking_season_charges c
     set status = 'processing', attempts = c.attempts + 1, last_attempt_at = now()
   where c.id = charge_id_input
     and (c.status in ('scheduled', 'failed') or (c.status = 'processing' and c.last_attempt_at < now() - interval '1 hour'))
  returning c.attempts into v_attempts;
  return v_attempts;
end;
$function$;

revoke all on function public.krossi_billing_charge_attempt(uuid) from public, anon, authenticated;
grant execute on function public.krossi_billing_charge_attempt(uuid) to service_role;

-- Vain service_role (krossi-billing, stripe-webhook): veloituksen tulos. Maksettu kuukausi pysyy
-- maksettuna; peruttu ('void') ei muutu. Palauttaa kuukauden tilan.
create function public.krossi_billing_charge_result(
  charge_id_input uuid,
  payment_intent_id_input text,
  succeeded_input boolean,
  failure_message_input text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_charge public.booking_season_charges;
begin
  select * into v_charge from public.booking_season_charges where id = charge_id_input for update;
  if not found then
    raise exception 'Veloitusta ei löytynyt.';
  end if;
  if v_charge.status in ('paid', 'void') then
    return v_charge.status;
  end if;
  if succeeded_input then
    update public.booking_season_charges
       set status = 'paid', paid_at = now(), failure_message = null,
           stripe_payment_intent_id = coalesce(nullif(btrim(coalesce(payment_intent_id_input, '')), ''), stripe_payment_intent_id)
     where id = v_charge.id;
    return 'paid';
  end if;
  -- Epäonnistuminen kirjataan vain viimeisimmälle maksulle (vanha maksu ei kumoa uudempaa yritystä).
  if payment_intent_id_input is not null and v_charge.stripe_payment_intent_id is not null
     and v_charge.stripe_payment_intent_id <> payment_intent_id_input and v_charge.status <> 'processing' then
    return v_charge.status;
  end if;
  update public.booking_season_charges
     set status = 'failed',
         failure_message = left(coalesce(nullif(btrim(coalesce(failure_message_input, '')), ''), 'Veloitus epäonnistui.'), 300),
         stripe_payment_intent_id = coalesce(nullif(btrim(coalesce(payment_intent_id_input, '')), ''), stripe_payment_intent_id)
   where id = v_charge.id;
  return 'failed';
end;
$function$;

revoke all on function public.krossi_billing_charge_result(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.krossi_billing_charge_result(uuid, text, boolean, text) to service_role;


-- ── Sarjakortit ja lahjakortit ────────────────────────────────────────────────

-- CreditEvent
create function public.krossi_wallet_event_json(e public.booking_credit_events)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', e.id, 'kind', e.kind, 'minutes', e.minutes, 'cents', e.cents, 'label', e.label,
    'bookingId', e.booking_id, 'createdAt', public.krossi_booking_iso(e.created_at)
  );
$function$;

revoke all on function public.krossi_wallet_event_json(public.booking_credit_events) from public, anon, authenticated;

-- Pass (tila lasketaan: pending / expired / used / active).
create function public.krossi_wallet_pass_json(p public.booking_passes, with_history boolean)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p.id,
    'venueId', p.venue_id,
    'productId', p.product_id,
    'name', p.name,
    'sport', p.sport,
    'minutesTotal', p.minutes_total,
    'minutesLeft', p.minutes_left,
    'validUntil', public.krossi_booking_date(p.valid_until),
    'status', case
      when p.status <> 'active' then 'pending'
      when p.valid_until < public.krossi_booking_today(p.venue_id) then 'expired'
      when p.minutes_left > 0 then 'active'
      else 'used'
    end,
    'priceCents', p.price_cents,
    'purchasedAt', public.krossi_booking_iso(p.purchased_at),
    'history', case when with_history then coalesce((
      select jsonb_agg(public.krossi_wallet_event_json(e) order by e.created_at desc, e.id desc)
      from public.booking_credit_events e where e.pass_id = p.id
    ), '[]'::jsonb) else '[]'::jsonb end
  );
$function$;

revoke all on function public.krossi_wallet_pass_json(public.booking_passes, boolean) from public, anon, authenticated;

-- GiftCard (koodi vasta maksettuna; vanhentunut lasketaan).
create function public.krossi_wallet_gift_card_json(g public.booking_gift_cards)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', g.id,
    'venueId', g.venue_id,
    'code', case when g.status = 'pending' then null else g.code end,
    'amountCents', g.amount_cents,
    'recipientName', g.recipient_name,
    'message', g.message,
    'status', case
      when g.status = 'active' and g.valid_until < public.krossi_booking_today(g.venue_id) then 'expired'
      when g.status = 'void' then 'expired'
      else g.status
    end,
    'validUntil', public.krossi_booking_date(g.valid_until),
    'redeemedAt', public.krossi_booking_iso(g.redeemed_at),
    'createdAt', public.krossi_booking_iso(g.created_at)
  );
$function$;

revoke all on function public.krossi_wallet_gift_card_json(public.booking_gift_cards) from public, anon, authenticated;

-- { passes: PassProduct[], gift: { amounts, minCents, maxCents, validDays } }. Myös kirjautumaton.
create function public.krossi_wallet_products(venue_id_input uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_settings public.booking_billing_settings;
begin
  if not exists (
    select 1 from public.booking_venues v
    where v.id = venue_id_input and (v.is_public or public.krossi_booking_is_staff(v.id))
  ) then
    raise exception 'Hallia ei löytynyt.';
  end if;
  select * into v_settings from public.booking_billing_settings where venue_id = venue_id_input;
  return jsonb_build_object(
    'passes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'venueId', p.venue_id, 'name', p.name, 'sport', p.sport, 'uses', p.uses,
        'minutesPerUse', p.minutes_per_use, 'validDays', p.valid_days, 'priceCents', p.price_cents,
        'description', p.description
      ) order by p.sort, p.price_cents, p.id)
      from public.booking_pass_products p
      where p.venue_id = venue_id_input and p.is_active
    ), '[]'::jsonb),
    'gift', jsonb_build_object(
      'amounts', to_jsonb(coalesce(v_settings.gift_amounts, '{2500,5000,10000}'::integer[])),
      'minCents', coalesce(v_settings.gift_min_cents, 1000),
      'maxCents', coalesce(v_settings.gift_max_cents, 30000),
      'validDays', coalesce(v_settings.gift_valid_days, 365)
    )
  );
end;
$function$;

revoke all on function public.krossi_wallet_products(uuid) from public, anon, authenticated;
grant execute on function public.krossi_wallet_products(uuid) to anon, authenticated, service_role;

-- Wallet: omat sarjakortit (voimassa olevat ensin), käytettävissä oleva lahjakorttisaldo,
-- saldon historia ja ostetut lahjakortit.
create function public.krossi_wallet(venue_id_input uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  if not exists (
    select 1 from public.booking_venues v
    where v.id = venue_id_input and (v.is_public or public.krossi_booking_is_staff(v.id))
  ) then
    raise exception 'Hallia ei löytynyt.';
  end if;
  return jsonb_build_object(
    'venueId', venue_id_input,
    'passes', coalesce((
      select jsonb_agg(x.j order by x.rank, x.valid_until, x.purchased_at desc)
      from (
        select public.krossi_wallet_pass_json(p, true) as j,
          case when p.valid_until >= public.krossi_booking_today(p.venue_id) and p.minutes_left > 0 then 0 else 1 end as rank,
          case when p.valid_until >= public.krossi_booking_today(p.venue_id) and p.minutes_left > 0 then p.valid_until end as valid_until,
          p.purchased_at
        from public.booking_passes p
        where p.user_id = v_uid and p.venue_id = venue_id_input and p.status = 'active'
      ) x
    ), '[]'::jsonb),
    'giftCents', public.krossi_wallet_gift_available(v_uid, venue_id_input, null),
    'giftHistory', coalesce((
      select jsonb_agg(public.krossi_wallet_event_json(e) order by e.created_at desc, e.id desc)
      from public.booking_credit_events e
      where e.user_id = v_uid and e.venue_id = venue_id_input and e.pass_id is null
    ), '[]'::jsonb),
    'giftCards', coalesce((
      select jsonb_agg(public.krossi_wallet_gift_card_json(g) order by g.created_at desc, g.id desc)
      from public.booking_gift_cards g
      where g.buyer_id = v_uid and g.venue_id = venue_id_input and g.status <> 'pending'
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.krossi_wallet(uuid) from public, anon, authenticated;
grant execute on function public.krossi_wallet(uuid) to authenticated, service_role;

-- Tilaa sarjakortin (maksamaton 'pending'; saman tuotteen maksamaton tilaus käytetään uudelleen).
create function public.krossi_wallet_buy_pass(product_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_product public.booking_pass_products;
  v_pass public.booking_passes;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Täytä ensin pelaajaprofiilisi.';
  end if;
  select pp.* into v_product
  from public.booking_pass_products pp
  join public.booking_venues v on v.id = pp.venue_id
  where pp.id = product_id_input and pp.is_active and (v.is_public or public.krossi_booking_is_staff(v.id));
  if not found then
    raise exception 'Sarjakorttia ei löytynyt.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('krossi_wallet_order:' || v_uid::text, 0));
  select * into v_pass from public.booking_passes
   where user_id = v_uid and product_id = v_product.id and status = 'pending'
   order by created_at desc limit 1;
  if not found then
    insert into public.booking_passes (venue_id, product_id, user_id, name, sport, minutes_total, minutes_left, price_cents)
    values (v_product.venue_id, v_product.id, v_uid, v_product.name, v_product.sport,
            v_product.uses * v_product.minutes_per_use, v_product.uses * v_product.minutes_per_use, v_product.price_cents)
    returning * into v_pass;
  end if;
  return public.krossi_wallet_pass_json(v_pass, false);
end;
$function$;

revoke all on function public.krossi_wallet_buy_pass(uuid) from public, anon, authenticated;
grant execute on function public.krossi_wallet_buy_pass(uuid) to authenticated, service_role;

-- Tilaa lahjakortin (maksamaton 'pending', ei koodia).
create function public.krossi_wallet_buy_gift(venue_id_input uuid, amount_cents_input integer, recipient_name_input text, message_input text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_min integer;
  v_max integer;
  v_card public.booking_gift_cards;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Täytä ensin pelaajaprofiilisi.';
  end if;
  if not exists (
    select 1 from public.booking_venues v
    where v.id = venue_id_input and (v.is_public or public.krossi_booking_is_staff(v.id))
  ) then
    raise exception 'Hallia ei löytynyt.';
  end if;
  select coalesce(s.gift_min_cents, 1000), coalesce(s.gift_max_cents, 30000) into v_min, v_max
  from (select 1) one left join public.booking_billing_settings s on s.venue_id = venue_id_input;
  if amount_cents_input is null or amount_cents_input % 100 <> 0 or amount_cents_input not between v_min and v_max then
    raise exception 'Valitse summa %–% € täysinä euroina.', v_min / 100, v_max / 100;
  end if;
  insert into public.booking_gift_cards (venue_id, amount_cents, buyer_id, recipient_name, message)
  values (venue_id_input, amount_cents_input, v_uid,
          left(nullif(btrim(coalesce(recipient_name_input, '')), ''), 60), left(nullif(btrim(coalesce(message_input, '')), ''), 300))
  returning * into v_card;
  return public.krossi_wallet_gift_card_json(v_card);
end;
$function$;

revoke all on function public.krossi_wallet_buy_gift(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.krossi_wallet_buy_gift(uuid, integer, text, text) to authenticated, service_role;

-- Vain service_role (krossi-billing, stripe-webhook): tilaus maksettiin. Sarjakortti aktivoituu
-- (saldo, voimassaolo, historiaan 'purchase'), lahjakortti saa koodin. Palauttaa:
--   'paid'       aktivoitu nyt tai jo aiemmin tällä samalla maksulla
--   'duplicate'  tilaus oli jo maksettu toisella maksulla tai summa ei täsmää → kutsuja palauttaa maksun
create function public.krossi_wallet_order_paid(kind_input text, order_id_input uuid, payment_intent_id_input text, amount_input integer)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pass public.booking_passes;
  v_card public.booking_gift_cards;
  v_days integer;
  v_code text;
  v_intent text := nullif(btrim(coalesce(payment_intent_id_input, '')), '');
begin
  if v_intent is null then
    raise exception 'Maksun tunniste puuttuu.';
  end if;
  if kind_input = 'pass' then
    select * into v_pass from public.booking_passes where id = order_id_input for update;
    if not found then
      raise exception 'Tilausta ei löytynyt.';
    end if;
    if v_pass.status <> 'pending' then
      return case when v_pass.stripe_payment_intent_id = v_intent then 'paid' else 'duplicate' end;
    end if;
    if amount_input is distinct from v_pass.price_cents then
      return 'duplicate';
    end if;
    select pp.valid_days into v_days from public.booking_pass_products pp where pp.id = v_pass.product_id;
    update public.booking_passes
       set status = 'active', purchased_at = now(), minutes_left = minutes_total, stripe_payment_intent_id = v_intent,
           valid_until = public.krossi_booking_today(venue_id) + coalesce(v_days, 365)
     where id = v_pass.id
    returning * into v_pass;
    insert into public.booking_credit_events (venue_id, user_id, kind, pass_id, minutes, label)
    values (v_pass.venue_id, v_pass.user_id, 'purchase', v_pass.id, v_pass.minutes_total, 'Ostettu: ' || v_pass.name);
    return 'paid';
  elsif kind_input = 'gift' then
    select * into v_card from public.booking_gift_cards where id = order_id_input for update;
    if not found then
      raise exception 'Tilausta ei löytynyt.';
    end if;
    if v_card.status <> 'pending' then
      return case when v_card.stripe_payment_intent_id = v_intent then 'paid' else 'duplicate' end;
    end if;
    if amount_input is distinct from v_card.amount_cents then
      return 'duplicate';
    end if;
    loop
      v_code := public.krossi_gift_code();
      exit when not exists (select 1 from public.booking_gift_cards g where g.code = v_code);
    end loop;
    select coalesce(s.gift_valid_days, 365) into v_days
    from (select 1) one left join public.booking_billing_settings s on s.venue_id = v_card.venue_id;
    update public.booking_gift_cards
       set status = 'active', code = v_code, paid_at = now(), stripe_payment_intent_id = v_intent,
           valid_until = public.krossi_booking_today(venue_id) + v_days
     where id = v_card.id;
    return 'paid';
  end if;
  raise exception 'Tuntematon tilaus.';
end;
$function$;

revoke all on function public.krossi_wallet_order_paid(text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.krossi_wallet_order_paid(text, uuid, text, integer) to service_role;

-- Lunastaa lahjakortin koodin saldoksi koodin hallissa. Palauttaa { ok: true, venueId, cents,
-- giftCents } tai { ok: false, error, code } — ei poikkeusta, jotta epäonnistunut yritys jää
-- talteen (10 väärää koodia tunnissa → odota).
create function public.krossi_wallet_redeem(code_input text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_raw text := upper(regexp_replace(coalesce(code_input, ''), '[^A-Za-z0-9]', '', 'g'));
  v_code text;
  v_card public.booking_gift_cards;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Täytä ensin pelaajaprofiilisi.';
  end if;
  if (
    select count(*) from public.booking_gift_redeem_attempts a
    where a.user_id = v_uid and a.attempted_at > now() - interval '1 hour'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited', 'error', 'Liian monta väärää koodia. Yritä tunnin päästä uudelleen.');
  end if;
  if length(v_raw) = 12 and left(v_raw, 4) = 'KRSI' then
    v_raw := substr(v_raw, 5);
  end if;
  if length(v_raw) = 8 then
    v_code := 'KRSI-' || substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4);
    select * into v_card from public.booking_gift_cards where code = v_code and status <> 'pending' for update;
  end if;
  if v_card.id is null then
    insert into public.booking_gift_redeem_attempts (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Koodia ei löytynyt. Tarkista kirjoitusasu.');
  end if;
  if v_card.status = 'redeemed' then
    return jsonb_build_object('ok', false, 'code', 'used', 'error', 'Tämä lahjakortti on jo käytetty.');
  end if;
  if v_card.status = 'void' or v_card.valid_until < public.krossi_booking_today(v_card.venue_id) then
    return jsonb_build_object('ok', false, 'code', 'expired', 'error', 'Lahjakortti on vanhentunut.');
  end if;
  update public.booking_gift_cards set status = 'redeemed', redeemed_by = v_uid, redeemed_at = now() where id = v_card.id;
  insert into public.booking_credit_events (venue_id, user_id, kind, gift_card_id, cents, label)
  values (v_card.venue_id, v_uid, 'redeem', v_card.id, v_card.amount_cents, 'Lahjakortti ' || v_card.code);
  return jsonb_build_object(
    'ok', true, 'venueId', v_card.venue_id, 'cents', v_card.amount_cents,
    'giftCents', public.krossi_wallet_gift_available(v_uid, v_card.venue_id, null)
  );
end;
$function$;

revoke all on function public.krossi_wallet_redeem(text) from public, anon, authenticated;
grant execute on function public.krossi_wallet_redeem(text) to authenticated, service_role;

-- Sisäinen: kutsujan oma, voimassa oleva ja maksamaton pito lukittuna.
create function public.krossi_wallet_payable_booking(booking_id_input uuid, user_id_input uuid)
returns public.booking_reservations
language plpgsql
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
begin
  select * into v_row from public.booking_reservations
   where id = booking_id_input and kind = 'booking' and booked_by = user_id_input
   for update;
  if not found then
    raise exception 'Varausta ei löytynyt.';
  end if;
  if v_row.status = 'confirmed' and v_row.payment_status in ('paid', 'free', 'credit') then
    raise exception 'Varaus on jo maksettu.';
  end if;
  if v_row.status <> 'held' or v_row.hold_expires_at <= now() or v_row.payment_status <> 'unpaid' then
    raise exception 'Varauksen pitoaika ehti umpeutua. Valitse aika uudelleen.';
  end if;
  return v_row;
end;
$function$;

revoke all on function public.krossi_wallet_payable_booking(uuid, uuid) from public, anon, authenticated;

-- Maksaa oman pidossa olevan varauksen kokonaan sarjakortilla (minuutit vähenevät, varaus vahvistuu).
create function public.krossi_wallet_pay_booking(booking_id_input uuid, pass_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_row public.booking_reservations;
  v_pass public.booking_passes;
  v_sport text;
  v_tz text;
  v_minutes integer;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  v_row := public.krossi_wallet_payable_booking(booking_id_input, v_uid);
  select * into v_pass from public.booking_passes where id = pass_id_input and user_id = v_uid and status = 'active' for update;
  if not found then
    raise exception 'Sarjakorttia ei löytynyt.';
  end if;
  select c.sport, v.timezone into v_sport, v_tz
  from public.booking_courts c join public.booking_venues v on v.id = c.venue_id
  where c.id = v_row.court_id;
  if v_pass.venue_id <> v_row.venue_id or v_pass.sport <> v_sport then
    raise exception 'Sarjakortti ei käy tähän vuoroon.';
  end if;
  if v_pass.valid_until < public.krossi_booking_today(v_pass.venue_id) or (v_row.starts_at at time zone v_tz)::date > v_pass.valid_until then
    raise exception 'Sarjakortti ei ole voimassa vuoron päivänä.';
  end if;
  v_minutes := (extract(epoch from (v_row.ends_at - v_row.starts_at)) / 60)::integer;
  if v_pass.minutes_left < v_minutes then
    raise exception 'Sarjakortin saldo ei riitä tähän vuoroon.';
  end if;

  update public.booking_passes set minutes_left = minutes_left - v_minutes where id = v_pass.id;
  update public.booking_reservations
     set status = 'confirmed', payment_status = 'credit', hold_expires_at = null, pass_id = v_pass.id,
         pass_minutes = v_minutes, gift_cents = 0
   where id = v_row.id
  returning * into v_row;
  insert into public.booking_credit_events (venue_id, user_id, kind, pass_id, booking_id, minutes, label)
  values (v_row.venue_id, v_uid, 'use', v_pass.id, v_row.id, -v_minutes, public.krossi_booking_label(v_row));
  return public.krossi_booking_json(v_row);
end;
$function$;

revoke all on function public.krossi_wallet_pay_booking(uuid, uuid) from public, anon, authenticated;
grant execute on function public.krossi_wallet_pay_booking(uuid, uuid) to authenticated, service_role;

-- Käyttää (use_input) tai poistaa lahjakorttisaldon pidossa olevalta varaukselta. Jos saldo kattaa
-- koko hinnan, varaus vahvistuu heti ja saldo vähenee; muuten osuus varataan (gift_cents, kortille
-- jää vähintään 50 senttiä) ja vähennetään vasta kun loppu maksetaan (krossi_booking_mark_paid).
create function public.krossi_wallet_use_gift(booking_id_input uuid, use_input boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_row public.booking_reservations;
  v_available integer;
  v_share integer;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  v_row := public.krossi_wallet_payable_booking(booking_id_input, v_uid);
  if not coalesce(use_input, false) then
    update public.booking_reservations set gift_cents = 0 where id = v_row.id returning * into v_row;
    return public.krossi_booking_json(v_row);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('krossi_wallet:' || v_uid::text, 0));
  v_available := public.krossi_wallet_gift_available(v_uid, v_row.venue_id, v_row.id);
  v_share := case
    when v_available <= 0 or v_row.price_cents <= 0 then 0
    when v_available >= v_row.price_cents then v_row.price_cents
    else greatest(0, least(v_available, v_row.price_cents - 50))
  end;
  if v_share <= 0 then
    raise exception 'Lahjakorttisaldoa ei ole käytettävissä.';
  end if;

  if v_share = v_row.price_cents then
    update public.booking_reservations
       set status = 'confirmed', payment_status = 'credit', hold_expires_at = null, gift_cents = v_share
     where id = v_row.id
    returning * into v_row;
    insert into public.booking_credit_events (venue_id, user_id, kind, booking_id, cents, label)
    values (v_row.venue_id, v_uid, 'use', v_row.id, -v_share, public.krossi_booking_label(v_row));
  else
    update public.booking_reservations set gift_cents = v_share where id = v_row.id returning * into v_row;
  end if;
  return public.krossi_booking_json(v_row);
end;
$function$;

revoke all on function public.krossi_wallet_use_gift(uuid, boolean) from public, anon, authenticated;
grant execute on function public.krossi_wallet_use_gift(uuid, boolean) to authenticated, service_role;

-- Henkilökunnalle: myydyt sarjakortit (omistajineen) ja lahjakortit (ostaja, lunastaja).
create function public.krossi_wallet_staff_list(venue_id_input uuid)
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
      select jsonb_agg(public.krossi_wallet_pass_json(p, false) || jsonb_build_object('owner', public.krossi_booking_person_json(p.user_id))
        order by case when p.valid_until >= public.krossi_booking_today(p.venue_id) and p.minutes_left > 0 then 0 else 1 end,
          p.purchased_at desc, p.id)
      from public.booking_passes p
      where p.venue_id = venue_id_input and p.status = 'active'
    ), '[]'::jsonb),
    'giftCards', coalesce((
      select jsonb_agg(public.krossi_wallet_gift_card_json(g) || jsonb_build_object(
          'buyer', case when g.buyer_id is not null then public.krossi_booking_person_json(g.buyer_id) end,
          'redeemedBy', case when g.redeemed_by is not null then public.krossi_booking_person_json(g.redeemed_by) end)
        order by g.created_at desc, g.id desc)
      from public.booking_gift_cards g
      where g.venue_id = venue_id_input and g.status <> 'pending'
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.krossi_wallet_staff_list(uuid) from public, anon, authenticated;
grant execute on function public.krossi_wallet_staff_list(uuid) to authenticated, service_role;
