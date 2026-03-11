create table if not exists public.hangout_vibe_memories (
  id uuid primary key default gen_random_uuid(),
  hangout_id uuid not null references public.receipt_uploads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vibe_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hangout_vibe_memories_hangout_user_uq unique (hangout_id, user_id)
);

create index if not exists hangout_vibe_memories_user_idx
  on public.hangout_vibe_memories(user_id, updated_at desc);

create index if not exists hangout_vibe_memories_hangout_idx
  on public.hangout_vibe_memories(hangout_id, updated_at desc);

create or replace function public.set_hangout_vibe_memories_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_hangout_vibe_memories_updated_at on public.hangout_vibe_memories;
create trigger trg_hangout_vibe_memories_updated_at
before update on public.hangout_vibe_memories
for each row
execute function public.set_hangout_vibe_memories_updated_at();

alter table public.hangout_vibe_memories enable row level security;

drop policy if exists hangout_vibe_memories_select_self on public.hangout_vibe_memories;
create policy hangout_vibe_memories_select_self
  on public.hangout_vibe_memories
  for select
  using (auth.uid() = user_id);

drop policy if exists hangout_vibe_memories_insert_self on public.hangout_vibe_memories;
create policy hangout_vibe_memories_insert_self
  on public.hangout_vibe_memories
  for insert
  with check (
    auth.uid() = user_id
    and (
      exists (
        select 1
        from public.receipt_uploads ru
        where ru.id = hangout_vibe_memories.hangout_id
          and ru.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.visit_participants vp
        where vp.visit_id = hangout_vibe_memories.hangout_id
          and vp.user_id = auth.uid()
          and vp.status = 'active'
      )
    )
  );

drop policy if exists hangout_vibe_memories_update_self on public.hangout_vibe_memories;
create policy hangout_vibe_memories_update_self
  on public.hangout_vibe_memories
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists hangout_vibe_memories_delete_self on public.hangout_vibe_memories;
create policy hangout_vibe_memories_delete_self
  on public.hangout_vibe_memories
  for delete
  using (auth.uid() = user_id);

insert into public.hangout_vibe_memories (hangout_id, user_id, vibe_tags)
select
  ru.id,
  ru.user_id,
  coalesce(ru.vibe_tags, '{}')
from public.receipt_uploads ru
where coalesce(array_length(ru.vibe_tags, 1), 0) > 0
on conflict (hangout_id, user_id) do update
set
  vibe_tags = excluded.vibe_tags,
  updated_at = now();
