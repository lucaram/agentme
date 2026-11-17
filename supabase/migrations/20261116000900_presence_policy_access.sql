-- Policies call the narrow security-definer session check rather than exposing
-- the platform's private account-restriction helper to authenticated callers.
alter policy own_presence_preferences on public.presence_preferences using(agent_id=public.my_agent_id() and public.presence_session_valid());
