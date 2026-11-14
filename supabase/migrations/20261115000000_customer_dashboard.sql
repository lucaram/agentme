create table public.business_action_events (
  id uuid primary key,
  agent_id uuid not null references public.agents(id) on delete cascade,
  kind text not null check (kind in ('book','order','call','whatsapp','email','website','custom')),
  label text not null check (char_length(label) between 1 and 120),
  source text not null check (source in ('public_page','plan','recall')),
  created_at timestamptz not null default now()
);
create index business_action_events_recent_idx on public.business_action_events(agent_id,created_at);
alter table public.business_action_events enable row level security;
-- Events are written and aggregated only by authorised server code.
revoke all on public.business_action_events from anon, authenticated;
create table public.business_analytics_config (id boolean primary key default true check(id), started_at timestamptz not null default now());
insert into public.business_analytics_config default values;
alter table public.business_analytics_config enable row level security;
revoke all on public.business_analytics_config from anon, authenticated;
alter publication supabase_realtime add table public.business_action_events;

create function public.business_dashboard(p_agent uuid, p_days integer default 30)
returns jsonb language sql stable security definer set search_path = public as $$
with bounds as (
 select case when p_days in (7,30,90) then p_days else 30 end as days,
   date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' as today
), periods as (
 select *, today - (days-1)*interval '1 day' as start_at,
 today - (2*days-1)*interval '1 day' as previous_start, today + interval '1 day' as end_at from bounds
), records as (
 select e.id,e.created_at, left(coalesce(nullif(e.request->>'text',''), nullif(e.request->>'question',''),
   (select i.payload->>'question' from public.inbox_items i where i.exchange_id=e.id limit 1),''),1000) as question,
 case when exists(select 1 from public.inbox_items i where i.exchange_id=e.id and i.status='open' and i.payload->>'business'='true') then 'pending'
 when e.status='completed' and e.answered_by='human' then 'team'
 when e.status='completed' and e.answered_by='agent' and e.disclosed_categories @> array['business_info'] then 'automatic'
 else 'unanswered' end as outcome,
 exists(select 1 from public.inbox_items i where i.exchange_id=e.id and i.payload->>'business'='true') as needed_team
 from public.task_exchanges e,periods p where e.to_agent=p_agent and e.skill='business.faq'
 and e.created_at>=p.previous_start and e.created_at<p.end_at
), totals as (
 select count(*) filter(where r.created_at>=p.start_at) as received,
 count(*) filter(where r.created_at>=p.start_at and outcome='automatic') as automatic,
 count(*) filter(where r.created_at>=p.start_at and outcome='team') as team,
 count(*) filter(where r.created_at>=p.start_at and outcome='unanswered') as unanswered,
 count(*) filter(where r.created_at<p.start_at) as previous,
 count(*) filter(where r.created_at<p.start_at and outcome='automatic') as previous_automatic
 from records r cross join periods p
), grouped as (
 select min(question) as question,count(*) as asked,
 count(*) filter(where outcome='automatic') as automatic,
 count(*) filter(where needed_team) as needed_team,
 count(*) filter(where outcome in ('pending','unanswered')) as unresolved
 from records r,periods p where r.created_at>=p.start_at and question<>''
 group by trim(regexp_replace(regexp_replace(lower(question),'@[a-z0-9_]+','','g'),'[^[:alnum:]]+',' ','g'))
), daily as (
 select day::date as day,count(r.id) as total,
 count(r.id) filter(where outcome='automatic') as automatic,
 count(r.id) filter(where outcome='team') as team,
 count(r.id) filter(where outcome='pending') as pending,
 count(r.id) filter(where outcome='unanswered') as unanswered
 from periods p cross join lateral generate_series(p.start_at,p.today,interval '1 day') day
 left join records r on (r.created_at at time zone 'UTC')::date=day::date
 group by day
), clicks as (
 select kind,label,count(*) as clicks from public.business_action_events e,periods p
 where agent_id=p_agent and e.created_at>=p.start_at and e.created_at<p.end_at group by kind,label
)
select jsonb_build_object(
 'days',p.days,'start',p.start_at,'end',p.end_at,'totals',(select to_jsonb(t) from totals t),
 'pending',(select count(*) from public.inbox_items where agent_id=p_agent and kind='question' and status='open' and payload->>'business'='true'),
 'history_since',(select min(created_at) from public.task_exchanges where to_agent=p_agent and skill='business.faq'),
 'daily',coalesce((select jsonb_agg(d order by day) from daily d),'[]'::jsonb),
 'questions',coalesce((select jsonb_agg(q) from (select * from grouped order by asked desc,question limit 8) q),'[]'::jsonb),
 'gaps',coalesce((select jsonb_agg(q) from (select * from grouped where asked>=2 and (needed_team>0 or unresolved>0) order by needed_team+unresolved desc,asked desc limit 5) q),'[]'::jsonb),
 'unlabelled',(select count(*) from records r where r.created_at>=p.start_at and question=''),
 'clicks',coalesce((select jsonb_agg(c order by clicks desc,label) from clicks c),'[]'::jsonb),
 'tracking_since',(select greatest(c.started_at,a.created_at) from public.business_analytics_config c cross join public.agents a where a.id=p_agent)
) from periods p;
$$;
revoke execute on function public.business_dashboard(uuid,integer) from public,anon,authenticated;
grant execute on function public.business_dashboard(uuid,integer) to service_role;
