create function public.business_draft_access(p_draft uuid,p_actor uuid,p_role text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.business_answer_drafts d where d.id=p_draft and (
    p_role='owner' or d.author_id=p_actor or (p_role='manager' and (
      (d.status='pending' and exists(select 1 from public.business_managers m where m.business_agent_id=d.business_agent_id and m.user_id=d.author_id and m.role='staff' and m.supervisor_id=p_actor))
      or (d.status<>'pending' and exists(select 1 from public.business_work_events e where e.business_agent_id=d.business_agent_id and e.kind='faq_published' and e.source_key=d.id::text and e.supervisor_id=p_actor))
    ))));
$$;
create function public.business_item_access(p_item uuid,p_actor uuid,p_role text) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare i public.inbox_items; claim public.business_question_claims; supervisor uuid; own_supervisor uuid; required boolean;
begin
  select * into i from public.inbox_items where id=p_item;
  if not found then return false; end if;
  if p_role is null or p_role='owner' then return true; end if;
  if i.kind='business_answer_review' then
    if coalesce(i.payload->>'draft_id','') !~ '^[0-9a-f-]{36}$' then return false; end if;
    return public.business_draft_access((i.payload->>'draft_id')::uuid,p_actor,p_role);
  end if;
  if i.kind<>'question' or i.payload->>'business' is distinct from 'true' then return true; end if;
  select * into claim from public.business_question_claims where inbox_id=i.id;
  if i.status<>'open' then
    return (p_role='staff' and claim.handled_by=p_actor) or (p_role='manager' and exists(select 1 from public.business_work_events e where e.inbox_id=i.id and e.supervisor_id=p_actor and e.kind in ('answered','declined')));
  end if;
  select supervisor_id,require_assignment into own_supervisor,required from public.business_managers where business_agent_id=i.agent_id and user_id=p_actor;
  if claim.assigned_to is null then return p_role='manager' or (p_role='staff' and not coalesce(required,true)); end if;
  if claim.assigned_to=p_actor then return p_role<>'staff' or not required or claim.manager_assigned; end if;
  select supervisor_id into supervisor from public.business_managers where business_agent_id=i.agent_id and user_id=claim.assigned_to and role='staff';
  return coalesce((p_role='manager' and supervisor=p_actor) or (p_role='staff' and not required and supervisor=own_supervisor),false);
end $$;
create function public.workspace_business_item_access(p_item uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.workspace_session_allowed() and (public.workspace_role() is null or public.workspace_role()='owner' or exists(select 1 from public.inbox_items i where i.id=p_item and i.owner_id=public.workspace_user_id() and public.business_item_access(i.id,auth.uid(),public.workspace_role())));
$$;
create function public.workspace_business_draft_access(p_draft uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.workspace_session_allowed() and exists(select 1 from public.business_answer_drafts d where d.id=p_draft and d.business_agent_id=public.my_agent_id() and public.business_draft_access(d.id,auth.uid(),public.workspace_role()));
$$;
create function public.business_note_access(p_metadata jsonb,p_owner uuid,p_actor uuid,p_role text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select case when p_role is null or p_role='owner' then true
    when p_metadata->>'kind'='request_note' or p_metadata ? 'inbox_item_id' then exists(select 1 from public.inbox_items i where i.id::text=p_metadata->>'inbox_item_id' and i.owner_id=p_owner and public.business_item_access(i.id,p_actor,p_role))
    else true end;
$$;
create policy business_inbox_team_scope on public.inbox_items as restrictive for all to authenticated using(public.workspace_business_item_access(id)) with check(public.workspace_business_item_access(id));
create policy business_claim_team_scope on public.business_question_claims as restrictive for select to authenticated using(public.workspace_business_item_access(inbox_id));
create policy business_draft_team_scope on public.business_answer_drafts as restrictive for select to authenticated using(public.workspace_business_draft_access(id));

create function public.business_work_attention(p_owner uuid,p_actor uuid) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
  select count(*) from public.business_work_notices n join public.agents a on a.id=n.business_agent_id join public.business_managers m on m.business_agent_id=a.id and m.user_id=p_actor
  left join public.business_team_transfers t on t.id=n.transfer_id
  where a.owner_id=p_owner and n.recipient_id=p_actor and ((n.kind='information' and n.seen_at is null) or (n.kind='transfer_request' and t.status='pending' and t.expires_at>now() and t.to_supervisor=p_actor and m.role in ('owner','manager')));
$$;
do $$ declare d text; begin
  d:=pg_get_functiondef('public.notification_attention_base(uuid,text,uuid)'::regprocedure);
  d:=regexp_replace(d,'where i.owner_id\s*=\s*p_scope_user and i.status\s*=\s*''open''','where i.owner_id=p_scope_user and i.status=''open'' and public.business_item_access(i.id,p_scope_actor,p_scope_role)','g'); execute d;
end $$;
create or replace function public.notification_attention(p_user uuid,p_role text,p_actor uuid) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
  select (case when p_role='staff' then (select count(*) from public.inbox_items i where i.owner_id=p_user and i.status='open' and i.kind='question' and i.payload->>'business'='true' and public.business_item_access(i.id,p_actor,p_role))
    else public.notification_attention_base(p_user,p_role,p_actor) end)+public.business_work_attention(p_user,p_actor);
$$;

do $$ declare d text; f text; begin
  d:=pg_get_functiondef('public.claim_business_question(uuid,uuid,boolean)'::regprocedure);
  d:=replace(d,'insert into public.business_question_claims',
    'if not public.business_item_access(p_item,auth.uid(),public.workspace_role()) then raise exception ''This request belongs to another team''; end if;
     if public.workspace_role()=''manager'' and not p_release and assignee<>auth.uid() and not exists(select 1 from public.business_managers where business_agent_id=business and user_id=assignee and role=''staff'' and supervisor_id=auth.uid()) then raise exception ''Choose a Staff member in your own team''; end if;
     insert into public.business_question_claims');
  d:=replace(d,'else claim.manager_assigned end','else claim.manager_assigned and claim.assigned_to=auth.uid() end'); execute d;
  d:=pg_get_functiondef('public.reserve_business_answer(uuid)'::regprocedure);
  d:=replace(d,'insert into public.business_question_claims', 'if not public.business_item_access(p_item,auth.uid(),public.workspace_role()) then raise exception ''This request is not available to your team or requires assignment''; end if;
    insert into public.business_question_claims'); execute d;
  d:=pg_get_functiondef('public.set_business_staff_controls(uuid,boolean,boolean)'::regprocedure);
  d:=replace(d,'if target_role is distinct', 'if public.workspace_role()=''manager'' and not exists(select 1 from public.business_managers where business_agent_id=business and user_id=p_user and supervisor_id=auth.uid()) then raise exception ''Only the reporting Manager or an Owner can change these permissions''; end if;
    if target_role is distinct'); execute d;
  d:=pg_get_functiondef('public.change_business_member(uuid,text,boolean)'::regprocedure);
  d:=replace(d,'if actor_role=''manager'' and (','if actor_role=''manager'' and not exists(select 1 from public.business_managers where business_agent_id=business and user_id=p_user and role=''staff'' and supervisor_id=auth.uid()) then raise exception ''Only the reporting Manager or an Owner can manage this Staff member''; end if;
    if actor_role=''manager'' and ('); execute d;
  d:=pg_get_functiondef('public.review_business_answer_as(uuid,uuid,uuid,boolean,text,text)'::regprocedure);
  d:=replace(d,'if p_approve then','if actor_role=''manager'' and not public.business_draft_access(p_draft,p_actor,actor_role) then raise exception ''This suggestion belongs to another team''; end if;
    if p_approve then'); execute d;
  d:=pg_get_functiondef('public.acknowledge_business_question(uuid)'::regprocedure);
  d:=replace(d,'if not found then return false;', 'if not found or not public.workspace_business_item_access(p_inbox) then return false;'); execute d;
  d:=pg_get_functiondef('public.can_read_chat_message(uuid,uuid)'::regprocedure);
  d:=replace(d,'where m.id=p_message','where m.id=p_message and public.business_note_access(m.metadata,public.workspace_user_id(),auth.uid(),public.workspace_role())'); execute d;
  d:=pg_get_functiondef('public.notification_can_read(uuid,uuid,uuid,text,uuid)'::regprocedure);
  d:=replace(d,'where m.id=p_message','where m.id=p_message and public.business_note_access(m.metadata,p_scope_user,p_scope_actor,p_scope_role)'); execute d;
  foreach f in array array['public.my_agent_topic_page(uuid,text,timestamptz,uuid,text,timestamptz)','public.my_agent_threads()'] loop
    d:=pg_get_functiondef(f::regprocedure);
    d:=replace(d,'where m.thread_id=', 'where public.business_note_access(m.metadata,public.workspace_user_id(),auth.uid(),public.workspace_role()) and m.thread_id='); execute d;
  end loop;
  d:=pg_get_functiondef('public.business_reporting_before()'::regprocedure);
  d:=replace(d,'if new.role=''staff'' then',
    'if tg_op=''UPDATE'' and new.role=''staff'' and old.role=''staff'' and new.supervisor_id is distinct from old.supervisor_id then
       for item in select id from public.business_team_transfers where business_agent_id=b and staff_id=new.user_id and status=''pending'' for update loop perform public.business_finish_team_transfer(item,''cancelled'',auth.uid()); end loop;
     end if;
     if new.role=''staff'' then'); execute d;
end $$;
revoke execute on function public.business_draft_access(uuid,uuid,text),public.business_item_access(uuid,uuid,text),public.business_note_access(jsonb,uuid,uuid,text),public.business_work_attention(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.workspace_business_item_access(uuid),public.workspace_business_draft_access(uuid) from public,anon;
grant execute on function public.workspace_business_item_access(uuid),public.workspace_business_draft_access(uuid) to authenticated;
