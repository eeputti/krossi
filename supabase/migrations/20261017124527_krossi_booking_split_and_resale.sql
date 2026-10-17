-- Krossi: kenttävaraus, vaihe 4 — jaettu maksu ja myöhään peruttu vuoro myyntiin.
--
-- Jaettu maksu: varaaja maksaa aina koko vuoron itse, millä tahansa maksutavalla (myös
-- MobilePaylla). Maksettuaan hän voi jakaa maksun 2 tai 4 pelaajan kesken (krossi_split_booking):
-- syntyy pelaajat − 1 kaverin osuutta, kukin floor(hinta / pelaajat) senttiä (pariton sentti
-- jää varaajalle), ja yksi salainen linkki koko porukalle (/pelaa/maksa/<token>). Kaveri maksaa
-- osuutensa linkistä ilman Krossi-tiliä (krossi-booking splitConfig / splitIntent / splitVerify ja
-- stripe-webhook). Maksun aloitus varaa yhden avoimen osuuden 15 minuutiksi, jotta kaksi yhtä
-- aikaa maksavaa eivät maksa samaa osuutta. Kun kaverin maksu onnistuu, sama summa palautetaan
-- varaajan maksusta (osittainen palautus). Halli saa koko hinnan heti varattaessa, eikä kenenkään
-- tarvitse muistaa maksuaikaa.
--
-- Laita myyntiin: maksuttoman peruutusajan jälkeen varaaja voi laittaa vuoron myyntiin
-- (listed_at). Myynnissä oleva vuoro ei estä uutta varausta, joka kattaa sen kokonaan (ei viime
-- hetken alea). Kun sellainen varaus vahvistuu, myyty vuoro perutaan samassa transaktiossa.
-- Osittain päällekkäinen varaus ei käy, eikä myyjä voi ostaa omaansa. Myynti ilmoittaa vuoroa
-- odottaville ("Ilmoita kun vapautuu") samalla tavalla kuin peruttu vuoro.
--
-- Peruutus ennen peruutusrajaa tai myyty vuoro palauttaa kaiken: varaajalle sen, mitä hänen
-- maksustaan on vielä palauttamatta, ja jokaiselle osuutensa maksaneelle kaverille hänen maksunsa
-- (krossi-booking / stripe-webhook; refund_due_at ja krossi-booking-cron viimeistelevät kesken
-- jääneet palautukset).
--
-- Vaihe 2 (sarja- ja lahjakortit): jakaa voi vain vuoron, jonka koko hinta on maksettu
-- verkkomaksuna (ei sarjakorttia, lahjakorttia eikä lahjakorttisaldon osuutta). Myynnissä olevan
-- vuoron saa ostaa myös sarjakortilla tai lahjakorttisaldolla; myydyn tai perutun vuoron
-- sarjakortin minuutit ja lahjakorttiosuus palautuvat heti, korttimaksut Stripen kautta.
--
-- Court booking phase 4 for Krossi (krossi.app/pelaa). Additive on top of
-- 20261016074110_krossi_court_booking and phase 2's 20261016100000_krossi_booking_seasons_billing_wallet
-- (it needs both; it comes after 20261016120000_krossi_booking_hall_settings, which touches none of the
-- same functions or tables): new columns, the booking_shares table and new versions of the booking
-- functions. The functions phase 2 replaced (krossi_booking_json, _day, _staff_day, _mark_paid)
-- are based on its versions here, and two of its wallet functions (krossi_wallet_pay_booking,
-- _use_gift) take over an on-sale booking like a card payment. Nothing outside the booking tables
-- changes, so Koutsi is unaffected.
--
--   booking_venues.split_pay / .resale    the hall's switches (both on by default)
--   booking_shares                        a friend's share of a split booking
--   krossi_hold_booking                   + buying an on-sale booking (same signature as phase 1)
--   krossi_split_booking(id, parts)       split a paid booking (2 / 4), change it, or remove it (1)
--   krossi_split_public(token)            the public pay page (anon)
--   krossi_booking_put_on_sale(id) / _take_off_sale(id)
--   service_role: _mark_paid (+ takes over sales), krossi_split_claim / _attach / _mark_paid /
--                 _booker_refunded / _refunds_due, krossi_booking_cancel, _paid_parts,
--                 _parts_refunded, _resold_by, _refunds_due
--   vaihe 2:      krossi_wallet_pay_booking and _use_gift (buying an on-sale booking)


-- ── Taulut ───────────────────────────────────────────────────────────────────

-- Hallin valinnat: saako vuoron maksun jakaa kavereiden kesken ja saako myöhään perutun vuoron
-- laittaa myyntiin.
alter table public.booking_venues
  add column split_pay boolean not null default true,
  add column resale boolean not null default true;

grant select (split_pay, resale) on public.booking_venues to anon, authenticated;

alter table public.booking_reservations
  -- milloin varaajan maksu onnistui
  add column paid_at timestamptz,
  -- jaettu maksu: pelaajat varaaja mukaan lukien (2 / 4), kaverin osuus sentteinä ja porukan
  -- salainen maksulinkki (kaikki null = ei jaettu)
  add column split_parts integer,
  add column split_cents integer,
  add column split_token text,
  -- "Laita myyntiin": milloin vuoro laitettiin myyntiin (null = ei myynnissä) ja milloin
  -- odottajille kerrottiin siitä (kerran per myyntiin laitto)
  add column listed_at timestamptz,
  add column sale_notified_at timestamptz,
  -- myynnissä ollut vuoro meni tälle varaukselle
  add column resold_by uuid references public.booking_reservations(id) on delete set null,
  add column resold_at timestamptz,
  -- peruttu tai myyty vuoro, jonka maksuja ei ole vielä kaikkia palautettu
  add column refund_due_at timestamptz,
  add constraint booking_reservations_split check (
    (split_parts is null and split_cents is null and split_token is null)
    or coalesce(kind = 'booking' and split_parts in (2, 4) and split_cents >= 50
        and split_cents * split_parts <= price_cents
        and split_token ~ '^[A-Za-z0-9_-]{22,64}$', false)
  ),
  add constraint booking_reservations_listed check (listed_at is null or kind = 'booking'),
  add constraint booking_reservations_resold check ((resold_by is null) = (resold_at is null));

-- Päällekkäisyyden esto ei koske myynnissä olevia vuoroja: varaus, joka kattaa sellaisen
-- kokonaan, saa ottaa sen. Kattamisen tarkistavat krossi_hold_booking ja _mark_paid; myyjän
-- "Peru myynti" palauttaa vuoron rajoitteen piiriin (ja epäonnistuu, jos ostaja on jo maksamassa).
alter table public.booking_reservations
  drop constraint booking_reservations_no_overlap,
  add constraint booking_reservations_no_overlap exclude using gist (
    court_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('held', 'confirmed') and listed_at is null);

-- Kalenterin haut (päivä, vapaat kentät) etsivät voimassa olevia rivejä aikavälin mukaan; tämä
-- palvelee niitä nyt, kun rajoitteen indeksi ei enää kata myynnissä olevia.
create index booking_reservations_live_idx on public.booking_reservations
  using gist (court_id, tstzrange(starts_at, ends_at, '[)'))
  where status in ('held', 'confirmed');
create unique index booking_reservations_split_token_idx on public.booking_reservations (split_token)
  where split_token is not null;
create index booking_reservations_refund_due_idx on public.booking_reservations (refund_due_at)
  where refund_due_at is not null;
create index booking_reservations_resold_by_idx on public.booking_reservations (resold_by)
  where resold_by is not null;

-- Kaverin osuus jaetusta vuorosta: pelaajat − 1 riviä (position 1, 2, 3).
-- status: 'open'     maksamatta
--         'pending'  joku maksaa sitä nyt (claim_id; osuus on hänen claim_expires_at asti, sen
--                    jälkeen taas avoin)
--         'paid'     maksettu; sama summa palautetaan varaajan maksusta (booker_refunded_at)
--         'refunded' kaverin maksu palautettiin hänelle (vuoro peruttiin tai myytiin)
create table public.booking_shares (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.booking_reservations(id) on delete cascade,
  position integer not null,
  cents integer not null,
  status text not null default 'open',
  -- maksun aloitus: mikä kerta, mihin asti osuus on maksajan, ja kuka maksaa (nimi, jonka kaveri
  -- antoi, tai kirjautuneen pelaajan profiilin nimi)
  claim_id uuid,
  claim_expires_at timestamptz,
  payer_name text,
  payer_user_id uuid references public.profiles(id) on delete set null,
  stripe_payment_intent_id text unique,
  paid_at timestamptz,
  -- osuuden summa palautettiin varaajan maksusta
  booker_refund_id text,
  booker_refunded_at timestamptz,
  -- kaverin oma maksu palautettiin hänelle
  stripe_refund_id text,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint booking_shares_status check (status in ('open', 'pending', 'paid', 'refunded')),
  constraint booking_shares_cents check (cents >= 50),
  constraint booking_shares_position check (position between 1 and 3),
  constraint booking_shares_pending check (status <> 'pending' or (claim_id is not null and claim_expires_at is not null)),
  constraint booking_shares_paid check (
    status not in ('paid', 'refunded') or (paid_at is not null and stripe_payment_intent_id is not null)
  ),
  constraint booking_shares_payer_name check (payer_name is null or length(payer_name) between 1 and 40)
);

create unique index booking_shares_position_idx on public.booking_shares (reservation_id, position);
create index booking_shares_booker_refund_idx on public.booking_shares (paid_at)
  where status = 'paid' and booker_refunded_at is null;

alter table public.booking_shares enable row level security;
revoke all on table public.booking_shares from anon, authenticated;
grant all on table public.booking_shares to service_role;


-- ── Apufunktiot ──────────────────────────────────────────────────────────────

-- Etunimi ("Mikko"), 'Pelaaja' kun nimeä ei ole.
create function public.krossi_booking_first_name(user_id_input uuid)
returns text
language sql
stable
set search_path = ''
as $function$
  select coalesce((
    select nullif(split_part(regexp_replace(btrim(p.name), '\s+', ' ', 'g'), ' ', 1), '')
    from public.profiles p where p.id = user_id_input
  ), 'Pelaaja');
$function$;

revoke all on function public.krossi_booking_first_name(uuid) from public, anon, authenticated;

-- Sisäinen (vaihe 2): perutun tai myydyn maksetun varauksen sarjakortin minuutit tai
-- lahjakorttiosuus takaisin (kuten krossi_booking_mark_cancelled). why_input aloittaa historian
-- rivin: 'Peruttu' / 'Myyty'.
create function public.krossi_booking_return_credit(r public.booking_reservations, why_input text)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  if r.payment_status not in ('paid', 'credit') or r.booked_by is null then
    return;
  end if;
  if r.pass_id is not null and r.pass_minutes > 0 then
    update public.booking_passes set minutes_left = least(minutes_total, minutes_left + r.pass_minutes)
     where id = r.pass_id;
    insert into public.booking_credit_events (venue_id, user_id, kind, pass_id, booking_id, minutes, label)
    values (r.venue_id, r.booked_by, 'refund', r.pass_id, r.id, r.pass_minutes, why_input || ': ' || public.krossi_booking_label(r));
  elsif r.gift_cents > 0 then
    insert into public.booking_credit_events (venue_id, user_id, kind, booking_id, cents, label)
    values (r.venue_id, r.booked_by, 'refund', r.id, r.gift_cents, why_input || ': ' || public.krossi_booking_label(r));
  end if;
end;
$function$;

revoke all on function public.krossi_booking_return_credit(public.booking_reservations, text) from public, anon, authenticated;

-- Uusi salainen maksulinkin tunniste: 24 url-turvallista merkkiä (138 satunnaista bittiä,
-- gen_random_uuid käyttää vahvaa satunnaislähdettä).
create function public.krossi_split_token()
returns text
language sql
volatile
set search_path = ''
as $function$
  select translate(
    encode(substring(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()) from 1 for 18), 'base64'),
    '+/', '-_'
  );
$function$;

revoke all on function public.krossi_split_token() from public, anon, authenticated;

-- Maksajan nimi siistinä (välit yhdeksi, ohjausmerkit pois, enintään 40 merkkiä) tai null.
create function public.krossi_split_clean_name(name_input text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select nullif(btrim(left(btrim(regexp_replace(regexp_replace(coalesce(name_input, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), 40)), '');
$function$;

revoke all on function public.krossi_split_clean_name(text) from public, anon, authenticated;

-- Kuka maksaa: kirjautuneen pelaajan profiili (sen nimi voittaa) tai annettu nimi.
create function public.krossi_split_payer(name_input text, user_id_input uuid)
returns table (payer_name text, payer_user_id uuid)
language sql
stable
set search_path = ''
as $function$
  select coalesce(public.krossi_split_clean_name(p.name), public.krossi_split_clean_name(name_input)), p.id
  from (select 1) one
  left join public.profiles p on p.id = user_id_input;
$function$;

revoke all on function public.krossi_split_payer(text, uuid) from public, anon, authenticated;

-- Osuuden tila nyt: vanhentunut maksun aloitus on taas avoin osuus.
create function public.krossi_split_share_state(s public.booking_shares)
returns text
language sql
stable
set search_path = ''
as $function$
  select case when s.status = 'pending' and s.claim_expires_at <= now() then 'open' else s.status end;
$function$;

revoke all on function public.krossi_split_share_state(public.booking_shares) from public, anon, authenticated;


-- ── JSON-muodot (api/contract.js) ────────────────────────────────────────────

-- BookingSplit tai null: { parts, perCents, token (vain varaajalle), lines } — varaajan oma osa
-- ('own') ensin, sitten kaverien osuudet. Kaverin nimi näkyy, kun hän maksaa tai on maksanut;
-- person vain kirjautuneena maksaneelle.
create function public.krossi_booking_split_json(r public.booking_reservations)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when r.split_parts is null then null else jsonb_build_object(
    'parts', r.split_parts,
    'perCents', r.split_cents,
    'token', case when r.booked_by = (select auth.uid()) then r.split_token end,
    'lines', jsonb_build_array(jsonb_build_object(
      'kind', 'own',
      'person', public.krossi_booking_person_json(r.booked_by),
      'cents', r.price_cents - r.split_cents * (r.split_parts - 1),
      'status', case when r.payment_status = 'refunded' then 'refunded' else 'paid' end
    )) || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'friend',
        'id', s.id,
        'name', case when x.state <> 'open' then s.payer_name end,
        'person', case when x.state <> 'open' then public.krossi_booking_person_json(s.payer_user_id) end,
        'cents', s.cents,
        'status', x.state,
        'paidAt', public.krossi_booking_iso(s.paid_at),
        'refundedToBookerAt', public.krossi_booking_iso(s.booker_refunded_at)
      ) order by s.position)
      from public.booking_shares s
      cross join lateral (select public.krossi_split_share_state(s) as state) x
      where s.reservation_id = r.id
    ), '[]'::jsonb)
  ) end;
$function$;

revoke all on function public.krossi_booking_split_json(public.booking_reservations) from public, anon, authenticated;

-- Booking: kuten vaiheessa 2 (+ credit) + forSale, soldAt ja split.
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
    'credit', public.krossi_booking_credit_json(r),
    'forSale', r.status = 'confirmed' and r.listed_at is not null,
    'soldAt', public.krossi_booking_iso(r.resold_at),
    'split', public.krossi_booking_split_json(r)
  )
  from public.booking_courts c
  join public.booking_locations l on l.id = c.location_id
  join public.booking_venues v on v.id = c.venue_id
  where c.id = r.court_id;
$function$;

-- BookingVenue: kuten ennen + splitPay ja resale.
create or replace function public.krossi_booking_venue_json(venue_id_input uuid)
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
    'splitPay', v.split_pay,
    'resale', v.resale,
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


-- ── Julkinen kalenteri ───────────────────────────────────────────────────────

-- { date, busy }: kuten vaiheessa 2 (oma kausivuoro = mine) + forSale (myynnissä oleva vuoro; sen
-- kokonaan kattava varaus ottaa sen).
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
        'title', case when r.kind = 'booking' then null else r.title end,
        'forSale', r.status = 'confirmed' and r.listed_at is not null
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

-- Sisäinen: ensimmäinen kenttä, jonka voi varata koko ajaksi. Myynnissä oleva vuoro, jonka aika
-- kattaa kokonaan, ei estä — paitsi for_user_input:n omaa (häntä ei kiinnosta oma vuoronsa).
drop function public.krossi_booking_free_court(uuid, text, uuid, timestamptz, integer);
create function public.krossi_booking_free_court(
  venue_id_input uuid,
  sport_input text,
  location_id_input uuid,
  starts_at_input timestamptz,
  minutes_input integer,
  for_user_input uuid default null
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
        and not (
          r.status = 'confirmed'
          and r.listed_at is not null
          and r.booked_by is distinct from for_user_input
          and r.starts_at >= starts_at_input
          and r.ends_at <= starts_at_input + make_interval(mins => minutes_input)
        )
    )
  order by c.sort, c.name, c.id
  limit 1;
$function$;

revoke all on function public.krossi_booking_free_court(uuid, text, uuid, timestamptz, integer, uuid) from public, anon, authenticated;


-- ── Varaus ───────────────────────────────────────────────────────────────────

-- Sisäinen: vahvistunut varaus ottaa kattamansa myynnissä olevat vuorot. Ne perutaan (myyty),
-- sarjakortin minuutit ja lahjakorttiosuus palautuvat heti (kokonaan krediitillä maksettu on
-- silloin palautettu), ja korttimaksut — varaajan maksusta palauttamatta oleva osa ja kavereiden
-- maksetut osuudet — jäävät palautettaviksi (refund_due_at, myös ilman korttimaksuja, jotta
-- myyjälle kerrotaan: krossi-booking / krossi-booking-cron).
create function public.krossi_booking_take_over_sales(reservation_id_input uuid)
returns integer
language plpgsql
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
  v_sold public.booking_reservations;
  v_count integer := 0;
begin
  select * into v_row from public.booking_reservations where id = reservation_id_input;
  if not found or v_row.status <> 'confirmed' or v_row.kind <> 'booking' then
    return 0;
  end if;

  for v_sold in
    update public.booking_reservations r
       set status = 'cancelled', cancelled_at = now(), resold_by = v_row.id, resold_at = now(), refund_due_at = now()
     where r.court_id = v_row.court_id
       and r.id <> v_row.id
       and r.status = 'confirmed'
       and r.listed_at is not null
       and r.booked_by is distinct from v_row.booked_by
       and r.starts_at >= v_row.starts_at
       and r.ends_at <= v_row.ends_at
    returning r.*
  loop
    perform public.krossi_booking_return_credit(v_sold, 'Myyty');
    if v_sold.payment_status = 'credit' then
      update public.booking_reservations set payment_status = 'refunded' where id = v_sold.id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.krossi_booking_take_over_sales(uuid) from public, anon, authenticated;

-- Varaa kentän (kuten vaiheessa 1) + myynnissä olevan vuoron ostaminen: uusi varaus saa olla sen
-- päällä vain kattaessaan sen kokonaan, eikä silloin ole viime hetken alea (myyjä saa takaisin
-- kaiken maksamansa). Sama allekirjoitus kuin vaiheessa 1.
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
      payment_status, hold_expires_at, created_by, paid_at
    ) values (
      v_venue.id, v_court.id, starts_at_input, v_end, 'booking',
      case when v_price = 0 then 'confirmed' else 'held' end,
      v_uid, v_price,
      case when v_price = 0 then 'free' else 'unpaid' end,
      case when v_price = 0 then null else now() + make_interval(mins => v_venue.hold_minutes) end,
      v_uid,
      case when v_price = 0 then now() end
    )
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'Joku ehti varata tämän ajan juuri ennen sinua. Valitse toinen aika.';
  end;

  if v_row.status = 'confirmed' then
    perform public.krossi_booking_take_over_sales(v_row.id);
  end if;

  return public.krossi_booking_json(v_row);
end;
$function$;


-- ── Laita myyntiin ───────────────────────────────────────────────────────────

-- Oma vahvistettu varaus myyntiin maksuttoman peruutusajan jälkeen, ennen alkua. Uudelleen
-- kutsuttuna ei muutu. (Sovellus kutsuu tämän jälkeen krossi-bookingin 'freed'-toimintoa, joka
-- kertoo vuoroa odottaville.)
create function public.krossi_booking_put_on_sale(booking_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_row public.booking_reservations;
  v_venue public.booking_venues;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  select * into v_row
  from public.booking_reservations
  where id = booking_id_input and booked_by = v_uid and kind = 'booking'
  for update;
  if not found then
    raise exception 'Varausta ei löytynyt.';
  end if;
  if v_row.status <> 'confirmed' then
    raise exception 'Tätä varausta ei voi laittaa myyntiin.';
  end if;
  if v_row.starts_at <= now() then
    raise exception 'Vuoro on jo alkanut.';
  end if;
  select * into v_venue from public.booking_venues where id = v_row.venue_id;
  if not v_venue.resale then
    raise exception 'Tässä hallissa vuoroa ei voi laittaa myyntiin.';
  end if;
  if now() < v_row.starts_at - make_interval(hours => v_venue.cancel_limit_hours) then
    raise exception 'Voit vielä perua vuoron maksutta — rahat palautuvat heti.';
  end if;

  if v_row.listed_at is null then
    update public.booking_reservations
       set listed_at = now(), sale_notified_at = null
     where id = v_row.id
    returning * into v_row;
  end if;
  return public.krossi_booking_json(v_row);
end;
$function$;

revoke all on function public.krossi_booking_put_on_sale(uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_put_on_sale(uuid) to authenticated, service_role;

-- Peru myynti: vuoro palaa vain varaajalle. Ei onnistu, jos joku on juuri maksamassa vuoroa
-- (hänen pitonsa on silloin päällekkäin).
create function public.krossi_booking_take_off_sale(booking_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_row public.booking_reservations;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  select * into v_row
  from public.booking_reservations
  where id = booking_id_input and booked_by = v_uid and kind = 'booking'
  for update;
  if not found then
    raise exception 'Varausta ei löytynyt.';
  end if;
  if v_row.status <> 'confirmed' or v_row.listed_at is null then
    return public.krossi_booking_json(v_row);
  end if;

  -- Vanhentuneet ostajien pidot ovat yhä exclusion-constraintissa: vapautetaan ne ensin.
  update public.booking_reservations r
     set status = 'expired'
   where r.court_id = v_row.court_id
     and r.status = 'held'
     and r.hold_expires_at <= now()
     and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(v_row.starts_at, v_row.ends_at, '[)');

  begin
    update public.booking_reservations
       set listed_at = null
     where id = v_row.id
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'Joku on juuri varaamassa vuoroa. Jos maksu ei mene läpi, voit perua myynnin hetken päästä.';
  end;
  return public.krossi_booking_json(v_row);
end;
$function$;

revoke all on function public.krossi_booking_take_off_sale(uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_take_off_sale(uuid) to authenticated, service_role;


-- ── Jaettu maksu ─────────────────────────────────────────────────────────────

-- Jaa maksu: oma maksettu vuoro 2 tai 4 pelaajan kesken (p_parts), tai jako pois (p_parts 1).
-- Jaettava vuoro on vahvistettu, kokonaan verkkomaksulla maksettu (paymentStatus 'paid', ei
-- lahjakorttisaldon osuutta), ei myynnissä eikä alkanut, ja halli sallii jaon. Pelaajamäärää voi
-- muuttaa ja jaon poistaa niin kauan kuin kukaan ei ole maksanut eikä ole juuri maksamassa
-- osuuttaan (vanhentunut maksun aloitus ei estä). Pelaajamäärän muutos pitää linkin samana; jaon
-- poisto mitätöi linkin, ja uusi jako saa uuden. → Booking.
create function public.krossi_split_booking(p_booking_id uuid, p_parts integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_row public.booking_reservations;
  v_venue public.booking_venues;
  v_cents integer;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  select * into v_row
  from public.booking_reservations
  where id = p_booking_id and booked_by = v_uid and kind = 'booking'
  for update;
  if not found then
    raise exception 'Varausta ei löytynyt.';
  end if;
  if p_parts is null or p_parts not in (1, 2, 4) then
    raise exception 'Jaa maksu kahden tai neljän pelaajan kesken.';
  end if;
  if coalesce(v_row.split_parts, 1) = p_parts then
    return public.krossi_booking_json(v_row);
  end if;

  if p_parts > 1 then
    select * into v_venue from public.booking_venues where id = v_row.venue_id;
    if not v_venue.split_pay then
      raise exception 'Tässä hallissa maksua ei voi jakaa.';
    end if;
    if v_row.status = 'held' then
      raise exception 'Maksa vuoro ensin — sitten voit jakaa maksun.';
    end if;
    if v_row.status <> 'confirmed' then
      raise exception 'Vuoro on peruttu.';
    end if;
    if v_row.starts_at <= now() then
      raise exception 'Vuoro on jo alkanut.';
    end if;
    if v_row.listed_at is not null then
      raise exception 'Myynnissä olevan vuoron maksua ei voi jakaa. Peru myynti ensin.';
    end if;
    if v_row.payment_status = 'free' then
      raise exception 'Maksutonta vuoroa ei voi jakaa.';
    end if;
    if v_row.payment_status <> 'paid' or v_row.stripe_payment_intent_id is null or v_row.gift_cents > 0 then
      raise exception 'Voit jakaa vain vuoron, jonka maksoit kokonaan kortilla tai muulla verkkomaksulla.';
    end if;
  end if;

  if exists (
    select 1 from public.booking_shares s
    where s.reservation_id = v_row.id and s.status in ('paid', 'refunded')
  ) then
    raise exception 'Joku on jo maksanut osuutensa — jakoa ei voi enää muuttaa.';
  end if;
  if exists (
    select 1 from public.booking_shares s
    where s.reservation_id = v_row.id and s.status = 'pending' and s.claim_expires_at > now()
  ) then
    raise exception 'Joku maksaa juuri osuuttaan. Yritä hetken päästä uudelleen.';
  end if;

  if p_parts = 1 then
    delete from public.booking_shares where reservation_id = v_row.id;
    update public.booking_reservations
       set split_parts = null, split_cents = null, split_token = null
     where id = v_row.id
    returning * into v_row;
    return public.krossi_booking_json(v_row);
  end if;

  v_cents := v_row.price_cents / p_parts;
  if v_cents < 50 then
    raise exception 'Vuoro on liian edullinen jaettavaksi.';
  end if;
  delete from public.booking_shares where reservation_id = v_row.id;
  update public.booking_reservations
     set split_parts = p_parts, split_cents = v_cents, split_token = coalesce(split_token, public.krossi_split_token())
   where id = v_row.id
  returning * into v_row;
  insert into public.booking_shares (reservation_id, position, cents)
  select v_row.id, n, v_cents from generate_series(1, p_parts - 1) n;
  return public.krossi_booking_json(v_row);
end;
$function$;

revoke all on function public.krossi_split_booking(uuid, integer) from public, anon, authenticated;
grant execute on function public.krossi_split_booking(uuid, integer) to authenticated, service_role;

-- Jaetun vuoron julkinen maksusivu (/pelaa/maksa/<token>, myös ilman kirjautumista); null, kun
-- linkkiä ei ole. state: 'open' (osuuksia maksamatta) | 'full' (kaikki maksettu tai juuri
-- maksamassa) | 'over' (vuoro on alkanut) | 'cancelled' (peruttu tai myyty).
create function public.krossi_split_public(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'token', r.split_token,
    'venueName', v.name,
    'locationName', l.name,
    'courtName', c.name,
    'sport', c.sport,
    'startsAt', public.krossi_booking_iso(r.starts_at),
    'endsAt', public.krossi_booking_iso(r.ends_at),
    'bookerFirstName', public.krossi_booking_first_name(r.booked_by),
    'bookerAvatarUrl', p.avatar_url,
    'bookerAvatarColor', coalesce(p.avatar_color, 'blue'),
    'parts', r.split_parts,
    'perCents', r.split_cents,
    'paidCount', x.paid,
    'openCount', x.open,
    'state', case
      when r.status <> 'confirmed' then 'cancelled'
      when r.starts_at <= now() then 'over'
      when x.open = 0 then 'full'
      else 'open'
    end
  )
  from public.booking_reservations r
  join public.booking_courts c on c.id = r.court_id
  join public.booking_locations l on l.id = c.location_id
  join public.booking_venues v on v.id = r.venue_id
  left join public.profiles p on p.id = r.booked_by
  cross join lateral (
    select count(*) filter (where s.status = 'paid')::integer as paid,
           count(*) filter (where public.krossi_split_share_state(s) = 'open')::integer as open
    from public.booking_shares s
    where s.reservation_id = r.id
  ) x
  where p_token ~ '^[A-Za-z0-9_-]{22,64}$'
    and r.split_token = p_token;
$function$;

revoke all on function public.krossi_split_public(text) from public, anon, authenticated;
grant execute on function public.krossi_split_public(text) to anon, authenticated, service_role;


-- ── Hallin henkilökunta ──────────────────────────────────────────────────────

-- StaffItem[]: kuten vaiheessa 2 (kausivuoron haltija, seasonSlotId, credit) + forSale. (Jaettu
-- maksu ei näy tiskille: halli saa koko hinnan varattaessa.)
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

-- Esto (kuten ennen): myynnissä oleva vuoro on yhä jonkun varaus, joten este ei voi ottaa sitä.
create or replace function public.krossi_booking_block(
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
  if exists (
    select 1 from public.booking_reservations r
    where r.court_id = any (v_ids)
      and r.status = 'confirmed'
      and r.listed_at is not null
      and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(starts_at_input, ends_at_input, '[)')
  ) then
    raise exception 'Aika ei ole vapaa kaikilla valituilla kentillä.';
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


-- ── Ilmoita kun vapautuu ─────────────────────────────────────────────────────

-- Kuten ennen, ja nyt myös myyntiin laitettu vuoro (kerran per myyntiin laitto,
-- sale_notified_at): sen kokonaan kattava aika on vapaa muille kuin myyjälle. Myyty vuoro ei
-- vapauta mitään (se meni ostajalle).
create or replace function public.krossi_booking_watchers_to_notify(reservation_id_input uuid)
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
     and resold_by is null
     and (status in ('cancelled', 'expired') or (status = 'held' and hold_expires_at <= now()))
  returning * into v_row;
  if not found then
    update public.booking_reservations
       set sale_notified_at = now()
     where id = reservation_id_input
       and status = 'confirmed'
       and listed_at is not null
       and (sale_notified_at is null or sale_notified_at < listed_at)
    returning * into v_row;
    if not found then
      return v_out;
    end if;
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
      and public.krossi_booking_free_court(w.venue_id, w.sport, w.location_id, w.starts_at, w.minutes, w.user_id) is not null
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


-- ── Maksut (vain service_role: krossi-booking, krossi-booking-cron, stripe-webhook) ──

-- Varaajan maksu onnistui (kuten vaiheessa 2): 'confirmed' | 'lost' | 'duplicate' | 'cancelled'.
-- amount_input = maksettu summa: hinnan ja sen erotus otetaan lahjakorttisaldosta, kun varaus
-- vahvistuu. Uutta: paid_at, ja vahvistunut varaus ottaa kattamansa myynnissä olevat vuorot
-- (krossi_booking_take_over_sales); vanhentunut pito ei vie myynnissä olevaa vuoroa, jota se ei
-- kata kokonaan (silloin 'lost').
create or replace function public.krossi_booking_mark_paid(
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

  -- Lahjakorttiosuus: hinta miinus maksettu summa (yli maksettu tai summa puuttuu = ei saldoa).
  v_gift := case
    when amount_input is null then 0
    else greatest(0, v_row.price_cents - amount_input)
  end;

  if v_row.status in ('held', 'confirmed') then
    -- Pito on yhä voimassa (tai vanhentunut, mutta kukaan ei ole vienyt aikaa).
    v_confirm := true;
  elsif v_row.starts_at > now()
     and (v_row.status = 'expired'
          or (v_row.status = 'cancelled' and v_row.cancelled_by is not null and v_row.cancelled_by = v_row.booked_by))
     and not exists (
       select 1 from public.booking_reservations r
       where r.court_id = v_row.court_id
         and r.id <> v_row.id
         and r.status = 'confirmed'
         and r.listed_at is not null
         and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(v_row.starts_at, v_row.ends_at, '[)')
         and (r.starts_at < v_row.starts_at or r.ends_at > v_row.ends_at or r.booked_by = v_row.booked_by)
     ) then
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
           hold_expires_at = null, gift_cents = v_gift, paid_at = now()
     where id = v_row.id
    returning * into v_row;
    if v_gift > 0 then
      insert into public.booking_credit_events (venue_id, user_id, kind, booking_id, cents, label)
      values (v_row.venue_id, v_row.booked_by, 'use', v_row.id, -v_gift, public.krossi_booking_label(v_row));
    end if;
    perform public.krossi_booking_take_over_sales(v_row.id);
    return 'confirmed';
  end if;

  update public.booking_reservations
     set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), stripe_payment_intent_id = v_intent
   where id = v_row.id;
  return 'lost';
end;
$function$;

-- Kaveri aloittaa osuutensa maksun (krossi-booking splitIntent, myös ilman kirjautumista) ja saa
-- yhden avoimen osuuden 15 minuutiksi. Varaus lukitaan ensin, joten kaksi yhtä aikaa maksavaa
-- eivät saa samaa osuutta. resume_intent_input = saman kaverin aiempi maksu: jos osuus on yhä sen
-- maksun, se pysyy hänellä 15 minuuttia lisää. →
--   { state: 'claimed' | 'resumed', bookingId, venueId, shareId, claimId, cents, payerName,
--     payerUserId, intentId (resumed), previousIntentId (claimed: vanhentuneen aloituksen maksu,
--     jonka kutsuja peruu) }
--   { state: 'full' | 'over' | 'cancelled' | 'unknown' | 'own' (varaaja itse) }
create function public.krossi_split_claim(
  token_input text,
  name_input text default null,
  user_id_input uuid default null,
  resume_intent_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
  v_share public.booking_shares;
  v_payer record;
  v_previous text;
  v_resume text := nullif(btrim(coalesce(resume_intent_input, '')), '');
begin
  if coalesce(token_input, '') !~ '^[A-Za-z0-9_-]{22,64}$' then
    return jsonb_build_object('state', 'unknown');
  end if;
  select * into v_row from public.booking_reservations where split_token = token_input for update;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;
  if v_row.status <> 'confirmed' then
    return jsonb_build_object('state', 'cancelled');
  end if;
  if v_row.starts_at <= now() then
    return jsonb_build_object('state', 'over');
  end if;
  if user_id_input is not null and user_id_input = v_row.booked_by then
    return jsonb_build_object('state', 'own');
  end if;

  if v_resume is not null then
    update public.booking_shares
       set claim_expires_at = now() + interval '15 minutes'
     where reservation_id = v_row.id
       and status = 'pending'
       and stripe_payment_intent_id = v_resume
    returning * into v_share;
    if found then
      return jsonb_build_object(
        'state', 'resumed', 'bookingId', v_row.id, 'venueId', v_row.venue_id, 'shareId', v_share.id,
        'claimId', v_share.claim_id, 'cents', v_share.cents, 'payerName', v_share.payer_name,
        'payerUserId', v_share.payer_user_id, 'intentId', v_share.stripe_payment_intent_id
      );
    end if;
  end if;

  select * into v_share
  from public.booking_shares s
  where s.reservation_id = v_row.id
    and (s.status = 'open' or (s.status = 'pending' and s.claim_expires_at <= now()))
  order by s.position
  limit 1;
  if not found then
    return jsonb_build_object('state', 'full');
  end if;

  v_previous := v_share.stripe_payment_intent_id;
  select * into v_payer from public.krossi_split_payer(name_input, user_id_input);
  update public.booking_shares
     set status = 'pending', claim_id = gen_random_uuid(), claim_expires_at = now() + interval '15 minutes',
         payer_name = v_payer.payer_name, payer_user_id = v_payer.payer_user_id, stripe_payment_intent_id = null
   where id = v_share.id
  returning * into v_share;
  return jsonb_build_object(
    'state', 'claimed', 'bookingId', v_row.id, 'venueId', v_row.venue_id, 'shareId', v_share.id,
    'claimId', v_share.claim_id, 'cents', v_share.cents, 'payerName', v_share.payer_name,
    'payerUserId', v_share.payer_user_id, 'previousIntentId', v_previous
  );
end;
$function$;

revoke all on function public.krossi_split_claim(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.krossi_split_claim(text, text, uuid, text) to service_role;

-- Maksun tunniste osuudelle — vain jos osuus on yhä saman maksun aloituksen (claim_id). → boolean
create function public.krossi_split_attach(share_id_input uuid, claim_id_input uuid, payment_intent_id_input text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.booking_shares
     set stripe_payment_intent_id = payment_intent_id_input
   where id = share_id_input
     and claim_id = claim_id_input
     and status = 'pending';
  return found;
end;
$function$;

revoke all on function public.krossi_split_attach(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.krossi_split_attach(uuid, uuid, text) to service_role;

-- Sisäinen: maksetun osuuden vastaus krossi_split_mark_paidille.
create function public.krossi_split_paid_json(r public.booking_reservations, s public.booking_shares)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'result', 'paid',
    'bookingId', r.id,
    'shareId', s.id,
    'cents', s.cents,
    'bookerIntentId', r.stripe_payment_intent_id,
    -- sama summa palautetaan varaajan maksusta, ellei sitä ole jo tehty tai koko maksua palautettu
    'bookerRefundDue', s.booker_refunded_at is null and r.status = 'confirmed' and r.payment_status = 'paid'
      and r.stripe_payment_intent_id is not null
  );
$function$;

revoke all on function public.krossi_split_paid_json(public.booking_reservations, public.booking_shares) from public, anon, authenticated;

-- Kaverin maksu onnistui (krossi-booking splitVerify ja stripe-webhook, kumpi tahansa ensin;
-- uusintakutsu samalla maksulla antaa saman vastauksen). Varaus lukitaan ensin, kuten
-- peruutuksessa, joten maksu ja peruutus eivät mene ristiin. Maksu menee osuudelle, jolle se
-- aloitettiin; jos sen aloitus ehti vanhentua ja osuus meni toiselle, mille tahansa avoimelle
-- osuudelle. →
--   { result: 'paid', bookingId, shareId, cents, bookerIntentId, bookerRefundDue }
--   { result: 'refund', reason, bookingId, shareId (kun maksulla oli osuus) } — maksu palautetaan
--     kaverille: reason 'cancelled' (vuoro peruttiin tai myytiin), 'changed' (jako muuttui tai
--     poistettiin) tai 'full' (kaikki osuudet ehdittiin maksaa)
create function public.krossi_split_mark_paid(
  booking_id_input uuid,
  share_id_input uuid,
  payment_intent_id_input text,
  amount_input integer,
  name_input text default null,
  user_id_input uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_intent text := nullif(btrim(coalesce(payment_intent_id_input, '')), '');
  v_row public.booking_reservations;
  v_share public.booking_shares;
  v_payer record;
  v_reason text;
begin
  if v_intent is null then
    raise exception 'Maksun tunniste puuttuu.';
  end if;
  select * into v_row from public.booking_reservations where id = booking_id_input and kind = 'booking' for update;
  if not found then
    raise exception 'Varausta ei löytynyt.';
  end if;

  -- Sama maksu uudelleen: sama vastaus.
  select * into v_share from public.booking_shares
   where reservation_id = v_row.id and stripe_payment_intent_id = v_intent and status in ('paid', 'refunded');
  if found then
    if v_share.status = 'paid' then
      return public.krossi_split_paid_json(v_row, v_share);
    end if;
    return jsonb_build_object('result', 'refund', 'reason', 'cancelled', 'bookingId', v_row.id, 'shareId', v_share.id);
  end if;

  v_reason := case
    when v_row.status <> 'confirmed' then 'cancelled'
    when v_row.split_token is null or amount_input is distinct from v_row.split_cents then 'changed'
  end;
  if v_reason is not null then
    -- Maksu palautetaan. Jos osuus on yhä tämän maksun, se jää näkyviin palautettuna, ja
    -- palautus on kesken, kunnes se kirjataan (refund_due_at).
    update public.booking_shares
       set status = 'refunded', paid_at = now(), claim_id = null, claim_expires_at = null
     where id = share_id_input
       and reservation_id = v_row.id
       and status = 'pending'
       and stripe_payment_intent_id = v_intent
    returning * into v_share;
    if found then
      update public.booking_reservations set refund_due_at = coalesce(refund_due_at, now()) where id = v_row.id;
      return jsonb_build_object('result', 'refund', 'reason', v_reason, 'bookingId', v_row.id, 'shareId', v_share.id);
    end if;
    return jsonb_build_object('result', 'refund', 'reason', v_reason, 'bookingId', v_row.id);
  end if;

  select * into v_share from public.booking_shares s
   where s.id = share_id_input
     and s.reservation_id = v_row.id
     and (s.status = 'open' or (s.status = 'pending' and (s.stripe_payment_intent_id = v_intent or s.claim_expires_at <= now())));
  if not found then
    select * into v_share from public.booking_shares s
     where s.reservation_id = v_row.id
       and (s.status = 'open' or (s.status = 'pending' and s.claim_expires_at <= now()))
     order by s.position
     limit 1;
    if not found then
      return jsonb_build_object('result', 'refund', 'reason', 'full', 'bookingId', v_row.id);
    end if;
  end if;

  select * into v_payer from public.krossi_split_payer(name_input, user_id_input);
  update public.booking_shares s
     set status = 'paid', paid_at = now(), stripe_payment_intent_id = v_intent, claim_id = null, claim_expires_at = null,
         payer_name = case when s.stripe_payment_intent_id = v_intent then s.payer_name else v_payer.payer_name end,
         payer_user_id = case when s.stripe_payment_intent_id = v_intent then s.payer_user_id else v_payer.payer_user_id end
   where s.id = v_share.id
  returning * into v_share;
  return public.krossi_split_paid_json(v_row, v_share);
end;
$function$;

revoke all on function public.krossi_split_mark_paid(uuid, uuid, text, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.krossi_split_mark_paid(uuid, uuid, text, integer, text, uuid) to service_role;

-- Osuuden summa palautettiin varaajan maksusta (Stripen palautus refund_id_input). Kirjataan kerran.
create function public.krossi_split_booker_refunded(share_id_input uuid, refund_id_input text)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.booking_shares
     set booker_refund_id = nullif(btrim(coalesce(refund_id_input, '')), ''),
         booker_refunded_at = now()
   where id = share_id_input
     and status in ('paid', 'refunded')
     and booker_refunded_at is null;
$function$;

revoke all on function public.krossi_split_booker_refunded(uuid, text) from public, anon, authenticated;
grant execute on function public.krossi_split_booker_refunded(uuid, text) to service_role;

-- Ajastettu (krossi-booking-cron): maksetut osuudet, joiden summaa ei ole vielä palautettu
-- varaajalle (yli 2 min): [{ shareId, bookingId, bookerIntentId, cents }].
create function public.krossi_split_refunds_due(limit_input integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'shareId', x.id,
    'bookingId', x.reservation_id,
    'bookerIntentId', x.stripe_payment_intent_id,
    'cents', x.cents
  ) order by x.paid_at), '[]'::jsonb)
  from (
    select s.id, s.reservation_id, r.stripe_payment_intent_id, s.cents, s.paid_at
    from public.booking_shares s
    join public.booking_reservations r on r.id = s.reservation_id
    where s.status = 'paid'
      and s.booker_refunded_at is null
      and s.paid_at <= now() - interval '2 minutes'
      and r.status = 'confirmed'
      and r.payment_status = 'paid'
      and r.stripe_payment_intent_id is not null
    order by s.paid_at
    limit greatest(1, least(coalesce(limit_input, 50), 200))
  ) x;
$function$;

revoke all on function public.krossi_split_refunds_due(integer) from public, anon, authenticated;
grant execute on function public.krossi_split_refunds_due(integer) to service_role;

-- Maksut, jotka pitää palauttaa: [{ shareId (null = varaajan oma), kind ('own' | 'friend'),
-- paymentIntentId, cents }]. Varaajan osa = hänen maksustaan vielä palauttamatta oleva summa;
-- kaverin osa = koko hänen maksunsa (myös perutun vuoron myöhässä tullut, palauttamaton maksu).
create function public.krossi_booking_paid_parts(booking_id_input uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(x.part order by x.ord), '[]'::jsonb)
  from (
    select 0 as ord, jsonb_build_object(
      'shareId', null,
      'kind', 'own',
      'paymentIntentId', r.stripe_payment_intent_id,
      'cents', r.price_cents - r.gift_cents - coalesce((
        select sum(s.cents) from public.booking_shares s
        where s.reservation_id = r.id and s.booker_refunded_at is not null
      ), 0)::integer
    ) as part
    from public.booking_reservations r
    where r.id = booking_id_input
      and r.payment_status = 'paid'
      and r.stripe_payment_intent_id is not null
    union all
    select s.position, jsonb_build_object(
      'shareId', s.id,
      'kind', 'friend',
      'paymentIntentId', s.stripe_payment_intent_id,
      'cents', s.cents
    )
    from public.booking_shares s
    where s.reservation_id = booking_id_input
      and s.stripe_payment_intent_id is not null
      and (s.status = 'paid' or (s.status = 'refunded' and s.stripe_refund_id is null))
  ) x;
$function$;

revoke all on function public.krossi_booking_paid_parts(uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_paid_parts(uuid) to service_role;

-- Peruu varauksen (pelaaja ennen peruutusrajaa tai henkilökunta) ja palauttaa sen maksut
-- palautettaviksi (krossi_booking_paid_parts). Kaverin maksu, joka tulee perille tämän jälkeen,
-- palautetaan (krossi_split_mark_paid: 'cancelled'). Sarjakortin minuutit ja lahjakorttiosuus
-- palautuvat heti (kuten krossi_booking_mark_cancelled); kokonaan krediitillä maksettu varaus on
-- silloin palautettu. refund_input false = henkilökunta perui ilman hyvitystä: mitään ei
-- palauteta. Jo peruttu varaus: ei muutoksia, palautukset yhä listataan (uusintayritys).
create function public.krossi_booking_cancel(booking_id_input uuid, by_input uuid, refund_input boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
  v_refund boolean := coalesce(refund_input, true);
  v_parts jsonb;
begin
  select * into v_row from public.booking_reservations where id = booking_id_input and kind = 'booking' for update;
  if not found then
    raise exception 'Varausta ei löytynyt.';
  end if;
  if v_row.status not in ('held', 'confirmed') then
    -- jo peruttu: uusintayritys saa sen, mikä on yhä palauttamatta
    return case when v_refund and v_row.refund_due_at is not null then public.krossi_booking_paid_parts(v_row.id) else '[]'::jsonb end;
  end if;

  update public.booking_reservations
     set status = 'cancelled', cancelled_at = now(), cancelled_by = by_input
   where id = v_row.id;
  if not v_refund then
    return '[]'::jsonb;
  end if;
  perform public.krossi_booking_return_credit(v_row, 'Peruttu');
  if v_row.payment_status = 'credit' then
    update public.booking_reservations set payment_status = 'refunded' where id = v_row.id;
  end if;
  v_parts := public.krossi_booking_paid_parts(v_row.id);
  if v_parts <> '[]'::jsonb then
    update public.booking_reservations set refund_due_at = now() where id = v_row.id;
  end if;
  return v_parts;
end;
$function$;

revoke all on function public.krossi_booking_cancel(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.krossi_booking_cancel(uuid, uuid, boolean) to service_role;

-- Kirjaa palautukset: refunds_input = [{ shareId (null = varaajan oma maksu), refundId }]. Kun
-- palautettavaa ei enää ole, refund_due_at nollautuu.
create function public.krossi_booking_parts_refunded(booking_id_input uuid, refunds_input jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_part jsonb;
begin
  for v_part in select value from jsonb_array_elements(coalesce(refunds_input, '[]'::jsonb)) loop
    if coalesce(v_part->>'shareId', '') = '' then
      update public.booking_reservations
         set payment_status = 'refunded',
             stripe_refund_id = coalesce(nullif(v_part->>'refundId', ''), stripe_refund_id)
       where id = booking_id_input and payment_status = 'paid';
    else
      update public.booking_shares
         set status = 'refunded',
             stripe_refund_id = coalesce(nullif(v_part->>'refundId', ''), stripe_refund_id),
             refunded_at = coalesce(refunded_at, now())
       where id = (v_part->>'shareId')::uuid and reservation_id = booking_id_input and status in ('paid', 'refunded');
    end if;
  end loop;
  update public.booking_reservations
     set refund_due_at = null
   where id = booking_id_input
     and refund_due_at is not null
     and public.krossi_booking_paid_parts(booking_id_input) = '[]'::jsonb;
end;
$function$;

revoke all on function public.krossi_booking_parts_refunded(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.krossi_booking_parts_refunded(uuid, jsonb) to service_role;

-- Vuorot, jotka tämä varaus osti myynnistä: [{ bookingId, sellerId, refundDue }].
create function public.krossi_booking_resold_by(booking_id_input uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'bookingId', r.id,
    'sellerId', r.booked_by,
    'refundDue', r.refund_due_at is not null
  ) order by r.starts_at, r.id), '[]'::jsonb)
  from public.booking_reservations r
  where r.resold_by = booking_id_input;
$function$;

revoke all on function public.krossi_booking_resold_by(uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_resold_by(uuid) to service_role;

-- Ajastettu (krossi-booking-cron): perutut / myydyt varaukset, joiden palautukset jäivät kesken
-- (yli 2 min): [{ bookingId, resold }].
create function public.krossi_booking_refunds_due(limit_input integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('bookingId', x.id, 'resold', x.resold_by is not null) order by x.refund_due_at), '[]'::jsonb)
  from (
    select r.id, r.resold_by, r.refund_due_at
    from public.booking_reservations r
    where r.refund_due_at <= now() - interval '2 minutes'
    order by r.refund_due_at
    limit greatest(1, least(coalesce(limit_input, 50), 200))
  ) x;
$function$;

revoke all on function public.krossi_booking_refunds_due(integer) from public, anon, authenticated;
grant execute on function public.krossi_booking_refunds_due(integer) to service_role;


-- ── Vaihe 2: sarja- ja lahjakortit ───────────────────────────────────────────
-- Vaiheen 2 versiot (20261016100000), yksi muutos: kokonaan krediitillä vahvistuva varaus ottaa
-- kattamansa myynnissä olevat vuorot kuten korttimaksu (krossi_booking_take_over_sales).
-- Oikeudet pysyvät ennallaan.

-- Maksaa oman pidossa olevan varauksen kokonaan sarjakortilla (minuutit vähenevät, varaus vahvistuu
-- ja ottaa kattamansa myynnissä olevat vuorot).
create or replace function public.krossi_wallet_pay_booking(booking_id_input uuid, pass_id_input uuid)
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
  perform public.krossi_booking_take_over_sales(v_row.id);
  return public.krossi_booking_json(v_row);
end;
$function$;

-- Käyttää (use_input) tai poistaa lahjakorttisaldon pidossa olevalta varaukselta (ks. vaihe 2). Jos
-- saldo kattaa koko hinnan, varaus vahvistuu heti (ja ottaa kattamansa myynnissä olevat vuorot).
create or replace function public.krossi_wallet_use_gift(booking_id_input uuid, use_input boolean)
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
    perform public.krossi_booking_take_over_sales(v_row.id);
  else
    update public.booking_reservations set gift_cents = v_share where id = v_row.id returning * into v_row;
  end if;
  return public.krossi_booking_json(v_row);
end;
$function$;

notify pgrst, 'reload schema';
