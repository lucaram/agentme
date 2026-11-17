create table public.business_work_events(
  id uuid primary key default gen_random_uuid(), business_agent_id uuid not null references public.agents(id) on delete cascade,
  kind text not null check(kind in ('assigned','answered','declined','faq_published')), source_key text not null,
  inbox_id uuid references public.inbox_items(id) on delete set null,
  actor_id uuid, actor_name text not null, actor_handle text, actor_role text,
  supervisor_id uuid, supervisor_name text, supervisor_handle text,
  occurred_at timestamptz not null, received_at timestamptz,
  unique(business_agent_id,kind,source_key)
);
create index business_work_event_scope on public.business_work_events(business_agent_id,supervisor_id,occurred_at);
create index business_work_event_person on public.business_work_events(business_agent_id,actor_id,occurred_at);
alter table public.business_work_events enable row level security;
revoke all on public.business_work_events from public,anon,authenticated;
grant all on public.business_work_events to service_role;

create function public.record_business_work_event(p_business uuid,p_actor uuid,p_kind text,p_source text,p_inbox uuid,p_at timestamptz,p_received timestamptz,p_name text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare supervisor uuid; role_name text; started timestamptz;
begin
  if not exists(select 1 from public.agents where id=p_business and type='business') or p_actor is null then return; end if;
  select tracking_since into started from public.business_team_settings where business_agent_id=p_business;
  select role into role_name from public.business_managers where business_agent_id=p_business and user_id=p_actor;
  if p_at>=started then
    select supervisor_id into supervisor from public.business_team_history where business_agent_id=p_business and staff_id=p_actor and started_at<=p_at and (ended_at is null or ended_at>p_at) order by started_at desc limit 1;
    if found then role_name:='staff'; elsif role_name in ('owner','manager') then supervisor:=p_actor; end if;
  else role_name:=null; end if;
  insert into public.business_work_events(business_agent_id,kind,source_key,inbox_id,actor_id,actor_name,actor_handle,actor_role,supervisor_id,supervisor_name,supervisor_handle,occurred_at,received_at)
    values(p_business,p_kind,p_source,p_inbox,p_actor,coalesce((select display_name from public.agents where owner_id=p_actor),p_name,'Former team member'),(select handle from public.agents where owner_id=p_actor),role_name,supervisor,
      (select display_name from public.agents where owner_id=supervisor),(select handle from public.agents where owner_id=supervisor),p_at,p_received)
    on conflict(business_agent_id,kind,source_key) do nothing;
end $$;
create function public.capture_business_work_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.inbox_items;
begin
  if tg_table_name='business_question_claims' then
    select * into item from public.inbox_items where id=new.inbox_id;
    if new.assigned_to is not null and (tg_op='INSERT' or new.assigned_to is distinct from old.assigned_to) then
      perform public.record_business_work_event(new.business_agent_id,new.assigned_to,'assigned',gen_random_uuid()::text,new.inbox_id,now(),item.created_at);
    end if;
    if new.handled_at is not null and new.handled_by is not null and (tg_op='INSERT' or old.handled_at is null) then
      perform public.record_business_work_event(new.business_agent_id,new.handled_by,case when item.status='declined' then 'declined' else 'answered' end,new.inbox_id::text,new.inbox_id,new.handled_at,item.created_at);
    end if;
  elsif new.status='approved' and (tg_op='INSERT' or old.status<>'approved') then
    perform public.record_business_work_event(new.business_agent_id,new.author_id,'faq_published',new.id::text,new.source_inbox,coalesce(new.reviewed_at,now()),new.created_at,new.author_name);
  end if;
  return null;
end $$;
create trigger capture_business_work_event after insert or update on public.business_question_claims for each row execute function public.capture_business_work_event();
create trigger capture_business_work_event after insert or update on public.business_answer_drafts for each row execute function public.capture_business_work_event();

alter table public.business_staff_audit add column supervisor_id uuid;
create function public.attribute_business_audit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  select case when role='staff' then supervisor_id else user_id end into new.supervisor_id from public.business_managers where business_agent_id=new.business_agent_id and user_id=new.actor_id;
  return new;
end $$;
create trigger attribute_business_audit before insert on public.business_staff_audit for each row execute function public.attribute_business_audit();
create policy team_audit_scope on public.business_staff_audit as restrictive for select to authenticated using(public.workspace_role()='owner' or (public.workspace_role()='manager' and (supervisor_id=auth.uid() or actor_id=auth.uid())));

revoke execute on function public.record_business_work_event(uuid,uuid,text,text,uuid,timestamptz,timestamptz,text),public.capture_business_work_event(),public.attribute_business_audit() from public,anon,authenticated;
