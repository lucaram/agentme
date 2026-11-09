-- "Paste your website": a business's whole site, read, reviewed by the owner,
-- kept up to date every day, and verified.

-- One website per business.
create table public.business_sites (
  agent_id uuid primary key references public.agents (id) on delete cascade,
  url text not null check (char_length(url) between 8 and 2000 and url ~ '^https?://'),
  domain text not null check (char_length(domain) between 3 and 253),
  status text not null default 'reading' check (status in ('reading', 'ready', 'error')),
  pages_found int not null default 0,
  pages_read int not null default 0,
  -- Pages read so far ({title, url}), for the live "Reading…" list.
  progress jsonb not null default '[]'::jsonb,
  -- What the agent learned (summary, hours, contact, facts, questions & answers), regenerated when the site changes.
  learned jsonb not null default '{}'::jsonb,
  -- Learned items the owner removed (their keys), so they never come back.
  hidden text[] not null default '{}',
  warning text check (warning is null or char_length(warning) <= 300),
  error text check (error is null or char_length(error) <= 300),
  -- "Go live": until then, website pages are only used in the owner's previews.
  live_at timestamptz,
  reading_started_at timestamptz,
  last_read_at timestamptz,
  -- For <meta name="agentme-verify" content="…"> on the homepage.
  verify_token text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
create index business_sites_refresh_idx on public.business_sites (last_read_at) where live_at is not null;
alter table public.business_sites enable row level security;
-- The business itself can read its own row; every change goes through the server.
create policy business_sites_read_own on public.business_sites for select to authenticated using (agent_id = public.my_agent_id());

-- Website pages are stored with the links the agent reads (same answering path), marked as from the site.
alter table public.business_sources
  add column origin text not null default 'link' check (origin in ('link', 'site')),
  add column title text check (title is null or char_length(title) <= 200),
  add column content_hash text check (content_hash is null or char_length(content_hash) <= 64);
create index business_sources_site_idx on public.business_sources (agent_id) where origin = 'site';

-- ✓ Verified: the business proved it owns this website. A domain belongs to one business only.
alter table public.agents add column verified_domain text check (verified_domain is null or char_length(verified_domain) between 3 and 253);
create unique index agents_verified_domain_key on public.agents (verified_domain) where verified_domain is not null;

-- My Business updates: changes on the website, and questions it doesn't answer.
alter table public.notices drop constraint notices_area_check;
alter table public.notices add constraint notices_area_check check (area in ('groups', 'communities', 'business'));
-- The badge is public (shown on the business page, in search and in chats): signed-in
-- users may read this column too (agents use column grants, see agents_private_columns).
grant select (verified_domain) on public.agents to authenticated;
