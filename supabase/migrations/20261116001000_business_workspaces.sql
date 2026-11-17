-- Business work keeps the person's own Auth principal. A work JWT can therefore
-- change only that person's Auth credentials, never the business owner's.
alter table public.business_managers drop constraint business_managers_role_check;
alter table public.business_managers add constraint business_managers_role_check check(role in ('owner','manager','staff'));
create table public.business_work_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  person_user uuid not null references auth.users(id) on delete cascade,
  business_agent_id uuid not null references public.agents(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index business_work_sessions_member on public.business_work_sessions(business_agent_id,person_user);
alter table public.business_work_sessions enable row level security;
revoke all on public.business_work_sessions from public,anon,authenticated;
grant all on public.business_work_sessions to service_role;

-- Retire the older impersonated business sessions. Personal and direct owner
-- logins are retained. Former business sessions cannot become owner sessions.
delete from auth.sessions where id in (select session_id from public.managed_identity_sessions);

create function public.workspace_user_id() returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $$
declare principal uuid:=auth.uid(); target uuid; business_owner uuid;
begin
  if principal is null then return null; end if;
  if not exists(select 1 from auth.sessions s where s.user_id=principal and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now())) then return null; end if;
  if public.direct_account_restricted(principal) then return null; end if;
  select business_agent_id into target from public.business_work_sessions where person_user=principal and session_id::text=auth.jwt()->>'session_id';
  if target is not null then
    select a.owner_id into business_owner from public.agents a join public.business_managers m on m.business_agent_id=a.id and m.user_id=principal where a.id=target and a.type='business';
    return business_owner;
  end if;
  -- Internal business accounts no longer have a human login.
  if exists(select 1 from auth.users where id=principal and email like '%@business.agentme.app') then return null; end if;
  if exists(select 1 from public.agents where owner_id=principal and type='business') and
     exists(select 1 from public.business_managers where business_agent_id=(select id from public.agents where owner_id=principal)) and
     not exists(select 1 from public.business_managers where business_agent_id=(select id from public.agents where owner_id=principal) and user_id=principal) then return null; end if;
  return principal;
end $$;
create function public.workspace_role() returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare effective uuid:=public.workspace_user_id(); target uuid; role_name text;
begin
  select id into target from public.agents where owner_id=effective and type='business';
  if target is null then return null; end if;
  select role into role_name from public.business_managers where business_agent_id=target and user_id=auth.uid();
  -- Preserve older direct business accounts and isolated fixtures without a
  -- manager row. Once memberships exist there is no implicit owner fallback.
  if role_name is null and effective=auth.uid() and not exists(select 1 from public.business_managers where business_agent_id=target) then return 'owner'; end if;
  return role_name;
end $$;
create function public.workspace_session_allowed() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is null or public.workspace_user_id() is not null;
$$;
create function public.workspace_context() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('user_id',public.workspace_user_id(),'actor_id',auth.uid(),'role',public.workspace_role(),
    'working',exists(select 1 from public.business_work_sessions where person_user=auth.uid() and session_id::text=auth.jwt()->>'session_id'));
$$;
revoke execute on function public.workspace_user_id(),public.workspace_role(),public.workspace_session_allowed(),public.workspace_context() from public,anon;
grant execute on function public.workspace_user_id(),public.workspace_role(),public.workspace_session_allowed(),public.workspace_context() to authenticated;

-- Existing chat/inbox/task rows remain owned by the business identity. Adapt
-- their tenant checks to the selected workspace, while Auth retains the human.
do $$ declare f record; policy_row record; definition text; statement text; begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and position('auth.uid()' in p.prosrc)>0
      and p.proname not in ('workspace_user_id','workspace_role','workspace_session_allowed','workspace_context','presence_session_valid','account_is_restricted','guard_restricted_caller')
  loop
    definition:=pg_get_functiondef(f.oid);
    execute replace(definition,'auth.uid()','public.workspace_user_id()');
  end loop;
  for policy_row in select * from pg_policies where schemaname in ('public','storage') and (position('auth.uid()' in coalesce(qual,''))>0 or position('auth.uid()' in coalesce(with_check,''))>0)
  loop
    statement:=format('alter policy %I on %I.%I',policy_row.policyname,policy_row.schemaname,policy_row.tablename);
    if policy_row.qual is not null then statement:=statement||' using ('||replace(policy_row.qual,'auth.uid()','public.workspace_user_id()')||')'; end if;
    if policy_row.with_check is not null then statement:=statement||' with check ('||replace(policy_row.with_check,'auth.uid()','public.workspace_user_id()')||')'; end if;
    execute statement;
  end loop;
end $$;

create or replace function public.account_is_restricted(p_user uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.direct_account_restricted(p_user) or exists(
    select 1 from public.agents a where a.owner_id=p_user and a.type='business'
      and exists(select 1 from public.business_managers bm where bm.business_agent_id=a.id and bm.role='owner')
      and not exists(select 1 from public.business_managers bm where bm.business_agent_id=a.id and bm.role='owner' and not public.direct_account_restricted(bm.user_id))
  );
$$;
create or replace function public.presence_session_valid() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.workspace_user_id() is not null and not public.account_is_restricted(public.workspace_user_id());
$$;

-- A removed work session and a revoked login lose every database/storage path,
-- including queries whose older permissive policies do not inspect a user id.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('create policy workspace_session_guard on public.%I as restrictive for all to authenticated using(public.workspace_session_allowed()) with check(public.workspace_session_allowed())',t.tablename);
  end loop;
end $$;
create policy workspace_session_guard on storage.objects as restrictive for all to authenticated using(public.workspace_session_allowed()) with check(public.workspace_session_allowed());

create function public.business_permission(p_permission text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select case public.workspace_role() when 'owner' then true when 'manager' then p_permission in ('read','respond','configure','staff','draft','presence') when 'staff' then p_permission in ('read','respond','draft','presence') else false end;
$$;
revoke execute on function public.business_permission(text) from public,anon;
grant execute on function public.business_permission(text) to authenticated;

-- Direct browser writes and security-definer RPC mutations obey the same role
-- limits. Server service-role mutations additionally check the human's role.
create or replace function public.guard_restricted_caller() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_role text;
begin
  if auth.uid() is not null then
    if not public.workspace_session_allowed() or public.account_is_restricted(public.workspace_user_id()) then raise exception 'This workspace is unavailable.'; end if;
    actor_role:=public.workspace_role();
    if actor_role='staff' and tg_table_name not in (
      'messages','message_reactions','message_reaction_versions','message_receipts','message_receipt_versions','message_views','message_receipt_tracking',
      'conversation_members','mention_alerts','mention_versions','business_staff_availability','business_answer_drafts','business_question_claims'
    ) then raise exception 'Your business role does not allow this action.'; end if;
    if tg_table_name='agents' and tg_op='DELETE' and actor_role='manager' then raise exception 'Only an owner can delete a business.'; end if;
    if actor_role='staff' and tg_table_name='conversation_members' and (tg_op<>'UPDATE' or new.role is distinct from old.role or new.user_id is distinct from old.user_id or new.conversation_id is distinct from old.conversation_id or new.history_from is distinct from old.history_from) then raise exception 'Your business role does not allow this action.'; end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;

create table public.business_membership_versions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1
);
alter table public.business_membership_versions enable row level security;
revoke all on public.business_membership_versions from public,anon,authenticated;
grant select on public.business_membership_versions to authenticated;
grant all on public.business_membership_versions to service_role;
create policy own_membership_version on public.business_membership_versions for select to authenticated using(user_id=auth.uid());
alter publication supabase_realtime add table public.business_membership_versions;
create function public.business_membership_changed() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare who uuid:=coalesce(new.user_id,old.user_id); business uuid:=coalesce(new.business_agent_id,old.business_agent_id);
begin
  insert into public.business_membership_versions(user_id) select id from auth.users where id=who on conflict(user_id) do update set revision=public.business_membership_versions.revision+1;
  if tg_op='DELETE' then
    delete from auth.sessions where id in(select session_id from public.business_work_sessions where person_user=who and business_agent_id=business);
  end if;
  update public.presence_preferences set generation=gen_random_uuid() where agent_id=business;
  return null;
end $$;
create trigger business_membership_changed after insert or update or delete on public.business_managers for each row execute function public.business_membership_changed();
revoke execute on function public.business_membership_changed() from public,anon,authenticated;
