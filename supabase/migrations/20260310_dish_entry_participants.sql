create table if not exists public.dish_entry_participants (
  id uuid primary key default gen_random_uuid(),
  dish_entry_id uuid not null references public.dish_entries(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  had_it boolean not null default true,
  rating smallint,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists dish_entry_participants_entry_user_uidx
  on public.dish_entry_participants(dish_entry_id, user_id);

create index if not exists dish_entry_participants_user_had_idx
  on public.dish_entry_participants(user_id, had_it, updated_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dish_entry_participants_rating_check'
  ) then
    alter table public.dish_entry_participants
      add constraint dish_entry_participants_rating_check
      check (rating is null or (rating >= 1 and rating <= 5));
  end if;
end $$;

create or replace function public.set_dish_entry_participants_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_dish_entry_participants_updated_at on public.dish_entry_participants;
create trigger trg_dish_entry_participants_updated_at
before update on public.dish_entry_participants
for each row
execute function public.set_dish_entry_participants_updated_at();

alter table public.dish_entry_participants enable row level security;

drop policy if exists dish_entry_participants_select_shared on public.dish_entry_participants;
create policy dish_entry_participants_select_shared
  on public.dish_entry_participants
  for select
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.dish_entries de
      where de.id = dish_entry_participants.dish_entry_id
        and (
          de.user_id = auth.uid()
          or exists (
            select 1
            from public.receipt_uploads ru
            where ru.id = de.source_upload_id
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
        )
    )
  );

drop policy if exists dish_entry_participants_insert_self on public.dish_entry_participants;
create policy dish_entry_participants_insert_self
  on public.dish_entry_participants
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.dish_entries de
      where de.id = dish_entry_participants.dish_entry_id
        and (
          de.user_id = auth.uid()
          or exists (
            select 1
            from public.receipt_uploads ru
            where ru.id = de.source_upload_id
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
        )
    )
  );

drop policy if exists dish_entry_participants_update_self on public.dish_entry_participants;
create policy dish_entry_participants_update_self
  on public.dish_entry_participants
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists dish_entry_participants_delete_self on public.dish_entry_participants;
create policy dish_entry_participants_delete_self
  on public.dish_entry_participants
  for delete
  using (auth.uid() = user_id);

insert into public.profiles (id, email, display_name, avatar_url)
select
  au.id,
  au.email,
  nullif(trim(coalesce(au.raw_user_meta_data ->> 'name', split_part(coalesce(au.email, ''), '@', 1))), ''),
  nullif(trim(au.raw_user_meta_data ->> 'avatar_url'), '')
from auth.users au
join (
  select distinct de.user_id
  from public.dish_entries de
  where de.user_id is not null
) de_users on de_users.user_id = au.id
left join public.profiles p on p.id = au.id
where p.id is null;

insert into public.dish_entry_participants (dish_entry_id, user_id, had_it, rating, note)
select
  de.id,
  p.id,
  coalesce(de.had_it, true),
  case when de.rating between 1 and 5 then de.rating::smallint else null end,
  nullif(trim(coalesce(de.comment, '')), '')
from public.dish_entries de
join public.profiles p on p.id = de.user_id
where not exists (
  select 1
  from public.dish_entry_participants dep
  where dep.dish_entry_id = de.id
    and dep.user_id = p.id
);
