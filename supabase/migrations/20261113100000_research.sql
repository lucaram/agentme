-- Shared research: a business's address index (every page it has, without the text),
-- pages read on demand, and a short-lived cache of researched answers.

-- Every address of a business's website (from its sitemaps), so its agent can find
-- pages the first scan didn't read. No page text here: pages are read when asked about.
create table public.business_site_index (
  agent_id uuid not null references public.agents (id) on delete cascade,
  url text not null check (char_length(url) between 8 and 2000),
  -- Words from the address (and title when the sitemap gives one), to search by.
  words text not null check (char_length(words) <= 600),
  lastmod timestamptz,
  fts tsvector generated always as (to_tsvector('simple', words)) stored,
  primary key (agent_id, url)
);
create index business_site_index_fts_idx on public.business_site_index using gin (fts);
alter table public.business_site_index enable row level security; -- server only

-- Pages read because someone asked: kept with the business's knowledge.
alter table public.business_sources drop constraint business_sources_origin_check;
alter table public.business_sources add constraint business_sources_origin_check check (origin in ('link', 'site', 'on_demand'));

-- Researched answers, reused for a while (30 minutes for "now", days for the past).
create table public.research_cache (
  key text primary key check (char_length(key) = 64),
  answer jsonb not null,
  expires_at timestamptz not null
);
create index research_cache_expiry_idx on public.research_cache (expires_at);
alter table public.research_cache enable row level security; -- server only
