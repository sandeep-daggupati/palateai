alter table public.dish_entries
  drop constraint if exists dish_entries_hangout_item_required_check;

alter table public.dish_entries
  drop constraint if exists dish_entries_hangout_required_check;

alter table public.dish_entries
  add constraint dish_entries_hangout_required_check
  check (hangout_id is not null)
  not valid;
