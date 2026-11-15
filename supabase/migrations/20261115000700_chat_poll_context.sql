drop function public.create_chat_poll(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,jsonb);
create function public.create_chat_poll(p_owner uuid,p_agent uuid,p_origin uuid,p_group uuid,p_thread uuid,p_client uuid,p_question text,p_options jsonb,p_voters jsonb,p_caption text default null,p_reply uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare t uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); m uuid; meta jsonb;
begin
  if not exists(select 1 from public.agents where id=p_agent and owner_id=p_owner)
  or not exists(select 1 from public.conversation_members where conversation_id=p_group and user_id=p_owner)
  or not exists(select 1 from public.conversation_members where conversation_id=p_origin and user_id=p_owner) then raise exception 'Not found'; end if;
  insert into public.tasks(id,owner_id,initiator_agent,conversation_id,group_conversation_id,goal,parsed,status)
  values(t,p_owner,p_agent,p_origin,p_group,p_question,jsonb_build_object('kind','poll','event',p_question,'window','','participants',p_voters-0,'categories','[]'::jsonb),'waiting');
  insert into public.plan_steps(id,task_id,position,type,status,config) values(s,t,0,'poll','waiting',jsonb_build_object('question',p_question,'options',p_options,'voters',p_voters));
  meta:=jsonb_build_object('kind','poll','step_id',s,'task_id',t,'client_id',p_client);
  insert into public.messages(conversation_id,sender_user_id,is_ai_generated,content,metadata,thread_id,reply_to) values(p_origin,p_owner,false,coalesce(nullif(btrim(p_caption),''),p_question),meta,p_thread,p_reply) returning id into m;
  if p_group<>p_origin then insert into public.messages(conversation_id,sender_user_id,is_ai_generated,content,metadata) values(p_group,p_owner,false,coalesce(nullif(btrim(p_caption),''),p_question),meta); end if;
  return m;
end;
$$;
revoke execute on function public.create_chat_poll(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.create_chat_poll(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,uuid) to service_role;
