-- Only newly created identities get a setup invitation. Existing accounts are
-- unaffected; its dismissal is private to the identity's authenticated user.
create table public.onboarding_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dismissed_at timestamptz
);
alter table public.onboarding_state enable row level security;
create policy onboarding_state_read_own on public.onboarding_state for select to authenticated using(user_id=auth.uid());
create policy onboarding_state_update_own on public.onboarding_state for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke all on public.onboarding_state from anon,authenticated;
grant select on public.onboarding_state to authenticated;
grant update(dismissed_at) on public.onboarding_state to authenticated;
grant all on public.onboarding_state to service_role;
