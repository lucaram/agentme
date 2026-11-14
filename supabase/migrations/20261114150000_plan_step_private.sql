-- What participants' agents (or the participants themselves) told the organiser while a plan
-- was being put together was stored in plan_steps.result: availability, food, budget and
-- practical needs (collect), personal answers (question), tips (ask_around). plan_steps is
-- readable by every member of the group the plan is shared in, so people who are not the
-- participant's contacts could read what was shared with the organiser only, by querying
-- the database directly (the app never showed it).
--
-- Those results now live in a table of their own that only the server reads. plan_steps.result
-- keeps a marker for these steps, and stays as it is for the steps whose result is for the
-- group (a poll's outcome, who's in, a sign-up list).
create table public.plan_step_private (
  step_id uuid primary key references public.plan_steps (id) on delete cascade,
  result jsonb not null,
  updated_at timestamptz not null default now()
);
create trigger plan_step_private_touch before update on public.plan_step_private
for each row execute function public.touch_updated_at();
alter table public.plan_step_private enable row level security; -- no policies: server only

-- Move what is already stored, then remove it from the row group members can read.
insert into public.plan_step_private (step_id, result)
select s.id, s.result
from public.plan_steps s
where s.type in ('collect', 'question', 'ask_around') and s.result is not null and s.result <> 'null'::jsonb
on conflict (step_id) do nothing;

update public.plan_steps
set result = '{"private": true}'::jsonb
where type in ('collect', 'question', 'ask_around') and result is not null and result <> 'null'::jsonb;
