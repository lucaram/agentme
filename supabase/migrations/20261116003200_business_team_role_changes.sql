-- A demoted supervisor and their Staff use the configured receiving Owner.
-- Newly invited Staff continue to report to the inviting Owner/Manager.
do $$ declare d text; begin
  d:=pg_get_functiondef('public.business_reporting_before()'::regprocedure);
  d:=replace(d,'new.supervisor_id:=coalesce(new.supervisor_id,(select user_id',
    'new.supervisor_id:=case when tg_op=''UPDATE'' and old.role in (''owner'',''manager'') then public.business_default_owner(b,new.user_id) else coalesce(new.supervisor_id,(select user_id');
  d:=replace(d,'public.business_default_owner(b));','public.business_default_owner(b)) end;'); execute d;
  d:=pg_get_functiondef('public.claim_business_question(uuid,uuid,boolean)'::regprocedure);
  d:=replace(d,'if not public.business_item_access(p_item,auth.uid(),public.workspace_role()) then',
    'if public.workspace_role()=''staff'' and exists(select 1 from public.business_managers where business_agent_id=business and user_id=auth.uid() and require_assignment) and not exists(select 1 from public.business_question_claims where inbox_id=p_item and assigned_to=auth.uid() and manager_assigned) then raise exception ''An Owner or Manager must assign this request to you before you can reply''; end if;
     if not public.business_item_access(p_item,auth.uid(),public.workspace_role()) then'); execute d;
end $$;
