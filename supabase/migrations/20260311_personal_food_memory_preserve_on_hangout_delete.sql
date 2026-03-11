create table if not exists public.personal_food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_dish_entry_id uuid references public.dish_entries(id) on delete set null,
  source_hangout_id uuid references public.receipt_uploads(id) on delete set null,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  dish_key text,
  dish_name text not null,
  price numeric,
  photo_path text,
  rating smallint,
  note text,
  reaction_tag public.dish_identity,
  had_it boolean not null default true,
  detached_from_hangout boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop index if exists personal_food_entries_user_source_dish_uidx;
create unique index if not exists personal_food_entries_user_source_dish_uidx
  on public.personal_food_entries(user_id, source_dish_entry_id);

create index if not exists personal_food_entries_user_had_updated_idx
  on public.personal_food_entries(user_id, had_it, updated_at desc);

create index if not exists personal_food_entries_user_dish_key_idx
  on public.personal_food_entries(user_id, dish_key);

create index if not exists personal_food_entries_user_source_hangout_idx
  on public.personal_food_entries(user_id, source_hangout_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personal_food_entries_rating_check'
  ) then
    alter table public.personal_food_entries
      add constraint personal_food_entries_rating_check
      check (rating is null or (rating >= 1 and rating <= 5));
  end if;
end $$;

create or replace function public.set_personal_food_entries_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_personal_food_entries_updated_at on public.personal_food_entries;
create trigger trg_personal_food_entries_updated_at
before update on public.personal_food_entries
for each row
execute function public.set_personal_food_entries_updated_at();

alter table public.personal_food_entries enable row level security;

drop policy if exists personal_food_entries_select_self on public.personal_food_entries;
create policy personal_food_entries_select_self
  on public.personal_food_entries
  for select
  using (auth.uid() = user_id);

drop policy if exists personal_food_entries_insert_self on public.personal_food_entries;
create policy personal_food_entries_insert_self
  on public.personal_food_entries
  for insert
  with check (auth.uid() = user_id);

drop policy if exists personal_food_entries_update_self on public.personal_food_entries;
create policy personal_food_entries_update_self
  on public.personal_food_entries
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists personal_food_entries_delete_self on public.personal_food_entries;
create policy personal_food_entries_delete_self
  on public.personal_food_entries
  for delete
  using (auth.uid() = user_id);

insert into public.personal_food_entries (
  user_id,
  source_dish_entry_id,
  source_hangout_id,
  restaurant_id,
  dish_key,
  dish_name,
  price,
  rating,
  note,
  reaction_tag,
  had_it,
  detached_from_hangout
)
select
  dep.user_id,
  de.id,
  de.source_upload_id,
  de.restaurant_id,
  de.dish_key,
  de.dish_name,
  de.price_original,
  dep.rating,
  nullif(trim(coalesce(dep.note, de.comment, '')), ''),
  de.identity_tag,
  dep.had_it,
  false
from public.dish_entry_participants dep
join public.dish_entries de on de.id = dep.dish_entry_id
where dep.had_it = true
   or dep.rating is not null
   or nullif(trim(coalesce(dep.note, '')), '') is not null
on conflict (user_id, source_dish_entry_id)
do update set
  source_hangout_id = excluded.source_hangout_id,
  restaurant_id = excluded.restaurant_id,
  dish_key = excluded.dish_key,
  dish_name = excluded.dish_name,
  price = excluded.price,
  rating = coalesce(excluded.rating, personal_food_entries.rating),
  note = coalesce(excluded.note, personal_food_entries.note),
  reaction_tag = coalesce(excluded.reaction_tag, personal_food_entries.reaction_tag),
  had_it = excluded.had_it,
  updated_at = now();

create or replace function public.delete_hangout_preserve_personal_memories(
  p_hangout_id uuid,
  p_request_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_preserved_count integer := 0;
  v_deleted_receipt_count integer := 0;
  v_deleted_hangout_count integer := 0;
begin
  select ru.user_id
  into v_owner_id
  from public.receipt_uploads ru
  where ru.id = p_hangout_id;

  if v_owner_id is null then
    raise exception 'Hangout not found';
  end if;

  if v_owner_id <> p_request_user_id then
    raise exception 'Only the hangout creator can delete this hangout';
  end if;

  with dish_rows as (
    select
      de.id as dish_entry_id,
      de.source_upload_id as hangout_id,
      de.restaurant_id,
      de.dish_key,
      de.dish_name,
      de.price_original,
      de.identity_tag,
      de.comment
    from public.dish_entries de
    where de.source_upload_id = p_hangout_id
  ),
  dep_engagement as (
    select
      dr.dish_entry_id,
      dep.user_id,
      dep.had_it,
      dep.rating,
      nullif(trim(coalesce(dep.note, '')), '') as note,
      dr.identity_tag as reaction_tag,
      dr.comment as owner_shared_note
    from dish_rows dr
    join public.dish_entry_participants dep on dep.dish_entry_id = dr.dish_entry_id
    where dep.had_it = true
       or dep.rating is not null
       or nullif(trim(coalesce(dep.note, '')), '') is not null
  ),
  photo_engagement as (
    select
      dr.dish_entry_id,
      p.user_id,
      true as had_it,
      null::smallint as rating,
      null::text as note,
      null::public.dish_identity as reaction_tag,
      null::text as owner_shared_note
    from dish_rows dr
    join public.photos p
      on p.dish_entry_id = dr.dish_entry_id
     and p.kind = 'dish'
  ),
  owner_reaction_engagement as (
    select
      dr.dish_entry_id,
      v_owner_id as user_id,
      true as had_it,
      null::smallint as rating,
      null::text as note,
      dr.identity_tag as reaction_tag,
      dr.comment as owner_shared_note
    from dish_rows dr
    where dr.identity_tag is not null
       or nullif(trim(coalesce(dr.comment, '')), '') is not null
  ),
  engagement_union as (
    select * from dep_engagement
    union all
    select * from photo_engagement
    union all
    select * from owner_reaction_engagement
  ),
  latest_user_photo as (
    select distinct on (p.dish_entry_id, p.user_id)
      p.dish_entry_id,
      p.user_id,
      coalesce(p.storage_medium, p.storage_original) as photo_path
    from public.photos p
    where p.kind = 'dish'
      and p.dish_entry_id in (select dish_entry_id from dish_rows)
    order by p.dish_entry_id, p.user_id, p.created_at desc
  ),
  aggregated as (
    select
      eu.dish_entry_id,
      eu.user_id,
      bool_or(eu.had_it) as had_it,
      max(eu.rating) as rating,
      max(eu.reaction_tag) as reaction_tag,
      max(coalesce(eu.note, eu.owner_shared_note)) as note
    from engagement_union eu
    group by eu.dish_entry_id, eu.user_id
  ),
  upserted as (
    insert into public.personal_food_entries (
      user_id,
      source_dish_entry_id,
      source_hangout_id,
      restaurant_id,
      dish_key,
      dish_name,
      price,
      photo_path,
      rating,
      note,
      reaction_tag,
      had_it,
      detached_from_hangout
    )
    select
      a.user_id,
      a.dish_entry_id,
      dr.hangout_id,
      dr.restaurant_id,
      dr.dish_key,
      dr.dish_name,
      dr.price_original,
      lup.photo_path,
      a.rating,
      nullif(trim(coalesce(a.note, '')), ''),
      a.reaction_tag,
      coalesce(a.had_it, true),
      true
    from aggregated a
    join dish_rows dr on dr.dish_entry_id = a.dish_entry_id
    left join latest_user_photo lup
      on lup.dish_entry_id = a.dish_entry_id
     and lup.user_id = a.user_id
    on conflict (user_id, source_dish_entry_id)
    do update set
      source_hangout_id = excluded.source_hangout_id,
      restaurant_id = coalesce(excluded.restaurant_id, personal_food_entries.restaurant_id),
      dish_key = coalesce(excluded.dish_key, personal_food_entries.dish_key),
      dish_name = excluded.dish_name,
      price = coalesce(excluded.price, personal_food_entries.price),
      photo_path = coalesce(excluded.photo_path, personal_food_entries.photo_path),
      rating = coalesce(excluded.rating, personal_food_entries.rating),
      note = coalesce(excluded.note, personal_food_entries.note),
      reaction_tag = coalesce(excluded.reaction_tag, personal_food_entries.reaction_tag),
      had_it = excluded.had_it,
      detached_from_hangout = true,
      updated_at = now()
    returning 1
  )
  select count(*) into v_preserved_count from upserted;

  delete from public.hangouts h
  where h.id = p_hangout_id;
  get diagnostics v_deleted_hangout_count = row_count;

  delete from public.receipt_uploads ru
  where ru.id = p_hangout_id;
  get diagnostics v_deleted_receipt_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'preserved_count', v_preserved_count,
    'deleted_hangout_count', v_deleted_hangout_count,
    'deleted_receipt_count', v_deleted_receipt_count
  );
end;
$$;

revoke all on function public.delete_hangout_preserve_personal_memories(uuid, uuid) from public;
grant execute on function public.delete_hangout_preserve_personal_memories(uuid, uuid) to authenticated, service_role;
