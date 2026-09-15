-- Adds coordinates to challenges so the web app can show a map and sort by
-- distance ("mikä kenttä on lähin"). Nullable: existing rows and free-text
-- locations without a pinned point simply have no map/distance.
alter table public.challenges add column if not exists latitude double precision;
alter table public.challenges add column if not exists longitude double precision;
