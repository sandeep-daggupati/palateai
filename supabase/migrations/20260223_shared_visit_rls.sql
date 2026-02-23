-- Shared visit RLS access for host + active participants

alter table public.visit_participants enable row level security;
alter table public.receipt_uploads enable row level security;
alter table public.restaurants enable row level security;

drop policy if exists visit_participants_select_shared on public.visit_participants;
create policy visit_participants_select_shared
  on public.visit_participants
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.receipt_uploads ru
      where ru.id = visit_participants.visit_id
        and ru.user_id = auth.uid()
    )
  );

drop policy if exists receipt_uploads_select_shared on public.receipt_uploads;
create policy receipt_uploads_select_shared
  on public.receipt_uploads
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.visit_participants vp
      where vp.visit_id = receipt_uploads.id
        and vp.user_id = auth.uid()
        and vp.status = 'active'
    )
  );

drop policy if exists restaurants_select_shared on public.restaurants;
create policy restaurants_select_shared
  on public.restaurants
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.receipt_uploads ru
      join public.visit_participants vp
        on vp.visit_id = ru.id
       and vp.user_id = auth.uid()
       and vp.status = 'active'
      where ru.restaurant_id = restaurants.id
    )
  );
