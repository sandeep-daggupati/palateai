alter table public.dish_entries
  add column if not exists cuisine text,
  add column if not exists flavor_tags text[];
