-- Link personal dish entries to canonical shared hangout items.
alter table public.dish_entries
  add column if not exists hangout_item_id uuid;

alter table public.dish_entries
  drop constraint if exists dish_entries_hangout_item_id_fkey;

alter table public.dish_entries
  add constraint dish_entries_hangout_item_id_fkey
  foreign key (hangout_item_id) references public.hangout_items(id) on delete set null
  not valid;

create index if not exists dish_entries_hangout_item_idx
  on public.dish_entries(hangout_item_id);

create unique index if not exists dish_entries_user_hangout_item_uidx
  on public.dish_entries(user_id, hangout_item_id)
  where hangout_item_id is not null;

-- Best-effort backfill using normalized dish names within the same hangout.
with matches as (
  select
    de.id as dish_entry_id,
    hi.id as hangout_item_id,
    row_number() over (
      partition by de.id
      order by
        abs(coalesce(de.price_original, 0) - coalesce(hi.unit_price, 0)),
        hi.created_at asc
    ) as rn
  from public.dish_entries de
  join public.hangout_items hi
    on hi.hangout_id = de.hangout_id
   and lower(regexp_replace(coalesce(de.dish_name, ''), '[^a-z0-9]+', '', 'gi')) =
       lower(regexp_replace(coalesce(hi.name_final, hi.name_raw, ''), '[^a-z0-9]+', '', 'gi'))
  where de.hangout_item_id is null
    and de.hangout_id is not null
)
update public.dish_entries de
set hangout_item_id = m.hangout_item_id
from matches m
where de.id = m.dish_entry_id
  and m.rn = 1;

alter table public.dish_entries
  validate constraint dish_entries_hangout_item_id_fkey;
