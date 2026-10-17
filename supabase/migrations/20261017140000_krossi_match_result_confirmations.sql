-- Krossi: ottelutuloksen pelaajat Krossin käyttäjinä + vastustajan vahvistus.
--
-- Pohja tulevalle tasolaskennalle (Glicko-2): tasoon lasketaan vain tulokset, joissa
-- vastustaja on oikea Krossin käyttäjä ja hän on vahvistanut tuloksen. Tasoa ei vielä lasketa.
--
-- 1) match_results saa viittaukset pelaajiin vapaan tekstin rinnalle: opponent_id, partner_id
--    ja opp_partner_id (nelinpeli). Nimet (opponent_name …) kirjoitetaan edelleen — myös
--    linkitetylle pelaajalle — joten tulos näkyy ilman profiilin lukuoikeutta, ja kaveri, joka
--    ei ole Krossissa, kirjataan pelkällä nimellä kuten ennen. Vanhat rivit eivät muutu.
--
-- 2) Vahvistus (confirmation):
--      null         ei linkitettyä vastustajaa, ei vahvistettavaa (kaikki vanhat rivit)
--      'pending'    odottaa vastustajan vastausta
--      'confirmed'  vastustaja (nelinpelissä kumpi tahansa vastustajista) vahvisti: confirmed_by/_at
--      'disputed'   vastustaja sanoi, ettei tulos pidä paikkaansa: disputed_by/_at
--    Kirjaaja ei voi kirjoittaa tilaa itse: trigger asettaa 'pending', kun vastustaja on
--    linkitetty, ja palauttaa sen 'pending'-tilaan (vastaus nollautuu), kun kirjaaja muuttaa
--    tulosta tai pelaajia — kiistetty tulos korjataan muokkaamalla, ja vastustaja vastaa
--    uudelleen. Vastustaja vastaa vain funktiolla krossi_answer_match_result (voi myös
--    muuttaa vastaustaan).
--
-- 3) Lukuoikeus. Vanha politiikka "match results are readable by signed-in users" jää
--    voimaan: mobiilisovellus näyttää toisen pelaajan profiilissa hänen kirjaamansa tulokset
--    (fetchMatchResultsForUser). Tulokseen linkitetyt pelaajat saavat oman lukupolitiikkansa,
--    joka riittää yksinään, jos laaja politiikka joskus kavennetaan. Linkitetyt pelaajat
--    eivät voi muokata tai poistaa riviä.
--
-- 4) krossi_linked_match_results(): rivit, joihin minut on linkitetty (en kirjaaja), ja
--    kirjaajan nimi ja kuva — myös ilman avausmaksua, koska kirjaaja itse linkitti minut.
--    Estämieni kirjaajien rivit jäävät pois.
--
-- 5) krossi_rated_matches: tasolaskennan lähtödata yhdessä muodossa — vahvistetut,
--    vastustajaan linkitetyt tulokset ja vahvistetut liigaottelut (ei luovutuksia). Puoli a on
--    kirjaaja (+ pari) / pelaaja A, sets {a, b}, winner 'a' | 'b' | null (tasan).

-- ── Sarakkeet ────────────────────────────────────────────────────────────────

alter table public.match_results
  add column opponent_id uuid references public.profiles(id) on delete set null,
  add column partner_id uuid references public.profiles(id) on delete set null,
  add column opp_partner_id uuid references public.profiles(id) on delete set null,
  add column confirmation text,
  add column confirmed_by uuid references public.profiles(id) on delete set null,
  add column confirmed_at timestamptz,
  add column disputed_by uuid references public.profiles(id) on delete set null,
  add column disputed_at timestamptz;

alter table public.match_results
  add constraint match_results_confirmation_check
    check (confirmation in ('pending', 'confirmed', 'disputed')),
  -- Parit vain nelinpelissä.
  add constraint match_results_doubles_ids_check
    check (format = 'doubles' or (partner_id is null and opp_partner_id is null)),
  -- Sama pelaaja vain yhteen rooliin (eikä kirjaaja itse).
  add constraint match_results_people_distinct_check check (
    opponent_id is distinct from created_by
    and partner_id is distinct from created_by
    and opp_partner_id is distinct from created_by
    and (opponent_id is null or (opponent_id is distinct from partner_id and opponent_id is distinct from opp_partner_id))
    and (partner_id is null or partner_id is distinct from opp_partner_id)
  );

create index match_results_opponent_id_idx on public.match_results (opponent_id) where opponent_id is not null;
create index match_results_partner_id_idx on public.match_results (partner_id) where partner_id is not null;
create index match_results_opp_partner_id_idx on public.match_results (opp_partner_id) where opp_partner_id is not null;
create index match_results_confirmed_idx on public.match_results (created_at) where confirmation = 'confirmed';

-- ── Vahvistuksen tila: vain trigger ja vastausfunktio kirjoittavat sen ────────

create or replace function public.krossi_match_results_confirmation()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  linked boolean := new.opponent_id is not null or new.opp_partner_id is not null;
begin
  if tg_op = 'INSERT' then
    new.confirmation := case when linked then 'pending' end;
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.disputed_by := null;
    new.disputed_at := null;
    return new;
  end if;

  -- Tulos tai pelaajat muuttuivat: vastaus ei enää koske tätä tulosta.
  if new.sets is distinct from old.sets
     or new.won is distinct from old.won
     or new.game_type is distinct from old.game_type
     or new.format is distinct from old.format
     or new.opponent_id is distinct from old.opponent_id
     or new.partner_id is distinct from old.partner_id
     or new.opp_partner_id is distinct from old.opp_partner_id then
    new.confirmation := case when linked then 'pending' end;
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.disputed_by := null;
    new.disputed_at := null;
    return new;
  end if;

  -- Suora päivitys sovelluksesta (kirjaaja muuttaa esim. nimeä): vastaus pysyy ennallaan.
  -- krossi_answer_match_result on security definer, joten siinä current_user on omistaja.
  if current_user in ('authenticated', 'anon') then
    new.confirmation := old.confirmation;
    new.confirmed_by := old.confirmed_by;
    new.confirmed_at := old.confirmed_at;
    new.disputed_by := old.disputed_by;
    new.disputed_at := old.disputed_at;
  end if;
  return new;
end;
$function$;

revoke all on function public.krossi_match_results_confirmation() from public, anon, authenticated;

create trigger match_results_confirmation
  before insert or update on public.match_results
  for each row execute function public.krossi_match_results_confirmation();

-- ── Lukuoikeus tulokseen linkitetyille ───────────────────────────────────────

create policy "match results are readable by their players"
  on public.match_results
  for select
  to authenticated
  using ((select auth.uid()) in (opponent_id, partner_id, opp_partner_id));

-- ── Vastustaja vastaa: vahvista tai kiistä ───────────────────────────────────

-- confirm_input true = vahvista, false = ei pidä paikkaansa. Palauttaa uuden tilan.
create or replace function public.krossi_answer_match_result(result_id_input uuid, confirm_input boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  uid uuid := (select auth.uid());
  r public.match_results;
begin
  if uid is null then
    raise exception 'Kirjaudu sisään ensin' using errcode = '42501';
  end if;
  if confirm_input is null then
    raise exception 'Kerro, pitääkö tulos paikkansa' using errcode = '22023';
  end if;

  select * into r from public.match_results where id = result_id_input for update;
  if not found or (uid is distinct from r.opponent_id and uid is distinct from r.opp_partner_id) then
    raise exception 'Vain tuloksen vastustaja voi vahvistaa sen' using errcode = '42501';
  end if;

  update public.match_results
  set confirmation = case when confirm_input then 'confirmed' else 'disputed' end,
      confirmed_by = case when confirm_input then uid end,
      confirmed_at = case when confirm_input then now() end,
      disputed_by = case when confirm_input then null else uid end,
      disputed_at = case when confirm_input then null else now() end
  where id = r.id;

  return case when confirm_input then 'confirmed' else 'disputed' end;
end;
$function$;

revoke all on function public.krossi_answer_match_result(uuid, boolean) from public, anon;
grant execute on function public.krossi_answer_match_result(uuid, boolean) to authenticated;

-- ── Tulokset, joihin minut on linkitetty ─────────────────────────────────────

-- [{ ...match_results-rivi, creator: { id, name, avatar_url, avatar_color } }], uusin ensin, max 200.
create or replace function public.krossi_linked_match_results()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  from (
    select to_jsonb(r) || jsonb_build_object(
             'creator', jsonb_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url, 'avatar_color', p.avatar_color)
           ) as item,
           r.created_at
    from public.match_results r
    left join public.profiles p on p.id = r.created_by
    where (select auth.uid()) is not null
      and (select auth.uid()) in (r.opponent_id, r.partner_id, r.opp_partner_id)
      and r.created_by is distinct from (select auth.uid())
      and not exists (
        select 1 from public.blocked_profiles b
        where b.blocker_id = (select auth.uid()) and b.blocked_id = r.created_by
      )
    order by r.created_at desc
    limit 200
  ) linked;
$function$;

revoke all on function public.krossi_linked_match_results() from public, anon;
grant execute on function public.krossi_linked_match_results() to authenticated;

-- ── Tasolaskennan lähtödata ──────────────────────────────────────────────────

create or replace view public.krossi_rated_matches
with (security_invoker = true)
as
  select
    'result'::text as source,
    r.id,
    r.created_at as played_at,
    r.format,
    r.game_type,
    r.created_by as a_player_id,
    r.partner_id as a_partner_id,
    r.opponent_id as b_player_id,
    r.opp_partner_id as b_partner_id,
    s.sets,
    case when s.a_sets > s.b_sets then 'a' when s.b_sets > s.a_sets then 'b' end as winner
  from public.match_results r
  cross join lateral (
    select
      coalesce(jsonb_agg(jsonb_build_object('a', (e->>'my')::int, 'b', (e->>'opp')::int) order by n), '[]'::jsonb) as sets,
      count(*) filter (where (e->>'my')::int > (e->>'opp')::int) as a_sets,
      count(*) filter (where (e->>'opp')::int > (e->>'my')::int) as b_sets
    from jsonb_array_elements(r.sets) with ordinality as x(e, n)
  ) s
  where r.confirmation = 'confirmed'
    and r.opponent_id is not null

  union all

  select
    'league'::text,
    lr.id,
    coalesce(lr.confirmed_at, lr.created_at),
    'singles'::text,
    'league'::text,
    f.player_a_id,
    null::uuid,
    f.player_b_id,
    null::uuid,
    coalesce((
      select jsonb_agg(
        case when lr.reported_by = f.player_a_id
          then jsonb_build_object('a', (e->>'my')::int, 'b', (e->>'opp')::int)
          else jsonb_build_object('a', (e->>'opp')::int, 'b', (e->>'my')::int)
        end order by n)
      from jsonb_array_elements(lr.sets) with ordinality as x(e, n)
    ), '[]'::jsonb),
    case lr.winner_id when f.player_a_id then 'a' when f.player_b_id then 'b' end
  from public.league_fixture_results lr
  join public.league_fixtures f on f.id = lr.fixture_id
  where lr.confirmed_by is not null
    and not lr.walkover;

comment on view public.krossi_rated_matches is
  'Tasolaskennan lähtödata: vahvistetut, vastustajaan linkitetyt match_results-tulokset ja vahvistetut liigaottelut (ei luovutuksia). Puoli a = kirjaaja / pelaaja A.';

revoke all on public.krossi_rated_matches from anon;
grant select on public.krossi_rated_matches to authenticated;
