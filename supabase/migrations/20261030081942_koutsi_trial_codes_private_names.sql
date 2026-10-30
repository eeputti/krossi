-- 20261030081942_koutsi_trial_codes_private_names.sql — Ylläpito → Avaimet without a name gives a random key.
-- Applied to production 2026-10-30 08:19 UTC (apply_migration koutsi_trial_codes_private_names) on the user's word
-- that key names are not to be in the code. Before, a key without a name was named after its length; now the
-- owner writes the name or gets eight random letters/digits, and no name or naming rule is in this public repo.
-- Existing keys are untouched. Same body as in 20261030080055_koutsi_trial_codes.sql (create or replace keeps
-- the grants). Tested in PGlite: koutsi/web/sql/20261030080055_koutsi_trial_codes.check.mjs
--
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
