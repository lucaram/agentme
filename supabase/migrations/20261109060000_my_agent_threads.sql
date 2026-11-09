-- My Agent, one thread per request (like a list of recent chats): each request
-- gets its own thread with a title, a status (from its plan) and its own
-- unread badge. Every message posted into My Agent is filed into a thread by
-- the database itself, so no code path can leave one out:
--   - a message about a plan (metadata.task_id) goes to that plan's thread;
--   - a message sent from inside a thread stays there (and links a new plan to it);
--   - anything else (notes, requests from others) goes to "From your agent".

create table public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  kind text not null default 'request' check (kind in ('request', 'updates')),
  title text not null default 'New request' check (char_length(title) between 1 and 120),
  renamed boolean not null default false,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  last_read_at timestamptz not null default now()
);
create index agent_threads_owner_idx on public.agent_threads (owner_id, last_activity_at desc);
create unique index agent_threads_one_updates on public.agent_threads (conversation_id) where kind = 'updates';

-- A thread can hold several plans (a follow-up plan typed in the same thread).
create table public.agent_thread_tasks (
  task_id uuid primary key references public.tasks (id) on delete cascade,
  thread_id uuid not null references public.agent_threads (id) on delete cascade
);
create index agent_thread_tasks_thread_idx on public.agent_thread_tasks (thread_id);

alter table public.messages add column thread_id uuid references public.agent_threads (id) on delete cascade;
create index messages_thread_idx on public.messages (thread_id, created_at) where thread_id is not null;

alter table public.agent_threads enable row level security;
alter table public.agent_thread_tasks enable row level security;
create policy agent_threads_read on public.agent_threads for select to authenticated using (owner_id = auth.uid());
create policy agent_thread_tasks_read on public.agent_thread_tasks for select to authenticated
  using (exists (select 1 from public.agent_threads th where th.id = thread_id and th.owner_id = auth.uid()));

-- "Dinner with @marco, @paul · Saturday evening": from the plan, no AI needed.
create function public.task_thread_title(p_task uuid) returns text
language sql stable security definer set search_path = public as $$
  select left(
    upper(left(base, 1)) || substr(base, 2)
    || case when jsonb_array_length(coalesce(t.parsed -> 'participants', '[]'::jsonb)) > 0 and base !~ '@'
         then ' with ' || (select string_agg('@' || p, ', ') from jsonb_array_elements_text(t.parsed -> 'participants') p)
         else '' end
    || case when coalesce(t.parsed ->> 'window', '') <> '' then ' · ' || (t.parsed ->> 'window') else '' end,
    120)
  from public.tasks t,
       lateral (select coalesce(nullif(trim(t.parsed ->> 'event'), ''), nullif(trim(t.goal), ''), 'Request') as base) b
  where t.id = p_task
$$;
revoke execute on function public.task_thread_title(uuid) from public, anon, authenticated;

create function public.file_agent_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  conv record;
  v_task uuid;
  v_thread uuid;
begin
  select c.id, c.kind,
         coalesce(c.created_by, (select cm.user_id from public.conversation_members cm where cm.conversation_id = c.id limit 1)) as created_by
    into conv from public.conversations c where c.id = new.conversation_id;
  if conv.kind is distinct from 'my_agent' or conv.created_by is null then
    new.thread_id := null; -- threads only exist in a My Agent that has an owner
    return new;
  end if;
  -- A thread from the app must belong to this My Agent.
  if new.thread_id is not null and not exists (
    select 1 from public.agent_threads where id = new.thread_id and conversation_id = conv.id
  ) then
    new.thread_id := null;
  end if;

  if (new.metadata ->> 'task_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_task := (new.metadata ->> 'task_id')::uuid;
  end if;

  -- Only the owner's own plans have threads in their My Agent (a note about someone
  -- else's plan, e.g. "I sent your answer", is filed like any other note).
  if v_task is not null and exists (select 1 from public.tasks where id = v_task and conversation_id = conv.id) then
    select x.thread_id into v_thread from public.agent_thread_tasks x
      join public.agent_threads th on th.id = x.thread_id and th.conversation_id = conv.id
      where x.task_id = v_task;
    if v_thread is not null then
      new.thread_id := v_thread; -- a plan's messages always go to its thread
    elsif new.thread_id is not null then
      -- A plan started from inside a thread: link it, and name the thread after it (first plan only).
      insert into public.agent_thread_tasks (task_id, thread_id) values (v_task, new.thread_id) on conflict do nothing;
      update public.agent_threads th set title = coalesce(public.task_thread_title(v_task), th.title)
        where th.id = new.thread_id and not th.renamed
          and (select count(*) from public.agent_thread_tasks x where x.thread_id = th.id) = 1;
    else
      -- A plan started elsewhere (e.g. "@agent" in a group): its own thread.
      insert into public.agent_threads (owner_id, conversation_id, title)
        values (conv.created_by, conv.id, coalesce(public.task_thread_title(v_task), 'Request'))
        returning id into v_thread;
      insert into public.agent_thread_tasks (task_id, thread_id) values (v_task, v_thread);
      new.thread_id := v_thread;
    end if;
  end if;

  if new.thread_id is null then
    select id into v_thread from public.agent_threads where conversation_id = conv.id and kind = 'updates';
    if v_thread is null then
      insert into public.agent_threads (owner_id, conversation_id, kind, title, last_read_at)
        values (conv.created_by, conv.id, 'updates', 'From your agent', now() - interval '1 second')
        on conflict do nothing
        returning id into v_thread;
      if v_thread is null then
        select id into v_thread from public.agent_threads where conversation_id = conv.id and kind = 'updates';
      end if;
    end if;
    new.thread_id := v_thread;
  end if;

  update public.agent_threads set last_activity_at = greatest(last_activity_at, coalesce(new.created_at, now()))
    where id = new.thread_id;
  return new;
end $$;

-- ---------------------------------------------------------------- existing history
-- Each existing plan gets a thread with its messages (and the request that started it);
-- everything else goes to "Earlier messages". Read state is kept as it was.
do $$
declare
  t record;
  v_thread uuid;
  c record;
begin
  for t in
    select tk.id, tk.goal, tk.created_at, cv.id as conversation_id, o.owner as created_by
    from public.tasks tk
    join public.conversations cv on cv.id = tk.conversation_id and cv.kind = 'my_agent'
    cross join lateral (select coalesce(cv.created_by, (select cm.user_id from public.conversation_members cm where cm.conversation_id = cv.id limit 1)) as owner) o
    where o.owner is not null
    order by tk.created_at
  loop
    insert into public.agent_threads (owner_id, conversation_id, title, created_at)
      values (t.created_by, t.conversation_id, coalesce(public.task_thread_title(t.id), 'Request'), t.created_at)
      returning id into v_thread;
    insert into public.agent_thread_tasks (task_id, thread_id) values (t.id, v_thread);
    update public.messages set thread_id = v_thread
      where conversation_id = t.conversation_id and thread_id is null and metadata ->> 'task_id' = t.id::text;
    -- The owner's message that started it (sent just before the plan was created).
    update public.messages set thread_id = v_thread
      where id = (
        select m.id from public.messages m
        where m.conversation_id = t.conversation_id and m.thread_id is null and m.sender_user_id is not null
          and m.content = t.goal and m.created_at between t.created_at - interval '10 minutes' and t.created_at + interval '5 seconds'
        order by m.created_at desc limit 1
      );
  end loop;

  for c in
    select distinct m.conversation_id, o.owner as created_by
    from public.messages m
    join public.conversations cv on cv.id = m.conversation_id and cv.kind = 'my_agent'
    cross join lateral (select coalesce(cv.created_by, (select cm.user_id from public.conversation_members cm where cm.conversation_id = cv.id limit 1)) as owner) o
    where m.thread_id is null and o.owner is not null
  loop
    insert into public.agent_threads (owner_id, conversation_id, title, created_at)
      values (c.created_by, c.conversation_id, 'Earlier messages',
              (select min(created_at) from public.messages where conversation_id = c.conversation_id and thread_id is null))
      returning id into v_thread;
    update public.messages set thread_id = v_thread where conversation_id = c.conversation_id and thread_id is null;
  end loop;
end $$;

update public.agent_threads th set
  last_activity_at = coalesce((select max(m.created_at) from public.messages m where m.thread_id = th.id), th.created_at),
  last_read_at = coalesce((select cm.last_read_at from public.conversation_members cm where cm.conversation_id = th.conversation_id and cm.user_id = th.owner_id), now());

create trigger messages_file_agent_message before insert on public.messages
  for each row execute function public.file_agent_message();

-- ---------------------------------------------------------------- reading
-- The thread list: newest activity first, with unread count, latest plan's status and a preview.
create function public.my_agent_threads()
returns table (id uuid, kind text, title text, last_activity_at timestamptz, unread bigint, task_id uuid, task_status text, preview text)
language sql stable security invoker set search_path = public as $$
  select th.id, th.kind, th.title, th.last_activity_at,
         (select count(*) from public.messages m
           where m.thread_id = th.id and m.created_at > th.last_read_at
             and m.sender_user_id is distinct from auth.uid()
             and (m.sender_user_id is not null or m.sender_agent_id is not null)),
         lt.task_id, tk.status::text,
         (select left(m.content, 160) from public.messages m
           where m.thread_id = th.id and m.visible_to is null and (m.sender_user_id is not null or m.sender_agent_id is not null)
           order by m.created_at desc limit 1)
  from public.agent_threads th
  left join lateral (
    select x.task_id from public.agent_thread_tasks x join public.tasks t2 on t2.id = x.task_id
    where x.thread_id = th.id order by t2.created_at desc limit 1
  ) lt on true
  left join public.tasks tk on tk.id = lt.task_id
  where th.owner_id = auth.uid()
  order by th.last_activity_at desc
$$;

create function public.mark_thread_read(p_thread uuid) returns void
language sql security definer set search_path = public as $$
  update public.agent_threads set last_read_at = now() where id = p_thread and owner_id = auth.uid()
$$;
revoke execute on function public.mark_thread_read(uuid) from public, anon;

-- My Agent's counter in Chats: requests with something new (not individual
-- messages), or the requests waiting for your answer, whichever is higher.
create or replace function public.unread_counts()
returns table (conversation_id uuid, unread bigint, muted boolean)
language sql stable security invoker set search_path = public as $$
  select t.conversation_id, max(t.n)::bigint, bool_or(t.muted)
  from (
    select m.conversation_id, count(*) as n, bool_or(cm.muted) as muted
    from public.messages m
    join public.conversation_members cm
      on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
    join public.conversations c on c.id = m.conversation_id and c.kind <> 'my_agent'
    where m.created_at > cm.last_read_at
      and m.sender_user_id is distinct from auth.uid()
      and (m.sender_user_id is not null or m.sender_agent_id is not null)
    group by m.conversation_id
    union all
    select th.conversation_id, count(*) as n, false
    from public.agent_threads th
    where th.owner_id = auth.uid() and exists (
      select 1 from public.messages m
      where m.thread_id = th.id and m.created_at > th.last_read_at
        and m.sender_user_id is distinct from auth.uid()
        and (m.sender_user_id is not null or m.sender_agent_id is not null))
    group by th.conversation_id
    union all
    select cm.conversation_id,
           (select count(*) from public.inbox_items i
             where i.owner_id = auth.uid() and i.status = 'open' and i.kind in ('info_request', 'question')),
           cm.muted
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    where cm.user_id = auth.uid() and c.kind = 'my_agent'
  ) t
  where t.n > 0
  group by t.conversation_id
$$;

alter publication supabase_realtime add table public.agent_threads;
