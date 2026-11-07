-- WhatsApp-style unread counters per conversation.

-- When this member last read the conversation. Existing memberships start
-- "read now", so nobody gets a flood of old messages counted as unread.
alter table public.conversation_members
  add column last_read_at timestamptz not null default now();

-- Unread messages per conversation for the signed-in user: messages from
-- other people or agents since they last read it (their own messages and
-- neutral event lines don't count). Runs with the caller's rights (RLS).
create function public.unread_counts()
returns table (conversation_id uuid, unread bigint)
language sql stable security invoker set search_path = public as $$
  select m.conversation_id, count(*)::bigint
  from public.messages m
  join public.conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  where m.created_at > cm.last_read_at
    and m.sender_user_id is distinct from auth.uid()
    and (m.sender_user_id is not null or m.sender_agent_id is not null)
  group by m.conversation_id
$$;
