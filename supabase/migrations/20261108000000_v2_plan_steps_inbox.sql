-- V2 / Milestone 1: plans made of steps (blocks) + the "ask my human" inbox.

-- A task can now wait on people (inbox answers) without holding a worker.
alter type public.task_status add value if not exists 'waiting';
-- An exchange the recipient agent forwarded to its owner.
alter type public.exchange_status add value if not exists 'waiting_human';

-- Who actually answered an agent-to-agent request: the agent itself (within
-- standing permissions) or its human (via the inbox).
alter table public.task_exchanges
  add column answered_by text check (answered_by in ('agent', 'human'));

-- ---------------------------------------------------------------- plan steps
create table public.plan_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  position integer not null,
  type text not null check (type in (
    'collect', 'proposal', 'rsvp', 'poll', 'question', 'recall', 'assign', 'threshold', 'change', 'announce'
  )),
  config jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'waiting', 'done', 'skipped', 'failed')),
  result jsonb,
  updated_at timestamptz not null default now(),
  unique (task_id, position)
);

create trigger plan_steps_touch before update on public.plan_steps
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- inbox
-- Requests an agent could not answer on its own and handed to its owner.
create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  from_agent uuid references public.agents (id) on delete set null,
  task_id uuid references public.tasks (id) on delete cascade,
  exchange_id uuid references public.task_exchanges (id) on delete cascade,
  kind text not null default 'info_request' check (kind in ('info_request')),
  -- { event, window, categories, missing, prefilled: { category: value } }
  payload jsonb not null,
  status text not null default 'open' check (status in ('open', 'answered', 'declined', 'withdrawn')),
  answer jsonb,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);
create index inbox_items_owner_idx on public.inbox_items (owner_id, status, created_at desc);
-- NULLs never conflict in a unique index, so no partial predicate is needed (and ON CONFLICT can target it).
create unique index inbox_items_exchange_idx on public.inbox_items (exchange_id);

-- ---------------------------------------------------------------- RLS
alter table public.plan_steps enable row level security;
alter table public.inbox_items enable row level security;

create policy plan_steps_read on public.plan_steps
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and t.owner_id = auth.uid()));

create policy inbox_read_own on public.inbox_items
  for select to authenticated using (owner_id = auth.uid());

alter publication supabase_realtime add table public.plan_steps, public.inbox_items;
