alter table public.platform_cases drop constraint platform_cases_outcome_check;
alter table public.platform_cases add constraint platform_cases_outcome_check check(outcome in ('dismissed','warned','suspended','restored','removed','account_suspended_1m','account_suspended_3m','account_banned'));
alter table public.platform_case_events drop constraint platform_case_events_action_check;
alter table public.platform_case_events add constraint platform_case_events_action_check check(action in ('review','dismiss','warn','suspend','restore','remove','request_evidence','evidence_received','suspend_1m','suspend_3m','ban','lift_account_restriction','appeal_accept','appeal_reject'));

-- Only authors of evidence actually submitted in this case can be selected.
create function public.account_case_people(p_case uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c public.platform_cases; result jsonb;
begin
  select * into c from public.platform_cases where id=p_case;
  if c.id is null or not public.can_review_platform_target(c.target_kind,c.target_key) then raise exception 'Not allowed'; end if;
  if c.target_kind='message' then
    select jsonb_build_array(jsonb_build_object('id',c.subject_user_id,'name',coalesce(a.display_name,'Former member'),'protected',exists(select 1 from public.platform_operators where user_id=c.subject_user_id and enabled),'evidence',jsonb_build_array(jsonb_build_object('id',c.target_key,'content',coalesce((select e->>'content' from public.platform_reports r cross join lateral jsonb_array_elements(r.evidence) e where r.case_id=c.id and e->>'id'=c.target_key::text order by r.created_at limit 1),'Reported message'),'at',coalesce((select e->>'at' from public.platform_reports r cross join lateral jsonb_array_elements(r.evidence) e where r.case_id=c.id and e->>'id'=c.target_key::text order by r.created_at limit 1),c.created_at::text),'author',coalesce(a.display_name,'Former member'),'ai',false))))
      into result from auth.users u left join lateral(select display_name from public.agents where owner_id=u.id order by created_at,id limit 1) a on true
      where u.id=c.subject_user_id and u.id is distinct from auth.uid() and not exists(select 1 from public.platform_reports where case_id=c.id and reporter_id=u.id);
    return coalesce(result,'[]'::jsonb);
  end if;
  with submitted as (
    select e from public.platform_reports r cross join lateral jsonb_array_elements(r.evidence) e where r.case_id=c.id
    union select e from public.platform_evidence_requests q cross join lateral jsonb_array_elements(q.evidence) e where q.case_id=c.id and q.status='answered'
  ), people as (
    select distinct on (m.id) coalesce(m.sender_user_id,agent.owner_id) user_id,e
    from submitted join public.messages m on m.id::text=e->>'id' join public.conversations cv on cv.id=m.conversation_id
    left join public.agents agent on agent.id=m.sender_agent_id
    where (c.target_kind='group' and cv.id=c.group_id) or (c.target_kind='community' and cv.community_id=c.community_id)
    order by m.id
  ) select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
    select u.id,coalesce(a.display_name,'Former member') name,exists(select 1 from public.platform_operators where user_id=u.id and enabled) protected,jsonb_agg(p.e) evidence
    from people p join auth.users u on u.id=p.user_id left join lateral(select display_name from public.agents where owner_id=u.id order by created_at,id limit 1) a on true
    where u.id is distinct from auth.uid() and not exists(select 1 from public.platform_reports where case_id=c.id and reporter_id=u.id)
    group by u.id,a.display_name
  ) x;
  return result;
end $$;
revoke execute on function public.account_case_people(uuid) from public,anon;
grant execute on function public.account_case_people(uuid) to authenticated;

alter function public.review_platform_case(uuid,bigint,text,text,text) rename to review_platform_content_case;
revoke execute on function public.review_platform_content_case(uuid,bigint,text,text,text) from public,anon,authenticated;
create function public.review_platform_case(p_case uuid,p_revision bigint,p_action text,p_response text default '',p_note text default '',p_subject uuid default null,p_evidence uuid default null) returns void language plpgsql security definer set search_path=public,pg_temp set timezone='UTC' as $$
declare c public.platform_cases; person jsonb; event uuid; sanction uuid; until_time timestamptz; target uuid;
begin
  select * into c from public.platform_cases where id=p_case;
  if c.id is null or not public.can_review_platform_target(c.target_kind,c.target_key) then raise exception 'Not allowed'; end if;
  if p_action not in ('suspend_1m','suspend_3m','ban') or p_action is null then
    perform public.review_platform_content_case(p_case,p_revision,p_action,p_response,p_note);
    -- Final decisions about a message also reach its author, without the report or reporter identity.
    if p_action='dismiss' and c.target_kind='message' and c.subject_user_id is not null then
      select id into event from public.platform_case_events where case_id=c.id order by created_at desc,id desc limit 1;
      insert into public.platform_notifications(user_id,event_id,text,link) values(c.subject_user_id,event,'AGENTME reviewed a message from your account. No action was taken. Justification: '||btrim(p_response),'/settings') on conflict do nothing;
    end if;
    return;
  end if;
  target:=case when c.target_kind='message' then c.subject_user_id else p_subject end;
  if target is null or (c.target_kind='message' and p_subject is not null and p_subject<>target) then raise exception 'Select the account identified by the submitted evidence'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-decision:'||target::text,0));
  c:=public.lock_report_case(c.id);
  if not public.can_review_platform_target(c.target_kind,c.target_key) then raise exception 'Not allowed'; end if;
  if c.status='closed' or c.revision is distinct from p_revision then raise exception 'This case changed. Refresh before deciding.'; end if;
  if p_response is null or char_length(btrim(p_response)) not between 5 and 500 or char_length(coalesce(p_note,''))>2000 then raise exception 'Add a justification between 5 and 500 characters'; end if;
  select e into person from jsonb_array_elements(public.account_case_people(c.id)) e where e->>'id'=target::text;
  if person is null or target=auth.uid() then raise exception 'Select the account identified by the submitted evidence'; end if;
  if (person->>'protected')::boolean or (exists(select 1 from public.platform_moderators where user_id=target and enabled) and not public.is_platform_operator()) then raise exception 'This staff account requires independent operator review'; end if;
  if c.target_kind='message' then p_evidence:=c.target_key; end if;
  if p_evidence is null or not exists(select 1 from jsonb_array_elements(person->'evidence') e where e->>'id'=p_evidence::text) then raise exception 'Select supporting evidence authored by this account'; end if;
  until_time:=case p_action when 'suspend_1m' then now()+interval '1 month' when 'suspend_3m' then now()+interval '3 months' else null end;
  insert into public.platform_case_events(case_id,actor_id,action,public_response,internal_note) values(c.id,auth.uid(),p_action,btrim(p_response),nullif(btrim(p_note),'')) returning id into event;
  insert into public.platform_account_sanctions(case_id,event_id,user_id,user_key,subject_name,actor_id,action,justification,evidence_message_id,expires_at)
    values(c.id,event,target,target,person->>'name',auth.uid(),p_action,btrim(p_response),(select id from public.messages where id=p_evidence),until_time) returning id into sanction;
  update public.platform_cases set subject_user_id=target,status='closed',outcome=case p_action when 'ban' then 'account_banned' when 'suspend_1m' then 'account_suspended_1m' else 'account_suspended_3m' end,response=btrim(p_response),revision=revision+1,updated_at=now() where id=c.id;
  update public.platform_evidence_requests set status='closed' where case_id=c.id and status='open';
  -- Stop unfinished work rather than resuming stale plans after the suspension expires.
  update public.tasks set status='cancelled',lease_until=null,lease_token=null,wake_requested=false,error='Stopped because the account was restricted by AGENTME.' where status in ('awaiting_approval','running','waiting','proposal_ready') and public.account_is_restricted(owner_id);
  insert into public.platform_notifications(user_id,event_id,text,link) values(target,event,
    case p_action when 'ban' then 'Your AGENTME account is permanently banned.' when 'suspend_1m' then 'Your AGENTME account is suspended for 1 month.' else 'Your AGENTME account is suspended for 3 months.' end||
    case when until_time is null then '' else ' Ends '||to_char(until_time,'DD Mon YYYY, HH24:MI:SS "UTC"')||'.' end||' Justification: '||btrim(p_response)||' You can appeal this decision.','/account-status');
  insert into public.platform_notifications(user_id,event_id,text,link)
    select reporter_id,event,'AGENTME has reviewed your report and taken action.','/reports/'||id::text from public.platform_reports where case_id=c.id and reporter_id is not null on conflict do nothing;
end $$;
revoke execute on function public.review_platform_case(uuid,bigint,text,text,text,uuid,uuid) from public,anon;
grant execute on function public.review_platform_case(uuid,bigint,text,text,text,uuid,uuid) to authenticated;

create function public.platform_reporting_history(p_case uuid,p_subject uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c public.platform_cases;
begin
  select * into c from public.platform_cases where id=p_case;
  if c.id is null or not public.can_review_platform_target(c.target_kind,c.target_key) or p_offset is null or p_offset not between 0 and 10000 then raise exception 'Not allowed'; end if;
  if not exists(select 1 from jsonb_array_elements(public.account_case_people(c.id)) e where e->>'id'=p_subject::text) then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
    select pc.id,pc.created_at reported_at,
      public.can_review_platform_target(pc.target_kind,pc.target_key) accessible,
      case when public.can_review_platform_target(pc.target_kind,pc.target_key) then pc.status end status,
      case when public.can_review_platform_target(pc.target_kind,pc.target_key) then coalesce(s.action,pc.outcome) end action,
      case when public.can_review_platform_target(pc.target_kind,pc.target_key) then coalesce(s.justification,pc.response) end justification,
      case when public.can_review_platform_target(pc.target_kind,pc.target_key) then coalesce(s.created_at,(select max(created_at) from public.platform_case_events where case_id=pc.id and action in ('dismiss','warn','remove','suspend','restore'))) end decided_at,
      case when public.can_review_platform_target(pc.target_kind,pc.target_key) then s.expires_at end expires_at,
      case when public.can_review_platform_target(pc.target_kind,pc.target_key) and s.id is not null then case when s.revoked_at is not null then 'lifted' when s.expires_at is not null and s.expires_at<=now() then 'expired' else 'active' end end restriction_status
    from public.platform_cases pc left join lateral(select * from public.platform_account_sanctions where case_id=pc.id and user_key=p_subject order by created_at desc limit 1) s on true
    where pc.subject_user_id=p_subject and pc.id<>c.id order by pc.created_at desc,pc.id desc limit 26 offset p_offset
  ) x);
end $$;
revoke execute on function public.platform_reporting_history(uuid,uuid,integer) from public,anon;
grant execute on function public.platform_reporting_history(uuid,uuid,integer) to authenticated;
