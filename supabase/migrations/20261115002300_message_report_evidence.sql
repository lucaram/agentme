alter table public.platform_cases drop constraint platform_cases_target_kind_check;
alter table public.platform_cases add constraint platform_cases_target_kind_check check(target_kind in ('group','community','message'));
alter table public.platform_cases add column source_conversation uuid references public.conversations(id) on delete set null;
alter table public.platform_cases add column message_id uuid references public.messages(id) on delete set null;
alter table public.platform_cases add column subject_user_id uuid references auth.users(id) on delete set null;
alter table public.platform_cases add column rules text;
alter table public.platform_reports drop constraint platform_reports_category_check;
alter table public.platform_reports add constraint platform_reports_category_check check(category in ('spam','scam','abuse','hate','privacy','other'));
alter table public.reports add column evidence jsonb not null default '[]';
alter table public.reports add column category text not null default 'other';

-- This private helper reads only explicitly selected, currently accessible shared messages.
create function public.snapshot_report_evidence(p_conversation uuid,p_community uuid,p_ids uuid[],p_actor uuid,p_versions jsonb default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare snapshots jsonb; total integer;
begin
  if coalesce(cardinality(p_ids),0)>5 then raise exception 'Select up to five evidence messages'; end if;
  select count(*),coalesce(jsonb_agg(jsonb_build_object('id',m.id,'content',m.content,'at',m.created_at,'author',coalesce(a.display_name,'Former member'),'ai',m.is_ai_generated,'version',encode(sha256(convert_to(m.content,'UTF8')),'hex')) order by m.created_at,m.id),'[]'::jsonb)
    into total,snapshots from public.messages m join public.conversations c on c.id=m.conversation_id
    left join lateral(select display_name from public.agents where id=m.sender_agent_id or (m.sender_agent_id is null and owner_id=m.sender_user_id) order by created_at,id limit 1) a on true
    where m.id=any(p_ids) and m.visible_to is null and m.removed_at is null and (m.sender_user_id is not null or m.sender_agent_id is not null)
      and c.kind in ('dm','group','channel','agent_chat') and public.can_read_chat_message(m.id,p_actor)
      and ((p_conversation is not null and c.id=p_conversation) or (p_community is not null and c.community_id=p_community));
  if total<>(select count(distinct value) from unnest(p_ids) value) then raise exception 'Some evidence is no longer available'; end if;
  if p_versions is not null and exists(select 1 from jsonb_array_elements(snapshots) e where p_versions->>(e->>'id') is distinct from e->>'version') then raise exception 'The evidence changed. Review it again before sending.'; end if;
  return snapshots;
end $$;
revoke execute on function public.snapshot_report_evidence(uuid,uuid,uuid[],uuid,jsonb) from public,anon,authenticated;

create or replace function public.capture_platform_conflicts() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  select coalesce(array_agg(distinct user_id),'{}') into new.excluded_reviewers from (
    select user_id from public.conversation_members where conversation_id=new.group_id and role in ('owner','admin')
    union select user_id from public.community_members where community_id=new.community_id and role in ('owner','moderator')
    union select new.subject_user_id where new.subject_user_id is not null
  ) involved;
  return new;
end $$;
create or replace function public.can_review_platform_target(p_kind text,p_target uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_platform_moderator()
    and not exists(select 1 from public.platform_cases c where c.target_kind=p_kind and c.target_key=p_target and auth.uid()=any(c.excluded_reviewers))
    and not exists(select 1 from public.platform_reports r join public.platform_cases c on c.id=r.case_id where c.target_kind=p_kind and c.target_key=p_target and r.reporter_id=auth.uid())
    and case p_kind when 'group' then not exists(select 1 from public.conversation_members where conversation_id=p_target and user_id=auth.uid())
      when 'community' then not exists(select 1 from public.community_members where community_id=p_target and user_id=auth.uid())
      when 'message' then not exists(select 1 from public.platform_cases c join public.conversation_members cm on cm.conversation_id=c.source_conversation where c.target_kind='message' and c.target_key=p_target and cm.user_id=auth.uid()) else false end;
$$;

drop function public.submit_platform_report(text,uuid,text,text,uuid[],uuid);
create function public.submit_platform_report(p_kind text,p_target uuid,p_category text,p_reason text,p_evidence uuid[] default '{}',p_actor uuid default auth.uid(),p_versions jsonb default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=p_actor; c public.platform_cases; existing uuid; title_value text; description_value text; rules_value text; evidence_value jsonb; permitted boolean;
  conv public.conversations; msg public.messages; subject uuid;
begin
  if u is null or not coalesce(u=auth.uid() or auth.role()='service_role',false) or p_kind is null or p_kind not in ('group','community','message') or p_category is null or p_category not in ('spam','scam','abuse','hate','privacy','other') or p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 or coalesce(cardinality(p_evidence),0)>5 then raise exception 'Invalid report'; end if;
  if p_kind='message' then
    select * into msg from public.messages where id=p_target and visible_to is null and removed_at is null and (sender_user_id is not null or sender_agent_id is not null);
    if not found or not public.can_read_chat_message(msg.id,u) then raise exception 'Message unavailable'; end if;
    select * into conv from public.conversations where id=msg.conversation_id;
    if conv.kind not in ('dm','group','channel','agent_chat') then raise exception 'Message unavailable'; end if;
    if not p_target=any(coalesce(p_evidence,'{}')) then raise exception 'Include the reported message as evidence'; end if;
    if conv.community_id is not null then perform 1 from public.communities where id=conv.community_id for update; end if;
    perform 1 from public.conversations where id=conv.id for update;
    select coalesce(msg.sender_user_id,(select owner_id from public.agents where id=msg.sender_agent_id)) into subject;
    title_value:='Message in '||coalesce(conv.title,case when conv.kind='dm' then 'a direct chat' else 'an agent chat' end);
    description_value:=null;
    evidence_value:=public.snapshot_report_evidence(conv.id,null,p_evidence,u,p_versions);
  elsif p_kind='group' then
    select * into conv from public.conversations where id=p_target and kind='group' for update;
    if not found or not exists(select 1 from public.conversation_members where conversation_id=p_target and user_id=u) then raise exception 'Group unavailable'; end if;
    title_value:=conv.title; description_value:=conv.description;
    evidence_value:=public.snapshot_report_evidence(p_target,null,p_evidence,u,p_versions);
  else
    select name,description,rules into title_value,description_value,rules_value from public.communities where id=p_target for update;
    if not found or not exists(select 1 from public.community_members where community_id=p_target and user_id=u) then raise exception 'Community unavailable'; end if;
    evidence_value:=public.snapshot_report_evidence(null,p_target,p_evidence,u,p_versions);
  end if;
  select * into c from public.platform_cases where target_kind=p_kind and target_key=p_target and status<>'closed' for update;
  if c.id is not null then
    select id into existing from public.platform_reports where case_id=c.id and reporter_id=u;
    if found then return jsonb_build_object('id',existing,'case_id',c.id,'duplicate',true); end if;
  end if;
  if exists(select 1 from public.platform_reports r join public.platform_cases pc on pc.id=r.case_id where r.reporter_id=u and pc.target_kind=p_kind and pc.target_key=p_target and r.created_at>now()-interval '1 day') then raise exception 'You have already reported this today'; end if;
  select allowed into permitted from public.rate_limit_hit('platformReports:'||u::text,86400,5);
  if not permitted then raise exception 'Too many reports. Try again tomorrow.'; end if;
  if c.id is null then
    insert into public.platform_cases(target_kind,target_key,group_id,community_id,source_conversation,message_id,subject_user_id,title,description,rules)
    values(p_kind,p_target,case when p_kind='group' or (p_kind='message' and conv.kind='group') then conv.id end,
      case when p_kind='community' then p_target when p_kind='message' then conv.community_id end,
      case when p_kind='message' then conv.id end,case when p_kind='message' then msg.id end,subject,coalesce(title_value,'Group'),description_value,rules_value) returning * into c;
  end if;
  insert into public.platform_reports(case_id,reporter_id,category,reason,evidence) values(c.id,u,p_category,btrim(p_reason),evidence_value) returning id into existing;
  update public.platform_cases set updated_at=now(),revision=revision+1 where id=c.id;
  return jsonb_build_object('id',existing,'case_id',c.id,'duplicate',false);
end $$;
revoke execute on function public.submit_platform_report(text,uuid,text,text,uuid[],uuid,jsonb) from public,anon;
grant execute on function public.submit_platform_report(text,uuid,text,text,uuid[],uuid,jsonb) to authenticated,service_role;

create function public.submit_local_message_report(p_message uuid,p_reason text,p_category text default 'other',p_evidence uuid[] default null,p_actor uuid default auth.uid(),p_versions jsonb default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=p_actor; msg public.messages; conv public.conversations; saved uuid; snapshots jsonb; allowed boolean;
begin
  if u is null or not coalesce(u=auth.uid() or auth.role()='service_role',false) or p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 or p_category is null or p_category not in ('spam','scam','abuse','hate','privacy','other') then raise exception 'Invalid report'; end if;
  select * into msg from public.messages where id=p_message and visible_to is null and removed_at is null;
  if not found or not public.can_read_chat_message(msg.id,u) then raise exception 'Message unavailable'; end if;
  select * into conv from public.conversations where id=msg.conversation_id and kind in ('group','channel');
  if not found then raise exception 'Local moderation is only available in groups and communities'; end if;
  p_evidence:=coalesce(p_evidence,array[p_message]);
  if not p_message=any(p_evidence) then raise exception 'Include the reported message as evidence'; end if;
  snapshots:=public.snapshot_report_evidence(conv.id,null,p_evidence,u,p_versions);
  perform pg_advisory_xact_lock(hashtextextended('local-report:'||u::text||':'||p_message::text,0));
  select id into saved from public.reports where message_id=p_message and reporter_id=u and status='open' limit 1;
  if found then return saved; end if;
  select r.allowed into allowed from public.rate_limit_hit('localReports:'||u::text,86400,10) r;
  if not allowed then raise exception 'Too many reports. Try again tomorrow.'; end if;
  insert into public.reports(reporter_id,conversation_id,community_id,message_id,excerpt,reason,category,evidence)
    values(u,conv.id,conv.community_id,msg.id,left(msg.content,500),btrim(p_reason),p_category,snapshots) returning id into saved;
  return saved;
end $$;
revoke execute on function public.submit_local_message_report(uuid,text,text,uuid[],uuid,jsonb) from public,anon;
grant execute on function public.submit_local_message_report(uuid,text,text,uuid[],uuid,jsonb) to authenticated,service_role;
