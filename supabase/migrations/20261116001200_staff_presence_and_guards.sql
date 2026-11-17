-- Restricted people retain an identity for the decision/appeal screen, while
-- ordinary workspace data and mutations remain inaccessible.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.workspace_user_id()'::regprocedure);
  execute replace(definition,'if public.direct_account_restricted(principal) then return null; end if;','');
end $$;
create or replace function public.workspace_session_allowed() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is null or (public.workspace_user_id() is not null and not public.direct_account_restricted(auth.uid()) and not public.account_is_restricted(public.workspace_user_id()));
$$;
do $$ declare t text; begin
  foreach t in array array['platform_account_sanctions','platform_account_appeals','platform_notifications','account_access_versions'] loop
    execute format('alter policy workspace_session_guard on public.%I using(public.workspace_user_id() is not null) with check(public.workspace_user_id() is not null)',t);
  end loop;
end $$;
create or replace function public.business_permission(p_permission text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.workspace_session_allowed() and case public.workspace_role() when 'owner' then true when 'manager' then p_permission in ('read','respond','configure','staff','draft','presence') when 'staff' then p_permission in ('read','respond','draft','presence') else false end;
$$;

-- An outstanding invitation never survives the inviter losing that authority.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.respond_business_invite(uuid,boolean)'::regprocedure);
  execute replace(definition,'if inviter_role not in','if inviter_role is null or inviter_role not in');
end $$;

create table public.business_queue_versions(agent_id uuid primary key references public.agents(id) on delete cascade,revision bigint not null default 1);
alter table public.business_queue_versions enable row level security;
revoke all on public.business_queue_versions from public,anon,authenticated;
grant select on public.business_queue_versions to authenticated;
grant all on public.business_queue_versions to service_role;
create policy business_queue_versions_read on public.business_queue_versions for select to authenticated using(agent_id=public.my_agent_id() and public.business_permission('read'));
alter publication supabase_realtime drop table public.business_question_claims,public.business_answer_drafts;
alter publication supabase_realtime add table public.business_queue_versions;
create function public.business_queue_changed() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.business_queue_versions(agent_id) values(coalesce(new.business_agent_id,old.business_agent_id)) on conflict(agent_id) do update set revision=public.business_queue_versions.revision+1;
  return null;
end $$;
create trigger business_claims_changed after insert or update or delete on public.business_question_claims for each row execute function public.business_queue_changed();
create trigger business_drafts_changed after insert or update or delete on public.business_answer_drafts for each row execute function public.business_queue_changed();
revoke execute on function public.business_queue_changed() from public,anon,authenticated;

create or replace function public.reserve_business_answer(p_item uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare ticket uuid:=gen_random_uuid(); claim public.business_question_claims; business uuid:=public.my_agent_id();
begin
  if not public.business_permission('respond') or not exists(select 1 from public.inbox_items where id=p_item and owner_id=public.workspace_user_id() and status='open' and kind='question' and payload->>'business'='true') then raise exception 'Question unavailable'; end if;
  insert into public.business_question_claims(inbox_id,business_agent_id) values(p_item,business) on conflict do nothing;
  select * into claim from public.business_question_claims where inbox_id=p_item for update;
  if claim.assigned_to is not null and claim.assigned_to<>auth.uid() then raise exception 'Claim or reassign this request before answering'; end if;
  if claim.processing_until>now() then raise exception 'An answer is already being sent'; end if;
  update public.business_question_claims set assigned_to=auth.uid(),assigned_name=public.business_actor_name(auth.uid()),claimed_at=coalesce(claimed_at,now()),processing_token=ticket,processing_until=now()+interval '2 minutes' where inbox_id=p_item;
  return ticket;
end $$;

create or replace function public.presence_self() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare mine uuid:=public.my_agent_id(); result jsonb; is_business boolean;
begin
  if not public.presence_session_valid() then return null; end if;
  select type='business' into is_business from public.agents where id=mine;
  if is_business then
    -- A legacy direct owner may not have had a roster yet.
    if public.workspace_role()='owner' and not exists(select 1 from public.business_managers where business_agent_id=mine) then
      insert into public.business_managers(business_agent_id,user_id,role) values(mine,auth.uid(),'owner');
    end if;
    update public.business_staff_availability set mode='auto',mode_until=null where business_agent_id=mine and user_id=auth.uid() and mode_until<=now();
    if found then update public.presence_preferences set generation=gen_random_uuid() where agent_id=mine; end if;
    select jsonb_build_object('id',a.id,'business',true,'mode',w.mode,'until',w.mode_until,'visibility',p.visibility,'participating',w.participating,
      'topic','presence:'||a.id::text||':'||p.generation::text,'staffTopic','staff-presence:'||a.id::text||':'||auth.uid()::text||':'||p.generation::text) into result
      from public.presence_preferences p join public.agents a on a.id=p.agent_id join public.business_staff_availability w on w.business_agent_id=a.id and w.user_id=auth.uid() where p.agent_id=mine;
  else
    update public.presence_preferences set mode='auto',mode_until=null,generation=gen_random_uuid() where agent_id=mine and mode_until<=now();
    select jsonb_build_object('id',a.id,'business',false,'mode',p.mode,'until',p.mode_until,'visibility',p.visibility,'topic','presence:'||a.id::text||':'||p.generation::text) into result from public.presence_preferences p join public.agents a on a.id=p.agent_id where p.agent_id=mine;
  end if;
  return result;
end $$;
create or replace function public.set_presence_mode(p_mode text,p_minutes integer default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare business boolean;
begin
  if not public.presence_session_valid() then raise exception 'Not authorized'; end if;
  if p_mode not in ('auto','busy','away','invisible') or p_mode is null or (p_minutes is not null and p_minutes not in (60,240)) then raise exception 'Invalid status'; end if;
  select type='business' into business from public.agents where id=public.my_agent_id();
  if business then
    if not public.business_permission('presence') then raise exception 'Not authorized'; end if;
    update public.business_staff_availability set mode=p_mode,mode_until=case when p_mode='busy' and p_minutes is not null then now()+make_interval(mins=>p_minutes) else null end where business_agent_id=public.my_agent_id() and user_id=auth.uid();
    update public.presence_preferences set generation=gen_random_uuid() where agent_id=public.my_agent_id();
  else
    update public.presence_preferences set mode=p_mode,mode_until=case when p_mode='busy' and p_minutes is not null then now()+make_interval(mins=>p_minutes) else null end,generation=gen_random_uuid() where agent_id=public.my_agent_id();
  end if;
end $$;
create function public.set_work_participation(p_available boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.business_permission('presence') or p_available is null then raise exception 'Not authorized'; end if;
  update public.business_staff_availability set participating=p_available where business_agent_id=public.my_agent_id() and user_id=auth.uid();
  update public.presence_preferences set generation=gen_random_uuid() where agent_id=public.my_agent_id();
end $$;
create or replace function public.set_presence_visibility(p_visibility text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare business boolean;
begin
  if not public.presence_session_valid() then raise exception 'Not authorized'; end if;
  select type='business' into business from public.agents where id=public.my_agent_id();
  if business and not public.business_permission('configure') then raise exception 'Only owners and managers change customer visibility'; end if;
  if p_visibility is null or not (p_visibility='nobody' or (business and p_visibility='customers') or (not business and p_visibility='contacts')) then raise exception 'Invalid visibility'; end if;
  update public.presence_preferences set visibility=p_visibility,generation=gen_random_uuid() where agent_id=public.my_agent_id() and visibility<>p_visibility;
end $$;
create or replace function public.presence_channel_access(p_topic text,p_write boolean) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.presence_session_valid() and (
    exists(select 1 from public.presence_preferences p join public.agents a on a.id=p.agent_id
      where p_topic='presence:'||a.id::text||':'||p.generation::text and case when p_write then
        a.owner_id=public.workspace_user_id() and case when a.type='business' then exists(select 1 from public.business_staff_availability w where w.business_agent_id=a.id and w.user_id=auth.uid() and w.participating and w.mode<>'invisible') else p.mode<>'invisible' end
        else public.can_view_presence(a.id) end)
    or exists(select 1 from public.presence_preferences p join public.business_staff_availability w on w.business_agent_id=p.agent_id
      where p_topic='staff-presence:'||p.agent_id::text||':'||w.user_id::text||':'||p.generation::text and p.agent_id=public.my_agent_id() and public.business_permission('read')
      and (not p_write or (w.user_id=auth.uid() and w.participating and w.mode<>'invisible')))
  );
$$;
revoke execute on function public.set_work_participation(boolean) from public,anon;
grant execute on function public.set_work_participation(boolean) to authenticated;

create function public.active_staff_invitation(p_item uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.inbox_items i join public.business_staff_invites v on v.id::text=i.payload->>'invite_id' where i.id=p_item and i.owner_id=public.workspace_user_id() and v.status='pending' and v.expires_at>now());
$$;
revoke execute on function public.active_staff_invitation(uuid) from public,anon;
grant execute on function public.active_staff_invitation(uuid) to authenticated;
create or replace function public.open_owner_requests(p_kinds text[] default null,p_exclude uuid[] default '{}') returns setof public.inbox_items language sql stable security invoker set search_path=public,pg_temp as $$
  select i.* from public.inbox_items i where i.owner_id=public.workspace_user_id() and i.status='open'
    and (p_kinds is null or i.kind=any(p_kinds)) and not(i.id=any(p_exclude))
    and (i.kind<>'group_invite' or public.open_group_invitation(i.id))
    and (i.kind<>'business_invitation' or public.active_staff_invitation(i.id))
    and (i.kind<>'business_answer_review' or public.business_permission('configure')) order by i.created_at,i.id limit 30;
$$;
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.owner_attention_count()'::regprocedure);
  execute replace(definition,'i.kind in (''info_request'',''question'')','(i.kind in (''info_request'',''question'') or (i.kind=''business_invitation'' and public.active_staff_invitation(i.id)) or (i.kind=''business_answer_review'' and public.business_permission(''configure'')))');
end $$;
