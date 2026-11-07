-- V2 / Milestone 2: RSVP v2, Poll and Question blocks.

-- Finished plans that had no proposal (a poll, a question).
alter type public.task_status add value if not exists 'completed';

-- The group conversation a plan is shared in (RSVPs, polls).
alter table public.tasks add column group_conversation_id uuid references public.conversations (id) on delete set null;

-- Inbox can now also hold free questions from contacts.
alter table public.inbox_items drop constraint inbox_items_kind_check;
alter table public.inbox_items add constraint inbox_items_kind_check check (kind in ('info_request', 'question'));

-- ---------------------------------------------------------------- step responses
-- One answer per person per step (RSVP, vote, ...). Always a human's own action.
create table public.step_responses (
  step_id uuid not null references public.plan_steps (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  answered_by text not null default 'human' check (answered_by in ('agent', 'human')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (step_id, agent_id)
);
create trigger step_responses_touch before update on public.step_responses
for each row execute function public.touch_updated_at();

-- Who may see a plan's steps and answers: its owner and the members of the
-- group it was shared in. SECURITY DEFINER so it doesn't depend on the
-- caller being able to read tasks (owner-only).
create function public.can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (
        t.owner_id = auth.uid()
        or (t.group_conversation_id is not null and public.is_conversation_member(t.group_conversation_id))
      )
  )
$$;

drop policy plan_steps_read on public.plan_steps;
create policy plan_steps_read on public.plan_steps
  for select to authenticated using (public.can_see_task(task_id));

alter table public.step_responses enable row level security;
create policy step_responses_read on public.step_responses
  for select to authenticated
  using (exists (select 1 from public.plan_steps s where s.id = step_id and public.can_see_task(s.task_id)));

-- ---------------------------------------------------------------- migrate RSVPs
-- Plans already shared get an RSVP step; existing answers move into it.
update public.tasks t set group_conversation_id = p.group_conversation_id
from public.proposals p
where p.task_id = t.id and p.group_conversation_id is not null;

insert into public.plan_steps (task_id, position, type, status)
select p.task_id,
       coalesce((select max(s.position) + 1 from public.plan_steps s where s.task_id = p.task_id), 0),
       'rsvp',
       'done'
from public.proposals p
where p.status = 'accepted'
  and not exists (select 1 from public.plan_steps s where s.task_id = p.task_id and s.type = 'rsvp');

insert into public.step_responses (step_id, agent_id, answered_by, value)
select s.id, r.agent_id, 'human', jsonb_build_object('response', case r.response when 'accepted' then 'in' else 'out' end)
from public.proposal_responses r
join public.proposals p on p.id = r.proposal_id
join public.plan_steps s on s.task_id = p.task_id and s.type = 'rsvp'
on conflict do nothing;

drop table public.proposal_responses;
drop function if exists public.can_see_proposal(uuid) cascade;

-- proposals: owner or group members (via the task).
drop policy if exists proposals_read on public.proposals;
create policy proposals_read on public.proposals
  for select to authenticated using (public.can_see_task(task_id));

alter publication supabase_realtime add table public.step_responses;

-- Set when someone answers while a worker is still running the task: the
-- worker then takes another pass instead of parking it as "waiting" (prevents
-- a missed wake-up).
alter table public.tasks add column wake_requested boolean not null default false;
