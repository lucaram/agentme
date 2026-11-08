-- @agent in any chat: messages can be private to one member (their own
-- commands to their agent and its replies). Enforced by RLS, so other members
-- never receive them (Realtime applies the same policy).
alter table public.messages
  add column visible_to uuid references auth.users (id) on delete cascade;

drop policy messages_read_member on public.messages;
create policy messages_read_member on public.messages
  for select to authenticated
  using (
    public.is_conversation_member(conversation_id)
    and (visible_to is null or visible_to = auth.uid())
  );
