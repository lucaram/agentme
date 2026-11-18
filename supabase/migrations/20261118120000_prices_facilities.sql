-- "Prices & facilities": read automatically from a business's website and documents, then checked by
-- the business (correct, hide, add; confirm facilities). Used by the business's agent when it answers,
-- and so by comparisons. Server-only: no client can read or write these tables directly.

create table public.business_prices (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  item text not null check (char_length(item) between 1 and 120),
  variant text check (variant is null or char_length(variant) <= 60),
  price numeric(10,2) not null check (price >= 0 and price < 100000),
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  -- Where it was found (null: added by the business), and that source's visibility.
  source_url text,
  source_label text check (source_label is null or char_length(source_label) <= 80),
  visibility text not null default 'public' check (visibility in ('public', 'customers')),
  -- What the document says, kept when the business corrects it.
  found_price numeric(10,2),
  corrected boolean not null default false,
  added boolean not null default false,
  hidden boolean not null default false,
  read_at timestamptz,
  updated_at timestamptz not null default now()
);
create index business_prices_agent on public.business_prices(agent_id);
alter table public.business_prices enable row level security;
revoke all on public.business_prices from anon, authenticated;

create table public.business_facilities (
  agent_id uuid not null references public.agents(id) on delete cascade,
  -- One of the common facilities, or one the business named itself ("custom-…", with its label).
  key text not null check (key in ('parking', 'step_free_access', 'accessible_toilet', 'outdoor_seating', 'dog_friendly', 'vegetarian_options', 'vegan_options', 'gluten_free_options', 'kids_menu', 'wifi', 'card_payments', 'takeaway') or key ~ '^custom-[a-z0-9]{8}$'),
  label text check (label is null or char_length(label) between 1 and 60),
  status text not null check (status in ('yes', 'no')),
  evidence text check (evidence is null or char_length(evidence) <= 300),
  source_url text,
  source_label text check (source_label is null or char_length(source_label) <= 80),
  visibility text not null default 'public' check (visibility in ('public', 'customers')),
  -- Set by the business: wins over anything read later.
  confirmed boolean not null default false,
  -- Removed by the business: not shown or used, and not brought back by a later read.
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (agent_id, key),
  check (key not like 'custom-%' or label is not null)
);
alter table public.business_facilities enable row level security;
revoke all on public.business_facilities from anon, authenticated;

-- Read again only when a source's text changed.
alter table public.business_sources add column offerings_hash text;
