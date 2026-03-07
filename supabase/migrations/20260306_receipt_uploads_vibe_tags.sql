alter table public.receipt_uploads
  add column if not exists vibe_tags text[];
