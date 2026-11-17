-- Renew the original recipient's invitation, never a caller-supplied recipient.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.issue_business_invite(text,text,text,uuid)'::regprocedure);
  definition:=replace(definition,'if invitation is null then raise exception ''Invitation unavailable''; end if;',
    'if invitation is null then raise exception ''Invitation unavailable''; end if;
     select email,recipient_user,role into address,recipient,p_role from public.business_staff_invites where id=invitation;');
  definition:=replace(definition,'perform 1 from public.agents where id=business for update;',
    'perform 1 from public.agents where id=business for update;
     if (select count(*) from public.business_staff_audit where business_agent_id=business and action like ''Invitation %'' and created_at>now()-interval ''1 hour'')>=50 then raise exception ''Too many invitations; try again later''; end if;');
  execute definition;
end $$;
