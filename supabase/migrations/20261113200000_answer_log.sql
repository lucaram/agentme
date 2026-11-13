-- How each question to a business's agent was answered, so the owner (and we) can see how
-- often the agent answers from what it has read, finds the page on the website, or needs the
-- team. No question text is stored: only the step and when.
create table public.business_answer_log (
  id bigint generated always as identity primary key,
  agent_id uuid not null references public.agents (id) on delete cascade,
  -- knowledge: from what it had read; index: a page found by its address; search: a page found by
  -- searching the business's own website; team: handed to the team; none: no answer and no hand-off.
  step text not null check (step in ('knowledge', 'index', 'search', 'team', 'none')),
  created_at timestamptz not null default now()
);
create index business_answer_log_agent_idx on public.business_answer_log (agent_id, created_at);
alter table public.business_answer_log enable row level security; -- server only
