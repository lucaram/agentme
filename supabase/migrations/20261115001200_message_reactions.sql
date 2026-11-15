-- Human reactions are separate from messages, unread counts and receipt state.
create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check(reaction in ('heart','up','down','happy','angry','sad','laugh','cry')),
  reacted_at timestamptz not null default clock_timestamp(),
  primary key(message_id,user_id)
);
create table public.message_reaction_versions (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  revision bigint not null default 1
);
alter table public.message_reactions enable row level security;
alter table public.message_reaction_versions enable row level security;
revoke all on public.message_reactions,public.message_reaction_versions from anon,authenticated;
grant all on public.message_reactions,public.message_reaction_versions to service_role;
grant select on public.message_reactions,public.message_reaction_versions to authenticated;
create policy reactions_read on public.message_reactions for select to authenticated using (
  exists(select 1 from public.messages m where m.id=message_id and m.visible_to is null and m.removed_at is null
    and (m.sender_user_id is not null or m.sender_agent_id is not null) and public.is_conversation_member(m.conversation_id))
);
create policy reaction_versions_read on public.message_reaction_versions for select to authenticated using(public.is_conversation_member(conversation_id));

create function public.reaction_version_changed() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare conv uuid;
begin
  select conversation_id into conv from public.messages where id=coalesce(new.message_id,old.message_id);
  if conv is not null then
    insert into public.message_reaction_versions(conversation_id) values(conv)
    on conflict(conversation_id) do update set revision=public.message_reaction_versions.revision+1;
  end if;
  return null;
end $$;
revoke execute on function public.reaction_version_changed() from public,anon,authenticated;
create trigger reaction_version_changed after insert or update or delete on public.message_reactions for each row execute function public.reaction_version_changed();
alter publication supabase_realtime add table public.message_reaction_versions;

create function public.clear_unavailable_reactions() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.removed_at is not null or new.visible_to is not null then delete from public.message_reactions where message_id=new.id; end if;
  return null;
end $$;
revoke execute on function public.clear_unavailable_reactions() from public,anon,authenticated;
create trigger messages_clear_reactions after update of removed_at,visible_to on public.messages for each row execute function public.clear_unavailable_reactions();

-- Bounded summaries: never send every reactor with every history chunk.
create function public.get_message_reactions(p_ids uuid[]) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or coalesce(cardinality(p_ids),0)>50 then raise exception 'Invalid reaction request'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('message_id',x.message_id,'counts',x.counts,'mine',x.mine)),'[]'::jsonb) from (
    select r.message_id,jsonb_object_agg(r.reaction,r.total) counts,max(r.mine) mine from (
      select message_id,reaction,count(*) total,max(case when user_id=auth.uid() then reaction end) mine
      from public.message_reactions where message_id=any(p_ids) group by message_id,reaction
    ) r group by r.message_id
  ) x);
end $$;
revoke execute on function public.get_message_reactions(uuid[]) from public,anon;
grant execute on function public.get_message_reactions(uuid[]) to authenticated;

create function public.set_message_reaction(p_message uuid,p_reaction text default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); m public.messages; c public.conversations; permitted boolean;
begin
  if u is null or (p_reaction is not null and p_reaction not in ('heart','up','down','happy','angry','sad','laugh','cry')) then raise exception 'Invalid reaction'; end if;
  select * into m from public.messages where id=p_message and visible_to is null and removed_at is null
    and (sender_user_id is not null or sender_agent_id is not null) and public.is_conversation_member(conversation_id) for update;
  if not found then raise exception 'Message unavailable'; end if;
  select * into c from public.conversations where id=m.conversation_id;
  if p_reaction is not null then
    -- Closed DMs and active community mutes must not be bypassed with reactions.
    if c.kind='dm' and not exists (
      select 1 from public.contacts ct join public.agents a on a.id=ct.requester_agent join public.agents b on b.id=ct.addressee_agent
      where ct.status='accepted' and (a.owner_id=u or b.owner_id=u)
      and exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=case when a.owner_id=u then b.owner_id else a.owner_id end)
    ) then raise exception 'Chat is closed'; end if;
    if c.kind='channel' and exists(select 1 from public.community_members cm where cm.community_id=c.community_id and cm.user_id=u and cm.muted_until>now()) then raise exception 'Reactions are unavailable while muted'; end if;
  end if;
  select allowed into permitted from public.rate_limit_hit('messageReactions:'||u::text,60,120);
  if not permitted then raise exception 'Too many reactions. Try again shortly.'; end if;
  if p_reaction is null then delete from public.message_reactions where message_id=m.id and user_id=u;
  else
    insert into public.message_reactions(message_id,user_id,reaction) values(m.id,u,p_reaction)
    on conflict(message_id,user_id) do update set reaction=excluded.reaction,reacted_at=clock_timestamp()
      where public.message_reactions.reaction<>excluded.reaction;
  end if;
  return public.get_message_reactions(array[m.id]);
end $$;
revoke execute on function public.set_message_reaction(uuid,text) from public,anon;
grant execute on function public.set_message_reaction(uuid,text) to authenticated;

create function public.get_message_reaction_details(p_message uuid,p_offset integer default 0) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare items jsonb;
begin
  if auth.uid() is null or p_offset<0 or p_offset>10000 then raise exception 'Invalid reaction request'; end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into items from (
    select r.user_id,r.reaction,r.reacted_at,a.display_name name,a.handle,a.avatar
    from public.message_reactions r left join lateral (select display_name,handle,avatar from public.agents where owner_id=r.user_id order by created_at,id limit 1) a on true
    where r.message_id=p_message order by r.reacted_at desc,r.user_id limit 51 offset p_offset
  ) x;
  return jsonb_build_object('items',items,'hasMore',jsonb_array_length(items)>50);
end $$;
revoke execute on function public.get_message_reaction_details(uuid,integer) from public,anon;
grant execute on function public.get_message_reaction_details(uuid,integer) to authenticated;
