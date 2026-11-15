-- Joining through a link or an approved request also settles any earlier direct invitation.
create function public.resolve_joined_invitations() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.inbox_items set status='answered',answered_at=now()
    where owner_id=new.user_id and kind='group_invite' and status='open' and payload->>'conversation_id'=new.conversation_id::text;
  return null;
end $$;
revoke execute on function public.resolve_joined_invitations() from public,anon,authenticated;
create trigger member_resolves_invitations after insert on public.conversation_members for each row execute function public.resolve_joined_invitations();
