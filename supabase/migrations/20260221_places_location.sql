-- Nearby restaurant autocomplete + location tracking support

alter table public.restaurants
  add column if not exists place_id text,
  add column if not exists address text,
  add column if not exists lat double precision,
  add column if not exists lng double precision;

create unique index if not exists restaurants_user_place_id_uq
  on public.restaurants(user_id, place_id)
  where place_id is not null;

alter table public.receipt_uploads
  add column if not exists visit_lat double precision,
  add column if not exists visit_lng double precision;
