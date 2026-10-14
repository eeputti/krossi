-- Krossi-liigat: ylläpitäjä + hallisarja.
--
-- 1) Ylläpito. Liigan perustaja (leagues.created_by) on sen ylläpitäjä. Ylläpitäjä ja
--    Krossin moderaattorit (krossi_can_manage_city: Krossin ylläpito tai liigan kaupungin
--    ylläpitäjä) voivat poistaa liigan, poistaa pelaajan, päättää kauden ja kirjata tai
--    korjata tuloksia. Muut eivät.
--
-- 2) Hallisarja (format 'hallisarja'), Lahden hallisarjan sääntöjen mallin mukaan:
--    - kausi pelataan kierroksina (league_rounds: alku- ja loppupäivä), ja ylläpitäjä jakaa
--      lohkot itse jokaisen kierroksen alussa (krossi_start_league_round) — sovellus ehdottaa
--      nousut ja putoamiset edellisen kierroksen tuloksista
--    - lohkossa pelataan kerran jokaista vastaan; pelaajat sopivat ajat keskenään
--    - tunnin aikapeli (match_format 'timed'): tulos on pelatut geimit, tasapeli on mahdollinen
--      (winner_id null), voitto 2, tasapeli 1, häviö 0 pistettä
--    - ylläpitäjä voi kirjata luovutuksen (wo 6–0) tai tasapelin 3–3 ja hyväksyy kierroksen
--      päättyessä vahvistamatta jääneet ilmoitukset sellaisinaan
--    - uudet pelaajat voivat liittyä kesken kauden; he pääsevät lohkoon seuraavalla kierroksella
--    - julkinen sarjataulukko (is_public) kirjautumattomille, esim. hallin nettisivuille
--
-- Kaikki on lisäyksiä: vanhat liigat (format 'ladder') ja mobiilisovelluksen RPC:t
-- (create_league, join_league, start_league, report/confirm_league_fixture_result) toimivat
-- kuten ennen. Tulosten erät tallennetaan edelleen ilmoittajan näkökulmasta ({my, opp},
-- reported_by); ylläpitäjän kirjaamissa tuloksissa reported_by on pelaaja A ja confirmed_by
-- pelaaja B, joten viiteavaimet osoittavat aina ottelun pelaajiin (set_by kertoo kirjaajan).

-- ── Sarakkeet ────────────────────────────────────────────────────────────────

alter table public.leagues
  add column format text not null default 'ladder',
  add column match_format text not null default 'sets',
  add column description text,
  add column venue text,
  add column current_round int not null default 0,
  add column is_public boolean not null default false,
  add column updated_at timestamptz not null default now();

alter table public.leagues
  add constraint leagues_format_check check (format in ('ladder', 'hallisarja')),
  add constraint leagues_match_format_check check (match_format in ('sets', 'timed')),
  add constraint leagues_season_label_length check (length(season_label) <= 80),
  add constraint leagues_description_length check (description is null or length(description) <= 2000),
  add constraint leagues_venue_length check (venue is null or length(venue) <= 120),
  add constraint leagues_current_round_check check (current_round between 0 and 20);

create table public.league_rounds (
  league_id uuid not null references public.leagues(id) on delete cascade,
  round_number int not null check (round_number between 1 and 20),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed')),
  created_at timestamptz not null default now(),
  primary key (league_id, round_number),
  constraint league_rounds_dates_check check (ends_on >= starts_on)
);

alter table public.league_rounds enable row level security;

create policy "league rounds readable by signed-in users"
  on public.league_rounds for select to authenticated using (true);

-- false = pelaaja ei jatka seuraavalla kierroksella (hallisarja)
alter table public.league_members
  add column continues boolean not null default true;

-- Samat pelaajat voivat kohdata uudestaan myöhemmällä kierroksella.
alter table public.league_fixtures
  add column round_number int not null default 1;
alter table public.league_fixtures
  drop constraint league_fixtures_league_id_player_a_id_player_b_id_key;
alter table public.league_fixtures
  add constraint league_fixtures_round_pair_key unique (league_id, round_number, player_a_id, player_b_id);

alter table public.league_fixture_results
  alter column winner_id drop not null; -- tasapeli (vain aikapelissä, ks. RPC:t)
alter table public.league_fixture_results
  add column walkover boolean not null default false,
  add column set_by uuid references public.profiles(id) on delete set null;

alter publication supabase_realtime add table public.league_rounds;

-- ── Oikeudet ─────────────────────────────────────────────────────────────────

-- true = perustaja tai moderaattori (Krossin ylläpito / liigan kaupungin ylläpitäjä)
create or replace function public.krossi_can_manage_league(league_id_input uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.leagues l
       where l.id = league_id_input
         and (l.created_by = (select auth.uid()) or public.krossi_can_manage_city(l.city))
     );
$function$;

-- Sarjataulukon ja -ohjelman yksi tulos {a, b} (a = pelaaja A:n geimit) -> tallennusmuoto
-- pelaaja A:n näkökulmasta. Heittää virheen, jos rivit eivät ole kelvollisia.
create or replace function public.krossi_league_sets_from_a(sets_input jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  s jsonb;
  a int;
  b int;
  stored jsonb := '[]'::jsonb;
begin
  if sets_input is null or jsonb_typeof(sets_input) <> 'array'
     or jsonb_array_length(sets_input) < 1 or jsonb_array_length(sets_input) > 5 then
    raise exception 'Tarkista tulos';
  end if;
  for s in select * from jsonb_array_elements(sets_input) loop
    a := (s->>'a')::int;
    b := (s->>'b')::int;
    if a is null or b is null or a < 0 or b < 0 or a > 99 or b > 99 then
      raise exception 'Tarkista tulos';
    end if;
    stored := stored || jsonb_build_array(jsonb_build_object('my', a, 'opp', b));
  end loop;
  return stored;
end;
$function$;

-- ── Liigan luonti ja tiedot ──────────────────────────────────────────────────

-- Uusi luonti selainversiolle. create_league jää mobiilisovellukselle ennalleen.
-- rounds_input (vain hallisarja): [{"starts_on": "2026-11-23", "ends_on": "2027-01-17"}, …]
create or replace function public.krossi_create_league(
  city_input text,
  skill_level_input text,
  season_label_input text,
  format_input text default 'ladder',
  match_format_input text default null,
  group_size_input int default null,
  description_input text default null,
  venue_input text default null,
  rounds_input jsonb default '[]'::jsonb,
  organizer_plays boolean default true,
  is_public_input boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  new_id uuid;
  fmt text := coalesce(format_input, 'ladder');
  mf text;
  gs int;
  r jsonb;
  n int := 0;
begin
  if auth.uid() is null then
    raise exception 'Kirjaudu sisään';
  end if;
  if season_label_input is null or length(trim(season_label_input)) = 0 then
    raise exception 'Kaudelle tarvitaan nimi';
  end if;
  if fmt not in ('ladder', 'hallisarja') then
    raise exception 'Tuntematon liigan muoto';
  end if;
  mf := coalesce(match_format_input, case when fmt = 'hallisarja' then 'timed' else 'sets' end);
  gs := coalesce(group_size_input, case when fmt = 'hallisarja' then 5 else 6 end);
  if gs < 3 or gs > 10 then
    raise exception 'Lohkon koko voi olla 3–10 pelaajaa';
  end if;
  if rounds_input is not null and jsonb_typeof(rounds_input) <> 'array' then
    raise exception 'Tarkista kierrosten päivämäärät';
  end if;

  insert into public.leagues (
    created_by, city, skill_level, season_label, status, format, match_format, group_size,
    description, venue, is_public
  )
  values (
    auth.uid(), city_input, skill_level_input, trim(season_label_input), 'signup', fmt, mf, gs,
    nullif(trim(coalesce(description_input, '')), ''), nullif(trim(coalesce(venue_input, '')), ''),
    coalesce(is_public_input, false)
  )
  returning id into new_id;

  if fmt = 'hallisarja' then
    for r in select * from jsonb_array_elements(coalesce(rounds_input, '[]'::jsonb)) loop
      n := n + 1;
      insert into public.league_rounds (league_id, round_number, starts_on, ends_on)
      values (new_id, n, (r->>'starts_on')::date, (r->>'ends_on')::date);
    end loop;
  end if;

  -- Krossi-liigassa perustaja pelaa aina (kuten create_league); hallisarjan ylläpitäjä vain halutessaan.
  if fmt = 'ladder' or coalesce(organizer_plays, false) then
    insert into public.league_members (league_id, user_id) values (new_id, auth.uid());
  end if;

  return new_id;
end;
$function$;

-- Ylläpitäjä muokkaa nimeä, kuvausta, pelipaikkaa ja julkisuutta.
create or replace function public.krossi_update_league(
  league_id_input uuid,
  season_label_input text,
  description_input text,
  venue_input text,
  is_public_input boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.krossi_can_manage_league(league_id_input) then
    raise exception 'Vain liigan ylläpitäjä voi muokata liigaa';
  end if;
  if season_label_input is null or length(trim(season_label_input)) = 0 then
    raise exception 'Kaudelle tarvitaan nimi';
  end if;
  update public.leagues
  set season_label = trim(season_label_input),
      description = nullif(trim(coalesce(description_input, '')), ''),
      venue = nullif(trim(coalesce(venue_input, '')), ''),
      is_public = coalesce(is_public_input, false),
      updated_at = now()
  where id = league_id_input;
end;
$function$;

-- Ylläpitäjä tai moderaattori poistaa liigan (jäsenet, ottelut, tulokset ja kierrokset mukana).
create or replace function public.krossi_delete_league(league_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (select 1 from public.leagues where id = league_id_input) then
    raise exception 'Liigaa ei löytynyt';
  end if;
  if not public.krossi_can_manage_league(league_id_input) then
    raise exception 'Vain liigan ylläpitäjä tai Krossin moderaattori voi poistaa liigan';
  end if;
  delete from public.leagues where id = league_id_input;
end;
$function$;

-- Ylläpitäjä päättää kauden: kesken oleva kierros päättyy, tuloksia ei voi enää ilmoittaa.
create or replace function public.krossi_finish_league(league_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  lg record;
begin
  select * into lg from public.leagues where id = league_id_input for update;
  if not found then
    raise exception 'Liigaa ei löytynyt';
  end if;
  if not public.krossi_can_manage_league(league_id_input) then
    raise exception 'Vain liigan ylläpitäjä voi päättää kauden';
  end if;
  if lg.status = 'completed' then
    return;
  end if;
  if lg.status = 'signup' then
    raise exception 'Kausi ei ole vielä alkanut';
  end if;
  update public.league_rounds set status = 'completed'
  where league_id = league_id_input and status = 'active';
  update public.leagues set status = 'completed', updated_at = now() where id = league_id_input;
end;
$function$;

-- ── Jäsenet ──────────────────────────────────────────────────────────────────

-- Krossi-liigaan liitytään ilmoittautumisen aikana; hallisarjaan myös kesken kauden
-- (lohko seuraavalla kierroksella).
create or replace function public.join_league(league_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  lg record;
  already boolean;
begin
  select * into lg from public.leagues where id = league_id_input for update;
  if not found then
    raise exception 'Liigaa ei löytynyt';
  end if;
  if lg.status = 'completed' or (lg.status = 'active' and lg.format <> 'hallisarja') then
    raise exception 'Liigan ilmoittautuminen on päättynyt';
  end if;

  select exists (
    select 1 from public.league_members
    where league_id = league_id_input and user_id = auth.uid()
  ) into already;
  if already then
    return;
  end if;

  insert into public.league_members (league_id, user_id) values (league_id_input, auth.uid());
end;
$function$;

-- Pelaaja perii ilmoittautumisensa. Lohkoon jo sijoitettu pelaaja voi lähteä vain
-- hallisarjan kierrosten välissä.
create or replace function public.krossi_leave_league(league_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  lg record;
  mem record;
begin
  select * into lg from public.leagues where id = league_id_input for update;
  if not found then
    raise exception 'Liigaa ei löytynyt';
  end if;
  select * into mem from public.league_members
  where league_id = league_id_input and user_id = auth.uid();
  if not found then
    return;
  end if;

  if lg.status <> 'signup' and mem.group_number is not null then
    if lg.format <> 'hallisarja' then
      raise exception 'Kausi on jo käynnissä, joten et voi enää poistua liigasta';
    end if;
    if exists (
      select 1 from public.league_rounds
      where league_id = league_id_input and round_number = lg.current_round and status = 'active'
    ) then
      raise exception 'Kierros on vielä käynnissä. Merkitse, ettet jatka seuraavalla kierroksella';
    end if;
  end if;

  delete from public.league_members where id = mem.id;
end;
$function$;

-- Hallisarja: jatkanko seuraavalla kierroksella?
create or replace function public.krossi_set_league_continues(league_id_input uuid, continues_input boolean)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.league_members
  set continues = coalesce(continues_input, true)
  where league_id = league_id_input and user_id = auth.uid();
  if not found then
    raise exception 'Et ole tämän sarjan pelaaja';
  end if;
end;
$function$;

-- Ylläpitäjä poistaa pelaajan. Kesken olevan kierroksen lohkosta ei voi poistaa — silloin
-- jäljellä olevat ottelut kirjataan luovutuksiksi.
create or replace function public.krossi_remove_league_member(league_id_input uuid, user_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  lg record;
  mem record;
begin
  select * into lg from public.leagues where id = league_id_input for update;
  if not found then
    raise exception 'Liigaa ei löytynyt';
  end if;
  if not public.krossi_can_manage_league(league_id_input) then
    raise exception 'Vain liigan ylläpitäjä voi poistaa pelaajia';
  end if;
  select * into mem from public.league_members
  where league_id = league_id_input and user_id = user_id_input;
  if not found then
    return;
  end if;

  if lg.status = 'active' and mem.group_number is not null and (
    lg.format <> 'hallisarja'
    or exists (
      select 1 from public.league_rounds
      where league_id = league_id_input and round_number = lg.current_round and status = 'active'
    )
  ) then
    raise exception 'Pelaaja on mukana kesken olevassa lohkossa. Kirjaa hänen jäljellä olevat ottelunsa luovutuksiksi ja poista hänet kierroksen jälkeen';
  end if;

  delete from public.league_members where id = mem.id;
end;
$function$;

-- ── Hallisarjan kierrokset ───────────────────────────────────────────────────

-- Aloittaa seuraavan kierroksen ylläpitäjän jakamilla lohkoilla.
-- groups_input: [[uuid, uuid, …], [uuid, …]] ylimmästä lohkosta alimpaan (A, B, C, …).
-- Lohkoihin sijoittamattomat jäsenet ovat tauolla tämän kierroksen.
create or replace function public.krossi_start_league_round(
  league_id_input uuid,
  groups_input jsonb,
  starts_on_input date,
  ends_on_input date
)
returns int
language plpgsql
security definer
set search_path = public
as $function$
declare
  lg record;
  n int;
  grp jsonb;
  ids uuid[];
  all_ids uuid[] := '{}';
  g int := 0;
  i int;
  j int;
begin
  select * into lg from public.leagues where id = league_id_input for update;
  if not found then
    raise exception 'Liigaa ei löytynyt';
  end if;
  if not public.krossi_can_manage_league(league_id_input) then
    raise exception 'Vain sarjan ylläpitäjä voi aloittaa kierroksen';
  end if;
  if lg.format <> 'hallisarja' then
    raise exception 'Kierrokset ovat käytössä vain hallisarjoissa';
  end if;
  if lg.status = 'completed' then
    raise exception 'Kausi on jo päättynyt';
  end if;
  if exists (select 1 from public.league_rounds where league_id = league_id_input and status = 'active') then
    raise exception 'Edellinen kierros on vielä kesken — päätä se ensin';
  end if;
  if starts_on_input is null or ends_on_input is null or ends_on_input < starts_on_input then
    raise exception 'Tarkista kierroksen päivämäärät';
  end if;
  if groups_input is null or jsonb_typeof(groups_input) <> 'array' or jsonb_array_length(groups_input) = 0 then
    raise exception 'Jaa pelaajat vähintään yhteen lohkoon';
  end if;
  n := lg.current_round + 1;
  if n > 20 then
    raise exception 'Kaudella voi olla enintään 20 kierrosta';
  end if;

  for grp in select * from jsonb_array_elements(groups_input) loop
    if jsonb_typeof(grp) <> 'array' then
      raise exception 'Jaa pelaajat lohkoihin';
    end if;
    select coalesce(array_agg(v::uuid), '{}') into ids from jsonb_array_elements_text(grp) as v;
    if coalesce(array_length(ids, 1), 0) < 2 then
      raise exception 'Jokaisessa lohkossa pitää olla vähintään 2 pelaajaa';
    end if;
    if array_length(ids, 1) > 10 then
      raise exception 'Lohkossa voi olla enintään 10 pelaajaa';
    end if;
    all_ids := all_ids || ids;
  end loop;
  if (select count(distinct x) from unnest(all_ids) as x) <> array_length(all_ids, 1) then
    raise exception 'Sama pelaaja on kahdessa lohkossa';
  end if;
  if exists (
    select 1 from unnest(all_ids) as x
    where not exists (
      select 1 from public.league_members m where m.league_id = league_id_input and m.user_id = x
    )
  ) then
    raise exception 'Lohkoissa on pelaaja, joka ei ole enää sarjassa — päivitä näkymä';
  end if;

  update public.league_members set group_number = null where league_id = league_id_input;

  for grp in select * from jsonb_array_elements(groups_input) loop
    g := g + 1;
    select array_agg(v::uuid order by ord) into ids
    from jsonb_array_elements_text(grp) with ordinality as t(v, ord);

    update public.league_members
    set group_number = g, continues = true
    where league_id = league_id_input and user_id = any(ids);

    for i in 1..array_length(ids, 1) loop
      for j in (i + 1)..array_length(ids, 1) loop
        insert into public.league_fixtures (league_id, group_number, round_number, player_a_id, player_b_id)
        values (league_id_input, g, n, ids[i], ids[j]);
      end loop;
    end loop;
  end loop;

  insert into public.league_rounds (league_id, round_number, starts_on, ends_on, status)
  values (league_id_input, n, starts_on_input, ends_on_input, 'active')
  on conflict (league_id, round_number) do update
    set starts_on = excluded.starts_on, ends_on = excluded.ends_on, status = 'active';

  update public.leagues
  set status = 'active', current_round = n, updated_at = now()
  where id = league_id_input;

  return n;
end;
$function$;

-- Päättää käynnissä olevan kierroksen. Vahvistamatta jääneet ilmoitukset hyväksytään
-- sellaisinaan; pelaamattomat ottelut jäävät ilman pisteitä (ellei ylläpitäjä kirjannut niitä).
create or replace function public.krossi_close_league_round(league_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  lg record;
begin
  select * into lg from public.leagues where id = league_id_input for update;
  if not found then
    raise exception 'Liigaa ei löytynyt';
  end if;
  if not public.krossi_can_manage_league(league_id_input) then
    raise exception 'Vain sarjan ylläpitäjä voi päättää kierroksen';
  end if;

  update public.league_rounds set status = 'completed'
  where league_id = league_id_input and round_number = lg.current_round and status = 'active';
  if not found then
    raise exception 'Kierros ei ole käynnissä';
  end if;

  update public.league_fixture_results r
  set confirmed_by = case when r.reported_by = f.player_a_id then f.player_b_id else f.player_a_id end,
      confirmed_at = now(),
      set_by = auth.uid()
  from public.league_fixtures f
  where f.id = r.fixture_id
    and f.league_id = league_id_input
    and f.round_number = lg.current_round
    and r.confirmed_by is null;

  update public.leagues set updated_at = now() where id = league_id_input;
end;
$function$;

-- ── Tulokset ─────────────────────────────────────────────────────────────────

-- Pelaaja ilmoittaa tuloksen (korvaa mobiilisovelluksen version samalla allekirjoituksella).
-- Uutta: kausi pitää olla käynnissä, hallisarjassa kierros auki, ja aikapelissä tulos on yksi
-- rivi geimejä ({my, opp}), josta voittaja (tai tasapeli) päätellään palvelimella.
create or replace function public.report_league_fixture_result(
  fixture_id_input uuid,
  sets_input jsonb,
  winner_id_input uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  fx record;
  lg record;
  my_games int;
  opp_games int;
  other_id uuid;
  winner uuid;
begin
  select * into fx from public.league_fixtures where id = fixture_id_input;
  if not found then
    raise exception 'Ottelua ei löytynyt';
  end if;
  if auth.uid() not in (fx.player_a_id, fx.player_b_id) then
    raise exception 'Et ole tämän ottelun pelaaja';
  end if;
  select * into lg from public.leagues where id = fx.league_id;
  if lg.status <> 'active' then
    raise exception 'Kausi ei ole käynnissä';
  end if;
  if lg.format = 'hallisarja' and not exists (
    select 1 from public.league_rounds
    where league_id = fx.league_id and round_number = fx.round_number and status = 'active'
  ) then
    raise exception 'Kierros on päättynyt — pyydä ylläpitäjää kirjaamaan tulos';
  end if;
  if exists (
    select 1 from public.league_fixture_results
    where fixture_id = fixture_id_input and confirmed_by is not null
  ) then
    raise exception 'Tulos on jo vahvistettu';
  end if;

  other_id := case when fx.player_a_id = auth.uid() then fx.player_b_id else fx.player_a_id end;

  if lg.match_format = 'timed' then
    if sets_input is null or jsonb_typeof(sets_input) <> 'array' or jsonb_array_length(sets_input) <> 1 then
      raise exception 'Aikapelissä kirjataan vain tunnin aikana pelatut geimit';
    end if;
    my_games := (sets_input->0->>'my')::int;
    opp_games := (sets_input->0->>'opp')::int;
    if my_games is null or opp_games is null or my_games < 0 or opp_games < 0 or my_games > 60 or opp_games > 60 then
      raise exception 'Tarkista geimit';
    end if;
    sets_input := jsonb_build_array(jsonb_build_object('my', my_games, 'opp', opp_games));
    winner := case when my_games > opp_games then auth.uid() when opp_games > my_games then other_id else null end;
  else
    if winner_id_input is null or winner_id_input not in (fx.player_a_id, fx.player_b_id) then
      raise exception 'Virheellinen voittaja';
    end if;
    winner := winner_id_input;
  end if;

  insert into public.league_fixture_results (fixture_id, sets, winner_id, reported_by)
  values (fixture_id_input, sets_input, winner, auth.uid())
  on conflict (fixture_id) do update
    set sets = excluded.sets,
        winner_id = excluded.winner_id,
        reported_by = excluded.reported_by,
        confirmed_by = null,
        confirmed_at = null,
        walkover = false,
        set_by = null;
end;
$function$;

-- Ylläpitäjä kirjaa tai korjaa tuloksen, joka on heti vahvistettu.
-- sets_input: [{a, b}] pelaaja A:n näkökulmasta. walkover_input: luovutus (wo 6–0 voittajalle).
-- winner_id_input null = tasapeli (vain aikapelissä). Aikapelissä voittaja päätellään geimeistä.
create or replace function public.krossi_admin_set_league_result(
  fixture_id_input uuid,
  sets_input jsonb,
  winner_id_input uuid,
  walkover_input boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  fx record;
  lg record;
  stored jsonb;
  winner uuid := winner_id_input;
  wo boolean := coalesce(walkover_input, false);
  a_games int;
  b_games int;
begin
  select * into fx from public.league_fixtures where id = fixture_id_input;
  if not found then
    raise exception 'Ottelua ei löytynyt';
  end if;
  if not public.krossi_can_manage_league(fx.league_id) then
    raise exception 'Vain liigan ylläpitäjä voi kirjata tuloksia';
  end if;
  select * into lg from public.leagues where id = fx.league_id;
  if lg.status = 'signup' then
    raise exception 'Kausi ei ole vielä alkanut';
  end if;
  if winner is not null and winner not in (fx.player_a_id, fx.player_b_id) then
    raise exception 'Virheellinen voittaja';
  end if;

  if wo then
    if winner is null then
      raise exception 'Valitse, kumpi voitti luovutuksella';
    end if;
    stored := case when winner = fx.player_a_id
      then jsonb_build_array(jsonb_build_object('my', 6, 'opp', 0))
      else jsonb_build_array(jsonb_build_object('my', 0, 'opp', 6)) end;
  else
    stored := public.krossi_league_sets_from_a(sets_input);
    if lg.match_format = 'timed' then
      if jsonb_array_length(stored) <> 1 then
        raise exception 'Aikapelissä kirjataan vain pelatut geimit';
      end if;
      a_games := (stored->0->>'my')::int;
      b_games := (stored->0->>'opp')::int;
      winner := case when a_games > b_games then fx.player_a_id when b_games > a_games then fx.player_b_id else null end;
    elsif winner is null then
      raise exception 'Tasapeli on mahdollinen vain aikapelissä';
    end if;
  end if;

  insert into public.league_fixture_results (
    fixture_id, sets, winner_id, reported_by, confirmed_by, confirmed_at, walkover, set_by
  )
  values (fx.id, stored, winner, fx.player_a_id, fx.player_b_id, now(), wo, auth.uid())
  on conflict (fixture_id) do update
    set sets = excluded.sets,
        winner_id = excluded.winner_id,
        reported_by = excluded.reported_by,
        confirmed_by = excluded.confirmed_by,
        confirmed_at = excluded.confirmed_at,
        walkover = excluded.walkover,
        set_by = excluded.set_by;
end;
$function$;

-- Ylläpitäjä hyväksyy pelaajan ilmoittaman tuloksen vastustajan puolesta.
create or replace function public.krossi_admin_confirm_league_result(fixture_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  fx record;
begin
  select * into fx from public.league_fixtures where id = fixture_id_input;
  if not found then
    raise exception 'Ottelua ei löytynyt';
  end if;
  if not public.krossi_can_manage_league(fx.league_id) then
    raise exception 'Vain liigan ylläpitäjä voi vahvistaa tuloksia';
  end if;
  update public.league_fixture_results
  set confirmed_by = case when reported_by = fx.player_a_id then fx.player_b_id else fx.player_a_id end,
      confirmed_at = now(),
      set_by = auth.uid()
  where fixture_id = fixture_id_input and confirmed_by is null;
  if not found and not exists (select 1 from public.league_fixture_results where fixture_id = fixture_id_input) then
    raise exception 'Ei vahvistettavaa tulosta';
  end if;
end;
$function$;

-- Ylläpitäjä poistaa tuloksen (esim. väärin ilmoitettu): ottelu palaa pelaamattomaksi.
create or replace function public.krossi_admin_clear_league_result(fixture_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  fx record;
begin
  select * into fx from public.league_fixtures where id = fixture_id_input;
  if not found then
    raise exception 'Ottelua ei löytynyt';
  end if;
  if not public.krossi_can_manage_league(fx.league_id) then
    raise exception 'Vain liigan ylläpitäjä voi poistaa tuloksia';
  end if;
  delete from public.league_fixture_results where fixture_id = fixture_id_input;
end;
$function$;

-- Mobiilisovelluksen "Aloita kausi" arpoo lohkot; hallisarjassa lohkot jakaa ylläpitäjä.
create or replace function public.start_league(league_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  lg record;
  member_ids uuid[];
  total int;
  num_groups int;
  base_size int;
  extra int;
  group_start int;
  group_end int;
  group_len int;
  grp uuid[];
  g int;
  i int;
  j int;
begin
  select * into lg from public.leagues where id = league_id_input for update;
  if not found then
    raise exception 'Liigaa ei löytynyt';
  end if;
  if lg.created_by != auth.uid() then
    raise exception 'Vain liigan perustaja voi aloittaa kauden';
  end if;
  if lg.format = 'hallisarja' then
    raise exception 'Hallisarjan lohkot jaetaan Krossin selainversiossa (krossi.app/pelaa)';
  end if;
  if lg.status != 'signup' then
    raise exception 'Kausi on jo käynnissä';
  end if;

  select array_agg(user_id order by random()) into member_ids
  from public.league_members
  where league_id = league_id_input;

  total := coalesce(array_length(member_ids, 1), 0);
  if total < 4 then
    raise exception 'Vähintään 4 pelaajaa tarvitaan kauden aloittamiseen';
  end if;

  num_groups := ceil(total::numeric / lg.group_size)::int;
  base_size := total / num_groups;
  extra := total % num_groups;

  group_start := 1;
  for g in 1..num_groups loop
    group_len := base_size + (case when g <= extra then 1 else 0 end);
    group_end := group_start + group_len - 1;
    grp := member_ids[group_start:group_end];

    update public.league_members
    set group_number = g
    where league_id = league_id_input and user_id = any(grp);

    for i in 1..array_length(grp, 1) loop
      for j in (i + 1)..array_length(grp, 1) loop
        insert into public.league_fixtures (league_id, group_number, player_a_id, player_b_id)
        values (league_id_input, g, grp[i], grp[j]);
      end loop;
    end loop;

    group_start := group_end + 1;
  end loop;

  update public.leagues set status = 'active', current_round = 1, updated_at = now() where id = league_id_input;
end;
$function$;

-- ── Julkinen sarjataulukko ───────────────────────────────────────────────────

-- Julkiseksi merkityn liigan tiedot kirjautumattomille: nimet muodossa "Etunimi S.",
-- ei kuvia eikä yhteystietoja, vain vahvistetut tulokset. Muuten null.
create or replace function public.krossi_public_league(league_id_input uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', l.id,
    'city', l.city,
    'skill_level', l.skill_level,
    'season_label', l.season_label,
    'format', l.format,
    'match_format', l.match_format,
    'status', l.status,
    'group_size', l.group_size,
    'current_round', l.current_round,
    'venue', l.venue,
    'description', l.description,
    'organizer_name', coalesce(nullif(split_part(btrim(o.name), ' ', 1), ''), 'Ylläpitäjä'),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'round_number', r.round_number, 'starts_on', r.starts_on, 'ends_on', r.ends_on, 'status', r.status
      ) order by r.round_number)
      from public.league_rounds r where r.league_id = l.id
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', coalesce(nullif(split_part(btrim(p.name), ' ', 1), ''), 'Pelaaja')
          || coalesce(' ' || nullif(left(split_part(btrim(p.name), ' ', 2), 1), '') || '.', ''),
        'avatar_color', coalesce(p.avatar_color, 'blue')
      ))
      from public.profiles p
      where p.id in (
        select m.user_id from public.league_members m where m.league_id = l.id
        union
        select f.player_a_id from public.league_fixtures f where f.league_id = l.id
        union
        select f.player_b_id from public.league_fixtures f where f.league_id = l.id
      )
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'group_number', m.group_number) order by m.joined_at)
      from public.league_members m where m.league_id = l.id
    ), '[]'::jsonb),
    'fixtures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'round_number', f.round_number,
        'group_number', f.group_number,
        'player_a_id', f.player_a_id,
        'player_b_id', f.player_b_id,
        'result', case when r.confirmed_by is null then null else jsonb_build_object(
          'sets', r.sets, 'winner_id', r.winner_id, 'reported_by', r.reported_by,
          'walkover', r.walkover, 'confirmed_at', r.confirmed_at
        ) end
      ) order by f.round_number, f.group_number, f.created_at)
      from public.league_fixtures f
      left join public.league_fixture_results r on r.fixture_id = f.id
      where f.league_id = l.id
    ), '[]'::jsonb)
  )
  from public.leagues l
  left join public.profiles o on o.id = l.created_by
  where l.id = league_id_input and l.is_public;
$function$;

-- ── Grantit ──────────────────────────────────────────────────────────────────

revoke all on function public.krossi_can_manage_league(uuid) from public, anon;
grant execute on function public.krossi_can_manage_league(uuid) to authenticated;

revoke all on function public.krossi_league_sets_from_a(jsonb) from public, anon;
grant execute on function public.krossi_league_sets_from_a(jsonb) to authenticated;

revoke all on function public.krossi_create_league(text, text, text, text, text, int, text, text, jsonb, boolean, boolean) from public, anon;
grant execute on function public.krossi_create_league(text, text, text, text, text, int, text, text, jsonb, boolean, boolean) to authenticated;

revoke all on function public.krossi_update_league(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.krossi_update_league(uuid, text, text, text, boolean) to authenticated;

revoke all on function public.krossi_delete_league(uuid) from public, anon;
grant execute on function public.krossi_delete_league(uuid) to authenticated;

revoke all on function public.krossi_finish_league(uuid) from public, anon;
grant execute on function public.krossi_finish_league(uuid) to authenticated;

revoke all on function public.join_league(uuid) from public, anon;
grant execute on function public.join_league(uuid) to authenticated;

revoke all on function public.krossi_leave_league(uuid) from public, anon;
grant execute on function public.krossi_leave_league(uuid) to authenticated;

revoke all on function public.krossi_set_league_continues(uuid, boolean) from public, anon;
grant execute on function public.krossi_set_league_continues(uuid, boolean) to authenticated;

revoke all on function public.krossi_remove_league_member(uuid, uuid) from public, anon;
grant execute on function public.krossi_remove_league_member(uuid, uuid) to authenticated;

revoke all on function public.krossi_start_league_round(uuid, jsonb, date, date) from public, anon;
grant execute on function public.krossi_start_league_round(uuid, jsonb, date, date) to authenticated;

revoke all on function public.krossi_close_league_round(uuid) from public, anon;
grant execute on function public.krossi_close_league_round(uuid) to authenticated;

revoke all on function public.report_league_fixture_result(uuid, jsonb, uuid) from public, anon;
grant execute on function public.report_league_fixture_result(uuid, jsonb, uuid) to authenticated;

revoke all on function public.krossi_admin_set_league_result(uuid, jsonb, uuid, boolean) from public, anon;
grant execute on function public.krossi_admin_set_league_result(uuid, jsonb, uuid, boolean) to authenticated;

revoke all on function public.krossi_admin_confirm_league_result(uuid) from public, anon;
grant execute on function public.krossi_admin_confirm_league_result(uuid) to authenticated;

revoke all on function public.krossi_admin_clear_league_result(uuid) from public, anon;
grant execute on function public.krossi_admin_clear_league_result(uuid) to authenticated;

revoke all on function public.start_league(uuid) from public, anon;
grant execute on function public.start_league(uuid) to authenticated;

revoke all on function public.krossi_public_league(uuid) from public;
grant execute on function public.krossi_public_league(uuid) to anon, authenticated;
