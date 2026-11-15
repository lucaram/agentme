-- Platform operators manage staff; reviewers cannot appoint other reviewers.
-- Initial operators are provisioned by the deployment operator, never by public signup.
create table public.platform_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  granted_at timestamptz not null default now()
);
create table public.platform_staff_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  target_id uuid references auth.users(id) on delete set null,
  target_email text not null,
  action text not null check(action in ('grant','revoke')),
  created_at timestamptz not null default now()
);
alter table public.platform_operators enable row level security;
alter table public.platform_staff_events enable row level security;
revoke all on public.platform_operators,public.platform_staff_events from anon,authenticated;
grant all on public.platform_operators,public.platform_staff_events to service_role;
grant select on public.platform_operators,public.platform_staff_events to authenticated;
create function public.is_platform_operator() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.platform_operators where user_id=auth.uid() and enabled);
$$;
revoke execute on function public.is_platform_operator() from public,anon;
grant execute on function public.is_platform_operator() to authenticated;
create policy own_operator_role on public.platform_operators for select to authenticated using(user_id=auth.uid());
create policy operator_staff_audit on public.platform_staff_events for select to authenticated using(public.is_platform_operator());
alter publication supabase_realtime add table public.platform_operators,public.platform_staff_events;
create trigger platform_operator_agent_home after insert or update of enabled on public.platform_operators for each row execute function public.ensure_moderation_agent_home();

create function public.platform_staff_directory(p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.is_platform_operator() or p_offset is null or p_offset not between 0 and 10000 then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
    select m.user_id,u.email,a.display_name,m.enabled,m.granted_at,
      exists(select 1 from public.platform_operators o where o.user_id=m.user_id and o.enabled) is_operator,
      a.id is not null onboarded
    from public.platform_moderators m join auth.users u on u.id=m.user_id
    left join lateral(select id,display_name from public.agents where owner_id=m.user_id order by created_at,id limit 1) a on true
    order by m.enabled desc,m.granted_at desc,m.user_id limit 26 offset p_offset
  ) x);
end $$;
revoke execute on function public.platform_staff_directory(integer) from public,anon;
grant execute on function public.platform_staff_directory(integer) to authenticated;

create function public.set_platform_reviewer(p_enabled boolean,p_email text default null,p_user uuid default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target_id uuid; target_email text; previous boolean; had_role boolean;
begin
  -- Serialize permission checks and role changes. Direct table writes remain unavailable.
  perform pg_advisory_xact_lock(hashtextextended('platform-staff-management',0));
  if not public.is_platform_operator() then raise exception 'Not allowed'; end if;
  if p_enabled is null or (p_enabled and (p_email is null or char_length(btrim(p_email)) not between 3 and 254 or p_user is not null))
    or (not p_enabled and (p_user is null or p_email is not null)) then raise exception 'Invalid staff account'; end if;
  select u.id,u.email into target_id,target_email from auth.users u
    where case when p_enabled then lower(u.email)=lower(btrim(p_email)) else u.id=p_user end
      and (not p_enabled or (u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
        and not exists(select 1 from public.agents a where a.owner_id=u.id and (a.guest or a.type<>'personal'))))
    for update;
  if target_id is null then raise exception 'Use a registered, verified personal account'; end if;
  if not p_enabled and public.is_platform_operator() and exists(select 1 from public.platform_operators where user_id=target_id and enabled) then raise exception 'Operator accounts are protected'; end if;
  select enabled into previous from public.platform_moderators where user_id=target_id for update; had_role:=found;
  if (had_role and previous=p_enabled) or (not had_role and not p_enabled) then return jsonb_build_object('changed',false,'email',target_email); end if;
  insert into public.platform_moderators(user_id,enabled) values(target_id,p_enabled)
    on conflict(user_id) do update set enabled=excluded.enabled,granted_at=case when excluded.enabled then now() else public.platform_moderators.granted_at end;
  insert into public.platform_staff_events(actor_id,target_id,target_email,action) values(auth.uid(),target_id,target_email,case when p_enabled then 'grant' else 'revoke' end);
  insert into public.platform_notifications(user_id,text,link) values(target_id,
    case when p_enabled then 'Your platform reviewer access was enabled. Open Platform moderation in Settings to review reports.' else 'Your platform reviewer access was removed.' end,
    case when p_enabled then '/moderation' else '/settings' end);
  return jsonb_build_object('changed',true,'email',target_email);
end $$;
revoke execute on function public.set_platform_reviewer(boolean,text,uuid) from public,anon;
grant execute on function public.set_platform_reviewer(boolean,text,uuid) to authenticated;
