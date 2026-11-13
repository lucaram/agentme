-- The address index of a big website (hundreds of thousands of pages) keeps its newest
-- addresses, and is searched best match first.

-- When each address was last seen in the sitemaps: addresses not seen in the latest read go.
alter table public.business_site_index add column indexed_at timestamptz not null default now();
create index business_site_index_agent_seen_idx on public.business_site_index (agent_id, indexed_at);

-- Addresses matching any of the words, those matching most words first, then the newest.
-- (A plain filter returns an arbitrary 200 of thousands of matches on a big site.)
create function public.search_site_index(p_agent uuid, p_query text, p_limit int default 200)
returns table (url text, words text, lastmod timestamptz)
language sql
stable
set search_path = ''
as $$
  select i.url, i.words, i.lastmod
  from public.business_site_index i
  where i.agent_id = p_agent and i.fts @@ to_tsquery('simple', p_query)
  order by ts_rank(i.fts, to_tsquery('simple', p_query)) desc, i.lastmod desc nulls last
  limit least(greatest(p_limit, 1), 500);
$$;
revoke execute on function public.search_site_index(uuid, text, int) from public, anon, authenticated;
grant execute on function public.search_site_index(uuid, text, int) to service_role;
