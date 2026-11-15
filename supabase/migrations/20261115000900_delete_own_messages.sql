-- Owner deletion is distinct from reversible moderation removal.
alter table public.messages add column deleted_at timestamptz;
alter table public.messages add constraint deleted_message_is_removed check(deleted_at is null or removed_at is not null);

create function public.delete_own_message(p_message uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); m public.messages;
begin
  if u is null then raise exception 'Sign in first'; end if;
  select * into m from public.messages
    where id=p_message and sender_user_id=u and sender_agent_id is null and not is_ai_generated
      and (visible_to is null or visible_to=u)
      and exists(select 1 from public.conversation_members cm where cm.conversation_id=messages.conversation_id and cm.user_id=u)
    for update;
  if not found then raise exception 'You can only delete your own messages in this chat.'; end if;
  if m.deleted_at is not null then return m.conversation_id; end if;
  update public.messages set content='Deleted message', metadata=case when metadata ? 'client_id' then jsonb_build_object('client_id',metadata->'client_id') else '{}'::jsonb end,
    reply_to=null, deleted_at=now(), removed_at=now(), removed_by=u where id=m.id;
  -- Reports remain an independent moderation record, but no longer require a removal decision.
  update public.reports set status='resolved',resolved_by=u where message_id=m.id and status='open';
  return m.conversation_id;
end $$;
revoke execute on function public.delete_own_message(uuid) from public,anon;
grant execute on function public.delete_own_message(uuid) to authenticated;

-- An appeal, delayed card update or legacy moderation write must never restore owner-deleted content.
create function public.preserve_deleted_message() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.deleted_at is not null then
    new.deleted_at:=old.deleted_at; new.removed_at:=old.removed_at;
    new.content:='Deleted message'; new.reply_to:=null;
    new.metadata:=case when old.metadata ? 'client_id' then jsonb_build_object('client_id',old.metadata->'client_id') else '{}'::jsonb end;
  end if;
  return new;
end $$;
revoke execute on function public.preserve_deleted_message() from public,anon,authenticated;
create trigger messages_preserve_deletion before update on public.messages for each row execute function public.preserve_deleted_message();

-- Deleting a card removes its media but does not close a poll or cancel an approved activity.
create or replace function public.remove_message_attachments() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.removed_at is not null and old.removed_at is null then
    delete from public.chat_attachments where message_id=new.id;
    if new.deleted_at is null and new.metadata->>'kind'='poll' then
      update public.plan_steps set status='done',result=coalesce(result,'{}'::jsonb)||'{"closed":true}'::jsonb where id::text=new.metadata->>'step_id';
    end if;
  end if;
  return new;
end $$;
