insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-avatars','profile-avatars',false,786432,array['image/webp']) on conflict(id) do nothing;

create table public.profile_avatar_assets(
  id uuid primary key, agent_id uuid not null unique references public.agents(id) on delete cascade,
  path text not null unique, created_at timestamptz not null default now()
);
create table public.profile_avatar_deletions(path text primary key,created_at timestamptz not null default now());
alter table public.profile_avatar_assets enable row level security;
alter table public.profile_avatar_deletions enable row level security;
revoke all on public.profile_avatar_assets,public.profile_avatar_deletions from public,anon,authenticated;
grant all on public.profile_avatar_assets,public.profile_avatar_deletions to service_role;

create function public.avatar_asset_removed() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' or new.path is distinct from old.path then insert into public.profile_avatar_deletions(path) values(old.path) on conflict do nothing; end if;
  return null;
end $$;
create trigger avatar_asset_removed after delete or update on public.profile_avatar_assets for each row execute function public.avatar_asset_removed();
create function public.check_profile_avatar_reference() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.avatar like '/api/avatars/%' then
    if not exists(select 1 from public.profile_avatar_assets where agent_id=new.id and '/api/avatars/'||id::text=new.avatar) then raise exception 'Choose your own uploaded avatar'; end if;
  elsif length(new.avatar)>16 then raise exception 'Choose an avatar preset or upload an image'; end if;
  return new;
end $$;
create trigger check_profile_avatar_reference before insert or update of avatar on public.agents for each row execute function public.check_profile_avatar_reference();

-- Only the application can commit decoded/re-encoded images. Recheck the
-- actual person's live role under the business lock, including after upload.
create function public.commit_profile_avatar(p_agent uuid,p_actor uuid,p_preset text default null,p_asset uuid default null,p_path text default null) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.agents; value text;
begin
  select * into a from public.agents where id=p_agent for update;
  if not found or p_actor is null or public.direct_account_restricted(p_actor) or public.account_is_restricted(a.owner_id) then raise exception 'Profile access unavailable'; end if;
  if a.type='business' then
    if not exists(select 1 from public.business_managers where business_agent_id=a.id and user_id=p_actor and role in ('owner','manager')) and not (a.owner_id=p_actor and not exists(select 1 from public.business_managers where business_agent_id=a.id)) then raise exception 'Only Owners and Managers can change the business avatar'; end if;
  elsif a.owner_id<>p_actor then raise exception 'Choose your own profile'; end if;
  if p_asset is not null then
    if p_preset is not null or p_path is distinct from a.id::text||'/'||p_asset::text||'.webp' or not exists(select 1 from storage.objects where bucket_id='profile-avatars' and name=p_path) then raise exception 'Upload unavailable'; end if;
    insert into public.profile_avatar_assets(id,agent_id,path) values(p_asset,a.id,p_path)
      on conflict(agent_id) do update set id=excluded.id,path=excluded.path,created_at=now();
    value:='/api/avatars/'||p_asset::text;
  else
    if p_preset is null or length(p_preset) not between 1 and 16 or p_preset like '/%' then raise exception 'Choose an avatar preset'; end if;
    value:=p_preset;
  end if;
  update public.agents set avatar=value where id=a.id;
  if p_asset is null then delete from public.profile_avatar_assets where agent_id=a.id; end if;
  return value;
end $$;
create function public.queue_unused_avatar_files() returns void language sql security definer set search_path=public,pg_temp as $$
  insert into public.profile_avatar_deletions(path)
    select name from storage.objects o where bucket_id='profile-avatars' and created_at<now()-interval '24 hours'
      and not exists(select 1 from public.profile_avatar_assets a where a.path=o.name) on conflict do nothing;
$$;
revoke execute on function public.avatar_asset_removed(),public.check_profile_avatar_reference(),public.commit_profile_avatar(uuid,uuid,text,uuid,text),public.queue_unused_avatar_files() from public,anon,authenticated;
grant execute on function public.commit_profile_avatar(uuid,uuid,text,uuid,text),public.queue_unused_avatar_files() to service_role;
