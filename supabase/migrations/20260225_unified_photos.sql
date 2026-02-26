create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hangout_id uuid references public.receipt_uploads(id) on delete cascade,
  dish_entry_id uuid references public.dish_entries(id) on delete cascade,
  kind text not null check (kind in ('hangout', 'dish')),
  storage_original text not null,
  storage_medium text not null,
  storage_thumb text not null,
  created_at timestamptz not null default now(),
  constraint photos_kind_association_check check (
    (kind = 'hangout' and hangout_id is not null and dish_entry_id is null)
    or
    (kind = 'dish' and dish_entry_id is not null and hangout_id is null)
  )
);

create index if not exists photos_user_kind_created_idx
  on public.photos(user_id, kind, created_at desc);

create index if not exists photos_hangout_idx
  on public.photos(hangout_id)
  where kind = 'hangout';

create index if not exists photos_dish_entry_idx
  on public.photos(dish_entry_id)
  where kind = 'dish';

alter table public.photos enable row level security;

drop policy if exists photos_select_own on public.photos;
create policy photos_select_own
  on public.photos
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists photos_insert_own on public.photos;
create policy photos_insert_own
  on public.photos
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists photos_delete_own on public.photos;
create policy photos_delete_own
  on public.photos
  for delete
  to authenticated
  using (auth.uid() = user_id);
