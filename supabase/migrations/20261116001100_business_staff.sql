create table public.business_staff_invites (
  id uuid primary key default gen_random_uuid(), business_agent_id uuid not null references public.agents(id) on delete cascade,
  email text not null, recipient_user uuid references auth.users(id) on delete set null,
  role text not null check(role in ('manager','staff')), token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check(status in ('pending','accepted','declined','revoked')),
  created_at timestamptz not null default now(), expires_at timestamptz not null default(now()+interval '7 days'), responded_at timestamptz
);
create unique index pending_business_staff_invite on public.business_staff_invites(business_agent_id,email) where status='pending';
create table public.business_staff_audit (
  id uuid primary key default gen_random_uuid(), business_agent_id uuid not null references public.agents(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, actor_name text not null, subject_name text not null,
  action text not null, created_at timestamptz not null default now()
);
create table public.business_staff_availability (
  business_agent_id uuid not null references public.agents(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  participating boolean not null default false, mode text not null default 'auto' check(mode in ('auto','busy','away','invisible')),
  mode_until timestamptz, primary key(business_agent_id,user_id),
  foreign key(business_agent_id,user_id) references public.business_managers(business_agent_id,user_id) on delete cascade
);
insert into public.business_staff_availability(business_agent_id,user_id,participating) select business_agent_id,user_id,role='owner' from public.business_managers;
create table public.business_answer_drafts (
  id uuid primary key default gen_random_uuid(), business_agent_id uuid not null references public.agents(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null, author_name text not null,
  question text not null check(length(question) between 1 and 300), answer text not null check(length(answer) between 1 and 1000),
  status text not null default 'pending' check(status in ('pending','approved','declined')), reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), reviewed_at timestamptz
);
create table public.business_message_authors (
  message_id uuid primary key references public.messages(id) on delete cascade, business_agent_id uuid not null references public.agents(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, actor_name text not null, role text not null, created_at timestamptz not null default now()
);
create table public.business_question_claims (
  inbox_id uuid primary key references public.inbox_items(id) on delete cascade, business_agent_id uuid not null references public.agents(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null, assigned_name text, claimed_at timestamptz,
  processing_token uuid, processing_until timestamptz, handled_by uuid references auth.users(id) on delete set null, handled_at timestamptz
);
alter table public.inbox_items drop constraint inbox_items_kind_check;
alter table public.inbox_items add constraint inbox_items_kind_check check(kind in ('info_request','question','introduction','group_invite','business_invitation','business_answer_review'));

do $$ declare t text; begin
  foreach t in array array['business_staff_invites','business_staff_audit','business_staff_availability','business_answer_drafts','business_message_authors','business_question_claims'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant select on public.business_staff_audit,public.business_staff_availability,public.business_answer_drafts,public.business_message_authors to authenticated;
grant select(inbox_id,business_agent_id,assigned_to,assigned_name,claimed_at,handled_by,handled_at) on public.business_question_claims to authenticated;
create policy business_audit_private on public.business_staff_audit for select to authenticated using(business_agent_id=public.my_agent_id() and public.business_permission('staff'));
create policy business_availability_private on public.business_staff_availability for select to authenticated using(business_agent_id=public.my_agent_id() and public.business_permission('read'));
create policy business_draft_private on public.business_answer_drafts for select to authenticated using(business_agent_id=public.my_agent_id() and public.business_permission('read'));
create policy business_author_private on public.business_message_authors for select to authenticated using(business_agent_id=public.my_agent_id() and public.business_permission('read'));
create policy business_claim_private on public.business_question_claims for select to authenticated using(business_agent_id=public.my_agent_id() and public.business_permission('respond'));
alter publication supabase_realtime add table public.business_question_claims,public.business_answer_drafts;

create function public.business_actor_name(p_user uuid) returns text language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select display_name from public.agents where owner_id=p_user),'Former team member');
$$;
create function public.log_business_staff(p_business uuid,p_subject text,p_action text) returns void language sql security definer set search_path=public,pg_temp as $$
  insert into public.business_staff_audit(business_agent_id,actor_id,actor_name,subject_name,action) values(p_business,auth.uid(),public.business_actor_name(auth.uid()),p_subject,p_action);
$$;

create function public.issue_business_invite(p_target text,p_role text,p_digest text,p_existing uuid default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare business uuid:=public.my_agent_id(); recipient uuid; address text; invitation uuid; person_agent uuid; actor_role text:=public.workspace_role();
begin
  if not public.business_permission('staff') or p_role not in ('manager','staff') or (actor_role='manager' and p_role<>'staff') or length(p_digest)<>64 then raise exception 'Not allowed'; end if;
  perform 1 from public.agents where id=business for update;
  if left(trim(p_target),1)='@' then
    select a.owner_id,lower(u.email) into recipient,address from public.agents a join auth.users u on u.id=a.owner_id where a.handle=lower(substr(trim(p_target),2)) and a.type='personal' and not a.guest and u.email_confirmed_at is not null;
    if recipient is null then raise exception 'Choose a verified personal account'; end if;
  else
    address:=lower(trim(p_target));
    if address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(address)>254 then raise exception 'Enter an email address or @address'; end if;
    select u.id into recipient from auth.users u join public.agents a on a.owner_id=u.id and a.type='personal' and not a.guest where lower(u.email)=address and u.email_confirmed_at is not null;
  end if;
  if recipient=auth.uid() or exists(select 1 from public.business_managers where business_agent_id=business and user_id=recipient) then raise exception 'This person already has access'; end if;
  if p_existing is not null then
    select id into invitation from public.business_staff_invites where id=p_existing and business_agent_id=business and status='pending' and (actor_role='owner' or role='staff') for update;
    if invitation is null then raise exception 'Invitation unavailable'; end if;
    update public.business_staff_invites set token_hash=p_digest,expires_at=now()+interval '7 days',created_at=now() where id=invitation;
  else
    if (select count(*) from public.business_staff_invites where business_agent_id=business and status='pending')>=50 then raise exception 'Too many pending invitations'; end if;
    insert into public.business_staff_invites(business_agent_id,email,recipient_user,role,token_hash,invited_by) values(business,address,recipient,p_role,p_digest,auth.uid()) returning id into invitation;
  end if;
  select id into person_agent from public.agents where owner_id=recipient and type='personal';
  if person_agent is not null then
    update public.inbox_items set status='withdrawn' where kind='business_invitation' and payload->>'invite_id'=invitation::text and status='open';
    insert into public.inbox_items(owner_id,agent_id,from_agent,kind,payload) values(recipient,person_agent,business,'business_invitation',jsonb_build_object('invite_id',invitation,'business_name',(select display_name from public.agents where id=business),'role',p_role));
  end if;
  perform public.log_business_staff(business,address,case when p_existing is null then 'Invitation created · ' else 'Invitation renewed · ' end||p_role);
  return invitation;
end $$;

create function public.cancel_business_invite(p_invite uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation public.business_staff_invites;
begin
  select * into invitation from public.business_staff_invites where id=p_invite and business_agent_id=public.my_agent_id() for update;
  if not found or not public.business_permission('staff') or (public.workspace_role()='manager' and invitation.role<>'staff') then raise exception 'Not allowed'; end if;
  update public.business_staff_invites set status='revoked',responded_at=now() where id=p_invite and status='pending';
  update public.inbox_items set status='withdrawn' where kind='business_invitation' and payload->>'invite_id'=p_invite::text and status='open';
  perform public.log_business_staff(invitation.business_agent_id,invitation.email,'Invitation cancelled');
end $$;

create function public.respond_business_invite(p_invite uuid,p_accept boolean) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation public.business_staff_invites; verified_email text; inviter_role text;
begin
  if public.workspace_user_id() is distinct from auth.uid() or public.direct_account_restricted(auth.uid()) or not exists(select 1 from public.agents where owner_id=auth.uid() and type='personal' and not guest) then raise exception 'Use your own verified personal account'; end if;
  select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  select * into invitation from public.business_staff_invites where id=p_invite for update;
  if not found or invitation.status<>'pending' or invitation.expires_at<=now() or verified_email is null or invitation.email<>verified_email or (invitation.recipient_user is not null and invitation.recipient_user<>auth.uid()) then raise exception 'Invitation unavailable for this account'; end if;
  select role into inviter_role from public.business_managers where business_agent_id=invitation.business_agent_id and user_id=invitation.invited_by;
  if inviter_role is null and exists(select 1 from public.agents where id=invitation.business_agent_id and owner_id=invitation.invited_by) and not exists(select 1 from public.business_managers where business_agent_id=invitation.business_agent_id) then inviter_role:='owner'; end if;
  if inviter_role not in ('owner','manager') or (invitation.role='manager' and inviter_role<>'owner') then raise exception 'Ask the business owner for a new invitation'; end if;
  if p_accept then
    insert into public.business_managers(business_agent_id,user_id,role) values(invitation.business_agent_id,auth.uid(),invitation.role) on conflict do nothing;
  end if;
  update public.business_staff_invites set status=case when p_accept then 'accepted' else 'declined' end,responded_at=now() where id=p_invite;
  update public.inbox_items set status=case when p_accept then 'answered' else 'declined' end,answered_at=now() where kind='business_invitation' and payload->>'invite_id'=p_invite::text and owner_id=auth.uid() and status='open';
  perform public.log_business_staff(invitation.business_agent_id,public.business_actor_name(auth.uid()),case when p_accept then 'Invitation accepted' else 'Invitation declined' end);
  return invitation.business_agent_id;
end $$;

create function public.change_business_member(p_user uuid,p_role text,p_transfer boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare business uuid:=public.my_agent_id(); actor_role text:=public.workspace_role(); previous_role text;
begin
  if not public.business_permission('staff') then raise exception 'Not allowed'; end if;
  perform 1 from public.agents where id=business for update;
  select role into previous_role from public.business_managers where business_agent_id=business and user_id=p_user for update;
  if previous_role is null or p_role not in ('owner','manager','staff','remove') then raise exception 'Member unavailable'; end if;
  if actor_role='manager' and (previous_role<>'staff' or p_role not in ('staff','remove') or p_user=auth.uid()) then raise exception 'Only owners manage elevated roles'; end if;
  if p_transfer and (actor_role<>'owner' or p_user=auth.uid() or p_role<>'owner') then raise exception 'Only an owner can transfer ownership'; end if;
  if previous_role='owner' and p_role<>'owner' and (select count(*) from public.business_managers where business_agent_id=business and role='owner')<=1 then raise exception 'Keep at least one owner; transfer ownership first'; end if;
  if p_role='remove' then delete from public.business_managers where business_agent_id=business and user_id=p_user;
  else update public.business_managers set role=p_role where business_agent_id=business and user_id=p_user; end if;
  if p_transfer then update public.business_managers set role='manager' where business_agent_id=business and user_id=auth.uid(); end if;
  perform public.log_business_staff(business,public.business_actor_name(p_user),case when p_transfer then 'Ownership transferred' when p_role='remove' then 'Access removed' else 'Role changed · '||p_role end);
end $$;

create function public.initialize_staff_availability() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin insert into public.business_staff_availability(business_agent_id,user_id,participating) values(new.business_agent_id,new.user_id,new.role='owner') on conflict do nothing; return new; end $$;
create trigger initialize_staff_availability after insert on public.business_managers for each row execute function public.initialize_staff_availability();

create function public.claim_business_question(p_item uuid,p_assignee uuid default null,p_release boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare business uuid:=public.my_agent_id(); assignee uuid:=coalesce(p_assignee,auth.uid()); claim public.business_question_claims;
begin
  if not public.business_permission('respond') or not exists(select 1 from public.inbox_items where id=p_item and owner_id=public.workspace_user_id() and status='open' and kind='question' and payload->>'business'='true') then raise exception 'Question unavailable'; end if;
  insert into public.business_question_claims(inbox_id,business_agent_id) values(p_item,business) on conflict do nothing;
  select * into claim from public.business_question_claims where inbox_id=p_item for update;
  if claim.processing_until>now() then raise exception 'An answer is being sent'; end if;
  if public.workspace_role()='staff' and (assignee<>auth.uid() or (claim.assigned_to is not null and claim.assigned_to<>auth.uid())) then raise exception 'This request is assigned to another person'; end if;
  if not p_release and not exists(select 1 from public.business_managers where business_agent_id=business and user_id=assignee) and assignee is distinct from (select owner_id from public.agents where id=business) then raise exception 'Choose a current team member'; end if;
  update public.business_question_claims set assigned_to=case when p_release then null else assignee end,assigned_name=case when p_release then null else public.business_actor_name(assignee) end,claimed_at=case when p_release then null else now() end where inbox_id=p_item;
end $$;
create function public.reserve_business_answer(p_item uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare ticket uuid:=gen_random_uuid();
begin
  perform public.claim_business_question(p_item,auth.uid(),false);
  update public.business_question_claims set processing_token=ticket,processing_until=now()+interval '2 minutes' where inbox_id=p_item and assigned_to=auth.uid() and (processing_until is null or processing_until<=now());
  if not found then raise exception 'An answer is already being sent'; end if;
  return ticket;
end $$;

create function public.suggest_business_answer(p_question text,p_answer text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare draft uuid; business uuid:=public.my_agent_id();
begin
  if not public.business_permission('draft') or length(trim(p_question)) not between 1 and 300 or length(trim(p_answer)) not between 1 and 1000 then raise exception 'Write a question and answer'; end if;
  if (select count(*) from public.business_answer_drafts where business_agent_id=business and author_id=auth.uid() and status='pending')>=20 then raise exception 'Review your pending suggestions first'; end if;
  insert into public.business_answer_drafts(business_agent_id,author_id,author_name,question,answer) values(business,auth.uid(),public.business_actor_name(auth.uid()),trim(p_question),trim(p_answer)) returning id into draft;
  insert into public.inbox_items(owner_id,agent_id,kind,payload) select owner_id,id,'business_answer_review',jsonb_build_object('draft_id',draft,'author',public.business_actor_name(auth.uid()),'question',trim(p_question),'answer',trim(p_answer)) from public.agents where id=business;
  return draft;
end $$;
create function public.review_business_answer(p_draft uuid,p_approve boolean,p_question text,p_answer text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare draft public.business_answer_drafts; info jsonb;
begin
  if not public.business_permission('configure') then raise exception 'Only owners and managers approve answers'; end if;
  select business_info into info from public.agents where id=public.my_agent_id() for update;
  select * into draft from public.business_answer_drafts where id=p_draft and business_agent_id=public.my_agent_id() for update;
  if not found or draft.status<>'pending' then raise exception 'Suggestion unavailable'; end if;
  if p_approve then
    if length(trim(p_question)) not between 1 and 300 or length(trim(p_answer)) not between 1 and 1000 or jsonb_array_length(coalesce(info->'faqs','[]'::jsonb))>=50 then raise exception 'Check the answer and FAQ limit'; end if;
    update public.agents set business_info=jsonb_set(coalesce(info,'{}'::jsonb),'{faqs}',coalesce(info->'faqs','[]'::jsonb)||jsonb_build_array(jsonb_build_object('q',trim(p_question),'a',trim(p_answer)))) where id=draft.business_agent_id;
  end if;
  update public.business_answer_drafts set status=case when p_approve then 'approved' else 'declined' end,reviewed_by=auth.uid(),reviewed_at=now() where id=p_draft;
  update public.inbox_items set status=case when p_approve then 'answered' else 'declined' end,answered_at=now() where kind='business_answer_review' and payload->>'draft_id'=p_draft::text and owner_id=public.workspace_user_id() and status='open';
  perform public.log_business_staff(draft.business_agent_id,draft.question,case when p_approve then 'Suggested answer approved' else 'Suggested answer declined' end);
end $$;

revoke execute on function public.business_actor_name(uuid),public.log_business_staff(uuid,text,text),public.initialize_staff_availability() from public,anon,authenticated;
revoke execute on function public.issue_business_invite(text,text,text,uuid),public.cancel_business_invite(uuid),public.respond_business_invite(uuid,boolean),public.change_business_member(uuid,text,boolean),public.claim_business_question(uuid,uuid,boolean),public.reserve_business_answer(uuid),public.suggest_business_answer(text,text),public.review_business_answer(uuid,boolean,text,text) from public,anon;
grant execute on function public.issue_business_invite(text,text,text,uuid),public.cancel_business_invite(uuid),public.respond_business_invite(uuid,boolean),public.change_business_member(uuid,text,boolean),public.claim_business_question(uuid,uuid,boolean),public.reserve_business_answer(uuid),public.suggest_business_answer(text,text),public.review_business_answer(uuid,boolean,text,text) to authenticated;
