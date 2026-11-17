-- Topic pages retain SECURITY INVOKER and message RLS. Expose only a wrapper
-- bound to the authenticated workspace, never the arbitrary-identity helper.
create function public.workspace_business_note_access(p_metadata jsonb) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.workspace_session_allowed() and public.business_note_access(p_metadata,public.workspace_user_id(),auth.uid(),public.workspace_role());
$$;
revoke execute on function public.workspace_business_note_access(jsonb) from public,anon;
grant execute on function public.workspace_business_note_access(jsonb) to authenticated;
do $$ declare f text; d text; begin
  foreach f in array array['public.my_agent_topic_page(uuid,text,timestamptz,uuid,text,timestamptz)','public.my_agent_threads()'] loop
    d:=pg_get_functiondef(f::regprocedure);
    d:=replace(d,'public.business_note_access(m.metadata,public.workspace_user_id(),auth.uid(),public.workspace_role())','public.workspace_business_note_access(m.metadata)'); execute d;
  end loop;
end $$;
