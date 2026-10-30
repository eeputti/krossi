-- 20261030082914_koutsi_trial_codes_plus.sql — a "+" is part of a valmentaja-avain.
-- Applied to production 2026-10-30 08:29 UTC (apply_migration koutsi_trial_codes_plus) on the user's word: a key
-- without the "+" gives free use and the same key with it a trial. Verified after: the existing keys got the "+" in
-- their code (no uses yet), and typed spellings resolve as intended. The owner's free-use key was added as data in
-- the same session (names never go into this public repo). Tested in PGlite:
-- koutsi/web/sql/20261030080055_koutsi_trial_codes.check.mjs
--
-- Case, spaces and hyphens still never matter. Order when a coach types a key: (1) the trial key exactly as typed
-- (with or without "+"), (2) an old coach key (redeem_koutsi_coach_key, unchanged), (3) only when nothing was typed
-- with a "+": the trial key that differs by a "+" (a forgotten "+" still works).
-- Additive for data: existing keys whose shown form has a "+" get it in their code too (uses and plans follow).

alter table public.koutsi_trial_codes drop constraint if exists koutsi_trial_codes_code_check;
alter table public.koutsi_trial_codes add constraint koutsi_trial_codes_code_check check (code ~ '^[A-Z0-9+]{4,30}$');

alter table public.koutsi_trial_code_uses drop constraint if exists koutsi_trial_code_uses_code_fkey;
alter table public.koutsi_trial_code_uses add constraint koutsi_trial_code_uses_code_fkey
  foreign key (code) references public.koutsi_trial_codes(code) on update cascade on delete cascade;

update public.koutsi_coach_plans p
   set trial_code = regexp_replace(upper(c.shown), '[^A-Z0-9+]', '', 'g')
  from public.koutsi_trial_codes c
 where p.trial_code = c.code and c.shown is not null
   and regexp_replace(upper(c.shown), '[^A-Z0-9+]', '', 'g') <> c.code;
update public.koutsi_trial_codes c
   set code = regexp_replace(upper(c.shown), '[^A-Z0-9+]', '', 'g')
 where c.shown is not null and regexp_replace(upper(c.shown), '[^A-Z0-9+]', '', 'g') <> c.code;

create or replace function public.koutsi_use_code(p_code text, p_terms_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_input text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9+]', '', 'g');
  v_code public.koutsi_trial_codes%rowtype;
  v_is_coach boolean;
  v_plan text;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if replace(v_input, '+', '') = '' then
    raise exception 'Kirjoita valmentaja-avain.';
  end if;

  select * into v_code from public.koutsi_trial_codes c where c.code = v_input for update;
  if not found then
    -- An old coach key goes on exactly as before ('invalid coach key' → "Väärä valmentaja-avain." in the app).
    if exists (select 1 from public.koutsi_coach_invite_codes k where k.code = upper(btrim(p_code))) then
      return public.redeem_koutsi_coach_key(p_code) || jsonb_build_object('kind', 'key');
    end if;
    -- The "+" forgotten: the key that is the same with a "+".
    if position('+' in v_input) = 0 then
      select * into v_code from public.koutsi_trial_codes c
       where c.code <> v_input and replace(c.code, '+', '') = v_input
       order by c.created_at
       limit 1
       for update;
    end if;
    if not found then
      return public.redeem_koutsi_coach_key(p_code) || jsonb_build_object('kind', 'key');
    end if;
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

-- A key, returned as it is e-mailed. The owner writes the key (kept as written; a "+" is part of it); without
-- one it is eight random letters/digits (no I, O, 0, 1). The same key again with the same length gets
-- p_max_uses more uses, the new last day and is back in use; with another length it is refused.
create or replace function public.koutsi_admin_create_trial_code(p_months integer, p_max_uses integer,
  p_expires_at timestamptz, p_note text, p_code text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_shown text := left(btrim(coalesce(p_code, '')), 40);
  v_code text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9+]', '', 'g');
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
  elsif v_code !~ '^[A-Z0-9+]{4,30}$' or replace(v_code, '+', '') = '' then
    raise exception 'Avaimessa saa olla 4–30 kirjainta, numeroa tai plussaa.';
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
   where code = regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9+]', '', 'g');
end;
$function$;
