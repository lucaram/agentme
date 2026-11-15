-- My Agent is the single action surface; stale/withdrawn invitations never inflate badges.
create function public.open_group_invitation(p_item uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.inbox_items i join public.conversations c on c.id::text=i.payload->>'conversation_id'
    where i.id=p_item and i.owner_id=auth.uid() and i.kind='group_invite' and i.status='open' and i.created_at>now()-interval '7 days'
    and not exists(select 1 from public.conversation_blocks where conversation_id=c.id and user_id=i.owner_id)
    and exists(select 1 from public.conversation_members cm join public.agents a on a.owner_id=cm.user_id where cm.conversation_id=c.id and cm.role in ('owner','admin') and a.id=i.from_agent));
$$;
revoke execute on function public.open_group_invitation(uuid) from public,anon;
grant execute on function public.open_group_invitation(uuid) to authenticated;

create function public.open_owner_requests(p_kinds text[] default null,p_exclude uuid[] default '{}') returns setof public.inbox_items language sql stable security invoker set search_path=public,pg_temp as $$
  select i.* from public.inbox_items i where i.owner_id=auth.uid() and i.status='open'
    and (p_kinds is null or i.kind=any(p_kinds)) and not(i.id=any(p_exclude))
    and (i.kind<>'group_invite' or public.open_group_invitation(i.id)) order by i.created_at,i.id limit 30;
$$;
revoke execute on function public.open_owner_requests(text[],uuid[]) from public,anon;
grant execute on function public.open_owner_requests(text[],uuid[]) to authenticated;

create function public.owner_attention_count() returns bigint language sql stable security invoker set search_path=public,pg_temp as $$
  select count(*) from public.inbox_items i where i.owner_id=auth.uid() and i.status='open'
    and (i.kind in ('info_request','question') or (i.kind='group_invite' and public.open_group_invitation(i.id)));
$$;
revoke execute on function public.owner_attention_count() from public,anon;
grant execute on function public.owner_attention_count() to authenticated;

create function public.prune_group_invitations() returns void language sql security definer set search_path=public,pg_temp as $$
  update public.inbox_items i set status='declined' where i.kind='group_invite' and i.status='open' and (
    i.created_at<=now()-interval '7 days' or not exists(
      select 1 from public.conversations c join public.conversation_members cm on cm.conversation_id=c.id
      join public.agents a on a.owner_id=cm.user_id where c.id::text=i.payload->>'conversation_id' and cm.role in ('owner','admin') and a.id=i.from_agent)
  );
$$;
revoke execute on function public.prune_group_invitations() from public,anon,authenticated;
grant execute on function public.prune_group_invitations() to service_role;

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
    select cm.conversation_id,(select count(*) from public.inbox_items i where i.owner_id=auth.uid() and i.status='open' and (i.kind in ('info_request','question') or (i.kind='group_invite' and public.open_group_invitation(i.id)))),cm.muted
    from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id and c.kind='my_agent' where cm.user_id=auth.uid()
  ) t where t.n>0 group by t.conversation_id;
$$;
create or replace function public.action_counts()
returns table (contacts bigint, groups bigint, communities bigint)
language sql stable security invoker set search_path = public as $$
  select
    (select count(*) from public.contacts c where c.status = 'pending' and c.addressee_agent = public.my_agent_id())
      + (select count(*) from public.inbox_items i where i.owner_id = auth.uid() and i.status = 'open' and i.kind = 'introduction'),
    (select count(*) from public.inbox_items i where i.owner_id = auth.uid() and i.status = 'open' and i.kind = 'group_invite' and public.open_group_invitation(i.id))
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
