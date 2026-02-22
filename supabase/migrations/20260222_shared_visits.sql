-- Shared visits (private, async collaboration)

alter table public.receipt_uploads
  add column if not exists is_shared boolean default false,
  add column if not exists share_visibility text default 'private';

alter table public.receipt_uploads
  drop constraint if exists receipt_uploads_share_visibility_check;

alter table public.receipt_uploads
  add constraint receipt_uploads_share_visibility_check
  check (share_visibility in ('private', 'public'));

create table if not exists public.visit_participants (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.receipt_uploads(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'participant',
  invited_email text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint visit_participants_role_check check (role in ('host', 'participant')),
  constraint visit_participants_status_check check (status in ('active', 'invited', 'removed'))
);

create unique index if not exists visit_participants_visit_user_uq
  on public.visit_participants(visit_id, user_id)
  where user_id is not null;

create unique index if not exists visit_participants_visit_email_uq
  on public.visit_participants(visit_id, invited_email)
  where invited_email is not null;

alter table public.dish_entries
  add column if not exists had_it boolean default true;

create unique index if not exists dish_entries_user_visit_dishkey_uq
  on public.dish_entries(user_id, source_upload_id, dish_key);

create index if not exists dish_entries_user_source_upload_idx
  on public.dish_entries(user_id, source_upload_id);

create index if not exists dish_entries_source_upload_idx
  on public.dish_entries(source_upload_id);

create index if not exists visit_participants_user_visit_idx
  on public.visit_participants(user_id, visit_id)
  where status = 'active';
