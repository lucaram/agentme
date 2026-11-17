-- Only a revision is published across workspaces. Message bodies and private
-- business data keep their existing RLS; counts are fetched after authorization.
create table public.identity_notification_versions(user_id uuid primary key references auth.users(id) on delete cascade,revision bigint not null default 1);
alter table public.identity_notification_versions enable row level security;
revoke all on public.identity_notification_versions from public,anon,authenticated;
grant select on public.identity_notification_versions to authenticated;
grant all on public.identity_notification_versions to service_role;
create policy own_notification_revision on public.identity_notification_versions for select to authenticated using(user_id=auth.uid());
alter publication supabase_realtime add table public.identity_notification_versions;

create function public.bump_identity_notifications(p_users uuid[]) returns void language sql security definer set search_path=public,pg_temp as $$
  insert into public.identity_notification_versions(user_id)
    select u.id from auth.users u where u.id in (select unnest(p_users) union select m.user_id from public.business_managers m join public.agents a on a.id=m.business_agent_id where a.owner_id=any(p_users))
  on conflict(user_id) do update set revision=public.identity_notification_versions.revision+1;
$$;

create function public.notification_data_changed() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare n jsonb:=to_jsonb(new); o jsonb:=to_jsonb(old); r jsonb:=coalesce(n,o); targets uuid[]:='{}'; conversation uuid; community uuid; business uuid; who uuid;
begin
  if tg_table_name='messages' then
    conversation:=(r->>'conversation_id')::uuid;
    select array_agg(user_id) into targets from public.conversation_members where conversation_id=conversation and (r->>'visible_to' is null or user_id=(r->>'visible_to')::uuid);
  elsif tg_table_name in ('message_views','conversation_members','community_members','agent_threads','inbox_items','notices','platform_notifications','platform_moderators','platform_operators') then
    targets:=array_remove(array[(n->>'user_id')::uuid,(o->>'user_id')::uuid,(n->>'owner_id')::uuid,(o->>'owner_id')::uuid],null);
  elsif tg_table_name='tasks' then targets:=array[(r->>'owner_id')::uuid];
  elsif tg_table_name='contacts' then
    select array_agg(owner_id) into targets from public.agents where id in ((n->>'requester_agent')::uuid,(n->>'addressee_agent')::uuid,(o->>'requester_agent')::uuid,(o->>'addressee_agent')::uuid);
  elsif tg_table_name='business_managers' then
    business:=(r->>'business_agent_id')::uuid;
    select array_agg(id) into targets from (select (n->>'user_id')::uuid id union select (o->>'user_id')::uuid union select owner_id from public.agents where id=business) people;
  elsif tg_table_name='agents' then targets:=array[(r->>'owner_id')::uuid];
  elsif tg_table_name in ('business_question_claims','business_answer_drafts') then
    select array_agg(owner_id) into targets from public.agents where id=(r->>'business_agent_id')::uuid;
  elsif tg_table_name in ('join_requests','reports') then
    conversation:=(r->>'conversation_id')::uuid; community:=(r->>'community_id')::uuid;
    select array_agg(user_id) into targets from (select user_id from public.conversation_members where conversation_id=conversation and role in ('owner','admin') union select user_id from public.community_members where community_id=community and role in ('owner','moderator')) people;
  elsif tg_table_name in ('platform_cases','platform_account_appeals','platform_reports','platform_evidence_requests','platform_account_sanctions') then
    select array_agg(user_id) into targets from public.platform_moderators where enabled;
    targets:=coalesce(targets,'{}')||array_remove(array[(r->>'user_key')::uuid,(r->>'reporter_id')::uuid],null);
    if tg_table_name='platform_evidence_requests' then targets:=targets||array(select reporter_id from public.platform_reports where id=(r->>'report_id')::uuid); end if;
  end if;
  perform public.bump_identity_notifications(coalesce(targets,'{}'));
  return null;
end $$;
revoke execute on function public.bump_identity_notifications(uuid[]),public.notification_data_changed() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['messages','message_views','conversation_members','community_members','agent_threads','tasks','inbox_items','notices','contacts','join_requests','reports','platform_cases','platform_reports','platform_notifications','platform_evidence_requests','platform_account_appeals','platform_account_sanctions','platform_moderators','platform_operators','business_managers','business_question_claims','business_answer_drafts','agents'] loop
    execute format('create trigger identity_notifications_changed after insert or update or delete on public.%I for each row execute function public.notification_data_changed()',t);
  end loop;
end $$;
