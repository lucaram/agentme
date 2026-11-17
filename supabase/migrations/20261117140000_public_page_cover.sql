-- A business's public page can have a cover image (My Business -> Public page & sharing).
-- Stored like profile avatars: in the private "profile-avatars" bucket as a re-encoded WebP,
-- served only through /api/covers/{id} while it is the business's current cover, and removed
-- through the same deletion queue when it is replaced, removed or the business is deleted.

create table public.business_page_covers (
  agent_id uuid primary key references public.agents (id) on delete cascade,
  id uuid not null unique,
  path text not null unique,
  created_at timestamptz not null default now()
);
alter table public.business_page_covers enable row level security; -- server only
revoke all on public.business_page_covers from public, anon, authenticated;
grant all on public.business_page_covers to service_role;

-- A replaced or removed cover's file goes to the same queue as avatars (pruneAvatarFiles empties it).
create trigger business_page_cover_removed after delete or update on public.business_page_covers
  for each row execute function public.avatar_asset_removed();

-- Files nobody refers to are cleaned up after a day: covers are referred to as well.
create or replace function public.queue_unused_avatar_files() returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.profile_avatar_deletions(path)
    select name from storage.objects o where bucket_id = 'profile-avatars' and created_at < now() - interval '24 hours'
      and not exists (select 1 from public.profile_avatar_assets a where a.path = o.name)
      and not exists (select 1 from public.business_page_covers c where c.path = o.name)
    on conflict do nothing;
$$;
