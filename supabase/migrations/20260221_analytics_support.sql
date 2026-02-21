-- Analytics support migration for PalateAI

-- 1) Explicit visit timestamp on uploads
alter table public.receipt_uploads
  add column if not exists visited_at timestamptz;

update public.receipt_uploads
set visited_at = created_at
where visited_at is null;

-- 2) Dish analytics timestamps and grouping key support
alter table public.dish_entries
  add column if not exists eaten_at timestamptz;

update public.dish_entries
set eaten_at = created_at
where eaten_at is null;

alter table public.dish_entries
  add column if not exists dish_key text;

update public.dish_entries
set dish_key = lower(regexp_replace(trim(dish_name), '\\s+', ' ', 'g'))
where dish_key is null;

-- 3) Performance indexes for analytics queries
create index if not exists dish_entries_user_eaten_at_idx
  on public.dish_entries(user_id, eaten_at desc);

create index if not exists dish_entries_user_restaurant_idx
  on public.dish_entries(user_id, restaurant_id);

create index if not exists dish_entries_user_dish_key_idx
  on public.dish_entries(user_id, dish_key);

create index if not exists receipt_uploads_user_visited_at_idx
  on public.receipt_uploads(user_id, visited_at desc);
