-- Allow active participants of a hangout to view photos where kind = 'hangout' and hangout_id matches the visit.
-- Allow active participants of a hangout to view photos where kind = 'dish' and the dish belongs to .source_upload_id.

drop policy if exists photos_select_shared on public.photos;
create policy photos_select_shared
  on public.photos
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      kind = 'hangout' 
      and exists (
        select 1
        from public.visit_participants vp
        where vp.visit_id = photos.hangout_id
          and vp.user_id = auth.uid()
          and vp.status = 'active'
      )
    )
    or (
      kind = 'dish'
      and exists (
        select 1
        from public.dish_entries de
        join public.visit_participants vp
          on vp.visit_id = de.source_upload_id
        where de.id = photos.dish_entry_id
          and vp.user_id = auth.uid()
          and vp.status = 'active'
      )
    )
  );
