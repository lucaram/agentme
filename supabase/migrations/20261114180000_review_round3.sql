-- ✓ Verified: how the website was proved (the owner's confirmed email at its domain, or the code
-- on its homepage), so badges can be reviewed later. Null for badges given before this was kept.
alter table public.agents add column verified_method text check (verified_method in ('email', 'meta'));

-- Community "Post anyway" after a nudge: the approval is for one exact message, once.
-- text_hash: SHA-256 of the whole nudged message (the excerpt is only its first 500 characters);
-- used_at: when that approval was used.
alter table public.moderation_events add column text_hash text check (text_hash is null or char_length(text_hash) = 64);
alter table public.moderation_events add column used_at timestamptz;
