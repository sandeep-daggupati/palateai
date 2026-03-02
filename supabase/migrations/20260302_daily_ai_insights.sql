create table if not exists public.daily_ai_insights (
  user_id uuid not null references auth.users(id) on delete cascade,
  insight_date date not null,
  insight_text text not null,
  insight_type text not null,
  metadata jsonb,
  generated_at timestamptz not null default now(),
  primary key (user_id, insight_date)
);

create index if not exists daily_ai_insights_user_generated_idx
  on public.daily_ai_insights(user_id, generated_at desc);

alter table public.daily_ai_insights enable row level security;

drop policy if exists daily_ai_insights_select_own on public.daily_ai_insights;
create policy daily_ai_insights_select_own
  on public.daily_ai_insights
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists daily_ai_insights_insert_own on public.daily_ai_insights;
create policy daily_ai_insights_insert_own
  on public.daily_ai_insights
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists daily_ai_insights_update_own on public.daily_ai_insights;
create policy daily_ai_insights_update_own
  on public.daily_ai_insights
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.daily_insight_stats(p_user_id uuid, p_days int)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select now() - make_interval(days => greatest(1, p_days)) as cutoff
  ),
  recent_dishes as (
    select
      coalesce(nullif(trim(de.dish_name), ''), 'Unknown dish') as dish_name,
      de.restaurant_id,
      coalesce(de.eaten_at, de.created_at) as occurred_at,
      coalesce(de.price_original, 0)::numeric as price_original,
      greatest(1, coalesce(de.quantity, 1))::numeric as qty,
      de.identity_tag
    from public.dish_entries de
    cross join bounds b
    where de.user_id = p_user_id
      and coalesce(de.eaten_at, de.created_at) >= b.cutoff
  ),
  recent_hangouts as (
    select h.id, h.restaurant_id, h.occurred_at
    from public.hangouts h
    cross join bounds b
    where h.occurred_at >= b.cutoff
      and (
        h.owner_user_id = p_user_id
        or exists (
          select 1
          from public.hangout_participants hp
          where hp.hangout_id = h.id
            and hp.user_id = p_user_id
        )
      )
  ),
  top_dish as (
    select rd.dish_name as name, count(*)::int as count
    from recent_dishes rd
    group by rd.dish_name
    order by count(*) desc, rd.dish_name asc
    limit 1
  ),
  top_restaurant as (
    select
      coalesce(r.name, 'Unknown restaurant') as name,
      count(*)::int as count
    from recent_dishes rd
    left join public.restaurants r on r.id = rd.restaurant_id
    where rd.restaurant_id is not null
    group by coalesce(r.name, 'Unknown restaurant')
    order by count(*) desc, coalesce(r.name, 'Unknown restaurant') asc
    limit 1
  ),
  totals as (
    select
      (select count(*)::int from recent_hangouts) as hangout_count,
      (select count(*)::int from recent_dishes) as dish_count,
      (select count(distinct rd.restaurant_id)::int from recent_dishes rd where rd.restaurant_id is not null) as unique_restaurant_count,
      (select coalesce(round(sum(rd.price_original * rd.qty), 2), 0) from recent_dishes rd) as spend_total,
      (select count(*)::int from recent_dishes rd where rd.identity_tag = 'go_to') as go_to_count,
      (select count(*)::int from recent_dishes rd where rd.identity_tag = 'never_again') as never_again_count
  )
  select jsonb_build_object(
    'window_days', greatest(1, p_days),
    'hangout_count', totals.hangout_count,
    'dish_count', totals.dish_count,
    'unique_restaurant_count', totals.unique_restaurant_count,
    'spend_total', totals.spend_total,
    'go_to_count', totals.go_to_count,
    'never_again_count', totals.never_again_count,
    'top_dish', coalesce((select to_jsonb(td) from top_dish td), jsonb_build_object('name', null, 'count', 0)),
    'top_restaurant', coalesce((select to_jsonb(tr) from top_restaurant tr), jsonb_build_object('name', null, 'count', 0))
  )
  from totals;
$$;

create or replace function public.daily_insight_stats_7d(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.daily_insight_stats(p_user_id, 7);
$$;

create or replace function public.daily_insight_stats_14d(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.daily_insight_stats(p_user_id, 14);
$$;

create or replace function public.daily_insight_stats_30d(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.daily_insight_stats(p_user_id, 30);
$$;

revoke all on function public.daily_insight_stats(uuid, int) from public;
revoke all on function public.daily_insight_stats_7d(uuid) from public;
revoke all on function public.daily_insight_stats_14d(uuid) from public;
revoke all on function public.daily_insight_stats_30d(uuid) from public;

grant execute on function public.daily_insight_stats(uuid, int) to authenticated, service_role;
grant execute on function public.daily_insight_stats_7d(uuid) to authenticated, service_role;
grant execute on function public.daily_insight_stats_14d(uuid) to authenticated, service_role;
grant execute on function public.daily_insight_stats_30d(uuid) to authenticated, service_role;
