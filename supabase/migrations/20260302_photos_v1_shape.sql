-- Photos v1 compatibility fields while preserving existing columns.
alter table public.photos
  add column if not exists created_by uuid;

alter table public.photos
  add column if not exists storage_path text;

update public.photos
set
  created_by = coalesce(created_by, user_id),
  storage_path = coalesce(storage_path, storage_original)
where created_by is null
   or storage_path is null;

alter table public.photos
  alter column created_by set not null;

alter table public.photos
  alter column storage_path set not null;

create index if not exists photos_created_by_idx
  on public.photos(created_by);
