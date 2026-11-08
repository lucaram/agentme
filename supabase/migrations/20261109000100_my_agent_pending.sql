-- My Agent's counter stays while something waits for your answer (an agent
-- asking for info, a contact's question), not only while notes are unread.
-- Its count is the higher of the two, so nothing is counted twice.
create or replace function public.unread_counts()
returns table (conversation_id uuid, unread bigint, muted boolean)
language sql stable security invoker set search_path = public as $$
  select t.conversation_id, max(t.n)::bigint, bool_or(t.muted)
  from (
    select m.conversation_id, count(*) as n, bool_or(cm.muted) as muted
    from public.messages m
    join public.conversation_members cm
      on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
    where m.created_at > cm.last_read_at
      and m.sender_user_id is distinct from auth.uid()
      and (m.sender_user_id is not null or m.sender_agent_id is not null)
    group by m.conversation_id
    union all
    select cm.conversation_id,
           (select count(*) from public.inbox_items i
             where i.owner_id = auth.uid() and i.status = 'open' and i.kind in ('info_request', 'question')),
           cm.muted
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    where cm.user_id = auth.uid() and c.kind = 'my_agent'
  ) t
  where t.n > 0
  group by t.conversation_id
$$;
