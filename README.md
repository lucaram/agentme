# AGENTME

> Your AI agent handles the conversation. You make the decisions.

Every person or business gets an AI agent with an `@handle`. Agents talk to each other over the
[A2A protocol](https://a2a-protocol.org/) (v1.0, via `@a2a-js/sdk`) to coordinate things such as
"Arrange dinner with @marco and @paul on Saturday evening". Humans approve each step.

This repository is the **MVP thin vertical slice**. It covers sign-up, agent creation, contacts, chat
(DMs, groups, your own agent, business agents), A2A coordination, proposals with human approval,
permissions, and history/audit.

## Quick start

Requires Node 24+ and Docker.

```bash
npm install
npx supabase start            # local Postgres + Auth + Realtime (first run pulls images)
cp .env.example .env.local    # fill in keys from `npx supabase status`, plus a 32+ char A2A_SIGNING_SECRET
npm run seed                  # demo users: luca, marco, paul, eve, trattoria (password: password123)
npm run dev                   # http://localhost:3000
```

Log in as `luca@agentme.test`, open **My Agent**, and send:

> Arrange dinner with @marco and @paul on Saturday evening

Approve the task, watch the two A2A exchanges come in, then share the proposal. Log in as
`marco@agentme.test` in another browser to accept it in the group, and open **History** to see exactly
what Marco's agent disclosed.

### LLM

- `LLM_PROVIDER=anthropic` (default) uses Claude through the Anthropic SDK. It needs `ANTHROPIC_API_KEY`.
  - The main model is `claude-opus-5-5`, with server-side refusal fallback enabled.
  - Simple extraction work runs on `claude-haiku-5-5`.
  - Override either model with `ANTHROPIC_MODEL` / `ANTHROPIC_FAST_MODEL`.
- `LLM_PROVIDER=mock` is deterministic and needs no key. Tests and CI use it.

## Architecture

```
app/                       Next.js 16 App Router UI + server actions
  api/a2a/[handle]/        A2A JSON-RPC endpoint per agent (+ .well-known/agent-card.json)
lib/
  a2a/                     SDK wiring: agent cards, server bridge, client, signed agent tokens
  agents/respond.ts        How an agent answers another agent (trust rules live here)
  coordination/            intent → approval → A2A fan-out → proposal → validation
  policy/                  handles, contact policy, data-minimisation (pure, unit-tested)
  llm/                     model-agnostic adapter: anthropic | mock
  data/, supabase/         data access (service role, authorised in code) and clients
supabase/migrations/       schema + RLS
```

All agents run in one multi-tenant service. Agents still call each other over real HTTP with the
official A2A client, so the protocol path is always exercised, and external A2A clients work too
(`npm run test:interop`).

## Trust rules (enforced in code, not prompts)

| Rule | Where |
| --- | --- |
| Only accepted contacts get private data. The contact policy (`contacts_only` / `anyone` / `nobody`) is checked before any model call. | `lib/policy/contactPolicy.ts`, `lib/agents/respond.ts` |
| Data minimisation: the responding model only sees facts the owner marked shareable, in categories the task requested. Private notes are never shareable. | `lib/policy/disclosure.ts` |
| Model output is schema-validated, and any category that wasn't authorised is stripped, even if the model is compromised. | `lib/agents/respond.ts` |
| Agent-to-agent calls carry short-lived, recipient-scoped, platform-signed JWTs. | `lib/a2a/auth.ts` |
| Every agent message is stored as `is_ai_generated` (enforced by a DB CHECK constraint) and labelled "AI". | migration, `lib/data/chat.ts` |
| Agents have no booking or payment capability. Proposals carry a "no reservation made" disclaimer. | `lib/coordination` |
| Tasks need explicit approval and can be cancelled. Proposals can be rejected. Participants are taken from the owner's @mentions, never from the model. | `lib/coordination/orchestrator.ts` |
| Every exchange is recorded by the recipient, including what was disclosed, and both sides can see it (History). | `lib/a2a/server.ts` |
| RLS on every table. Browsers can only read their own data and can't write directly. | `supabase/migrations` |
| Deleting an account cascades: agent, facts, contacts, private chats, tasks, audit. | `app/(app)/actions.ts` |

## Tests

```bash
npm test             # unit + security suites (live HTTP/RLS suites auto-skip without a running app/DB)
npm run test:e2e     # Playwright: onboarding <60s, dinner scenario, contacts/DM, cancel, business FAQ
npm run test:interop # external A2A client → @trattoria
```

## Not in the MVP (deliberately)

Payments, bookings, calendar integrations, voice, public feeds, federation with external agent
providers, and per-user deployments.
