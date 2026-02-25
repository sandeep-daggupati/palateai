alter table public.restaurants
  add column if not exists seed_tag text;

alter table public.receipt_uploads
  add column if not exists seed_tag text;

alter table public.dish_entries
  add column if not exists seed_tag text;

alter table public.visit_participants
  add column if not exists seed_tag text;

alter table public.extracted_line_items
  add column if not exists seed_tag text;

create index if not exists restaurants_user_seed_tag_idx
  on public.restaurants(user_id, seed_tag);

create index if not exists receipt_uploads_user_seed_tag_idx
  on public.receipt_uploads(user_id, seed_tag);

create index if not exists dish_entries_user_seed_tag_idx
  on public.dish_entries(user_id, seed_tag);

create index if not exists visit_participants_seed_tag_idx
  on public.visit_participants(seed_tag);

create index if not exists extracted_line_items_seed_tag_idx
  on public.extracted_line_items(seed_tag);
