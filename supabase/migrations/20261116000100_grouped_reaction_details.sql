-- Keep the two-argument function available for older clients. The new overload
-- filters before pagination, while retaining the caller's existing RLS scope.
create function public.get_message_reaction_details(p_message uuid,p_offset integer,p_reaction text) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare items jsonb;
begin
  if auth.uid() is null or p_offset is null or p_offset<0 or p_offset>10000
    or (p_reaction is not null and p_reaction not in ('heart','up','down','happy','angry','sad','laugh','cry')) then raise exception 'Invalid reaction request'; end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into items from (
    select r.user_id,r.reaction,r.reacted_at,a.display_name name,a.handle,a.avatar
    from public.message_reactions r left join lateral (select display_name,handle,avatar from public.agents where owner_id=r.user_id order by created_at,id limit 1) a on true
    where r.message_id=p_message and (p_reaction is null or r.reaction=p_reaction)
    order by r.reacted_at desc,r.user_id limit 51 offset p_offset
  ) x;
  return jsonb_build_object('items',items-50,'hasMore',jsonb_array_length(items)>50);
end $$;
revoke execute on function public.get_message_reaction_details(uuid,integer,text) from public,anon;
grant execute on function public.get_message_reaction_details(uuid,integer,text) to authenticated;
