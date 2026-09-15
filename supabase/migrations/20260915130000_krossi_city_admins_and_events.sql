-- Kaupunkikohtaiset Krossi-adminit (esim. tenniscoachit), jotka saavat luoda
-- tapahtumia (challenges.challenge_type = 'event') tietyissä kaupungeissa.
-- Erillinen taulu koutsi_admins-taulusta: koutsi_admins on Koutsi- ja
-- Krossi-sovellusten yhteinen superadmin-roolitus, eikä sitä haluta laajentaa
-- kaupunkikohtaisuudella (vaikuttaisi myös Koutsiin). Superadmin (koutsi_admins)
-- saa hallita kaikkia kaupunkeja aina, krossi_is_admin()-ohituksen kautta.
--
-- Ei RLS-policyja: kaikki luku/kirjoitus kulkee alla olevien SECURITY DEFINER
-- -funktioiden kautta, joten suora taulukysely asiakkaalta on aina evätty.
create table public.krossi_city_admins (
  user_id uuid not null references auth.users(id) on delete cascade,
  city text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, city)
);

alter table public.krossi_city_admins enable row level security;

-- true jos käyttäjä on superadmin tai kaupunkikohtainen admin annetulle kaupungille
create or replace function public.krossi_can_manage_city(city_input text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
     and city_input is not null
     and (
       public.krossi_is_admin()
       or exists (
         select 1 from public.krossi_city_admins a
         where a.user_id = (select auth.uid()) and a.city = city_input
       )
     );
$function$;

revoke all on function public.krossi_can_manage_city(text) from public, anon;
grant execute on function public.krossi_can_manage_city(text) to authenticated, service_role;

-- kaupungit joissa nykyinen käyttäjä saa luoda tapahtumia (superadmineille
-- sovellus näyttää suoraan koko kaupunkilistan, joten tämä palauttaa vain
-- eksplisiittisesti myönnetyt kaupunkikohtaiset oikeudet)
create or replace function public.krossi_my_admin_cities()
returns text[]
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(array_agg(a.city order by a.city), '{}'::text[])
  from public.krossi_city_admins a
  where a.user_id = (select auth.uid());
$function$;

revoke all on function public.krossi_my_admin_cities() from public, anon;
grant execute on function public.krossi_my_admin_cities() to authenticated, service_role;

-- superadmin-työkalu: korvaa kohdekäyttäjän kaupunkikohtaiset admin-oikeudet
-- kokonaan annetulla listalla (tyhjä lista = poistaa kaikki oikeudet)
create or replace function public.krossi_admin_set_city_admin(target_user_id_input uuid, cities_input text[])
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.krossi_is_admin() then
    raise exception 'not allowed';
  end if;
  if target_user_id_input is null then
    raise exception 'user not found';
  end if;

  delete from public.krossi_city_admins where user_id = target_user_id_input;

  insert into public.krossi_city_admins (user_id, city)
  select target_user_id_input, city
  from unnest(coalesce(cities_input, '{}'::text[])) as city
  where btrim(city) <> '';
end;
$function$;

revoke all on function public.krossi_admin_set_city_admin(uuid, text[]) from public, anon;
grant execute on function public.krossi_admin_set_city_admin(uuid, text[]) to authenticated, service_role;

-- krossi_admin_users palauttaa nyt myös kaupunkikohtaiset tapahtuma-admin-oikeudet,
-- jotta ylläpitonäkymä voi näyttää ja muokata niitä pelaajakortilta. Palautustyyppi
-- muuttuu (uusi sarake), joten vanha funktio pitää pudottaa ensin.
drop function if exists public.krossi_admin_users();
create or replace function public.krossi_admin_users()
returns table (
  user_id uuid,
  display_name text,
  email text,
  joined_at timestamptz,
  is_admin boolean,
  area text,
  hidden_from_feed boolean,
  paid_at timestamptz,
  challenges_created integer,
  matches_recorded integer,
  admin_cities text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.krossi_is_admin() then
    raise exception 'not allowed';
  end if;

  return query
  select
    u.id,
    coalesce(nullif(btrim(p.name), ''), split_part(coalesce(u.email, ''), '@', 1), 'Nimetön')::text,
    u.email::text,
    u.created_at,
    exists (select 1 from public.koutsi_admins a where a.user_id = u.id),
    p.area,
    coalesce(p.hidden_from_feed, false),
    p.paid_at,
    (select count(*)::integer from public.challenges c where c.creator_id = u.id),
    (select count(*)::integer from public.match_results m where m.created_by = u.id),
    coalesce((select array_agg(ca.city order by ca.city) from public.krossi_city_admins ca where ca.user_id = u.id), '{}'::text[])
  from auth.users u
  join public.profiles p on p.id = u.id
  order by u.created_at desc;
end;
$function$;

revoke all on function public.krossi_admin_users() from public, anon;
grant execute on function public.krossi_admin_users() to authenticated, service_role;

-- Haasteet (public.challenges) voivat nyt olla:
--   'open'  = pelaajien luomat maksuttomat haasteet, entisellään
--   'event' = adminien/valmentajien luomat tapahtumat (usein osallistumismaksullisia,
--             esim. "Friday Afternoon Club"). Tapahtumalta vaaditaan kaupunki ja
--             pelaajakatto (max_players), ja sen saa luoda vain kyseisen kaupungin
--             admin tai superadmin — ei edellytetä maksettua Krossi-tiliä, koska
--             luoja on organisaattori eikä maksava pelaaja.
drop policy if exists "authenticated users can create challenges" on public.challenges;
create policy "authenticated users can create challenges"
on public.challenges for insert
to authenticated
with check (
  auth.uid() = creator_id
  and (
    (challenge_type = 'open' and current_user_has_paid())
    or (challenge_type = 'event' and krossi_can_manage_city(city))
  )
);

alter table public.challenges
  add constraint challenges_event_requires_fields
  check (challenge_type <> 'event' or (city is not null and max_players is not null and max_players >= 2));
