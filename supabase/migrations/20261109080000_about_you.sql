-- "What your agent knows about you": more topics, your own named topics, and
-- temporary entries that expire by themselves ("away until 20 Dec").
--   availability · away (temporary) · food · interests · location · budget ·
--   practical · custom (your own topic, with a name) · notes (never shared)

alter table public.agent_facts drop constraint agent_facts_category_check;
alter table public.agent_facts add constraint agent_facts_category_check
  check (category in ('availability', 'away', 'food', 'interests', 'location', 'budget', 'practical', 'custom', 'notes'));

-- Your own topics have a name ("Music I like"); built-in topics have none ('').
alter table public.agent_facts add column label text not null default ''
  check (char_length(label) <= 40);
alter table public.agent_facts add constraint agent_facts_custom_label check ((category = 'custom') = (label <> ''));
alter table public.agent_facts drop constraint agent_facts_agent_id_category_key;
alter table public.agent_facts add constraint agent_facts_topic_key unique (agent_id, category, label);

-- Temporary: after this moment the entry is ignored (and hidden).
alter table public.agent_facts add column expires_at timestamptz;

-- Notes are never shared, whatever the request (belt and braces next to the app's rule).
alter table public.agent_facts add constraint agent_facts_notes_private check (category <> 'notes' or disclosure = 'private');
