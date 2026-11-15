-- Restricted businesses must not consume the maintenance batch and prevent
-- healthy businesses further down the queue from being refreshed.
create function public.due_business_refreshes(p_before timestamptz,p_limit integer,p_site boolean default false) returns table(id uuid)
language sql stable security definer set search_path=public,pg_temp as $$
  select x.id from (
    select s.id,s.last_read_at from public.business_sources s join public.agents a on a.id=s.agent_id
      where not p_site and s.origin='link' and s.status in ('ok','error') and s.last_read_at<p_before and public.account_is_restricted(a.owner_id) is not true
    union all
    select s.agent_id,s.last_read_at from public.business_sites s join public.agents a on a.id=s.agent_id
      where p_site and s.live_at is not null and s.auto_refresh and s.reading_started_at is null and s.last_read_at<p_before and public.account_is_restricted(a.owner_id) is not true
  ) x order by x.last_read_at,x.id limit greatest(0,least(p_limit,10));
$$;
revoke execute on function public.due_business_refreshes(timestamptz,integer,boolean) from public,anon,authenticated;
grant execute on function public.due_business_refreshes(timestamptz,integer,boolean) to service_role;
