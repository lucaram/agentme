-- Count each allowed identity with the same rules, without changing the Auth
-- session or trusting a client-supplied user id. Parameterised helpers are private.
do $$ declare f record; d text; args text; types text; begin
  for f in select * from (values
    ('open_group_invitation(uuid)','notification_group_invitation'),
    ('active_staff_invitation(uuid)','notification_staff_invitation'),
    ('conversation_role(uuid)','notification_conversation_role'),
    ('community_role(uuid)','notification_community_role'),
    ('can_read_chat_message(uuid,uuid)','notification_can_read'),
    ('can_review_platform_target(text,uuid)','notification_case_review'),
    ('open_account_appeal_count()','notification_appeal_count'),
    ('owner_attention_total()','notification_attention_base'),
    ('action_counts()','notification_action_base')
  ) x(signature,new_name) loop
    select pg_get_functiondef(p.oid),pg_get_function_identity_arguments(p.oid),oidvectortypes(p.proargtypes) into d,args,types from pg_proc p where p.oid=('public.'||f.signature)::regprocedure;
    d:=replace(d,'FUNCTION public.'||split_part(f.signature,'(',1)||'('||args||')','FUNCTION public.'||f.new_name||'('||case when args='' then '' else args||', ' end||'p_scope_user uuid, p_scope_role text, p_scope_actor uuid)');
    d:=replace(d,'SECURITY INVOKER','SECURITY DEFINER');
    d:=replace(d,'public.workspace_user_id()','p_scope_user');
    d:=replace(d,'auth.uid()','p_scope_user');
    d:=replace(d,'public.workspace_role()','p_scope_role');
    d:=replace(d,'public.my_agent_id()','(select id from public.agents where owner_id=p_scope_user)');
    d:=replace(d,'public.business_permission(''configure'')','coalesce(p_scope_role in (''owner'',''manager''),false)');
    d:=replace(d,'public.is_platform_moderator()','(p_scope_role is null and p_scope_user=p_scope_actor and exists(select 1 from public.platform_moderators where user_id=p_scope_user and enabled) and not public.account_is_restricted(p_scope_user))');
    d:=regexp_replace(d,'public.open_group_invitation\(([^()]*)\)','public.notification_group_invitation(\1,p_scope_user,p_scope_role,p_scope_actor)','g');
    d:=regexp_replace(d,'public.active_staff_invitation\(([^()]*)\)','public.notification_staff_invitation(\1,p_scope_user,p_scope_role,p_scope_actor)','g');
    d:=regexp_replace(d,'public.conversation_role\(([^()]*)\)','public.notification_conversation_role(\1,p_scope_user,p_scope_role,p_scope_actor)','g');
    d:=regexp_replace(d,'public.community_role\(([^()]*)\)','public.notification_community_role(\1,p_scope_user,p_scope_role,p_scope_actor)','g');
    d:=regexp_replace(d,'public.can_review_platform_target\(([^()]*)\)','public.notification_case_review(\1,p_scope_user,p_scope_role,p_scope_actor)','g');
    d:=replace(d,'public.open_account_appeal_count()','public.notification_appeal_count(p_scope_user,p_scope_role,p_scope_actor)');
    execute d;
    execute format('revoke execute on function public.%I(%s%s uuid,text,uuid) from public,anon,authenticated',f.new_name,types,case when types='' then '' else ',' end);
  end loop;
end $$;

-- Historical request notes are a record of the action card, not a second alert.
-- Match only the same owner, sender, exact question and a narrow creation window.
update public.messages m set metadata=m.metadata||jsonb_build_object('inbox_item_id',(
  select i.id from public.inbox_items i where i.owner_id=(select owner_id from public.agents where id=m.sender_agent_id)
    and i.agent_id=m.sender_agent_id and i.kind='question' and length(i.payload->>'question')>0
    and strpos(m.content,i.payload->>'question')>0 and m.created_at>=i.created_at-interval '1 second' and m.created_at<=i.created_at+interval '2 minutes'
    order by abs(extract(epoch from m.created_at-i.created_at)),i.id limit 1
)) where m.metadata->>'kind'='request_note' and not m.metadata ? 'inbox_item_id' and exists(
  select 1 from public.inbox_items i where i.agent_id=m.sender_agent_id and i.kind='question' and length(i.payload->>'question')>0
    and strpos(m.content,i.payload->>'question')>0 and m.created_at>=i.created_at-interval '1 second' and m.created_at<=i.created_at+interval '2 minutes');

create function public.notification_attention(p_user uuid,p_role text,p_actor uuid) returns bigint
language sql stable security definer set search_path=public,pg_temp as $$
  select case when p_role='staff' then (select count(*) from public.inbox_items where owner_id=p_user and status='open' and kind='question' and payload->>'business'='true')
    else public.notification_attention_base(p_user,p_role,p_actor) end;
$$;

create function public.notification_unread(p_user uuid,p_role text,p_actor uuid) returns table(conversation_id uuid,unread bigint,muted boolean)
language sql stable security definer set search_path=public,pg_temp as $$
  with ordinary as (
    select m.conversation_id,count(*) n,bool_or(cm.muted) muted from public.messages m
    join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=p_user
    join public.conversations c on c.id=m.conversation_id and c.kind<>'my_agent'
    where m.created_at>cm.last_read_at and m.removed_at is null and m.deleted_at is null and m.sender_user_id is distinct from p_user
      and (m.sender_user_id is not null or m.sender_agent_id is not null)
      and public.notification_can_read(m.id,p_user,p_user,p_role,p_actor)
      and not exists(select 1 from public.message_views v where v.message_id=m.id and v.user_id=p_user and v.viewed_at is not null)
    group by m.conversation_id
  ), topics as (
    select th.conversation_id,count(*) n from public.agent_threads th where th.owner_id=p_user and (
      (p_role is distinct from 'staff' and exists(select 1 from public.agent_thread_tasks x join public.tasks t on t.id=x.task_id where x.thread_id=th.id and t.owner_id=p_user and t.status in ('awaiting_approval','proposal_ready')))
      or exists(select 1 from public.messages m where m.thread_id=th.id and m.created_at>th.last_read_at and m.removed_at is null and m.deleted_at is null
        and m.sender_user_id is distinct from p_user and (m.sender_user_id is not null or m.sender_agent_id is not null)
        and public.notification_can_read(m.id,p_user,p_user,p_role,p_actor)
        and not exists(select 1 from public.inbox_items i where i.id::text=m.metadata->>'inbox_item_id' and i.owner_id=p_user)
        and not exists(select 1 from public.message_views v where v.message_id=m.id and v.user_id=p_user and v.viewed_at is not null)))
    group by th.conversation_id
  ), mine as (
    select cm.conversation_id,coalesce(t.n,0)+public.notification_attention(p_user,p_role,p_actor) n,cm.muted
    from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id and c.kind='my_agent'
    left join topics t on t.conversation_id=c.id where cm.user_id=p_user
  ) select conversation_id,n,muted from ordinary where n>0 union all select conversation_id,n,muted from mine where n>0;
$$;

create function public.notification_snapshot(p_user uuid,p_role text,p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare rows jsonb; chats bigint; a record; overlap bigint:=0; attention bigint;
begin
  select coalesce(jsonb_agg(jsonb_build_object('conversation_id',conversation_id,'unread',unread,'muted',muted)),'[]'),coalesce(sum(unread) filter(where not muted),0) into rows,chats from public.notification_unread(p_user,p_role,p_actor);
  select * into a from public.notification_action_base(p_user,p_role,p_actor);
  if p_role='staff' then a.contacts:=0; a.groups:=0; a.communities:=0; end if;
  attention:=public.notification_attention(p_user,p_role,p_actor);
  -- Group invitations and local reports appear on two surfaces but count once.
  if p_role is distinct from 'staff' and exists(select 1 from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id and c.kind='my_agent' where cm.user_id=p_user and not cm.muted) then
    select (select count(*) from public.inbox_items i where i.owner_id=p_user and i.status='open' and i.kind='group_invite' and public.notification_group_invitation(i.id,p_user,p_role,p_actor))
      +(select count(*) from public.reports r where r.message_id is not null and r.status='open' and ((r.community_id is not null and public.notification_community_role(r.community_id,p_user,p_role,p_actor) in ('owner','moderator')) or (r.community_id is null and public.notification_conversation_role(r.conversation_id,p_user,p_role,p_actor) in ('owner','admin')))) into overlap;
  end if;
  return jsonb_build_object('total',greatest(0,chats+a.contacts+a.groups+a.communities-overlap),'chats',chats,'contacts',a.contacts,'groups',a.groups,'communities',a.communities,'attention',attention,'unread',rows);
end $$;

create function public.notification_accounts(p_actor uuid,p_current uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare accounts jsonb;
begin
  if p_actor is null or p_current is null or public.direct_account_restricted(p_actor) then raise exception 'Not authorized'; end if;
  if not exists(select 1 from public.agents a where a.owner_id=p_current and (a.owner_id=p_actor or exists(select 1 from public.business_managers m where m.business_agent_id=a.id and m.user_id=p_actor))) then raise exception 'Workspace unavailable'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('agentId',a.id,'ownerId',a.owner_id,'handle',a.handle,'displayName',a.display_name,'avatar',a.avatar,'type',a.type,'current',a.owner_id=p_current,'role',m.role,
    'notifications',public.notification_snapshot(a.owner_id,case when a.type='business' then coalesce(m.role,'owner') else null end,p_actor)) order by a.type='business',a.display_name,a.id),'[]') into accounts
  from public.agents a left join public.business_managers m on m.business_agent_id=a.id and m.user_id=p_actor
  where a.owner_id=p_actor or (a.type='business' and m.user_id is not null);
  return jsonb_build_object('actorId',p_actor,'currentId',p_current,'asOf',now(),'accounts',accounts);
end $$;
revoke execute on function public.notification_attention(uuid,text,uuid),public.notification_unread(uuid,text,uuid),public.notification_snapshot(uuid,text,uuid),public.notification_accounts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.notification_accounts(uuid,uuid),public.notification_snapshot(uuid,text,uuid) to service_role;

-- Existing surfaces call the same core as the identity menu.
create or replace function public.unread_counts() returns table(conversation_id uuid,unread bigint,muted boolean)
language sql stable security definer set search_path=public,pg_temp as $$
  select * from public.notification_unread(public.workspace_user_id(),public.workspace_role(),auth.uid()) where public.workspace_session_allowed();
$$;
create or replace function public.action_counts() returns table(contacts bigint,groups bigint,communities bigint)
language sql stable security definer set search_path=public,pg_temp as $$
  select case when public.workspace_role()='staff' then 0 else contacts end,case when public.workspace_role()='staff' then 0 else groups end,case when public.workspace_role()='staff' then 0 else communities end
  from public.notification_action_base(public.workspace_user_id(),public.workspace_role(),auth.uid()) where public.workspace_session_allowed();
$$;
create or replace function public.owner_attention_count() returns bigint language sql stable security definer set search_path=public,pg_temp as $$
  select case when public.workspace_session_allowed() then public.notification_attention(public.workspace_user_id(),public.workspace_role(),auth.uid()) else 0 end;
$$;
create or replace function public.identity_badge(p_user uuid) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
  select (public.notification_snapshot(p_user,case when exists(select 1 from public.agents where owner_id=p_user and type='business') then 'owner' else null end,p_user)->>'total')::bigint;
$$;
create or replace function public.identity_staff_badge(p_user uuid) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
  select (public.notification_snapshot(p_user,'staff',p_user)->>'total')::bigint;
$$;

-- Reading a note must not clear its pending action. Topic badges also avoid
-- counting the linked audit note as another unread question.
do $$ declare d text; begin
  d:=pg_get_functiondef('public.my_agent_topic_page(uuid,text,timestamptz,uuid,text,timestamptz)'::regprocedure);
  d:=replace(d,'and not exists(select 1 from public.message_views v where v.message_id=m.id',
    'and not exists(select 1 from public.inbox_items i where i.owner_id=public.workspace_user_id() and i.id::text=m.metadata->>''inbox_item_id'') and not exists(select 1 from public.message_views v where v.message_id=m.id');
  execute d;
end $$;
