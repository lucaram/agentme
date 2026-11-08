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

## Plans, blocks and "ask my human" (V2)

- **Plans are made of steps (blocks)** run by the plan engine (`lib/plans/engine.ts`). Each block has its own handler in
  `lib/plans/blocks/`. Milestone 1 implements `collect` (availability + preferences) and `proposal`. More blocks
  (RSVP v2, poll, question, recall, assign, threshold, change, announce) arrive in the next milestones.
- **A step can wait on people.** The task then releases its worker (status `waiting`), and it's woken and resumed
  when someone answers. Resuming reuses everything that already happened.
- **Ask my human.** When a *contact's* agent asks for something essential that your agent may not share (for
  example, your availability is private), your agent doesn't guess and doesn't go silent:
  - Your agent asks you in **My Agent**: the request waits, prefilled from your own info, under **Needs your answer**, a strip pinned at the top. A note also arrives in the chat, so the Chats badge shows it.
  - You can **share**, **share and remember** (a standing permission), or **decline**.
  - The organiser sees "asked @you personally" and then "answered by @you personally".
  - Strangers can never reach you this way, and no AI runs until you answer.
- The organiser can **Continue without waiting**, or **Stop**. Either way, open requests are withdrawn.
- **Beta limit:** at most 20 people per plan or group, including the organiser.

Milestone 2 blocks, all started from **My Agent** and approved before anything is sent:

| Block | Try | How it works |
| --- | --- | --- |
| **RSVP v2** | (after sharing a plan) | Three states (waiting, in, can't make it), changeable any time. Each change is a neutral event line in the group. |
| **Poll** | `Ask @marco and @paul to vote: Italian, Thai or Indian` | Options are fixed once the organiser approves. Everyone votes themselves. A voter's own agent may *suggest* an option, from that voter's own preferences only, and the human decides. Votes are counted by code. The poll closes when everyone has voted, or when the organiser closes it. |
| **Question** | `Ask @marco if he can help me move on Sunday` | Only contacts can ask. The question waits for the person under Needs your answer in My Agent, and their agent never answers on their behalf. The answer is relayed as "answered personally". |
| **Recall** | `What time did we agree for dinner?` | My Agent answers only from plans you can already see: times agreed, who's in, who hasn't replied, poll results, and answers. |

Milestone 3 blocks. Each plan gets its own group, named after it:

| Block | Try | How it works |
| --- | --- | --- |
| **Invitation + Threshold** | `Organise five-a-side on Thursday at 7pm with @marco and @paul, need 4` or `..., max 2` | A fixed day and time means there's nothing to coordinate, so people are simply invited and asked who's in.<br>**Minimum:** the group is told "It's on! ✅" when it's reached, and warned if it drops back below.<br>**Maximum:** extra "yes" answers join a waitlist in the order they came, and move up automatically when a place opens.<br>Code does all the counting. |
| **Assign** | `Ask @marco and @paul who brings what for Saturday: drinks, dessert, bread` | A sign-up list where everyone claims their own items; nobody is assigned anything they didn't pick. The database guarantees an item can't be claimed twice. "Everything is covered ✅" appears when the list is complete. |
| **Change** | **Change plan** on a shared plan (organiser only) | Edit the name, day or time. A day or time change asks everyone else to confirm again. Every change is kept in the history, and the organiser gets a heads-up if the new time clashes with what agents said. |
| **Announce** | `Tell @marco and @paul: the trip is tomorrow, bring lunch` | You approve the exact words, and they're sent as **your own message** (not AI) in a new group. No reply is needed. |

### `@agent` in any chat

Type `@agent …` in a group or DM to summon **your own** agent (`lib/agents/in-chat.ts`):

| Command | What happens |
| --- | --- |
| `@agent summarise` / `catch me up` / `what did we decide?` | A short summary of the chat. |
| `@agent translate` / `translate to Italian: …` | Translates the last message from someone else, or your text. |
| `@agent draft say I'm in but late` | A reply you can edit, sent only when you tap **Send as me** (as your own message). |
| `@agent organise dinner on Saturday`, `@agent poll: pizza or sushi?`, `@agent who brings what: drinks, cake` | A plan with **this chat's members**. The approval card is shown only to you, and the result is posted **into this chat**. |

**Rules**
- Your command and the agent's answers are **only visible to you** (`messages.visible_to`, enforced by RLS and Realtime).
- The agent reads only what everyone in the chat can already see. That excludes private messages and anyone's private data, and other people's messages are treated as data, never as instructions.
- Anything sent to others still needs your tap.
- Other people's agents never answer unless *they* summon them.
### The AI composer (Milestone 4)

Any request that mentions contacts becomes a **plan made of the blocks above** (`lib/plans/compose.ts`).

**How a plan is built**
- The model only *proposes* a composition.
- **Code validates it:**
  - People come only from your @mentions.
  - The order has to make sense: a proposal needs availability collected first, and an invitation needs a fixed day and time.
  - Each block can appear once, with at most 5 blocks and 20 people.
- You get a **step-by-step preview**, which you can edit with **Edit plan** before you approve.

**Examples**
- **Dinner:** find a time → proposal → who's in.
- **Five-a-side** ("…at 7pm, need 10, someone bring a ball"): invitation with a minimum, plus a sign-up list, in one group.
- **Meeting with an agenda:** find a time → ask for agenda items → proposal → who's in.
- **Gift:** poll → sign-up list.
- **Carpool:** sign-up list, one item per day.

My Agent shows **template chips** filled in with your own contacts. It also answers **general questions**, but coordination comes first.

## Finding people

The Contacts tab only ever holds people you accepted; an agent trusts its contacts, so nothing is added without consent.

- **Find people you know (Discover):** two options, **Contacts → Connect** and **Type or paste**, each ending in a **list you tick from**; nobody is added automatically. *Connect* picks the best source on the device without asking. In the native app it reads the phone's contacts (a `window.AgentmeNative.pickContacts()` bridge). In a phone browser with a contact picker (Chrome on Android) it reads the phone's contacts. Everywhere else it reads the contacts of the **email you registered with**: Gmail/Google Workspace or Outlook/Hotmail/Microsoft 365. Company domains are recognised from their mail servers (MX). It uses read-only OAuth with `login_hint`, a one-time read, and the token is not stored. Domains whose contacts apps can't read (iCloud, Yahoo, self-hosted) fall back to Type or paste. The list shows `Name (address)`. People on AGENTME (who haven't switched off *Let people who have my email or phone number find me* in Settings) can be ticked and sent a contact request. Everyone else gets an **Invite** button that opens your own email or SMS app; AGENTME sends nothing. The list is kept server-side only until Done, and for at most 30 minutes (`contact_imports`, pruned by the sweeper). Numbers without a country code are completed from the device's time zone or language. To be findable you need a verified identifier: your confirmed account email (registered at login, onboarding and seed), and optionally a phone number proven with a code (Settings). Identifiers are stored as keyed hashes plus a masked hint. Without Google/Microsoft keys, development simulates the provider with the demo accounts (see `.env.example`).
- **Personal link and live QR (Contacts):** `/u/<handle>` sends a contact request. The QR code on screen carries a signed token that is valid for 10 minutes, so scanning it in person connects you instantly and opens the chat. A photo of the code can't be reused later.
- **Introductions:** a friend of both picks two contacts (Contacts → Introduce, or "introduce @a to @b" in My Agent). Each person is asked by their agent in My Agent (also shown in Contacts), and they connect only if both say yes. If they are already connected or blocked, nothing is sent, and the introducer can't tell the difference.
- **Invite links for plans:** the organiser of a plan gets "🔗 Invite by link" in the plan's group and shares it themselves (WhatsApp, SMS, email), so AGENTME never stores the invitee's number. Opening it shows the plan, and you can join in seconds **as a guest** with just a name and address (an anonymous account, `enable_anonymous_sign_ins = true` in `supabase/config.toml`), or log in. Joining adds you to the plan, its open polls and sign-up lists, and its group, and connects you with the organiser. Links last 14 days and can be turned off. Guests can save their account with an email and password in Settings.

SMS: no provider is wired up yet. With `SMS_PROVIDER=dev` (the default outside production) the code is logged and shown on screen.

## Navigation

The tab bar is **Chats · Contacts · Groups · Communities · Settings**.
- **Waiting for your decision:** these live in **My Agent**, under **Needs your answer**. There is no separate Inbox, and `/inbox` redirects to My Agent.
- **Find people** (formerly Discover) is inside Contacts.
- **Activity** (formerly History) is inside Settings.

## Groups and communities

- **Groups** (tab *Groups*, up to 256 people) are private chats with your contacts.
  - **Roles:** owner (the creator; when they leave, an admin takes over), admins and members.
  - **Admins can:** add or remove people, promote or demote admins, edit info (or let everyone edit it), switch on *only admins can send*, share an invite link that can require approval, handle join requests, and remove reported messages.
  - **Everyone can:** mute, leave, report (optionally leaving and blocking), and **block** a group so nobody can add them back.
  - **Only the owner can:** delete the group for everyone.
  - **Settings → "Who can add you to groups":** *my contacts* or *nobody, send me an invite*. The invite is shown in My Agent and in Groups.
- **Communities** (tab *Communities*, up to 5,000 people) are bigger interest spaces.
  - **Chats:** each has **Announcements**, where only the owner and moderators post, and **General**, where everyone talks.
  - **Visibility:** **public** communities are listed and searchable, and you join by accepting the rules. **Private** ones are joined with an invite link, or by a request a moderator approves.
  - **Moderators can:** remove, **ban** or mute members for 24h; work the join-request and reported-messages queues; and remove messages.
  - **Only the owner can:** promote moderators, hand over ownership, and delete the community.
  - **Agents:** in community chats @agent only helps privately (summarise, translate, draft). It never organises plans with, or shares anything to, people who aren't your contacts.
- **Enforced in code:** posting rules (`canPost`) and every permission check (`lib/social/*`). The browser only reads through RLS. Membership, requests, reports and links are server-written, and reports are visible only to the admins or moderators who handle them.

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
