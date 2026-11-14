-- Separate successful website reads from failed attempts, and let owners pause refreshes.
alter table public.business_sites add column last_success_at timestamptz;
alter table public.business_sites add column auto_refresh boolean not null default true;
update public.business_sites set last_success_at = last_read_at where status = 'ready' and error is null;
alter publication supabase_realtime add table public.business_sites;
create index business_activity_recent_idx on public.task_exchanges(to_agent, created_at) where skill = 'business.faq';

-- Independent business forms merge their own fields without overwriting FAQs,
-- booking actions or customers-only information saved by another request.
create function public.patch_business_info(p_agent uuid, p_patch jsonb, p_bio text default null)
returns void language sql security definer set search_path = public as $$
  update public.agents set business_info = coalesce(business_info, '{}'::jsonb) || p_patch,
    bio = case when p_bio is null then bio else p_bio end
  where id = p_agent and type = 'business';
$$;
revoke execute on function public.patch_business_info(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.patch_business_info(uuid, jsonb, text) to service_role;

-- Count incoming exchanges once. Staff outcomes come from the same exchanges
-- and actual inbox items, rather than the legacy unlinked answer-step log.
create function public.business_activity(p_agent uuid, p_days integer default 30)
returns table(received bigint, automatic bigint, team_answered bigint, unanswered bigint, awaiting_team bigint)
language sql stable security definer set search_path = public as $$
  with questions as (
    select status, answered_by, disclosed_categories from public.task_exchanges
    where to_agent = p_agent and skill = 'business.faq'
      and created_at >= now() - make_interval(days => greatest(1, least(p_days, 90)))
  ) select count(*),
    count(*) filter (where status = 'completed' and answered_by = 'agent' and disclosed_categories @> array['business_info']),
    count(*) filter (where status = 'completed' and answered_by = 'human'),
    count(*) filter (where status <> 'waiting_human' and not coalesce((status = 'completed' and
      (answered_by = 'human' or (answered_by = 'agent' and disclosed_categories @> array['business_info']))), false)),
    (select count(*) from public.inbox_items where agent_id = p_agent and kind = 'question'
      and status = 'open' and payload->>'business' = 'true')
  from questions;
$$;
revoke execute on function public.business_activity(uuid, integer) from public, anon, authenticated;
grant execute on function public.business_activity(uuid, integer) to service_role;
