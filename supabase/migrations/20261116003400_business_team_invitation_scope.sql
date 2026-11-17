-- Renewal must not silently make another Manager's prospective Staff report
-- to the caller. Owners retain access to every invitation in the business.
do $$ declare d text; begin
  d:=pg_get_functiondef('public.issue_business_invite(text,text,text,uuid)'::regprocedure);
  d:=replace(d,'actor_role=''manager'' and old_invite.role<>''staff''',
    'actor_role=''manager'' and (old_invite.role<>''staff'' or old_invite.invited_by is distinct from auth.uid())'); execute d;
  d:=pg_get_functiondef('public.cancel_business_invite(uuid)'::regprocedure);
  d:=replace(d,'public.workspace_role()=''manager'' and invitation.role<>''staff''',
    'public.workspace_role()=''manager'' and (invitation.role<>''staff'' or invitation.invited_by is distinct from auth.uid())'); execute d;
  -- A former member can have different historical names. Offer one filter per
  -- identity, using its latest recorded name rather than duplicate choices.
  d:=pg_get_functiondef('public.business_team_dashboard_options()'::regprocedure);
  d:=replace(d,'select distinct e.supervisor_id,e.supervisor_name,e.supervisor_handle',
    'select distinct e.supervisor_id,first_value(e.supervisor_name) over(partition by e.supervisor_id order by e.occurred_at desc,e.id desc),first_value(e.supervisor_handle) over(partition by e.supervisor_id order by e.occurred_at desc,e.id desc)');
  d:=replace(d,'select distinct e.actor_id,e.actor_name,e.actor_handle',
    'select distinct e.actor_id,first_value(e.actor_name) over(partition by e.actor_id order by e.occurred_at desc,e.id desc),first_value(e.actor_handle) over(partition by e.actor_id order by e.occurred_at desc,e.id desc)'); execute d;
end $$;
