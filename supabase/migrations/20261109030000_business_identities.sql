-- One person, several identities: a person (their own account) can manage
-- businesses, each a separate identity with its own chats, contacts and inbox.
-- The header switcher signs the person in as the business (and back).

create table public.business_managers (
  business_agent_id uuid not null references public.agents (id) on delete cascade,
  -- The person's own account (their personal login).
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (business_agent_id, user_id)
);
create index business_managers_user_idx on public.business_managers (user_id);

-- Businesses that signed up on their own: their login is the person underneath.
insert into public.business_managers (business_agent_id, user_id, role)
select id, owner_id, 'owner' from public.agents where type = 'business'
on conflict do nothing;

alter table public.business_managers enable row level security;
-- A person sees the businesses they manage; a business sees its managers.
create policy business_managers_read on public.business_managers
  for select to authenticated using (user_id = auth.uid() or business_agent_id = public.my_agent_id());

-- What's waiting for an identity you're not currently using (for the switcher's
-- badge): unread messages from others plus open requests. Server-only.
create function public.identity_badge(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.messages m
       join public.conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = p_user
      where m.created_at > cm.last_read_at and not cm.muted
        and m.sender_user_id is distinct from p_user
        and (m.sender_user_id is not null or m.sender_agent_id is not null))
    + (select count(*) from public.inbox_items i where i.owner_id = p_user and i.status = 'open')
$$;
revoke execute on function public.identity_badge(uuid) from public, anon, authenticated;
