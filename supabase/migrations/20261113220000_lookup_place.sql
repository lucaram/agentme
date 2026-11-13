-- "Use my town for look-ups": when a look-up depends on where you are and names no place
-- ("what's the weather?", "a plumber near me"), your agent uses the town from "Where you
-- usually are". Only the town is sent with the search. On by default; off in Settings → Privacy.
alter table public.agents add column lookup_place boolean not null default true;
grant select (lookup_place) on public.agents to authenticated;
