-- Leaving a space must not let a reporter or its administrators review their own case.
alter table public.platform_cases add column excluded_reviewers uuid[] not null default '{}';
create function public.capture_platform_conflicts() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  select coalesce(array_agg(user_id),'{}') into new.excluded_reviewers from (
    select user_id from public.conversation_members where new.target_kind='group' and conversation_id=new.target_key and role in ('owner','admin')
    union select user_id from public.community_members where new.target_kind='community' and community_id=new.target_key and role in ('owner','moderator')
  ) owners;
  return new;
end $$;
revoke execute on function public.capture_platform_conflicts() from public,anon,authenticated;
create trigger platform_case_conflicts before insert on public.platform_cases for each row execute function public.capture_platform_conflicts();
update public.platform_cases c set excluded_reviewers=coalesce((select array_agg(user_id) from (
  select user_id from public.conversation_members where c.target_kind='group' and conversation_id=c.target_key and role in ('owner','admin')
  union select user_id from public.community_members where c.target_kind='community' and community_id=c.target_key and role in ('owner','moderator')
) owners),'{}');
create or replace function public.can_review_platform_target(p_kind text,p_target uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_platform_moderator()
    and not exists(select 1 from public.platform_cases c where c.target_kind=p_kind and c.target_key=p_target and auth.uid()=any(c.excluded_reviewers))
    and not exists(select 1 from public.platform_reports r join public.platform_cases c on c.id=r.case_id where c.target_kind=p_kind and c.target_key=p_target and r.reporter_id=auth.uid())
    and case p_kind when 'group' then not exists(select 1 from public.conversation_members where conversation_id=p_target and user_id=auth.uid())
      when 'community' then not exists(select 1 from public.community_members where community_id=p_target and user_id=auth.uid()) else false end;
$$;
