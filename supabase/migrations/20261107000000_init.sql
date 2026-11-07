-- AGENTME initial schema.
--
-- Security model:
--   * RLS is enabled on every table.
--   * Browsers may only SELECT rows they are entitled to (policies below);
--     this powers server rendering with the user's session and Realtime.
--   * There are deliberately NO insert/update/delete policies. Every mutation
--     goes through server code (lib/data/*) that authorises the caller
--     explicitly and then writes with the service role.

-- ---------------------------------------------------------------- enums
create type public.agent_type as enum ('personal', 'business');
create type public.contact_policy as enum ('contacts_only', 'anyone', 'nobody');
create type public.disclosure_level as enum ('private', 'contacts');
create type public.contact_status as enum ('pending', 'accepted', 'blocked');
create type public.conversation_kind as enum ('dm', 'group', 'my_agent', 'agent_chat');
create type public.task_status as enum (
  'awaiting_approval', 'running', 'proposal_ready', 'accepted', 'rejected', 'cancelled', 'failed'
);
create type public.exchange_status as enum ('pending', 'completed', 'refused', 'failed');
create type public.proposal_status as enum ('pending', 'accepted', 'rejected');

-- ---------------------------------------------------------------- agents
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar text not null default '🤖',
  type public.agent_type not null default 'personal',
  contact_policy public.contact_policy not null default 'contacts_only',
  bio text check (bio is null or char_length(bio) <= 280),
  -- Business agents only: { description, hours, faqs: [{q, a}] }
  business_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Owner preferences. Each fact carries its own disclosure level; code only
-- ever hands 'contacts' facts to other agents, and only for the categories a
-- task explicitly requested.
create table public.agent_facts (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  category text not null check (category in ('availability', 'food', 'location', 'notes')),
  value text not null check (char_length(value) between 1 and 500),
  disclosure public.disclosure_level not null default 'private',
  updated_at timestamptz not null default now(),
  unique (agent_id, category)
);

-- ---------------------------------------------------------------- contacts
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  requester_agent uuid not null references public.agents (id) on delete cascade,
  addressee_agent uuid not null references public.agents (id) on delete cascade,
  status public.contact_status not null default 'pending',
  blocked_by uuid references public.agents (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (requester_agent <> addressee_agent),
  check ((status = 'blocked') = (blocked_by is not null))
);
create unique index contacts_pair_idx on public.contacts (
  least(requester_agent, addressee_agent), greatest(requester_agent, addressee_agent)
);

-- ---------------------------------------------------------------- chat
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.conversation_kind not null,
  title text,
  created_by uuid references auth.users (id) on delete set null,
  -- agent_chat: the (other) agent the user is talking to over A2A
  target_agent uuid references public.agents (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_user_id uuid references auth.users (id) on delete set null,
  sender_agent_id uuid references public.agents (id) on delete set null,
  is_ai_generated boolean not null,
  content text not null check (char_length(content) between 1 and 8000),
  -- e.g. { "kind": "task_card", "task_id": ... } or { "kind": "proposal", ... }
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- Trust rule: anything an agent sends is visibly AI-generated.
  constraint agent_messages_are_ai check (sender_agent_id is null or is_ai_generated)
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------- tasks
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  initiator_agent uuid not null references public.agents (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  goal text not null,
  -- { event, window, participants: [handle], categories: [..] }
  parsed jsonb not null default '{}'::jsonb,
  status public.task_status not null default 'awaiting_approval',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_owner_idx on public.tasks (owner_id, created_at desc);

-- Audit trail of every agent-to-agent exchange.
create table public.task_exchanges (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks (id) on delete cascade,
  from_agent uuid references public.agents (id) on delete set null,
  to_agent uuid references public.agents (id) on delete set null,
  skill text not null,
  request jsonb not null default '{}'::jsonb,
  response jsonb,
  disclosed_categories text[] not null default '{}',
  a2a_task_id text,
  status public.exchange_status not null default 'pending',
  error text,
  latency_ms integer,
  created_at timestamptz not null default now()
);
create index task_exchanges_task_idx on public.task_exchanges (task_id);
create index task_exchanges_to_idx on public.task_exchanges (to_agent, created_at desc);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.tasks (id) on delete cascade,
  -- { title, when, cuisine, participants: [handle], rationale, disclaimer }
  content jsonb not null,
  status public.proposal_status not null default 'pending',
  group_conversation_id uuid references public.conversations (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.proposal_responses (
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  response text not null check (response in ('accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (proposal_id, agent_id)
);

-- ---------------------------------------------------------------- helpers
create function public.my_agent_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.agents where owner_id = auth.uid()
$$;

create function public.is_conversation_member(conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = conv and user_id = auth.uid()
  )
$$;

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger tasks_touch before update on public.tasks
for each row execute function public.touch_updated_at();
create trigger agent_facts_touch before update on public.agent_facts
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- RLS
alter table public.agents enable row level security;
alter table public.agent_facts enable row level security;
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.tasks enable row level security;
alter table public.task_exchanges enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_responses enable row level security;

-- The agent directory (handle, name, avatar, type, bio, business info) is public
-- to signed-in users. Private preferences live in agent_facts, not here.
create policy agents_read on public.agents
  for select to authenticated using (true);

create policy facts_read_own on public.agent_facts
  for select to authenticated using (agent_id = public.my_agent_id());

create policy contacts_read_own on public.contacts
  for select to authenticated
  using (requester_agent = public.my_agent_id() or addressee_agent = public.my_agent_id());

create policy conversations_read_member on public.conversations
  for select to authenticated using (public.is_conversation_member(id));

create policy members_read_member on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id));

create policy messages_read_member on public.messages
  for select to authenticated using (public.is_conversation_member(conversation_id));

create policy tasks_read_owner on public.tasks
  for select to authenticated using (owner_id = auth.uid());

-- Owners see their task's exchanges; recipients see what their own agent disclosed.
create policy exchanges_read on public.task_exchanges
  for select to authenticated
  using (
    to_agent = public.my_agent_id()
    or from_agent = public.my_agent_id()
  );

create policy proposals_read on public.proposals
  for select to authenticated
  using (
    exists (select 1 from public.tasks t where t.id = task_id and t.owner_id = auth.uid())
    or (group_conversation_id is not null and public.is_conversation_member(group_conversation_id))
  );

create policy proposal_responses_read on public.proposal_responses
  for select to authenticated
  using (
    exists (
      select 1 from public.proposals p
      join public.tasks t on t.id = p.task_id
      where p.id = proposal_id
        and (t.owner_id = auth.uid()
             or (p.group_conversation_id is not null
                 and public.is_conversation_member(p.group_conversation_id)))
    )
  );

-- ---------------------------------------------------------------- realtime
alter publication supabase_realtime add table
  public.messages, public.tasks, public.task_exchanges, public.proposals, public.proposal_responses;
