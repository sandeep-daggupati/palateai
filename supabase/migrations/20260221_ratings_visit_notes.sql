-- Ratings + visit notes support

-- A) Dish-level feedback at extraction stage
alter table public.extracted_line_items
  add column if not exists rating smallint,
  add column if not exists comment text;

alter table public.extracted_line_items
  drop constraint if exists extracted_line_items_rating_check;

alter table public.extracted_line_items
  add constraint extracted_line_items_rating_check
  check (rating is null or (rating >= 1 and rating <= 5));

-- B) Visit-level feedback on uploads
alter table public.receipt_uploads
  add column if not exists visit_rating smallint,
  add column if not exists visit_note text;

alter table public.receipt_uploads
  drop constraint if exists receipt_uploads_visit_rating_check;

alter table public.receipt_uploads
  add constraint receipt_uploads_visit_rating_check
  check (visit_rating is null or (visit_rating >= 1 and visit_rating <= 5));

-- C) Persist feedback to final dish entries
alter table public.dish_entries
  add column if not exists rating smallint,
  add column if not exists comment text;

alter table public.dish_entries
  drop constraint if exists dish_entries_rating_check;

alter table public.dish_entries
  add constraint dish_entries_rating_check
  check (rating is null or (rating >= 1 and rating <= 5));
