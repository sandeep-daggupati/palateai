alter table public.restaurants
  add column if not exists custom_name text,
  add column if not exists approx_address text,
  add column if not exists accuracy_meters double precision;

