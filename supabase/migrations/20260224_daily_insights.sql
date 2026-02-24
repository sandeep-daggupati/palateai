create table if not exists public.daily_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  insight_text text not null,
  metrics_snapshot jsonb not null,
  evidence_type text not null check (evidence_type in ('dish', 'restaurant', 'hangout', 'summary')),
  evidence jsonb not null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create unique index if not exists daily_insights_user_id_uq
  on public.daily_insights(user_id);

create index if not exists daily_insights_expires_at_idx
  on public.daily_insights(expires_at);

alter table public.daily_insights enable row level security;

drop policy if exists daily_insights_select_own on public.daily_insights;
create policy daily_insights_select_own
  on public.daily_insights
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists daily_insights_insert_own on public.daily_insights;
create policy daily_insights_insert_own
  on public.daily_insights
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists daily_insights_update_own on public.daily_insights;
create policy daily_insights_update_own
  on public.daily_insights
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists daily_insights_delete_own on public.daily_insights;
create policy daily_insights_delete_own
  on public.daily_insights
  for delete
  to authenticated
  using (auth.uid() = user_id);
