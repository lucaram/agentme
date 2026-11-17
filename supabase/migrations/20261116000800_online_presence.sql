-- Presence payloads live only in Realtime, never in a public last-seen table.
-- Private channel generations change whenever an audience or status changes.
-- This retires channels whose join-time authorization could otherwise be cached.
create table public.presence_preferences (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  visibility text not null default 'contacts' check(visibility in ('contacts','customers','nobody')),
  mode text not null default 'auto' check(mode in ('auto','busy','away','invisible')),
  mode_until timestamptz,
  generation uuid not null default gen_random_uuid()
);
alter table public.presence_preferences enable row level security;
revoke all on public.presence_preferences from public,anon,authenticated;
grant select on public.presence_preferences to authenticated;
grant all on public.presence_preferences to service_role;
create policy own_presence_preferences on public.presence_preferences for select to authenticated using(agent_id=public.my_agent_id() and not public.account_is_restricted(auth.uid()));
alter publication supabase_realtime add table public.presence_preferences;
insert into public.presence_preferences(agent_id,visibility) select id,case when type='business' then 'nobody' else 'contacts' end from public.agents;

create function public.initialize_presence() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.presence_preferences(agent_id,visibility) values(new.id,case when new.type='business' then 'nobody' else 'contacts' end);
  return new;
end $$;
create trigger initialize_presence after insert on public.agents for each row execute function public.initialize_presence();

-- A valid JWT whose login has been logged out/revoked is not an active session.
create function public.presence_session_valid() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and not public.account_is_restricted(auth.uid()) and exists(
    select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after>now())
  );
$$;
create function public.can_view_presence(p_agent uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.presence_session_valid() and exists(
    select 1 from public.agents a join public.presence_preferences p on p.agent_id=a.id
    where a.id=p_agent and not public.account_is_restricted(a.owner_id) and (
      a.owner_id=auth.uid() or (
        not exists(select 1 from public.contacts c where c.status='blocked' and
          ((c.requester_agent=public.my_agent_id() and c.addressee_agent=a.id) or (c.addressee_agent=public.my_agent_id() and c.requester_agent=a.id)))
        and ((a.type='business' and p.visibility='customers') or (a.type='personal' and p.visibility='contacts' and exists(
          select 1 from public.contacts c where c.status='accepted' and
            ((c.requester_agent=public.my_agent_id() and c.addressee_agent=a.id) or (c.addressee_agent=public.my_agent_id() and c.requester_agent=a.id))
        )))
      )
    )
  );
$$;

create function public.presence_channels(p_ids uuid[]) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'business',a.type='business','topic','presence:'||a.id::text||':'||p.generation::text)),'[]'::jsonb)
  from public.agents a join public.presence_preferences p on p.agent_id=a.id
  where cardinality(p_ids)<=100 and a.id=any(p_ids) and public.can_view_presence(a.id);
$$;
create function public.presence_self() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare mine uuid:=public.my_agent_id(); result jsonb;
begin
  if not public.presence_session_valid() then return null; end if;
  update public.presence_preferences set mode='auto',mode_until=null,generation=gen_random_uuid()
    where agent_id=mine and mode_until<=now();
  select jsonb_build_object('id',a.id,'business',a.type='business','mode',p.mode,'until',p.mode_until,'visibility',p.visibility,
    'topic','presence:'||a.id::text||':'||p.generation::text) into result
    from public.presence_preferences p join public.agents a on a.id=p.agent_id where p.agent_id=mine;
  return result;
end $$;
create function public.set_presence_mode(p_mode text,p_minutes integer default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.presence_session_valid() then raise exception 'Not authorized'; end if;
  if p_mode not in ('auto','busy','away','invisible') or p_mode is null or (p_minutes is not null and p_minutes not in (60,240)) then raise exception 'Invalid status'; end if;
  update public.presence_preferences set mode=p_mode,mode_until=case when p_mode='busy' and p_minutes is not null then now()+make_interval(mins=>p_minutes) else null end,
    generation=gen_random_uuid() where agent_id=public.my_agent_id();
end $$;
create function public.set_presence_visibility(p_visibility text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare business boolean;
begin
  if not public.presence_session_valid() then raise exception 'Not authorized'; end if;
  select type='business' into business from public.agents where id=public.my_agent_id();
  if p_visibility is null or not (p_visibility='nobody' or (business and p_visibility='customers') or (not business and p_visibility='contacts')) then raise exception 'Invalid visibility'; end if;
  update public.presence_preferences set visibility=p_visibility,generation=gen_random_uuid() where agent_id=public.my_agent_id() and visibility<>p_visibility;
end $$;

-- Revoke old channel audiences when contacts are removed or either side blocks.
create function public.rotate_contact_presence() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.presence_preferences set generation=gen_random_uuid() where agent_id in
    (coalesce(new.requester_agent,old.requester_agent),coalesce(new.addressee_agent,old.addressee_agent));
  return null;
end $$;
create trigger rotate_contact_presence after insert or update or delete on public.contacts for each row execute function public.rotate_contact_presence();

create function public.presence_channel_access(p_topic text,p_write boolean) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.presence_session_valid() and exists(
    select 1 from public.presence_preferences p join public.agents a on a.id=p.agent_id
    where p_topic='presence:'||a.id::text||':'||p.generation::text and
      case when p_write then a.owner_id=auth.uid() else public.can_view_presence(a.id) end
  );
$$;
create policy private_presence_read on realtime.messages for select to authenticated using(extension='presence' and public.presence_channel_access(realtime.topic(),false));
create policy private_presence_write on realtime.messages for insert to authenticated with check(extension='presence' and public.presence_channel_access(realtime.topic(),true));

revoke execute on function public.initialize_presence(),public.rotate_contact_presence() from public,anon,authenticated;
revoke execute on function public.presence_session_valid(),public.can_view_presence(uuid),public.presence_channels(uuid[]),public.presence_self(),public.set_presence_mode(text,integer),public.set_presence_visibility(text),public.presence_channel_access(text,boolean) from public,anon;
grant execute on function public.presence_session_valid(),public.can_view_presence(uuid),public.presence_channels(uuid[]),public.presence_self(),public.set_presence_mode(text,integer),public.set_presence_visibility(text),public.presence_channel_access(text,boolean) to authenticated;
