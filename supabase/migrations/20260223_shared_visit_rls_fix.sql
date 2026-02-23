-- Fix RLS recursion between receipt_uploads and visit_participants
-- Root cause: both policies referenced each other, causing infinite recursion.

alter table public.visit_participants enable row level security;
alter table public.receipt_uploads enable row level security;
alter table public.restaurants enable row level security;

-- Keep participant visibility simple and non-recursive.
-- Users only need to read their own participant rows from the client.
drop policy if exists visit_participants_select_shared on public.visit_participants;
create policy visit_participants_select_shared
  on public.visit_participants
  for select
  to authenticated
  using (user_id = auth.uid());

-- Shared visit read access for host and active participants.
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

-- Allow reading restaurant info for own or shared visits.
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
