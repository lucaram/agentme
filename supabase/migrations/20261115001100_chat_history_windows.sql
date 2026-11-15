-- Stable keyset paging: equal timestamps never duplicate or skip messages.
create index messages_history_cursor on public.messages(conversation_id,created_at,id);
create index messages_thread_cursor on public.messages(thread_id,created_at,id) where thread_id is not null;

create function public.chat_history_page(p_conversation uuid,p_thread uuid default null,p_mode text default 'initial',p_anchor uuid default null,p_ids uuid[] default '{}')
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); c public.conversations; baseline timestamptz; anchor public.messages; first_row public.messages; last_row public.messages;
  first_unread uuid; latest uuid; wanted uuid[]:='{}'; rows_json jsonb; unread_ids jsonb; later_unread bigint;
begin
  if u is null or p_mode not in ('initial','latest','around','before','after','refresh') or coalesce(cardinality(p_ids),0)>50 then raise exception 'Invalid history request'; end if;
  select * into c from public.conversations where id=p_conversation;
  if not found then raise exception 'Chat not found'; end if;
  select last_read_at into baseline from public.conversation_members where conversation_id=p_conversation and user_id=u;
  if not found then raise exception 'Chat not found'; end if;
  if c.kind='my_agent' then
    select last_read_at into baseline from public.agent_threads where id=p_thread and conversation_id=p_conversation and owner_id=u;
    if not found then raise exception 'Request not found'; end if;
  elsif p_thread is not null then raise exception 'Invalid request thread'; end if;

  select m.id into first_unread from public.messages m
    where m.conversation_id=p_conversation and (p_thread is null or m.thread_id=p_thread) and m.created_at>baseline
      and m.removed_at is null and m.sender_user_id is distinct from u and (m.sender_user_id is not null or m.sender_agent_id is not null)
      and not exists(select 1 from public.message_views v where v.message_id=m.id and v.user_id=u and v.viewed_at is not null)
    order by m.created_at,m.id limit 1;
  select m.id into latest from public.messages m where m.conversation_id=p_conversation and (p_thread is null or m.thread_id=p_thread) order by m.created_at desc,m.id desc limit 1;

  if p_mode='initial' then
    if first_unread is null then p_mode:='latest'; else p_mode:='around'; p_anchor:=first_unread; end if;
  end if;
  if p_mode in ('around','before','after') then
    select * into anchor from public.messages where id=p_anchor and conversation_id=p_conversation and (p_thread is null or thread_id=p_thread);
    if not found then raise exception 'Message not found'; end if;
  end if;
  if p_mode='latest' then
    select array_agg(x.id) into wanted from (select m.id from public.messages m where m.conversation_id=p_conversation and (p_thread is null or m.thread_id=p_thread) order by m.created_at desc,m.id desc limit 50) x;
  elsif p_mode='before' then
    select array_agg(x.id) into wanted from (select m.id from public.messages m where m.conversation_id=p_conversation and (p_thread is null or m.thread_id=p_thread) and (m.created_at,m.id)<(anchor.created_at,anchor.id) order by m.created_at desc,m.id desc limit 50) x;
  elsif p_mode='after' then
    select array_agg(x.id) into wanted from (select m.id from public.messages m where m.conversation_id=p_conversation and (p_thread is null or m.thread_id=p_thread) and (m.created_at,m.id)>(anchor.created_at,anchor.id) order by m.created_at,m.id limit 50) x;
  elsif p_mode='around' then
    select array_agg(x.id) into wanted from (
      (select m.id from public.messages m where m.conversation_id=p_conversation and (p_thread is null or m.thread_id=p_thread) and (m.created_at,m.id)<(anchor.created_at,anchor.id) order by m.created_at desc,m.id desc limit 20)
      union all
      (select m.id from public.messages m where m.conversation_id=p_conversation and (p_thread is null or m.thread_id=p_thread) and (m.created_at,m.id)>=(anchor.created_at,anchor.id) order by m.created_at,m.id limit 30)
    ) x;
  else
    select array_agg(m.id) into wanted from public.messages m where m.id=any(p_ids) and m.conversation_id=p_conversation and (p_thread is null or m.thread_id=p_thread);
  end if;
  wanted:=coalesce(wanted,'{}');
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]'::jsonb) into rows_json from public.messages m where m.id=any(wanted);
  select * into first_row from public.messages m where m.id=any(wanted) order by m.created_at,m.id limit 1;
  select * into last_row from public.messages m where m.id=any(wanted) order by m.created_at desc,m.id desc limit 1;
  select coalesce(jsonb_agg(m.id),'[]'::jsonb) into unread_ids from public.messages m
    where m.id=any(wanted) and m.created_at>baseline and m.removed_at is null and m.sender_user_id is distinct from u
      and (m.sender_user_id is not null or m.sender_agent_id is not null)
      and not exists(select 1 from public.message_views v where v.message_id=m.id and v.user_id=u and v.viewed_at is not null);
  select count(*) into later_unread from public.messages m
    where m.conversation_id=p_conversation and (p_thread is null or m.thread_id=p_thread) and (m.created_at,m.id)>(last_row.created_at,last_row.id)
      and m.created_at>baseline and m.removed_at is null and m.sender_user_id is distinct from u and (m.sender_user_id is not null or m.sender_agent_id is not null)
      and not exists(select 1 from public.message_views v where v.message_id=m.id and v.user_id=u and v.viewed_at is not null);
  return jsonb_build_object('messages',rows_json,'firstUnread',first_unread,'latestId',latest,'unreadIds',unread_ids,'unreadAfter',later_unread,
    'hasBefore',exists(select 1 from public.messages m where m.conversation_id=p_conversation and (p_thread is null or m.thread_id=p_thread) and (m.created_at,m.id)<(first_row.created_at,first_row.id)),
    'hasAfter',exists(select 1 from public.messages m where m.conversation_id=p_conversation and (p_thread is null or m.thread_id=p_thread) and (m.created_at,m.id)>(last_row.created_at,last_row.id)));
end $$;
revoke execute on function public.chat_history_page(uuid,uuid,text,uuid,uuid[]) from public,anon;
grant execute on function public.chat_history_page(uuid,uuid,text,uuid,uuid[]) to authenticated;
