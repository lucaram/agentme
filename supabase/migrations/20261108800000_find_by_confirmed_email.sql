-- Find people by their confirmed account email directly, so everyone with a
-- confirmed email is findable from the start (not only after logging in again).
-- Server-only: never callable from the browser.
create function public.confirmed_users_by_email(p_emails text[])
returns table (user_id uuid, email text)
language sql stable security definer set search_path = public, auth as $$
  select u.id, lower(u.email)
  from auth.users u
  where lower(u.email) = any (p_emails)
    and u.email_confirmed_at is not null
    and coalesce(u.is_anonymous, false) = false
$$;
revoke execute on function public.confirmed_users_by_email(text[]) from public, anon, authenticated;
