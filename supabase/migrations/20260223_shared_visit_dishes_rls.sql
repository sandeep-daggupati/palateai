-- Shared visit dish visibility for participants
-- Participants need to read extracted_line_items of shared visits.

alter table public.extracted_line_items enable row level security;

drop policy if exists extracted_line_items_select_shared on public.extracted_line_items;
create policy extracted_line_items_select_shared
  on public.extracted_line_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.receipt_uploads ru
      where ru.id = extracted_line_items.upload_id
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
