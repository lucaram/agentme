-- Bounded topic navigation. All reads retain the caller's RLS policies.
create index agent_threads_paging_idx on public.agent_threads(owner_id,conversation_id,last_activity_at desc,id desc);

create function public.my_agent_topic_page(p_conversation uuid,p_group text default 'recent',p_before timestamptz default null,p_id uuid default null,p_query text default '',p_as_of timestamptz default now()) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or p_group is null or p_group not in ('needs','progress','recent','older','search')
    or p_query is null or char_length(p_query)>80 or p_as_of is null
    or (p_before is null)<>(p_id is null)
    or not exists(select 1 from public.conversations where id=p_conversation and kind='my_agent' and public.is_conversation_member(id)) then
    raise exception 'Invalid topic request';
  end if;
  with eligible as materialized (
    select th.id,th.kind,th.title,th.last_activity_at,th.last_read_at,tk.status::text task_status,
      case when tk.status::text in ('awaiting_approval','proposal_ready') then 'needs'
        when tk.status::text in ('running','waiting') then 'progress'
        when th.last_activity_at<p_as_of-interval '7 days' then 'older' else 'recent' end topic_group
    from public.agent_threads th
    left join lateral(select t.status from public.agent_thread_tasks x join public.tasks t on t.id=x.task_id where x.thread_id=th.id order by t.created_at desc,t.id desc limit 1) tk on true
    where th.owner_id=auth.uid() and th.conversation_id=p_conversation
      and exists(select 1 from public.messages m where m.thread_id=th.id and m.removed_at is null and m.deleted_at is null)
  ), page as materialized (
    select * from eligible e where (p_group='search' or e.topic_group=p_group)
      and (p_query='' or strpos(lower(e.title),lower(trim(p_query)))>0)
      and (p_before is null or (e.last_activity_at,e.id)<(p_before,p_id))
    order by e.last_activity_at desc,e.id desc limit 11
  ), details as (
    select e.id,e.kind,e.title,e.last_activity_at,e.task_status,e.topic_group,
      (select count(*) from public.messages m where m.thread_id=e.id and m.created_at>e.last_read_at and m.removed_at is null and m.deleted_at is null
        and m.sender_user_id is distinct from auth.uid() and (m.sender_user_id is not null or m.sender_agent_id is not null)
        and not exists(select 1 from public.message_views v where v.message_id=m.id and v.user_id=auth.uid() and v.viewed_at is not null)) unread,
      (select left(m.content,160) from public.messages m where m.thread_id=e.id and m.visible_to is null and m.removed_at is null and m.deleted_at is null
        and (m.sender_user_id is not null or m.sender_agent_id is not null) order by m.created_at desc,m.id desc limit 1) preview
    from (select * from page order by last_activity_at desc,id desc limit 10) e
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(d) order by d.last_activity_at desc,d.id desc) from details d),'[]'),
    'hasMore',(select count(*)>10 from page),'asOf',p_as_of,
    'counts',jsonb_build_object('needs',(select count(*) from eligible where topic_group='needs'),'progress',(select count(*) from eligible where topic_group='progress'),
      'recent',(select count(*) from eligible where topic_group='recent'),'older',(select count(*) from eligible where topic_group='older'))) into result;
  return result;
end $$;
revoke execute on function public.my_agent_topic_page(uuid,text,timestamptz,uuid,text,timestamptz) from public,anon;
grant execute on function public.my_agent_topic_page(uuid,text,timestamptz,uuid,text,timestamptz) to authenticated;
