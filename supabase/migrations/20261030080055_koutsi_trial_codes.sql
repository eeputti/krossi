-- 20261030080055_koutsi_trial_codes.sql — valmentaja-avaimet: the owner gives a coach a free trial
-- (3, 6 or 12 months, any length) or free use (a contract customer like the Mikkeli club) with a key only
-- the owner makes and e-mails (Ylläpito → Avaimet). A new coach always asks the owner for a key by e-mail;
-- there is no trial without one (koutsi_self_serve_open() stays false).
--
-- Applied to production 2026-10-30 08:00 UTC (apply_migration koutsi_trial_codes) on the user's "Kyllä, julkaise".
-- This public file was edited after applying (the user, 30.10.: key names are not to be in the code): the run
-- also added the owner's keys and revoked the old coach key they replaced, as data, and named new keys after
-- their length. Those rows and the naming are left out here; 20261030081942_koutsi_trial_codes_private_names
-- makes a key without a name random, as this file shows. Tested in PGlite on top of
-- 20261029193756_koutsi_coach_plans: koutsi/web/sql/20261030080055_koutsi_trial_codes.check.mjs
-- Two tables, one column, four functions. The coach key function (redeem_koutsi_coach_key) is untouched.
-- Rollback: drop the two tables and the four functions, drop column koutsi_coach_plans.trial_code.
--
-- Rules the app relies on:
--   * A code gives N months free FROM THE DAY IT IS USED (never shortens a trial: the later end wins),
--     or, with months null, makes the coach free (no trial, no payment) like a coach key.
--   * A person who is not a coach yet becomes one with the code (works even while the default trial
--     without a code is closed, koutsi_self_serve_open() = false); the subscription terms are
--     accepted with the same tap, like koutsi_start_trial.
--   * A coach on the trial, or whose trial ended, can use a code to get more months. A free coach or
--     one with a live subscription gets a plain answer and nothing changes.
--   * Each coach can use a code once; a code has a number of uses, an optional last day, and can be
--     revoked. Only admins see, make and revoke codes (koutsi_is_admin, checked in every function).
--   * The same input also takes an old coach key: anything that is not a trial code goes to
--     redeem_koutsi_coach_key unchanged.
--   * The owner names a key as they like (or gets a random one); `code` is the key in capitals without
--     anything but letters and digits, so case, spaces, hyphens and a "+" never matter when a coach types it;
--     `shown` is the key as it is e-mailed. "Luo avain" with a name that exists adds uses to it (and puts it
--     back in use if it was revoked). Key names never go into this public repo.

-- ── tables ──────────────────────────────────────────────────────────────────

create table if not exists public.koutsi_trial_codes (
  code text primary key check (code ~ '^[A-Z0-9]{4,30}$'),
  -- the key as the owner wrote and e-mails it (null = same as code)
  shown text check (shown is null or char_length(shown) <= 40),
  -- null = free use (a contract customer), else months of free trial from the day of use
  months integer check (months is null or months between 1 and 36),
  max_uses integer not null default 1 check (max_uses between 1 and 1000),
  use_count integer not null default 0 check (use_count >= 0),
  expires_at timestamptz,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.koutsi_trial_code_uses (
  code text not null references public.koutsi_trial_codes(code) on delete cascade,
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  used_at timestamptz not null default now(),
  primary key (code, coach_id)
);
create index if not exists koutsi_trial_code_uses_coach_idx on public.koutsi_trial_code_uses (coach_id);

-- Functions only: no client reads or writes these tables.
alter table public.koutsi_trial_codes enable row level security;
alter table public.koutsi_trial_code_uses enable row level security;
revoke all on table public.koutsi_trial_codes, public.koutsi_trial_code_uses from anon, authenticated;

alter table public.koutsi_coach_plans add column if not exists trial_code text;

-- ── using a code ────────────────────────────────────────────────────────────

create or replace function public.koutsi_use_code(p_code text, p_terms_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_input text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
  v_code public.koutsi_trial_codes%rowtype;
  v_is_coach boolean;
  v_plan text;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if v_input = '' then
    raise exception 'Kirjoita valmentaja-avain.';
  end if;

  select * into v_code from public.koutsi_trial_codes c where c.code = v_input for update;
  if not found then
    -- Not a trial code: an old coach key goes on exactly as before.
    begin
      return public.redeem_koutsi_coach_key(p_code) || jsonb_build_object('kind', 'key');
    exception when others then
      raise; -- 'invalid coach key' → "Väärä valmentaja-avain." in the app
    end;
  end if;

  if v_code.revoked_at is not null then
    raise exception 'Tämä valmentaja-avain on poistettu käytöstä.';
  end if;
  if v_code.expires_at is not null and v_code.expires_at < now() then
    raise exception 'Tämä valmentaja-avain on vanhentunut.';
  end if;
  if v_code.use_count >= v_code.max_uses then
    raise exception 'Tämä valmentaja-avain on jo käytetty.';
  end if;

  v_is_coach := exists (select 1 from public.koutsi_coaches c where c.id = v_uid);
  if v_is_coach then
    if exists (select 1 from public.koutsi_trial_code_uses u where u.code = v_code.code and u.coach_id = v_uid) then
      raise exception 'Olet jo käyttänyt tämän valmentaja-avaimen.';
    end if;
    v_plan := public.koutsi_coach_plan(v_uid);
    if v_plan = 'free' then
      raise exception 'Koutsi on sinulle jo maksuton, joten avainta ei tarvita.';
    end if;
    if v_plan in ('active', 'past_due') then
      raise exception 'Sinulla on jo tilaus. Ota yhteyttä, niin katsotaan avain yhdessä.';
    end if;
  else
    if p_terms_version is null or btrim(p_terms_version) = '' then
      raise exception 'Tilausehtojen hyväksyntä puuttuu. Päivitä sivu ja yritä uudelleen.';
    end if;
    if not exists (select 1 from public.profiles pr where pr.id = v_uid) then
      raise exception 'profile required';
    end if;
    if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
      raise exception 'Vahvista ensin sähköpostiosoitteesi vahvistusviestin linkistä.';
    end if;
    insert into public.koutsi_coaches (id) values (v_uid) on conflict (id) do nothing;
  end if;

  if v_code.months is null then
    insert into public.koutsi_coach_plans (coach_id, plan, terms_version, terms_accepted_at, trial_code)
    values (v_uid, 'free', nullif(left(btrim(coalesce(p_terms_version, '')), 40), ''), case when v_is_coach then null else now() end, v_code.code)
    on conflict (coach_id) do update
      set plan = 'free', trial_ends_at = null, trial_code = excluded.trial_code, updated_at = now();
  else
    insert into public.koutsi_coach_plans (coach_id, plan, trial_ends_at, terms_version, terms_accepted_at, trial_code)
    values (v_uid, 'trial', now() + make_interval(months => v_code.months), left(btrim(coalesce(p_terms_version, '')), 40), now(), v_code.code)
    on conflict (coach_id) do update
      set plan = 'trial',
          trial_ends_at = greatest(coalesce(public.koutsi_coach_plans.trial_ends_at, now()), now() + make_interval(months => v_code.months)),
          trial_code = excluded.trial_code,
          trial_reminded_at = null,
          updated_at = now();
  end if;

  insert into public.koutsi_trial_code_uses (code, coach_id) values (v_code.code, v_uid);
  update public.koutsi_trial_codes set use_count = use_count + 1 where code = v_code.code;
  if not v_is_coach then
    perform public.koutsi_seed_exercises(v_uid);
  end if;

  return public.koutsi_plan_status() || jsonb_build_object('kind', 'code', 'months', v_code.months);
end;
$function$;

-- ── Ylläpito → Avaimet ──────────────────────────────────────────────────────

create or replace function public.koutsi_admin_trial_codes()
returns table (code text, shown text, months integer, max_uses integer, use_count integer, expires_at timestamptz,
               note text, created_at timestamptz, revoked_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  return query
    select c.code, coalesce(c.shown, c.code), c.months, c.max_uses, c.use_count, c.expires_at, c.note, c.created_at, c.revoked_at
      from public.koutsi_trial_codes c
     order by c.revoked_at is not null, c.created_at desc;
end;
$function$;

-- A key, returned as it is e-mailed. The owner writes the key (kept as written); without one it is eight
-- random letters/digits (no I, O, 0, 1: easy to read aloud). Key names never go into this public repo.
-- A key that already exists with the same length gets p_max_uses more uses, the new last day and is back
-- in use; with another length it is refused.
create or replace function public.koutsi_admin_create_trial_code(p_months integer, p_max_uses integer,
  p_expires_at timestamptz, p_note text, p_code text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_shown text := left(btrim(coalesce(p_code, '')), 40);
  v_code text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
  v_uses integer := greatest(1, coalesce(p_max_uses, 1));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_old public.koutsi_trial_codes%rowtype;
begin
  if not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  if v_code = '' then
    loop
      v_code := '';
      for i in 1..8 loop
        v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
      end loop;
      exit when not exists (select 1 from public.koutsi_trial_codes c where c.code = v_code);
    end loop;
    v_shown := v_code;
  elsif v_code !~ '^[A-Z0-9]{4,30}$' then
    raise exception 'Avaimessa saa olla 4–30 kirjainta tai numeroa.';
  end if;

  select * into v_old from public.koutsi_trial_codes c where c.code = v_code for update;
  if found then
    if v_old.months is distinct from p_months then
      raise exception 'Tämä avain on jo olemassa ja antaa eri ajan.';
    end if;
    update public.koutsi_trial_codes c
       set max_uses = least(1000, greatest(c.max_uses, c.use_count) + v_uses), expires_at = p_expires_at,
           note = coalesce(v_note, c.note), revoked_at = null
     where c.code = v_code;
    return coalesce(v_old.shown, v_old.code);
  end if;

  insert into public.koutsi_trial_codes (code, shown, months, max_uses, expires_at, note, created_by)
  values (v_code, v_shown, p_months, v_uses, p_expires_at, v_note, (select auth.uid()));
  return v_shown;
end;
$function$;

create or replace function public.koutsi_admin_revoke_trial_code(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  update public.koutsi_trial_codes set revoked_at = coalesce(revoked_at, now())
   where code = regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
end;
$function$;

-- ── the owner's keys ────────────────────────────────────────────────────────
-- Added as data in the same run, with the old coach key they replaced revoked. Not in this public file.

-- ── function rights ─────────────────────────────────────────────────────────

revoke all on function public.koutsi_use_code(text, text) from public, anon;
revoke all on function public.koutsi_admin_trial_codes() from public, anon;
revoke all on function public.koutsi_admin_create_trial_code(integer, integer, timestamptz, text, text) from public, anon;
revoke all on function public.koutsi_admin_revoke_trial_code(text) from public, anon;
grant execute on function public.koutsi_use_code(text, text) to authenticated;
grant execute on function public.koutsi_admin_trial_codes() to authenticated;
grant execute on function public.koutsi_admin_create_trial_code(integer, integer, timestamptz, text, text) to authenticated;
grant execute on function public.koutsi_admin_revoke_trial_code(text) to authenticated;
