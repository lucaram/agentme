-- Public profile details only. Staff invitations require a registered, verified
-- personal account; email addresses are never returned by this search.
create function public.search_business_staff(p_query text) returns table(id uuid,name text,handle text,avatar text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare q text:=lower(ltrim(trim(p_query),'@')); pattern text; business uuid:=public.my_agent_id();
begin
  if not public.business_permission('staff') then raise exception 'Not allowed'; end if;
  if q is null or length(q) not between 2 and 60 then return; end if;
  pattern:=replace(replace(replace(q,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_');
  return query select a.id,a.display_name,a.handle,a.avatar from public.agents a join auth.users u on u.id=a.owner_id
    where a.type='personal' and not a.guest and u.email_confirmed_at is not null and a.owner_id<>auth.uid()
      and not public.direct_account_restricted(a.owner_id)
      and (a.discoverable or a.handle=q or exists(select 1 from public.contacts c where c.status='accepted' and ((c.requester_agent=business and c.addressee_agent=a.id) or (c.addressee_agent=business and c.requester_agent=a.id))))
      and not exists(select 1 from public.contacts c where c.status='blocked' and ((c.requester_agent=business and c.addressee_agent=a.id) or (c.addressee_agent=business and c.requester_agent=a.id)))
      and not exists(select 1 from public.business_managers m where m.business_agent_id=business and m.user_id=a.owner_id)
      and not exists(select 1 from public.business_staff_invites v where v.business_agent_id=business and v.recipient_user=a.owner_id and v.status='pending' and v.expires_at>now())
      and (a.handle ilike pattern||'%' or a.display_name ilike '%'||pattern||'%')
    order by (a.handle=q) desc,(a.handle ilike pattern||'%') desc,a.display_name,a.handle limit 8;
end $$;
revoke execute on function public.search_business_staff(text) from public,anon;
grant execute on function public.search_business_staff(text) to authenticated;

create or replace function public.issue_business_invite(p_target text,p_role text,p_digest text,p_existing uuid default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare business uuid:=public.my_agent_id(); actor_role text:=public.workspace_role(); recipient uuid; address text; invitation uuid; person_agent uuid; old_invite public.business_staff_invites;
begin
  if not public.business_permission('staff') or p_role not in ('manager','staff') or (actor_role='manager' and p_role<>'staff') or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'Not allowed'; end if;
  perform 1 from public.agents where id=business for update;
  if (select count(*) from public.business_staff_audit where business_agent_id=business and action like 'Invitation %' and created_at>now()-interval '1 hour')>=50 then raise exception 'Too many invitations; try again later'; end if;
  if p_existing is not null then
    select * into old_invite from public.business_staff_invites where id=p_existing and business_agent_id=business and status='pending' for update;
    if not found or (actor_role='manager' and old_invite.role<>'staff') then raise exception 'Invitation unavailable'; end if;
    select '@'||a.handle into p_target from public.agents a where a.owner_id=old_invite.recipient_user and a.type='personal' and not a.guest;
    if not found then raise exception 'Cancel this invitation and select a registered user'; end if;
    p_role:=old_invite.role;
  end if;
  if p_target is null or lower(trim(p_target)) !~ '^@[a-z0-9_]{3,20}$' then raise exception 'Select a registered user by name or @address'; end if;
  select a.owner_id,lower(u.email),a.id into recipient,address,person_agent from public.agents a join auth.users u on u.id=a.owner_id
    where a.handle=lower(substr(trim(p_target),2)) and a.type='personal' and not a.guest and u.email_confirmed_at is not null;
  if recipient is null or public.direct_account_restricted(recipient) then raise exception 'Choose a verified personal account'; end if;
  if recipient=auth.uid() or exists(select 1 from public.business_managers where business_agent_id=business and user_id=recipient) then raise exception 'This person already has access'; end if;
  if exists(select 1 from public.contacts c where c.status='blocked' and ((c.requester_agent=business and c.addressee_agent=person_agent) or (c.addressee_agent=business and c.requester_agent=person_agent))) then raise exception 'Invitation unavailable'; end if;
  if p_existing is not null then
    invitation:=old_invite.id;
    update public.business_staff_invites set token_hash=p_digest,expires_at=now()+interval '7 days',created_at=now(),invited_by=auth.uid() where id=invitation;
  else
    if exists(select 1 from public.business_staff_invites where business_agent_id=business and recipient_user=recipient and status='pending') then raise exception 'An invitation already exists; renew it from Invitations'; end if;
    if (select count(*) from public.business_staff_invites where business_agent_id=business and status='pending')>=50 then raise exception 'Too many pending invitations'; end if;
    insert into public.business_staff_invites(business_agent_id,email,recipient_user,role,token_hash,invited_by) values(business,address,recipient,p_role,p_digest,auth.uid()) returning id into invitation;
  end if;
  update public.inbox_items set status='withdrawn' where kind='business_invitation' and payload->>'invite_id'=invitation::text and status='open';
  insert into public.inbox_items(owner_id,agent_id,from_agent,kind,payload) values(recipient,person_agent,business,'business_invitation',jsonb_build_object('invite_id',invitation,'business_name',(select display_name from public.agents where id=business),'role',p_role));
  perform public.log_business_staff(business,(select display_name||' (@'||handle||')' from public.agents where id=person_agent),case when p_existing is null then 'Invitation created · ' else 'Invitation renewed · ' end||p_role);
  return invitation;
end $$;

-- Managers can take a question themselves, or delegate to ordinary Staff.
-- Owners may delegate to any other accepted member. Client menus mirror this.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.claim_business_question(uuid,uuid,boolean)'::regprocedure);
  definition:=replace(definition,'if not p_release and not exists',
    'if not p_release and public.workspace_role()=''manager'' and assignee<>auth.uid() and not exists(select 1 from public.business_managers where business_agent_id=business and user_id=assignee and role=''staff'') then raise exception ''Managers can assign requests to Staff members''; end if;
     if not p_release and not exists');
  execute definition;
end $$;
