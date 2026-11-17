-- Requests are still actionable before someone first opens My Agent.
-- A restricted identity must never expose its private notification counts.
do $$ declare d text; begin
  d:=pg_get_functiondef('public.notification_snapshot(uuid,text,uuid)'::regprocedure);
  d:=replace(d,'begin', 'begin
    if public.account_is_restricted(p_user) then return jsonb_build_object(''total'',0,''chats'',0,''contacts'',0,''groups'',0,''communities'',0,''attention'',0,''unread'',''[]''::jsonb); end if;');
  d:=replace(d,'attention:=public.notification_attention(p_user,p_role,p_actor);','attention:=public.notification_attention(p_user,p_role,p_actor);
    if not exists(select 1 from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id and c.kind=''my_agent'' where cm.user_id=p_user) then chats:=chats+attention; end if;');
  d:=replace(d,'and exists(select 1 from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id and c.kind=''my_agent'' where cm.user_id=p_user and not cm.muted)',
    'and not exists(select 1 from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id and c.kind=''my_agent'' where cm.user_id=p_user and cm.muted)');
  execute d;
end $$;
