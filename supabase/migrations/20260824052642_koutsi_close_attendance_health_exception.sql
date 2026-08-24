-- The adult-only first pilot must not store special-category health data. The attendance
-- table was deployed before this guard, so normalize any legacy injury/reason data first
-- and enforce the same rule even for stale clients and direct API calls.
update public.koutsi_training_absences
   set reason = 'poissa',
       note = null
 where reason <> 'poissa'
    or note is not null;

create or replace function public.koutsi_enforce_pilot_absence_limits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.reason <> 'poissa' then
    raise exception 'Beta-pilotissa läsnäoloon voi merkitä vain poissaolon ilman terveystietoa';
  end if;

  if nullif(btrim(coalesce(new.note, '')), '') is not null then
    raise exception 'Beta-pilotissa poissaolon syytä ei tallenneta';
  end if;

  new.note := null;
  return new;
end;
$function$;

revoke all on function public.koutsi_enforce_pilot_absence_limits()
  from public, anon, authenticated;

drop trigger if exists koutsi_training_absences_pilot_limits
  on public.koutsi_training_absences;

create trigger koutsi_training_absences_pilot_limits
before insert or update on public.koutsi_training_absences
for each row execute function public.koutsi_enforce_pilot_absence_limits();
