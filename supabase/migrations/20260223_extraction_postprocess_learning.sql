-- Post-processing support: grouped extraction, quantity, and learned dish-name mappings

alter table public.extracted_line_items
  add column if not exists quantity integer default 1,
  add column if not exists unit_price numeric,
  add column if not exists group_key text,
  add column if not exists grouped boolean default false,
  add column if not exists duplicate_of uuid;

update public.extracted_line_items
set quantity = coalesce(quantity, 1)
where quantity is null;

alter table public.extracted_line_items
  alter column quantity set default 1;

alter table public.dish_entries
  add column if not exists quantity integer default 1;

update public.dish_entries
set quantity = coalesce(quantity, 1)
where quantity is null;

alter table public.dish_entries
  alter column quantity set default 1;

create table if not exists public.dish_name_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  raw_name text not null,
  normalized_name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists dish_name_mappings_user_restaurant_raw_uq
  on public.dish_name_mappings(user_id, restaurant_id, raw_name);

create unique index if not exists dish_name_mappings_user_global_raw_uq
  on public.dish_name_mappings(user_id, raw_name)
  where restaurant_id is null;

create index if not exists dish_name_mappings_user_restaurant_idx
  on public.dish_name_mappings(user_id, restaurant_id);

alter table public.dish_name_mappings enable row level security;

drop policy if exists dish_name_mappings_select_owner on public.dish_name_mappings;
create policy dish_name_mappings_select_owner
  on public.dish_name_mappings
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists dish_name_mappings_insert_owner on public.dish_name_mappings;
create policy dish_name_mappings_insert_owner
  on public.dish_name_mappings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists dish_name_mappings_update_owner on public.dish_name_mappings;
create policy dish_name_mappings_update_owner
  on public.dish_name_mappings
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists dish_name_mappings_delete_owner on public.dish_name_mappings;
create policy dish_name_mappings_delete_owner
  on public.dish_name_mappings
  for delete
  to authenticated
  using (auth.uid() = user_id);

