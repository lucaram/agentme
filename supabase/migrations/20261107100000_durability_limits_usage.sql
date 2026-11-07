-- Durable coordination, rate limiting and AI usage/cost tracking.

-- ---------------------------------------------------------------- task leases
-- A worker must hold an unexpired lease to advance a running task. If the
-- server dies mid-task the lease expires and the recovery sweeper resumes it.
alter table public.tasks
  add column attempts integer not null default 0,
  add column lease_until timestamptz,
  add column lease_token uuid;

create index tasks_running_idx on public.tasks (lease_until) where status = 'running';

-- Atomically take (or take over an expired) lease. Returns the task only to the winner.
create function public.claim_task(p_task uuid, p_lease_seconds integer)
returns setof public.tasks
language sql security definer set search_path = public as $$
  update public.tasks
     set lease_until = now() + make_interval(secs => p_lease_seconds),
         lease_token = gen_random_uuid(),
         attempts = attempts + 1
   where id = p_task
     and status = 'running'
     and (lease_until is null or lease_until < now())
  returning *;
$$;

-- Extend a lease the caller still holds. False means it was lost: stop working.
create function public.renew_task_lease(p_task uuid, p_token uuid, p_lease_seconds integer)
returns boolean
language sql security definer set search_path = public as $$
  with updated as (
    update public.tasks
       set lease_until = now() + make_interval(secs => p_lease_seconds)
     where id = p_task and status = 'running' and lease_token = p_token
    returning 1
  )
  select exists (select 1 from updated);
$$;

-- ---------------------------------------------------------------- rate limits
-- Fixed-window counters shared by every app instance.
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security; -- no policies: server only

create function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c integer;
begin
  insert into public.rate_limits (key, window_start, count) values (p_key, w, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into c;
  return query select
    c <= p_max,
    case when c <= p_max then 0
         else greatest(1, ceil(extract(epoch from (w + make_interval(secs => p_window_seconds) - now())))::integer)
    end;
end $$;

-- ---------------------------------------------------------------- AI usage
create table public.llm_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Who the call was made for. task_id groups every call of a coordination,
  -- including the replies other agents produced for it.
  task_id uuid references public.tasks (id) on delete set null,
  agent_id uuid references public.agents (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  purpose text not null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  ok boolean not null default true
);
create index llm_usage_task_idx on public.llm_usage (task_id);
create index llm_usage_user_idx on public.llm_usage (user_id, created_at desc);

alter table public.llm_usage enable row level security;
-- Users see usage they caused directly, and every call made for their own tasks.
create policy llm_usage_read on public.llm_usage
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.tasks t where t.id = task_id and t.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------- lock down
revoke execute on function public.claim_task(uuid, integer) from public, anon, authenticated;
revoke execute on function public.renew_task_lease(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
