-- Dish Identity tags for dish entries

do $$
begin
  create type public.dish_identity as enum (
    'go_to',
    'hidden_gem',
    'special_occasion',
    'try_again',
    'never_again'
  );
exception
  when duplicate_object then null;
end $$;

alter table public.dish_entries
  add column if not exists identity_tag public.dish_identity;
