create function public.business_team_dashboard_options() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare b uuid:=public.my_agent_id(); role_name text:=public.workspace_role(); teams jsonb; people jsonb;
begin
  if role_name not in ('owner','manager') or not public.business_permission('configure') then raise exception 'Dashboard access unavailable'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]') into teams from (
    select m.user_id id,a.display_name name,a.handle,a.avatar,m.role,false former from public.business_managers m join public.agents a on a.owner_id=m.user_id where m.business_agent_id=b and m.role in ('owner','manager') and (role_name='owner' or m.user_id=auth.uid())
    union all select distinct e.supervisor_id,e.supervisor_name,e.supervisor_handle,'👤','manager',true from public.business_work_events e where role_name='owner' and e.business_agent_id=b and e.supervisor_id is not null and not exists(select 1 from public.business_managers m where m.business_agent_id=b and m.user_id=e.supervisor_id and m.role in ('owner','manager'))
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]') into people from (
    select m.user_id id,a.display_name name,a.handle,a.avatar,m.role,false former from public.business_managers m join public.agents a on a.owner_id=m.user_id where m.business_agent_id=b and (role_name='owner' or (m.role='staff' and m.supervisor_id=auth.uid()))
    union all select distinct e.actor_id,e.actor_name,e.actor_handle,'👤','staff',true from public.business_work_events e where role_name='owner' and e.business_agent_id=b and e.actor_id is not null and not exists(select 1 from public.business_managers m where m.business_agent_id=b and m.user_id=e.actor_id)
  ) x;
  return jsonb_build_object('teams',teams,'people',people);
end $$;

create function public.business_team_dashboard(p_days integer default 30,p_scope text default 'team',p_person uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare b uuid:=public.my_agent_id(); role_name text:=public.workspace_role(); actor uuid:=auth.uid(); period integer:=case when p_days in (7,30,90) then p_days else 30 end;
  start_at timestamptz; end_at timestamptz; events jsonb; people jsonb; summary jsonb; daily jsonb; pending bigint; missing bigint:=0; tracking timestamptz;
begin
  if role_name not in ('owner','manager') or not public.business_permission('configure') or p_scope is null or p_scope not in ('all','team','person') then raise exception 'Dashboard access unavailable'; end if;
  if role_name='manager' then
    if p_scope='all' or (p_scope='team' and p_person is not null and p_person<>actor) or (p_scope='person' and not exists(select 1 from public.business_managers where business_agent_id=b and user_id=p_person and role='staff' and supervisor_id=actor)) then raise exception 'You can view your own team and its current Staff only'; end if;
    if p_scope='team' then p_person:=actor; end if;
  elsif p_scope<>'all' then
    if p_person is null or not (exists(select 1 from public.business_managers m where m.business_agent_id=b and m.user_id=p_person and (p_scope='person' or m.role in ('owner','manager')))
      or exists(select 1 from public.business_work_events e where e.business_agent_id=b and case when p_scope='team' then e.supervisor_id=p_person else e.actor_id=p_person end)) then raise exception 'Choose a person or team belonging to this business'; end if;
  end if;
  start_at:=(date_trunc('day',now() at time zone 'UTC')-(period-1)*interval '1 day') at time zone 'UTC';
  end_at:=(date_trunc('day',now() at time zone 'UTC')+interval '1 day') at time zone 'UTC';
  select tracking_since into tracking from public.business_team_settings where business_agent_id=b;
  select coalesce(jsonb_agg(to_jsonb(e)),'[]') into events from public.business_work_events e where e.business_agent_id=b and e.occurred_at>=start_at and e.occurred_at<end_at
    and case p_scope when 'all' then true when 'team' then e.supervisor_id=p_person else e.actor_id=p_person and (role_name='owner' or e.supervisor_id=actor) end;
  select jsonb_build_object('assigned',count(*) filter(where x.kind='assigned'),'answered',count(*) filter(where x.kind='answered'),'declined',count(*) filter(where x.kind='declined'),'published',count(*) filter(where x.kind='faq_published'),
    'medianSeconds',percentile_cont(0.5) within group(order by extract(epoch from x.occurred_at-x.received_at)) filter(where x.kind='answered' and x.received_at is not null and x.occurred_at>=x.received_at)) into summary
    from jsonb_to_recordset(events) x(kind text,occurred_at timestamptz,received_at timestamptz);
  select count(*) into pending from public.inbox_items i left join public.business_question_claims c on c.inbox_id=i.id left join public.business_managers m on m.business_agent_id=b and m.user_id=c.assigned_to
    where i.agent_id=b and i.kind='question' and i.payload->>'business'='true' and i.status='open'
      and case p_scope when 'all' then true when 'team' then coalesce(case when m.role='staff' then m.supervisor_id else m.user_id end,public.business_default_owner(b))=p_person
        else c.assigned_to=p_person and (role_name='owner' or m.supervisor_id=actor) end;
  select coalesce(jsonb_agg(to_jsonb(y) order by y.answered desc,y.name),'[]') into people from (
    select x.actor_id id,(array_agg(x.actor_name order by x.occurred_at desc))[1] name,(array_agg(x.actor_handle order by x.occurred_at desc))[1] handle,x.supervisor_id,
      (array_agg(x.supervisor_name order by x.occurred_at desc))[1] supervisor_name,
      count(*) filter(where x.kind='assigned') assigned,count(*) filter(where x.kind='answered') answered,count(*) filter(where x.kind='declined') declined,count(*) filter(where x.kind='faq_published') published,
      percentile_cont(0.5) within group(order by extract(epoch from x.occurred_at-x.received_at)) filter(where x.kind='answered' and x.received_at is not null and x.occurred_at>=x.received_at) median_seconds
    from jsonb_to_recordset(events) x(actor_id uuid,actor_name text,actor_handle text,supervisor_id uuid,supervisor_name text,kind text,occurred_at timestamptz,received_at timestamptz)
    group by x.actor_id,x.supervisor_id
  ) y;
  select jsonb_agg(jsonb_build_object('day',d::date,'answered',(select count(*) from jsonb_to_recordset(events) x(kind text,occurred_at timestamptz) where x.kind='answered' and (x.occurred_at at time zone 'UTC')::date=d::date),'published',(select count(*) from jsonb_to_recordset(events) x(kind text,occurred_at timestamptz) where x.kind='faq_published' and (x.occurred_at at time zone 'UTC')::date=d::date)) order by d) into daily from generate_series(start_at at time zone 'UTC',(end_at at time zone 'UTC')-interval '1 day',interval '1 day') d;
  if role_name='owner' and p_scope='all' then
    select count(*) into missing from public.inbox_items i where i.agent_id=b and i.kind='question' and i.payload->>'business'='true' and i.status='answered' and i.answered_at>=start_at and i.answered_at<end_at and not exists(select 1 from public.business_work_events e where e.inbox_id=i.id and e.kind='answered' and e.supervisor_id is not null);
  end if;
  return jsonb_build_object('days',period,'scope',p_scope,'person',p_person,'start',start_at,'end',end_at,'trackingSince',tracking,'pending',pending,'unattributed',missing,'summary',summary,'daily',daily,'people',people);
end $$;

-- Company-wide customer analytics are an Owner view; Managers use the scoped API.
do $$ declare d text; begin
  d:=pg_get_functiondef('public.business_dashboard(uuid,integer)'::regprocedure);
  d:=replace(d,'public.business_permission(''configure'')','public.business_permission(''ownership'')'); execute d;
end $$;
create function public.business_dashboard_as_owner(p_business uuid,p_actor uuid,p_days integer default 30) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.business_managers where business_agent_id=p_business and user_id=p_actor and role='owner') and not exists(select 1 from public.agents where id=p_business and owner_id=p_actor and type='business' and not exists(select 1 from public.business_managers where business_agent_id=p_business)) then raise exception 'Owner dashboard access required'; end if;
  if public.direct_account_restricted(p_actor) or public.account_is_restricted((select owner_id from public.agents where id=p_business)) then raise exception 'Business access unavailable'; end if;
  return public.business_dashboard(p_business,p_days);
end $$;
revoke execute on function public.business_dashboard_as_owner(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.business_dashboard_as_owner(uuid,uuid,integer) to service_role;
revoke execute on function public.business_team_dashboard_options(),public.business_team_dashboard(integer,text,uuid) from public,anon;
grant execute on function public.business_team_dashboard_options(),public.business_team_dashboard(integer,text,uuid) to authenticated;
