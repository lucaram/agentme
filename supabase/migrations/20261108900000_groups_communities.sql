-- Groups (private, WhatsApp-style) and communities (Announcements + General,
-- public or private), with roles, moderation, invite links, join requests,
-- reports, blocks and "who can add me to groups".
-- As everywhere: RLS on every table, browsers only read; server code writes.

-- Community chats are conversations of a new kind.
alter type public.conversation_kind add value if not exists 'channel';

-- ---------------------------------------------------------------- communities
create table public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 60),
  description text check (description is null or char_length(description) <= 500),
  rules text check (rules is null or char_length(rules) <= 2000),
  avatar text not null default '🏟️',
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  owner_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index communities_name_idx on public.communities (lower(name));

create table public.community_members (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  -- Set by a moderator: can read but not post until then.
  muted_until timestamptz,
  rules_accepted_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index community_members_user_idx on public.community_members (user_id);

create table public.community_bans (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  banned_by uuid references auth.users (id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

-- ---------------------------------------------------------------- groups & channels
alter table public.conversations
  add column description text check (description is null or char_length(description) <= 500),
  add column avatar text check (avatar is null or char_length(avatar) <= 16),
  add column only_admins_send boolean not null default false,
  add column only_admins_edit boolean not null default true,
  add column approve_new_members boolean not null default true,
  add column community_id uuid references public.communities (id) on delete cascade,
  add column channel text check (channel in ('announcements', 'general'));

alter table public.conversation_members
  add column role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  add column muted boolean not null default false;

-- Existing groups: whoever created them owns them.
update public.conversation_members cm
   set role = 'owner'
  from public.conversations c
 where c.id = cm.conversation_id and c.kind = 'group' and c.created_by = cm.user_id;

-- Someone who blocked a group left it and can't be added back by others.
create table public.conversation_blocks (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- Moderators/admins can remove a message for everyone (its text is replaced).
alter table public.messages
  add column removed_at timestamptz,
  add column removed_by uuid references auth.users (id) on delete set null;

-- "Who can add me to groups": my contacts (default) or nobody (send an invite instead).
alter table public.agents
  add column group_add_policy text not null default 'contacts' check (group_add_policy in ('contacts', 'nobody'));
alter table public.inbox_items drop constraint inbox_items_kind_check;
alter table public.inbox_items add constraint inbox_items_kind_check
  check (kind in ('info_request', 'question', 'introduction', 'group_invite'));

-- ---------------------------------------------------------------- invite links & join requests
create table public.join_links (
  token text primary key check (char_length(token) >= 20),
  conversation_id uuid references public.conversations (id) on delete cascade,
  community_id uuid references public.communities (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  revoked boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check ((conversation_id is null) <> (community_id is null))
);

create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations (id) on delete cascade,
  community_id uuid references public.communities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((conversation_id is null) <> (community_id is null))
);
create unique index join_requests_pending_idx on public.join_requests (coalesce(conversation_id, community_id), user_id) where status = 'pending';

-- ---------------------------------------------------------------- reports
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete cascade,
  community_id uuid references public.communities (id) on delete cascade,
  message_id uuid references public.messages (id) on delete cascade,
  -- What was reported, as it was (the message may be removed later).
  excerpt text check (excerpt is null or char_length(excerpt) <= 500),
  reason text not null check (char_length(reason) between 1 and 300),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index reports_conversation_idx on public.reports (conversation_id, status);
create index reports_community_idx on public.reports (community_id, status);

-- ---------------------------------------------------------------- helpers
create function public.is_community_member(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_members where community_id = c and user_id = auth.uid())
$$;

create function public.community_role(c uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.community_members where community_id = c and user_id = auth.uid()
$$;

create function public.conversation_role(conv uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.conversation_members where conversation_id = conv and user_id = auth.uid()
$$;

-- Unread counts now also say whether the chat is muted (muted chats don't count in the tab total).
drop function public.unread_counts();
create function public.unread_counts()
returns table (conversation_id uuid, unread bigint, muted boolean)
language sql stable security invoker set search_path = public as $$
  select m.conversation_id, count(*)::bigint, bool_or(cm.muted)
  from public.messages m
  join public.conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  where m.created_at > cm.last_read_at
    and m.sender_user_id is distinct from auth.uid()
    and (m.sender_user_id is not null or m.sender_agent_id is not null)
  group by m.conversation_id
$$;

-- ---------------------------------------------------------------- RLS
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_bans enable row level security;
alter table public.conversation_blocks enable row level security;
alter table public.join_links enable row level security;
alter table public.join_requests enable row level security;
alter table public.reports enable row level security;

-- Public communities are visible to everyone signed in; private ones to members.
create policy communities_read on public.communities
  for select to authenticated using (visibility = 'public' or public.is_community_member(id));

create policy community_members_read on public.community_members
  for select to authenticated using (public.is_community_member(community_id));

create policy community_bans_read on public.community_bans
  for select to authenticated using (public.community_role(community_id) in ('owner', 'moderator'));

create policy conversation_blocks_read_own on public.conversation_blocks
  for select to authenticated using (user_id = auth.uid());

-- Your own requests; and the ones moderators/admins have to decide.
create policy join_requests_read on public.join_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or (community_id is not null and public.community_role(community_id) in ('owner', 'moderator'))
    or (conversation_id is not null and public.conversation_role(conversation_id) in ('owner', 'admin'))
  );

-- Your own reports; and the ones moderators/admins have to handle.
create policy reports_read on public.reports
  for select to authenticated
  using (
    reporter_id = auth.uid()
    or (community_id is not null and public.community_role(community_id) in ('owner', 'moderator'))
    or (conversation_id is not null and community_id is null and public.conversation_role(conversation_id) in ('owner', 'admin'))
  );
-- join_links: no policies (server-only).

-- Member counts for communities you can see (member lists themselves stay private).
create function public.community_member_counts(p_ids uuid[])
returns table (community_id uuid, members bigint)
language sql stable security definer set search_path = public as $$
  select cm.community_id, count(*)::bigint
  from public.community_members cm
  join public.communities c on c.id = cm.community_id
  where cm.community_id = any (p_ids)
    and (c.visibility = 'public' or public.is_community_member(c.id))
  group by cm.community_id
$$;
revoke execute on function public.community_member_counts(uuid[]) from public, anon;
grant execute on function public.community_member_counts(uuid[]) to authenticated;
