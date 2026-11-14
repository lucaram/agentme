-- A request to join a group that came from a plan's invite link remembers the plan, so that
-- when the group's admins approve it the person joins the plan too (its participants and open
-- polls), not only the group. Before, approval added them to the group and left them out of
-- the plan they had been invited to.
alter table public.join_requests add column task_id uuid references public.tasks (id) on delete set null;
