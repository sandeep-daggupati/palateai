alter table public.restaurants
  add column if not exists phone_number text,
  add column if not exists website text,
  add column if not exists maps_url text,
  add column if not exists opening_hours jsonb,
  add column if not exists utc_offset_minutes integer,
  add column if not exists google_rating numeric,
  add column if not exists price_level integer,
  add column if not exists business_status text,
  add column if not exists last_place_sync timestamptz;

create index if not exists restaurants_last_place_sync_idx
  on public.restaurants(last_place_sync);
