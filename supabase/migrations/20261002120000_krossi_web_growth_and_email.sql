-- Krossi web (krossi.app/pelaa): kutsulinkit, jaettavan pelin julkinen esikatselu ja
-- sähköposti-ilmoitukset.
--
-- Krossi web: invite links, the public preview behind shared game links, and the
-- bookkeeping the krossi-notify edge function needs to send email.
--
-- Puhtaasti lisäävä: Koutsi käyttää samaa tietokantaa, joten tämä migraatio ei muuta
-- profiles-taulua eikä korvaa yhtään olemassa olevaa funktiota tai policya. Kaikki uudet
-- taulut ovat RLS:n takana ilman asiakaspolicyja — niihin pääsee vain alla olevien
-- SECURITY DEFINER -funktioiden (tai service_role-avaimen) kautta.
--
--   notification_preferences.email_enabled   sähköpostien pääkytkin (oletus päällä)
--   krossi_invite_codes                      käyttäjän lyhyt kutsukoodi (krossi.app/pelaa/kutsu/<koodi>)
--   krossi_referrals                         kuka liittyi kenen kutsulla (yksi rivi per kutsuttu)
--   krossi_email_log                         krossi-notify:n lähetysloki (toistojen esto / throttle)
--   krossi_public_challenge_preview(uuid)    jaetun pelilinkin esikatselu kirjautumattomalle
--   krossi_my_invite_code()                  oma kutsukoodi, luodaan ensimmäisellä kutsulla
--   krossi_resolve_invite(text)              kutsukoodi -> kutsujan etunimi (myös anon)
--   krossi_claim_invite(text)                uusi käyttäjä kirjaa kutsun itselleen
--   krossi_my_invites_joined()               montako omalla kutsulla on liittynyt


-- ── Sähköposti-ilmoitusten pääkytkin ─────────────────────────────────────────
-- Puuttuva notification_preferences-rivi tarkoittaa edelleen "kaikki päällä".
alter table public.notification_preferences
  add column if not exists email_enabled boolean not null default true;


-- ── Kutsukoodit ───────────────────────────────────────────────────────────────
-- 6 merkkiä aakkostosta, josta on poistettu helposti sekoittuvat merkit (0/O, 1/I/L).
create table if not exists public.krossi_invite_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  constraint krossi_invite_codes_code_format check (code ~ '^[A-HJKMNP-Z2-9]{6}$')
);

alter table public.krossi_invite_codes enable row level security;
revoke all on table public.krossi_invite_codes from anon, authenticated;


-- ── Kutsujen kirjaus ──────────────────────────────────────────────────────────
-- invitee_id on pääavain: jokainen käyttäjä voi tulla kutsutuksi vain kerran.
create table if not exists public.krossi_referrals (
  invitee_id uuid primary key references auth.users(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  code text,
  created_at timestamptz not null default now(),
  constraint krossi_referrals_not_self check (invitee_id <> inviter_id)
);

create index if not exists krossi_referrals_inviter_id_idx on public.krossi_referrals (inviter_id);

alter table public.krossi_referrals enable row level security;
revoke all on table public.krossi_referrals from anon, authenticated;


-- ── Sähköpostiloki (vain service_role) ───────────────────────────────────────
-- krossi-notify kirjoittaa rivin jokaisesta lähetetystä viestistä ja lukee sitä ennen
-- lähetystä: chat-viesteistä enintään yksi meili / keskustelu / 30 min, alueen uusista
-- peleistä enintään yksi / 6 h, muista sama tapahtuma vain kerran 10 minuutissa.
-- Rivejä ei tarvita kuin muutaman tunnin ajan; vanhat voi siivota vapaasti.
create table if not exists public.krossi_email_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  ref_id text,
  sent_at timestamptz not null default now()
);

create index if not exists krossi_email_log_lookup_idx
  on public.krossi_email_log (user_id, kind, ref_id, sent_at desc);

alter table public.krossi_email_log enable row level security;
revoke all on table public.krossi_email_log from anon, authenticated;
revoke all on sequence public.krossi_email_log_id_seq from anon, authenticated;


-- ── Jaetun pelilinkin julkinen esikatselu ────────────────────────────────────
-- krossi.app/pelaa/peli/<id> näyttää kirjautumattomalle (ja Cloudflare-workerin
-- Open Graph -kortille) vain nämä ei-arkaluonteiset kentät: luojasta pelkkä etunimi
-- ja avatarin väri, ei kuvaa, kuvausta, hintaa, koordinaatteja eikä osallistujia.
-- Vain avoimet/täydet, vanhenemattomat pelit; suorat (challenge_type = 'direct')
-- haasteet ovat kahden pelaajan välisiä eivätkä näy. Muuten palautuu null.
-- Vapaat paikat lasketaan samalla kaavalla kuin join_challenge-funktiossa.
create or replace function public.krossi_public_challenge_preview(challenge_id_input uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', c.id,
    'kind', case when c.challenge_type = 'event' then 'event' else 'open' end,
    'status', c.status,
    'creator_name', coalesce(nullif(split_part(btrim(p.name), ' ', 1), ''), 'Pelaaja'),
    'creator_avatar_color', coalesce(p.avatar_color, 'blue'),
    'match_type', c.match_type,
    'location', c.location,
    'location_type', c.location_type,
    'city', c.city,
    'scheduled_at', c.scheduled_at,
    'title', c.title,
    'spots_left', greatest(0, seats.capacity - seats.taken),
    'participant_count', seats.taken
  )
  from public.challenges c
  left join public.profiles p on p.id = c.creator_id
  cross join lateral (
    select count(*)::int as taken
    from public.challenge_participants cp
    where cp.challenge_id = c.id
  ) joined
  cross join lateral (
    select
      greatest(
        case when c.match_type = 'nelinpeli' then 3 else 1 end,
        case when c.max_players is not null and c.max_players > 1 then c.max_players - 1 else 0 end
      ) as capacity,
      joined.taken as taken
  ) seats
  where c.id = challenge_id_input
    and c.challenge_type in ('open', 'event')
    and c.status in ('open', 'filled')
    and (c.expires_at is null or c.expires_at > now());
$function$;

revoke all on function public.krossi_public_challenge_preview(uuid) from public, anon, authenticated;
grant execute on function public.krossi_public_challenge_preview(uuid) to anon, authenticated, service_role;


-- ── Oma kutsukoodi ────────────────────────────────────────────────────────────
-- Luo koodin ensimmäisellä kutsulla ja palauttaa saman koodin sen jälkeen aina.
-- Törmäyksessä (koodi varattu tai rinnakkainen kutsu ehti ensin) yritetään uudelleen.
create or replace function public.krossi_my_invite_code()
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  v_attempt int := 0;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select code into v_code from public.krossi_invite_codes where user_id = v_uid;
  if v_code is not null then
    return v_code;
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    begin
      insert into public.krossi_invite_codes (user_id, code) values (v_uid, v_code);
      return v_code;
    exception when unique_violation then
      -- Joko koodi oli jo jonkun muun, tai tämän käyttäjän rivi syntyi juuri rinnakkain.
      select code into v_code from public.krossi_invite_codes where user_id = v_uid;
      if v_code is not null then
        return v_code;
      end if;
      if v_attempt >= 20 then
        raise exception 'could not allocate an invite code';
      end if;
    end;
  end loop;
end;
$function$;

revoke all on function public.krossi_my_invite_code() from public, anon, authenticated;
grant execute on function public.krossi_my_invite_code() to authenticated, service_role;


-- ── Kutsukoodin tarkistus ────────────────────────────────────────────────────
-- Kutsunäkymä (myös kirjautumaton) näyttää "Eelis kutsuu sinut Krossiin". Palauttaa
-- vain kutsujan etunimen, tai null jos koodia ei ole. Koodi on kirjainkoosta riippumaton.
create or replace function public.krossi_resolve_invite(code_input text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'inviter_name', coalesce(nullif(split_part(btrim(p.name), ' ', 1), ''), 'Pelaaja')
  )
  from public.krossi_invite_codes ic
  left join public.profiles p on p.id = ic.user_id
  where ic.code = upper(btrim(code_input));
$function$;

revoke all on function public.krossi_resolve_invite(text) from public, anon, authenticated;
grant execute on function public.krossi_resolve_invite(text) to anon, authenticated, service_role;


-- ── Kutsun lunastus ───────────────────────────────────────────────────────────
-- Sovellus kutsuu tätä kerran onboardingin jälkeen. Kirjaa kutsun vain, jos kutsuja on
-- olemassa, kutsuttu ei ole kutsuja itse, kutsutulla on Krossi-pelaajaprofiili
-- (profiles + tennis_preferences), hän on uusi Krossi-pelaaja eikä hänellä ole vielä
-- kutsujaa. Kaikki muut tapaukset ohitetaan hiljaa, jotta sovelluksen ei tarvitse
-- erotella niitä.
--
-- "Uusi" päätellään vain tiedoista, joita asiakas ei voi itse kirjoittaa:
--   * tili (auth.users.created_at) on luotu alle 14 päivää sitten, TAI
--   * tilillä ei ole yhtään Krossi-jälkeä (luotuja tai liityttyjä pelejä, jonopaikkoja,
--     keskusteluja, lähetettyjä viestejä eikä tuloksia) — näin Koutsin vanha tili, joka
--     vasta nyt aloittaa Krossin, lasketaan uudeksi (Koutsi ei käytä näitä tauluja).
-- tennis_preferences.created_at ei kelpaa: käyttäjä voi päivittää oman rivinsä tai
-- poistaa ja luoda sen uudelleen ("users manage own preferences" FOR ALL), jolloin vanha
-- tili näyttäisi uudelta. profiles.created_at:ia ei myöskään käytetä, koska oman
-- profiilin INSERT sallii minkä tahansa created_at-arvon.
create or replace function public.krossi_claim_invite(code_input text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(code_input, '')));
  v_inviter uuid;
begin
  if v_uid is null then
    return;
  end if;

  select user_id into v_inviter from public.krossi_invite_codes where code = v_code;
  if v_inviter is null or v_inviter = v_uid then
    return;
  end if;

  if not exists (
    select 1
    from public.profiles p
    join public.tennis_preferences tp on tp.user_id = p.id
    where p.id = v_uid
  ) then
    return;
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = v_uid and u.created_at > now() - interval '14 days'
  ) and (
    exists (select 1 from public.challenges c where c.creator_id = v_uid)
    or exists (select 1 from public.challenge_participants cp where cp.user_id = v_uid)
    or exists (select 1 from public.challenge_waitlist w where w.user_id = v_uid)
    or exists (select 1 from public.conversation_participants cv where cv.user_id = v_uid)
    or exists (select 1 from public.messages m where m.sender_id = v_uid)
    or exists (select 1 from public.match_results mr where mr.created_by = v_uid)
  ) then
    return;
  end if;

  insert into public.krossi_referrals (invitee_id, inviter_id, code)
  values (v_uid, v_inviter, v_code)
  on conflict (invitee_id) do nothing;
end;
$function$;

revoke all on function public.krossi_claim_invite(text) from public, anon, authenticated;
grant execute on function public.krossi_claim_invite(text) to authenticated, service_role;


-- ── Omalla kutsulla liittyneet ───────────────────────────────────────────────
-- Pelillistäminen ("Kutsu kaveri" -merkki) lukee tämän.
create or replace function public.krossi_my_invites_joined()
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select count(*)::int
  from public.krossi_referrals r
  where r.inviter_id = (select auth.uid());
$function$;

revoke all on function public.krossi_my_invites_joined() from public, anon, authenticated;
grant execute on function public.krossi_my_invites_joined() to authenticated, service_role;


-- ── "Pelaan nyt" -tilan lopetus ──────────────────────────────────────────────
-- send-playing-now-email asettaa playing_now_until/-note, mutta asiakkaalla ei ole
-- UPDATE-oikeutta näihin sarakkeisiin, joten tilaa ei voinut lopettaa käsin. Tämä
-- tyhjentää vain kutsujan oman rivin kaksi Krossi-saraketta.
create or replace function public.krossi_stop_playing_now()
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.profiles
  set playing_now_until = null,
      playing_now_note = null
  where id = (select auth.uid())
    and (playing_now_until is not null or playing_now_note is not null);
$function$;

revoke all on function public.krossi_stop_playing_now() from public, anon, authenticated;
grant execute on function public.krossi_stop_playing_now() to authenticated, service_role;
