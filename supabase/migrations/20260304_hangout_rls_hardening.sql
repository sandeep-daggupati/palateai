create or replace function public.is_hangout_visible(p_hangout_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hangouts h
    where h.id = p_hangout_id
      and (
        h.owner_user_id = p_user_id
        or exists (
          select 1
          from public.hangout_participants hp
          where hp.hangout_id = h.id
            and hp.user_id = p_user_id
        )
      )
  );
$$;

revoke all on function public.is_hangout_visible(uuid, uuid) from public;
grant execute on function public.is_hangout_visible(uuid, uuid) to authenticated, service_role;

create or replace function public.is_hangout_owner(p_hangout_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hangouts h
    where h.id = p_hangout_id
      and h.owner_user_id = p_user_id
  );
$$;

revoke all on function public.is_hangout_owner(uuid, uuid) from public;
grant execute on function public.is_hangout_owner(uuid, uuid) to authenticated, service_role;

alter table public.hangout_participants enable row level security;
alter table public.hangout_items enable row level security;

drop policy if exists hangout_participants_insert_owner on public.hangout_participants;
create policy hangout_participants_insert_owner
  on public.hangout_participants
  for insert
  to authenticated
  with check (public.is_hangout_owner(hangout_id, auth.uid()));

drop policy if exists hangout_participants_update_owner on public.hangout_participants;
create policy hangout_participants_update_owner
  on public.hangout_participants
  for update
  to authenticated
  using (public.is_hangout_owner(hangout_id, auth.uid()))
  with check (public.is_hangout_owner(hangout_id, auth.uid()));

drop policy if exists hangout_items_insert_owner on public.hangout_items;
create policy hangout_items_insert_owner
  on public.hangout_items
  for insert
  to authenticated
  with check (public.is_hangout_owner(hangout_id, auth.uid()));
