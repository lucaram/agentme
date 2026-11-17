-- Managers, Staff and (co-)Owners can leave a business themselves, without someone else removing
-- their access. Only their access to the business ends: their personal account stays, their past
-- work and the audit records remain, and the existing triggers on business_managers do the rest
-- (requests assigned to them go back to the team, Staff who reported to them move to the
-- receiving Owner, transfers involving them are cancelled, invitations they sent are revoked).

-- Owners choose whether they're told in My Agent when a Manager or Staff member leaves.
alter table public.business_managers add column notify_departures boolean not null default true;

/**
 * Leave a business as `p_person`. Server only (service role): the app checks that the session is
 * that person's own work session in this business, switches them back to their personal account,
 * then calls this. `p_dry_run`: the same checks, and nothing changes (so the app can refuse before
 * switching). Returns what the app needs to tell the people concerned.
 */
create function public.leave_business(p_business uuid, p_person uuid, p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.business_managers;
  business_name text;
  my_name text;
  owners jsonb;
  reports jsonb;
  supervisor_role text;
begin
  -- One change to this business's team at a time (as change_business_member does).
  select display_name into business_name from public.agents where id = p_business and type = 'business' for update;
  if not found then raise exception 'This business no longer exists.'; end if;
  if exists (select 1 from public.agents where id = p_business and owner_id = p_person) then
    raise exception 'This is the business''s own login, so it can''t leave. Delete the business instead.';
  end if;
  select * into me from public.business_managers where business_agent_id = p_business and user_id = p_person for update;
  if not found then raise exception 'You''re not part of this business any more.'; end if;
  if me.role = 'owner' and not exists (
    select 1 from public.business_managers where business_agent_id = p_business and role = 'owner' and user_id <> p_person
  ) then
    raise exception 'You''re the only Owner. Make someone else an Owner, or delete the business, before you leave.';
  end if;
  if p_dry_run then return jsonb_build_object('role', me.role); end if;

  my_name := public.business_actor_name(p_person);
  select role into supervisor_role from public.business_managers where business_agent_id = p_business and user_id = me.supervisor_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', user_id, 'notify', notify_departures) order by created_at), '[]') into owners
    from public.business_managers where business_agent_id = p_business and role = 'owner' and user_id <> p_person;
  select coalesce(array_to_json(array_agg(user_id))::jsonb, '[]') into reports
    from public.business_managers where business_agent_id = p_business and role = 'staff' and supervisor_id = p_person;

  -- The triggers on business_managers release assigned requests, move reporting Staff to the
  -- receiving Owner (with notices in the business), cancel transfers and revoke invitations.
  delete from public.business_managers where business_agent_id = p_business and user_id = p_person;

  insert into public.business_staff_audit (business_agent_id, actor_id, actor_name, subject_name, action)
    values (p_business, p_person, my_name, my_name, 'Left the business (' || initcap(me.role) || ')');

  return jsonb_build_object(
    'business', business_name,
    'name', my_name,
    'role', me.role,
    'supervisor', case when me.role = 'staff' then me.supervisor_id end,
    'supervisorRole', case when me.role = 'staff' then supervisor_role end,
    'owners', owners,
    -- Where each person who reported to the leaver reports now (after the fallback).
    'reports', (
      select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'supervisor', m.supervisor_id, 'supervisorName', public.business_actor_name(m.supervisor_id))), '[]')
      from public.business_managers m
      where m.business_agent_id = p_business and m.user_id in (select (jsonb_array_elements_text(reports))::uuid)
    )
  );
end $$;
revoke execute on function public.leave_business(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.leave_business(uuid, uuid, boolean) to service_role;

/** An Owner, in their work session: be told (or not) in My Agent when a Manager or Staff member leaves. */
create function public.set_business_departure_notices(p_enabled boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b uuid := public.my_agent_id();
begin
  if public.workspace_role() is distinct from 'owner' then raise exception 'Only Owners choose this.'; end if;
  update public.business_managers set notify_departures = coalesce(p_enabled, true) where business_agent_id = b and user_id = auth.uid();
  if not found then raise exception 'Only Owners choose this.'; end if;
end $$;
revoke execute on function public.set_business_departure_notices(boolean) from public, anon;
grant execute on function public.set_business_departure_notices(boolean) to authenticated;
