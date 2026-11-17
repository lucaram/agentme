-- Restricted-assignment Staff are notified only about requests they can handle.
do $$ declare d text; begin
  d:=pg_get_functiondef('public.notification_attention(uuid,text,uuid)'::regprocedure);
  d:=replace(d,'and payload->>''business''=''true''',
    'and payload->>''business''=''true'' and (not exists(select 1 from public.business_managers m join public.agents a on a.id=m.business_agent_id where a.owner_id=p_user and m.user_id=p_actor and m.require_assignment) or exists(select 1 from public.business_question_claims c where c.inbox_id=public.inbox_items.id and c.assigned_to=p_actor and c.manager_assigned))');
  execute d;
  d:=pg_get_functiondef('public.open_owner_requests(text[],uuid[])'::regprocedure);
  d:=replace(d,'and (p_kinds is null',
    'and (public.workspace_role() is distinct from ''staff'' or not exists(select 1 from public.business_managers where business_agent_id=public.my_agent_id() and user_id=auth.uid() and require_assignment) or exists(select 1 from public.business_question_claims c where c.inbox_id=i.id and c.assigned_to=auth.uid() and c.manager_assigned)) and (p_kinds is null');
  execute d;
  d:=pg_get_functiondef('public.set_business_staff_controls(uuid,boolean,boolean)'::regprocedure);
  d:=replace(d,'select role into target_role',
    'if not exists(select 1 from public.business_managers where business_agent_id=business and user_id=auth.uid() and role in (''owner'',''manager'')) then raise exception ''Only current Owners and Managers can change Staff permissions''; end if;
     select role into target_role');
  execute d;
end $$;
