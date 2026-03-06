-- Ensure one photo row per dish entry and efficient hangout photo lookups.

-- Cleanup existing duplicate dish photo rows (keep newest).
with ranked as (
  select
    id,
    row_number() over (
      partition by dish_entry_id
      order by created_at desc, id desc
    ) as rn
  from public.photos
  where kind = 'dish'
    and dish_entry_id is not null
)
delete from public.photos p
using ranked r
where p.id = r.id
  and r.rn > 1;

create unique index if not exists uniq_photos_one_dish_photo
  on public.photos(dish_entry_id)
  where kind = 'dish' and dish_entry_id is not null;

create index if not exists photos_hangout_kind_idx
  on public.photos(hangout_id, kind);
