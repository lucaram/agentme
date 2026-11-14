-- Owner-scoped reads let Realtime refresh analytics after a new button click.
-- Browsers cannot insert/update/delete events or read another business's events.
grant select on public.business_action_events to authenticated;
create policy business_action_events_owner on public.business_action_events for select to authenticated
using (exists(select 1 from public.agents a where a.id=agent_id and a.owner_id=auth.uid()));
