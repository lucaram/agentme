-- My Business: links a business agent reads (website, PDF menu, menu photos).
-- The extracted text is the agent's knowledge, with a visibility per link.

create table public.business_sources (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  url text not null check (char_length(url) between 8 and 2000 and url ~ '^https?://'),
  -- public: anyone's agent may get it. customers: only the business's contacts.
  visibility text not null default 'public' check (visibility in ('public', 'customers')),
  status text not null default 'pending' check (status in ('pending', 'reading', 'ok', 'error')),
  kind text check (kind in ('page', 'pdf', 'image', 'text')),
  content text check (content is null or char_length(content) <= 30000),
  error text check (error is null or char_length(error) <= 300),
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agent_id, url)
);
create index business_sources_agent_idx on public.business_sources (agent_id);
create index business_sources_refresh_idx on public.business_sources (last_read_at);
alter table public.business_sources enable row level security;
-- The business owner sees their own links (and what was read). Agents read them server-side.
create policy business_sources_read_own on public.business_sources for select to authenticated using (agent_id = public.my_agent_id());

alter publication supabase_realtime add table public.business_sources;
