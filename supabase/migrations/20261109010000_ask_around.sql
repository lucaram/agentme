-- "Ask around": ask your contacts for recommendations through their agents.

alter table public.plan_steps drop constraint plan_steps_type_check;
alter table public.plan_steps add constraint plan_steps_type_check check (type in (
  'collect', 'proposal', 'rsvp', 'poll', 'question', 'recall', 'assign', 'threshold', 'change', 'announce', 'ask_around'
));

-- "Friends can ask me for recommendations" (Settings). On by default.
alter table public.agents add column recommendations_ok boolean not null default true;

-- Tips your agent may share by itself when a friend asks around about that topic.
create table public.agent_tips (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  topic text not null check (char_length(topic) between 2 and 80),
  tip text not null check (char_length(tip) between 1 and 500),
  created_at timestamptz not null default now()
);
create index agent_tips_agent_idx on public.agent_tips (agent_id);
alter table public.agent_tips enable row level security;
create policy agent_tips_read_own on public.agent_tips for select to authenticated using (agent_id = public.my_agent_id());
