-- Appearance belongs to the actual person AND the selected identity, including
-- Staff work sessions. It is never a shared business configuration setting.
create table public.identity_appearance (
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  appearance jsonb not null,
  primary key (user_id, agent_id),
  constraint valid_identity_appearance check ((
    jsonb_typeof(appearance) = 'object'
    and appearance ?& array['theme','accent','text','dark','tint']
    and (appearance - array['theme','accent','text','dark','tint']) = '{}'::jsonb
    and appearance->>'theme' in ('system','light','dark')
    and appearance->>'accent' in ('green','blue','purple','pink','orange','teal')
    and appearance->>'text' in ('standard','large','xl')
    and appearance->>'dark' in ('dim','black')
    and appearance->>'tint' in ('plain','tinted')
  ) is true)
);
alter table public.identity_appearance enable row level security;
revoke all on public.identity_appearance from public, anon, authenticated;
grant all on public.identity_appearance to service_role;
grant select on public.identity_appearance to authenticated;
create policy own_current_identity_appearance on public.identity_appearance
  for select to authenticated using (
    user_id = (select auth.uid())
    and agent_id = (select public.my_agent_id())
    and (select public.workspace_session_allowed())
  );

-- Leave the former agents.appearance values intact as a migration baseline.
-- A person's later personal changes must not become another identity's default.
create function public.current_identity_appearance() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare target uuid; saved jsonb;
begin
  if not public.workspace_session_allowed() or auth.uid() is null then return '{}'::jsonb; end if;
  target := public.my_agent_id();
  select appearance into saved from public.identity_appearance
    where user_id=auth.uid() and agent_id=target;
  if saved is not null then return saved; end if;
  select appearance into saved from public.agents where owner_id=auth.uid();
  return coalesce(saved, '{}'::jsonb);
end $$;

create function public.set_identity_appearance(p_appearance jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;
begin
  if not public.workspace_session_allowed() or auth.uid() is null then raise exception 'Identity unavailable'; end if;
  target := public.my_agent_id();
  if target is null then raise exception 'Create your identity first'; end if;
  if p_appearance is null then raise exception 'Appearance is required'; end if;
  insert into public.identity_appearance(user_id,agent_id,appearance)
    values(auth.uid(),target,p_appearance)
    on conflict(user_id,agent_id) do update set appearance=excluded.appearance;
end $$;
revoke execute on function public.current_identity_appearance(), public.set_identity_appearance(jsonb) from public, anon;
grant execute on function public.current_identity_appearance(), public.set_identity_appearance(jsonb) to authenticated;
