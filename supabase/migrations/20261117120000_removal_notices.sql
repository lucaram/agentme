-- Removed from a business, or left it: the Staff who reported to that person are told which, in
-- their work updates (My Agent, while working in the business), with who they report to now.
-- The removal itself is unchanged: access, work sessions and the audit history behave as before,
-- and a later invitation to the same person works as a fresh start.
--
-- How the trigger knows why the row went: change_business_member (removal) and leave_business
-- set a transaction-local "agentme.departure" before deleting. Anything else keeps the old wording.

do $$ declare d text; old_text text := $t$'Your supervisor has left that role. You now report to '||coalesce(public.business_actor_name(fallback),'the business Owner')||'.'$t$;
begin
  d := pg_get_functiondef('public.business_reporting_before()'::regprocedure);
  if position(old_text in d) = 0 then raise exception 'business_reporting_before: notice text not found'; end if;
  d := replace(d, old_text, $t$case
        when tg_op='DELETE' and current_setting('agentme.departure', true)='removed' then
          public.business_actor_name(old.user_id)||', who you reported to, was removed from the business on '||to_char(now() at time zone 'UTC','FMDD Mon YYYY "at" HH24:MI "UTC"')||'. You now report to '||coalesce(public.business_actor_name(fallback),'the business Owner')||'.'
        when tg_op='DELETE' and current_setting('agentme.departure', true)='left' then
          public.business_actor_name(old.user_id)||', who you reported to, left the business. You now report to '||coalesce(public.business_actor_name(fallback),'the business Owner')||'.'
        else 'Your supervisor has left that role. You now report to '||coalesce(public.business_actor_name(fallback),'the business Owner')||'.'
      end$t$);
  execute d;

  d := pg_get_functiondef('public.change_business_member(uuid,text,boolean)'::regprocedure);
  if position('if p_role=''remove'' then delete from public.business_managers' in d) = 0 then raise exception 'change_business_member: removal not found'; end if;
  d := replace(d, 'if p_role=''remove'' then delete from public.business_managers',
    'if p_role=''remove'' then perform set_config(''agentme.departure'',''removed'',true); delete from public.business_managers');
  execute d;

  d := pg_get_functiondef('public.leave_business(uuid,uuid,boolean)'::regprocedure);
  if position('delete from public.business_managers where business_agent_id = p_business and user_id = p_person;' in d) = 0 then raise exception 'leave_business: delete not found'; end if;
  d := replace(d, 'delete from public.business_managers where business_agent_id = p_business and user_id = p_person;',
    'perform set_config(''agentme.departure'', ''left'', true);
  delete from public.business_managers where business_agent_id = p_business and user_id = p_person;');
  execute d;
end $$;
