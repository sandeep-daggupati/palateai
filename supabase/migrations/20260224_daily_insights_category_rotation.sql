alter table public.daily_insights
  add column if not exists category text;

update public.daily_insights
set category = coalesce(category, 'palate')
where category is null;

alter table public.daily_insights
  alter column category set not null;

alter table public.daily_insights
  add constraint daily_insights_category_check
  check (category in ('palate', 'explore', 'spend'));

create table if not exists public.daily_insight_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  insight_id uuid references public.daily_insights(id) on delete set null,
  category text not null check (category in ('palate', 'explore', 'spend')),
  insight_text text not null,
  generated_at timestamptz not null default now()
);

create index if not exists daily_insight_history_user_generated_idx
  on public.daily_insight_history(user_id, generated_at desc);

alter table public.daily_insight_history enable row level security;

drop policy if exists daily_insight_history_select_own on public.daily_insight_history;
create policy daily_insight_history_select_own
  on public.daily_insight_history
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists daily_insight_history_insert_own on public.daily_insight_history;
create policy daily_insight_history_insert_own
  on public.daily_insight_history
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists daily_insight_history_update_own on public.daily_insight_history;
create policy daily_insight_history_update_own
  on public.daily_insight_history
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists daily_insight_history_delete_own on public.daily_insight_history;
create policy daily_insight_history_delete_own
  on public.daily_insight_history
  for delete
  to authenticated
  using (auth.uid() = user_id);
