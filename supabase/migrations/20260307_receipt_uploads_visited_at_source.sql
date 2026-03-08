alter table public.receipt_uploads
  add column if not exists visited_at_source text;

alter table public.receipt_uploads
  drop constraint if exists receipt_uploads_visited_at_source_check;

alter table public.receipt_uploads
  add constraint receipt_uploads_visited_at_source_check
  check (visited_at_source is null or visited_at_source in ('receipt', 'manual', 'fallback'));
