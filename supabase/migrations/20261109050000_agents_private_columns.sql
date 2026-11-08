-- Agents are readable by any signed-in user (names, handles, avatars), but some
-- columns are private and only the server (service role) may read them:
--  - business_info: includes "For customers only", which a business's agent
--    shares only with its own contacts;
--  - contact_sources, contacts_synced_at, discoverable, recommendations_ok,
--    group_add_policy: a person's own settings.
-- The row policy can't hide columns, so the browser roles get column grants.

revoke select on public.agents from anon, authenticated;
grant select (id, owner_id, handle, display_name, avatar, type, bio, contact_policy, guest, created_at)
  on public.agents to authenticated;
