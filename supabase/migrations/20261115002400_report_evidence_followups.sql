alter table public.platform_cases drop constraint platform_cases_status_check;
alter table public.platform_cases add constraint platform_cases_status_check check(status in ('open','in_review','waiting_evidence','closed'));
alter table public.platform_cases drop constraint platform_cases_outcome_check;
alter table public.platform_cases add constraint platform_cases_outcome_check check(outcome in ('dismissed','warned','suspended','restored','removed'));
alter table public.platform_case_events drop constraint platform_case_events_action_check;
alter table public.platform_case_events add constraint platform_case_events_action_check check(action in ('review','dismiss','warn','suspend','restore','remove','request_evidence','evidence_received'));
create table public.platform_evidence_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.platform_cases(id) on delete cascade,
  report_id uuid not null references public.platform_reports(id) on delete cascade,
  requester_id uuid references auth.users(id) on delete set null,
  question text not null,
  status text not null default 'open' check(status in ('open','answered','closed')),
  reply text,
  evidence jsonb not null default '[]',
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create unique index one_open_evidence_request on public.platform_evidence_requests(report_id) where status='open';
alter table public.platform_evidence_requests enable row level security;
revoke all on public.platform_evidence_requests from anon,authenticated;
grant all on public.platform_evidence_requests to service_role;
grant select on public.platform_evidence_requests to authenticated;
create policy evidence_request_private on public.platform_evidence_requests for select to authenticated using(
  exists(select 1 from public.platform_reports r where r.id=report_id and r.reporter_id=auth.uid())
  or exists(select 1 from public.platform_cases c where c.id=case_id and public.can_review_platform_target(c.target_kind,c.target_key))
);
alter publication supabase_realtime add table public.platform_evidence_requests;

create function public.lock_report_case(p_case uuid) returns public.platform_cases language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.platform_cases;
begin
  select * into c from public.platform_cases where id=p_case;
  if c.community_id is not null then perform 1 from public.communities where id=c.community_id for update; end if;
  if coalesce(c.source_conversation,c.group_id) is not null then perform 1 from public.conversations where id=coalesce(c.source_conversation,c.group_id) for update; end if;
  select * into c from public.platform_cases where id=p_case for update;
  return c;
end $$;
revoke execute on function public.lock_report_case(uuid) from public,anon,authenticated;

create function public.request_report_evidence(p_report uuid,p_revision bigint,p_question text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.platform_reports; c public.platform_cases; existing uuid; event uuid;
begin
  select * into r from public.platform_reports where id=p_report;
  select * into c from public.platform_cases where id=r.case_id;
  if c.id is null or not public.can_review_platform_target(c.target_kind,c.target_key) then raise exception 'Not allowed'; end if;
  c:=public.lock_report_case(c.id);
  if not public.can_review_platform_target(c.target_kind,c.target_key) then raise exception 'Not allowed'; end if;
  if c.status='closed' or c.revision is distinct from p_revision then raise exception 'This case changed. Refresh before deciding.'; end if;
  if p_question is null or char_length(btrim(p_question)) not between 5 and 500 or r.reporter_id is null then raise exception 'Add a short question for the reporter'; end if;
  select id into existing from public.platform_evidence_requests where report_id=r.id and status='open'; if found then return existing; end if;
  insert into public.platform_evidence_requests(case_id,report_id,requester_id,question) values(c.id,r.id,auth.uid(),btrim(p_question)) returning id into existing;
  update public.platform_cases set status='waiting_evidence',revision=revision+1,updated_at=now() where id=c.id;
  insert into public.platform_case_events(case_id,actor_id,action,internal_note) values(c.id,auth.uid(),'request_evidence','Requested additional evidence for report '||r.id::text) returning id into event;
  insert into public.platform_notifications(user_id,event_id,text,link) values(r.reporter_id,event,'AGENTME needs more evidence for your report about “'||c.title||'”.','/reports/'||r.id::text);
  return existing;
end $$;
revoke execute on function public.request_report_evidence(uuid,bigint,text) from public,anon;
grant execute on function public.request_report_evidence(uuid,bigint,text) to authenticated;

create function public.answer_report_evidence(p_request uuid,p_reply text,p_evidence uuid[] default '{}',p_versions jsonb default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare req public.platform_evidence_requests; r public.platform_reports; c public.platform_cases; snapshots jsonb;
begin
  select * into req from public.platform_evidence_requests where id=p_request;
  select * into r from public.platform_reports where id=req.report_id and reporter_id=auth.uid();
  if r.id is null then raise exception 'Not allowed'; end if;
  c:=public.lock_report_case(req.case_id);
  select * into req from public.platform_evidence_requests where id=p_request for update;
  if c.status='closed' or req.status<>'open' then raise exception 'This evidence request is no longer open'; end if;
  if p_reply is null or char_length(btrim(p_reply)) not between 1 and 2000 then raise exception 'Add an explanation, up to 2000 characters'; end if;
  snapshots:=public.snapshot_report_evidence(case when c.target_kind='group' then c.group_id when c.target_kind='message' then c.source_conversation end,case when c.target_kind='community' then c.community_id end,p_evidence,auth.uid(),p_versions);
  update public.platform_evidence_requests set status='answered',reply=btrim(p_reply),evidence=snapshots,answered_at=now() where id=req.id;
  update public.platform_cases set status='in_review',revision=revision+1,updated_at=now() where id=c.id;
  update public.platform_notifications n set seen_at=now() where n.user_id=auth.uid() and n.link='/reports/'||r.id::text
    and exists(select 1 from public.platform_case_events e where e.id=n.event_id and e.action='request_evidence');
  insert into public.platform_case_events(case_id,actor_id,action,internal_note) values(c.id,auth.uid(),'evidence_received','Reporter supplied additional evidence for report '||r.id::text);
end $$;
revoke execute on function public.answer_report_evidence(uuid,text,uuid[],jsonb) from public,anon;
grant execute on function public.answer_report_evidence(uuid,text,uuid[],jsonb) to authenticated;

-- Existing whole-space enforcement remains separate from per-message enforcement.
alter function public.review_platform_case(uuid,bigint,text,text,text) rename to review_platform_space_case;
revoke execute on function public.review_platform_space_case(uuid,bigint,text,text,text) from public,anon,authenticated;
create function public.review_platform_case(p_case uuid,p_revision bigint,p_action text,p_response text default '',p_note text default '') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.platform_cases; event uuid;
begin
  select * into c from public.platform_cases where id=p_case;
  if not found or not public.can_review_platform_target(c.target_kind,c.target_key) then raise exception 'Not allowed'; end if;
  if c.target_kind<>'message' then
    perform public.review_platform_space_case(p_case,p_revision,p_action,p_response,p_note);
  else
    c:=public.lock_report_case(c.id);
    if not public.can_review_platform_target(c.target_kind,c.target_key) then raise exception 'Not allowed'; end if;
    p_response:=coalesce(p_response,''); p_note:=coalesce(p_note,'');
    if c.revision is distinct from p_revision or c.status='closed' then raise exception 'This case changed. Refresh before deciding.'; end if;
    if p_action is null or p_action not in ('review','dismiss','warn','remove') or char_length(p_note)>2000 or char_length(p_response)>500 or (p_action<>'review' and char_length(btrim(p_response))<5) then raise exception 'Add a short decision for the people affected'; end if;
    if p_action='remove' then
      if c.message_id is null then raise exception 'The message no longer exists. Close without action.'; end if;
      update public.messages set content='Message removed by AGENTME',removed_at=now(),removed_by=auth.uid() where id=c.message_id and removed_at is null;
      update public.reports set status='resolved',resolved_by=auth.uid() where message_id=c.message_id and status='open';
    end if;
    update public.platform_cases set status=case when p_action='review' then 'in_review' else 'closed' end,
      outcome=case p_action when 'dismiss' then 'dismissed' when 'warn' then 'warned' when 'remove' then 'removed' end,
      response=case when p_action='review' then null else btrim(p_response) end,revision=revision+1,updated_at=now() where id=c.id;
    insert into public.platform_case_events(case_id,actor_id,action,public_response,internal_note) values(c.id,auth.uid(),p_action,nullif(btrim(p_response),''),nullif(btrim(p_note),'')) returning id into event;
    insert into public.platform_notifications(user_id,event_id,text,link)
      select reporter_id,event,'AGENTME updated your message report.','/reports/'||id::text from public.platform_reports where case_id=c.id and reporter_id is not null;
    if p_action in ('warn','remove') and c.subject_user_id is not null then
      insert into public.platform_notifications(user_id,event_id,text,link) values(c.subject_user_id,event,'AGENTME reviewed a message from your account. '||btrim(p_response),'/settings') on conflict do nothing;
    end if;
  end if;
  if p_action<>'review' then update public.platform_evidence_requests set status='closed' where case_id=c.id and status='open'; end if;
end $$;
revoke execute on function public.review_platform_case(uuid,bigint,text,text,text) from public,anon;
grant execute on function public.review_platform_case(uuid,bigint,text,text,text) to authenticated;

create or replace function public.own_platform_reports(p_report uuid default null,p_offset integer default 0) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
    select r.id,r.category,r.reason,r.evidence,r.created_at,c.id case_id,c.title,c.target_kind,c.target_key,c.description,c.rules,c.status,c.outcome,c.response,c.updated_at,
      (select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'question',q.question,'status',q.status,'reply',q.reply,'evidence',q.evidence,'created_at',q.created_at,'answered_at',q.answered_at) order by q.created_at),'[]'::jsonb) from public.platform_evidence_requests q where q.report_id=r.id) requests
    from public.platform_reports r join public.platform_cases c on c.id=r.case_id where r.reporter_id=auth.uid() and (p_report is null or r.id=p_report)
      and p_offset between 0 and 10000 order by r.created_at desc,r.id desc limit 26 offset greatest(0,least(p_offset,10000))
  ) x;
$$;

create or replace function public.platform_case_queue(p_state text default 'pending',p_offset integer default 0) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
  if not public.is_platform_moderator() or p_state is null or p_state not in ('pending','waiting','closed') or p_offset is null or p_offset not between 0 and 10000 then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
    select c.*,(select count(*) from public.platform_reports r where r.case_id=c.id) reports from public.platform_cases c
    where (p_state='pending' and c.status in ('open','in_review')) or (p_state='waiting' and c.status='waiting_evidence') or (p_state='closed' and c.status='closed')
    order by c.created_at desc,c.id desc limit 26 offset p_offset
  ) x);
end $$;

-- Waiting reporters get a My Agent action; waiting cases do not count as reviewer work.
create or replace function public.owner_attention_count() returns bigint language sql stable security definer set search_path=public,pg_temp as $$
  select (select count(*) from public.inbox_items i where i.owner_id=auth.uid() and i.status='open' and (i.kind in ('info_request','question') or (i.kind='group_invite' and public.open_group_invitation(i.id))))
    + (select count(*) from public.platform_cases c where c.status in ('open','in_review') and public.can_review_platform_target(c.target_kind,c.target_key))
    + (select count(*) from public.platform_notifications n where user_id=auth.uid() and seen_at is null and not exists(select 1 from public.platform_evidence_requests q join public.platform_reports r on r.id=q.report_id where q.status='open' and r.reporter_id=auth.uid() and n.link='/reports/'||r.id::text))
    + (select count(*) from public.platform_evidence_requests q join public.platform_reports r on r.id=q.report_id where q.status='open' and r.reporter_id=auth.uid())
    + (select count(*) from public.reports r where r.message_id is not null and r.status='open' and ((r.community_id is not null and public.community_role(r.community_id) in ('owner','moderator')) or (r.community_id is null and public.conversation_role(r.conversation_id) in ('owner','admin'))));
$$;

create function public.own_evidence_requests() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
    select q.id,r.id report_id,c.title,q.question,q.created_at from public.platform_evidence_requests q
    join public.platform_reports r on r.id=q.report_id join public.platform_cases c on c.id=q.case_id
    where r.reporter_id=auth.uid() and q.status='open' order by q.created_at limit 20
  ) x;
$$;
revoke execute on function public.own_evidence_requests() from public,anon;
grant execute on function public.own_evidence_requests() to authenticated;

create or replace function public.platform_attention() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare local_reviews jsonb; notices jsonb; pending bigint;
begin
  select count(*) into pending from public.platform_cases where status in ('open','in_review') and public.can_review_platform_target(target_kind,target_key);
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into local_reviews from (
    select c.id,'group' kind,c.title,count(*) total from public.reports r join public.conversations c on c.id=r.conversation_id
    where r.message_id is not null and r.status='open' and r.community_id is null and public.conversation_role(c.id) in ('owner','admin') group by c.id
    union all
    select cm.id,'community',cm.name,count(*) from public.reports r join public.communities cm on cm.id=r.community_id
    where r.message_id is not null and r.status='open' and public.community_role(cm.id) in ('owner','moderator') group by cm.id
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into notices from (
    select id,text,link,created_at from public.platform_notifications n where user_id=auth.uid() and seen_at is null
    and not exists(select 1 from public.platform_evidence_requests q join public.platform_reports r on r.id=q.report_id where q.status='open' and r.reporter_id=auth.uid() and n.link='/reports/'||r.id::text)
    order by created_at desc limit 10
  ) x;
  return jsonb_build_object('platform',pending,'local',local_reviews,'notifications',notices);
end $$;
