alter table public.profiles
  add column if not exists display_name text,
  add column if not exists avatar_url text,
  add column if not exists onboarded boolean not null default false;
