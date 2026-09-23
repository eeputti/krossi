-- Captured from production history: applied directly to the database, no local file
-- existed for it yet.

-- Krossi-pelaajaprofiilin maksumuuri (Vaihe 1): sarakkeet, idempotenssitaulu, apufunktio.

alter table public.profiles
  add column if not exists paid_at timestamptz,
  add column if not exists stripe_customer_id text;

-- Käyttäjä ei saa itse asettaa maksutietojaan suoraan (vain webhook service-rolella).
revoke update (paid_at, stripe_customer_id) on public.profiles from authenticated, anon;

create table if not exists public.stripe_events (
  id text primary key,
  created_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
-- Ei policyja: vain service_role (ohittaa RLS:n) pääsee tähän tauluun, webhookin idempotenssia varten.

create or replace function public.current_user_has_paid()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and paid_at is not null
  );
$$;

-- Toisen pelaajan profiili näkyy discoverable-haulla vain, jos katsoja on maksanut.
-- Omaan profiiliin, adminiin ja valmentaja/oppilas-yhteyksiin maksumuuri ei vaikuta.
drop policy if exists "profiles_visible_to_allowed_users" on public.profiles;
create policy "profiles_visible_to_allowed_users"
on public.profiles
for select
to authenticated
using (
  ((select auth.uid()) is not null) and (
    (id = (select auth.uid()))
    or koutsi_is_admin()
    or koutsi_is_linked_coach(id)
    or koutsi_is_linked_student(id)
    or (is_discoverable and public.current_user_has_paid())
  )
);

-- Sama maksumuuri haasteen luojan/osallistujien profiilinäkyvyyteen.
drop policy if exists "challenge people visible to browsers" on public.profiles;
create policy "challenge people visible to browsers"
on public.profiles
for select
to authenticated
using (
  public.current_user_has_paid()
  and exists (
    select 1
    from public.challenges c
    where c.status in ('open', 'filled')
      and (
        c.creator_id = profiles.id
        or exists (
          select 1
          from public.challenge_participants cp
          where cp.challenge_id = c.id
            and cp.user_id = profiles.id
        )
      )
  )
);

-- Haasteen luonti vaatii maksetun profiilin.
drop policy if exists "authenticated users can create challenges" on public.challenges;
create policy "authenticated users can create challenges"
on public.challenges
for insert
to public
with check (auth.uid() = creator_id and public.current_user_has_paid());

-- Haasteeseen liittyminen vaatii maksetun profiilin.
create or replace function public.join_challenge(challenge_id_input uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  conv_id uuid;
  ch record;
  joiner_name text;
  joiner_avatar_url text;
  joiner_avatar_color text;
  join_message text;
  capacity int;
  taken int;
  already boolean;
begin
  if not public.current_user_has_paid() then
    raise exception 'Payment required';
  end if;

  -- rivilukko estää kilpa-ajon, jossa kaksi liittyjää ohittaa täyttymistarkistuksen
  select * into ch from public.challenges where id = challenge_id_input for update;
  if not found then raise exception 'Challenge not found'; end if;

  if ch.status = 'cancelled' then
    raise exception 'Challenge is cancelled';
  end if;

  select exists (
    select 1 from public.challenge_participants
    where challenge_id = challenge_id_input and user_id = auth.uid()
  ) into already;

  if ch.creator_id = auth.uid() then
    raise exception 'Creator cannot join own challenge';
  end if;

  capacity := case when ch.match_type = 'nelinpeli' then 3 else 1 end;
  if ch.max_players is not null and ch.max_players > 1 then
    capacity := greatest(capacity, ch.max_players - 1);
  end if;

  select count(*) into taken
  from public.challenge_participants
  where challenge_id = challenge_id_input;

  if not already and taken >= capacity then
    raise exception 'Challenge is full';
  end if;

  insert into public.challenge_participants (challenge_id, user_id)
  values (challenge_id_input, auth.uid())
  on conflict do nothing;

  if not already then
    taken := taken + 1;
  end if;

  if taken >= capacity and ch.status = 'open' then
    update public.challenges set status = 'filled' where id = challenge_id_input;
  end if;

  select name, avatar_url, avatar_color
  into joiner_name, joiner_avatar_url, joiner_avatar_color
  from public.profiles
  where id = auth.uid();

  select id into conv_id
  from public.conversations
  where challenge_id = challenge_id_input;

  if conv_id is null then
    insert into public.conversations (challenge_id, is_group)
    values (challenge_id_input, true)
    returning id into conv_id;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  select conv_id, participants.participant_user_id
  from (
    select ch.creator_id as participant_user_id
    union
    select user_id
    from public.challenge_participants
    where challenge_id = challenge_id_input
  ) participants
  on conflict do nothing;

  -- liittymisviesti vain aidosti uudesta liittyjästä
  if not already then
    join_message := jsonb_build_object(
      '__type', 'challenge_join',
      'challengeId', challenge_id_input,
      'creatorId', ch.creator_id,
      'joinerId', auth.uid(),
      'joinerName', coalesce(joiner_name, 'Pelaaja'),
      'joinerAvatarUrl', joiner_avatar_url,
      'joinerAvatarColor', coalesce(joiner_avatar_color, 'blue'),
      'location', ch.location,
      'locationType', ch.location_type,
      'courtSurface', ch.court_surface,
      'matchType', ch.match_type,
      'scheduledAt', ch.scheduled_at
    )::text;

    insert into public.messages (conversation_id, sender_id, content)
    values (conv_id, auth.uid(), join_message);
  end if;

  return conv_id;
end;
$function$;
