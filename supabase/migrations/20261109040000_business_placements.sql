-- Businesses in groups and communities. A business is never a member: it's
-- placed there, only receives the messages that @mention it (sent by the
-- server), answers from its public information and never posts on its own.
--  - Groups: an admin adds a business (active straight away); anyone in the
--    group can remove it; the business can leave.
--  - Communities: a moderator invites a business as an "official partner";
--    it's active once the business accepts.

create table public.business_placements (
  id uuid primary key default gen_random_uuid(),
  business_agent_id uuid not null references public.agents (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  community_id uuid references public.communities (id) on delete cascade,
  status text not null default 'active' check (status in ('invited', 'active')),
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(conversation_id, community_id) = 1)
);
create unique index business_placements_group_uniq on public.business_placements (business_agent_id, conversation_id) where conversation_id is not null;
create unique index business_placements_community_uniq on public.business_placements (business_agent_id, community_id) where community_id is not null;
create index business_placements_conversation_idx on public.business_placements (conversation_id) where conversation_id is not null;
create index business_placements_community_idx on public.business_placements (community_id) where community_id is not null;

alter table public.business_placements enable row level security;
-- The business sees where it's placed; group members see their group's
-- businesses; anyone who can see a community sees its active partners, and
-- moderators also see pending invitations. Writes are server-only.
create policy business_placements_read on public.business_placements
  for select to authenticated using (
    business_agent_id = public.my_agent_id()
    or (conversation_id is not null and public.is_conversation_member(conversation_id))
    or (community_id is not null and public.community_role(community_id) in ('owner', 'moderator'))
    or (community_id is not null and status = 'active' and exists (
      select 1 from public.communities c where c.id = community_id and (c.visibility = 'public' or public.is_community_member(c.id))
    ))
  );
