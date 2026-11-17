create table public.message_mentions (
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  handle text not null,
  primary key(message_id,user_id)
);
create table public.mention_alerts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  notified_at timestamptz,
  primary key(message_id,user_id)
);
create index mention_unread on public.mention_alerts(user_id,created_at) where seen_at is null;
create table public.mention_preferences (user_id uuid primary key references auth.users(id) on delete cascade, enabled boolean not null default true);
create table public.mention_versions (user_id uuid primary key references auth.users(id) on delete cascade, revision bigint not null default 1);
alter table public.message_mentions enable row level security;
alter table public.mention_alerts enable row level security;
alter table public.mention_preferences enable row level security;
alter table public.mention_versions enable row level security;
revoke all on public.message_mentions,public.mention_alerts,public.mention_preferences,public.mention_versions from anon,authenticated;
grant all on public.message_mentions,public.mention_alerts,public.mention_preferences,public.mention_versions to service_role;
grant select on public.message_mentions,public.mention_alerts,public.mention_preferences,public.mention_versions to authenticated;
grant insert,update on public.mention_preferences to authenticated;
create policy visible_message_mentions on public.message_mentions for select to authenticated using(public.can_read_chat_message(message_id,auth.uid()));
create policy own_mention_alerts on public.mention_alerts for select to authenticated using(user_id=auth.uid() and public.can_read_chat_message(message_id,auth.uid()));
create policy own_mention_preferences on public.mention_preferences for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_mention_version on public.mention_versions for select to authenticated using(user_id=auth.uid());
alter publication supabase_realtime add table public.mention_versions;

create function public.bump_mention_version() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and new.seen_at is not distinct from old.seen_at then return null; end if;
  insert into public.mention_versions(user_id) select id from auth.users where id=coalesce(new.user_id,old.user_id) on conflict(user_id) do update set revision=public.mention_versions.revision+1;
  return null;
end $$;
create trigger mention_version after insert or update or delete on public.mention_alerts for each row execute function public.bump_mention_version();

-- Stable identities are resolved at publication, never from quoted metadata.
create function public.capture_message_mentions() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare body text;
begin
  if new.visible_to is not null or new.removed_at is not null or new.deleted_at is not null then
    delete from public.mention_alerts where message_id=new.id; return null;
  end if;
  if tg_op='UPDATE' then return null; end if;
  if new.sender_user_id is null or new.is_ai_generated or new.metadata ? 'forwarded' or new.metadata->>'kind' in ('agent_command','draft','forwarded_snapshot') then return null; end if;
  if not exists(select 1 from public.conversations where id=new.conversation_id and kind in ('dm','group','channel')) then return null; end if;
  body:=regexp_replace(new.content,'```[\s\S]*?```|`[^`]*`',' ','g');
  body:=regexp_replace(body,'(?n)^>[^\n]*',' ','g');
  insert into public.message_mentions(message_id,conversation_id,user_id,agent_id,handle)
    select distinct new.id,new.conversation_id,a.owner_id,a.id,a.handle
    from regexp_matches(body,'(^|[^[:alnum:]_@])@([a-zA-Z0-9_]{3,20})(?![a-zA-Z0-9_])','g') h
    join public.agents a on a.handle=lower(h[2]) and a.type='personal' and a.handle<>'agent'
    join public.conversation_members cm on cm.conversation_id=new.conversation_id and cm.user_id=a.owner_id
    where public.can_read_chat_message(new.id,a.owner_id)
    on conflict do nothing;
  insert into public.mention_alerts(message_id,user_id,conversation_id)
    select message_id,user_id,conversation_id from public.message_mentions where message_id=new.id and user_id<>new.sender_user_id on conflict do nothing;
  return null;
end $$;
create trigger capture_mentions after insert or update of visible_to,removed_at,deleted_at on public.messages for each row execute function public.capture_message_mentions();
create function public.see_message_mentions() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.viewed_at is not null then update public.mention_alerts set seen_at=coalesce(seen_at,now()) where message_id=new.message_id and user_id=new.user_id and seen_at is null; end if;
  return null;
end $$;
create trigger see_mentions after insert or update on public.message_views for each row execute function public.see_message_mentions();
create function public.leave_mention_chat() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin delete from public.mention_alerts where user_id=old.user_id and conversation_id=old.conversation_id; return null; end $$;
create trigger leave_mentions after delete on public.conversation_members for each row execute function public.leave_mention_chat();

-- A single account claims each short-lived banner once, even with several tabs.
create function public.mention_state(p_claim boolean default false) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare chats jsonb; alerts jsonb:='[]'; claimed uuid[]; u uuid:=auth.uid();
begin
  if u is null then raise exception 'Sign in first'; end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into chats from (
    select a.conversation_id,count(*) total,(array_agg(a.message_id order by a.created_at,a.message_id))[1] first_message
    from public.mention_alerts a where a.user_id=u and a.seen_at is null and public.can_read_chat_message(a.message_id,u) and public.is_conversation_member(a.conversation_id)
    group by a.conversation_id order by min(a.created_at) desc limit 200
  ) x;
  if p_claim then
    with pending as (select a.message_id from public.mention_alerts a where a.user_id=u and a.seen_at is null and a.notified_at is null and a.created_at>now()-interval '30 seconds' and public.can_read_chat_message(a.message_id,u) and public.is_conversation_member(a.conversation_id) order by a.created_at,a.message_id limit 20 for update skip locked),
    saved as (update public.mention_alerts a set notified_at=now() from pending p where a.message_id=p.message_id and a.user_id=u returning a.message_id)
    select array_agg(message_id) into claimed from saved;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into alerts from (
      select a.message_id,a.conversation_id,a.created_at,coalesce(sender.display_name,'Someone') sender,coalesce(sender.avatar,'👤') avatar,
        case when c.kind='dm' then coalesce(sender.display_name,'Direct chat') when c.kind='channel' then coalesce(com.name,'Community')||' · '||coalesce(c.title,'Chat') else coalesce(c.title,'Group') end chat_name
      from public.mention_alerts a join public.messages m on m.id=a.message_id join public.conversations c on c.id=a.conversation_id
      join public.conversation_members cm on cm.conversation_id=c.id and cm.user_id=u
      left join public.communities com on com.id=c.community_id
      left join lateral(select display_name,avatar from public.agents where owner_id=m.sender_user_id order by created_at,id limit 1) sender on true
      where a.user_id=u and a.message_id=any(claimed) and not cm.muted and coalesce((select enabled from public.mention_preferences where user_id=u),true)
      order by a.created_at,a.message_id
    ) x;
  end if;
  return jsonb_build_object('chats',chats,'alerts',alerts);
end $$;

create function public.mention_suggestions(p_conversation uuid,p_query text default '') returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c public.conversations; mine uuid;
begin
  select * into c from public.conversations where id=p_conversation and public.is_conversation_member(id);
  if c.id is null or p_query is null or char_length(p_query)>40 then raise exception 'Not allowed'; end if;
  select id into mine from public.agents where owner_id=auth.uid();
  return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select a.id,a.owner_id,a.handle,a.display_name name,a.avatar,a.type,
      exists(select 1 from public.contacts ct where ct.status='accepted' and ((ct.requester_agent=mine and ct.addressee_agent=a.id) or (ct.addressee_agent=mine and ct.requester_agent=a.id))) can_ask
    from public.agents a where a.handle<>'agent' and a.owner_id<>auth.uid() and strpos(lower(a.handle||' '||a.display_name),lower(p_query))>0 and (
      (c.kind in ('dm','group','channel') and a.type='personal' and exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=a.owner_id))
      or (c.kind='my_agent' and (exists(select 1 from public.contacts ct where ct.status='accepted' and ((ct.requester_agent=mine and ct.addressee_agent=a.id) or (ct.addressee_agent=mine and ct.requester_agent=a.id)))
        or exists(select 1 from public.conversations cv where cv.kind='agent_chat' and cv.target_agent=a.id and cv.created_by=auth.uid())))
      or (a.type='business' and ((c.kind='agent_chat' and c.target_agent=a.id) or exists(select 1 from public.business_placements bp where bp.business_agent_id=a.id and bp.status='active' and ((c.kind='group' and bp.conversation_id=c.id) or (c.kind='channel' and bp.community_id=c.community_id)))))
    ) order by a.display_name,a.id limit 8
  ) x);
end $$;
create function public.reserve_agent_handle() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin if lower(new.handle)='agent' and (tg_op='INSERT' or old.handle is distinct from new.handle) then raise exception 'That address is reserved'; end if; return new; end $$;
create trigger reserve_agent_handle before insert or update of handle on public.agents for each row execute function public.reserve_agent_handle();
revoke execute on function public.bump_mention_version(),public.capture_message_mentions(),public.see_message_mentions(),public.leave_mention_chat(),public.reserve_agent_handle() from public,anon,authenticated;
revoke execute on function public.mention_state(boolean),public.mention_suggestions(uuid,text) from public,anon;
grant execute on function public.mention_state(boolean),public.mention_suggestions(uuid,text) to authenticated;
