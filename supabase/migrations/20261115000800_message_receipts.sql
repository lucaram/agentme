-- Receipt timestamps are database acknowledgements, never inferred from page renders.
create table public.receipt_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true
);
create table public.message_views (
  message_id uuid references public.messages(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  viewed_at timestamptz,
  primary key(message_id,user_id)
);
create table public.message_receipt_tracking (
  message_id uuid primary key references public.messages(id) on delete cascade,
  kind text not null check(kind in ('people','agent')),
  agent_id uuid references public.agents(id) on delete set null,
  received_at timestamptz,
  a2a_task_id text,
  inbox_id uuid references public.inbox_items(id) on delete set null,
  owner_seen_at timestamptz,
  started_at timestamptz not null default now()
);
create index receipt_tracking_task on public.message_receipt_tracking(a2a_task_id);
create index receipt_tracking_inbox on public.message_receipt_tracking(inbox_id);
create table public.message_receipts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  delivered_at timestamptz,
  seen_at timestamptz,
  unique(message_id,user_id)
);
create index receipt_pending_user on public.message_receipts(user_id,message_id) where delivered_at is null;
create table public.message_receipt_versions (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  revision bigint not null default 1
);
alter table public.receipt_preferences enable row level security;
alter table public.message_views enable row level security;
alter table public.message_receipt_tracking enable row level security;
alter table public.message_receipts enable row level security;
alter table public.message_receipt_versions enable row level security;
revoke all on public.receipt_preferences,public.message_views,public.message_receipt_tracking,public.message_receipts,public.message_receipt_versions from anon,authenticated;
grant all on public.receipt_preferences,public.message_views,public.message_receipt_tracking,public.message_receipts,public.message_receipt_versions to service_role;
grant select on public.receipt_preferences,public.message_views,public.message_receipt_versions to authenticated;
create policy own_receipt_preferences on public.receipt_preferences for select to authenticated using(user_id=auth.uid());
create policy own_message_views on public.message_views for select to authenticated using(user_id=auth.uid());
create policy receipt_versions_read on public.message_receipt_versions for select to authenticated using(public.is_conversation_member(conversation_id));

create function public.bump_receipt_version(p_conversation uuid) returns void language sql security definer set search_path=public,pg_temp as $$
  insert into public.message_receipt_versions(conversation_id) values(p_conversation)
  on conflict(conversation_id) do update set revision=public.message_receipt_versions.revision+1;
$$;
revoke execute on function public.bump_receipt_version(uuid) from public,anon,authenticated;

create function public.capture_message_audience() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.conversations; owner_user uuid; target uuid;
begin
  if new.visible_to is not null or new.removed_at is not null then return new; end if;
  select * into c from public.conversations where id=new.conversation_id;
  owner_user:=new.sender_user_id;
  if owner_user is null and new.sender_agent_id is not null then select owner_id into owner_user from public.agents where id=new.sender_agent_id; end if;
  if owner_user is null then return new; end if;
  if c.kind in ('my_agent','agent_chat') then
    if new.sender_user_id is null then return new; end if;
    if c.kind='agent_chat' then target:=c.target_agent;
    else select id into target from public.agents where owner_id=new.sender_user_id limit 1; end if;
    insert into public.message_receipt_tracking(message_id,kind,agent_id) values(new.id,'agent',target);
  else
    insert into public.message_receipt_tracking(message_id,kind) values(new.id,'people');
    insert into public.message_receipts(message_id,user_id)
      select new.id,x.user_id from (
        select cm.user_id from public.conversation_members cm where cm.conversation_id=new.conversation_id
        union
        select i.owner_id from public.inbox_items i where i.kind='group_invite' and i.status='open' and i.payload->>'conversation_id'=new.conversation_id::text
      ) x where x.user_id<>owner_user on conflict do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.capture_message_audience() from public,anon,authenticated;
create trigger messages_capture_audience after insert on public.messages for each row execute function public.capture_message_audience();

create function public.acknowledge_messages(p_ids uuid[],p_seen boolean default false) returns uuid[] language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); m public.messages; enabled boolean; acknowledged uuid[]:='{}'; changed integer; permitted boolean;
begin
  if u is null or coalesce(cardinality(p_ids),0)>100 then raise exception 'Invalid acknowledgement'; end if;
  select allowed into permitted from public.rate_limit_hit('messageReceipts:'||u::text,60,600);
  if not permitted then raise exception 'Too many acknowledgements'; end if;
  select coalesce((select p.enabled from public.receipt_preferences p where p.user_id=u),true) into enabled;
  for m in select * from public.messages where id=any(p_ids) and removed_at is null
    and (visible_to is null or visible_to=u) and sender_user_id is distinct from u
    and (sender_user_id is not null or sender_agent_id is not null)
    and exists(select 1 from public.conversation_members cm where cm.conversation_id=messages.conversation_id and cm.user_id=u)
  loop
    insert into public.message_views(message_id,user_id,viewed_at) values(m.id,u,case when p_seen then now() end)
    on conflict(message_id,user_id) do update set viewed_at=coalesce(public.message_views.viewed_at,excluded.viewed_at)
      where public.message_views.viewed_at is null and p_seen;
    update public.message_receipts set delivered_at=coalesce(delivered_at,now()),
      seen_at=case when p_seen and enabled then coalesce(seen_at,now()) else seen_at end
      where message_id=m.id and user_id=u and (delivered_at is null or (p_seen and enabled and seen_at is null));
    get diagnostics changed=row_count;
    if changed>0 then perform public.bump_receipt_version(m.conversation_id); end if;
    acknowledged:=array_append(acknowledged,m.id);
  end loop;
  return acknowledged;
end $$;
revoke execute on function public.acknowledge_messages(uuid[],boolean) from public,anon;
grant execute on function public.acknowledge_messages(uuid[],boolean) to authenticated;

-- Actual message payloads reach the browser before it acknowledges delivery.
create function public.pending_message_deliveries() returns setof public.messages language sql security definer set search_path=public,pg_temp as $$
  select m.* from public.messages m join public.message_receipts r on r.message_id=m.id and r.user_id=auth.uid() and r.delivered_at is null
  where m.removed_at is null and m.visible_to is null and public.is_conversation_member(m.conversation_id)
  order by m.created_at,m.id limit 100;
$$;
revoke execute on function public.pending_message_deliveries() from public,anon;
grant execute on function public.pending_message_deliveries() to authenticated;

create function public.record_agent_receipt(p_message uuid,p_agent uuid,p_task text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid; changed integer;
begin
  update public.message_receipt_tracking set received_at=coalesce(received_at,now()),a2a_task_id=coalesce(a2a_task_id,p_task)
    where message_id=p_message and kind='agent' and agent_id=p_agent and (received_at is null or (a2a_task_id is null and p_task is not null));
  get diagnostics changed=row_count;
  if changed>0 then select conversation_id into c from public.messages where id=p_message; perform public.bump_receipt_version(c); end if;
end $$;
revoke execute on function public.record_agent_receipt(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_agent_receipt(uuid,uuid,text) to service_role;

-- Only exact direct-business questions are linked. A scoped/rephrased question must not imply the owner read private chat context.
create function public.link_business_receipt(p_inbox uuid) returns void language sql security definer set search_path=public,pg_temp as $$
  update public.message_receipt_tracking t set inbox_id=i.id
  from public.inbox_items i,public.task_exchanges e,public.messages m,public.conversations c,public.agents a
  where i.id=p_inbox and i.exchange_id=e.id and t.a2a_task_id=e.a2a_task_id::text and t.agent_id=i.agent_id
    and m.id=t.message_id and c.id=m.conversation_id and c.kind='agent_chat' and c.target_agent=t.agent_id
    and a.id=t.agent_id and a.owner_id=i.owner_id and i.payload->>'business'='true'
    and lower(regexp_replace(btrim(m.content),'\s+',' ','g'))=lower(regexp_replace(btrim(i.payload->>'question'),'\s+',' ','g'));
$$;
revoke execute on function public.link_business_receipt(uuid) from public,anon,authenticated;
grant execute on function public.link_business_receipt(uuid) to service_role;

create function public.acknowledge_business_question(p_inbox uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); item public.inbox_items; message_conversation uuid; changed boolean:=false;
begin
  select * into item from public.inbox_items where id=p_inbox and owner_id=u and kind='question' and payload->>'business'='true';
  if not found then return false; end if;
  if not coalesce((select enabled from public.receipt_preferences where user_id=u),true) then return true; end if;
  for message_conversation in
    with updated as (update public.message_receipt_tracking set owner_seen_at=now() where inbox_id=p_inbox and owner_seen_at is null returning message_id)
    select distinct m.conversation_id from updated join public.messages m on m.id=updated.message_id where m.removed_at is null
  loop perform public.bump_receipt_version(message_conversation); changed:=true; end loop;
  return true;
end $$;
revoke execute on function public.acknowledge_business_question(uuid) from public,anon;
grant execute on function public.acknowledge_business_question(uuid) to authenticated;

create function public.set_read_receipts(p_enabled boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); c uuid;
begin
  if u is null or p_enabled is null then raise exception 'Sign in first'; end if;
  insert into public.receipt_preferences(user_id,enabled) values(u,p_enabled) on conflict(user_id) do update set enabled=excluded.enabled;
  if not p_enabled then
    update public.message_receipts set seen_at=null where user_id=u;
    update public.message_receipt_tracking t set owner_seen_at=null from public.agents a where t.agent_id=a.id and a.owner_id=u;
  end if;
  for c in select distinct m.conversation_id from public.messages m where m.id in (
    select message_id from public.message_receipts where user_id=u
    union select t.message_id from public.message_receipt_tracking t join public.agents a on a.id=t.agent_id where a.owner_id=u)
  loop perform public.bump_receipt_version(c); end loop;
end $$;
revoke execute on function public.set_read_receipts(boolean) from public,anon;
grant execute on function public.set_read_receipts(boolean) to authenticated;

create function public.get_message_receipts(p_ids uuid[],p_details boolean default false) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or coalesce(cardinality(p_ids),0)>2000 or (p_details and cardinality(p_ids)<>1) then raise exception 'Invalid receipt request'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'message_id',m.id,'sent_at',m.created_at,'kind',coalesce(t.kind,'untracked'),'group',c.kind in ('group','channel'),
    'total',stats.total,'delivered',stats.delivered,'seen',stats.seen,
    'agent_name',a.display_name,'agent_business',coalesce(a.type='business',false),'agent_received_at',t.received_at,
    'owner_seen_at',case when coalesce(p.enabled,true) then t.owner_seen_at end,
    'owner_seen_shared',coalesce(p.enabled,true),
    'recipients',case when p_details then (select coalesce(jsonb_agg(jsonb_build_object(
      'name',coalesce(person.display_name,'Former member'),'user_id',r.user_id,'delivered_at',r.delivered_at,
      'seen_at',case when coalesce(rp.enabled,true) then r.seen_at end,'seen_shared',coalesce(rp.enabled,true)) order by r.id),'[]'::jsonb)
      from public.message_receipts r left join public.agents person on person.owner_id=r.user_id left join public.receipt_preferences rp on rp.user_id=r.user_id where r.message_id=m.id) else '[]'::jsonb end
  )),'[]'::jsonb) into result
  from public.messages m join public.conversations c on c.id=m.conversation_id
  left join public.agents sender on sender.id=m.sender_agent_id
  left join public.message_receipt_tracking t on t.message_id=m.id
  left join public.agents a on a.id=t.agent_id
  left join public.receipt_preferences p on p.user_id=a.owner_id
  cross join lateral (select count(*)::integer as total,count(r.delivered_at)::integer as delivered,
    count(*) filter(where r.seen_at is not null and coalesce(rp.enabled,true))::integer as seen
    from public.message_receipts r left join public.receipt_preferences rp on rp.user_id=r.user_id where r.message_id=m.id) stats
  where m.id=any(p_ids) and coalesce(m.sender_user_id,sender.owner_id)=auth.uid() and public.is_conversation_member(m.conversation_id)
    and m.visible_to is null and m.removed_at is null;
  return result;
end $$;
revoke execute on function public.get_message_receipts(uuid[],boolean) from public,anon;
grant execute on function public.get_message_receipts(uuid[],boolean) to authenticated;

-- Preserve the pre-rollout unread baseline, then exclude only individually viewed messages.
create or replace function public.unread_counts() returns table(conversation_id uuid,unread bigint,muted boolean)
language sql stable security invoker set search_path=public as $$
  select t.conversation_id,max(t.n)::bigint,bool_or(t.muted) from (
    select m.conversation_id,count(*) as n,bool_or(cm.muted) as muted from public.messages m
    join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=auth.uid()
    join public.conversations c on c.id=m.conversation_id and c.kind<>'my_agent'
    where m.created_at>cm.last_read_at and m.removed_at is null and m.sender_user_id is distinct from auth.uid()
      and (m.sender_user_id is not null or m.sender_agent_id is not null)
      and not exists(select 1 from public.message_views v where v.message_id=m.id and v.user_id=auth.uid() and v.viewed_at is not null)
    group by m.conversation_id
    union all
    select th.conversation_id,count(*),false from public.agent_threads th where th.owner_id=auth.uid() and exists(
      select 1 from public.messages m where m.thread_id=th.id and m.created_at>th.last_read_at and m.removed_at is null
      and m.sender_user_id is distinct from auth.uid() and (m.sender_user_id is not null or m.sender_agent_id is not null)
      and not exists(select 1 from public.message_views v where v.message_id=m.id and v.user_id=auth.uid() and v.viewed_at is not null))
    group by th.conversation_id
    union all
    select cm.conversation_id,(select count(*) from public.inbox_items i where i.owner_id=auth.uid() and i.status='open' and i.kind in ('info_request','question')),cm.muted
    from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id and c.kind='my_agent' where cm.user_id=auth.uid()
  ) t where t.n>0 group by t.conversation_id;
$$;

create or replace function public.my_agent_threads()
returns table(id uuid,kind text,title text,last_activity_at timestamptz,unread bigint,task_id uuid,task_status text,preview text)
language sql stable security invoker set search_path=public as $$
  select th.id,th.kind,th.title,th.last_activity_at,
    (select count(*) from public.messages m where m.thread_id=th.id and m.created_at>th.last_read_at and m.removed_at is null
      and m.sender_user_id is distinct from auth.uid() and (m.sender_user_id is not null or m.sender_agent_id is not null)
      and not exists(select 1 from public.message_views v where v.message_id=m.id and v.user_id=auth.uid() and v.viewed_at is not null)),
    lt.task_id,tk.status::text,
    (select left(m.content,160) from public.messages m where m.thread_id=th.id and m.visible_to is null and (m.sender_user_id is not null or m.sender_agent_id is not null) order by m.created_at desc limit 1)
  from public.agent_threads th
  left join lateral(select x.task_id from public.agent_thread_tasks x join public.tasks t2 on t2.id=x.task_id where x.thread_id=th.id order by t2.created_at desc limit 1) lt on true
  left join public.tasks tk on tk.id=lt.task_id
  where th.owner_id=auth.uid() and exists(select 1 from public.messages m where m.thread_id=th.id)
  order by th.last_activity_at desc;
$$;

alter publication supabase_realtime add table public.message_receipt_versions;
