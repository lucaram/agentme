-- Community autopilot (moderation step 2): what the automatic checks did, for
-- moderators' daily digest and for appeals (step 3). Server-written only.
create table public.moderation_events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('refused', 'nudged', 'posted_after_nudge', 'hidden_after_reports')),
  verdict text not null,
  confidence real,
  reason text,
  excerpt text check (excerpt is null or char_length(excerpt) <= 500),
  created_at timestamptz not null default now()
);
create index moderation_events_community_idx on public.moderation_events (community_id, created_at desc);

alter table public.moderation_events enable row level security;
-- Moderators (and owners) of the community see what the autopilot did there.
create policy moderation_events_read on public.moderation_events
  for select to authenticated using (public.community_role(community_id) in ('owner', 'moderator'));
