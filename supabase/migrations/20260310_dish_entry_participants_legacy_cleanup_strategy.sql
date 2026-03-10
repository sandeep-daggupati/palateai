create table if not exists public.dish_entry_participants_cleanup_backup (
  archived_at timestamptz not null default now(),
  id uuid not null,
  dish_entry_id uuid not null,
  user_id uuid not null,
  had_it boolean not null,
  rating smallint,
  note text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create or replace function public.cleanup_legacy_shared_had_it_autofill(
  p_cutoff timestamptz default '2026-03-11T00:00:00Z',
  p_apply boolean default false
)
returns table (
  dish_entry_id uuid,
  user_id uuid,
  reason text
)
language plpgsql
as $$
begin
  if p_apply then
    insert into public.dish_entry_participants_cleanup_backup (
      id,
      dish_entry_id,
      user_id,
      had_it,
      rating,
      note,
      created_at,
      updated_at
    )
    select
      dep.id,
      dep.dish_entry_id,
      dep.user_id,
      dep.had_it,
      dep.rating,
      dep.note,
      dep.created_at,
      dep.updated_at
    from public.dish_entry_participants dep
    join public.dish_entries de on de.id = dep.dish_entry_id
    join public.receipt_uploads ru on ru.id = de.source_upload_id
    where coalesce(ru.is_shared, false) = true
      and dep.user_id = ru.user_id
      and dep.had_it = true
      and dep.rating is null
      and coalesce(nullif(trim(dep.note), ''), null) is null
      and dep.created_at <= p_cutoff
      and dep.updated_at = dep.created_at
      and not exists (
        select 1
        from public.dish_entry_participants dep_other
        where dep_other.dish_entry_id = dep.dish_entry_id
          and dep_other.user_id <> dep.user_id
          and dep_other.had_it = true
      )
    on conflict do nothing;

    delete from public.dish_entry_participants dep
    using public.dish_entries de, public.receipt_uploads ru
    where de.id = dep.dish_entry_id
      and ru.id = de.source_upload_id
      and coalesce(ru.is_shared, false) = true
      and dep.user_id = ru.user_id
      and dep.had_it = true
      and dep.rating is null
      and coalesce(nullif(trim(dep.note), ''), null) is null
      and dep.created_at <= p_cutoff
      and dep.updated_at = dep.created_at
      and not exists (
        select 1
        from public.dish_entry_participants dep_other
        where dep_other.dish_entry_id = dep.dish_entry_id
          and dep_other.user_id <> dep.user_id
          and dep_other.had_it = true
      );
  end if;

  return query
  select
    dep.dish_entry_id,
    dep.user_id,
    'shared_hangout_creator_autofill_candidate'::text as reason
  from public.dish_entry_participants dep
  join public.dish_entries de on de.id = dep.dish_entry_id
  join public.receipt_uploads ru on ru.id = de.source_upload_id
  where coalesce(ru.is_shared, false) = true
    and dep.user_id = ru.user_id
    and dep.had_it = true
    and dep.rating is null
    and coalesce(nullif(trim(dep.note), ''), null) is null
    and dep.created_at <= p_cutoff
    and dep.updated_at = dep.created_at
    and not exists (
      select 1
      from public.dish_entry_participants dep_other
      where dep_other.dish_entry_id = dep.dish_entry_id
        and dep_other.user_id <> dep.user_id
        and dep_other.had_it = true
    );
end;
$$;
