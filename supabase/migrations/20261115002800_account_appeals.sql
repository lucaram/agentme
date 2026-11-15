alter table public.platform_cases drop constraint platform_cases_outcome_check;
alter table public.platform_cases add constraint platform_cases_outcome_check check(outcome in ('dismissed','warned','suspended','restored','removed','account_suspended_1m','account_suspended_3m','account_banned','account_restriction_lifted'));

create function public.own_account_sanctions(p_offset integer default 0) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
    select s.id,s.subject_name name,s.action,s.justification,s.created_at,s.expires_at,s.revoked_at,s.revoke_reason,
      case when a.id is not null then jsonb_build_object('id',a.id,'reason',a.reason,'status',a.status,'created_at',a.created_at,'response',a.response,'reviewed_at',a.reviewed_at) end appeal
    from public.platform_account_sanctions s left join public.platform_account_appeals a on a.sanction_id=s.id
    where s.user_key=auth.uid() and p_offset between 0 and 10000 order by s.created_at desc,s.id desc limit 26 offset greatest(0,least(p_offset,10000))
  ) x;
$$;
revoke execute on function public.own_account_sanctions(integer) from public,anon;
grant execute on function public.own_account_sanctions(integer) to authenticated;

create function public.submit_account_appeal(p_sanction uuid,p_reason text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.platform_account_sanctions; saved uuid;
begin
  select * into s from public.platform_account_sanctions where id=p_sanction and user_key=auth.uid() for update;
  if not found then raise exception 'Not allowed'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 2000 then raise exception 'Explain your appeal in up to 2000 characters'; end if;
  select id into saved from public.platform_account_appeals where sanction_id=s.id;
  if found then return saved; end if;
  insert into public.platform_account_appeals(sanction_id,user_key,reason) values(s.id,s.user_key,btrim(p_reason)) returning id into saved;
  return saved;
end $$;
revoke execute on function public.submit_account_appeal(uuid,text) from public,anon;
grant execute on function public.submit_account_appeal(uuid,text) to authenticated;

create function public.open_account_appeal_count() returns bigint language sql stable security definer set search_path=public,pg_temp as $$
  select count(*) from public.platform_account_appeals a join public.platform_account_sanctions s on s.id=a.sanction_id join public.platform_cases c on c.id=s.case_id
    where a.status='open' and s.actor_id is distinct from auth.uid() and s.user_key<>auth.uid() and public.can_review_platform_target(c.target_kind,c.target_key);
$$;
revoke execute on function public.open_account_appeal_count() from public,anon;
grant execute on function public.open_account_appeal_count() to authenticated;

create function public.account_appeal_queue(p_state text default 'open',p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.is_platform_moderator() or p_state is null or p_state not in ('open','closed') or p_offset is null or p_offset not between 0 and 10000 then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
    select a.id,a.reason,a.status,a.created_at,a.response,a.reviewed_at,s.id sanction_id,s.subject_name,s.action,s.justification,s.expires_at,s.revoked_at,s.case_id
    from public.platform_account_appeals a join public.platform_account_sanctions s on s.id=a.sanction_id join public.platform_cases c on c.id=s.case_id
    where ((p_state='open' and a.status='open') or (p_state='closed' and a.status<>'open')) and s.actor_id is distinct from auth.uid() and s.user_key<>auth.uid() and public.can_review_platform_target(c.target_kind,c.target_key)
    order by a.created_at,a.id limit 26 offset p_offset
  ) x);
end $$;
revoke execute on function public.account_appeal_queue(text,integer) from public,anon;
grant execute on function public.account_appeal_queue(text,integer) to authenticated;

create function public.lift_account_restriction(p_sanction uuid,p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.platform_account_sanctions; c public.platform_cases; event uuid;
begin
  select * into s from public.platform_account_sanctions where id=p_sanction;
  select * into c from public.platform_cases where id=s.case_id;
  if c.id is null or not public.can_review_platform_target(c.target_kind,c.target_key) or s.user_key=auth.uid() then raise exception 'Not allowed'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 500 then raise exception 'Add a justification between 5 and 500 characters'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-decision:'||s.user_key::text,0));
  c:=public.lock_report_case(c.id);
  if not public.can_review_platform_target(c.target_kind,c.target_key) then raise exception 'Not allowed'; end if;
  select * into s from public.platform_account_sanctions where id=p_sanction for update;
  if s.revoked_at is not null then return; end if;
  update public.platform_account_sanctions set revoked_at=now(),revoked_by=auth.uid(),revoke_reason=btrim(p_reason) where id=s.id;
  update public.platform_cases set outcome='account_restriction_lifted',response='The account restriction from this case was lifted after review.',revision=revision+1,updated_at=now() where id=c.id;
  insert into public.platform_case_events(case_id,actor_id,action,public_response) values(c.id,auth.uid(),'lift_account_restriction',btrim(p_reason)) returning id into event;
  if s.user_id is not null then insert into public.platform_notifications(user_id,event_id,text,link) values(s.user_id,event,'An account restriction was lifted. Justification: '||btrim(p_reason)||' Other active restrictions, if any, still apply.','/account-status'); end if;
  insert into public.platform_notifications(user_id,event_id,text,link) select reporter_id,event,'AGENTME updated the decision on your report.','/reports/'||id::text from public.platform_reports where case_id=c.id and reporter_id is not null on conflict do nothing;
end $$;
revoke execute on function public.lift_account_restriction(uuid,text) from public,anon;
grant execute on function public.lift_account_restriction(uuid,text) to authenticated;

create function public.review_account_appeal(p_appeal uuid,p_accept boolean,p_response text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.platform_account_appeals; s public.platform_account_sanctions; c public.platform_cases; event uuid;
begin
  select * into a from public.platform_account_appeals where id=p_appeal;
  select * into s from public.platform_account_sanctions where id=a.sanction_id;
  select * into c from public.platform_cases where id=s.case_id;
  if c.id is null or not public.can_review_platform_target(c.target_kind,c.target_key) or s.actor_id=auth.uid() or s.user_key=auth.uid() then raise exception 'An independent reviewer is required'; end if;
  if p_accept is null or p_response is null or char_length(btrim(p_response)) not between 5 and 500 then raise exception 'Add a justification between 5 and 500 characters'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-decision:'||s.user_key::text,0));
  c:=public.lock_report_case(c.id);
  if not public.can_review_platform_target(c.target_kind,c.target_key) then raise exception 'Not allowed'; end if;
  select * into a from public.platform_account_appeals where id=p_appeal for update;
  if a.status<>'open' then raise exception 'This appeal was already reviewed'; end if;
  update public.platform_account_appeals set status=case when p_accept then 'accepted' else 'rejected' end,reviewed_at=now(),reviewed_by=auth.uid(),response=btrim(p_response) where id=a.id;
  if p_accept then
    update public.platform_account_sanctions set revoked_at=now(),revoked_by=auth.uid(),revoke_reason=btrim(p_response) where id=s.id and revoked_at is null;
    update public.platform_cases set outcome='account_restriction_lifted',response='The account restriction from this case was lifted after an appeal.',revision=revision+1,updated_at=now() where id=c.id;
  end if;
  insert into public.platform_case_events(case_id,actor_id,action,public_response) values(c.id,auth.uid(),case when p_accept then 'appeal_accept' else 'appeal_reject' end,btrim(p_response)) returning id into event;
  if s.user_id is not null then insert into public.platform_notifications(user_id,event_id,text,link) values(s.user_id,event,case when p_accept then 'Your account appeal was accepted. Other active restrictions, if any, still apply.' else 'Your account appeal was rejected.' end||' Justification: '||btrim(p_response),'/account-status'); end if;
  if p_accept then insert into public.platform_notifications(user_id,event_id,text,link) select reporter_id,event,'AGENTME updated the decision on your report.','/reports/'||id::text from public.platform_reports where case_id=c.id and reporter_id is not null on conflict do nothing; end if;
end $$;
revoke execute on function public.review_account_appeal(uuid,boolean,text) from public,anon;
grant execute on function public.review_account_appeal(uuid,boolean,text) to authenticated;

create or replace function public.owner_attention_count() returns bigint language sql stable security definer set search_path=public,pg_temp as $$
  select (select count(*) from public.inbox_items i where i.owner_id=auth.uid() and i.status='open' and (i.kind in ('info_request','question') or (i.kind='group_invite' and public.open_group_invitation(i.id))))
    + (select count(*) from public.platform_cases c where c.status in ('open','in_review') and public.can_review_platform_target(c.target_kind,c.target_key))
    + (select count(*) from public.platform_notifications n where user_id=auth.uid() and seen_at is null and not exists(select 1 from public.platform_evidence_requests q join public.platform_reports r on r.id=q.report_id where q.status='open' and r.reporter_id=auth.uid() and n.link='/reports/'||r.id::text))
    + (select count(*) from public.platform_evidence_requests q join public.platform_reports r on r.id=q.report_id where q.status='open' and r.reporter_id=auth.uid())
    + (select count(*) from public.reports r where r.message_id is not null and r.status='open' and ((r.community_id is not null and public.community_role(r.community_id) in ('owner','moderator')) or (r.community_id is null and public.conversation_role(r.conversation_id) in ('owner','admin'))))
    + public.open_account_appeal_count();
$$;
