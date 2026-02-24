alter table public.daily_insights
  add column if not exists category text;

update public.daily_insights
set category = coalesce(category, 'palate')
where category is null;

alter table public.daily_insights
  alter column category set not null;

alter table public.daily_insights
  drop constraint if exists daily_insights_category_check;

alter table public.daily_insights
  add constraint daily_insights_category_check
  check (category in ('palate', 'explore', 'spend', 'wildcard'));

create unique index if not exists daily_insights_user_id_uq
  on public.daily_insights(user_id);

-- Day-of-week rotation no longer needs history persistence.
drop table if exists public.daily_insight_history;
