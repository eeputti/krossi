-- Krossi: hallikohtainen saldo — pelaaja lataa rahaa yhden hallin saldoon ja maksaa sillä vuoroja
-- ja jaetun vuoron osuuksia ilman uutta korttimaksua (ei Stripen kulua joka kerta).
--
-- Saldo on vaiheen 2 lahjakorttisaldo (booking_credit_events, pass_id is null): yksi summa per
-- pelaaja ja halli, johon tulevat lunastetut lahjakortit, lataukset ja palautukset. Varaus maksetaan
-- sillä kuten ennenkin (krossi_wallet_use_gift, booking_reservations.gift_cents).
--
--   Lataus (booking_topups)  25 / 50 / 100 € krossi-billingin kassasta (tilaus kind 'topup',
--                            metadata.product 'krossi_topup'): destination charge hallille, Krossin
--                            osuus _shared/fees.ts:n mukaan, kuten sarja- ja lahjakorteissa.
--                            krossi_wallet_order_paid kirjaa saldoon 'topup'-rivin.
--   Oma peruutus saldoon     krossi_booking_cancel(…, to_saldo_input): kortilla maksettu osuus
--                            saldoon kokonaan (ei peruutuskulua, ei Stripen palautusta);
--                            kortille palautus pitää 1 €:n peruutuskulun kuten ennen.
--   Jaettu maksu             saldolla maksetun vuoron voi jakaa. Kaverin osuus palaa varaajalle
--                            sinne, mistä hän maksoi: saldo-osuuden verran saldoon (booker_saldo),
--                            loput kortille kuten ennen. Kirjautunut kaveri voi maksaa osuutensa
--                            omalla saldollaan samassa hallissa (krossi_split_pay_saldo,
--                            paid_with_saldo); peruttu vuoro palauttaa sen hänen saldoonsa.
--   Palautus kortille        käyttämätön ladattu saldo takaisin latauksen kortille pyynnöstä
--                            (krossi_saldo_refund_claim → krossi-billing saldoRefund): vain
--                            lataukset, 180 päivän sisällä latauksesta, uusin ensin. 14 päivää
--                            latauksesta palautus on ilmainen, sen jälkeen 1 € (pyöreä, näkyy ennen
--                            vahvistusta; jää hallille kuten peruutuskulu). Saldo ei vanhene.
--
-- Ei koskaan: siirtoja pelaajalta toiselle (paitsi jaetun vuoron osuus, joka on maksu vuorosta),
-- saldoa usean hallin käyttöön tai käteisnostoja — se olisi sähköistä rahaa (Finanssivalvonnan
-- toimilupa). Saldo on hallin ennakkomaksu omista vuoroistaan.
--
-- Muutokset aiempiin:
--   booking_credit_events.kind + 'topup', 'card_refund'
--   booking_shares + paid_with_saldo, booker_saldo (booking_shares_paid sallii saldolla maksetun)
--   booking_reservations + saldo_refund_cents
--   create or replace: krossi_wallet_products (+ topup), krossi_wallet (+ refundable…),
--     krossi_wallet_order_paid (+ 'topup'), krossi_booking_return_credit (saldo-osuudet),
--     krossi_split_paid_json (+ bookerSaldo), krossi_split_mark_paid (osuus varaajan saldoon),
--     krossi_booking_paid_parts (saldoon menneet osuudet eivät vähennä korttiosaa),
--     krossi_split_booking (saldolla maksettu käy), krossi_booking_split_json (+ backTo),
--     krossi_split_public (+ venueId), krossi_booking_venue_json (+ saldo)
--   drop + create: krossi_booking_cancel (+ to_saldo_input default false; vanha kutsu toimii)
-- Lisäävä: vanhat edge-funktiot toimivat tämän päällä ennen uusien julkaisua. Koutsiin ei kosketa.

-- ── Taulut ───────────────────────────────────────────────────────────────────

-- status: 'pending' (tilattu, ei maksettu) → 'paid'. refunded_cents = kortille palautettu
-- (palautuskulu mukaan lukien): latauksesta voi palauttaa vielä amount_cents − refunded_cents.
create table public.booking_topups (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.booking_venues(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents integer not null,
  status text not null default 'pending',
  stripe_payment_intent_id text unique,
  paid_at timestamptz,
  refunded_cents integer not null default 0,
  created_at timestamptz not null default now(),
  constraint booking_topups_status check (status in ('pending', 'paid')),
  constraint booking_topups_amount check (amount_cents > 0),
  constraint booking_topups_paid check (status = 'pending' or (paid_at is not null and stripe_payment_intent_id is not null)),
  constraint booking_topups_refunded check (refunded_cents >= 0 and refunded_cents <= amount_cents)
);

create index booking_topups_user_idx on public.booking_topups (user_id, venue_id, paid_at desc);

-- Palautus kortille: yksi rivi per lataus, jolta pyyntö palauttaa. status: 'due' (Stripen palautus
-- tekemättä) → 'done'; 'failed' = Stripe ei ottanut palautusta, summa palautui saldoon.
create table public.booking_saldo_refunds (
  id uuid primary key default gen_random_uuid(),
  topup_id uuid not null references public.booking_topups(id) on delete cascade,
  venue_id uuid not null references public.booking_venues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  cents integer not null,
  fee_cents integer not null default 0,
  status text not null default 'due',
  stripe_refund_id text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  constraint booking_saldo_refunds_status check (status in ('due', 'done', 'failed')),
  constraint booking_saldo_refunds_cents check (cents >= 0 and fee_cents >= 0 and cents + fee_cents > 0)
);

create index booking_saldo_refunds_due_idx on public.booking_saldo_refunds (created_at) where status = 'due';
create index booking_saldo_refunds_topup_idx on public.booking_saldo_refunds (topup_id);

alter table public.booking_credit_events
  drop constraint booking_credit_events_kind,
  add constraint booking_credit_events_kind
    check (kind in ('purchase', 'use', 'refund', 'redeem', 'adjust', 'topup', 'card_refund'));

alter table public.booking_shares
  -- kaveri maksoi osuutensa omalla saldollaan (ei Stripe-maksua)
  add column paid_with_saldo boolean not null default false,
  -- osuuden summa meni varaajan saldoon (ei Stripen palautusta varaajan maksusta)
  add column booker_saldo boolean not null default false,
  drop constraint booking_shares_paid,
  add constraint booking_shares_paid check (
    status not in ('paid', 'refunded') or (paid_at is not null and (stripe_payment_intent_id is not null or paid_with_saldo))
  ),
  add constraint booking_shares_saldo check (not paid_with_saldo or stripe_payment_intent_id is null),
  add constraint booking_shares_booker_saldo check (not booker_saldo or booker_refunded_at is not null);

alter table public.booking_reservations
  -- varaajan oma peruutus saldoon: kortilla maksetusta osuudesta saldoon siirretty summa
  add column saldo_refund_cents integer not null default 0,
  add constraint booking_reservations_saldo_refund check (saldo_refund_cents >= 0 and saldo_refund_cents <= price_cents);

alter table public.booking_topups enable row level security;
alter table public.booking_saldo_refunds enable row level security;
revoke all on table public.booking_topups, public.booking_saldo_refunds from anon, authenticated;
grant all on table public.booking_topups, public.booking_saldo_refunds to service_role;


-- ── Säännöt ──────────────────────────────────────────────────────────────────

-- Latausvaihtoehdot ja kortille palautuksen ehdot (sovellus näyttää samat: wallet.products.topup).
create function public.krossi_saldo_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_object(
    'amounts', jsonb_build_array(2500, 5000, 10000),
    'refundFreeDays', 14,
    'refundDays', 180,
    'refundFeeCents', 100
  );
$function$;

revoke all on function public.krossi_saldo_rules() from public, anon, authenticated;

-- Mitä kortille voi palauttaa nyt: käytettävissä oleva saldo, enintään lataukset (180 pv sisällä,
-- palauttamatta oleva osa), uusin lataus ensin. Palautuskulu 1 €, jos mukana on yli 14 päivää
-- vanha lataus; se otetaan vanhimman rivin osuudesta. →
--   { totalCents (saldosta pois), feeCents, cents (kortille), freeUntil (ISO, milloin kulu alkaa;
--     null = kulu on jo), rows: [{ topupId, paymentIntentId, cents, feeCents }] }
create function public.krossi_saldo_refund_plan(user_id_input uuid, venue_id_input uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_rules jsonb := public.krossi_saldo_rules();
  v_left integer := greatest(0, public.krossi_wallet_gift_available(user_id_input, venue_id_input, null));
  v_rows jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_fee integer := 0;
  v_fee_left integer;
  v_old boolean := false;
  v_free_until timestamptz;
  v_take integer;
  v_i integer;
  v_row jsonb;
  v_topup record;
begin
  for v_topup in
    select t.id, t.stripe_payment_intent_id, t.amount_cents - t.refunded_cents as remaining, t.paid_at
    from public.booking_topups t
    where t.user_id = user_id_input
      and t.venue_id = venue_id_input
      and t.status = 'paid'
      and t.refunded_cents < t.amount_cents
      and t.paid_at > now() - make_interval(days => (v_rules->>'refundDays')::integer)
    order by t.paid_at desc, t.id desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_topup.remaining);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'topupId', v_topup.id, 'paymentIntentId', v_topup.stripe_payment_intent_id, 'cents', v_take, 'feeCents', 0
    ));
    v_total := v_total + v_take;
    v_left := v_left - v_take;
    if v_topup.paid_at <= now() - make_interval(days => (v_rules->>'refundFreeDays')::integer) then
      v_old := true;
    else
      v_free_until := least(coalesce(v_free_until, 'infinity'::timestamptz),
        v_topup.paid_at + make_interval(days => (v_rules->>'refundFreeDays')::integer));
    end if;
  end loop;

  if v_old then
    v_fee := least((v_rules->>'refundFeeCents')::integer, v_total);
    -- Kulu vanhimmista riveistä alkaen.
    v_fee_left := v_fee;
    for v_i in reverse jsonb_array_length(v_rows) - 1 .. 0 loop
      exit when v_fee_left <= 0;
      v_row := v_rows->v_i;
      v_take := least(v_fee_left, (v_row->>'cents')::integer);
      v_rows := jsonb_set(v_rows, array[v_i::text], v_row
        || jsonb_build_object('cents', (v_row->>'cents')::integer - v_take, 'feeCents', v_take));
      v_fee_left := v_fee_left - v_take;
    end loop;
  end if;

  return jsonb_build_object(
    'totalCents', v_total,
    'feeCents', v_fee,
    'cents', v_total - v_fee,
    'freeUntil', case when v_old or v_free_until is null then null else public.krossi_booking_iso(v_free_until) end,
    'rows', v_rows
  );
end;
$function$;

revoke all on function public.krossi_saldo_refund_plan(uuid, uuid) from public, anon, authenticated;


-- ── Lompakko ─────────────────────────────────────────────────────────────────

-- TopUp
create function public.krossi_wallet_topup_json(t public.booking_topups)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', t.id,
    'venueId', t.venue_id,
    'amountCents', t.amount_cents,
    'status', t.status,
    'paidAt', public.krossi_booking_iso(t.paid_at),
    'createdAt', public.krossi_booking_iso(t.created_at)
  );
$function$;

revoke all on function public.krossi_wallet_topup_json(public.booking_topups) from public, anon, authenticated;

-- Kuten vaiheessa 2 + topup: { amounts, refundFreeDays, refundDays, refundFeeCents }.
create or replace function public.krossi_wallet_products(venue_id_input uuid)
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
    ),
    'topup', public.krossi_saldo_rules()
  );
end;
$function$;

-- Kuten vaiheessa 2 + mitä saldosta voi palauttaa kortille: refundableCents (kortille, kulun
-- jälkeen), refundFeeCents, refundFreeUntil.
create or replace function public.krossi_wallet(venue_id_input uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_plan jsonb;
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
  v_plan := public.krossi_saldo_refund_plan(v_uid, venue_id_input);
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
    ), '[]'::jsonb),
    'refundableCents', greatest(0, (v_plan->>'cents')::integer),
    'refundFeeCents', case when (v_plan->>'cents')::integer > 0 then (v_plan->>'feeCents')::integer else 0 end,
    'refundFreeUntil', case when (v_plan->>'cents')::integer > 0 then v_plan->>'freeUntil' end
  );
end;
$function$;

-- Tilaa saldon latauksen (maksamaton 'pending'; saman summan maksamaton lataus käytetään
-- uudelleen). Maksu krossi-billingin kassasta (orderConfig / orderIntent kind 'topup'). → TopUp
create function public.krossi_wallet_topup(venue_id_input uuid, amount_cents_input integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_topup public.booking_topups;
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
  if amount_cents_input is null
     or not (public.krossi_saldo_rules()->'amounts') @> to_jsonb(amount_cents_input) then
    raise exception 'Valitse ladattava summa: 25, 50 tai 100 €.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Täytä ensin pelaajaprofiilisi.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('krossi_wallet_order:' || v_uid::text, 0));
  select * into v_topup from public.booking_topups
   where user_id = v_uid and venue_id = venue_id_input and amount_cents = amount_cents_input and status = 'pending'
   order by created_at desc
   limit 1;
  if not found then
    insert into public.booking_topups (venue_id, user_id, amount_cents)
    values (venue_id_input, v_uid, amount_cents_input)
    returning * into v_topup;
  end if;
  return public.krossi_wallet_topup_json(v_topup);
end;
$function$;

revoke all on function public.krossi_wallet_topup(uuid, integer) from public, anon, authenticated;
grant execute on function public.krossi_wallet_topup(uuid, integer) to authenticated, service_role;

-- Kuten vaiheessa 2 + 'topup': lataus maksettiin → saldoon 'topup'-rivi. Palauttaa 'paid' |
-- 'duplicate' (kutsuja palauttaa maksun).
create or replace function public.krossi_wallet_order_paid(kind_input text, order_id_input uuid, payment_intent_id_input text, amount_input integer)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pass public.booking_passes;
  v_card public.booking_gift_cards;
  v_topup public.booking_topups;
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
  elsif kind_input = 'topup' then
    select * into v_topup from public.booking_topups where id = order_id_input for update;
    if not found then
      raise exception 'Tilausta ei löytynyt.';
    end if;
    if v_topup.status <> 'pending' then
      return case when v_topup.stripe_payment_intent_id = v_intent then 'paid' else 'duplicate' end;
    end if;
    if amount_input is distinct from v_topup.amount_cents then
      return 'duplicate';
    end if;
    update public.booking_topups
       set status = 'paid', paid_at = now(), stripe_payment_intent_id = v_intent
     where id = v_topup.id
    returning * into v_topup;
    insert into public.booking_credit_events (venue_id, user_id, kind, cents, label)
    values (v_topup.venue_id, v_topup.user_id, 'topup', v_topup.amount_cents, 'Saldon lataus');
    return 'paid';
  end if;
  raise exception 'Tuntematon tilaus.';
end;
$function$;


-- ── Palautus kortille (vain service_role: krossi-billing, krossi-booking-cron, stripe-webhook) ──

-- Pelaajan pyyntö: ottaa palautettavan summan saldosta heti (krossi_saldo_refund_plan) ja jättää
-- Stripen palautukset tehtäviksi. → { cents, feeCents, refunds: [{ id, paymentIntentId, cents,
-- feeCents, topupId }] } (kortille menevät rivit; pelkän kulun rivi on valmis heti).
create function public.krossi_saldo_refund_claim(user_id_input uuid, venue_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan jsonb;
  v_row jsonb;
  v_refund public.booking_saldo_refunds;
  v_refunds jsonb := '[]'::jsonb;
begin
  if user_id_input is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('krossi_wallet:' || user_id_input::text, 0));
  v_plan := public.krossi_saldo_refund_plan(user_id_input, venue_id_input);
  if (v_plan->>'cents')::integer <= 0 then
    raise exception 'Kortille palautettavaa saldoa ei ole.';
  end if;

  insert into public.booking_credit_events (venue_id, user_id, kind, cents, label)
  values (venue_id_input, user_id_input, 'card_refund', -(v_plan->>'totalCents')::integer,
    'Palautus kortille' || case
      when (v_plan->>'feeCents')::integer <= 0 then ''
      when (v_plan->>'feeCents')::integer % 100 = 0 then ' (palautuskulu ' || ((v_plan->>'feeCents')::integer / 100)::text || ' €)'
      else ' (palautuskulu ' || replace(to_char((v_plan->>'feeCents')::integer / 100.0, 'FM990.00'), '.', ',') || ' €)'
    end);

  for v_row in select value from jsonb_array_elements(v_plan->'rows') loop
    insert into public.booking_saldo_refunds (topup_id, venue_id, user_id, cents, fee_cents, status, done_at)
    values ((v_row->>'topupId')::uuid, venue_id_input, user_id_input, (v_row->>'cents')::integer,
      (v_row->>'feeCents')::integer,
      case when (v_row->>'cents')::integer = 0 then 'done' else 'due' end,
      case when (v_row->>'cents')::integer = 0 then now() end)
    returning * into v_refund;
    update public.booking_topups
       set refunded_cents = refunded_cents + v_refund.cents + v_refund.fee_cents
     where id = v_refund.topup_id;
    if v_refund.status = 'due' then
      v_refunds := v_refunds || jsonb_build_array(jsonb_build_object(
        'id', v_refund.id, 'paymentIntentId', v_row->>'paymentIntentId', 'cents', v_refund.cents,
        'feeCents', v_refund.fee_cents, 'topupId', v_refund.topup_id
      ));
    end if;
  end loop;

  return jsonb_build_object('cents', (v_plan->>'cents')::integer, 'feeCents', (v_plan->>'feeCents')::integer, 'refunds', v_refunds);
end;
$function$;

revoke all on function public.krossi_saldo_refund_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.krossi_saldo_refund_claim(uuid, uuid) to service_role;

-- Stripe otti palautuksen (refund_id_input). Kirjataan kerran.
create function public.krossi_saldo_refund_done(refund_id_input uuid, stripe_refund_id_input text)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.booking_saldo_refunds
     set status = 'done', done_at = now(), stripe_refund_id = nullif(btrim(coalesce(stripe_refund_id_input, '')), '')
   where id = refund_id_input and status = 'due';
$function$;

revoke all on function public.krossi_saldo_refund_done(uuid, text) from public, anon, authenticated;
grant execute on function public.krossi_saldo_refund_done(uuid, text) to service_role;

-- Stripe ei ottanut palautusta (tai se epäonnistui jälkikäteen, stripe-webhook): rivin summa ja
-- sen kulu palaavat saldoon ja lataukselle. Kerran per rivi; stripe_refund_id_input (jos annettu)
-- täsmää jo kirjattuun palautukseen. → boolean (palautettiinko saldoon nyt)
create function public.krossi_saldo_refund_failed(refund_id_input uuid, stripe_refund_id_input text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_refund public.booking_saldo_refunds;
  v_stripe text := nullif(btrim(coalesce(stripe_refund_id_input, '')), '');
begin
  update public.booking_saldo_refunds
     set status = 'failed', done_at = now()
   where id = refund_id_input
     and (status = 'due' or (status = 'done' and v_stripe is not null and stripe_refund_id = v_stripe))
  returning * into v_refund;
  if not found then
    return false;
  end if;
  update public.booking_topups
     set refunded_cents = greatest(0, refunded_cents - v_refund.cents - v_refund.fee_cents)
   where id = v_refund.topup_id;
  insert into public.booking_credit_events (venue_id, user_id, kind, cents, label)
  values (v_refund.venue_id, v_refund.user_id, 'refund', v_refund.cents + v_refund.fee_cents,
    'Palautus kortille ei onnistunut — summa palautui saldoon');
  return true;
end;
$function$;

revoke all on function public.krossi_saldo_refund_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.krossi_saldo_refund_failed(uuid, text) to service_role;

-- Ajastettu (krossi-booking-cron): kortille palautukset, joita Stripe ei vielä ottanut (yli 2 min):
-- [{ id, paymentIntentId, cents, topupId }].
create function public.krossi_saldo_refunds_due(limit_input integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id, 'paymentIntentId', x.stripe_payment_intent_id, 'cents', x.cents, 'topupId', x.topup_id
  ) order by x.created_at), '[]'::jsonb)
  from (
    select r.id, t.stripe_payment_intent_id, r.cents, r.topup_id, r.created_at
    from public.booking_saldo_refunds r
    join public.booking_topups t on t.id = r.topup_id
    where r.status = 'due'
      and r.created_at <= now() - interval '2 minutes'
    order by r.created_at
    limit greatest(1, least(coalesce(limit_input, 50), 200))
  ) x;
$function$;

revoke all on function public.krossi_saldo_refunds_due(integer) from public, anon, authenticated;
grant execute on function public.krossi_saldo_refunds_due(integer) to service_role;


-- ── Jaettu maksu ja peruutus ─────────────────────────────────────────────────

-- Sisäinen: perutun tai myydyn varauksen krediitti takaisin (vaihe 4) + saldo:
--   * kavereiden saldolla maksamat osuudet palaavat heidän saldoonsa
--   * varaajan saldo-osuudesta palautuu se, mitä kavereiden osuudet eivät jo palauttaneet saldoon
create or replace function public.krossi_booking_return_credit(r public.booking_reservations, why_input text)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_share public.booking_shares;
  v_back integer;
begin
  for v_share in
    update public.booking_shares
       set status = 'refunded', refunded_at = coalesce(refunded_at, now())
     where reservation_id = r.id and paid_with_saldo and status = 'paid'
    returning *
  loop
    if v_share.payer_user_id is not null then
      insert into public.booking_credit_events (venue_id, user_id, kind, booking_id, cents, label)
      values (r.venue_id, v_share.payer_user_id, 'refund', r.id, v_share.cents,
              why_input || ': osuus ' || public.krossi_booking_label(r));
    end if;
  end loop;

  if r.payment_status not in ('paid', 'credit') or r.booked_by is null then
    return;
  end if;
  if r.pass_id is not null and r.pass_minutes > 0 then
    update public.booking_passes set minutes_left = least(minutes_total, minutes_left + r.pass_minutes)
     where id = r.pass_id;
    insert into public.booking_credit_events (venue_id, user_id, kind, pass_id, booking_id, minutes, label)
    values (r.venue_id, r.booked_by, 'refund', r.pass_id, r.id, r.pass_minutes, why_input || ': ' || public.krossi_booking_label(r));
  elsif r.gift_cents > 0 then
    v_back := r.gift_cents - coalesce((
      select sum(s.cents) from public.booking_shares s where s.reservation_id = r.id and s.booker_saldo
    ), 0)::integer;
    if v_back > 0 then
      insert into public.booking_credit_events (venue_id, user_id, kind, booking_id, cents, label)
      values (r.venue_id, r.booked_by, 'refund', r.id, v_back, why_input || ': ' || public.krossi_booking_label(r));
    end if;
  end if;
end;
$function$;

-- Sisäinen: maksetun osuuden summa varaajan saldoon, jos hän maksoi vuoroa saldolla ja sitä on
-- vielä palauttamatta osuuden verran (muuten summa palautetaan hänen korttimaksustaan kuten ennen:
-- krossi-booking refundBooker). → osuus (booker_saldo, booker_refunded_at, kun meni saldoon)
create function public.krossi_split_to_booker(r public.booking_reservations, s public.booking_shares)
returns public.booking_shares
language plpgsql
set search_path = ''
as $function$
declare
  v_share public.booking_shares := s;
  v_room integer;
  v_payer text;
begin
  if s.status <> 'paid' or s.booker_refunded_at is not null or r.booked_by is null or r.status <> 'confirmed'
     or r.payment_status not in ('paid', 'credit') or r.pass_id is not null or r.gift_cents <= 0 then
    return s;
  end if;
  v_room := r.gift_cents - coalesce((
    select sum(x.cents) from public.booking_shares x where x.reservation_id = r.id and x.booker_saldo and x.id <> s.id
  ), 0)::integer;
  if v_room < s.cents then
    return s;
  end if;
  update public.booking_shares set booker_saldo = true, booker_refunded_at = now() where id = s.id
  returning * into v_share;
  v_payer := coalesce(
    case when s.payer_user_id is not null then public.krossi_booking_first_name(s.payer_user_id) end,
    nullif(split_part(btrim(coalesce(s.payer_name, '')), ' ', 1), ''),
    'Kaveri');
  insert into public.booking_credit_events (venue_id, user_id, kind, booking_id, cents, label)
  values (r.venue_id, r.booked_by, 'refund', r.id, s.cents, v_payer || ' maksoi osuutensa: ' || public.krossi_booking_label(r));
  return v_share;
end;
$function$;

revoke all on function public.krossi_split_to_booker(public.booking_reservations, public.booking_shares) from public, anon, authenticated;

-- Kuten vaiheessa 4 + bookerSaldo: osuuden summa meni varaajan saldoon (sähköposti kertoo sen).
create or replace function public.krossi_split_paid_json(r public.booking_reservations, s public.booking_shares)
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
    -- sama summa palautetaan varaajan maksusta, ellei sitä ole jo tehty, se mennyt saldoon tai koko
    -- maksua palautettu
    'bookerRefundDue', s.booker_refunded_at is null and r.status = 'confirmed' and r.payment_status = 'paid'
      and r.stripe_payment_intent_id is not null,
    'bookerSaldo', s.booker_saldo
  );
$function$;

-- Kuten vaiheessa 4; maksettu osuus menee varaajan saldoon, kun hän maksoi vuoroa saldolla
-- (krossi_split_to_booker), muuten se palautetaan hänen korttimaksustaan (bookerRefundDue).
create or replace function public.krossi_split_mark_paid(
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
  v_share := public.krossi_split_to_booker(v_row, v_share);
  return public.krossi_split_paid_json(v_row, v_share);
end;
$function$;

-- Kirjautunut kaveri maksaa osuutensa omalla saldollaan samassa hallissa (krossi-booking
-- splitSaldo; ei Stripe-maksua). Ottaa kaverin oman aloitetun osuuden (krossi-booking peruu sen
-- korttimaksun ensin), avoimen tai vanhentuneen osuuden. →
--   { state: 'paid', …krossi_split_paid_json, cancelIntentId (vanhentuneen aloituksen maksu, jonka
--     kutsuja peruu) }
--   { state: 'short', saldoCents } | { state: 'full' | 'over' | 'cancelled' | 'unknown' | 'own' }
create function public.krossi_split_pay_saldo(token_input text, user_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
  v_share public.booking_shares;
  v_payer record;
  v_available integer;
  v_previous text;
begin
  if user_id_input is null then
    raise exception 'Kirjaudu sisään ensin.';
  end if;
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
  if user_id_input = v_row.booked_by then
    return jsonb_build_object('state', 'own');
  end if;

  select * into v_share
  from public.booking_shares s
  where s.reservation_id = v_row.id
    and (s.status = 'open'
         or (s.status = 'pending' and (s.claim_expires_at <= now() or s.payer_user_id = user_id_input)))
  order by (s.status = 'pending' and s.payer_user_id = user_id_input) desc, s.position
  limit 1;
  if not found then
    return jsonb_build_object('state', 'full');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('krossi_wallet:' || user_id_input::text, 0));
  v_available := public.krossi_wallet_gift_available(user_id_input, v_row.venue_id, null);
  if v_available < v_share.cents then
    return jsonb_build_object('state', 'short', 'saldoCents', greatest(0, v_available));
  end if;

  v_previous := v_share.stripe_payment_intent_id;
  select * into v_payer from public.krossi_split_payer(null, user_id_input);
  update public.booking_shares
     set status = 'paid', paid_at = now(), paid_with_saldo = true, stripe_payment_intent_id = null,
         claim_id = null, claim_expires_at = null, payer_name = v_payer.payer_name, payer_user_id = v_payer.payer_user_id
   where id = v_share.id
  returning * into v_share;
  insert into public.booking_credit_events (venue_id, user_id, kind, booking_id, cents, label)
  values (v_row.venue_id, user_id_input, 'use', v_row.id, -v_share.cents, 'Osuus: ' || public.krossi_booking_label(v_row));
  v_share := public.krossi_split_to_booker(v_row, v_share);
  return public.krossi_split_paid_json(v_row, v_share)
    || jsonb_build_object('state', 'paid', 'cancelIntentId', v_previous);
end;
$function$;

revoke all on function public.krossi_split_pay_saldo(text, uuid) from public, anon, authenticated;
grant execute on function public.krossi_split_pay_saldo(text, uuid) to service_role;

-- Kuten vaiheessa 4; varaajan osa = hänen korttimaksustaan palauttamatta oleva summa: hinta miinus
-- saldo-osuus miinus kortille jo palautetut kavereiden osuudet (saldoon menneet eivät vähennä
-- korttimaksua). Saldolla maksettu kaverin osuus ei ole Stripe-maksu (krossi_booking_return_credit).
create or replace function public.krossi_booking_paid_parts(booking_id_input uuid)
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
        where s.reservation_id = r.id and s.booker_refunded_at is not null and not s.booker_saldo
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
      and not s.paid_with_saldo
      and (s.status = 'paid' or (s.status = 'refunded' and s.stripe_refund_id is null))
  ) x;
$function$;

-- Kuten vaiheessa 4 + to_saldo_input: varaajan oma peruutus, jossa kortilla maksettu osuus menee
-- saldoon kokonaan (ei peruutuskulua, ei Stripen palautusta; saldo_refund_cents). Ei käy, kun
-- kaverin maksettu osuus on vielä palauttamatta varaajalle (sen palautus on kesken). Vanha
-- kolmen argumentin kutsu toimii (to_saldo_input = false).
drop function public.krossi_booking_cancel(uuid, uuid, boolean);

create function public.krossi_booking_cancel(
  booking_id_input uuid,
  by_input uuid,
  refund_input boolean,
  to_saldo_input boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.booking_reservations;
  v_refund boolean := coalesce(refund_input, true);
  v_saldo boolean;
  v_own integer;
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

  v_saldo := coalesce(to_saldo_input, false) and v_refund
    and by_input is not null and by_input = v_row.booked_by
    and v_row.status = 'confirmed' and v_row.payment_status = 'paid' and v_row.stripe_payment_intent_id is not null;
  if v_saldo and exists (
    select 1 from public.booking_shares s
    where s.reservation_id = v_row.id and s.status = 'paid' and s.booker_refunded_at is null
  ) then
    raise exception 'Kaverin maksu on juuri käsittelyssä. Yritä hetken päästä uudelleen.';
  end if;

  update public.booking_reservations
     set status = 'cancelled', cancelled_at = now(), cancelled_by = by_input
   where id = v_row.id;
  if not v_refund then
    return '[]'::jsonb;
  end if;
  perform public.krossi_booking_return_credit(v_row, 'Peruttu');
  if v_saldo then
    v_own := v_row.price_cents - v_row.gift_cents - coalesce((
      select sum(s.cents) from public.booking_shares s
      where s.reservation_id = v_row.id and s.booker_refunded_at is not null and not s.booker_saldo
    ), 0)::integer;
    if v_own > 0 then
      insert into public.booking_credit_events (venue_id, user_id, kind, booking_id, cents, label)
      values (v_row.venue_id, v_row.booked_by, 'refund', v_row.id, v_own, 'Peruttu: ' || public.krossi_booking_label(v_row));
    end if;
    update public.booking_reservations
       set payment_status = 'refunded', saldo_refund_cents = greatest(0, v_own)
     where id = v_row.id;
  end if;
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

revoke all on function public.krossi_booking_cancel(uuid, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.krossi_booking_cancel(uuid, uuid, boolean, boolean) to service_role;

-- Kuten vaiheessa 4, mutta saldolla (kokonaan tai osin) maksetun vuoron voi jakaa; sarjakortilla
-- maksettua ei (minuutteja ei voi jakaa rahaksi).
create or replace function public.krossi_split_booking(p_booking_id uuid, p_parts integer)
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
    if v_row.pass_id is not null then
      raise exception 'Sarjakortilla maksettua vuoroa ei voi jakaa.';
    end if;
    if not (
      (v_row.payment_status = 'paid' and v_row.stripe_payment_intent_id is not null)
      or (v_row.payment_status = 'credit' and v_row.gift_cents = v_row.price_cents)
    ) then
      raise exception 'Vain maksetun vuoron voi jakaa.';
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

-- Kuten vaiheessa 4 + backTo kaverin rivillä: minne osuuden summa palasi varaajalle ('saldo' |
-- 'card'; null = ei vielä).
create or replace function public.krossi_booking_split_json(r public.booking_reservations)
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
        'refundedToBookerAt', public.krossi_booking_iso(s.booker_refunded_at),
        'backTo', case when s.booker_refunded_at is null then null when s.booker_saldo then 'saldo' else 'card' end
      ) order by s.position)
      from public.booking_shares s
      cross join lateral (select public.krossi_split_share_state(s) as state) x
      where s.reservation_id = r.id
    ), '[]'::jsonb)
  ) end;
$function$;

-- Kuten vaiheessa 4 + venueId (kirjautunut kaveri näkee saldonsa samassa hallissa).
create or replace function public.krossi_split_public(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'token', r.split_token,
    'venueId', r.venue_id,
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

-- BookingVenue: kuten vaiheessa 4 + saldo (tämä palvelin osaa saldon: lataus, peruutus saldoon,
-- osuus saldolla).
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
    'saldo', true,
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

notify pgrst, 'reload schema';
