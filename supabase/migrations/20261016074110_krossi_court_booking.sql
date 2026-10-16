-- Krossi: kenttävaraus — hallit, kentät, hinnat, varaukset ja "ilmoita kun vapautuu".
--
-- Pelaaja varaa tennis-, padel-, sulkapallo- tai squash-kentän hallista ja maksaa sen
-- Stripellä (edge-funktio krossi-booking), ja voi perua ennen hallin peruutusrajaa. Hallin
-- henkilökunta näkee päivän varaukset nimineen ja voi estää aikoja (valmennus, hallisarja).
-- Täyteen aikaan voi laittaa hälytyksen: kun kenttä vapautuu, krossi-notify lähettää sähköpostin.
--
-- Court booking for Krossi (krossi.app/pelaa). Purely additive: new tables and functions only.
-- Nothing in profiles or in any existing function or policy changes, so Koutsi (same database)
-- is unaffected.
--
--   booking_venues        halli (operaattori), esim. Lahden Tennis- ja Squashkeskus
--   booking_locations     hallin toimipaikat (Janus-Areena, Kispi-Areena, ulkokentät)
--   booking_courts        kentät
--   booking_prices        hintasäännöt — toimivat samalla aukioloaikoina
--   booking_staff         hallin henkilökunta (Krossin ylläpito on jokaisen hallin henkilökuntaa)
--   booking_reservations  varaukset, estot ja liigavuorot; exclusion-constraint estää päällekkäiset
--   booking_watches       "Ilmoita kun vapautuu" -hälytykset
--
-- Hinnoittelu (täsmälleen sama sääntö kuin sovelluksen src/features/booking.js:ssä):
--   varaus hinnoitellaan 30 minuutin palasina hallin paikallisessa ajassa. Jokaiselle palalle
--   valitaan korkeimman prioriteetin sääntö (tasatilanteessa pienin id — samassa järjestyksessä
--   kuin krossi_booking_venues() palauttaa säännöt), jonka laji (sports, null = kaikki), kenttä
--   (court_ids, null = kaikki), ISO-viikonpäivä ja kellonaika (from_time <= palan alku <
--   until_time) täsmäävät. Palan hinta on cents_per_hour / 2; summa pyöristetään lopuksi
--   kokonaisiksi senteiksi. Jos jollekin palalle ei löydy sääntöä, aikaa ei voi varata.
--   Viime hetken ale (last_minute_hours/_percent): krossi_hold_booking vähentää prosentin, kun
--   varaus tehdään alle last_minute_hours tuntia ennen alkua: round(hinta * (100 - %) / 100).
--   krossi_booking_price palauttaa aina hinnan ilman alea.
--
-- Pito: maksamaton varaus (status 'held') pitää kentän hold_minutes minuuttia. Vanhentunut pito
-- on yhä exclusion-constraintissa, joten jokainen kirjoittava funktio merkitsee ensin samaan
-- aikaan osuvat vanhentuneet pidot 'expired'-tilaan samassa transaktiossa, ja jokainen lukeva
-- funktio pitää vanhentunutta pitoa vapaana (ja näyttää sen tilana 'expired').
--
-- Asiakkaat eivät kirjoita tauluihin suoraan: kaikki kulkee alla olevien SECURITY DEFINER
-- -funktioiden kautta. Maksun vahvistus, peruutuksen kirjaus ja hälytysten poiminta
-- (krossi_booking_mark_paid / _mark_cancelled / _watchers_to_notify) ovat vain service_rolelle
-- (krossi-booking, stripe-webhook). Kaikki ajat palautetaan ISO-muodossa UTC:nä
-- ('2026-10-16T15:00:00.000Z'), kuten JS:n toISOString(), ja JSON-avaimet ovat
-- api/contract.js:n tyyppien mukaiset.

create extension if not exists btree_gist with schema extensions;


-- ── Taulut ───────────────────────────────────────────────────────────────────

create table public.booking_venues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  city text not null,
  timezone text not null default 'Europe/Helsinki',
  open_from time not null default '06:00',
  open_until time not null default '23:00',
  slot_minutes integer not null default 30,
  durations integer[] not null default '{60,90,120}',
  days_ahead integer not null default 14,
  cancel_limit_hours integer not null default 24,
  hold_minutes integer not null default 10,
  -- viime hetken ale: alle last_minute_hours tuntia ennen alkua tehty varaus maksaa
  -- last_minute_percent % vähemmän; null = ei alea
  last_minute_hours integer,
  last_minute_percent integer not null default 0,
  -- Hallin Stripe Connect -tili; null = maksu Krossin omalle tilille.
  stripe_account_id text,
  -- Krossin osuus Connect-maksuista (1 bps = 0,01 %).
  platform_fee_bps integer not null default 0,
  -- false = vain hallin henkilökunta ja Krossin ylläpito näkevät hallin.
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  constraint booking_venues_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- tuntematon aikavyöhyke kaatuu jo tähän
  constraint booking_venues_timezone_known check (pg_catalog.timezone(timezone, timestamptz '2000-01-01 00:00+00') is not null),
  constraint booking_venues_hours check (open_from < open_until),
  constraint booking_venues_slot check (slot_minutes between 5 and 120),
  constraint booking_venues_durations check (cardinality(durations) > 0 and 0 < all (durations) and 1440 >= all (durations)),
  constraint booking_venues_days_ahead check (days_ahead between 0 and 730),
  constraint booking_venues_cancel_limit check (cancel_limit_hours between 0 and 720),
  constraint booking_venues_hold check (hold_minutes between 1 and 60),
  constraint booking_venues_last_minute_hours check (last_minute_hours is null or last_minute_hours between 1 and 168),
  constraint booking_venues_last_minute_percent check (last_minute_percent between 0 and 90),
  constraint booking_venues_fee check (platform_fee_bps between 0 and 10000),
  constraint booking_venues_stripe_account check (stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]+$')
);

create table public.booking_locations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.booking_venues(id) on delete cascade,
  name text not null,
  address text,
  indoor boolean not null default true,
  -- sovelluksen pohjakartta (screens/booking/venueMaps.js), esim. 'lahti-janus'
  map_key text,
  -- reittiohjeet ja ulkokenttien sää
  lat double precision,
  lng double precision,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  constraint booking_locations_id_venue_key unique (id, venue_id),
  constraint booking_locations_coordinates check (
    (lat is null) = (lng is null) and (lat is null or (lat between -90 and 90 and lng between -180 and 180))
  )
);

create index booking_locations_venue_id_idx on public.booking_locations (venue_id, sort);

create table public.booking_courts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.booking_venues(id) on delete cascade,
  location_id uuid not null,
  name text not null,
  short_name text not null,
  sport text not null,
  surface text,
  -- kentän kohta toimipaikan pohjakartalla, esim. 'te1', 'sulka3'
  map_id text,
  sort integer not null default 0,
  -- false = poistettu käytöstä (kenttää ei poisteta, koska vanhat varaukset viittaavat siihen)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint booking_courts_sport check (sport in ('tennis', 'padel', 'sulkapallo', 'squash')),
  -- kentän toimipaikka kuuluu samaan halliin kuin kenttä
  constraint booking_courts_location_fk foreign key (location_id, venue_id)
    references public.booking_locations (id, venue_id) on delete cascade,
  constraint booking_courts_id_venue_key unique (id, venue_id)
);

create index booking_courts_venue_id_idx on public.booking_courts (venue_id, sport);
create index booking_courts_location_id_idx on public.booking_courts (location_id, sort);

create table public.booking_prices (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.booking_venues(id) on delete cascade,
  priority integer not null default 0,
  sports text[],
  court_ids uuid[],
  -- ISO-viikonpäivät, 1 = ma … 7 = su
  weekdays integer[] not null default '{1,2,3,4,5,6,7}',
  from_time time not null,
  -- '24:00' = keskiyöhön asti
  until_time time not null,
  cents_per_hour integer not null,
  created_at timestamptz not null default now(),
  constraint booking_prices_hours check (from_time < until_time),
  constraint booking_prices_cents check (cents_per_hour between 0 and 100000),
  constraint booking_prices_weekdays check (cardinality(weekdays) > 0 and weekdays <@ '{1,2,3,4,5,6,7}'::integer[]),
  constraint booking_prices_sports check (sports is null or (cardinality(sports) > 0 and sports <@ '{tennis,padel,sulkapallo,squash}'::text[])),
  constraint booking_prices_courts check (court_ids is null or cardinality(court_ids) > 0)
);

create index booking_prices_venue_id_idx on public.booking_prices (venue_id, priority desc);

create table public.booking_staff (
  venue_id uuid not null references public.booking_venues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (venue_id, user_id)
);

create index booking_staff_user_id_idx on public.booking_staff (user_id);

-- kind:   'booking' = pelaajan varaus, 'block' = hallin esto (valmennus, huolto),
--         'league' = liigan / hallisarjan vuoro
-- status: 'held' (maksamaton pito) → 'confirmed' | 'expired' | 'cancelled'
-- payment_status: 'unpaid' | 'paid' | 'refunded' | 'free' (hinta 0) | 'none' (estot)
create table public.booking_reservations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.booking_venues(id),
  court_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'booking',
  status text not null,
  booked_by uuid references public.profiles(id) on delete set null,
  title text,
  price_cents integer not null default 0,
  payment_status text not null default 'unpaid',
  hold_expires_at timestamptz,
  stripe_payment_intent_id text unique,
  stripe_refund_id text,
  league_id uuid references public.leagues(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid,
  -- vapautunut aika on käsitelty hälytysten osalta (krossi_booking_watchers_to_notify), kerran
  freed_notified_at timestamptz,
  constraint booking_reservations_court_fk foreign key (court_id, venue_id)
    references public.booking_courts (id, venue_id),
  constraint booking_reservations_time check (ends_at > starts_at),
  constraint booking_reservations_kind check (kind in ('booking', 'block', 'league')),
  constraint booking_reservations_status check (status in ('held', 'confirmed', 'cancelled', 'expired')),
  constraint booking_reservations_payment_status check (payment_status in ('unpaid', 'paid', 'refunded', 'free', 'none')),
  constraint booking_reservations_payment_matches_kind check ((kind = 'booking') = (payment_status <> 'none')),
  constraint booking_reservations_hold check (status <> 'held' or hold_expires_at is not null),
  constraint booking_reservations_price check (price_cents >= 0),
  constraint booking_reservations_title check (title is null or length(title) <= 80),
  -- THE double-booking guard: one live (held or confirmed) row per court and moment.
  constraint booking_reservations_no_overlap exclude using gist (
    court_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('held', 'confirmed'))
);

-- The calendar (day / staff_day / free courts) looks rows up by time range among live rows:
-- the exclusion constraint's GiST index (court_id, range) where status in (held, confirmed)
-- serves that, so the queries spell out the same status filter and range overlap.
create index booking_reservations_booked_by_idx on public.booking_reservations (booked_by, starts_at desc)
  where booked_by is not null;
create index booking_reservations_league_id_idx on public.booking_reservations (league_id)
  where league_id is not null;

-- "Ilmoita kun vapautuu": pelaaja haluaa tietää, kun lajin kenttä (tietyssä toimipaikassa tai
-- missä tahansa hallin toimipaikassa) vapautuu juuri tälle ajalle ja kestolle.
create table public.booking_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  venue_id uuid not null references public.booking_venues(id) on delete cascade,
  sport text not null,
  location_id uuid,
  starts_at timestamptz not null,
  minutes integer not null,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  constraint booking_watches_sport check (sport in ('tennis', 'padel', 'sulkapallo', 'squash')),
  constraint booking_watches_minutes check (minutes between 1 and 1440),
  constraint booking_watches_location_fk foreign key (location_id, venue_id)
    references public.booking_locations (id, venue_id) on delete cascade
);

create unique index booking_watches_unique_idx on public.booking_watches (
  user_id, venue_id, sport, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), starts_at, minutes
);
create index booking_watches_pending_idx on public.booking_watches (venue_id, sport, starts_at)
  where notified_at is null;

alter table public.booking_venues enable row level security;
alter table public.booking_locations enable row level security;
alter table public.booking_courts enable row level security;
alter table public.booking_prices enable row level security;
alter table public.booking_staff enable row level security;
alter table public.booking_reservations enable row level security;
alter table public.booking_watches enable row level security;

-- Asiakkaat lukevat hallin tiedot (vain alla olevien policyjen rajaamina); varauksiin,
-- hälytyksiin ja henkilökuntaan ei ole suoraa pääsyä. Stripe Connect -tili ja Krossin osuus
-- eivät näy.
revoke all on table public.booking_venues, public.booking_locations, public.booking_courts,
  public.booking_prices, public.booking_staff, public.booking_reservations, public.booking_watches
  from anon, authenticated;
grant select (id, slug, name, city, timezone, open_from, open_until, slot_minutes, durations, days_ahead,
  cancel_limit_hours, hold_minutes, last_minute_hours, last_minute_percent, is_public, created_at)
  on public.booking_venues to anon, authenticated;
grant select on table public.booking_locations, public.booking_courts, public.booking_prices to anon, authenticated;
grant all on table public.booking_venues, public.booking_locations, public.booking_courts,
  public.booking_prices, public.booking_staff, public.booking_reservations, public.booking_watches to service_role;


-- ── Apufunktiot ──────────────────────────────────────────────────────────────

-- Hallin henkilökuntaa: booking_staff-rivi tai Krossin ylläpitäjä (kaikki hallit).
create function public.krossi_booking_is_staff(venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
     and $1 is not null
     and (
       public.krossi_is_admin()
       or exists (
         select 1 from public.booking_staff s
         where s.venue_id = $1 and s.user_id = (select auth.uid())
       )
     );
$function$;

revoke all on function public.krossi_booking_is_staff(uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_is_staff(uuid) to authenticated, service_role;

-- Näkyykö halli kutsujalle: julkinen, tai kutsuja on sen henkilökuntaa.
create function public.krossi_booking_venue_visible(venue_id_input uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.booking_venues v
    where v.id = venue_id_input
      and (v.is_public or public.krossi_booking_is_staff(v.id))
  );
$function$;

revoke all on function public.krossi_booking_venue_visible(uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_venue_visible(uuid) to authenticated, service_role;

-- Aikaleima samassa muodossa kuin JS:n toISOString(): '2026-10-16T15:00:00.000Z'.
create function public.krossi_booking_iso(ts timestamptz)
returns text
language sql
stable
set search_path = ''
as $function$
  select to_char($1 at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$function$;

revoke all on function public.krossi_booking_iso(timestamptz) from public, anon, authenticated;


-- ── Hinta ────────────────────────────────────────────────────────────────────

-- Sisäinen: hinta sentteinä ilman alea, tai null kun aikaa ei voi varata (jollekin 30 minuutin
-- palalle ei ole hintasääntöä tai kenttä ei ole käytössä). Ei näkyvyystarkistusta.
create function public.krossi_booking_price_internal(court_id_input uuid, starts_at_input timestamptz, minutes_input integer)
returns integer
language sql
stable
set search_path = ''
as $function$
  with court as (
    select c.id, c.sport, c.venue_id, v.timezone
    from public.booking_courts c
    join public.booking_venues v on v.id = c.venue_id
    where c.id = court_id_input
      and c.is_active
  ),
  pieces as (
    select n, (starts_at_input + n * interval '30 minutes') at time zone court.timezone as local_at
    from court, generate_series(0, minutes_input / 30 - 1) as n
  ),
  priced as (
    select p.n, (
      select r.cents_per_hour
      from public.booking_prices r, court
      where r.venue_id = court.venue_id
        and (r.sports is null or court.sport = any (r.sports))
        and (r.court_ids is null or court.id = any (r.court_ids))
        and extract(isodow from p.local_at)::integer = any (r.weekdays)
        and p.local_at::time >= r.from_time
        and p.local_at::time < r.until_time
      order by r.priority desc, r.id
      limit 1
    ) as cents_per_hour
    from pieces p
  )
  select case
    when starts_at_input is null or minutes_input is null or minutes_input <= 0 or minutes_input > 1440
      or minutes_input % 30 <> 0 then null
    when not exists (select 1 from court) then null
    when exists (select 1 from priced where priced.cents_per_hour is null) then null
    else (select round(sum(priced.cents_per_hour)::numeric / 2)::integer from priced)
  end;
$function$;

revoke all on function public.krossi_booking_price_internal(uuid, timestamptz, integer) from public, anon, authenticated;

-- Varauksen hinta ilman viime hetken alea, tai null kun aikaa ei voi varata tai halli ei näy
-- kutsujalle.
create function public.krossi_booking_price(court_id uuid, starts_at timestamptz, minutes integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select public.krossi_booking_price_internal($1, $2, $3)
  where exists (
    select 1
    from public.booking_courts c
    join public.booking_venues v on v.id = c.venue_id
    where c.id = $1 and (v.is_public or public.krossi_booking_is_staff(v.id))
  );
$function$;

revoke all on function public.krossi_booking_price(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.krossi_booking_price(uuid, timestamptz, integer) to authenticated, service_role;

-- Sisäinen: ensimmäinen kenttä, jonka voi varata koko ajaksi [alku, alku + minuutit) — lajin
-- käytössä oleva kenttä (toimipaikassa, jos annettu), jolle on hinta ja jolla ei ole voimassa
-- olevaa varausta, pitoa tai estoa. Muuten null.
create function public.krossi_booking_free_court(
  venue_id_input uuid,
  sport_input text,
  location_id_input uuid,
  starts_at_input timestamptz,
  minutes_input integer
)
returns uuid
language sql
stable
set search_path = ''
as $function$
  select c.id
  from public.booking_courts c
  where c.venue_id = venue_id_input
    and c.sport = sport_input
    and c.is_active
    and (location_id_input is null or c.location_id = location_id_input)
    and public.krossi_booking_price_internal(c.id, starts_at_input, minutes_input) is not null
    and not exists (
      select 1 from public.booking_reservations r
      where r.court_id = c.id
        and r.status in ('held', 'confirmed')
        and tstzrange(r.starts_at, r.ends_at, '[)')
            && tstzrange(starts_at_input, starts_at_input + make_interval(mins => minutes_input), '[)')
        and (r.status = 'confirmed' or r.hold_expires_at > now())
    )
  order by c.sort, c.name, c.id
  limit 1;
$function$;

revoke all on function public.krossi_booking_free_court(uuid, text, uuid, timestamptz, integer) from public, anon, authenticated;


-- ── JSON-muodot (api/contract.js) ────────────────────────────────────────────

-- Booking: yksi pelaajan omista varauksista.
create function public.krossi_booking_json(r public.booking_reservations)
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
    'createdAt', public.krossi_booking_iso(r.created_at)
  )
  from public.booking_courts c
  join public.booking_locations l on l.id = c.location_id
  join public.booking_venues v on v.id = c.venue_id
  where c.id = r.court_id;
$function$;

revoke all on function public.krossi_booking_json(public.booking_reservations) from public, anon, authenticated;

-- BookingWatch
create function public.krossi_booking_watch_json(w public.booking_watches)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', w.id,
    'venueId', w.venue_id,
    'sport', w.sport,
    'locationId', w.location_id,
    'startsAt', public.krossi_booking_iso(w.starts_at),
    'minutes', w.minutes,
    'notifiedAt', public.krossi_booking_iso(w.notified_at),
    'createdAt', public.krossi_booking_iso(w.created_at)
  );
$function$;

revoke all on function public.krossi_booking_watch_json(public.booking_watches) from public, anon, authenticated;

-- BookingVenue: toimipaikat kenttineen (vain käytössä olevat kentät; toimipaikka ilman niitä
-- jätetään pois) ja hintasäännöt korkein prioriteetti ensin.
create function public.krossi_booking_venue_json(venue_id_input uuid)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', v.id,
    'slug', v.slug,
    'name', v.name,
    'city', v.city,
    'openFrom', to_char(v.open_from, 'HH24:MI'),
    'openUntil', to_char(v.open_until, 'HH24:MI'),
    'slotMinutes', v.slot_minutes,
    'durations', to_jsonb(v.durations),
    'daysAhead', v.days_ahead,
    'cancelLimitHours', v.cancel_limit_hours,
    'holdMinutes', v.hold_minutes,
    'payOnline', true,
    'lastMinute', case when v.last_minute_hours is not null and v.last_minute_percent > 0 then
      jsonb_build_object('hours', v.last_minute_hours, 'percent', v.last_minute_percent)
    end,
    'isStaff', public.krossi_booking_is_staff(v.id),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'name', l.name,
        'address', l.address,
        'indoor', l.indoor,
        'mapKey', l.map_key,
        'lat', l.lat,
        'lng', l.lng,
        'courts', (
          select jsonb_agg(jsonb_build_object(
            'id', c.id,
            'locationId', c.location_id,
            'name', c.name,
            'shortName', c.short_name,
            'sport', c.sport,
            'surface', c.surface,
            'mapId', c.map_id
          ) order by c.sort, c.name, c.id)
          from public.booking_courts c
          where c.location_id = l.id and c.is_active
        )
      ) order by l.sort, l.name, l.id)
      from public.booking_locations l
      where l.venue_id = v.id
        and exists (select 1 from public.booking_courts c where c.location_id = l.id and c.is_active)
    ), '[]'::jsonb),
    'prices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sports', to_jsonb(p.sports),
        'courtIds', to_jsonb(p.court_ids),
        'weekdays', to_jsonb(p.weekdays),
        'from', to_char(p.from_time, 'HH24:MI'),
        'until', to_char(p.until_time, 'HH24:MI'),
        'centsPerHour', p.cents_per_hour
      ) order by p.priority desc, p.id)
      from public.booking_prices p
      where p.venue_id = v.id
    ), '[]'::jsonb)
  )
  from public.booking_venues v
  where v.id = venue_id_input;
$function$;

revoke all on function public.krossi_booking_venue_json(uuid) from public, anon, authenticated;


-- ── Julkinen kalenteri (myös kirjautumaton) ──────────────────────────────────

-- BookingVenue[]: julkiset hallit + ne, joiden henkilökuntaa kutsuja on.
create function public.krossi_booking_venues()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(public.krossi_booking_venue_json(v.id) order by v.name, v.id), '[]'::jsonb)
  from public.booking_venues v
  where v.is_public or public.krossi_booking_is_staff(v.id);
$function$;

revoke all on function public.krossi_booking_venues() from public, anon, authenticated;
grant execute on function public.krossi_booking_venues() to anon, authenticated, service_role;

-- { date, busy: BookingBusy[] } hallin paikallisen päivän ajalta [00.00, seuraava 00.00):
-- vahvistetut rivit ja voimassa olevat pidot. Ei nimiä; otsikko vain estoille.
create function public.krossi_booking_day(venue_id_input uuid, day_input date)
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
        'mine', coalesce(r.kind = 'booking' and r.booked_by = v_uid, false),
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

revoke all on function public.krossi_booking_day(uuid, date) from public, anon, authenticated;
grant execute on function public.krossi_booking_day(uuid, date) to anon, authenticated, service_role;


-- ── Pelaajan varaukset ───────────────────────────────────────────────────────

-- Varaa kentän: pito hold_minutes minuutiksi (hinta 0 → vahvistuu heti). Palvelin hinnoittelee,
-- viime hetken ale mukaan lukien. Enintään kaksi voimassa olevaa pitoa per pelaaja.
create function public.krossi_hold_booking(court_id_input uuid, starts_at_input timestamptz, minutes_input integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_court public.booking_courts;
  v_venue public.booking_venues;
  v_local timestamp;
  v_end timestamptz;
  v_start_minute integer;
  v_end_minute integer;
  v_price integer;
  v_row public.booking_reservations;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Täytä ensin pelaajaprofiilisi.';
  end if;

  select * into v_court from public.booking_courts where id = court_id_input and is_active;
  if found then
    select * into v_venue from public.booking_venues where id = v_court.venue_id;
  end if;
  if v_court.id is null or not (v_venue.is_public or public.krossi_booking_is_staff(v_venue.id)) then
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
  if v_venue.last_minute_hours is not null and v_venue.last_minute_percent > 0
     and starts_at_input - now() < make_interval(hours => v_venue.last_minute_hours) then
    v_price := round(v_price::numeric * (100 - v_venue.last_minute_percent) / 100)::integer;
  end if;

  -- Yksi pito kerrallaan per pelaaja, jotta rinnakkaiset napautukset eivät ohita rajaa.
  perform pg_advisory_xact_lock(hashtextextended('krossi_booking_hold:' || v_uid::text, 0));
  if (
    select count(*) from public.booking_reservations r
    where r.booked_by = v_uid and r.status = 'held' and r.hold_expires_at > now()
  ) >= 2 then
    raise exception 'Sinulla on jo kaksi maksamatonta varausta. Maksa tai peru ne ensin.';
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
      payment_status, hold_expires_at, created_by
    ) values (
      v_venue.id, v_court.id, starts_at_input, v_end, 'booking',
      case when v_price = 0 then 'confirmed' else 'held' end,
      v_uid, v_price,
      case when v_price = 0 then 'free' else 'unpaid' end,
      case when v_price = 0 then null else now() + make_interval(mins => v_venue.hold_minutes) end,
      v_uid
    )
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'Joku ehti varata tämän ajan juuri ennen sinua. Valitse toinen aika.';
  end;

  return public.krossi_booking_json(v_row);
end;
$function$;

revoke all on function public.krossi_hold_booking(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.krossi_hold_booking(uuid, timestamptz, integer) to authenticated, service_role;

-- Pelaaja perääntyy ennen maksua: oma maksamaton pito vapautuu. Muut tilat: ei mitään.
-- (Sovellus kutsuu tämän jälkeen krossi-bookingin 'freed'-toimintoa hälytyksiä varten.)
create function public.krossi_release_booking(booking_id_input uuid)
returns void
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
  if not exists (
    select 1 from public.booking_reservations
    where id = booking_id_input and booked_by = v_uid and kind = 'booking'
  ) then
    raise exception 'Varausta ei löytynyt.';
  end if;

  update public.booking_reservations
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid
   where id = booking_id_input
     and booked_by = v_uid
     and status = 'held'
     and payment_status = 'unpaid';
end;
$function$;

revoke all on function public.krossi_release_booking(uuid) from public, anon, authenticated;
grant execute on function public.krossi_release_booking(uuid) to authenticated, service_role;

-- { upcoming, past }: tulevat = vahvistetut ja voimassa olevat pidot, jotka eivät ole vielä
-- päättyneet (lähin ensin); menneet = kaikki muut (myös perutut ja vanhentuneet), uusin
-- ensin, enintään 30.
create function public.krossi_my_bookings()
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

  return jsonb_build_object(
    'upcoming', coalesce((
      select jsonb_agg(public.krossi_booking_json(r) order by r.starts_at, r.id)
      from public.booking_reservations r
      where r.booked_by = v_uid
        and r.kind = 'booking'
        and r.ends_at > now()
        and (r.status = 'confirmed' or (r.status = 'held' and r.hold_expires_at > now()))
    ), '[]'::jsonb),
    'past', coalesce((
      select jsonb_agg(public.krossi_booking_json(x.r) order by (x.r).starts_at desc, (x.r).id)
      from (
        select r
        from public.booking_reservations r
        where r.booked_by = v_uid
          and r.kind = 'booking'
          and not (r.ends_at > now() and (r.status = 'confirmed' or (r.status = 'held' and r.hold_expires_at > now())))
        order by r.starts_at desc, r.id
        limit 30
      ) x
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.krossi_my_bookings() from public, anon, authenticated;
grant execute on function public.krossi_my_bookings() to authenticated, service_role;


-- ── Ilmoita kun vapautuu ─────────────────────────────────────────────────────

-- Hälytys täyteen aikaan. Sama aika uudelleen palauttaa olemassa olevan hälytyksen (jo
-- ilmoitettu hälytys virittyy uudelleen, jos aika on taas täynnä). Jos jokin kenttä on jo
-- vapaana: 'Aika on vapaana — varaa se heti.' Enintään 5 tulevaa hälytystä per pelaaja.
create function public.krossi_booking_watch(
  venue_id_input uuid,
  sport_input text,
  location_id_input uuid,
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
  v_venue public.booking_venues;
  v_local timestamp;
  v_start_minute integer;
  v_end_minute integer;
  v_watch public.booking_watches;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Täytä ensin pelaajaprofiilisi.';
  end if;

  select * into v_venue from public.booking_venues where id = venue_id_input;
  if not found or not (v_venue.is_public or public.krossi_booking_is_staff(v_venue.id)) then
    raise exception 'Hallia ei löytynyt.';
  end if;
  if minutes_input is null or not (minutes_input = any (v_venue.durations)) then
    raise exception 'Valitse varauksen kesto.';
  end if;
  if starts_at_input is null then
    raise exception 'Valitse aika kalenterista.';
  end if;
  if starts_at_input <= now() then
    raise exception 'Tämä aika on jo mennyt.';
  end if;
  if not exists (
    select 1 from public.booking_courts c
    where c.venue_id = v_venue.id
      and c.sport = sport_input
      and c.is_active
      and (location_id_input is null or c.location_id = location_id_input)
  ) then
    raise exception 'Kenttää ei löytynyt.';
  end if;

  v_local := starts_at_input at time zone v_venue.timezone;
  v_start_minute := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  if extract(second from v_local) <> 0 or v_start_minute % v_venue.slot_minutes <> 0 then
    raise exception 'Valitse aika kalenterista.';
  end if;
  if v_local::date > (now() at time zone v_venue.timezone)::date + v_venue.days_ahead then
    raise exception 'Vuoroja voi varata % päivän päähän.', v_venue.days_ahead;
  end if;
  v_end_minute := (extract(epoch from (((starts_at_input + make_interval(mins => minutes_input)) at time zone v_venue.timezone)
    - v_local::date::timestamp)) / 60)::integer;
  if v_start_minute < (extract(epoch from v_venue.open_from) / 60)::integer
     or v_end_minute > (extract(epoch from v_venue.open_until) / 60)::integer then
    raise exception 'Kenttä on suljettu tähän aikaan.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('krossi_booking_watch:' || v_uid::text, 0));

  select * into v_watch
  from public.booking_watches w
  where w.user_id = v_uid
    and w.venue_id = v_venue.id
    and w.sport = sport_input
    and w.location_id is not distinct from location_id_input
    and w.starts_at = starts_at_input
    and w.minutes = minutes_input;
  if found and v_watch.notified_at is null then
    return public.krossi_booking_watch_json(v_watch);
  end if;

  if not exists (
    select 1 from public.booking_courts c
    where c.venue_id = v_venue.id
      and c.sport = sport_input
      and c.is_active
      and (location_id_input is null or c.location_id = location_id_input)
      and public.krossi_booking_price_internal(c.id, starts_at_input, minutes_input) is not null
  ) then
    raise exception 'Kenttä on suljettu tähän aikaan.';
  end if;
  if public.krossi_booking_free_court(v_venue.id, sport_input, location_id_input, starts_at_input, minutes_input) is not null then
    raise exception 'Aika on vapaana — varaa se heti.';
  end if;

  if v_watch.id is not null then
    update public.booking_watches set notified_at = null where id = v_watch.id
    returning * into v_watch;
    return public.krossi_booking_watch_json(v_watch);
  end if;

  if (select count(*) from public.booking_watches w where w.user_id = v_uid and w.starts_at > now()) >= 5 then
    raise exception 'Sinulla on jo 5 hälytystä. Poista jokin ensin.';
  end if;

  insert into public.booking_watches (user_id, venue_id, sport, location_id, starts_at, minutes)
  values (v_uid, v_venue.id, sport_input, location_id_input, starts_at_input, minutes_input)
  returning * into v_watch;
  return public.krossi_booking_watch_json(v_watch);
end;
$function$;

revoke all on function public.krossi_booking_watch(uuid, text, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.krossi_booking_watch(uuid, text, uuid, timestamptz, integer) to authenticated, service_role;

-- Poistaa oman hälytyksen (muiden tai tuntemattomien kohdalla ei tee mitään).
create function public.krossi_booking_unwatch(watch_id_input uuid)
returns void
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
  delete from public.booking_watches where id = watch_id_input and user_id = v_uid;
end;
$function$;

revoke all on function public.krossi_booking_unwatch(uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_unwatch(uuid) to authenticated, service_role;

-- BookingWatch[]: omat hälytykset, joiden aika on vielä edessä, lähin ensin.
create function public.krossi_booking_my_watches()
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
    select jsonb_agg(public.krossi_booking_watch_json(w) order by w.starts_at, w.created_at, w.id)
    from public.booking_watches w
    where w.user_id = v_uid and w.starts_at > now()
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.krossi_booking_my_watches() from public, anon, authenticated;
grant execute on function public.krossi_booking_my_watches() to authenticated, service_role;

-- Vain service_role (krossi-booking): varaus/esto on vapautunut (peruttu tai vanhentunut).
-- Käsittelee rivin vain kerran (freed_notified_at) ja palauttaa hälytykset, joista pitää nyt
-- ilmoittaa: saman hallin ja lajin (ja toimipaikan, jos hälytyksessä on sellainen) tulevat,
-- vielä ilmoittamattomat hälytykset muilta kuin vapauttajalta, joiden aika on nyt kokonaan
-- vapaana ainakin yhdellä kentällä. Merkitsee ne ilmoitetuiksi (notified_at), joten kukin
-- hälytys palautuu vain kerran. Muoto: BookingWatch + userId.
create function public.krossi_booking_watchers_to_notify(reservation_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
  v_court public.booking_courts;
  v_watch public.booking_watches;
  v_out jsonb := '[]'::jsonb;
begin
  update public.booking_reservations
     set freed_notified_at = now()
   where id = reservation_id_input
     and freed_notified_at is null
     and (status in ('cancelled', 'expired') or (status = 'held' and hold_expires_at <= now()))
  returning * into v_row;
  if not found then
    return v_out;
  end if;
  select * into v_court from public.booking_courts where id = v_row.court_id;

  for v_watch in
    select w.*
    from public.booking_watches w
    where w.venue_id = v_row.venue_id
      and w.sport = v_court.sport
      and (w.location_id is null or w.location_id = v_court.location_id)
      and w.notified_at is null
      and w.starts_at > now()
      and w.user_id is distinct from v_row.booked_by
      and w.user_id is distinct from v_row.cancelled_by
      and public.krossi_booking_free_court(w.venue_id, w.sport, w.location_id, w.starts_at, w.minutes) is not null
    order by w.starts_at, w.created_at, w.id
    for update of w skip locked
  loop
    update public.booking_watches set notified_at = now() where id = v_watch.id
    returning * into v_watch;
    v_out := v_out || jsonb_build_array(
      public.krossi_booking_watch_json(v_watch) || jsonb_build_object('userId', v_watch.user_id)
    );
  end loop;
  return v_out;
end;
$function$;

revoke all on function public.krossi_booking_watchers_to_notify(uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_watchers_to_notify(uuid) to service_role;


-- ── Hallin henkilökunta ──────────────────────────────────────────────────────

-- StaffItem[]: päivän kaikki voimassa olevat rivit nimineen (bookedBy rakennetaan kuten
-- sovelluksen map.js:n PersonLite; avatarUrl on tallennuspolku, sovellus tekee siitä URL:n).
create function public.krossi_booking_staff_day(venue_id_input uuid, day_input date)
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
      'title', case when r.kind = 'booking' then null else r.title end,
      'bookedBy', case when r.kind = 'booking' and r.booked_by is not null then jsonb_build_object(
        'id', r.booked_by,
        'name', coalesce(nullif(btrim(p.name), ''), 'Pelaaja'),
        'avatarUrl', p.avatar_url,
        'avatarColor', coalesce(p.avatar_color, 'blue'),
        'ageRange', p.age,
        -- '' = pelaajalla on tennis_preferences-rivi ilman tasoa; null = ei riviä
        'skillLevel', tp.skill_level
      ) end,
      'priceCents', r.price_cents,
      'paymentStatus', r.payment_status
    ) order by r.starts_at, c.sort, c.name, r.id)
    from public.booking_reservations r
    join public.booking_courts c on c.id = r.court_id
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

revoke all on function public.krossi_booking_staff_day(uuid, date) from public, anon, authenticated;
grant execute on function public.krossi_booking_staff_day(uuid, date) to authenticated, service_role;

-- Esto (kind 'block') tai liigavuoro (kind 'league') yhdelle tai useammalle saman hallin
-- kentälle. Kaikki tai ei mitään: jos yksikin kenttä on varattu, mitään ei lisätä.
-- Palauttaa uudet id:t kenttien järjestyksessä.
create function public.krossi_booking_block(
  court_ids_input uuid[],
  starts_at_input timestamptz,
  ends_at_input timestamptz,
  title_input text,
  kind_input text
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_ids uuid[];
  v_venue_id uuid;
  v_kind text := coalesce(nullif(btrim(kind_input), ''), 'block');
  v_title text := left(btrim(coalesce(title_input, '')), 80);
  v_out uuid[];
begin
  -- kentät annetussa järjestyksessä, kukin kerran
  select array_agg(u.court_id order by u.first_at)
    into v_ids
  from (
    select t.x as court_id, min(t.ord) as first_at
    from unnest(coalesce(court_ids_input, '{}'::uuid[])) with ordinality as t(x, ord)
    where t.x is not null
    group by t.x
  ) u;
  if v_ids is null then
    raise exception 'Valitse ainakin yksi kenttä.';
  end if;

  select c.venue_id into v_venue_id from public.booking_courts c where c.id = v_ids[1];
  if v_venue_id is null or not public.krossi_booking_is_staff(v_venue_id) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;
  if v_kind not in ('block', 'league') then
    raise exception 'Tuntematon varauksen tyyppi.';
  end if;
  if starts_at_input is null or ends_at_input is null or ends_at_input <= starts_at_input then
    raise exception 'Loppuajan pitää olla alun jälkeen.';
  end if;
  if v_title = '' then
    raise exception 'Anna esteelle nimi, esim. "Hallisarja".';
  end if;
  if exists (
    select 1 from unnest(v_ids) as t(x)
    where not exists (select 1 from public.booking_courts c where c.id = t.x and c.venue_id = v_venue_id)
  ) then
    raise exception 'Kenttää ei löytynyt.';
  end if;

  update public.booking_reservations r
     set status = 'expired'
   where r.court_id = any (v_ids)
     and r.status = 'held'
     and r.hold_expires_at <= now()
     and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(starts_at_input, ends_at_input, '[)');

  begin
    with inserted as (
      insert into public.booking_reservations (
        venue_id, court_id, starts_at, ends_at, kind, status, title, price_cents, payment_status, created_by
      )
      select v_venue_id, t.x, starts_at_input, ends_at_input, v_kind, 'confirmed', v_title, 0, 'none', v_uid
      from unnest(v_ids) as t(x)
      returning id, court_id
    )
    select array_agg(i.id order by array_position(v_ids, i.court_id)) into v_out from inserted i;
  exception when exclusion_violation then
    raise exception 'Aika ei ole vapaa kaikilla valituilla kentillä.';
  end;

  return v_out;
end;
$function$;

revoke all on function public.krossi_booking_block(uuid[], timestamptz, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.krossi_booking_block(uuid[], timestamptz, timestamptz, text, text) to authenticated, service_role;

-- Poistaa eston / liigavuoron (rivi jää historiaan tilassa 'cancelled').
-- (Sovellus kutsuu tämän jälkeen krossi-bookingin 'freed'-toimintoa hälytyksiä varten.)
create function public.krossi_booking_unblock(block_id_input uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
begin
  select * into v_row
  from public.booking_reservations
  where id = block_id_input and kind in ('block', 'league');
  if not found then
    raise exception 'Estoa ei löytynyt.';
  end if;
  if not public.krossi_booking_is_staff(v_row.venue_id) then
    raise exception 'Vain hallin henkilökunta voi tehdä tämän.';
  end if;

  update public.booking_reservations
     set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid())
   where id = v_row.id
     and status in ('held', 'confirmed');
end;
$function$;

revoke all on function public.krossi_booking_unblock(uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_unblock(uuid) to authenticated, service_role;


-- ── Maksut (vain service_role: krossi-booking ja stripe-webhook) ─────────────

-- Stripe sanoo maksun onnistuneen. Palauttaa:
--   'confirmed'  varaus on nyt vahvistettu ja maksettu (myös toistokutsulla samalla maksulla)
--   'lost'       pito ehti vanhentua ja aika meni toiselle, aika on jo alkanut tai halli perui
--                pidon → kutsuja palauttaa maksun ja kutsuu krossi_booking_mark_cancelled
--   'duplicate'  varaus oli jo maksettu toisella maksulla (tai ilmainen) → kutsuja palauttaa
--                tämän maksun; varaukseen ei kosketa
--   'cancelled'  tämä maksu on jo käsitelty ja varaus on sen jälkeen peruttu → ei tehtävää
-- Vanhentunut (tai pelaajan itse vapauttama) pito vahvistetaan, jos kenttä on yhä vapaa.
-- 'lost' jättää rivin tilaan 'cancelled' maksun tunnisteen kanssa, joten uusintakutsu
-- päätyy samaan lopputulokseen eikä voi enää vahvistaa varausta.
create function public.krossi_booking_mark_paid(booking_id_input uuid, payment_intent_id_input text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
  v_intent text := nullif(btrim(coalesce(payment_intent_id_input, '')), '');
begin
  if v_intent is null then
    raise exception 'Maksun tunniste puuttuu.';
  end if;
  select * into v_row from public.booking_reservations where id = booking_id_input for update;
  if not found or v_row.kind <> 'booking' then
    raise exception 'Varausta ei löytynyt.';
  end if;

  if v_row.payment_status <> 'unpaid' then
    if v_row.payment_status = 'free' or v_row.stripe_payment_intent_id is distinct from v_intent then
      return 'duplicate';
    end if;
    return case when v_row.status = 'confirmed' then 'confirmed' else 'cancelled' end;
  end if;

  -- Pito on yhä voimassa (tai vanhentunut, mutta kukaan ei ole vienyt aikaa): vahvista.
  if v_row.status in ('held', 'confirmed') then
    update public.booking_reservations
       set status = 'confirmed', payment_status = 'paid', stripe_payment_intent_id = v_intent,
           hold_expires_at = null
     where id = v_row.id;
    return 'confirmed';
  end if;

  -- Pito vanheni tai pelaaja vapautti sen ennen kuin maksu ehti perille: otetaan kenttä
  -- takaisin, jos se on yhä vapaa eikä aika ole alkanut.
  if v_row.starts_at > now()
     and (v_row.status = 'expired'
          or (v_row.status = 'cancelled' and v_row.cancelled_by is not null and v_row.cancelled_by = v_row.booked_by)) then
    update public.booking_reservations r
       set status = 'expired'
     where r.court_id = v_row.court_id
       and r.status = 'held'
       and r.hold_expires_at <= now()
       and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(v_row.starts_at, v_row.ends_at, '[)');
    begin
      update public.booking_reservations
         set status = 'confirmed', payment_status = 'paid', stripe_payment_intent_id = v_intent,
             hold_expires_at = null, cancelled_at = null, cancelled_by = null
       where id = v_row.id;
      return 'confirmed';
    exception when exclusion_violation then
      null; -- joku muu ehti varata kentän
    end;
  end if;

  update public.booking_reservations
     set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), stripe_payment_intent_id = v_intent
   where id = v_row.id;
  return 'lost';
end;
$function$;

revoke all on function public.krossi_booking_mark_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.krossi_booking_mark_paid(uuid, text) to service_role;

-- Kirjaa peruutuksen (pelaaja, henkilökunta tai menetetty aika). refunded_input = maksu on
-- palautettu (refund_id_input = Stripen refund id). Ensimmäinen peruja ja -aika säilyvät.
create function public.krossi_booking_mark_cancelled(
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
begin
  update public.booking_reservations
     set status = 'cancelled',
         cancelled_at = coalesce(cancelled_at, now()),
         cancelled_by = coalesce(cancelled_by, by_input),
         payment_status = case
           when coalesce(refunded_input, false) and payment_status in ('paid', 'unpaid') then 'refunded'
           else payment_status
         end,
         stripe_refund_id = coalesce(nullif(btrim(coalesce(refund_id_input, '')), ''), stripe_refund_id)
   where id = booking_id_input
     and kind = 'booking';
  if not found then
    raise exception 'Varausta ei löytynyt.';
  end if;
end;
$function$;

revoke all on function public.krossi_booking_mark_cancelled(uuid, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_mark_cancelled(uuid, boolean, text, uuid) to service_role;


-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Vain lukuoikeus hallin tietoihin: julkiset hallit kaikille, piilotetut vain henkilökunnalle.
-- Kirjautumattoman policyt eivät kutsu funktioita (anon saa suorittaa vain venues/day).
-- booking_staff, booking_reservations ja booking_watches: ei policyja → ei suoraa pääsyä.

create policy "booking venues: public" on public.booking_venues
  for select to anon
  using (is_public);

create policy "booking venues: public or own hall" on public.booking_venues
  for select to authenticated
  using (is_public or public.krossi_booking_is_staff(id));

create policy "booking locations: public" on public.booking_locations
  for select to anon
  using (exists (select 1 from public.booking_venues v where v.id = booking_locations.venue_id and v.is_public));

create policy "booking locations: public or own hall" on public.booking_locations
  for select to authenticated
  using (public.krossi_booking_venue_visible(venue_id));

create policy "booking courts: public" on public.booking_courts
  for select to anon
  using (exists (select 1 from public.booking_venues v where v.id = booking_courts.venue_id and v.is_public));

create policy "booking courts: public or own hall" on public.booking_courts
  for select to authenticated
  using (public.krossi_booking_venue_visible(venue_id));

create policy "booking prices: public" on public.booking_prices
  for select to anon
  using (exists (select 1 from public.booking_venues v where v.id = booking_prices.venue_id and v.is_public));

create policy "booking prices: public or own hall" on public.booking_prices
  for select to authenticated
  using (public.krossi_booking_venue_visible(venue_id));
