-- Krossi: vierasvaraus tilille. Ilman tiliä varannut voi liittää varauksensa Krossi-tiliinsä, kun
-- luo tilin tai kirjautuu: varauksen linkin salainen tunniste (guest_token) todistaa, että varaus on
-- hänen — tunniste on vain vieraan sähköpostissa ja varanneen laitteen muistissa. Liitetty varaus
-- näkyy Omissa varauksissa ja sitä hoidetaan kuten muitakin omia varauksia (peruutus, jaettu maksu,
-- myyntiin laitto). Vieraan linkki näyttää varauksen yhä, mutta peruutus tehdään tililtä.
--
-- Sähköpostin perusteella ei liitetä: tilin sähköpostia ei vahvisteta, joten se ei todista, kenen
-- varaus on.
--
--   booking_reservations + guest_claimed_at; booking_reservations_guest sallii booked_by:n, kun
--                          varaus on liitetty
--   uusi: krossi_claim_guest_booking(token) (authenticated)
--   create or replace: krossi_guest_booking (+ claimed), krossi_guest_cancel (liitettyä ei peruta linkistä)
--
-- Lisäävä: nykyiset edge-funktiot ja sovellus toimivat tämän päällä sellaisinaan.

-- ── Sarakkeet ────────────────────────────────────────────────────────────────

alter table public.booking_reservations
  -- milloin vieras liitti varauksen tiliinsä (booked_by)
  add column guest_claimed_at timestamptz,
  drop constraint booking_reservations_guest,
  -- booked_by on vierasvarauksella vain liitettynä (ja voi palata tyhjäksi, jos profiili poistetaan)
  add constraint booking_reservations_guest check (
    guest_token is null
    or (kind = 'booking' and guest_name is not null and guest_email is not null
        and (booked_by is null or guest_claimed_at is not null))
  ),
  add constraint booking_reservations_guest_claimed check (guest_claimed_at is null or guest_token is not null);


-- ── Liitä tiliin ─────────────────────────────────────────────────────────────

-- Kirjautunut pelaaja liittää vierasvarauksen tiliinsä varauksen linkin tunnisteella. Vain voimassa
-- oleva (vahvistettu) varaus, jota ei ole jo liitetty toiseen tiliin; oman jo liitetyn uusinta palauttaa
-- sen. Tilillä pitää olla profiili (booked_by viittaa profiiliin). → krossi_booking_json
create function public.krossi_claim_guest_booking(token_input text)
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
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Kerro ensin nimesi.';
  end if;

  select * into v_row from public.booking_reservations
   where token_input is not null and guest_token = token_input
   for update;
  if not found then
    raise exception 'Varausta ei löytynyt.';
  end if;
  if v_row.booked_by = v_uid then
    return public.krossi_booking_json(v_row);
  end if;
  if v_row.booked_by is not null or v_row.guest_claimed_at is not null then
    raise exception 'Varaus on jo liitetty toiseen tiliin.';
  end if;
  if v_row.status <> 'confirmed' or v_row.guest_cancelled then
    raise exception 'Vain voimassa olevan varauksen voi liittää tiliin.';
  end if;

  update public.booking_reservations
     set booked_by = v_uid, guest_claimed_at = now()
   where id = v_row.id
  returning * into v_row;
  return public.krossi_booking_json(v_row);
end;
$function$;

revoke all on function public.krossi_claim_guest_booking(text) from public, anon;
grant execute on function public.krossi_claim_guest_booking(text) to authenticated, service_role;


-- ── Vieraan linkki: liitetty varaus ──────────────────────────────────────────

-- Varauslinkin näkymä: varaus (krossi_booking_json) + vieras + hallin tiedot, tai null.
-- claimed: varaus on liitetty tiliin (hoidetaan Omista varauksista).
create or replace function public.krossi_guest_booking(token_input text)
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
    'claimed', r.guest_claimed_at is not null,
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

-- Vieras perui vahvistetun varauksensa ennen peruutusrajaa: krossi_booking_cancel (by null) +
-- guest_cancelled, jotta peruutuskulu pidetään. → palautettavat osat (krossi_booking_paid_parts).
-- Jo peruttu: uusintayritys saa sen, mikä on yhä palauttamatta. Tiliin liitetty varaus perutaan tililtä.
create or replace function public.krossi_guest_cancel(token_input text)
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
  if v_row.guest_claimed_at is not null then
    raise exception 'Varaus on Krossi-tililläsi. Peru se omista varauksistasi.';
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
