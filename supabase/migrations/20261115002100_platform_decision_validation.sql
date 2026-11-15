-- Direct RPC callers must supply a current revision and a public enforcement decision too.
create or replace function public.review_platform_case(p_case uuid,p_revision bigint,p_action text,p_response text default '',p_note text default '') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.platform_cases; event uuid; message text; target_exists boolean;
begin
  p_response:=coalesce(p_response,''); p_note:=coalesce(p_note,'');
  select * into c from public.platform_cases where id=p_case;
  if not found or not public.can_review_platform_target(c.target_kind,c.target_key) then raise exception 'Not allowed'; end if;
  if c.target_kind='group' then perform 1 from public.conversations where id=c.group_id for update;
  else perform 1 from public.communities where id=c.community_id for update; end if;
  select * into c from public.platform_cases where id=p_case for update;
  if not found or not public.can_review_platform_target(c.target_kind,c.target_key) then raise exception 'Not allowed'; end if;
  if c.revision is distinct from p_revision then raise exception 'This case changed. Refresh before deciding.'; end if;
  if p_action is null or p_action not in ('review','dismiss','warn','suspend','restore') or char_length(p_note)>2000 or char_length(p_response)>500 or (p_action<>'review' and char_length(btrim(p_response))<5) then raise exception 'Add a short decision for the people affected'; end if;
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
