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

## Plans, blocks and the "ask my human" inbox (V2)

- **Plans are made of steps (blocks)** run by the plan engine (`lib/plans/engine.ts`). Each block has its own handler in
  `lib/plans/blocks/`. Milestone 1 implements `collect` (availability + preferences) and `proposal`. More blocks
  (RSVP v2, poll, question, recall, assign, threshold, change, announce) arrive in the next milestones.
- **A step can wait on people.** The task then releases its worker (status `waiting`), and it's woken and resumed
  when someone answers. Resuming reuses everything that already happened.
- **Ask my human.** When a *contact's* agent asks for something essential that your agent may not share (for
  example, your availability is private), your agent doesn't guess and doesn't go silent:
  - The request goes to your **Inbox**, prefilled from your own info.
  - You can **share**, **share and remember** (a standing permission), or **decline**.
  - The organiser sees "asked @you personally" and then "answered by @you personally".
  - Strangers can never reach your inbox, and no AI runs until you answer.
- The organiser can **Continue without waiting**, or **Stop**. Either way, open requests are withdrawn.
- **Beta limit:** at most 20 people per plan or group, including the organiser.

## Reliability, limits and cost

- **Coordination survives restarts.** A running task is advanced only by the worker that holds its
  lease (`claim_task`), and the lease is renewed between steps. A background sweeper
  (`instrumentation.ts` → `lib/coordination/sweeper.ts`, every 30s) resumes tasks whose lease expired:
  - Replies that already arrived are reused.
  - Interrupted exchanges are retried.
  - The proposal and its message are created at most once.
  - After 3 attempts the task fails visibly.

  Cancelling a task makes the worker lose its lease, so it stops.
- **Rate limits** (`lib/limits.ts`) are Postgres-backed fixed windows that hold across restarts and instances:

  | Limit | Allowance | When exceeded |
  | --- | --- | --- |
  | A2A calls per calling agent → recipient | 30 per minute | HTTP 429 + `Retry-After` |
  | Anonymous A2A calls per IP | 10 per minute | HTTP 429 + `Retry-After` |
  | Messages to agents, per user | 20 per minute | Friendly message in the UI |
  | New coordination tasks, per user | 20 per hour | Friendly message in the UI |
  | Contact requests, per agent | 30 per hour | Friendly message in the UI |

  If the limiter itself is unavailable, requests are allowed (fail-open). Behind a proxy, anonymous
  limits rely on `X-Forwarded-For` being set by your host.
- **AI cost tracking.** Every model call is written to `llm_usage` with its tokens and cost
  (`lib/usage/pricing.ts`). Calls are attributed to the task they serve, including the replies other
  agents generate for it, through a signed task id. **History** shows cost per task and cost per
  completed plan. `npm run metrics` prints the beta numbers from the plan:
  - task outcomes
  - proposal acceptance
  - AI cost per completed task, broken down by model
  - why tasks failed

## Tests

```bash
npm test             # unit + security suites; DB suites run when Supabase is up
npm run test:e2e     # Playwright: onboarding <60s, dinner scenario + live RSVPs, contacts/DM, cancel, business FAQ
npm run test:interop # external A2A client → @trattoria

# Live suites (A2A security, rate limits, crash recovery) need a MOCK-mode server, so they
# never spend real AI credit. They skip unless LIVE_TEST_URL is set:
npm run build && LLM_PROVIDER=mock APP_URL=http://localhost:3100 npx next start -p 3100   # separate terminal
LIVE_TEST_URL=http://localhost:3100 npm test
E2E_BASE_URL=http://localhost:3100 npm run test:e2e
```

## Not in the MVP (deliberately)

Payments, bookings, calendar integrations, voice, public feeds, federation with external agent
providers, and per-user deployments.
