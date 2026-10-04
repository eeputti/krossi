-- Krossi: kaksi tietoturva-/tietoeheyskorjausta, jotka julkaisun jälkeinen tarkistus löysi.
-- Krossi: two fixes found by the post-release review. Koutsi is unaffected: Koutsi never
-- writes profiles.paid_at / stripe_customer_id and never uses connection requests,
-- league fixtures or the Krossi conversations.
--
-- 1) Maksumuurin ohitus. authenticated-roolilla on INSERT-oikeus profiles.paid_at- ja
--    stripe_customer_id-sarakkeisiin, joten uusi käyttäjä pystyi luomaan oman profiilinsa
--    rajapinnan kautta valmiiksi "maksettuna". UPDATE on jo estetty. Oikeuksiin ei kosketa
--    (profiles on jaettu Koutsin kanssa); sen sijaan BEFORE INSERT -triggeri tyhjentää nämä
--    kaksi saraketta, kun rivin lisää asiakas (anon/authenticated). Stripe-webhook päivittää
--    paid_at:n service_rolella UPDATE-lauseella, joten se ei muutu.
--
-- 2) Pelipyynnön hyväksyntä ja liigaottelun chat etsivät "olemassa olevan keskustelun"
--    mistä tahansa keskustelusta, jossa molemmat ovat — myös pelin ryhmächatista. Silloin
--    yksityinen pyyntöviesti päätyi koko ryhmän nähtäväksi. Nyt kelpaa vain kahdenkeskinen
--    keskustelu (ei peliin sidottu, ei ryhmä, tasan kaksi osallistujaa). Muuten funktiot
--    ovat ennallaan.

-- ── 1) paid_at / stripe_customer_id vain palvelimelta ────────────────────────
create or replace function public.krossi_profiles_strip_payment_on_client_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user in ('anon', 'authenticated') then
    new.paid_at := null;
    new.stripe_customer_id := null;
  end if;
  return new;
end;
$function$;

revoke all on function public.krossi_profiles_strip_payment_on_client_insert() from public, anon, authenticated;

drop trigger if exists krossi_profiles_strip_payment_on_client_insert on public.profiles;
create trigger krossi_profiles_strip_payment_on_client_insert
  before insert on public.profiles
  for each row execute function public.krossi_profiles_strip_payment_on_client_insert();


-- ── 2) kahdenkeskinen keskustelu, ei pelin ryhmächat ─────────────────────────
-- Apufunktio: kahden käyttäjän olemassa oleva yksityinen keskustelu tai null.
create or replace function public.krossi_direct_conversation_id(user_a uuid, user_b uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select c.id
  from public.conversations c
  where c.challenge_id is null
    and coalesce(c.is_group, false) = false
    and exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.user_id = user_a)
    and exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.user_id = user_b)
    and (select count(*) from public.conversation_participants p where p.conversation_id = c.id) = 2
  order by c.updated_at desc
  limit 1;
$function$;

revoke all on function public.krossi_direct_conversation_id(uuid, uuid) from public, anon, authenticated;

create or replace function public.accept_connection_request(request_id_input uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  req record;
  existing_conversation_id uuid;
  new_conversation_id uuid;
begin
  select *
  into req
  from public.connection_requests
  where id = request_id_input
    and receiver_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'Pyyntöä ei löytynyt tai sitä ei voi hyväksyä.';
  end if;

  existing_conversation_id := public.krossi_direct_conversation_id(req.sender_id, req.receiver_id);

  if existing_conversation_id is null then
    insert into public.conversations default values returning id into new_conversation_id;

    insert into public.conversation_participants (conversation_id, user_id)
    values
      (new_conversation_id, req.sender_id),
      (new_conversation_id, req.receiver_id);
  else
    new_conversation_id := existing_conversation_id;
  end if;

  insert into public.messages (conversation_id, sender_id, content)
  values (new_conversation_id, req.sender_id, req.message);

  update public.connection_requests
  set status = 'accepted'
  where id = request_id_input;

  return new_conversation_id;
end;
$function$;

create or replace function public.move_connection_request_to_conversation(request_id_input uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  req record;
  existing_conversation_id uuid;
  target_conversation_id uuid;
begin
  select *
  into req
  from public.connection_requests
  where id = request_id_input
    and receiver_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'Pyyntöä ei löytynyt tai sitä ei voi siirtää keskusteluihin.';
  end if;

  existing_conversation_id := public.krossi_direct_conversation_id(req.sender_id, req.receiver_id);

  if existing_conversation_id is null then
    insert into public.conversations default values returning id into target_conversation_id;

    insert into public.conversation_participants (conversation_id, user_id)
    values
      (target_conversation_id, req.sender_id),
      (target_conversation_id, req.receiver_id);
  else
    target_conversation_id := existing_conversation_id;
  end if;

  insert into public.messages (conversation_id, sender_id, content)
  values (target_conversation_id, req.sender_id, req.message);

  update public.connection_requests
  set status = 'ignored'
  where id = request_id_input;

  return target_conversation_id;
end;
$function$;

create or replace function public.start_league_fixture_conversation(fixture_id_input uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  fx record;
  other_id uuid;
  existing_conversation_id uuid;
  new_conversation_id uuid;
begin
  select * into fx from public.league_fixtures where id = fixture_id_input;
  if not found then
    raise exception 'Ottelua ei löytynyt';
  end if;
  if auth.uid() not in (fx.player_a_id, fx.player_b_id) then
    raise exception 'Et ole tämän ottelun pelaaja';
  end if;

  other_id := case when fx.player_a_id = auth.uid() then fx.player_b_id else fx.player_a_id end;

  existing_conversation_id := public.krossi_direct_conversation_id(auth.uid(), other_id);

  if existing_conversation_id is null then
    insert into public.conversations default values returning id into new_conversation_id;
    insert into public.conversation_participants (conversation_id, user_id)
    values (new_conversation_id, auth.uid()), (new_conversation_id, other_id);
  else
    new_conversation_id := existing_conversation_id;
  end if;

  return new_conversation_id;
end;
$function$;
