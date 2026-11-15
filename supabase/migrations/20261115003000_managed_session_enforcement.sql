-- Bind switched business sessions to the person who opened them. Clearing a
-- browser cookie must not turn a restricted manager into an anonymous business.
create table public.managed_identity_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  business_user uuid not null references auth.users(id) on delete cascade,
  person_user uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.managed_identity_sessions enable row level security;
revoke all on public.managed_identity_sessions from public,anon,authenticated;
grant all on public.managed_identity_sessions to service_role;

create or replace function public.account_is_restricted(p_user uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.direct_account_restricted(p_user) or exists(
    select 1 from public.agents a where a.owner_id=p_user and a.type='business'
      and exists(select 1 from public.business_managers bm where bm.business_agent_id=a.id and bm.role='owner')
      and not exists(select 1 from public.business_managers bm where bm.business_agent_id=a.id and bm.role='owner' and not public.direct_account_restricted(bm.user_id))
  ) or (
    auth.uid()=p_user and exists(select 1 from auth.users u where u.id=p_user and u.email like '%@business.agentme.app')
    and not exists(select 1 from public.managed_identity_sessions m
      join public.agents a on a.owner_id=m.business_user
      join public.business_managers bm on bm.business_agent_id=a.id and bm.user_id=m.person_user
      where m.session_id::text=auth.jwt()->>'session_id' and m.business_user=p_user and not public.direct_account_restricted(m.person_user))
  );
$$;

-- Protect direct Supabase writes and security-definer RPCs as well as app routes.
-- Appeals remain available during a restriction. Service workers have no uid;
-- their activity is separately checked against the owning account by migration 026.
create function public.guard_restricted_caller() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is not null and public.account_is_restricted(auth.uid()) then raise exception 'This account is restricted by AGENTME.'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke execute on function public.guard_restricted_caller() from public,anon,authenticated;
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename not in ('platform_account_appeals','platform_account_sanctions','platform_notifications','account_access_versions','managed_identity_sessions') loop
    execute format('create trigger restricted_caller before insert or update or delete on public.%I for each row execute function public.guard_restricted_caller()',t.tablename);
  end loop;
end $$;

create or replace function public.own_account_sanctions(p_offset integer default 0) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
    select s.id,s.subject_name name,s.action,s.justification,s.created_at,s.expires_at,s.revoked_at,s.revoke_reason,
      case when s.revoked_at is not null then 'lifted' when s.expires_at<=now() then 'expired' else 'active' end restriction_status,
      case when a.id is not null then jsonb_build_object('id',a.id,'reason',a.reason,'status',a.status,'created_at',a.created_at,'response',a.response,'reviewed_at',a.reviewed_at) end appeal
    from public.platform_account_sanctions s left join public.platform_account_appeals a on a.sanction_id=s.id
    where s.user_key=auth.uid() and p_offset between 0 and 10000 order by s.created_at desc,s.id desc limit 26 offset greatest(0,least(p_offset,10000))
  ) x;
$$;
create function public.refresh_appeal_case() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status is distinct from old.status then
    update public.platform_cases set revision=revision+1,updated_at=now() where id=(select case_id from public.platform_account_sanctions where id=new.sanction_id);
  end if;
  return new;
end $$;
revoke execute on function public.refresh_appeal_case() from public,anon,authenticated;
create trigger appeal_case_update after update on public.platform_account_appeals for each row execute function public.refresh_appeal_case();
