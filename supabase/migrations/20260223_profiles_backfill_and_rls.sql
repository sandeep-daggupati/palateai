-- Ensure profiles support crew display and profile hydration from auth metadata

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  email text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists email text,
  add column if not exists updated_at timestamptz not null default now();

update public.profiles
set updated_at = coalesce(updated_at, now())
where updated_at is null;

create index if not exists profiles_email_idx
  on public.profiles(email);

create index if not exists profiles_display_name_idx
  on public.profiles(display_name);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_select_shared_hangout on public.profiles;
create policy profiles_select_shared_hangout
  on public.profiles
  for select
  to authenticated
  using (
    profiles.id = auth.uid()
    or exists (
      select 1
      from public.receipt_uploads ru
      where ru.user_id = profiles.id
        and (
          ru.user_id = auth.uid()
          or exists (
            select 1
            from public.visit_participants vp
            where vp.visit_id = ru.id
              and vp.user_id = auth.uid()
              and vp.status = 'active'
          )
        )
    )
    or exists (
      select 1
      from public.visit_participants vp_target
      join public.visit_participants vp_self on vp_self.visit_id = vp_target.visit_id
      where vp_target.user_id = profiles.id
        and vp_target.status = 'active'
        and vp_self.user_id = auth.uid()
        and vp_self.status = 'active'
    )
  );

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = profiles.id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = profiles.id)
  with check (auth.uid() = profiles.id);
