create or replace function public.business_queue_changed() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.business_queue_versions(agent_id) select id from public.agents where id=coalesce(new.business_agent_id,old.business_agent_id)
    on conflict(agent_id) do update set revision=public.business_queue_versions.revision+1;
  return null;
end $$;

-- Direct authenticated inserts also preserve the actual person's authorship;
-- server sends use the atomic service-only posting function.
create function public.capture_business_message_actor() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare business uuid:=public.my_agent_id(); role_name text:=public.workspace_role();
begin
  if auth.uid() is not null and role_name is not null and new.sender_user_id=public.workspace_user_id() and not new.is_ai_generated then
    insert into public.business_message_authors(message_id,business_agent_id,actor_id,actor_name,role)
    values(new.id,business,auth.uid(),public.business_actor_name(auth.uid()),role_name) on conflict do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.capture_business_message_actor() from public,anon,authenticated;
create trigger business_message_actor after insert on public.messages for each row execute function public.capture_business_message_actor();
