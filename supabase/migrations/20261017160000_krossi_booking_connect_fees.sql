-- Kenttävaraus: hallin oma Stripe-tili (Stripe Connect Express) ja Krossin osuus maksuista.
--
-- Jokainen maksu (varaus, kaverin osuus, kausivuoron kuukausi, sarja- ja lahjakortti) on
-- destination charge hallin tilille (supabase/functions/_shared/fees.ts). Stripe ottaa kulunsa
-- Krossin saldosta, joten Krossin osuus = Stripen arvioitu kulu (1,75 % + 0,36 €) + hallin kate
-- (platform_fee_bps + platform_fee_fixed_cents). Kate on 1 % jokaiselle hallille (oletus uusillekin):
-- se kattaa myös kalliimpien korttien (premium 2,8 %) lisäkulun ja Connectin kuukausimaksut, joten
-- Krossi ei maksa Stripen kuluja omastaan. Katetta voi muuttaa hallikohtaisesti. Palautuksessa
-- Krossin osuus jää (Stripe ei palauta omaa kuluaan). Kun pelaaja peruu vuoronsa itse, 1 €:n
-- peruutuskulu jää hallille (krossi-booking); hallin perumasta pelaaja saa kaiken takaisin.
--
-- krossi-connect luo hallin Express-tilin ja tallentaa stripe_account_id:n; se ja stripe-webhook
-- (account.updated) pitävät stripe_charges_enabled-, _payouts_enabled- ja _details_submitted-tiedot
-- ajan tasalla. Julkinen halli ottaa verkkomaksuja vain valmiille tilille (stripe_charges_enabled),
-- eikä hallia voi avata pelaajille (is_public = true) ennen kuin tili on valmis: muuten pelaajien
-- rahat menisivät Krossin omalle tilille.
--
-- Uudet sarakkeet eivät näy sovellukselle (sarakekohtaiset oikeudet, kuten stripe_account_id).
-- Riippuu vain vaiheen 1 taulusta; aja ennen kuin uudet krossi-booking, krossi-billing,
-- stripe-webhook ja krossi-connect julkaistaan (ne lukevat näitä sarakkeita).

alter table public.booking_venues
  add column platform_fee_fixed_cents integer not null default 0,
  add column stripe_charges_enabled boolean not null default false,
  add column stripe_payouts_enabled boolean not null default false,
  add column stripe_details_submitted boolean not null default false,
  add column stripe_checked_at timestamptz,
  add constraint booking_venues_fee_fixed check (platform_fee_fixed_cents between 0 and 500),
  alter column platform_fee_bps set default 100;

-- Krossin kate 1 % kaikille nykyisille halleille (ennen tätä 0 eikä Connect ollut käytössä).
update public.booking_venues set platform_fee_bps = 100 where platform_fee_bps = 0;

comment on column public.booking_venues.stripe_account_id is
  'Hallin Stripe Connect Express -tili (krossi-connect); null = ei tiliä.';
comment on column public.booking_venues.platform_fee_bps is
  'Krossin kate Stripen arvioidun kulun päälle, prosentteina (1 bps = 0,01 %); 100 = 1 %.';
comment on column public.booking_venues.platform_fee_fixed_cents is
  'Krossin kate Stripen arvioidun kulun päälle, sentteinä maksua kohden.';
comment on column public.booking_venues.stripe_charges_enabled is
  'Hallin Stripe-tili ottaa maksuja vastaan (card_payments ja transfers käytössä).';


-- Hallia ei avata pelaajille ennen kuin sen Stripe-tili on valmis. Vain siirtymä piilotetusta
-- julkiseksi tarkistetaan: jos Stripe myöhemmin rajoittaa julkisen hallin tiliä, halli pysyy
-- näkyvissä, mutta maksut eivät mene läpi ennen kuin tili on taas kunnossa.
create function public.krossi_booking_venue_public_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.is_public and (tg_op = 'INSERT' or not old.is_public)
     and not (new.stripe_account_id is not null and new.stripe_charges_enabled) then
    raise exception 'Hallin Stripe-tili ei ole valmis. Yhdistä se ensin (Hallin asetukset → Verkkomaksut), niin pelaajien maksut menevät hallille.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

revoke all on function public.krossi_booking_venue_public_guard() from public, anon, authenticated;

create trigger booking_venues_public_guard
  before insert or update of is_public on public.booking_venues
  for each row execute function public.krossi_booking_venue_public_guard();
