alter table public.business_managers add column require_assignment boolean not null default false,
  add column require_publication_approval boolean not null default true;
alter table public.business_question_claims add column manager_assigned boolean not null default false;
grant select(manager_assigned) on public.business_question_claims to authenticated;
alter table public.business_answer_drafts add column source_inbox uuid references public.inbox_items(id) on delete set null;
create unique index one_published_answer_per_request on public.business_answer_drafts(source_inbox) where source_inbox is not null and status='approved';

create function public.set_business_staff_controls(p_user uuid,p_require_assignment boolean,p_require_publication_approval boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare business uuid:=public.my_agent_id(); target_role text;
begin
  if not public.business_permission('staff') or p_user is null or p_user=auth.uid() or p_require_assignment is null or p_require_publication_approval is null then raise exception 'Only an Owner or Manager can change Staff permissions'; end if;
  perform 1 from public.agents where id=business for update;
  select role into target_role from public.business_managers where business_agent_id=business and user_id=p_user for update;
  if target_role is distinct from 'staff' then raise exception 'These settings apply to current Staff members only'; end if;
  update public.business_managers set require_assignment=p_require_assignment,require_publication_approval=p_require_publication_approval where business_agent_id=business and user_id=p_user;
  perform public.log_business_staff(business,public.business_actor_name(p_user),'Staff permissions updated: assignment '||case when p_require_assignment then 'required' else 'optional' end||'; Q&A approval '||case when p_require_publication_approval then 'required' else 'not required' end);
end $$;
revoke execute on function public.set_business_staff_controls(uuid,boolean,boolean) from public,anon;
grant execute on function public.set_business_staff_controls(uuid,boolean,boolean) to authenticated;
create trigger business_staff_controls_changed after update of require_assignment,require_publication_approval on public.business_managers for each row execute function public.business_queue_changed();

-- Self-claiming is not a substitute for an Owner/Manager assignment.
do $$ declare d text; begin
  d:=pg_get_functiondef('public.claim_business_question(uuid,uuid,boolean)'::regprocedure);
  d:=replace(d,'if claim.processing_until>now() then',
    'if public.workspace_role()=''staff'' and not p_release and exists(select 1 from public.business_managers where business_agent_id=business and user_id=auth.uid() and require_assignment) and (claim.assigned_to is distinct from auth.uid() or not claim.manager_assigned) then raise exception ''An Owner or Manager must assign this request to you before you can reply''; end if;
     if claim.processing_until>now() then');
  d:=replace(d,'update public.business_question_claims set assigned_to=',
    'update public.business_question_claims set manager_assigned=case when p_release then false when public.workspace_role() in (''owner'',''manager'') then true else claim.manager_assigned end,assigned_to=');
  execute d;
  d:=pg_get_functiondef('public.reserve_business_answer(uuid)'::regprocedure);
  d:=replace(d,'if claim.assigned_to is not null',
    'if public.workspace_role()=''staff'' and exists(select 1 from public.business_managers where business_agent_id=business and user_id=auth.uid() and require_assignment) and (claim.assigned_to is distinct from auth.uid() or not claim.manager_assigned) then raise exception ''An Owner or Manager must assign this request to you before you can reply''; end if;
     if claim.assigned_to is not null');
  execute d;
  -- Direct table writes cannot bypass the validated customer-reply action.
  d:=pg_get_functiondef('public.guard_restricted_caller()'::regprocedure);
  d:=replace(d,'if tg_table_name=''inbox_items'' and (',
    'if tg_table_name=''inbox_items'' and coalesce(next_row->>''kind'',previous_row->>''kind'')=''question'' then raise exception ''Use the customer reply action to handle this request''; end if;
     if tg_table_name=''inbox_items'' and (');
  execute d;
end $$;

-- These commits are service-only: application code performs the publication
-- review first. Roles, settings, company ownership and active leases are checked
-- again here, under the same business lock used by staff-management changes.
create function public.review_business_answer_as(p_business uuid,p_actor uuid,p_draft uuid,p_approve boolean,p_question text,p_answer text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare draft public.business_answer_drafts; info jsonb; owner_user uuid; actor_role text;
begin
  select owner_id,business_info into owner_user,info from public.agents where id=p_business and type='business' for update;
  select role into actor_role from public.business_managers where business_agent_id=p_business and user_id=p_actor for share;
  if actor_role is null and owner_user=p_actor and not exists(select 1 from public.business_managers where business_agent_id=p_business) then actor_role:='owner'; end if;
  if owner_user is null or actor_role not in ('owner','manager') or actor_role is null or p_approve is null or public.direct_account_restricted(p_actor) or public.account_is_restricted(owner_user) then raise exception 'Only current Owners and Managers can review answers'; end if;
  select * into draft from public.business_answer_drafts where id=p_draft and business_agent_id=p_business for update;
  if not found or draft.status<>'pending' then raise exception 'Suggestion unavailable'; end if;
  if p_approve then
    if p_question is null or p_answer is null or length(trim(p_question)) not between 1 and 300 or length(trim(p_answer)) not between 1 and 1000 then raise exception 'Check the FAQ question and answer'; end if;
    if not coalesce(info->'faqs','[]'::jsonb) @> jsonb_build_array(jsonb_build_object('q',trim(p_question),'a',trim(p_answer))) then
      if jsonb_array_length(coalesce(info->'faqs','[]'::jsonb))>=50 then raise exception 'Questions & Answers is full; update or remove an existing answer first'; end if;
      update public.agents set business_info=jsonb_set(coalesce(info,'{}'::jsonb),'{faqs}',coalesce(info->'faqs','[]'::jsonb)||jsonb_build_array(jsonb_build_object('q',trim(p_question),'a',trim(p_answer)))) where id=p_business;
    end if;
  end if;
  update public.business_answer_drafts set status=case when p_approve then 'approved' else 'declined' end,question=case when p_approve then trim(p_question) else question end,answer=case when p_approve then trim(p_answer) else answer end,reviewed_by=p_actor,reviewed_at=now() where id=p_draft;
  update public.inbox_items set status=case when p_approve then 'answered' else 'declined' end,answered_at=now() where kind='business_answer_review' and payload->>'draft_id'=p_draft::text and owner_id=owner_user and status='open';
  insert into public.business_staff_audit(business_agent_id,actor_id,actor_name,subject_name,action) values(p_business,p_actor,public.business_actor_name(p_actor),left(p_question,300),case when p_approve then 'Suggested answer approved' else 'Suggested answer declined' end);
end $$;
revoke execute on function public.review_business_answer(uuid,boolean,text,text) from public,anon,authenticated;
revoke execute on function public.review_business_answer_as(uuid,uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.review_business_answer_as(uuid,uuid,uuid,boolean,text,text) to service_role;

create function public.publish_staff_business_answer(p_business uuid,p_actor uuid,p_question text,p_answer text,p_inbox uuid default null,p_ticket uuid default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare member public.business_managers; info jsonb; owner_user uuid; prior public.business_answer_drafts; draft uuid;
begin
  select owner_id,business_info into owner_user,info from public.agents where id=p_business and type='business' for update;
  select * into member from public.business_managers where business_agent_id=p_business and user_id=p_actor for share;
  if owner_user is null or member.role is distinct from 'staff' or public.direct_account_restricted(p_actor) or public.account_is_restricted(owner_user) then raise exception 'Staff access unavailable'; end if;
  if member.require_publication_approval then raise exception 'Approval is now required. Submit this answer for Owner or Manager review instead'; end if;
  if p_question is null or p_answer is null or length(trim(p_question)) not between 1 and 300 or length(trim(p_answer)) not between 1 and 1000 then raise exception 'Write a FAQ question (up to 300 characters) and answer (up to 1,000)'; end if;
  if p_inbox is not null then
    if not exists(select 1 from public.inbox_items i join public.business_question_claims c on c.inbox_id=i.id
      where i.id=p_inbox and i.agent_id=p_business and i.owner_id=owner_user and i.status='open' and i.kind='question' and i.payload->>'business'='true' and i.payload->>'faq_eligible'='true'
        and left(trim(i.payload->>'question'),300)=trim(p_question) and c.assigned_to=p_actor and c.processing_token=p_ticket and c.processing_until>now() and (not member.require_assignment or c.manager_assigned)) then raise exception 'This question is not available for direct Q&A publication'; end if;
    select * into prior from public.business_answer_drafts where source_inbox=p_inbox and status='approved';
    if found then
      if prior.question=trim(p_question) and prior.answer=trim(p_answer) then return prior.id; end if;
      raise exception 'This request already supplied an approved answer. Update Questions & Answers to change it';
    end if;
  end if;
  if not coalesce(info->'faqs','[]'::jsonb) @> jsonb_build_array(jsonb_build_object('q',trim(p_question),'a',trim(p_answer))) then
    if jsonb_array_length(coalesce(info->'faqs','[]'::jsonb))>=50 then raise exception 'Questions & Answers is full; ask an Owner or Manager to update it'; end if;
    update public.agents set business_info=jsonb_set(coalesce(info,'{}'::jsonb),'{faqs}',coalesce(info->'faqs','[]'::jsonb)||jsonb_build_array(jsonb_build_object('q',trim(p_question),'a',trim(p_answer)))) where id=p_business;
  end if;
  insert into public.business_answer_drafts(business_agent_id,author_id,author_name,question,answer,status,reviewed_by,reviewed_at,source_inbox) values(p_business,p_actor,public.business_actor_name(p_actor),trim(p_question),trim(p_answer),'approved',p_actor,now(),p_inbox) returning id into draft;
  insert into public.business_staff_audit(business_agent_id,actor_id,actor_name,subject_name,action) values(p_business,p_actor,public.business_actor_name(p_actor),left(p_question,300),'Q&A answer published directly by trusted Staff');
  return draft;
end $$;
revoke execute on function public.publish_staff_business_answer(uuid,uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.publish_staff_business_answer(uuid,uuid,text,text,uuid,uuid) to service_role;
