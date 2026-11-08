-- Tab badges: things waiting for you to act on, per tab (Contacts, Groups,
-- Communities), plus updates you should know about (removed, deleted,
-- request approved/declined, muted, promoted).

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  area text not null check (area in ('groups', 'communities')),
  text text not null check (char_length(text) between 1 and 300),
  link text check (link is null or link ~ '^/[A-Za-z0-9/_-]*$'),
  seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index notices_user_idx on public.notices (user_id, area, created_at desc);
alter table public.notices enable row level security;
create policy notices_read_own on public.notices for select to authenticated using (user_id = auth.uid());

-- Per-tab counts for the signed-in user. Runs with the caller's rights (RLS).
create function public.action_counts()
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
      + (select count(*) from public.notices n where n.user_id = auth.uid() and n.area = 'groups' and n.seen_at is null),
    (select count(*) from public.join_requests r
        where r.status = 'pending' and r.community_id is not null and public.community_role(r.community_id) in ('owner', 'moderator'))
      + (select count(*) from public.reports r
          where r.status = 'open' and r.community_id is not null and public.community_role(r.community_id) in ('owner', 'moderator'))
      + (select count(*) from public.notices n where n.user_id = auth.uid() and n.area = 'communities' and n.seen_at is null)
$$;
revoke execute on function public.action_counts() from public, anon;
grant execute on function public.action_counts() to authenticated;

-- Mark your own updates in one area as seen (opening the tab).
create function public.mark_notices_seen(p_area text) returns void
language sql security definer set search_path = public as $$
  update public.notices set seen_at = now() where user_id = auth.uid() and area = p_area and seen_at is null
$$;
revoke execute on function public.mark_notices_seen(text) from public, anon;
grant execute on function public.mark_notices_seen(text) to authenticated;

-- Live badge updates (Realtime applies the same RLS as reads).
alter publication supabase_realtime add table public.contacts, public.join_requests, public.reports, public.notices;
