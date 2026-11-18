-- My Agent reads a photo, PDF or text file once and keeps private notes on it, so later questions in the
-- same topic don't need the file again. The notes are for the owner's own agent only: no client can read
-- them (the column is outside the select grant), and they are never passed on as they are.
alter table public.chat_attachments
  add column agent_notes text check (agent_notes is null or char_length(agent_notes) <= 20000),
  add column agent_notes_at timestamptz;
