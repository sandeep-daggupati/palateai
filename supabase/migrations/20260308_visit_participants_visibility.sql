-- Restore shared crew visibility for visit_participants without recursive RLS checks.

create or replace function public.can_access_visit(p_visit_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.receipt_uploads ru
    where ru.id = p_visit_id
      and (
        ru.user_id = p_user_id
        or exists (
          select 1
          from public.visit_participants vp
          where vp.visit_id = ru.id
            and vp.user_id = p_user_id
            and vp.status = 'active'
        )
      )
  );
$$;

revoke all on function public.can_access_visit(uuid, uuid) from public;
grant execute on function public.can_access_visit(uuid, uuid) to authenticated, service_role;

alter table public.visit_participants enable row level security;

drop policy if exists visit_participants_select_shared on public.visit_participants;
create policy visit_participants_select_shared
  on public.visit_participants
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_access_visit(visit_id, auth.uid())
  );
