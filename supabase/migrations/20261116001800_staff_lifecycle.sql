-- JWT session IDs are UUIDs. Keep lookups on the indexed UUID keys.
do $$ declare f record; definition text; begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('workspace_user_id','workspace_context') loop
    definition:=pg_get_functiondef(f.oid);
    definition:=replace(definition,'s.id::text=auth.jwt()->>''session_id''','s.id=(auth.jwt()->>''session_id'')::uuid');
    definition:=replace(definition,'session_id::text=auth.jwt()->>''session_id''','session_id=(auth.jwt()->>''session_id'')::uuid');
    execute definition;
  end loop;
end $$;

-- Leaving staff do not strand customer requests or retain invitation authority.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.business_membership_changed()'::regprocedure);
  definition:=replace(definition,'return null;',
    'if tg_op=''DELETE'' then
       update public.business_question_claims set assigned_to=null,assigned_name=null,claimed_at=null,processing_token=null,processing_until=null where business_agent_id=business and assigned_to=who and handled_at is null;
     end if;
     if tg_op=''DELETE'' or new.role not in (''owner'',''manager'') then
       update public.business_staff_invites set status=''revoked'',responded_at=now() where business_agent_id=business and invited_by=who and status=''pending'';
     elsif new.role=''manager'' then
       update public.business_staff_invites set status=''revoked'',responded_at=now() where business_agent_id=business and invited_by=who and status=''pending'' and role=''manager'';
     end if;
     update public.inbox_items set status=''withdrawn'' where kind=''business_invitation'' and status=''open'' and payload->>''invite_id'' in (select id::text from public.business_staff_invites where business_agent_id=business and status=''revoked'');
     return null;');
  execute definition;
end $$;
