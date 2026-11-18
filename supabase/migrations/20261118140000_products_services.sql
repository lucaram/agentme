-- Prices become products and services: grouped by category, one item with several options (each option
-- its own row, tied by group_id), tags instead of labels in names, and for services how they're priced,
-- how long they take, and whether they need booking.

alter table public.business_prices
  add column group_id uuid not null default gen_random_uuid(),
  add column kind text not null default 'product' check (kind in ('product', 'service')),
  add column category text check (category is null or char_length(category) between 1 and 60),
  add column description text check (description is null or char_length(description) <= 200),
  add column tags text[] not null default '{}' check (cardinality(tags) <= 8),
  add column price_type text not null default 'fixed' check (price_type in ('fixed', 'from', 'per_hour', 'per_person', 'free', 'on_request')),
  add column duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 1440),
  add column needs_booking boolean not null default false,
  -- The name it was read under: a later read still matches it after the business renames it.
  add column found_item text check (found_item is null or char_length(found_item) <= 120);
update public.business_prices set found_item = item where not added;

-- Free and "price on request" have no amount.
alter table public.business_prices alter column price drop not null;
alter table public.business_prices add constraint business_prices_amount check (price_type in ('free', 'on_request') or price is not null);
create index business_prices_group on public.business_prices(group_id);
