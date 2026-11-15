-- Writers and reviewers lock the space before changing its state. This closes join/post races.
create function public.lock_active_space(p_conversation uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare parent uuid;
begin
  select community_id into parent from public.conversations where id=p_conversation;
  if parent is not null then perform 1 from public.communities where id=parent for key share; end if;
  perform 1 from public.conversations where id=p_conversation for key share;
  if public.space_is_suspended(p_conversation) then raise exception 'This space is suspended by AGENTME and is read-only.'; end if;
end $$;
revoke execute on function public.lock_active_space(uuid) from public,anon,authenticated;
create or replace function public.enforce_platform_suspension() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_table_name='messages' then
    if new.sender_user_id is null and new.sender_agent_id is null then return new; end if;
  end if;
  perform public.lock_active_space(new.conversation_id);
  return new;
end $$;
create or replace function public.enforce_activity_suspension() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare conv uuid; step uuid;
begin
  if tg_table_name='message_reactions' then select conversation_id into conv from public.messages where id=new.message_id;
  else
    step:=case when tg_op='DELETE' then old.step_id else new.step_id end;
    select t.group_conversation_id into conv from public.plan_steps s join public.tasks t on t.id=s.task_id where s.id=step;
  end if;
  if conv is not null then perform public.lock_active_space(conv); end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create function public.guard_community_membership() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare paused boolean;
begin
  select platform_suspended into paused from public.communities where id=new.community_id for update;
  if paused then raise exception 'Joining is paused while AGENTME reviews this community.'; end if;
  if exists(select 1 from public.community_bans where community_id=new.community_id and user_id=new.user_id) then raise exception 'You cannot join this community'; end if;
  return new;
end $$;
revoke execute on function public.guard_community_membership() from public,anon,authenticated;
create trigger platform_community_membership before insert on public.community_members for each row execute function public.guard_community_membership();

-- Same parent-before-case order as report submissions.
create or replace function public.review_platform_case(p_case uuid,p_revision bigint,p_action text,p_response text default '',p_note text default '') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.platform_cases; event uuid; message text; target_exists boolean;
begin
  select * into c from public.platform_cases where id=p_case;
  if not found or not public.can_review_platform_target(c.target_kind,c.target_key) then raise exception 'Not allowed'; end if;
  if c.target_kind='group' then perform 1 from public.conversations where id=c.group_id for update;
  else perform 1 from public.communities where id=c.community_id for update; end if;
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
