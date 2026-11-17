-- Authenticated staff RPCs may update their own work state and read receipts,
-- but cannot change the business-wide visibility/profile or other memberships.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.guard_restricted_caller()'::regprocedure);
  definition:=replace(definition,'''messages'',''message_reactions''','''rate_limits'',''inbox_items'',''presence_preferences'',''messages'',''message_reactions''');
  definition:=replace(definition,'if tg_table_name=''agents''',
    'if actor_role=''staff'' and tg_table_name=''presence_preferences'' and (tg_op<>''UPDATE'' or new.visibility is distinct from old.visibility or new.mode is distinct from old.mode or new.mode_until is distinct from old.mode_until) then raise exception ''Only owners and managers change business-wide settings.''; end if;
     if actor_role=''staff'' and tg_table_name=''inbox_items'' and (coalesce(new.owner_id,old.owner_id) is distinct from public.workspace_user_id() or coalesce(new.kind,old.kind) not in (''question'',''business_answer_review'')) then raise exception ''Not allowed''; end if;
     if actor_role=''staff'' and tg_table_name=''messages'' and tg_op=''UPDATE'' and old.sender_user_id is not null and not exists(select 1 from public.business_message_authors where message_id=old.id and actor_id=auth.uid()) then raise exception ''You can only delete messages you personally sent for this business''; end if;
     if tg_table_name=''agents''');
  execute definition;
end $$;

create unique index business_team_reply_once on public.messages((metadata->>'team_inbox_id')) where is_ai_generated and metadata ? 'team_inbox_id';
create function public.post_business_authored_message(p_actor uuid,p_business uuid,p_conversation uuid,p_content text,p_metadata jsonb,p_user uuid,p_agent uuid,p_visible uuid,p_thread uuid,p_reply uuid)
returns setof public.messages language plpgsql security definer set search_path=public,pg_temp as $$
declare role_name text; row_message public.messages; owner_user uuid;
begin
  select owner_id into owner_user from public.agents where id=p_business and type='business';
  select role into role_name from public.business_managers where business_agent_id=p_business and user_id=p_actor;
  if role_name is null and owner_user=p_actor and not exists(select 1 from public.business_managers where business_agent_id=p_business) then role_name:='owner'; end if;
  if owner_user is null or role_name is null or public.direct_account_restricted(p_actor) or public.account_is_restricted(owner_user) or (p_user is not null and p_user<>owner_user) then raise exception 'Business access unavailable'; end if;
  if p_metadata ? 'team_inbox_id' then select * into row_message from public.messages where is_ai_generated and metadata->>'team_inbox_id'=p_metadata->>'team_inbox_id'; end if;
  if row_message.id is null then
    insert into public.messages(conversation_id,content,metadata,sender_user_id,sender_agent_id,is_ai_generated,visible_to,thread_id,reply_to)
    values(p_conversation,p_content,p_metadata,p_user,p_agent,p_agent is not null,p_visible,p_thread,p_reply) returning * into row_message;
  end if;
  insert into public.business_message_authors(message_id,business_agent_id,actor_id,actor_name,role) values(row_message.id,p_business,p_actor,public.business_actor_name(p_actor),role_name) on conflict do nothing;
  return next row_message;
end $$;
revoke execute on function public.post_business_authored_message(uuid,uuid,uuid,text,jsonb,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.post_business_authored_message(uuid,uuid,uuid,text,jsonb,uuid,uuid,uuid,uuid,uuid) to service_role;

-- Dashboard queries are privileged even if a caller bypasses the page.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.business_dashboard(uuid,integer)'::regprocedure);
  definition:=replace(definition,'a.owner_id=public.workspace_user_id()','a.owner_id=public.workspace_user_id() and public.business_permission(''configure'')');
  definition:=replace(definition,'a.owner_id = public.workspace_user_id()','a.owner_id = public.workspace_user_id() and public.business_permission(''configure'')');
  execute definition;
end $$;
