-- Notify only the affected account/managed identities, without publishing sanction details.
create table public.account_access_versions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1
);
alter table public.account_access_versions enable row level security;
revoke all on public.account_access_versions from anon,authenticated;
grant all on public.account_access_versions to service_role;
grant select on public.account_access_versions to authenticated;
create policy own_access_version on public.account_access_versions for select to authenticated using(user_id=auth.uid());
alter publication supabase_realtime add table public.account_access_versions;
create function public.bump_account_access() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.account_access_versions(user_id)
    select id from auth.users where id=new.user_key
    union select a.owner_id from public.business_managers bm join public.agents a on a.id=bm.business_agent_id where bm.user_id=new.user_key
    on conflict(user_id) do update set revision=public.account_access_versions.revision+1;
  return null;
end $$;
revoke execute on function public.bump_account_access() from public,anon,authenticated;
create trigger account_sanction_access after insert or update on public.platform_account_sanctions for each row execute function public.bump_account_access();

-- A restricted person reads the decision at /account-status and can still appeal.
-- Creating a normal chat membership for them would be rejected by participation guards.
create or replace function public.ensure_moderation_agent_home() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare conversation uuid;
begin
  if public.account_is_restricted(new.user_id) then return null; end if;
  if tg_table_name in ('platform_moderators','platform_operators') then if not new.enabled then return null; end if; end if;
  perform pg_advisory_xact_lock(hashtextextended('my-agent:'||new.user_id::text,0));
  select c.id into conversation from public.conversations c join public.conversation_members cm on cm.conversation_id=c.id where c.kind='my_agent' and cm.user_id=new.user_id limit 1;
  if conversation is null then
    insert into public.conversations(kind,created_by) values('my_agent',new.user_id) returning id into conversation;
    insert into public.conversation_members(conversation_id,user_id) values(conversation,new.user_id);
  end if;
  return null;
end $$;
