-- Read only the caller's unread, currently accessible messages. Previewing this
-- list never writes message views or read receipts.
create function public.unread_mention_page(p_before timestamptz default null,p_message uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare items jsonb; u uuid:=auth.uid();
begin
  if u is null or (p_before is null)<>(p_message is null) then raise exception 'Invalid mention request'; end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into items from (
    select a.message_id,a.conversation_id,a.created_at,coalesce(sender.display_name,'Someone') sender,coalesce(sender.avatar,'👤') avatar,
      case when c.kind='dm' then coalesce(sender.display_name,'Direct chat') when c.kind='channel' then coalesce(com.name,'Community')||' · '||coalesce(c.title,'Chat') else coalesce(c.title,'Group') end chat_name,
      left(regexp_replace(m.content,'\s+',' ','g'),180) preview
    from public.mention_alerts a join public.messages m on m.id=a.message_id join public.conversations c on c.id=a.conversation_id
    left join public.communities com on com.id=c.community_id
    left join lateral(select display_name,avatar from public.agents where owner_id=m.sender_user_id order by created_at,id limit 1) sender on true
    where a.user_id=u and a.seen_at is null and m.visible_to is null and m.removed_at is null and m.deleted_at is null
      and public.can_read_chat_message(a.message_id,u) and public.is_conversation_member(a.conversation_id)
      and (p_before is null or (a.created_at,a.message_id)<(p_before,p_message))
    order by a.created_at desc,a.message_id desc limit 51
  ) x;
  return jsonb_build_object('items',items-50,'hasMore',jsonb_array_length(items)>50);
end $$;

-- Retain the original overload for older clients. Reconcile only the IDs the
-- caller actually sent, so overlapping live updates cannot drop a newer batch.
create function public.mention_state(p_claim boolean,p_known uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; active jsonb; total bigint; more boolean; u uuid:=auth.uid();
begin
  if u is null or p_known is null or cardinality(p_known)>1000 then raise exception 'Invalid mention request'; end if;
  result:=public.mention_state(p_claim);
  select count(*) into total from public.mention_alerts a where a.user_id=u and a.seen_at is null and public.can_read_chat_message(a.message_id,u) and public.is_conversation_member(a.conversation_id);
  select coalesce(jsonb_agg(a.message_id),'[]') into active from public.mention_alerts a where a.user_id=u and a.seen_at is null and a.message_id=any(p_known) and public.can_read_chat_message(a.message_id,u) and public.is_conversation_member(a.conversation_id);
  select exists(select 1 from public.mention_alerts a where a.user_id=u and a.seen_at is null and a.notified_at is null and a.created_at>now()-interval '30 seconds' and public.can_read_chat_message(a.message_id,u) and public.is_conversation_member(a.conversation_id)) into more;
  return result||jsonb_build_object('total',total,'active_ids',active,'more_alerts',more);
end $$;
revoke execute on function public.unread_mention_page(timestamptz,uuid),public.mention_state(boolean,uuid[]) from public,anon;
grant execute on function public.unread_mention_page(timestamptz,uuid),public.mention_state(boolean,uuid[]) to authenticated;
