-- Platform staff are deliberately separate from group admins and community moderators.
create table public.platform_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  granted_at timestamptz not null default now()
);
alter table public.conversations add column platform_suspended boolean not null default false;
alter table public.communities add column platform_suspended boolean not null default false;
create table public.platform_cases (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check(target_kind in ('group','community')),
  target_key uuid not null,
  group_id uuid references public.conversations(id) on delete set null,
  community_id uuid references public.communities(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'open' check(status in ('open','in_review','closed')),
  outcome text check(outcome in ('dismissed','warned','suspended','restored')),
  response text,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_open_platform_case on public.platform_cases(target_kind,target_key) where status<>'closed';
create index platform_queue_order on public.platform_cases(created_at desc,id desc);
create table public.platform_reports (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.platform_cases(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  category text not null check(category in ('spam','scam','abuse','privacy','other')),
  reason text not null check(char_length(reason) between 1 and 1000),
  evidence jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique(case_id,reporter_id)
);
create index platform_reports_owner on public.platform_reports(reporter_id,created_at desc);
create table public.platform_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.platform_cases(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(action in ('review','dismiss','warn','suspend','restore')),
  public_response text,
  internal_note text,
  created_at timestamptz not null default now()
);
create table public.platform_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.platform_case_events(id) on delete cascade,
  text text not null,
  link text not null,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,event_id)
);
create index platform_notification_unread on public.platform_notifications(user_id,created_at) where seen_at is null;
alter table public.platform_moderators enable row level security;
alter table public.platform_cases enable row level security;
alter table public.platform_reports enable row level security;
alter table public.platform_case_events enable row level security;
alter table public.platform_notifications enable row level security;
revoke all on public.platform_moderators,public.platform_cases,public.platform_reports,public.platform_case_events,public.platform_notifications from anon,authenticated;
grant all on public.platform_moderators,public.platform_cases,public.platform_reports,public.platform_case_events,public.platform_notifications to service_role;
grant select on public.platform_moderators,public.platform_cases,public.platform_reports,public.platform_case_events,public.platform_notifications to authenticated;

create function public.is_platform_moderator() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.platform_moderators where user_id=auth.uid() and enabled);
$$;
create function public.can_review_platform_target(p_kind text,p_target uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_platform_moderator() and case p_kind
    when 'group' then not exists(select 1 from public.conversation_members where conversation_id=p_target and user_id=auth.uid())
    when 'community' then not exists(select 1 from public.community_members where community_id=p_target and user_id=auth.uid()) else false end;
$$;
revoke execute on function public.is_platform_moderator(),public.can_review_platform_target(text,uuid) from public,anon;
grant execute on function public.is_platform_moderator(),public.can_review_platform_target(text,uuid) to authenticated;
create policy own_platform_role on public.platform_moderators for select to authenticated using(user_id=auth.uid());
create policy platform_case_staff on public.platform_cases for select to authenticated using(public.can_review_platform_target(target_kind,target_key));
create policy platform_report_private on public.platform_reports for select to authenticated using(reporter_id=auth.uid() or exists(select 1 from public.platform_cases c where c.id=case_id and public.can_review_platform_target(c.target_kind,c.target_key)));
create policy platform_events_staff on public.platform_case_events for select to authenticated using(exists(select 1 from public.platform_cases c where c.id=case_id and public.can_review_platform_target(c.target_kind,c.target_key)));
create policy own_platform_notification on public.platform_notifications for select to authenticated using(user_id=auth.uid());
alter publication supabase_realtime add table public.platform_cases,public.platform_notifications,public.platform_moderators;

-- Whole-space reports are never disclosed to the people being reported.
drop policy reports_read on public.reports;
create policy reports_read on public.reports for select to authenticated using(reporter_id=auth.uid() or (message_id is not null and (
  (community_id is not null and public.community_role(community_id) in ('owner','moderator')) or
  (conversation_id is not null and community_id is null and public.conversation_role(conversation_id) in ('owner','admin'))
)));

create function public.submit_platform_report(p_kind text,p_target uuid,p_category text,p_reason text,p_evidence uuid[] default '{}',p_actor uuid default auth.uid()) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=p_actor; case_row public.platform_cases; existing uuid; title_value text; description_value text; evidence_value jsonb; permitted boolean; valid_count integer;
begin
  if u is null or not coalesce(u=auth.uid() or auth.role()='service_role',false) or p_kind is null or p_category is null or p_reason is null or p_kind not in ('group','community') or p_category not in ('spam','scam','abuse','privacy','other') or char_length(btrim(p_reason)) not between 1 and 1000 or coalesce(cardinality(p_evidence),0)>5 then raise exception 'Invalid report'; end if;
  if p_kind='group' then
    select title,description into title_value,description_value from public.conversations where id=p_target and kind='group' for update;
    if not found or not exists(select 1 from public.conversation_members where conversation_id=p_target and user_id=u) then raise exception 'Group unavailable'; end if;
  else
    select name,description into title_value,description_value from public.communities where id=p_target for update;
    if not found or not exists(select 1 from public.community_members where community_id=p_target and user_id=u) then raise exception 'Community unavailable'; end if;
  end if;
  select * into case_row from public.platform_cases where target_kind=p_kind and target_key=p_target and status<>'closed' for update;
  if case_row.id is not null then
    select id into existing from public.platform_reports where case_id=case_row.id and reporter_id=u;
    if found then return jsonb_build_object('id',existing,'case_id',case_row.id,'duplicate',true); end if;
  end if;
  if exists(select 1 from public.platform_reports r join public.platform_cases c on c.id=r.case_id where r.reporter_id=u and c.target_kind=p_kind and c.target_key=p_target and r.created_at>now()-interval '1 day') then raise exception 'You have already reported this space today'; end if;
  select allowed into permitted from public.rate_limit_hit('platformReports:'||u::text,86400,5);
  if not permitted then raise exception 'Too many reports. Try again tomorrow.'; end if;
  select count(*),coalesce(jsonb_agg(jsonb_build_object('id',m.id,'content',left(m.content,2000),'at',m.created_at,'author',coalesce(a.display_name,'Former member'),'ai',m.is_ai_generated) order by m.created_at,m.id),'[]'::jsonb)
    into valid_count,evidence_value from public.messages m left join lateral (select display_name from public.agents where id=m.sender_agent_id or (m.sender_agent_id is null and owner_id=m.sender_user_id) order by created_at,id limit 1) a on true
    join public.conversations c on c.id=m.conversation_id
    where m.id=any(p_evidence) and m.visible_to is null and m.removed_at is null and public.can_read_chat_message(m.id,u)
      and ((p_kind='group' and c.id=p_target) or (p_kind='community' and c.community_id=p_target));
  if valid_count<>(select count(distinct value) from unnest(p_evidence) value) then raise exception 'Some evidence is no longer available'; end if;
  if case_row.id is null then
    insert into public.platform_cases(target_kind,target_key,group_id,community_id,title,description)
    values(p_kind,p_target,case when p_kind='group' then p_target end,case when p_kind='community' then p_target end,coalesce(title_value,'Group'),description_value) returning * into case_row;
  end if;
  insert into public.platform_reports(case_id,reporter_id,category,reason,evidence) values(case_row.id,u,p_category,btrim(p_reason),evidence_value) returning id into existing;
  -- Wake staff watching an existing case, without exposing this report to space members.
  update public.platform_cases set updated_at=now(),revision=revision+1 where id=case_row.id;
  return jsonb_build_object('id',existing,'case_id',case_row.id,'duplicate',false);
end $$;
revoke execute on function public.submit_platform_report(text,uuid,text,text,uuid[],uuid) from public,anon;
grant execute on function public.submit_platform_report(text,uuid,text,text,uuid[],uuid) to authenticated,service_role;

create function public.own_platform_reports(p_report uuid default null,p_offset integer default 0) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
    select r.id,r.category,r.reason,r.evidence,r.created_at,c.id case_id,c.title,c.target_kind,c.status,c.outcome,c.response,c.updated_at
    from public.platform_reports r join public.platform_cases c on c.id=r.case_id
    where r.reporter_id=auth.uid() and (p_report is null or r.id=p_report) and p_offset between 0 and 10000 order by r.created_at desc,r.id desc limit 26 offset greatest(0,least(p_offset,10000))
  ) x;
$$;
revoke execute on function public.own_platform_reports(uuid,integer) from public,anon;
grant execute on function public.own_platform_reports(uuid,integer) to authenticated;

create function public.review_platform_case(p_case uuid,p_revision bigint,p_action text,p_response text default '',p_note text default '') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.platform_cases; event uuid; message text; target_exists boolean;
begin
  select * into c from public.platform_cases where id=p_case for update;
  if not found or not public.can_review_platform_target(c.target_kind,c.target_key) then raise exception 'Not allowed'; end if;
  if c.revision<>p_revision then raise exception 'This case changed. Refresh before deciding.'; end if;
  if p_action not in ('review','dismiss','warn','suspend','restore') or char_length(p_note)>2000 or char_length(p_response)>500 or (p_action<>'review' and char_length(btrim(p_response))<5) then raise exception 'Add a short decision for the people affected'; end if;
  if c.status='closed' and p_action<>'restore' then raise exception 'This case is already closed'; end if;
  if p_action in ('warn','suspend','restore') then
    if c.target_kind='group' then
      perform 1 from public.conversations where id=c.group_id for update; target_exists:=found;
      if p_action in ('suspend','restore') then update public.conversations set platform_suspended=(p_action='suspend') where id=c.group_id; end if;
    else
      perform 1 from public.communities where id=c.community_id for update; target_exists:=found;
      if p_action in ('suspend','restore') then update public.communities set platform_suspended=(p_action='suspend') where id=c.community_id; end if;
    end if;
    if not target_exists then raise exception 'This space was deleted. Close the report without enforcement.'; end if;
  end if;
  update public.platform_cases set status=case when p_action='review' then 'in_review' else 'closed' end,
    outcome=case p_action when 'dismiss' then 'dismissed' when 'warn' then 'warned' when 'suspend' then 'suspended' when 'restore' then 'restored' end,
    response=case when p_action='review' then null else btrim(p_response) end,revision=revision+1,updated_at=now() where id=c.id;
  insert into public.platform_case_events(case_id,actor_id,action,public_response,internal_note) values(c.id,auth.uid(),p_action,nullif(btrim(p_response),''),nullif(btrim(p_note),'')) returning id into event;
  insert into public.platform_notifications(user_id,event_id,text,link)
    select r.reporter_id,event,case when p_action='review' then 'Your report about “'||c.title||'” is being reviewed.' else 'AGENTME reviewed your report about “'||c.title||'”.' end,'/reports/'||r.id::text
    from public.platform_reports r where r.case_id=c.id and r.reporter_id is not null on conflict do nothing;
  if p_action in ('warn','suspend','restore') then
    message:='AGENTME platform moderation: '||case p_action when 'warn' then 'warning for ' when 'suspend' then 'suspended ' else 'restored ' end||'“'||c.title||'”. '||btrim(p_response);
    insert into public.platform_notifications(user_id,event_id,text,link)
      select members.user_id,event,message,case when c.target_kind='group' then '/groups/' else '/communities/' end||c.target_key::text from (
        select user_id from public.conversation_members where c.target_kind='group' and conversation_id=c.group_id and role in ('owner','admin')
        union select user_id from public.community_members where c.target_kind='community' and community_id=c.community_id and role in ('owner','moderator')
      ) members on conflict do nothing;
  end if;
end $$;
revoke execute on function public.review_platform_case(uuid,bigint,text,text,text) from public,anon;
grant execute on function public.review_platform_case(uuid,bigint,text,text,text) to authenticated;

-- Suspension is reversible, read-only enforcement. It applies to human and agent writes.
create function public.space_is_suspended(p_conversation uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select c.platform_suspended or coalesce(cm.platform_suspended,false) from public.conversations c left join public.communities cm on cm.id=c.community_id where c.id=p_conversation),false);
$$;
revoke execute on function public.space_is_suspended(uuid) from public,anon;
grant execute on function public.space_is_suspended(uuid) to authenticated,service_role;
create function public.enforce_platform_suspension() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.space_is_suspended(new.conversation_id) then
    if tg_table_name='messages' then
      if new.sender_user_id is null and new.sender_agent_id is null then return new; end if;
    end if;
    raise exception 'This space is suspended by AGENTME and is read-only.';
  end if;
  return new;
end $$;
revoke execute on function public.enforce_platform_suspension() from public,anon,authenticated;
create trigger platform_message_suspension before insert on public.messages for each row execute function public.enforce_platform_suspension();
create trigger platform_member_suspension before insert on public.conversation_members for each row execute function public.enforce_platform_suspension();

create function public.enforce_activity_suspension() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare conv uuid; step uuid; msg uuid;
begin
  if tg_table_name='message_reactions' then
    msg:=new.message_id; select conversation_id into conv from public.messages where id=msg;
  else
    step:=case when tg_op='DELETE' then old.step_id else new.step_id end;
    select t.group_conversation_id into conv from public.plan_steps s join public.tasks t on t.id=s.task_id where s.id=step;
  end if;
  if conv is not null and public.space_is_suspended(conv) then raise exception 'This space is suspended by AGENTME and is read-only.'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke execute on function public.enforce_activity_suspension() from public,anon,authenticated;
create trigger platform_vote_suspension before insert or update or delete on public.step_responses for each row execute function public.enforce_activity_suspension();
create trigger platform_claim_suspension before insert or update or delete on public.item_claims for each row execute function public.enforce_activity_suspension();
create trigger platform_reaction_suspension before insert or update on public.message_reactions for each row execute function public.enforce_activity_suspension();

create function public.ack_platform_notifications(p_ids uuid[]) returns void language sql security definer set search_path=public,pg_temp as $$
  update public.platform_notifications set seen_at=now() where user_id=auth.uid() and id=any(p_ids) and coalesce(cardinality(p_ids),0)<=30 and seen_at is null;
$$;
revoke execute on function public.ack_platform_notifications(uuid[]) from public,anon;
grant execute on function public.ack_platform_notifications(uuid[]) to authenticated;

create function public.platform_attention() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare local_reviews jsonb; notices jsonb; pending bigint;
begin
  select count(*) into pending from public.platform_cases where status<>'closed' and public.can_review_platform_target(target_kind,target_key);
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into local_reviews from (
    select c.id,'group' kind,c.title,count(*) total from public.reports r join public.conversations c on c.id=r.conversation_id
    where r.message_id is not null and r.status='open' and r.community_id is null and public.conversation_role(c.id) in ('owner','admin') group by c.id
    union all
    select cm.id,'community',cm.name,count(*) from public.reports r join public.communities cm on cm.id=r.community_id
    where r.message_id is not null and r.status='open' and public.community_role(cm.id) in ('owner','moderator') group by cm.id
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into notices from (
    select id,text,link,created_at from public.platform_notifications where user_id=auth.uid() and seen_at is null order by created_at desc limit 10
  ) x;
  return jsonb_build_object('platform',pending,'local',local_reviews,'notifications',notices);
end $$;
revoke execute on function public.platform_attention() from public,anon;
grant execute on function public.platform_attention() to authenticated;

create function public.platform_case_queue(p_state text default 'pending',p_offset integer default 0) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
  if not public.is_platform_moderator() or p_state not in ('pending','closed') or p_offset<0 or p_offset>10000 then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
    select c.*, (select count(*) from public.platform_reports r where r.case_id=c.id) reports
    from public.platform_cases c where (p_state='pending' and c.status<>'closed') or (p_state='closed' and c.status='closed')
    order by c.created_at desc,c.id desc limit 26 offset p_offset
  ) x);
end $$;
revoke execute on function public.platform_case_queue(text,integer) from public,anon;
grant execute on function public.platform_case_queue(text,integer) to authenticated;

create function public.platform_case_suspended(p_case uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select case when c.target_kind='group' then (select platform_suspended from public.conversations where id=c.group_id) else (select platform_suspended from public.communities where id=c.community_id) end
    from public.platform_cases c where c.id=p_case and public.can_review_platform_target(c.target_kind,c.target_key)),false);
$$;
revoke execute on function public.platform_case_suspended(uuid) from public,anon;
grant execute on function public.platform_case_suspended(uuid) to authenticated;

-- Keep older whole-group reports, but move them away from group admins' message-report queues.
do $$
declare r record; case_id_value uuid;
begin
  for r in select reports.*,c.title,c.description from public.reports join public.conversations c on c.id=reports.conversation_id where reports.message_id is null and reports.community_id is null and c.kind='group'
  loop
    select id into case_id_value from public.platform_cases where target_kind='group' and target_key=r.conversation_id and status<>'closed';
    if case_id_value is null then
      insert into public.platform_cases(target_kind,target_key,group_id,title,description,status,created_at)
        values('group',r.conversation_id,r.conversation_id,coalesce(r.title,'Group'),r.description,case when r.status='open' then 'open' else 'closed' end,r.created_at) returning id into case_id_value;
    end if;
    insert into public.platform_reports(id,case_id,reporter_id,category,reason,created_at) values(r.id,case_id_value,r.reporter_id,'other',r.reason,r.created_at) on conflict do nothing;
    delete from public.reports where id=r.id;
  end loop;
end $$;

create or replace function public.owner_attention_count() returns bigint language sql stable security definer set search_path=public,pg_temp as $$
  select (select count(*) from public.inbox_items i where i.owner_id=auth.uid() and i.status='open' and (i.kind in ('info_request','question') or (i.kind='group_invite' and public.open_group_invitation(i.id))))
    + (select count(*) from public.platform_cases c where c.status<>'closed' and public.can_review_platform_target(c.target_kind,c.target_key))
    + (select count(*) from public.platform_notifications where user_id=auth.uid() and seen_at is null)
    + (select count(*) from public.reports r where r.message_id is not null and r.status='open' and ((r.community_id is not null and public.community_role(r.community_id) in ('owner','moderator')) or (r.community_id is null and public.conversation_role(r.conversation_id) in ('owner','admin'))));
$$;
create or replace function public.unread_counts() returns table(conversation_id uuid,unread bigint,muted boolean)
language sql stable security invoker set search_path=public as $$
  select t.conversation_id,max(t.n)::bigint,bool_or(t.muted) from (
    select m.conversation_id,count(*) as n,bool_or(cm.muted) as muted from public.messages m
    join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=auth.uid()
    join public.conversations c on c.id=m.conversation_id and c.kind<>'my_agent'
    where m.created_at>cm.last_read_at and m.removed_at is null and m.sender_user_id is distinct from auth.uid()
      and (m.sender_user_id is not null or m.sender_agent_id is not null)
      and not exists(select 1 from public.message_views v where v.message_id=m.id and v.user_id=auth.uid() and v.viewed_at is not null)
    group by m.conversation_id
    union all
    select th.conversation_id,count(*),false from public.agent_threads th where th.owner_id=auth.uid() and exists(
      select 1 from public.messages m where m.thread_id=th.id and m.created_at>th.last_read_at and m.removed_at is null
      and m.sender_user_id is distinct from auth.uid() and (m.sender_user_id is not null or m.sender_agent_id is not null)
      and not exists(select 1 from public.message_views v where v.message_id=m.id and v.user_id=auth.uid() and v.viewed_at is not null))
    group by th.conversation_id
    union all
    select cm.conversation_id,public.owner_attention_count(),cm.muted
    from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id and c.kind='my_agent' where cm.user_id=auth.uid()
  ) t where t.n>0 group by t.conversation_id;
$$;
