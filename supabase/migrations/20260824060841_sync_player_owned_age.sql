-- Once a placeholder is claimed, the account owner's profile becomes the source of
-- truth for age. This prevents a coach-entered placeholder age from overriding a
-- player's decision to use a range or not disclose an age at all.
-- Production migration version: 20260824060841.
create or replace function public.koutsi_enforce_pilot_student_limits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_profile_age text;
begin
  if nullif(btrim(coalesce(new.background, '')), '') is not null then
    if tg_op = 'INSERT' then
      raise exception 'Terveys- ja taustatietoja ei voi tallentaa aikuisten beta-pilotissa';
    elsif new.background is distinct from old.background then
      raise exception 'Terveys- ja taustatietoja ei voi tallentaa aikuisten beta-pilotissa';
    end if;
  end if;

  new.background := null;

  if new.placeholder_coach_id is null then
    select p.age
      into v_profile_age
      from public.profiles p
     where p.id = new.id;

    if found then
      if v_profile_age ~ '^[0-9]{2,3}$' then
        new.age := v_profile_age::integer;
      else
        new.age := null;
      end if;
    end if;
  end if;

  if new.age is not null and (new.age < 18 or new.age > 119) then
    if tg_op = 'INSERT' then
      raise exception 'Pelaajan iän pitää olla väliltä 18–119 vuotta';
    elsif new.age is distinct from old.age then
      raise exception 'Pelaajan iän pitää olla väliltä 18–119 vuotta';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.koutsi_enforce_pilot_student_limits() from public, anon, authenticated;
