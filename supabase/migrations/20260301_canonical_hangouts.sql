-- Canonical hangouts model (shared truth + personal truth)
-- Keep legacy receipt_uploads/extracted_line_items/visit_participants for compatibility.

create table if not exists public.hangouts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  occurred_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hangouts_owner_occurred_idx
  on public.hangouts(owner_user_id, occurred_at desc);

create table if not exists public.hangout_participants (
  hangout_id uuid not null references public.hangouts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (hangout_id, user_id)
);

create index if not exists hangout_participants_user_hangout_idx
  on public.hangout_participants(user_id, hangout_id);

create table if not exists public.hangout_sources (
  id uuid primary key default gen_random_uuid(),
  hangout_id uuid not null references public.hangouts(id) on delete cascade,
  type text not null check (type in ('receipt', 'dish_photo', 'hangout_photo', 'manual')),
  storage_path text,
  extractor text check (extractor in ('openai')),
  extracted_at timestamptz,
  extraction_version text,
  raw_extraction jsonb,
  created_at timestamptz not null default now()
);

create index if not exists hangout_sources_hangout_idx
  on public.hangout_sources(hangout_id, created_at desc);

create table if not exists public.hangout_items (
  id uuid primary key default gen_random_uuid(),
  hangout_id uuid not null references public.hangouts(id) on delete cascade,
  source_id uuid references public.hangout_sources(id) on delete set null,
  name_raw text not null,
  name_final text,
  quantity int not null default 1,
  unit_price numeric,
  currency text default 'USD',
  line_total numeric generated always as (
    case when unit_price is null then null else unit_price * quantity end
  ) stored,
  confidence numeric,
  included boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists hangout_items_hangout_idx
  on public.hangout_items(hangout_id);

create index if not exists hangout_items_hangout_included_idx
  on public.hangout_items(hangout_id, included);

alter table public.dish_entries
  add column if not exists hangout_id uuid references public.hangouts(id) on delete cascade;

create index if not exists dish_entries_user_hangout_idx
  on public.dish_entries(user_id, hangout_id);

create index if not exists dish_entries_hangout_idx
  on public.dish_entries(hangout_id);

-- Move photos.hangout_id FK to canonical hangouts.
alter table public.photos
  drop constraint if exists photos_hangout_id_fkey;

alter table public.photos
  add constraint photos_hangout_id_fkey
  foreign key (hangout_id) references public.hangouts(id) on delete cascade
  not valid;

-- RLS helpers (security definer avoids policy recursion)
create or replace function public.is_hangout_visible(p_hangout_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hangouts h
    where h.id = p_hangout_id
      and (
        h.owner_user_id = p_user_id
        or exists (
          select 1
          from public.hangout_participants hp
          where hp.hangout_id = h.id
            and hp.user_id = p_user_id
        )
      )
  );
$$;

revoke all on function public.is_hangout_visible(uuid, uuid) from public;
grant execute on function public.is_hangout_visible(uuid, uuid) to authenticated, service_role;

create or replace function public.is_hangout_owner(p_hangout_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hangouts h
    where h.id = p_hangout_id
      and h.owner_user_id = p_user_id
  );
$$;

revoke all on function public.is_hangout_owner(uuid, uuid) from public;
grant execute on function public.is_hangout_owner(uuid, uuid) to authenticated, service_role;

alter table public.hangouts enable row level security;
alter table public.hangout_participants enable row level security;
alter table public.hangout_sources enable row level security;
alter table public.hangout_items enable row level security;

drop policy if exists hangouts_select_visible on public.hangouts;
create policy hangouts_select_visible
  on public.hangouts
  for select
  to authenticated
  using (public.is_hangout_visible(id, auth.uid()));

drop policy if exists hangouts_insert_owner on public.hangouts;
create policy hangouts_insert_owner
  on public.hangouts
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists hangouts_update_owner on public.hangouts;
create policy hangouts_update_owner
  on public.hangouts
  for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists hangout_participants_select_visible on public.hangout_participants;
create policy hangout_participants_select_visible
  on public.hangout_participants
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_hangout_visible(hangout_id, auth.uid())
  );

drop policy if exists hangout_participants_insert_owner on public.hangout_participants;
create policy hangout_participants_insert_owner
  on public.hangout_participants
  for insert
  to authenticated
  with check (public.is_hangout_owner(hangout_id, auth.uid()));

drop policy if exists hangout_participants_delete_owner on public.hangout_participants;
create policy hangout_participants_delete_owner
  on public.hangout_participants
  for delete
  to authenticated
  using (public.is_hangout_owner(hangout_id, auth.uid()));

drop policy if exists hangout_sources_select_visible on public.hangout_sources;
create policy hangout_sources_select_visible
  on public.hangout_sources
  for select
  to authenticated
  using (public.is_hangout_visible(hangout_id, auth.uid()));

drop policy if exists hangout_sources_insert_owner on public.hangout_sources;
create policy hangout_sources_insert_owner
  on public.hangout_sources
  for insert
  to authenticated
  with check (public.is_hangout_owner(hangout_id, auth.uid()));

drop policy if exists hangout_sources_update_owner on public.hangout_sources;
create policy hangout_sources_update_owner
  on public.hangout_sources
  for update
  to authenticated
  using (public.is_hangout_owner(hangout_id, auth.uid()))
  with check (public.is_hangout_owner(hangout_id, auth.uid()));

drop policy if exists hangout_items_select_visible on public.hangout_items;
create policy hangout_items_select_visible
  on public.hangout_items
  for select
  to authenticated
  using (public.is_hangout_visible(hangout_id, auth.uid()));

drop policy if exists hangout_items_insert_owner on public.hangout_items;
create policy hangout_items_insert_owner
  on public.hangout_items
  for insert
  to authenticated
  with check (public.is_hangout_owner(hangout_id, auth.uid()));

drop policy if exists hangout_items_update_owner on public.hangout_items;
create policy hangout_items_update_owner
  on public.hangout_items
  for update
  to authenticated
  using (public.is_hangout_owner(hangout_id, auth.uid()))
  with check (public.is_hangout_owner(hangout_id, auth.uid()));

drop policy if exists hangout_items_delete_owner on public.hangout_items;
create policy hangout_items_delete_owner
  on public.hangout_items
  for delete
  to authenticated
  using (public.is_hangout_owner(hangout_id, auth.uid()));

-- Shared photos access should follow hangout visibility and dish ownership via hangout.
drop policy if exists photos_select_shared on public.photos;
create policy photos_select_shared
  on public.photos
  for select
  to authenticated
  using (
    (
      kind = 'hangout'
      and hangout_id is not null
      and public.is_hangout_visible(hangout_id, auth.uid())
    )
    or (
      kind = 'dish'
      and dish_entry_id is not null
      and exists (
        select 1
        from public.dish_entries de
        where de.id = photos.dish_entry_id
          and (
            de.user_id = auth.uid()
            or (de.hangout_id is not null and public.is_hangout_visible(de.hangout_id, auth.uid()))
          )
      )
    )
  );

-- One-time backfill: legacy visits -> canonical hangouts (reuse ids).
insert into public.hangouts (id, owner_user_id, restaurant_id, occurred_at, note, created_at, updated_at)
select
  ru.id,
  ru.user_id,
  ru.restaurant_id,
  coalesce(ru.visited_at, ru.created_at),
  ru.visit_note,
  ru.created_at,
  ru.created_at
from public.receipt_uploads ru
on conflict (id) do update
set
  owner_user_id = excluded.owner_user_id,
  restaurant_id = excluded.restaurant_id,
  occurred_at = excluded.occurred_at,
  note = excluded.note;

-- Ensure owner is always a participant.
insert into public.hangout_participants (hangout_id, user_id, created_at)
select h.id, h.owner_user_id, coalesce(h.created_at, now())
from public.hangouts h
on conflict (hangout_id, user_id) do nothing;

-- Backfill active visit participants.
insert into public.hangout_participants (hangout_id, user_id, created_at)
select vp.visit_id, vp.user_id, vp.created_at
from public.visit_participants vp
join public.hangouts h on h.id = vp.visit_id
where vp.user_id is not null
  and vp.status = 'active'
on conflict (hangout_id, user_id) do nothing;

-- Backfill one receipt source per migrated hangout.
insert into public.hangout_sources (
  hangout_id,
  type,
  storage_path,
  extractor,
  extracted_at,
  extraction_version,
  raw_extraction,
  created_at
)
select
  ru.id,
  'receipt',
  (
    case
      when ru.image_paths is not null and array_length(ru.image_paths, 1) > 0 then ru.image_paths[1]
      else null
    end
  ),
  case when ru.processed_at is not null then 'openai' else null end,
  ru.processed_at,
  case when ru.processed_at is not null then 'v1' else null end,
  null,
  ru.created_at
from public.receipt_uploads ru
where not exists (
  select 1
  from public.hangout_sources hs
  where hs.hangout_id = ru.id
    and hs.type = 'receipt'
);

-- Backfill extracted items into shared hangout items.
insert into public.hangout_items (
  id,
  hangout_id,
  source_id,
  name_raw,
  name_final,
  quantity,
  unit_price,
  currency,
  confidence,
  included,
  created_at
)
select
  eli.id,
  eli.upload_id,
  (
    select hs.id
    from public.hangout_sources hs
    where hs.hangout_id = eli.upload_id
      and hs.type = 'receipt'
    order by hs.created_at asc
    limit 1
  ),
  eli.name_raw,
  eli.name_final,
  greatest(1, coalesce(eli.quantity, 1)),
  coalesce(eli.unit_price, eli.price_final),
  coalesce(ru.currency_detected, 'USD'),
  eli.confidence,
  coalesce(eli.included, true),
  eli.created_at
from public.extracted_line_items eli
left join public.receipt_uploads ru on ru.id = eli.upload_id
where exists (select 1 from public.hangouts h where h.id = eli.upload_id)
on conflict (id) do update
set
  hangout_id = excluded.hangout_id,
  source_id = excluded.source_id,
  name_raw = excluded.name_raw,
  name_final = excluded.name_final,
  quantity = excluded.quantity,
  unit_price = excluded.unit_price,
  currency = excluded.currency,
  confidence = excluded.confidence,
  included = excluded.included;

-- Wire dish entries to canonical hangout id.
update public.dish_entries
set hangout_id = source_upload_id
where hangout_id is null
  and source_upload_id is not null;

-- Some historical photos can reference hangout ids that never existed in receipt_uploads.
-- Backfill minimal hangouts so the FK can be validated safely.
insert into public.hangouts (id, owner_user_id, restaurant_id, occurred_at, note, created_at, updated_at)
select
  p.hangout_id,
  p.user_id,
  null,
  p.created_at,
  'Backfilled from photo reference',
  p.created_at,
  p.created_at
from public.photos p
left join public.hangouts h on h.id = p.hangout_id
where p.hangout_id is not null
  and h.id is null;

insert into public.hangout_participants (hangout_id, user_id, created_at)
select
  p.hangout_id,
  p.user_id,
  p.created_at
from public.photos p
where p.hangout_id is not null
on conflict (hangout_id, user_id) do nothing;

-- Validate photos FK only after hangouts are fully backfilled.
alter table public.photos
  validate constraint photos_hangout_id_fkey;
