-- An introduction remembers the My Agent thread it was asked in, so its outcome
-- ("… accepted your introduction") goes back to that thread.
alter table public.introductions add column thread_id uuid references public.agent_threads (id) on delete set null;
