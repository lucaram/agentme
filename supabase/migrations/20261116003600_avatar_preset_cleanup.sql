-- Keep storage cleanup correct for existing authenticated profile updates too.
create function public.discard_replaced_avatar() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  delete from public.profile_avatar_assets where agent_id=new.id and '/api/avatars/'||id::text<>new.avatar;
  return null;
end $$;
create trigger discard_replaced_avatar after update of avatar on public.agents for each row when(old.avatar is distinct from new.avatar) execute function public.discard_replaced_avatar();
revoke execute on function public.discard_replaced_avatar() from public,anon,authenticated;
