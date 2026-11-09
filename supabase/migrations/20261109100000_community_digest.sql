-- Community moderation step 3: appeals, a daily digest for moderators, and
-- handling moderators who are never around. All server-written.

-- Appeals on what the autopilot did (a message not posted, or hidden after reports).
alter table public.moderation_events
  add column original_text text check (original_text is null or char_length(original_text) <= 4000),
  add column appeal_status text check (appeal_status in ('pending', 'accepted', 'rejected')),
  add column appealed_at timestamptz,
  add column appeal_resolved_at timestamptz,
  -- null with a resolved appeal = resolved automatically (nobody answered within 3 days).
  add column appeal_resolved_by uuid references auth.users (id) on delete set null;
create index moderation_events_pending_appeals_idx on public.moderation_events (appealed_at) where appeal_status = 'pending';

-- The daily digest, and nudging an owner whose moderators have gone quiet.
alter table public.communities
  add column digest_sent_at timestamptz,
  add column mods_nudged_at timestamptz;

-- When each member was last around (opened the community or one of its chats).
alter table public.community_members add column last_seen_at timestamptz not null default now();
