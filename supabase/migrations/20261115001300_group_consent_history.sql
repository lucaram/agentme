-- Existing memberships retain their history. New group memberships start at joining.
alter table public.agents alter column group_add_policy set default 'nobody';
-- The old default permitted direct adds without an explicit opt-in. Start everyone safely;
-- people can explicitly enable direct adds from contacts in Privacy afterwards.
update public.agents set group_add_policy='nobody' where type='personal';
alter table public.conversations add column share_earlier_history boolean not null default false;
alter table public.communities add column approve_link_members boolean not null default false;
alter table public.conversation_members add column history_from timestamptz;
update public.conversation_members set history_from='-infinity';
alter table public.conversation_members alter column history_from set not null;
create table public.group_message_access (
  conversation_id uuid not null,
  user_id uuid not null,
  message_id uuid not null references public.messages(id) on delete cascade,
  primary key(conversation_id,user_id,message_id),
  foreign key(conversation_id,user_id) references public.conversation_members(conversation_id,user_id) on delete cascade
);
alter table public.group_message_access enable row level security;
revoke all on public.group_message_access from anon,authenticated;
grant all on public.group_message_access to service_role;

create function public.member_history_start() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.conversations;
begin
  if exists(select 1 from public.agents where owner_id=new.user_id and type='business') and exists(select 1 from public.conversations where id=new.conversation_id and kind in ('group','channel') and created_by is distinct from new.user_id) then raise exception 'Business agents are services, not group members'; end if;
  if new.history_from is null then
    select * into c from public.conversations where id=new.conversation_id;
    new.history_from:=case when c.kind<>'group' then '-infinity'::timestamptz when c.created_by=new.user_id or c.share_earlier_history then c.created_at else clock_timestamp() end;
  end if;
  return new;
end $$;
revoke execute on function public.member_history_start() from public,anon,authenticated;
create trigger member_history_start before insert on public.conversation_members for each row execute function public.member_history_start();

-- Current shared activities remain useful on joining, without exposing the old conversation.
create function public.member_current_cards() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.conversations where id=new.conversation_id and kind='group') then
    insert into public.group_message_access(conversation_id,user_id,message_id)
      select new.conversation_id,new.user_id,x.id from (
        select distinct on (coalesce(metadata->>'proposal_id',metadata->>'step_id',id::text)) id,created_at
        from public.messages where conversation_id=new.conversation_id and visible_to is null and removed_at is null
          and metadata->>'kind' in ('proposal','poll','assign')
        order by coalesce(metadata->>'proposal_id',metadata->>'step_id',id::text),created_at desc,id desc
      ) x order by x.created_at desc limit 20 on conflict do nothing;
  end if;
  return null;
end $$;
revoke execute on function public.member_current_cards() from public,anon,authenticated;
create trigger member_current_cards after insert on public.conversation_members for each row execute function public.member_current_cards();

-- One visibility rule for SQL reads, downloads, quotes, receipts, reactions and assistant context.
create function public.can_read_chat_message(p_message uuid,p_user uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select (p_user=auth.uid() or auth.role()='service_role') and exists(
    select 1 from public.messages m join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=p_user
    join public.conversations c on c.id=m.conversation_id
    where m.id=p_message and (m.visible_to is null or m.visible_to=p_user)
      and (c.kind<>'group' or m.created_at>=cm.history_from or exists(
        select 1 from public.group_message_access a where a.conversation_id=c.id and a.user_id=p_user and a.message_id=m.id))
  );
$$;
revoke execute on function public.can_read_chat_message(uuid,uuid) from public,anon;
grant execute on function public.can_read_chat_message(uuid,uuid) to authenticated,service_role;
drop policy messages_read_member on public.messages;
create policy messages_read_member on public.messages for select to authenticated using(public.can_read_chat_message(id,auth.uid()));

-- Expired/duplicate pending invitations are not actionable. Declines stay quiet.
update public.inbox_items set status='declined' where kind='group_invite' and status='open' and created_at<now()-interval '7 days';
with ranked as (select id,row_number() over(partition by owner_id,payload->>'conversation_id' order by created_at desc,id desc) n from public.inbox_items where kind='group_invite' and status='open')
  update public.inbox_items i set status='declined' from ranked r where i.id=r.id and r.n>1;
create unique index one_pending_group_invite on public.inbox_items(owner_id,(payload->>'conversation_id')) where kind='group_invite' and status='open';

create function public.invite_group_person(p_group uuid,p_inviter uuid,p_agent uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.conversations; target public.agents; inviter public.agents; existing public.inbox_items; item uuid; permitted boolean;
begin
  select * into c from public.conversations where id=p_group and kind='group' for update;
  if not found or not exists(select 1 from public.conversation_members where conversation_id=p_group and user_id=p_inviter and role in ('owner','admin')) then raise exception 'Only admins can invite people'; end if;
  select * into inviter from public.agents where owner_id=p_inviter limit 1;
  select * into target from public.agents where id=p_agent and type='personal';
  if not found or target.owner_id=p_inviter or exists(select 1 from public.conversation_blocks where conversation_id=p_group and user_id=target.owner_id) then return '{"status":"skipped"}'::jsonb; end if;
  if exists(select 1 from public.conversation_members where conversation_id=p_group and user_id=target.owner_id) then return '{"status":"member"}'::jsonb; end if;
  if not exists(select 1 from public.contacts where status='accepted' and ((requester_agent=inviter.id and addressee_agent=target.id) or (requester_agent=target.id and addressee_agent=inviter.id))) then return '{"status":"skipped"}'::jsonb; end if;
  if (select count(*) from public.conversation_members where conversation_id=p_group)>=256 then return '{"status":"full"}'::jsonb; end if;
  select * into existing from public.inbox_items where owner_id=target.owner_id and kind='group_invite' and payload->>'conversation_id'=p_group::text and status='open' for update;
  if found and existing.created_at>now()-interval '7 days' then return jsonb_build_object('status','invited','id',existing.id); end if;
  if existing.id is not null then update public.inbox_items set status='declined' where id=existing.id; end if;
  -- Avoid repeated invitations after a decline or revocation, including from a different admin.
  if exists(select 1 from public.inbox_items where owner_id=target.owner_id and kind='group_invite' and payload->>'conversation_id'=p_group::text and status='declined' and coalesce(answered_at,created_at)>now()-interval '1 day') then return '{"status":"skipped"}'::jsonb; end if;
  select allowed into permitted from public.rate_limit_hit('groupInvites:'||p_inviter::text,3600,60);
  if not permitted then raise exception 'Too many invitations. Try again later.'; end if;
  if target.group_add_policy='contacts' then
    insert into public.conversation_members(conversation_id,user_id) values(p_group,target.owner_id);
    return '{"status":"added"}'::jsonb;
  end if;
  insert into public.inbox_items(owner_id,agent_id,from_agent,kind,payload) values(target.owner_id,target.id,inviter.id,'group_invite',jsonb_build_object('kind','group_invite','conversation_id',p_group,'title',c.title,'description',c.description)) returning id into item;
  return jsonb_build_object('status','invited','id',item);
end $$;
revoke execute on function public.invite_group_person(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.invite_group_person(uuid,uuid,uuid) to service_role;

create function public.answer_group_invitation(p_item uuid,p_decision text,p_actor uuid default auth.uid()) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=p_actor; item public.inbox_items; c public.conversations; inviter uuid;
begin
  if u is null or not coalesce(u=auth.uid() or auth.role()='service_role',false) or p_decision not in ('join','decline','block') then raise exception 'Invalid invitation'; end if;
  -- Group first, then invitation: same lock order as the invitation writer.
  select g.* into c from public.conversations g join public.inbox_items i on i.payload->>'conversation_id'=g.id::text where i.id=p_item and i.owner_id=u and i.kind='group_invite' and g.kind='group' for update of g;
  if not found then raise exception 'This invitation is unavailable'; end if;
  select * into item from public.inbox_items where id=p_item and owner_id=u and kind='group_invite' for update;
  if item.status<>'open' or item.created_at<=now()-interval '7 days' then raise exception 'This invitation has expired or was withdrawn'; end if;
  if p_decision='block' then insert into public.conversation_blocks(conversation_id,user_id) values(c.id,u) on conflict do nothing; end if;
  if p_decision<>'join' then update public.inbox_items set status='declined',answered_at=now() where id=item.id; return null; end if;
  select owner_id into inviter from public.agents where id=item.from_agent;
  if not exists(select 1 from public.conversation_members where conversation_id=c.id and user_id=inviter and role in ('owner','admin'))
    or exists(select 1 from public.conversation_blocks where conversation_id=c.id and user_id=u)
    or not exists(select 1 from public.agents where owner_id=u and type='personal') then raise exception 'This invitation is unavailable'; end if;
  if (select count(*) from public.conversation_members where conversation_id=c.id)>=256 then raise exception 'This group is full'; end if;
  insert into public.conversation_members(conversation_id,user_id) values(c.id,u) on conflict do nothing;
  update public.inbox_items set status='answered',answered_at=now() where id=item.id;
  return c.id;
end $$;
revoke execute on function public.answer_group_invitation(uuid,text,uuid) from public,anon;
grant execute on function public.answer_group_invitation(uuid,text,uuid) to authenticated,service_role;

create function public.cancel_group_invitation(p_item uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.inbox_items;
begin
  select * into item from public.inbox_items where id=p_item and kind='group_invite' and status='open' for update;
  if not found or not exists(select 1 from public.conversation_members where conversation_id::text=item.payload->>'conversation_id' and user_id=auth.uid() and role in ('owner','admin')) then raise exception 'Not allowed'; end if;
  update public.inbox_items set status='declined',answered_at=now() where id=item.id;
end $$;
revoke execute on function public.cancel_group_invitation(uuid) from public,anon;
grant execute on function public.cancel_group_invitation(uuid) to authenticated;

create function public.read_member_context(p_group uuid,p_user uuid) returns setof public.messages language sql stable security definer set search_path=public,pg_temp as $$
  select m.* from public.messages m where m.conversation_id=p_group and m.visible_to is null and m.removed_at is null
    and public.can_read_chat_message(m.id,p_user) order by m.created_at desc,m.id desc limit 40;
$$;
revoke execute on function public.read_member_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_member_context(uuid,uuid) to service_role;

create function public.group_invite_previews(p_ids uuid[]) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'title',c.title,'description',c.description,'members',(select count(*) from public.conversation_members where conversation_id=c.id),'earlierHistory',c.share_earlier_history,'expires',i.created_at+interval '7 days')),'[]'::jsonb)
  from public.inbox_items i join public.conversations c on c.id::text=i.payload->>'conversation_id'
  where coalesce(cardinality(p_ids),0)<=30 and i.id=any(p_ids) and i.owner_id=auth.uid() and i.kind='group_invite' and i.status='open' and i.created_at>now()-interval '7 days'
    and not exists(select 1 from public.conversation_blocks where conversation_id=c.id and user_id=auth.uid())
    and exists(select 1 from public.conversation_members cm join public.agents a on a.owner_id=cm.user_id where cm.conversation_id=c.id and cm.role in ('owner','admin') and a.id=i.from_agent);
$$;
revoke execute on function public.group_invite_previews(uuid[]) from public,anon;
grant execute on function public.group_invite_previews(uuid[]) to authenticated;

-- Privileged RPCs must honour exactly the same history boundary as RLS.
create or replace function public.acknowledge_messages(p_ids uuid[],p_seen boolean default false) returns uuid[] language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); m public.messages; enabled boolean; acknowledged uuid[]:='{}'; changed integer; permitted boolean;
begin
  if u is null or coalesce(cardinality(p_ids),0)>100 then raise exception 'Invalid acknowledgement'; end if;
  select allowed into permitted from public.rate_limit_hit('messageReceipts:'||u::text,60,600);
  if not permitted then raise exception 'Too many acknowledgements'; end if;
  select coalesce((select p.enabled from public.receipt_preferences p where p.user_id=u),true) into enabled;
  for m in select * from public.messages where id=any(p_ids) and public.can_read_chat_message(id,u) and removed_at is null
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

create or replace function public.pending_message_deliveries() returns setof public.messages language sql security definer set search_path=public,pg_temp as $$
  select m.* from public.messages m join public.message_receipts r on r.message_id=m.id and r.user_id=auth.uid() and r.delivered_at is null
  where public.can_read_chat_message(m.id,auth.uid()) and m.removed_at is null and m.visible_to is null and public.is_conversation_member(m.conversation_id)
  order by m.created_at,m.id limit 100;
$$;

create or replace function public.get_message_receipts(p_ids uuid[],p_details boolean default false) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
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
  where public.can_read_chat_message(m.id,auth.uid()) and m.id=any(p_ids) and coalesce(m.sender_user_id,sender.owner_id)=auth.uid() and public.is_conversation_member(m.conversation_id)
    and m.visible_to is null and m.removed_at is null;
  return result;
end $$;

create or replace function public.set_message_reaction(p_message uuid,p_reaction text default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); m public.messages; c public.conversations; permitted boolean;
begin
  if u is null or (p_reaction is not null and p_reaction not in ('heart','up','down','happy','angry','sad','laugh','cry')) then raise exception 'Invalid reaction'; end if;
  select * into m from public.messages where id=p_message and public.can_read_chat_message(id,u) and visible_to is null and removed_at is null
    and (sender_user_id is not null or sender_agent_id is not null) and public.is_conversation_member(conversation_id) for update;
  if not found then raise exception 'Message unavailable'; end if;
  select * into c from public.conversations where id=m.conversation_id;
  if p_reaction is not null then
    -- Closed DMs and active community mutes must not be bypassed with reactions.
    if c.kind='dm' and not exists (
      select 1 from public.contacts ct join public.agents a on a.id=ct.requester_agent join public.agents b on b.id=ct.addressee_agent
      where ct.status='accepted' and (a.owner_id=u or b.owner_id=u)
      and exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=case when a.owner_id=u then b.owner_id else a.owner_id end)
    ) then raise exception 'Chat is closed'; end if;
    if c.kind='channel' and exists(select 1 from public.community_members cm where cm.community_id=c.community_id and cm.user_id=u and cm.muted_until>now()) then raise exception 'Reactions are unavailable while muted'; end if;
  end if;
  select allowed into permitted from public.rate_limit_hit('messageReactions:'||u::text,60,120);
  if not permitted then raise exception 'Too many reactions. Try again shortly.'; end if;
  if p_reaction is null then delete from public.message_reactions where message_id=m.id and user_id=u;
  else
    insert into public.message_reactions(message_id,user_id,reaction) values(m.id,u,p_reaction)
    on conflict(message_id,user_id) do update set reaction=excluded.reaction,reacted_at=clock_timestamp()
      where public.message_reactions.reaction<>excluded.reaction;
  end if;
  return public.get_message_reactions(array[m.id]);
end $$;

create or replace function public.delete_own_message(p_message uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); m public.messages;
begin
  if u is null then raise exception 'Sign in first'; end if;
  select * into m from public.messages
    where id=p_message and public.can_read_chat_message(id,u) and sender_user_id=u and sender_agent_id is null and not is_ai_generated
      and (visible_to is null or visible_to=u)
      and exists(select 1 from public.conversation_members cm where cm.conversation_id=messages.conversation_id and cm.user_id=u)
    for update;
  if not found then raise exception 'You can only delete your own messages in this chat.'; end if;
  if m.deleted_at is not null then return m.conversation_id; end if;
  update public.messages set content='Deleted message', metadata=case when metadata ? 'client_id' then jsonb_build_object('client_id',metadata->'client_id') else '{}'::jsonb end,
    reply_to=null, deleted_at=now(), removed_at=now(), removed_by=u where id=m.id;
  -- Reports remain an independent moderation record, but no longer require a removal decision.
  update public.reports set status='resolved',resolved_by=u where message_id=m.id and status='open';
  return m.conversation_id;
end $$;


-- Only actual members belong to message receipt audiences.
create or replace function public.capture_message_audience() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
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
      ) x where x.user_id<>owner_user on conflict do nothing;
  end if;
  return new;
end $$;

create or replace function public.action_counts()
returns table (contacts bigint, groups bigint, communities bigint)
language sql stable security invoker set search_path = public as $$
  select
    (select count(*) from public.contacts c where c.status = 'pending' and c.addressee_agent = public.my_agent_id())
      + (select count(*) from public.inbox_items i where i.owner_id = auth.uid() and i.status = 'open' and i.kind = 'introduction'),
    (select count(*) from public.inbox_items i where i.owner_id = auth.uid() and i.status = 'open' and i.kind = 'group_invite' and i.created_at>now()-interval '7 days')
      + (select count(*) from public.join_requests r
          where r.status = 'pending' and r.conversation_id is not null and public.conversation_role(r.conversation_id) in ('owner', 'admin'))
      + (select count(*) from public.reports r
          where r.status = 'open' and r.community_id is null and r.message_id is not null
            and public.conversation_role(r.conversation_id) in ('owner', 'admin'))
      + (select count(*) from public.notices n where n.user_id = auth.uid() and n.area = 'groups' and n.seen_at is null
          and n.dismissed_at is null and not public.notice_is_muted(n.user_id, n.ref_id, n.area)),
    (select count(*) from public.join_requests r
        where r.status = 'pending' and r.community_id is not null and public.community_role(r.community_id) in ('owner', 'moderator'))
      + (select count(*) from public.reports r
          where r.status = 'open' and r.community_id is not null and public.community_role(r.community_id) in ('owner', 'moderator'))
      + (select count(*) from public.notices n where n.user_id = auth.uid() and n.area = 'communities' and n.seen_at is null
          and n.dismissed_at is null and not public.notice_is_muted(n.user_id, n.ref_id, n.area))
$$;
