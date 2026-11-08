-- Finding people you know: mutual address-book matching, introductions,
-- personal links/QR codes and plan invite links (with guest accounts).
--
-- Privacy rules (enforced in lib/people/*):
--   * Address books are never stored. Uploaded entries are compared and only
--     matches to people already on AGENTME are kept, as (owner, matched) pairs.
--   * Own emails/phones are stored only as keyed hashes (HMAC), plus a masked
--     hint the owner sees ("+44 •••• 0123").
--   * A suggestion appears only when BOTH people have each other.
-- None of these tables has browser-facing write policies; server code writes.

-- ---------------------------------------------------------------- guests
-- People who joined a plan from an invite link without creating a full account
-- (anonymous Supabase user). They can save their account later.
alter table public.agents add column guest boolean not null default false;

-- When the person last synced their address book (null = never).
alter table public.agents add column contacts_synced_at timestamptz;

-- ---------------------------------------------------------------- identifiers
create table public.agent_identifiers (
  agent_id uuid not null references public.agents (id) on delete cascade,
  kind text not null check (kind in ('email', 'phone')),
  hash text not null,
  hint text not null check (char_length(hint) <= 40),
  verified_at timestamptz not null default now(),
  primary key (agent_id, kind)
);
-- One account per email/phone: verifying a number moves it to the newest owner.
create unique index agent_identifiers_hash_idx on public.agent_identifiers (hash);

-- Pending phone verifications (code stored hashed, short-lived, limited attempts).
create table public.phone_verifications (
  agent_id uuid primary key references public.agents (id) on delete cascade,
  phone_hash text not null,
  hint text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null
);

-- "owner has matched in their address book". Only people already on AGENTME.
create table public.address_book_matches (
  owner_agent uuid not null references public.agents (id) on delete cascade,
  matched_agent uuid not null references public.agents (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_agent, matched_agent),
  check (owner_agent <> matched_agent)
);
create index address_book_matches_matched_idx on public.address_book_matches (matched_agent);

-- ---------------------------------------------------------------- introductions
create table public.introductions (
  id uuid primary key default gen_random_uuid(),
  introducer_agent uuid not null references public.agents (id) on delete cascade,
  a_agent uuid not null references public.agents (id) on delete cascade,
  b_agent uuid not null references public.agents (id) on delete cascade,
  note text check (note is null or char_length(note) <= 280),
  a_answer text check (a_answer in ('accepted', 'declined')),
  b_answer text check (b_answer in ('accepted', 'declined')),
  status text not null default 'pending' check (status in ('pending', 'connected', 'declined')),
  created_at timestamptz not null default now(),
  check (a_agent <> b_agent),
  check (introducer_agent <> a_agent and introducer_agent <> b_agent)
);

alter table public.inbox_items drop constraint inbox_items_kind_check;
alter table public.inbox_items add constraint inbox_items_kind_check check (kind in ('info_request', 'question', 'introduction'));

-- ---------------------------------------------------------------- plan invites
create table public.plan_invites (
  token text primary key check (char_length(token) >= 20),
  task_id uuid not null references public.tasks (id) on delete cascade,
  created_by uuid not null references public.agents (id) on delete cascade,
  uses integer not null default 0,
  revoked boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index plan_invites_task_idx on public.plan_invites (task_id);

/**
 * Adds a person to a plan in one locked transaction (no lost updates when two
 * people join at once): the plan's participants, open polls' voters and
 * sign-up lists' people. Returns 'added', 'already' or 'full'.
 */
create function public.add_plan_participant(p_task uuid, p_handle text, p_max integer) returns text
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks%rowtype;
  organiser text;
  participants jsonb;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found then return 'missing'; end if;
  select handle into organiser from public.agents where id = t.initiator_agent;
  participants := coalesce(t.parsed -> 'participants', '[]'::jsonb);
  if organiser = p_handle or participants ? p_handle then return 'already'; end if;
  if jsonb_array_length(participants) + 1 >= p_max then return 'full'; end if;

  update public.tasks
     set parsed = jsonb_set(t.parsed, '{participants}', participants || to_jsonb(p_handle))
   where id = p_task;
  update public.plan_steps
     set config = jsonb_set(config, '{voters}', coalesce(config -> 'voters', '[]'::jsonb) || to_jsonb(p_handle))
   where task_id = p_task and type = 'poll' and status <> 'done' and not (coalesce(config -> 'voters', '[]'::jsonb) ? p_handle);
  update public.plan_steps
     set config = jsonb_set(config, '{people}', coalesce(config -> 'people', '[]'::jsonb) || to_jsonb(p_handle))
   where task_id = p_task and type = 'assign' and status <> 'done' and not (coalesce(config -> 'people', '[]'::jsonb) ? p_handle);
  return 'added';
end $$;
revoke execute on function public.add_plan_participant(uuid, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.agent_identifiers enable row level security;
alter table public.phone_verifications enable row level security;
alter table public.address_book_matches enable row level security;
alter table public.introductions enable row level security;
alter table public.plan_invites enable row level security;

-- Owners see their own (masked) identifiers. Everything else is server-only.
create policy identifiers_read_own on public.agent_identifiers
  for select to authenticated using (agent_id = public.my_agent_id());

-- The people in an introduction (and the introducer) can see it.
create policy introductions_read on public.introductions
  for select to authenticated
  using (public.my_agent_id() in (introducer_agent, a_agent, b_agent));

create function public.increment_invite_uses(p_token text) returns void
language sql security definer set search_path = public as $$
  update public.plan_invites set uses = uses + 1 where token = p_token
$$;
revoke execute on function public.increment_invite_uses(text) from public, anon, authenticated;
