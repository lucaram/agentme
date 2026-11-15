-- Moderation updates must reach My Agent even if the recipient has never opened it before.
create function public.ensure_moderation_agent_home() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare conversation uuid;
begin
  if tg_table_name='platform_moderators' then if not new.enabled then return null; end if; end if;
  perform pg_advisory_xact_lock(hashtextextended('my-agent:'||new.user_id::text,0));
  select c.id into conversation from public.conversations c join public.conversation_members cm on cm.conversation_id=c.id where c.kind='my_agent' and cm.user_id=new.user_id limit 1;
  if conversation is null then
    insert into public.conversations(kind,created_by) values('my_agent',new.user_id) returning id into conversation;
    insert into public.conversation_members(conversation_id,user_id) values(conversation,new.user_id);
  end if;
  return null;
end $$;
revoke execute on function public.ensure_moderation_agent_home() from public,anon,authenticated;
create trigger platform_notification_agent_home after insert on public.platform_notifications for each row execute function public.ensure_moderation_agent_home();
create trigger platform_reviewer_agent_home after insert or update of enabled on public.platform_moderators for each row execute function public.ensure_moderation_agent_home();

-- A paused group does not keep asking people to join it. Invitations resume if it is restored.
create or replace function public.open_group_invitation(p_item uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.inbox_items i join public.conversations c on c.id::text=i.payload->>'conversation_id'
    where i.id=p_item and i.owner_id=auth.uid() and i.kind='group_invite' and i.status='open' and i.created_at>now()-interval '7 days' and not c.platform_suspended
    and not exists(select 1 from public.conversation_blocks where conversation_id=c.id and user_id=i.owner_id)
    and exists(select 1 from public.conversation_members cm join public.agents a on a.owner_id=cm.user_id where cm.conversation_id=c.id and cm.role in ('owner','admin') and a.id=i.from_agent));
$$;
