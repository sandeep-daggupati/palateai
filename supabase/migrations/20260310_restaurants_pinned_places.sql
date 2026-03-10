alter table public.restaurants
  add column if not exists place_type text not null default 'google';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurants_place_type_check'
  ) then
    alter table public.restaurants
      add constraint restaurants_place_type_check
      check (place_type in ('google', 'pinned'));
  end if;
end $$;
