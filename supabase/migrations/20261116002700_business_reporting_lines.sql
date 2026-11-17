alter table public.business_managers add column supervisor_id uuid;

create table public.business_team_settings(
  business_agent_id uuid primary key references public.agents(id) on delete cascade,
  default_owner uuid, tracking_since timestamptz not null default now()
);
create table public.business_team_history(
  id uuid primary key default gen_random_uuid(), business_agent_id uuid not null references public.agents(id) on delete cascade,
  staff_id uuid not null, supervisor_id uuid, staff_name text not null, supervisor_name text,
  started_at timestamptz not null default now(), ended_at timestamptz
);
create unique index one_current_reporting_line on public.business_team_history(business_agent_id,staff_id) where ended_at is null;
create table public.business_team_transfers(
  id uuid primary key default gen_random_uuid(), business_agent_id uuid not null references public.agents(id) on delete cascade,
  staff_id uuid not null, from_supervisor uuid not null, to_supervisor uuid not null, requested_by uuid not null,
  staff_name text not null, from_name text not null, to_name text not null, requester_name text not null,
  status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled','expired')),
  created_at timestamptz not null default now(), expires_at timestamptz not null default(now()+interval '7 days'),
  decided_at timestamptz, decided_by uuid, check(from_supervisor<>to_supervisor)
);
create unique index one_pending_staff_transfer on public.business_team_transfers(business_agent_id,staff_id) where status='pending';
create table public.business_work_notices(
  id uuid primary key default gen_random_uuid(), business_agent_id uuid not null references public.agents(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('information','transfer_request')), text text not null,
  transfer_id uuid references public.business_team_transfers(id) on delete cascade,
  created_at timestamptz not null default now(), seen_at timestamptz
);
create index business_work_notice_recipient on public.business_work_notices(business_agent_id,recipient_id,created_at desc);

do $$ declare t text; begin
  foreach t in array array['business_team_settings','business_team_history','business_team_transfers','business_work_notices'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant select on public.business_team_settings,public.business_team_transfers,public.business_work_notices to authenticated;
create policy team_settings_read on public.business_team_settings for select to authenticated using(business_agent_id=public.my_agent_id() and public.business_permission('read'));
create policy team_transfers_read on public.business_team_transfers for select to authenticated using(business_agent_id=public.my_agent_id() and public.business_permission('read') and (public.workspace_role()='owner' or auth.uid() in (staff_id,from_supervisor,to_supervisor,requested_by)));
create policy work_notices_read on public.business_work_notices for select to authenticated using(business_agent_id=public.my_agent_id() and public.business_permission('read') and recipient_id=auth.uid());

create function public.business_default_owner(p_business uuid,p_exclude uuid default null) returns uuid
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(
    (select m.user_id from public.business_team_settings s join public.business_managers m on m.business_agent_id=s.business_agent_id and m.user_id=s.default_owner and m.role='owner' where s.business_agent_id=p_business and m.user_id is distinct from p_exclude and not public.direct_account_restricted(m.user_id)),
    (select m.user_id from public.business_managers m where m.business_agent_id=p_business and m.role='owner' and m.user_id is distinct from p_exclude and not public.direct_account_restricted(m.user_id) order by m.created_at,m.user_id limit 1),
    (select owner_id from public.agents a where a.id=p_business and a.owner_id is distinct from p_exclude and not exists(select 1 from public.business_managers where business_agent_id=p_business))
  );
$$;
insert into public.business_team_settings(business_agent_id,default_owner) select id,public.business_default_owner(id) from public.agents where type='business';
update public.business_managers m set supervisor_id=coalesce(
  (select v.invited_by from public.business_staff_invites v join public.business_managers boss on boss.business_agent_id=v.business_agent_id and boss.user_id=v.invited_by and boss.role in ('owner','manager') where v.business_agent_id=m.business_agent_id and v.recipient_user=m.user_id and v.status='accepted' order by v.responded_at desc,v.created_at desc limit 1),
  public.business_default_owner(m.business_agent_id)) where m.role='staff';
insert into public.business_team_history(business_agent_id,staff_id,supervisor_id,staff_name,supervisor_name)
  select business_agent_id,user_id,supervisor_id,public.business_actor_name(user_id),public.business_actor_name(supervisor_id) from public.business_managers where role='staff';

create function public.business_emit_work_notice(p_business uuid,p_recipient uuid,p_text text,p_transfer uuid default null,p_kind text default 'information') returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.business_managers where business_agent_id=p_business and user_id=p_recipient) and exists(select 1 from auth.users where id=p_recipient) then
    insert into public.business_work_notices(business_agent_id,recipient_id,text,transfer_id,kind) values(p_business,p_recipient,p_text,p_transfer,p_kind);
  end if;
end $$;
create function public.business_finish_team_transfer(p_id uuid,p_status text,p_actor uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.business_team_transfers; who uuid;
begin
  update public.business_team_transfers set status=p_status,decided_at=now(),decided_by=p_actor where id=p_id and status='pending' returning * into t;
  if not found then return; end if;
  update public.business_work_notices set seen_at=coalesce(seen_at,now()) where transfer_id=p_id and kind='transfer_request';
  for who in select distinct id from unnest(case when p_status='accepted' then array[t.requested_by,t.from_supervisor,t.staff_id] else array[t.requested_by,t.from_supervisor] end) id loop
    perform public.business_emit_work_notice(t.business_agent_id,who,case when p_status='accepted' then t.staff_name||' now reports to '||t.to_name||'.' else 'The proposed move of '||t.staff_name||' to '||t.to_name||' was '||p_status||'. Their reporting line has not changed.' end,p_id);
  end loop;
  insert into public.business_staff_audit(business_agent_id,actor_id,actor_name,subject_name,action) values(t.business_agent_id,p_actor,case when p_actor is null then 'System' else public.business_actor_name(p_actor) end,t.staff_name,'Staff transfer '||p_status||': '||t.from_name||' → '||t.to_name);
end $$;
create function public.business_expire_team_transfers(p_business uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare item uuid;
begin
  for item in select id from public.business_team_transfers where business_agent_id=p_business and status='pending' and expires_at<=now() for update loop
    perform public.business_finish_team_transfer(item,'expired',null);
  end loop;
end $$;

create function public.business_reporting_before() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare b uuid:=coalesce(new.business_agent_id,old.business_agent_id); fallback uuid; child record; item uuid;
begin
  if not exists(select 1 from public.agents where id=b) then return case when tg_op='DELETE' then old else new end; end if;
  if tg_op='DELETE' or (tg_op='UPDATE' and old.role in ('owner','manager') and new.role='staff') then
    fallback:=public.business_default_owner(b,old.user_id);
    for child in select user_id from public.business_managers where business_agent_id=b and role='staff' and supervisor_id=old.user_id loop
      update public.business_managers set supervisor_id=fallback where business_agent_id=b and user_id=child.user_id;
      perform public.business_emit_work_notice(b,child.user_id,'Your supervisor has left that role. You now report to '||coalesce(public.business_actor_name(fallback),'the business Owner')||'.');
      if fallback is not null then perform public.business_emit_work_notice(b,fallback,public.business_actor_name(child.user_id)||' now reports to you following their supervisor’s departure.'); end if;
    end loop;
    for item in select id from public.business_team_transfers where business_agent_id=b and status='pending' and old.user_id in (staff_id,from_supervisor,to_supervisor,requested_by) for update loop perform public.business_finish_team_transfer(item,'cancelled',auth.uid()); end loop;
    if tg_op='DELETE' then return old; end if;
  end if;
  if tg_op='UPDATE' and new.role<>old.role and old.role='staff' then
    for item in select id from public.business_team_transfers where business_agent_id=b and staff_id=old.user_id and status='pending' for update loop perform public.business_finish_team_transfer(item,'cancelled',auth.uid()); end loop;
  end if;
  if new.role='staff' then
    if tg_op='INSERT' or old.role<>'staff' then
      new.supervisor_id:=coalesce(new.supervisor_id,(select user_id from public.business_managers where business_agent_id=b and user_id=auth.uid() and role in ('owner','manager')),public.business_default_owner(b));
    end if;
    if new.supervisor_id is not null and (new.supervisor_id=new.user_id or not exists(select 1 from public.business_managers where business_agent_id=b and user_id=new.supervisor_id and role in ('owner','manager'))) then raise exception 'Choose a current Owner or Manager in this business'; end if;
  else new.supervisor_id:=null; end if;
  return new;
end $$;
create trigger business_reporting_before before insert or update or delete on public.business_managers for each row execute function public.business_reporting_before();
create function public.business_reporting_after() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare b uuid:=coalesce(new.business_agent_id,old.business_agent_id); who uuid:=coalesce(new.user_id,old.user_id);
begin
  if not exists(select 1 from public.agents where id=b) then return null; end if;
  insert into public.business_team_settings(business_agent_id,default_owner) values(b,public.business_default_owner(b)) on conflict(business_agent_id) do update set default_owner=public.business_default_owner(b);
  if tg_op='DELETE' or new.role is distinct from old.role or new.supervisor_id is distinct from old.supervisor_id then
    update public.business_team_history set ended_at=now() where business_agent_id=b and staff_id=who and ended_at is null;
    if tg_op<>'DELETE' and new.role='staff' then insert into public.business_team_history(business_agent_id,staff_id,supervisor_id,staff_name,supervisor_name) values(b,who,new.supervisor_id,public.business_actor_name(who),public.business_actor_name(new.supervisor_id)); end if;
  end if;
  if tg_op='DELETE' then delete from public.business_work_notices where business_agent_id=b and recipient_id=who; end if;
  return null;
end $$;
create trigger business_reporting_after after insert or update or delete on public.business_managers for each row execute function public.business_reporting_after();

create function public.set_business_default_owner(p_owner uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare b uuid:=public.my_agent_id();
begin
  perform 1 from public.agents where id=b for update;
  if public.workspace_role() is distinct from 'owner' or not public.business_permission('ownership') or not exists(select 1 from public.business_managers where business_agent_id=b and user_id=p_owner and role='owner' and not public.direct_account_restricted(user_id)) then raise exception 'Choose an active Owner'; end if;
  insert into public.business_team_settings(business_agent_id,default_owner) values(b,p_owner) on conflict(business_agent_id) do update set default_owner=excluded.default_owner;
  perform public.log_business_staff(b,public.business_actor_name(p_owner),'Default receiving Owner updated');
end $$;
create function public.request_business_staff_transfer(p_staff uuid,p_target uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare b uuid:=public.my_agent_id(); current_supervisor uuid; item uuid;
begin
  perform 1 from public.agents where id=b for update;
  if not public.business_permission('staff') then raise exception 'Only Owners and Managers can request transfers'; end if;
  perform public.business_expire_team_transfers(b);
  select supervisor_id into current_supervisor from public.business_managers where business_agent_id=b and user_id=p_staff and role='staff' for update;
  if not found or current_supervisor is null or (public.workspace_role()='manager' and current_supervisor<>auth.uid()) then raise exception 'Choose a Staff member reporting to you'; end if;
  if p_target is null or p_target=current_supervisor or not exists(select 1 from public.business_managers where business_agent_id=b and user_id=p_target and role in ('owner','manager') and not public.direct_account_restricted(user_id)) then raise exception 'Choose another active Owner or Manager in this business'; end if;
  if exists(select 1 from public.business_team_transfers where business_agent_id=b and staff_id=p_staff and status='pending') then raise exception 'This Staff member already has a pending transfer'; end if;
  insert into public.business_team_transfers(business_agent_id,staff_id,from_supervisor,to_supervisor,requested_by,staff_name,from_name,to_name,requester_name)
    values(b,p_staff,current_supervisor,p_target,auth.uid(),public.business_actor_name(p_staff),public.business_actor_name(current_supervisor),public.business_actor_name(p_target),public.business_actor_name(auth.uid())) returning id into item;
  perform public.business_emit_work_notice(b,p_target,public.business_actor_name(auth.uid())||' requests that '||public.business_actor_name(p_staff)||' reports to you. Their current supervisor is '||public.business_actor_name(current_supervisor)||'.',item,'transfer_request');
  perform public.business_emit_work_notice(b,auth.uid(),'Your request to move '||public.business_actor_name(p_staff)||' to '||public.business_actor_name(p_target)||' is awaiting acceptance.',item);
  perform public.log_business_staff(b,public.business_actor_name(p_staff),'Staff transfer requested: '||public.business_actor_name(current_supervisor)||' → '||public.business_actor_name(p_target));
  return item;
end $$;
create function public.respond_business_staff_transfer(p_transfer uuid,p_decision text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare b uuid:=public.my_agent_id(); t public.business_team_transfers;
begin
  perform 1 from public.agents where id=b for update;
  if not public.business_permission('read') or p_decision is null or p_decision not in ('accept','decline','cancel') then raise exception 'Transfer unavailable'; end if;
  select * into t from public.business_team_transfers where id=p_transfer and business_agent_id=b for update;
  if not found then raise exception 'Transfer unavailable'; end if;
  if t.status<>'pending' then return; end if;
  if p_decision='cancel' then
    if public.workspace_role()<>'owner' and t.requested_by<>auth.uid() then raise exception 'Only the requester or an Owner can cancel'; end if;
  elsif auth.uid()<>t.to_supervisor or public.workspace_role() not in ('owner','manager') then raise exception 'Only the receiving Owner or Manager can accept or decline'; end if;
  if t.expires_at<=now() then perform public.business_finish_team_transfer(t.id,'expired',null); return; end if;
  if not exists(select 1 from public.business_managers where business_agent_id=b and user_id=t.staff_id and role='staff' and supervisor_id=t.from_supervisor) then perform public.business_finish_team_transfer(t.id,'cancelled',null); return; end if;
  perform public.business_finish_team_transfer(t.id,case p_decision when 'accept' then 'accepted' when 'decline' then 'declined' else 'cancelled' end,auth.uid());
  if p_decision='accept' then update public.business_managers set supervisor_id=t.to_supervisor where business_agent_id=b and user_id=t.staff_id and role='staff'; end if;
end $$;
create function public.business_team_state() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b uuid:=public.my_agent_id(); transfers jsonb;
begin
  if not public.business_permission('read') then raise exception 'Business access unavailable'; end if;
  perform 1 from public.agents where id=b for update;
  perform public.business_expire_team_transfers(b);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into transfers from (
    select t.* from public.business_team_transfers t where business_agent_id=b and (public.workspace_role()='owner' or auth.uid() in (staff_id,from_supervisor,to_supervisor,requested_by)) order by created_at desc limit 50
  ) x;
  return jsonb_build_object('defaultOwner',public.business_default_owner(b),'transfers',transfers);
end $$;
create function public.acknowledge_business_work_notice(p_notice uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.business_permission('read') then raise exception 'Business access unavailable'; end if;
  update public.business_work_notices set seen_at=coalesce(seen_at,now()) where id=p_notice and business_agent_id=public.my_agent_id() and recipient_id=auth.uid() and kind='information';
end $$;

create function public.business_work_notice_changed() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.bump_identity_notifications(array[coalesce(new.recipient_id,old.recipient_id)]);
  perform public.business_queue_changed_signal(coalesce(new.business_agent_id,old.business_agent_id));
  return null;
end $$;
create function public.business_queue_changed_signal(p_business uuid) returns void language sql security definer set search_path=public,pg_temp as $$
  insert into public.business_queue_versions(agent_id) select id from public.agents where id=p_business on conflict(agent_id) do update set revision=public.business_queue_versions.revision+1;
$$;
create trigger business_work_notice_changed after insert or update or delete on public.business_work_notices for each row execute function public.business_work_notice_changed();
create trigger team_transfer_changed after insert or update or delete on public.business_team_transfers for each row execute function public.business_queue_changed();
create trigger team_settings_changed after insert or update on public.business_team_settings for each row execute function public.business_queue_changed();

revoke execute on function public.business_default_owner(uuid,uuid),public.business_emit_work_notice(uuid,uuid,text,uuid,text),public.business_finish_team_transfer(uuid,text,uuid),public.business_expire_team_transfers(uuid),public.business_reporting_before(),public.business_reporting_after(),public.business_work_notice_changed(),public.business_queue_changed_signal(uuid) from public,anon,authenticated;
revoke execute on function public.set_business_default_owner(uuid),public.request_business_staff_transfer(uuid,uuid),public.respond_business_staff_transfer(uuid,text),public.business_team_state(),public.acknowledge_business_work_notice(uuid) from public,anon;
grant execute on function public.set_business_default_owner(uuid),public.request_business_staff_transfer(uuid,uuid),public.respond_business_staff_transfer(uuid,text),public.business_team_state(),public.acknowledge_business_work_notice(uuid) to authenticated;

-- The actual inviter becomes the reporting supervisor on accepted Staff invitations.
do $$ declare d text; begin
  d:=pg_get_functiondef('public.respond_business_invite(uuid,boolean)'::regprocedure);
  d:=replace(d,'insert into public.business_managers(business_agent_id,user_id,role) values(invitation.business_agent_id,auth.uid(),invitation.role)',
    'insert into public.business_managers(business_agent_id,user_id,role,supervisor_id) values(invitation.business_agent_id,auth.uid(),invitation.role,case when invitation.role=''staff'' then invitation.invited_by else null end)');
  execute d;
end $$;
