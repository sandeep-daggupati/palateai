alter table public.restaurants
  add column if not exists phone_number text,
  add column if not exists website text,
  add column if not exists opening_hours jsonb;
