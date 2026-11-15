create table public.platform_account_sanctions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.platform_cases(id) on delete set null,
  event_id uuid references public.platform_case_events(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  user_key uuid not null,
  subject_name text not null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(action in ('suspend_1m','suspend_3m','ban')),
  justification text not null check(char_length(justification) between 5 and 500),
  evidence_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoke_reason text,
  check((action='ban' and expires_at is null) or (action<>'ban' and expires_at is not null))
);
create index account_sanction_lookup on public.platform_account_sanctions(user_key,created_at desc) where revoked_at is null;
create table public.platform_account_appeals (
  id uuid primary key default gen_random_uuid(),
  sanction_id uuid not null unique references public.platform_account_sanctions(id) on delete cascade,
  user_key uuid not null,
  reason text not null check(char_length(reason) between 1 and 2000),
  status text not null default 'open' check(status in ('open','accepted','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  response text
);
alter table public.platform_account_sanctions enable row level security;
alter table public.platform_account_appeals enable row level security;
revoke all on public.platform_account_sanctions,public.platform_account_appeals from anon,authenticated;
grant all on public.platform_account_sanctions,public.platform_account_appeals to service_role;
grant select on public.platform_account_sanctions,public.platform_account_appeals to authenticated;

-- Expiration is checked on every request/write; it needs no scheduled job.
create function public.direct_account_restricted(p_user uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.platform_account_sanctions where user_key=p_user and revoked_at is null and (expires_at is null or expires_at>now()));
$$;
create function public.account_is_restricted(p_user uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.direct_account_restricted(p_user) or exists(
    select 1 from public.agents a where a.owner_id=p_user and a.type='business'
      and exists(select 1 from public.business_managers bm where bm.business_agent_id=a.id and bm.role='owner')
      and not exists(select 1 from public.business_managers bm where bm.business_agent_id=a.id and bm.role='owner' and not public.direct_account_restricted(bm.user_id))
  );
$$;
revoke execute on function public.direct_account_restricted(uuid),public.account_is_restricted(uuid) from public,anon,authenticated;
grant execute on function public.account_is_restricted(uuid) to service_role;
create function public.account_restriction(p_user uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  select jsonb_build_object('id',s.id,'user_key',s.user_key,'name',s.subject_name,'action',s.action,'justification',s.justification,'created_at',s.created_at,'expires_at',s.expires_at) into result
    from public.platform_account_sanctions s where s.user_key=p_user and s.revoked_at is null and (s.expires_at is null or s.expires_at>now())
    order by (s.action='ban') desc,s.expires_at desc nulls first,s.created_at desc limit 1;
  if result is null and public.account_is_restricted(p_user) then
    result:=jsonb_build_object('id',null,'user_key',p_user,'name','Managed business','action','owner_restricted','justification','This business identity is unavailable while all its owners have account restrictions. Sign in as its owner to view the decision and appeal.','created_at',null,'expires_at',null);
  end if;
  return result;
end $$;
revoke execute on function public.account_restriction(uuid) from public,anon,authenticated;
grant execute on function public.account_restriction(uuid) to service_role;

create or replace function public.is_platform_moderator() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.platform_moderators where user_id=auth.uid() and enabled) and not public.account_is_restricted(auth.uid());
$$;
create or replace function public.is_platform_operator() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.platform_operators where user_id=auth.uid() and enabled) and not public.account_is_restricted(auth.uid());
$$;
create policy account_sanction_private on public.platform_account_sanctions for select to authenticated using(user_key=auth.uid() or exists(select 1 from public.platform_cases c where c.id=case_id and public.can_review_platform_target(c.target_kind,c.target_key)));
create policy account_appeal_private on public.platform_account_appeals for select to authenticated using(user_key=auth.uid() or exists(select 1 from public.platform_account_sanctions s join public.platform_cases c on c.id=s.case_id where s.id=sanction_id and public.can_review_platform_target(c.target_kind,c.target_key)));
alter publication supabase_realtime add table public.platform_account_sanctions,public.platform_account_appeals;

create function public.guard_account_activity() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid; other_user uuid; agent uuid;
begin
  if tg_table_name='messages' then
    u:=new.sender_user_id; agent:=new.sender_agent_id;
  elsif tg_table_name='tasks' then
    if new.status in ('cancelled','failed','completed') then return new; end if;
    u:=new.owner_id;
  elsif tg_table_name='task_exchanges' then
    if new.status in ('failed','refused') then return new; end if;
    select owner_id into u from public.agents where id=new.from_agent;
    select owner_id into other_user from public.agents where id=new.to_agent;
  elsif tg_table_name in ('step_responses','item_claims') then
    agent:=case when tg_op='DELETE' then old.agent_id else new.agent_id end;
  elsif tg_table_name='message_reactions' then
    u:=case when tg_op='DELETE' then old.user_id else new.user_id end;
  elsif tg_table_name='chat_attachments' then u:=new.uploader_id;
  elsif tg_table_name='agents' then u:=new.owner_id;
  else u:=new.user_id;
  end if;
  if u is null and agent is not null then select owner_id into u from public.agents where id=agent; end if;
  -- Cascades and another administrator's housekeeping may remove old participation.
  if tg_op='DELETE' and (auth.uid() is null or auth.uid() is distinct from u) then return old; end if;
  if (u is not null and public.account_is_restricted(u)) or (other_user is not null and public.account_is_restricted(other_user)) then raise exception 'This account is restricted by AGENTME.'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke execute on function public.guard_account_activity() from public,anon,authenticated;
create trigger account_activity before insert on public.messages for each row execute function public.guard_account_activity();
create trigger account_activity before insert or update on public.tasks for each row execute function public.guard_account_activity();
create trigger account_activity before insert or update on public.task_exchanges for each row execute function public.guard_account_activity();
create trigger account_activity before insert or update or delete on public.step_responses for each row execute function public.guard_account_activity();
create trigger account_activity before insert or update or delete on public.item_claims for each row execute function public.guard_account_activity();
create trigger account_activity before insert or update or delete on public.message_reactions for each row execute function public.guard_account_activity();
create trigger account_activity before insert on public.chat_attachments for each row execute function public.guard_account_activity();
create trigger account_activity before insert on public.conversation_members for each row execute function public.guard_account_activity();
create trigger account_activity before insert on public.community_members for each row execute function public.guard_account_activity();
create trigger account_activity before insert on public.join_requests for each row execute function public.guard_account_activity();
create trigger account_activity before insert or update on public.agents for each row execute function public.guard_account_activity();
