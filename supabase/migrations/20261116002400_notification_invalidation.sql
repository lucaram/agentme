-- Also link historical personal information requests to their action cards.
-- Match the original sender/event template, recipient and narrow creation window.
update public.messages m set metadata=m.metadata||jsonb_build_object('inbox_item_id',(
  select i.id from public.inbox_items i left join public.agents a on a.id=i.from_agent
  where i.kind='info_request' and i.agent_id=m.sender_agent_id and i.owner_id=(select owner_id from public.agents where id=m.sender_agent_id)
    and length(i.payload->>'event')>0 and strpos(m.content,coalesce('@'||a.handle,'Someone')||'''s agent is organising '||(i.payload->>'event')||' and needs something only you can share.')>0
    and m.created_at>=i.created_at-interval '1 second' and m.created_at<=i.created_at+interval '2 minutes'
  order by abs(extract(epoch from m.created_at-i.created_at)),i.id limit 1
)) where m.metadata->>'kind'='request_note' and not m.metadata ? 'inbox_item_id' and exists(
  select 1 from public.inbox_items i left join public.agents a on a.id=i.from_agent
  where i.kind='info_request' and i.agent_id=m.sender_agent_id and length(i.payload->>'event')>0
    and strpos(m.content,coalesce('@'||a.handle,'Someone')||'''s agent is organising '||(i.payload->>'event')||' and needs something only you can share.')>0
    and m.created_at>=i.created_at-interval '1 second' and m.created_at<=i.created_at+interval '2 minutes');

do $$ declare d text; begin
  d:=pg_get_functiondef('public.notification_data_changed()'::regprocedure);
  -- Notify both the old and new audience if a private message changes visibility.
  d:=replace(d,'where conversation_id=conversation and (r->>''visible_to'' is null or user_id=(r->>''visible_to'')::uuid)',
    'where (conversation_id=(n->>''conversation_id'')::uuid and (n->>''visible_to'' is null or user_id=(n->>''visible_to'')::uuid))
       or (conversation_id=(o->>''conversation_id'')::uuid and (o->>''visible_to'' is null or user_id=(o->>''visible_to'')::uuid))');
  d:=replace(d,'''message_views'',''conversation_members''','''group_message_access'',''conversation_blocks'',''message_views'',''conversation_members''');
  d:=replace(d,'elsif tg_table_name=''tasks'' then', 'elsif tg_table_name=''business_staff_invites'' then targets:=array_remove(array[(n->>''recipient_user'')::uuid,(o->>''recipient_user'')::uuid],null);
  elsif tg_table_name=''tasks'' then');
  execute d;
  -- A consistent order also reduces lock contention for shared team updates.
  d:=pg_get_functiondef('public.bump_identity_notifications(uuid[])'::regprocedure);
  d:=replace(d,'on conflict(user_id)', 'order by u.id on conflict(user_id)'); execute d;
end $$;

create trigger identity_notifications_changed after insert or update or delete on public.business_staff_invites for each row execute function public.notification_data_changed();
create trigger identity_notifications_changed after insert or update or delete on public.group_message_access for each row execute function public.notification_data_changed();
create trigger identity_notifications_changed after insert or update or delete on public.conversation_blocks for each row execute function public.notification_data_changed();
