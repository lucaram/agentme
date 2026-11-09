-- Updates (notices) that stay manageable when there are many: which group or
-- community each is about (to filter, group repeats and respect mute), updates
-- that need you (pinned until handled), and clearing them.
alter table public.notices
  add column ref_id uuid,
  add column kind text not null default 'info' check (char_length(kind) between 1 and 40),
  add column needs_action boolean not null default false,
  add column resolved_at timestamptz,
  add column dismissed_at timestamptz;

update public.notices
  set ref_id = substring(link from '/(?:groups|communities)/([0-9a-f-]{36})')::uuid
  where link ~ '/(groups|communities)/[0-9a-f-]{36}';

create index notices_live_idx on public.notices (user_id, area, created_at desc) where dismissed_at is null;

-- You muted the group (or the community's General chat): its updates still show, but don't add to the badge.
create function public.notice_is_muted(p_user uuid, p_ref uuid, p_area text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_ref is null then false
    when p_area = 'groups' then exists (
      select 1 from public.conversation_members cm where cm.conversation_id = p_ref and cm.user_id = p_user and cm.muted)
    else exists (
      select 1 from public.conversation_members cm join public.conversations c on c.id = cm.conversation_id
      where c.community_id = p_ref and c.channel = 'general' and cm.user_id = p_user and cm.muted)
  end
$$;
revoke execute on function public.notice_is_muted(uuid, uuid, text) from public, anon;
grant execute on function public.notice_is_muted(uuid, uuid, text) to authenticated;

-- Tab badges: cleared updates and muted groups/communities don't count.
create or replace function public.action_counts()
returns table (contacts bigint, groups bigint, communities bigint)
language sql stable security invoker set search_path = public as $$
  select
    (select count(*) from public.contacts c where c.status = 'pending' and c.addressee_agent = public.my_agent_id())
      + (select count(*) from public.inbox_items i where i.owner_id = auth.uid() and i.status = 'open' and i.kind = 'introduction'),
    (select count(*) from public.inbox_items i where i.owner_id = auth.uid() and i.status = 'open' and i.kind = 'group_invite')
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
