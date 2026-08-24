-- A coach can prepare a roster before players create their own accounts. Age is
-- therefore optional for both placeholder players and account profiles. The adult
-- pilot acknowledgement remains the authoritative eligibility check; when an age is
-- supplied, it must still describe an adult.
-- Production migration version: 20260824060429.
alter table public.profiles
  alter column age drop not null;

alter table public.profiles
  drop constraint profiles_age_range_check;

alter table public.profiles
  add constraint profiles_age_range_check
  check (
    age is null
    or age = any (array['alle20', '20-30', '30-40', '40-50', '50-60', '60+']::text[])
    or case
      when age ~ '^[0-9]{2,3}$' then age::integer between 18 and 119
      else false
    end
  );

create or replace function public.koutsi_enforce_pilot_student_limits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if nullif(btrim(coalesce(new.background, '')), '') is not null then
    if tg_op = 'INSERT' then
      raise exception 'Terveys- ja taustatietoja ei voi tallentaa aikuisten beta-pilotissa';
    elsif new.background is distinct from old.background then
      raise exception 'Terveys- ja taustatietoja ei voi tallentaa aikuisten beta-pilotissa';
    end if;
  end if;

  new.background := null;

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
