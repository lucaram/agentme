-- Existing tips were explicitly saved for automatic contact replies. Preserve
-- that permission; all new tips require an explicit sharing choice.
alter table public.agent_tips add column disclosure public.disclosure_level not null default 'contacts';
alter table public.agent_tips alter column disclosure set default 'private';
