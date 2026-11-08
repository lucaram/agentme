-- When each address-book source was last synced: { "google": "<iso>", "microsoft": …, "phone": …, "typed": … }.
-- Only timestamps; the contacts themselves are never stored.
alter table public.agents add column contact_sources jsonb not null default '{}'::jsonb;
