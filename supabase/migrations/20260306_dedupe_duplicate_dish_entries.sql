-- One-time cleanup for duplicate dish entries created by older capture flows.
-- Strategy:
-- 1) Identify duplicate rows within the same user+hangout for same normalized dish+price+quantity.
-- 2) Keep earliest created row, remap photos to that keeper.
-- 3) Merge basic user signals (identity_tag/comment) onto keeper when missing.
-- 4) Delete duplicate rows.

with normalized as (
  select
    de.id,
    de.user_id,
    de.hangout_id,
    lower(regexp_replace(trim(de.dish_name), '\\s+', ' ', 'g')) as norm_name,
    coalesce(round(de.price_original::numeric, 2), -1) as norm_price,
    coalesce(de.quantity, 1) as norm_qty,
    de.created_at,
    de.identity_tag,
    de.comment
  from public.dish_entries de
  where de.hangout_id is not null
),
ranked as (
  select
    n.*,
    first_value(n.id) over (
      partition by n.user_id, n.hangout_id, n.norm_name, n.norm_price, n.norm_qty
      order by n.created_at asc, n.id asc
    ) as keep_id,
    row_number() over (
      partition by n.user_id, n.hangout_id, n.norm_name, n.norm_price, n.norm_qty
      order by n.created_at asc, n.id asc
    ) as rn
  from normalized n
),
dupe_map as (
  select id as dupe_id, keep_id
  from ranked
  where rn > 1
),
keep_fill as (
  select
    r.keep_id,
    max(r.identity_tag) filter (where r.identity_tag is not null) as any_identity_tag,
    max(r.comment) filter (where r.comment is not null and length(trim(r.comment)) > 0) as any_comment
  from ranked r
  join dupe_map d on d.dupe_id = r.id or d.keep_id = r.id
  group by r.keep_id
),
updated_keepers as (
  update public.dish_entries k
  set
    identity_tag = coalesce(k.identity_tag, f.any_identity_tag),
    comment = coalesce(nullif(k.comment, ''), f.any_comment)
  from keep_fill f
  where k.id = f.keep_id
  returning k.id
),
updated_photos as (
  update public.photos p
  set dish_entry_id = d.keep_id
  from dupe_map d
  where p.dish_entry_id = d.dupe_id
  returning p.id
)
delete from public.dish_entries de
using dupe_map d
where de.id = d.dupe_id;
