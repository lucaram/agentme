create function public.business_work_inbox() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b uuid:=public.my_agent_id(); result jsonb;
begin
  if not public.business_permission('read') then raise exception 'Business access unavailable'; end if;
  if exists(select 1 from public.business_team_transfers where business_agent_id=b and status='pending' and expires_at<=now()) then
    perform 1 from public.agents where id=b for update; perform public.business_expire_team_transfers(b);
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') into result from (
    select n.id,n.kind,n.text,n.created_at,t.id transfer_id,t.staff_name,t.from_name,t.to_name,t.requester_name,t.expires_at
      from public.business_work_notices n left join public.business_team_transfers t on t.id=n.transfer_id
      where n.business_agent_id=b and n.recipient_id=auth.uid() and ((n.kind='information' and n.seen_at is null) or (n.kind='transfer_request' and t.status='pending' and t.expires_at>now() and t.to_supervisor=auth.uid() and public.workspace_role() in ('owner','manager')))
      order by n.created_at,n.id limit 30
  ) x;
  return result;
end $$;
revoke execute on function public.business_work_inbox() from public,anon;
grant execute on function public.business_work_inbox() to authenticated;
do $$ declare d text; begin
  d:=pg_get_functiondef('public.business_finish_team_transfer(uuid,text,uuid)'::regprocedure);
  d:=replace(d,'where transfer_id=p_id and kind=''transfer_request''','where transfer_id=p_id'); execute d;
  d:=pg_get_functiondef('public.respond_business_staff_transfer(uuid,text)'::regprocedure);
  d:=replace(d,'if t.status<>''pending'' then return; end if;','');
  d:=replace(d,'if t.expires_at<=now()', 'if t.status<>''pending'' then return; end if;
    if t.expires_at<=now()'); execute d;
end $$;
