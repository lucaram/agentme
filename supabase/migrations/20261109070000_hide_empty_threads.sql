-- My Agent: empty threads (no messages, e.g. their plan was deleted) are never
-- listed, and existing empty ones are removed.

create or replace function public.my_agent_threads()
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
    -- A request with nothing in it (e.g. its plan was deleted) is not listed.
    and exists (select 1 from public.messages m where m.thread_id = th.id)
  order by th.last_activity_at desc
$$;


delete from public.agent_threads th
where not exists (select 1 from public.messages m where m.thread_id = th.id)
  and not exists (select 1 from public.agent_thread_tasks x where x.thread_id = th.id)
  and th.created_at < now() - interval '1 minute';
