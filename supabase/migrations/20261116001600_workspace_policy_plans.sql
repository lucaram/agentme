-- Resolve a request's fixed workspace once per policy statement, rather than
-- repeating session/membership lookups for every message in a long history.
do $$ declare p record; statement text; expression text; begin
  for p in select * from pg_policies where schemaname in ('public','storage') and (coalesce(qual,'') like '%workspace_%' or coalesce(with_check,'') like '%workspace_%') loop
    statement:=format('alter policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);
    if p.qual is not null then
      expression:=regexp_replace(p.qual,'(public\.)?workspace_user_id\(\)','(select public.workspace_user_id())','g');
      expression:=regexp_replace(expression,'(public\.)?workspace_session_allowed\(\)','(select public.workspace_session_allowed())','g');
      statement:=statement||' using ('||expression||')';
    end if;
    if p.with_check is not null then
      expression:=regexp_replace(p.with_check,'(public\.)?workspace_user_id\(\)','(select public.workspace_user_id())','g');
      expression:=regexp_replace(expression,'(public\.)?workspace_session_allowed\(\)','(select public.workspace_session_allowed())','g');
      statement:=statement||' with check ('||expression||')';
    end if;
    execute statement;
  end loop;
end $$;

-- A work role never grants AGENTME platform reviewer/operator powers.
create or replace function public.is_platform_moderator() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.workspace_user_id()=auth.uid() and public.workspace_role() is null and exists(select 1 from public.platform_moderators where user_id=auth.uid() and enabled) and not public.account_is_restricted(auth.uid());
$$;
create or replace function public.is_platform_operator() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.workspace_user_id()=auth.uid() and public.workspace_role() is null and exists(select 1 from public.platform_operators where user_id=auth.uid() and enabled) and not public.account_is_restricted(auth.uid());
$$;

do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.guard_restricted_caller()'::regprocedure);
  execute replace(definition,'if not public.workspace_session_allowed() then raise exception ''This workspace is unavailable.''; end if;',
    'if public.direct_account_restricted(auth.uid()) or public.account_is_restricted(public.workspace_user_id()) then raise exception ''This account is restricted by AGENTME.''; end if;
     if not public.workspace_session_allowed() then raise exception ''This workspace is unavailable.''; end if;');
end $$;
