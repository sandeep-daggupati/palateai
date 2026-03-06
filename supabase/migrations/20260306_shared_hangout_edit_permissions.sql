-- Shared hangout permissions: owner + active crew members have equal access
-- across receipt_uploads, dish_entries, and photos.

alter table public.visit_participants enable row level security;
alter table public.receipt_uploads enable row level security;
alter table public.dish_entries enable row level security;
alter table public.photos enable row level security;

-- receipt_uploads

drop policy if exists receipt_uploads_select_shared on public.receipt_uploads;
drop policy if exists receipt_uploads_insert_own on public.receipt_uploads;
drop policy if exists receipt_uploads_update_shared on public.receipt_uploads;
drop policy if exists receipt_uploads_delete_shared on public.receipt_uploads;

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

create policy receipt_uploads_insert_own
  on public.receipt_uploads
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy receipt_uploads_update_shared
  on public.receipt_uploads
  for update
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
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1
      from public.visit_participants vp
      where vp.visit_id = receipt_uploads.id
        and vp.user_id = auth.uid()
        and vp.status = 'active'
    )
  );

create policy receipt_uploads_delete_shared
  on public.receipt_uploads
  for delete
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

-- dish_entries

drop policy if exists dish_entries_select_shared on public.dish_entries;
drop policy if exists dish_entries_insert_shared on public.dish_entries;
drop policy if exists dish_entries_update_shared on public.dish_entries;
drop policy if exists dish_entries_delete_shared on public.dish_entries;

create policy dish_entries_select_shared
  on public.dish_entries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.receipt_uploads ru
      where ru.id = dish_entries.source_upload_id
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
  );

create policy dish_entries_insert_shared
  on public.dish_entries
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.receipt_uploads ru
      where ru.id = dish_entries.source_upload_id
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
  );

create policy dish_entries_update_shared
  on public.dish_entries
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.receipt_uploads ru
      where ru.id = dish_entries.source_upload_id
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
  with check (
    exists (
      select 1
      from public.receipt_uploads ru
      where ru.id = dish_entries.source_upload_id
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
  );

create policy dish_entries_delete_shared
  on public.dish_entries
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.receipt_uploads ru
      where ru.id = dish_entries.source_upload_id
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
  );

-- photos

drop policy if exists photos_select_own on public.photos;
drop policy if exists photos_insert_own on public.photos;
drop policy if exists photos_delete_own on public.photos;
drop policy if exists photos_select_shared on public.photos;
drop policy if exists photos_insert_shared on public.photos;
drop policy if exists photos_update_shared on public.photos;
drop policy if exists photos_delete_shared on public.photos;

create policy photos_select_shared
  on public.photos
  for select
  to authenticated
  using (
    (
      photos.hangout_id is not null
      and exists (
        select 1
        from public.receipt_uploads ru
        where ru.id = photos.hangout_id
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
    or
    (
      photos.dish_entry_id is not null
      and exists (
        select 1
        from public.dish_entries de
        join public.receipt_uploads ru on ru.id = de.source_upload_id
        where de.id = photos.dish_entry_id
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
  );

create policy photos_insert_shared
  on public.photos
  for insert
  to authenticated
  with check (
    (
      photos.hangout_id is not null
      and exists (
        select 1
        from public.receipt_uploads ru
        where ru.id = photos.hangout_id
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
    or
    (
      photos.dish_entry_id is not null
      and exists (
        select 1
        from public.dish_entries de
        join public.receipt_uploads ru on ru.id = de.source_upload_id
        where de.id = photos.dish_entry_id
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
  );

create policy photos_update_shared
  on public.photos
  for update
  to authenticated
  using (
    (
      photos.hangout_id is not null
      and exists (
        select 1
        from public.receipt_uploads ru
        where ru.id = photos.hangout_id
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
    or
    (
      photos.dish_entry_id is not null
      and exists (
        select 1
        from public.dish_entries de
        join public.receipt_uploads ru on ru.id = de.source_upload_id
        where de.id = photos.dish_entry_id
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
  with check (
    (
      photos.hangout_id is not null
      and exists (
        select 1
        from public.receipt_uploads ru
        where ru.id = photos.hangout_id
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
    or
    (
      photos.dish_entry_id is not null
      and exists (
        select 1
        from public.dish_entries de
        join public.receipt_uploads ru on ru.id = de.source_upload_id
        where de.id = photos.dish_entry_id
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
  );

create policy photos_delete_shared
  on public.photos
  for delete
  to authenticated
  using (
    (
      photos.hangout_id is not null
      and exists (
        select 1
        from public.receipt_uploads ru
        where ru.id = photos.hangout_id
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
    or
    (
      photos.dish_entry_id is not null
      and exists (
        select 1
        from public.dish_entries de
        join public.receipt_uploads ru on ru.id = de.source_upload_id
        where de.id = photos.dish_entry_id
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
  );
