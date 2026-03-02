create table if not exists public.hangout_summaries (
  hangout_id uuid primary key references public.hangouts(id) on delete cascade,
  summary_text text not null,
  metadata jsonb,
  generated_at timestamptz not null default now()
);

create index if not exists hangout_summaries_generated_idx
  on public.hangout_summaries(generated_at desc);

alter table public.hangout_summaries enable row level security;

drop policy if exists hangout_summaries_select_visible on public.hangout_summaries;
create policy hangout_summaries_select_visible
  on public.hangout_summaries
  for select
  to authenticated
  using (public.is_hangout_visible(hangout_id, auth.uid()));

drop policy if exists hangout_summaries_insert_owner on public.hangout_summaries;
create policy hangout_summaries_insert_owner
  on public.hangout_summaries
  for insert
  to authenticated
  with check (public.is_hangout_owner(hangout_id, auth.uid()));

drop policy if exists hangout_summaries_update_owner on public.hangout_summaries;
create policy hangout_summaries_update_owner
  on public.hangout_summaries
  for update
  to authenticated
  using (public.is_hangout_owner(hangout_id, auth.uid()))
  with check (public.is_hangout_owner(hangout_id, auth.uid()));
