-- Staff badges count requests they can actually handle, not owner approvals.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.identity_badge(uuid)'::regprocedure);
  definition:=replace(definition,'public.identity_badge(','public.identity_staff_badge(');
  definition:=replace(definition,'i.status = ''open''','i.status = ''open'' and i.kind=''question'' and i.payload->>''business''=''true''');
  execute definition;
  definition:=pg_get_functiondef('public.open_owner_requests(text[],uuid[])'::regprocedure);
  execute replace(definition,'and (p_kinds is null',
    'and (public.workspace_role() is distinct from ''staff'' or (i.kind=''question'' and i.payload->>''business''=''true'')) and (p_kinds is null');
  definition:=pg_get_functiondef('public.owner_attention_count()'::regprocedure);
  execute replace(definition,'public.owner_attention_count(','public.owner_attention_total(');
end $$;
revoke execute on function public.identity_staff_badge(uuid),public.owner_attention_total() from public,anon,authenticated;
grant execute on function public.identity_staff_badge(uuid) to service_role;
create or replace function public.owner_attention_count() returns bigint language sql stable security definer set search_path=public,pg_temp as $$
  select case when public.workspace_role()='staff' then
    (select count(*) from public.inbox_items where owner_id=public.workspace_user_id() and status='open' and kind='question' and payload->>'business'='true')
    else public.owner_attention_total() end;
$$;
