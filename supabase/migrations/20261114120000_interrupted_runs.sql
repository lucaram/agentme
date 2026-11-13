-- A plan gave up after its 4th run, whatever the reason: "attempts" counted every time a worker
-- picked the task up, including each time a person answered and woke it. A question sent to three
-- people failed when the third answered. Now only runs that were interrupted (a crash, a lost
-- lease) count towards giving up: interrupted_runs goes up when a worker picks the task up and
-- back to zero when a run ends in order (waiting on people, or finished). "attempts" stays as
-- the plain count of how many times the task was picked up.
alter table public.tasks add column interrupted_runs integer not null default 0;

create or replace function public.claim_task(p_task uuid, p_lease_seconds integer)
returns setof public.tasks
language sql security definer set search_path = public as $$
  update public.tasks
     set lease_until = now() + make_interval(secs => p_lease_seconds),
         lease_token = gen_random_uuid(),
         attempts = attempts + 1,
         interrupted_runs = interrupted_runs + 1
   where id = p_task
     and status = 'running'
     and (lease_until is null or lease_until < now())
  returning *;
$$;
revoke execute on function public.claim_task(uuid, integer) from public, anon, authenticated;
