-- V2 / Milestone 3: Assign (sign-up lists), Change (plan edits with history).
-- Threshold and Announce need no new tables (RSVP step config / messages).

-- ---------------------------------------------------------------- assign
-- One row per claimed item. The primary key guarantees an item can never be
-- claimed twice, even if two people tap at the same moment.
create table public.item_claims (
  step_id uuid not null references public.plan_steps (id) on delete cascade,
  item text not null check (char_length(item) between 1 and 80),
  agent_id uuid not null references public.agents (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (step_id, item)
);
alter table public.item_claims enable row level security;
create policy item_claims_read on public.item_claims
  for select to authenticated
  using (exists (select 1 from public.plan_steps s where s.id = step_id and public.can_see_task(s.task_id)));

-- ---------------------------------------------------------------- change
-- Every edit to an agreed plan, kept for history and audit.
create table public.plan_changes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  changed_by uuid references public.agents (id) on delete set null,
  before jsonb not null,
  after jsonb not null,
  reset_rsvps boolean not null,
  created_at timestamptz not null default now()
);
create index plan_changes_task_idx on public.plan_changes (task_id, created_at);
alter table public.plan_changes enable row level security;
create policy plan_changes_read on public.plan_changes
  for select to authenticated using (public.can_see_task(task_id));

alter publication supabase_realtime add table public.item_claims, public.plan_changes;
