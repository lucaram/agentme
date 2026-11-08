-- "Find people you know" v2: after connecting your contacts you see a list and
-- tick who to add. Anyone on AGENTME who allows it can be found (like WhatsApp);
-- people can switch that off.

-- "Let people who have my email or number find me" (Settings). Guests are never findable.
alter table public.agents add column discoverable boolean not null default true;

-- The list shown after connecting contacts: names and addresses from the
-- person's own address book, kept only until they finish (at most 30 minutes),
-- then deleted. One per person.
create table public.contact_imports (
  agent_id uuid primary key references public.agents (id) on delete cascade,
  source text not null check (source in ('google', 'microsoft', 'phone', 'typed')),
  -- [{ "name": "Marco", "address": "marco@gmail.com", "agent_id": "<uuid or null>" }]
  items jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.contact_imports enable row level security;
-- No policies: read and written only by server code after checking the owner.

-- Mutual-only matching is replaced by the list above.
drop table public.address_book_matches;
