create table if not exists public.dish_catalog (
  dish_key text primary key,
  name_canonical text not null,
  description text,
  cuisine text,
  flavor_tags text[],
  generated_at timestamptz not null default now()
);

alter table public.dish_catalog enable row level security;

drop policy if exists dish_catalog_select_authenticated on public.dish_catalog;
create policy dish_catalog_select_authenticated
  on public.dish_catalog
  for select
  to authenticated
  using (true);
