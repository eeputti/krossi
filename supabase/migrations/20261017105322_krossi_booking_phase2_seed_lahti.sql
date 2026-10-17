-- Krossi-kenttävaraus, vaihe 2: Lahden Tennis- ja Squashkeskuksen talvikausi, sarjakortit ja
-- laskutuksen pohja.
--
-- Halli on yhä piilossa (is_public = false, ks. 20261016074309_krossi_booking_seed_lahti.sql).
-- TARKISTETTAVA hallin kanssa ennen julkaisua:
--   * kauden päivät ja pyhät, kausialennus (tässä 15 %)
--   * sarjakorttien sisältö ja hinnat (tässä 10 × 1 h 260 € ja 20 × 1 h 480 €, voimassa 12 kk)
--   * laskutustiedot: virallinen nimi, Y-tunnus, osoite, IBAN ja BIC — jätetty tyhjiksi, joten
--     laskulla maksettavaa kausivuoroa ei voi hyväksyä ennen kuin ne on täytetty:
--       update public.booking_billing_settings
--          set seller_name = '…', business_id = '…', address = '…', iban = 'FI…', bic = '…', email = '…'
--        where venue_id = 'b00c0000-0000-4000-a000-000000000001';
--   * ALV-kanta (oletus 14 %, liikuntapalvelut) — vahvista hallin kirjanpitäjältä.
--
-- Kiinteät uuid:t: b00c0000-0000-4000-a010-… kaudet, b00c0000-0000-4000-a011-… sarjakortit.

insert into public.booking_billing_settings (venue_id, seller_name, vat_percent, payment_terms_days, next_invoice_number)
values ('b00c0000-0000-4000-a000-000000000001', 'Lahden Tennis- ja Squashkeskus', 14.0, 14, 1001)
on conflict (venue_id) do nothing;

-- Talvikausi 2026–2027: ma 31.8.2026 – su 2.5.2027. Ei kausivuoroja itsenäisyyspäivänä, jouluna,
-- uutenavuotena, loppiaisena eikä pääsiäisenä (pitkäperjantai 26.3. ja 2. pääsiäispäivä 29.3.2027).
insert into public.booking_seasons (id, venue_id, name, starts_on, ends_on, skip_dates, discount_percent, requests_open)
values (
  'b00c0000-0000-4000-a010-000000000001', 'b00c0000-0000-4000-a000-000000000001', 'Talvikausi 2026–2027',
  '2026-08-31', '2027-05-02',
  '{2026-12-06,2026-12-24,2026-12-25,2026-12-26,2026-12-31,2027-01-01,2027-01-06,2027-03-26,2027-03-29}',
  15, true
)
on conflict (id) do nothing;

insert into public.booking_pass_products (id, venue_id, name, sport, uses, minutes_per_use, valid_days, price_cents, description, sort)
values
  ('b00c0000-0000-4000-a011-000000000001', 'b00c0000-0000-4000-a000-000000000001', 'Tennis 10 × 1 h', 'tennis', 10, 60, 365, 26000,
   'Käy kaikkiin tennisvuoroihin, myös iltoihin ja viikonloppuun. Pidemmästä vuorosta kuluu enemmän.', 1),
  ('b00c0000-0000-4000-a011-000000000002', 'b00c0000-0000-4000-a000-000000000001', 'Tennis 20 × 1 h', 'tennis', 20, 60, 365, 48000,
   'Edullisin tuntihinta.', 2)
on conflict (id) do nothing;
