-- Direct callers only see suspension metadata for spaces they may read.
-- Trusted database triggers still see all rows through their definer context.
create or replace function public.space_is_suspended(p_conversation uuid) returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
  select coalesce((select c.platform_suspended or coalesce(cm.platform_suspended,false) from public.conversations c left join public.communities cm on cm.id=c.community_id where c.id=p_conversation),false);
$$;
