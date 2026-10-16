-- Krossi: kenttävaraus, vaihe 4 — jaettu maksu ja myöhään peruttu vuoro myyntiin.
--
-- Jaettu maksu: varaaja valitsee vuoroon pelikaverit (kaksinpeliin 1, nelinpeliin 3). Jokainen
-- kaveri maksaa floor(hinta / pelaajat), varaaja loput (pariton sentti on hänen). Varaaja maksaa
-- oman osuutensa heti, ja kortti tallentuu Stripeen (setup_future_usage). Kun varaus vahvistuu,
-- jokainen kaveri saa varaajalta viestin heidän kahdenkeskiseen keskusteluunsa
-- "Maksa osuutesi" -linkillä (ja sähköpostin, krossi-notify). Kun vuoron alkuun on
-- booking_venues.share_deadline_hours tuntia, krossi-booking-cron tekee maksamattomista
-- osuuksista varaajan loppuosuuden (booking_shares.kind 'rest') ja veloittaa sen tallennetulta
-- kortilta. Jos kortti ei käy, loppuosuus jää varaajan maksettavaksi sovelluksessa (ja hallin
-- henkilökunta näkee sen päivänäkymässä). Maksuajan jälkeen kaverit eivät enää maksa: myöhässä
-- perille tullut kaverin maksu palautetaan.
--
-- Laita myyntiin: maksuttoman peruutusajan jälkeen varaaja voi laittaa vuoron myyntiin
-- (listed_at). Myynnissä oleva vuoro ei estä uutta varausta, joka kattaa sen kokonaan (ei
-- viime hetken alea). Kun sellainen varaus maksetaan, myyty vuoro perutaan samassa
-- transaktiossa, ja kaikki sen maksut (varaajan, kavereiden ja loppuosuus) palautetaan
-- (krossi-booking / stripe-webhook, refund_due_at varmistaa ettei mikään jää). Osittain
-- päällekkäinen varaus ei käy, eikä myyjä voi ostaa omaansa. Myynti ilmoittaa vuoroa
-- odottaville ("Ilmoita kun vapautuu") samalla tavalla kuin peruttu vuoro.
--
-- Vaihe 2 (sarja- ja lahjakortit): jaetun vuoron osuudet maksetaan kortilla — sarjakortti tai
-- lahjakorttisaldo ei käy jaettuun varaukseen. Myynnissä olevan vuoron saa ostaa myös sarjakortilla
-- tai lahjakorttisaldolla; myydyn tai perutun vuoron sarjakortin minuutit ja lahjakorttiosuus
-- palautuvat heti, korttimaksut Stripen kautta.
--
-- Court booking phase 4 for Krossi (krossi.app/pelaa). Additive on top of
-- 20261016074110_krossi_court_booking and phase 2's 20261016100000_krossi_booking_seasons_billing_wallet
-- (it needs both): new columns, the booking_shares table and new versions of the booking
-- functions. The functions phase 2 replaced (krossi_booking_json, _day, _staff_day, _mark_paid)
-- are based on its versions here, and three of its wallet functions (krossi_wallet_payable_booking,
-- _pay_booking, _use_gift) get the split and resale rules. Chat rows are written the way
-- accept_connection_request writes them (find-or-create the 1:1 conversation, message as the
-- sender), and nothing else outside the booking tables changes, so Koutsi is unaffected.
--
--   booking_shares                       kaverin osuus / varaajan loppuosuus
--   krossi_booking_share_friends()       kenen kanssa maksun voi jakaa (pelikaverit, keskustelut)
--   krossi_hold_booking(+friend_ids)     varaus, jaettu maksu ja myynnissä olevan vuoron ostaminen
--   krossi_booking_my_shares() / _share(id) / _decline_share(id)
--   krossi_booking_put_on_sale(id) / _take_off_sale(id)
--   service_role: _mark_paid(+payment method), _share_mark_paid, _cancel, _paid_parts,
--                 _parts_refunded, _resold_by, _due_rests, _rest_failed, _refunds_due,
--                 _share_problem
--   vaihe 2:      krossi_wallet_payable_booking (ei jaettua), _pay_booking ja _use_gift (myynnissä
--                 olevan vuoron ostaminen)


-- ── Taulut ───────────────────────────────────────────────────────────────────

-- Kaverien maksuaika: näin monta tuntia ennen vuoron alkua maksamattomat osuudet veloitetaan
-- varaajalta.
alter table public.booking_venues
  add column share_deadline_hours integer not null default 2,
  add constraint booking_venues_share_deadline check (share_deadline_hours between 1 and 72);

grant select (share_deadline_hours) on public.booking_venues to anon, authenticated;

alter table public.booking_reservations
  -- milloin varaajan oma maksu onnistui
  add column paid_at timestamptz,
  -- jaettu maksu: pelaajien määrä varaaja mukaan lukien (2 / 4), varaajan oma osuus ja kaverien
  -- maksuaika (starts_at − share_deadline_hours varaushetkellä)
  add column split_parts integer,
  add column own_cents integer,
  add column share_deadline timestamptz,
  -- varaajan tallennettu kortti loppuosuutta varten
  add column stripe_payment_method_id text,
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
    (split_parts is null and own_cents is null and share_deadline is null)
    or (kind = 'booking' and split_parts in (2, 4) and own_cents between 1 and price_cents and share_deadline is not null)
  ),
  add constraint booking_reservations_listed check (listed_at is null or kind = 'booking'),
  add constraint booking_reservations_payment_method check (
    stripe_payment_method_id is null or stripe_payment_method_id ~ '^pm_[A-Za-z0-9_]+$'
  ),
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
create index booking_reservations_share_deadline_idx on public.booking_reservations (share_deadline)
  where split_parts is not null and status = 'confirmed';
create index booking_reservations_refund_due_idx on public.booking_reservations (refund_due_at)
  where refund_due_at is not null;
create index booking_reservations_resold_by_idx on public.booking_reservations (resold_by)
  where resold_by is not null;

-- kind:   'friend' = kaverin osuus, 'rest' = maksuajan jälkeen varaajalle siirtyneet osuudet
-- status: 'pending' → 'paid' | 'declined' ("en pääse", yhä maksamatta) | 'covered' (loppuosuus
--         maksaa) | 'cancelled' (vuoro peruttiin ennen maksua); 'paid' → 'refunded'
create table public.booking_shares (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.booking_reservations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'friend',
  -- järjestys, jossa varaaja valitsi kaverit (loppuosuus viimeisenä)
  position integer not null default 0,
  cents integer not null,
  status text not null default 'pending',
  stripe_payment_intent_id text unique,
  stripe_refund_id text,
  -- kaverin osuus: loppuosuus, joka sen maksoi
  covered_by uuid references public.booking_shares(id) on delete set null,
  -- kun kaverille kerrottiin (viesti + sähköposti); null = varaaja ei ole vielä maksanut omaansa
  invited_at timestamptz,
  paid_at timestamptz,
  declined_at timestamptz,
  -- loppuosuus: tallennetun kortin veloitusyritys ja Stripen syy, jos se ei onnistunut
  charge_attempted_at timestamptz,
  charge_error text,
  created_at timestamptz not null default now(),
  constraint booking_shares_kind check (kind in ('friend', 'rest')),
  constraint booking_shares_status check (status in ('pending', 'paid', 'declined', 'covered', 'refunded', 'cancelled')),
  constraint booking_shares_rest_status check (kind = 'friend' or status not in ('declined', 'covered')),
  constraint booking_shares_cents check (cents > 0),
  constraint booking_shares_paid check (
    status not in ('paid', 'refunded') or (paid_at is not null and stripe_payment_intent_id is not null)
  ),
  constraint booking_shares_charge_error check (charge_error is null or length(charge_error) <= 80)
);

create unique index booking_shares_friend_once_idx on public.booking_shares (reservation_id, user_id) where kind = 'friend';
create unique index booking_shares_one_rest_idx on public.booking_shares (reservation_id) where kind = 'rest';
create index booking_shares_reservation_id_idx on public.booking_shares (reservation_id, position);
create index booking_shares_user_id_idx on public.booking_shares (user_id, created_at desc) where user_id is not null;

alter table public.booking_shares enable row level security;
revoke all on table public.booking_shares from anon, authenticated;
grant all on table public.booking_shares to service_role;


-- ── Apufunktiot ──────────────────────────────────────────────────────────────

-- '15 €' | '11,25 €' — sama kuin sovelluksen formatEuro.
create function public.krossi_booking_euros(cents integer)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case
    when $1 % 100 = 0 then ($1 / 100)::text
    else replace(to_char($1 / 100.0, 'FM999999990.00'), '.', ',')
  end || ' €';
$function$;

revoke all on function public.krossi_booking_euros(integer) from public, anon, authenticated;

-- 'to 16.10. klo 18.00' hallin paikallisessa ajassa (viesti luetaan myöhemmin: ei "huomenna").
create function public.krossi_booking_when(ts timestamptz, tz text)
returns text
language sql
stable
set search_path = ''
as $function$
  select (array['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'])[extract(isodow from l)::integer]
      || ' ' || to_char(l, 'FMDD.FMMM.') || ' klo ' || to_char(l, 'FMHH24.MI')
  from (select $1 at time zone $2 as l) x;
$function$;

revoke all on function public.krossi_booking_when(timestamptz, text) from public, anon, authenticated;

-- Etunimi viesteihin ("Mikko maksaa osuutesi"), 'Pelaaja' kun nimeä ei ole.
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

-- Kahdenkeskinen keskustelu, luodaan tarvittaessa (sama sääntö kuin accept_connection_request).
create function public.krossi_booking_direct_chat(user_a uuid, user_b uuid)
returns uuid
language plpgsql
set search_path = ''
as $function$
declare
  v_id uuid := public.krossi_direct_conversation_id(user_a, user_b);
begin
  if v_id is null then
    insert into public.conversations default values returning id into v_id;
    insert into public.conversation_participants (conversation_id, user_id)
    values (v_id, user_a), (v_id, user_b);
  end if;
  return v_id;
end;
$function$;

revoke all on function public.krossi_booking_direct_chat(uuid, uuid) from public, anon, authenticated;


-- ── Pelikaverit ──────────────────────────────────────────────────────────────

-- Kenen kanssa uid voi jakaa vuoron maksun: yhteinen keskustelu, yhteinen (ei peruttu) peli tai
-- liigaottelu — vain Krossin pelaajat (tennis_preferences), ei estoja kumpaankaan suuntaan.
-- last_at = viimeisin yhteinen asia (järjestystä varten).
create function public.krossi_booking_friends(uid uuid)
returns table (user_id uuid, last_at timestamptz)
language sql
stable
set search_path = ''
as $function$
  select f.user_id, max(f.at) as last_at
  from (
    select other.user_id, c.updated_at as at
    from public.conversation_participants mine
    join public.conversation_participants other
      on other.conversation_id = mine.conversation_id and other.user_id <> uid
    join public.conversations c on c.id = mine.conversation_id
    where mine.user_id = uid
    union all
    select m.user_id, coalesce(ch.scheduled_at, ch.created_at)
    from public.challenges ch
    cross join lateral (
      select ch.creator_id as user_id
      union
      select cp.user_id from public.challenge_participants cp where cp.challenge_id = ch.id
    ) m
    where ch.status <> 'cancelled'
      and (ch.creator_id = uid
           or exists (select 1 from public.challenge_participants me where me.challenge_id = ch.id and me.user_id = uid))
    union all
    select case when lf.player_a_id = uid then lf.player_b_id else lf.player_a_id end, lf.created_at
    from public.league_fixtures lf
    where uid in (lf.player_a_id, lf.player_b_id)
  ) f
  where f.user_id is not null
    and f.user_id <> uid
    and exists (select 1 from public.tennis_preferences t where t.user_id = f.user_id)
    and not exists (
      select 1 from public.blocked_profiles b
      where (b.blocker_id = uid and b.blocked_id = f.user_id)
         or (b.blocker_id = f.user_id and b.blocked_id = uid)
    )
  group by f.user_id;
$function$;

revoke all on function public.krossi_booking_friends(uuid) from public, anon, authenticated;

-- PersonLite[]: pelikaverit jaettuun maksuun, viimeisin ensin (enintään 60).
create function public.krossi_booking_share_friends()
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
    select jsonb_agg(public.krossi_booking_person_json(f.user_id) order by f.last_at desc nulls last, f.user_id)
    from (
      select * from public.krossi_booking_friends(v_uid)
      order by last_at desc nulls last, user_id
      limit 60
    ) f
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.krossi_booking_share_friends() from public, anon, authenticated;
grant execute on function public.krossi_booking_share_friends() to authenticated, service_role;


-- ── JSON-muodot (api/contract.js) ────────────────────────────────────────────

-- BookingSplit tai null: varaajan oma osa ('own') ensin, sitten kaverit valintajärjestyksessä,
-- sitten loppuosuus.
create function public.krossi_booking_split_json(r public.booking_reservations)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when r.split_parts is null then null else jsonb_build_object(
    'parts', r.split_parts,
    'ownCents', r.own_cents,
    'deadline', public.krossi_booking_iso(r.share_deadline),
    'lines', jsonb_build_array(jsonb_build_object(
      'id', null,
      'kind', 'own',
      'person', public.krossi_booking_person_json(r.booked_by),
      'cents', r.own_cents,
      'status', case
        when r.payment_status in ('paid', 'free', 'credit') then 'paid'
        when r.payment_status = 'refunded' then 'refunded'
        when r.status = 'held' and r.hold_expires_at > now() then 'pending'
        else 'cancelled'
      end,
      'paidAt', public.krossi_booking_iso(r.paid_at)
    )) || coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'kind', s.kind,
        'person', public.krossi_booking_person_json(s.user_id),
        'cents', s.cents,
        'status', s.status,
        'paidAt', public.krossi_booking_iso(s.paid_at)
      ) order by s.position, s.created_at, s.id)
      from public.booking_shares s
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

-- BookingShare: osuus ja koko varaus (kaikkien maksut).
create function public.krossi_booking_share_json(s public.booking_shares)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', s.id,
    'kind', s.kind,
    'cents', s.cents,
    'status', s.status,
    'paidAt', public.krossi_booking_iso(s.paid_at),
    'deadline', public.krossi_booking_iso(r.share_deadline),
    'payable', s.status in ('pending', 'declined') and r.status = 'confirmed'
      and (s.kind = 'rest' or now() < r.share_deadline),
    'chargeError', case when s.kind = 'rest' then s.charge_error end,
    'booker', public.krossi_booking_person_json(r.booked_by),
    'booking', public.krossi_booking_json(r)
  )
  from public.booking_reservations r
  where r.id = s.reservation_id;
$function$;

revoke all on function public.krossi_booking_share_json(public.booking_shares) from public, anon, authenticated;

-- BookingVenue: kuten ennen + shareDeadlineHours.
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
    'shareDeadlineHours', v.share_deadline_hours,
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
-- niiden maksamattomat osuudet perutaan, sarjakortin minuutit ja lahjakorttiosuus palautuvat heti
-- (kokonaan krediitillä maksettu on silloin palautettu) ja korttimaksut jäävät palautettaviksi
-- (refund_due_at — myös ilman korttimaksuja, jotta myyjälle kerrotaan: krossi-booking /
-- krossi-booking-cron).
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
    update public.booking_shares
       set status = 'cancelled'
     where reservation_id = v_sold.id
       and status in ('pending', 'declined');
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

-- Kaverin viesti: 'Varasin meille kentän: Tennis 2, Janus-Areena, to 16.10. klo 18.00–19.30.
-- Osuutesi on 11,25 € — maksa se Krossissa viimeistään to 16.10. klo 16.00: <linkki>' (sama
-- teksti kuin demon bookingSeed.js:n shareMessage). Web-chat näyttää linkin
-- "Maksa osuutesi" -nappina.
create function public.krossi_booking_share_message(share_id_input uuid)
returns text
language sql
stable
set search_path = ''
as $function$
  select 'Varasin meille kentän: ' || c.name || ', ' || l.name || ', '
      || public.krossi_booking_when(r.starts_at, v.timezone) || '–'
      || to_char(r.ends_at at time zone v.timezone, 'FMHH24.MI') || '. Osuutesi on '
      || public.krossi_booking_euros(s.cents) || ' — maksa se Krossissa viimeistään '
      || public.krossi_booking_when(r.share_deadline, v.timezone)
      || ': https://krossi.app/pelaa/osuus/' || s.id::text
  from public.booking_shares s
  join public.booking_reservations r on r.id = s.reservation_id
  join public.booking_courts c on c.id = r.court_id
  join public.booking_locations l on l.id = c.location_id
  join public.booking_venues v on v.id = r.venue_id
  where s.id = share_id_input;
$function$;

revoke all on function public.krossi_booking_share_message(uuid) from public, anon, authenticated;

-- Sisäinen: vahvistunut jaettu varaus — kaverit, joille ei ole vielä kerrottu, saavat viestin
-- varaajalta kahdenkeskiseen keskusteluun (luodaan tarvittaessa). Kerran per osuus (invited_at);
-- sähköpostit lähettää krossi-booking (krossi-notify booking_share_request) näille osuuksille.
create function public.krossi_booking_invite_shares(reservation_id_input uuid)
returns integer
language plpgsql
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
  v_share public.booking_shares;
  v_count integer := 0;
begin
  select * into v_row from public.booking_reservations where id = reservation_id_input;
  if not found or v_row.split_parts is null or v_row.status <> 'confirmed' or v_row.booked_by is null then
    return 0;
  end if;

  for v_share in
    update public.booking_shares s
       set invited_at = now()
     where s.reservation_id = v_row.id
       and s.kind = 'friend'
       and s.invited_at is null
       and s.status = 'pending'
       and s.user_id is not null
    returning s.*
  loop
    insert into public.messages (conversation_id, sender_id, content)
    values (
      public.krossi_booking_direct_chat(v_row.booked_by, v_share.user_id),
      v_row.booked_by,
      public.krossi_booking_share_message(v_share.id)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.krossi_booking_invite_shares(uuid) from public, anon, authenticated;

-- Sisäinen: mitä tapahtuu, kun varaus vahvistuu (maksettu tai ilmainen).
create function public.krossi_booking_after_confirm(reservation_id_input uuid)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  perform public.krossi_booking_take_over_sales(reservation_id_input);
  perform public.krossi_booking_invite_shares(reservation_id_input);
end;
$function$;

revoke all on function public.krossi_booking_after_confirm(uuid) from public, anon, authenticated;

-- Varaa kentän (kuten ennen) + jaettu maksu ja myynnissä olevan vuoron ostaminen:
--   friend_ids_input  1 (kaksinpeli) tai 3 (nelinpeli) pelikaveria: kaverit maksavat
--                     floor(hinta / pelaajat), varaaja loput; maksuaika
--                     starts_at − share_deadline_hours, vähintään 30 min päässä
--   myynnissä oleva   uusi varaus saa olla sen päällä vain kattaessaan sen kokonaan; silloin ei
--                     viime hetken alea (myyjä saa takaisin kaiken maksamansa)
drop function public.krossi_hold_booking(uuid, timestamptz, integer);
create function public.krossi_hold_booking(
  court_id_input uuid,
  starts_at_input timestamptz,
  minutes_input integer,
  friend_ids_input uuid[] default null
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
  v_parts integer;
  v_friend_cents integer;
  v_deadline timestamptz;
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

  -- Jaettu maksu: kenen kanssa ja ehtiikö.
  if coalesce(cardinality(friend_ids_input), 0) > 0 then
    if cardinality(friend_ids_input) not in (1, 3)
       or (select count(distinct x) from unnest(friend_ids_input) x where x is not null) <> cardinality(friend_ids_input) then
      raise exception 'Valitse kaksinpeliin yksi ja nelinpeliin kolme pelikaveria.';
    end if;
    if v_uid = any (friend_ids_input) or exists (
      select 1 from unnest(friend_ids_input) x
      where not exists (select 1 from public.krossi_booking_friends(v_uid) f where f.user_id = x)
    ) then
      raise exception 'Voit jakaa maksun vain pelikavereidesi kanssa.';
    end if;
    v_parts := cardinality(friend_ids_input) + 1;
    v_deadline := starts_at_input - make_interval(hours => v_venue.share_deadline_hours);
    if v_deadline - now() < interval '30 minutes' then
      raise exception 'Jaettu maksu ei ehdi enää — vuoro alkaa pian. Maksa vuoro itse.';
    end if;
    v_friend_cents := v_price / v_parts;
    if v_friend_cents < 50 then
      raise exception 'Vuoro on liian edullinen jaettavaksi.';
    end if;
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
      payment_status, hold_expires_at, created_by, paid_at, split_parts, own_cents, share_deadline
    ) values (
      v_venue.id, v_court.id, starts_at_input, v_end, 'booking',
      case when v_price = 0 then 'confirmed' else 'held' end,
      v_uid, v_price,
      case when v_price = 0 then 'free' else 'unpaid' end,
      case when v_price = 0 then null else now() + make_interval(mins => v_venue.hold_minutes) end,
      v_uid,
      case when v_price = 0 then now() end,
      v_parts,
      case when v_parts is not null then v_price - v_friend_cents * (v_parts - 1) end,
      v_deadline
    )
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'Joku ehti varata tämän ajan juuri ennen sinua. Valitse toinen aika.';
  end;

  if v_parts is not null then
    insert into public.booking_shares (reservation_id, user_id, kind, position, cents)
    select v_row.id, t.x, 'friend', t.ord::integer, v_friend_cents
    from unnest(friend_ids_input) with ordinality as t(x, ord);
  end if;
  if v_row.status = 'confirmed' then
    perform public.krossi_booking_after_confirm(v_row.id);
  end if;

  return public.krossi_booking_json(v_row);
end;
$function$;

revoke all on function public.krossi_hold_booking(uuid, timestamptz, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.krossi_hold_booking(uuid, timestamptz, integer, uuid[]) to authenticated, service_role;


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
  v_limit integer;
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
  select cancel_limit_hours into v_limit from public.booking_venues where id = v_row.venue_id;
  if now() < v_row.starts_at - make_interval(hours => v_limit) then
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


-- ── Jaettu maksu: osuudet ────────────────────────────────────────────────────

-- BookingShare[]: osuudet, jotka minun pitää tai piti maksaa (kavereiden varaukset, kun minulle
-- on kerrottu, ja omat loppuosuuteni): maksettavat ensin lähin maksuaika ensin, sitten muut
-- uusin vuoro ensin — viimeiset 30 päivää (ja maksamaton loppuosuus aina).
create function public.krossi_booking_my_shares()
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
    select jsonb_agg(x.j order by x.payable desc, case when x.payable then x.deadline end, x.starts_at desc, x.id)
    from (
      select public.krossi_booking_share_json(s) as j, s.id, r.share_deadline as deadline, r.starts_at,
             (s.status in ('pending', 'declined') and r.status = 'confirmed'
               and (s.kind = 'rest' or now() < r.share_deadline)) as payable
      from public.booking_shares s
      join public.booking_reservations r on r.id = s.reservation_id
      where s.user_id = v_uid
        and (s.kind = 'rest' or s.invited_at is not null)
        and (r.ends_at > now() - interval '30 days'
             or (s.kind = 'rest' and s.status = 'pending' and r.status = 'confirmed'))
      order by r.starts_at desc
      limit 60
    ) x
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.krossi_booking_my_shares() from public, anon, authenticated;
grant execute on function public.krossi_booking_my_shares() to authenticated, service_role;

-- BookingShare tai null: oma osuus (kun siitä on kerrottu) tai mikä tahansa oman varauksen osuus.
create function public.krossi_booking_share(share_id_input uuid)
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
    select public.krossi_booking_share_json(s)
    from public.booking_shares s
    join public.booking_reservations r on r.id = s.reservation_id
    where s.id = share_id_input
      and ((s.user_id = v_uid and (s.kind = 'rest' or s.invited_at is not null)) or r.booked_by = v_uid)
  );
end;
$function$;

revoke all on function public.krossi_booking_share(uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_share(uuid) to authenticated, service_role;

-- Miksi osuutta ei voi nyt maksaa (suomeksi, näytetään sellaisenaan), tai null kun voi (tai se
-- on jo maksettu). Sama sääntö sovelluksessa (demo) ja krossi-bookingissa.
create function public.krossi_booking_share_problem(share_id_input uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when s.status = 'paid' then null
    when s.status = 'covered' then 'Maksuaika päättyi — ' || public.krossi_booking_first_name(r.booked_by) || ' maksaa osuutesi.'
    when s.status in ('cancelled', 'refunded') or r.status <> 'confirmed' then 'Vuoro on peruttu — osuutta ei tarvitse maksaa.'
    when s.kind = 'friend' and now() >= r.share_deadline then 'Maksuaika päättyi.'
  end
  from public.booking_shares s
  join public.booking_reservations r on r.id = s.reservation_id
  where s.id = share_id_input;
$function$;

revoke all on function public.krossi_booking_share_problem(uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_share_problem(uuid) to service_role;

-- "En pääse": kaveri kertoo varaajalle (viesti heidän keskusteluunsa). Osuus jää maksamatta, ja
-- varaajan kortti maksaa sen maksuajan jälkeen — ellei kaveri sittenkin maksa.
create function public.krossi_booking_decline_share(share_id_input uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_share public.booking_shares;
  v_row public.booking_reservations;
  v_problem text;
begin
  if v_uid is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  select * into v_share from public.booking_shares where id = share_id_input;
  if not found or v_share.user_id is distinct from v_uid or v_share.kind <> 'friend' or v_share.invited_at is null then
    raise exception 'Osuutta ei löytynyt.';
  end if;
  -- varaus ensin, kuten maksussa ja peruutuksessa
  select * into v_row from public.booking_reservations where id = v_share.reservation_id for update;
  select * into v_share from public.booking_shares where id = share_id_input for update;
  if v_share.status = 'declined' then
    return;
  end if;
  if v_share.status = 'paid' then
    raise exception 'Osuutesi on jo maksettu. Jos et pääse, kerro siitä viestillä.';
  end if;
  v_problem := public.krossi_booking_share_problem(v_share.id);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;

  update public.booking_shares set status = 'declined', declined_at = now() where id = v_share.id;
  insert into public.messages (conversation_id, sender_id, content)
  select public.krossi_booking_direct_chat(v_uid, v_row.booked_by), v_uid,
         'En pääse valitettavasti mukaan vuoroon ' || public.krossi_booking_when(v_row.starts_at, v.timezone) || '.'
  from public.booking_venues v
  where v.id = v_row.venue_id;
end;
$function$;

revoke all on function public.krossi_booking_decline_share(uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_decline_share(uuid) to authenticated, service_role;


-- ── Hallin henkilökunta ──────────────────────────────────────────────────────

-- StaffItem[]: kuten vaiheessa 2 (kausivuoron haltija, seasonSlotId, credit) + forSale, unpaidCents
-- (maksamattomat kaverien osuudet ja maksamaton loppuosuus — tiski voi periä sen) ja parts.
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
      'forSale', r.status = 'confirmed' and r.listed_at is not null,
      'unpaidCents', coalesce((
        select sum(sh.cents)::integer from public.booking_shares sh
        where sh.reservation_id = r.id and sh.status in ('pending', 'declined')
      ), 0),
      'parts', r.split_parts
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
-- amount_input = kortilla maksettu summa: hinnan ja sen erotus otetaan lahjakorttisaldosta, kun
-- varaus vahvistuu (jaettu varaus maksetaan aina kortilla, eikä sille oteta saldoa). Uutta:
--   payment_method_input  jaetun varauksen kortti talteen loppuosuutta varten
--   vahvistuessa          kattamansa myynnissä olevat vuorot myydään tälle varaukselle ja
--                         kavereille kerrotaan osuuksista (krossi_booking_after_confirm)
--   uudelleenvahvistus    vanhentunut pito ei vie myynnissä olevaa vuoroa, jota se ei kata
--                         kokonaan (silloin 'lost')
drop function public.krossi_booking_mark_paid(uuid, text, integer);
create function public.krossi_booking_mark_paid(
  booking_id_input uuid,
  payment_intent_id_input text,
  amount_input integer default null,
  payment_method_input text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
  v_intent text := nullif(btrim(coalesce(payment_intent_id_input, '')), '');
  v_method text := nullif(btrim(coalesce(payment_method_input, '')), '');
  v_gift integer;
  v_confirm boolean := false;
begin
  if v_intent is null then
    raise exception 'Maksun tunniste puuttuu.';
  end if;
  if v_method is not null and v_method !~ '^pm_[A-Za-z0-9_]+$' then
    v_method := null;
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
    when amount_input is null or v_row.split_parts is not null then 0
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
           hold_expires_at = null, gift_cents = v_gift, paid_at = now(),
           stripe_payment_method_id = case when split_parts is not null then coalesce(v_method, stripe_payment_method_id) end
     where id = v_row.id
    returning * into v_row;
    if v_gift > 0 then
      insert into public.booking_credit_events (venue_id, user_id, kind, booking_id, cents, label)
      values (v_row.venue_id, v_row.booked_by, 'use', v_row.id, -v_gift, public.krossi_booking_label(v_row));
    end if;
    perform public.krossi_booking_after_confirm(v_row.id);
    return 'confirmed';
  end if;

  update public.booking_reservations
     set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), stripe_payment_intent_id = v_intent
   where id = v_row.id;
  return 'lost';
end;
$function$;

revoke all on function public.krossi_booking_mark_paid(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.krossi_booking_mark_paid(uuid, text, integer, text) to service_role;

-- Osuuden maksu onnistui (kaverin tai varaajan loppuosuus). Palauttaa:
--   'paid'       osuus on nyt maksettu (myös toistokutsulla samalla maksulla)
--   'duplicate'  osuus oli jo maksettu toisella maksulla tai loppuosuus maksoi sen → palauta tämä
--   'cancelled'  vuoro on peruttu (tai osuus jo palautettu) → palauta tämä
-- Varaus lukitaan ensin, kuten peruutuksessa ja maksuajan käsittelyssä: maksu ja peruutus /
-- loppuosuus eivät mene ristiin.
create function public.krossi_booking_share_mark_paid(share_id_input uuid, payment_intent_id_input text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_intent text := nullif(btrim(coalesce(payment_intent_id_input, '')), '');
  v_share public.booking_shares;
  v_row public.booking_reservations;
begin
  if v_intent is null then
    raise exception 'Maksun tunniste puuttuu.';
  end if;
  select * into v_share from public.booking_shares where id = share_id_input;
  if not found then
    raise exception 'Osuutta ei löytynyt.';
  end if;
  select * into v_row from public.booking_reservations where id = v_share.reservation_id for update;
  select * into v_share from public.booking_shares where id = share_id_input for update;

  if v_share.status in ('paid', 'refunded') then
    if v_share.stripe_payment_intent_id is distinct from v_intent then
      return 'duplicate';
    end if;
    return case when v_share.status = 'paid' then 'paid' else 'cancelled' end;
  end if;
  if v_share.status = 'covered' then
    return 'duplicate';
  end if;
  if v_share.status = 'cancelled' or v_row.status <> 'confirmed' then
    return 'cancelled';
  end if;

  update public.booking_shares
     set status = 'paid', paid_at = now(), stripe_payment_intent_id = v_intent, charge_error = null
   where id = v_share.id;
  return 'paid';
end;
$function$;

revoke all on function public.krossi_booking_share_mark_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.krossi_booking_share_mark_paid(uuid, text) to service_role;

-- Maksetut osat, jotka pitää palauttaa: [{ shareId (null = varaajan oma), kind ('own' | 'friend' |
-- 'rest'), paymentIntentId, cents }].
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
      'cents', coalesce(r.own_cents, r.price_cents - r.gift_cents)
    ) as part
    from public.booking_reservations r
    where r.id = booking_id_input
      and r.payment_status = 'paid'
      and r.stripe_payment_intent_id is not null
    union all
    select s.position + 1, jsonb_build_object(
      'shareId', s.id,
      'kind', s.kind,
      'paymentIntentId', s.stripe_payment_intent_id,
      'cents', s.cents
    )
    from public.booking_shares s
    where s.reservation_id = booking_id_input
      and s.status = 'paid'
      and s.stripe_payment_intent_id is not null
  ) x;
$function$;

revoke all on function public.krossi_booking_paid_parts(uuid) from public, anon, authenticated;
grant execute on function public.krossi_booking_paid_parts(uuid) to service_role;

-- Peruu varauksen (pelaaja ennen peruutusrajaa tai henkilökunta) ja palauttaa sen maksetut
-- osat palautettaviksi (krossi_booking_paid_parts). Maksamattomat osuudet perutaan heti, joten
-- myöhässä tuleva kaverin maksu palautetaan ('cancelled'). Sarjakortin minuutit ja
-- lahjakorttiosuus palautuvat heti (kuten krossi_booking_mark_cancelled); kokonaan krediitillä
-- maksettu varaus on silloin palautettu. refund_input false = henkilökunta perui ilman hyvitystä:
-- mitään ei palauteta. Jo peruttu varaus: ei muutoksia, palautukset yhä listataan (uusintayritys).
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
  update public.booking_shares
     set status = 'cancelled'
   where reservation_id = v_row.id
     and status in ('pending', 'declined');
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

-- Kirjaa palautukset: refunds_input = [{ shareId (null = varaajan oma osuus), refundId }]. Kun
-- maksettuja osia ei enää ole, refund_due_at nollautuu.
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
             stripe_refund_id = coalesce(nullif(v_part->>'refundId', ''), stripe_refund_id)
       where id = (v_part->>'shareId')::uuid and reservation_id = booking_id_input and status = 'paid';
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

-- Ajastettu (krossi-booking-cron): jaetut varaukset, joiden maksuaika on mennyt ja joissa on
-- maksamattomia kaverin osuuksia. Ne siirtyvät varaajan loppuosuudeksi (kind 'rest', 'covered'),
-- joka palautetaan veloitettavaksi tallennetulta kortilta: [{ shareId, bookingId, userId,
-- cents, paymentMethodId }]. Uusi loppuosuus palautuu kerran; jumiin jäänyt (veloitus alkoi
-- yli 15 min sitten eikä tulosta kirjattu) palautuu uudelleen — Stripen idempotenssiavain
-- (krossi-booking-rest-<osuus>) estää kaksinkertaisen veloituksen.
create function public.krossi_booking_due_rests(limit_input integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(limit_input, 50), 200));
  v_row public.booking_reservations;
  v_rest public.booking_shares;
  v_cents integer;
  v_out jsonb := '[]'::jsonb;
begin
  for v_row in
    select r.*
    from public.booking_reservations r
    where r.split_parts is not null
      and r.status = 'confirmed'
      and r.payment_status = 'paid'
      and r.share_deadline <= now()
      and not exists (select 1 from public.booking_shares s where s.reservation_id = r.id and s.kind = 'rest')
      and exists (
        select 1 from public.booking_shares s
        where s.reservation_id = r.id and s.kind = 'friend' and s.status in ('pending', 'declined')
      )
    order by r.share_deadline, r.id
    limit v_limit
    for update of r skip locked
  loop
    select coalesce(sum(s.cents), 0)::integer into v_cents
    from public.booking_shares s
    where s.reservation_id = v_row.id and s.kind = 'friend' and s.status in ('pending', 'declined');
    insert into public.booking_shares (reservation_id, user_id, kind, position, cents, charge_attempted_at)
    values (v_row.id, v_row.booked_by, 'rest', 99, v_cents, now())
    returning * into v_rest;
    update public.booking_shares
       set status = 'covered', covered_by = v_rest.id
     where reservation_id = v_row.id and kind = 'friend' and status in ('pending', 'declined');
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'shareId', v_rest.id,
      'bookingId', v_row.id,
      'userId', v_row.booked_by,
      'cents', v_cents,
      'paymentMethodId', v_row.stripe_payment_method_id
    ));
  end loop;

  for v_rest in
    update public.booking_shares s
       set charge_attempted_at = now()
     where s.id in (
       select x.id from public.booking_shares x
       where x.kind = 'rest'
         and x.status = 'pending'
         and x.charge_error is null
         and x.stripe_payment_intent_id is null
         and x.charge_attempted_at < now() - interval '15 minutes'
       order by x.charge_attempted_at
       limit v_limit
       for update skip locked
     )
    returning s.*
  loop
    v_out := v_out || jsonb_build_array((
      select jsonb_build_object(
        'shareId', v_rest.id,
        'bookingId', r.id,
        'userId', r.booked_by,
        'cents', v_rest.cents,
        'paymentMethodId', r.stripe_payment_method_id
      )
      from public.booking_reservations r where r.id = v_rest.reservation_id
    ));
  end loop;
  return v_out;
end;
$function$;

revoke all on function public.krossi_booking_due_rests(integer) from public, anon, authenticated;
grant execute on function public.krossi_booking_due_rests(integer) to service_role;

-- Tallennetun kortin veloitus ei onnistunut: Stripen syy talteen ('card_declined', …). Osuus
-- jää varaajan maksettavaksi sovelluksessa.
create function public.krossi_booking_rest_failed(share_id_input uuid, error_input text)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.booking_shares
     set charge_error = left(coalesce(nullif(btrim(coalesce(error_input, '')), ''), 'failed'), 80)
   where id = share_id_input and kind = 'rest' and status = 'pending';
$function$;

revoke all on function public.krossi_booking_rest_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.krossi_booking_rest_failed(uuid, text) to service_role;

-- Ajastettu: perutut / myydyt varaukset, joiden palautukset jäivät kesken (yli 2 min):
-- [{ bookingId, resold }].
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
-- Vaiheen 2 versiot (20261016100000), kaksi muutosta: jaettua varausta ei makseta sarjakortilla
-- eikä lahjakorttisaldolla (sen osuudet maksetaan kortilla, ja kortti tallentuu loppuosuutta
-- varten), ja kokonaan krediitillä vahvistuva varaus ottaa kattamansa myynnissä olevat vuorot
-- kuten korttimaksu (krossi_booking_after_confirm). Oikeudet pysyvät ennallaan.

-- Sisäinen: kutsujan oma, voimassa oleva ja maksamaton pito lukittuna (ei jaettu).
create or replace function public.krossi_wallet_payable_booking(booking_id_input uuid, user_id_input uuid)
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
  if v_row.split_parts is not null then
    raise exception 'Jaetun vuoron osuudet maksetaan kortilla.';
  end if;
  return v_row;
end;
$function$;

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
  perform public.krossi_booking_after_confirm(v_row.id);
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
    perform public.krossi_booking_after_confirm(v_row.id);
  else
    update public.booking_reservations set gift_cents = v_share where id = v_row.id returning * into v_row;
  end if;
  return public.krossi_booking_json(v_row);
end;
$function$;

notify pgrst, 'reload schema';
