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

### Signup and optional setup

Signup starts with account type, name, a suggested available @address and a default picture. **Add details now · Optional** starts collapsed, with concise field labels and no storage-destination hints. Personal details start private, with the same visibility controls used in Settings. Existing saved permissions are preserved.

Direct business signup and **Add a business** share the form and optional-detail validation. A website is saved once, read in the background and reused in **My Business → Website & documents**. The owner can review now or later; website findings remain unpublished until **Go live**. Signup preserves invitation destinations. A dismissible setup invitation is stored privately per new identity in `onboarding_state`; existing accounts receive no new invitation.

### Online status

The account menu offers **Online (automatic)**, **Busy** (1 hour, 4 hours or until changed), **Away** and **Appear offline**. Automatic status becomes Away in a background tab or after five minutes without activity. Any active device keeps the identity online; the final connection leaving produces Offline after a brief grace period. Appear offline publishes no presence payload. Hidden status shows no badge, rather than Offline.

**Settings → Privacy → Online status** defaults personal visibility to accepted contacts. Business owners can opt into **Show team availability to customers**. Business badges explicitly say **Team online/busy/away/offline**, independent of agent responses and opening hours. Switching identities publishes only the identity in use. Availability does not change read receipts or mute notifications.

Badges appear in Contacts, search, direct chat headers and chat lists. Supabase Realtime Presence uses private, identity-scoped channels; only authorized, available work participants can publish for a business, and only the person can publish personal status. The existing Next.js API supplies permitted channel addresses, with server-side checks for contacts, blocks, restrictions and revoked sessions. Private preferences have owner-only RLS, and channel generations rotate after status/audience/contact changes. Clients recheck access every ten seconds and after presence leaves; only visible rows subscribe. No last-seen timestamp is retained or displayed. Apply migrations `20261116000800` and `20261116000900` before using this feature.

### What your agent knows about you

**Settings → 🧠 What your agent knows about you** (`/settings/about`) is a short list of topics. Each one opens to edit and has quick-pick chips.

**Lifestyle → ＋ Add** opens `/settings/about/lifestyle` with Food & drink, Hobbies & interests, Where you usually are, Budget for going out and Practical. Each starts collapsed and keeps its own values and visibility controls. The back link returns to the main knowledge page, where availability, time away, saved tips, private notes and custom topics remain. Moving these fields does not change the facts used by agents or the sharing preview.

| Topic | Default | Answers a contact's plan that asks for |
| --- | --- | --- |
| 🗓️ When you're free, with **✈️ Away until** (forgotten by itself after that day) | 🔒 private | `availability` |
| 🍽️ Food & drink | 🔒 private | `food` |
| 🎯 Hobbies & interests | 🔒 private | `interests` |
| 📍 Where you usually are | 🔒 private | `location` |
| 💸 Budget for going out | 🔒 private | `budget` |
| 🏠 Practical (kids, a dog, step-free access, no car…) | 🔒 private | `practical` |
| ✨ Your own topics (up to 5, you name them) | 🔒 private | `interests` |
| 🔒 Private notes | always private (also a DB check) | never |

- **Your own agent** (My Agent) knows all of it, private items included, to help *you*.
- **Another agent** only ever gets 👥 items in the topics its plan asked for (`selectDisclosableFacts`). Every reply field outside those topics is stripped in code.
- **Proposals** use shared hobbies, budget and needs only to choose an activity or place, and never mention them.
- **👁️ Preview** shows exactly what a friend's agent could get.
- **"Shall I remember…?"** When you tell your agent something about yourself in My Agent (*"I'm vegetarian now"*, *"I'm away until 20 Dec"*, *"I love climbing"*, *"I don't drink"*), it offers to save it. The detection is deterministic (`lib/profile/suggest.ts`), and nothing is saved until you tap **Save**.

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

The chat composer has an emoji picker and an attachment menu for camera photos/video, files, a one-time location snapshot and direct polls. Voice messages have 1x, 2x and 4x playback. Drafts stay local until Send; each item can be previewed and removed. Camera recordings use browser compression, and photos are resized and re-encoded as WebP with metadata removed. Polls in My Agent let the owner select accepted contacts and respect group-invitation approval settings.

Human and agent messages offer Reply and Forward, including attachments and app cards. Removed messages and messages marked “only visible to you” cannot be quoted or forwarded. Forwarding shows the content and recipients before sending; changed content must be reviewed again. Copies retain original authorship, time, AI attribution and source links. Files are independently copied into the destination's private storage and count against the forwarder's upload/storage limits. Polls, plans, approval cards and sign-up lists become labelled read-only snapshots, with no live task identifiers or action buttons. Private coordination exchanges are excluded from snapshots.

Your own human-authored messages have a trash icon immediately left of Forward and Delete in the options menu, across DMs, groups, communities, My Agent and business-agent chats. Confirmation replaces the content with "Message deleted on [local date/time]" for everyone who could see it, preserving the author and original sent timestamp. Private messages stay private. Deleted messages lose their receipts, action controls, media and shared location; existing quotes show "Deleted message", and selected composer quotes are cleared live. Downloads are revoked immediately and objects are queued for cleanup. Deleted text is excluded from future agent conversation context. Previously forwarded copies and existing plans, poll votes and business-team requests remain independent. Agent-authored output is excluded from owner deletion; existing moderator removal controls remain available. Database-authenticated deletion is idempotent and cannot be reversed by a later appeal or card update. Owner deletion does not count as a moderation penalty, and messages already removed by moderation retain that history. Apply migrations `20261115000900_delete_own_messages.sql` and `20261115001000_preserve_moderation_on_deletion.sql`.

Chat history loads at most 50 messages per request using a `(created_at, id)` cursor, with at most 150 message rows and their related data kept in the rendered window. Scrolling near an edge automatically loads the next chunk and preserves the reading anchor; keyboard-accessible load buttons remain available. Older history remains accessible beyond 2,000 messages. Opening a conversation starts at the first individually unread message (with a New messages divider), or the latest message when everything is read. Each chat and My Agent request stores only its anchor ID and pixel offset in user-scoped tab session storage, so browsing old history resumes after returning from profiles, files or other pages. Disabled session storage falls back to normal unread/latest opening.

New arrivals follow only when already near the latest message. While browsing older history, a floating down button above the composer shows incoming unread messages below the viewport and jumps directly to the latest chunk. Sending, Send as me and forwards into the active chat follow the newly sent message. Quote jumps can fetch a missing older chunk. Programmatic jumps relocate instantly and Seen tracking is gated until the actual scroll viewport is ready, so skipped messages remain unread. Images, videos and audio sources mount near the scroll viewport; resizing media preserves the reading anchor. History routes are authenticated, private/no-store, thread-scoped and read through the caller's RLS session, including all related cards, quotes and receipts. Apply migration `20261115001100_chat_history_windows.sql`. No additional server is needed.

Attachments use the private `chat-attachments` Supabase Storage bucket. Download routes recheck current chat/message visibility, support media range requests, and revoke access when a message is removed or membership is lost. File signatures and image decoding are checked on the server; executable, archive and active web formats are rejected, as are obvious active PDF features. PDF/TXT documents download rather than being embedded. This is format validation, not an antivirus service. Agent file analysis and transcription are not included.

Limits: 6 files and 32 MiB per message, 16 MiB per file, 100 MiB of uploads per UTC day and 250 MiB of stored attachments per user. Camera video is limited to 2 minutes and voice recordings to 5 minutes. Unsent uploads expire after 24 hours; the sweeper removes those and deleted-message objects. Supabase Storage must be enabled locally and in deployment; apply the attachment/poll migrations. Browser camera, microphone and geolocation require permissions and a secure context (HTTPS or localhost).

Chat participation cards show each person's display name and saved action date/time in the viewer's time zone. Poll votes, plan RSVPs and sign-up claims use the latest saved response; changed votes, RSVPs, claims, give-backs, plan edits and manual poll closures also leave dated system activity in the shared chat and the organiser's request. My Agent includes live poll and sign-up cards. Approvals are recorded privately; actions are never presented as messages sent by the person. Historical response times are shown only where they were saved.

Shared human and agent messages support eight human-selected reactions through a smiley icon (no duplicate menu item). Each person has one reaction per message: selecting it again removes it, and choosing another replaces it. One compact badge shows up to three most-used emojis and the total number of people who reacted. Tapping opens a mobile bottom sheet or desktop dialog with an All filter and per-emoji counts; names, avatars and full local reaction timestamps load in pages of 50, with filtering performed before pagination. Your own reaction is highlighted and can be removed inside the details. The selected filter stays open through live updates. Reaction summaries follow the bounded chat history and update via a metadata-only Supabase Realtime signal, without new chat messages, unread notifications or changes to receipts. Private-only, removed and deleted messages cannot receive reactions. Current membership, closed DMs and community mutes are enforced in the database; owner/moderator removal clears reactions. Apply migrations `20261115001200_message_reactions.sql` and `20261116000100_grouped_reaction_details.sql`.

All chat messages show their sent timestamp in the viewer's time zone. Outgoing public messages add a small status button after it: an up arrow for Sent, a tray arrow for Delivered, and an eye for Seen. Delivery requires the recipient's app to acknowledge the message payload; it is separate from saving the message. Seen requires 500 ms in a focused, visible chat, excluding content covered by navigation, the composer or a dialog. Audio/file Seen means displayed, not played/opened. Group status shows "Seen by N of M" with names and viewing/delivery times on tap. The recipient audience is captured when sending; later joiners do not change it.

Agent chats show "Agent received" only after agent acceptance. Automated replies never establish human viewing. "Seen by business owner" requires the owner actually viewing the matching, explicitly submitted staff question in My Agent; private instructions and rephrased questions are not treated as views of the original message. Settings > Privacy > Read receipts controls sharing of Seen, including business-owner viewing. Disabling it hides existing shared seen times, keeps delivery and private unread tracking, and enabling it does not retroactively publish previous views. Raw receipts are private; authenticated RPCs expose only the sender's own message summaries/details, and a metadata-only realtime signal updates their UI. Apply migration `20261115000800_message_receipts.sql`. Historical messages have no invented delivery/viewing times; tracking starts with newly sent messages. No additional server is required.

Customer-action buttons in existing plans and My Agent replies use the business's current published list. Saving an empty list removes all buttons; older FAQs and website information cannot restore methods the owner removed. A metadata-only `business_action_versions` signal refreshes open chats without exposing private business information. Legacy replies are linked only when a published action uniquely identifies the business; the resolved ID is saved in metadata so later destination changes keep working. Historical message text and button snapshots remain unchanged; ambiguous or unresolved snapshots never become stale clickable links.

## Finding people

The Contacts tab only ever holds people you accepted; an agent trusts its contacts, so nothing is added without consent.

- **Find people you know (Discover):** two options, **Contacts → Connect** and **Type or paste**, each ending in a **list you tick from**; nobody is added automatically. *Connect* picks the best source on the device without asking. In the native app it reads the phone's contacts (a `window.AgentmeNative.pickContacts()` bridge). In a phone browser with a contact picker (Chrome on Android) it reads the phone's contacts. Everywhere else it reads the contacts of the **email you registered with**: Gmail/Google Workspace or Outlook/Hotmail/Microsoft 365. Company domains are recognised from their mail servers (MX). It uses read-only OAuth with `login_hint`, a one-time read, and the token is not stored. Domains whose contacts apps can't read (iCloud, Yahoo, self-hosted) fall back to Type or paste. The list shows `Name (address)`. People on AGENTME (who haven't switched off *Let people who have my email or phone number find me* in Settings) can be ticked and sent a contact request. Everyone else gets an **Invite** button that opens your own email or SMS app; AGENTME sends nothing. The list is kept server-side only until Done, and for at most 30 minutes (`contact_imports`, pruned by the sweeper). Numbers without a country code are completed from the device's time zone or language. To be findable you need a verified identifier: your confirmed account email (registered at login, onboarding and seed), and optionally a phone number proven with a code (Settings). Identifiers are stored as keyed hashes plus a masked hint. Without Google/Microsoft keys, development simulates the provider with the demo accounts (see `.env.example`).
- **Personal link and live QR (Contacts):** `/u/<handle>` sends a contact request. The QR code on screen carries a signed token that is valid for 10 minutes, so scanning it in person connects you instantly and opens the chat. A photo of the code can't be reused later.
- **Introductions:** a friend of both picks two contacts (Contacts → Introduce, or "introduce @a to @b" in My Agent). Each person is asked by their agent in My Agent (also shown in Contacts), and they connect only if both say yes. If they are already connected or blocked, nothing is sent, and the introducer can't tell the difference.
- **Invite links for plans:** the organiser of a plan gets "🔗 Invite by link" in the plan's group and shares it themselves (WhatsApp, SMS, email), so AGENTME never stores the invitee's number. Opening it shows the plan, and you can join in seconds **as a guest** with just a name and address (an anonymous account, `enable_anonymous_sign_ins = true` in `supabase/config.toml`), or log in. Joining adds you to the plan, its open polls and sign-up lists, and its group, and connects you with the organiser. Links last 14 days and can be turned off. Guests can save their account with an email and password in Settings.

SMS: no provider is wired up yet. With `SMS_PROVIDER=dev` (the default outside production) the code is logged and shown on screen.

## My Business (business accounts)

A **My Business** tab, shown to business accounts, separates public presentation, customer actions and the information the agent uses. Its sections appear in this order:
1. **Customer dashboard:** 7/30/90-day question metrics, daily outcome charts, repeated questions, knowledge opportunities and recorded business-button clicks. Missed questions exclude pending replies, closed requests (declined, refused or cancelled) and redirects (including clarification requests); these appear as separate outcomes in the chart and summary. New redirects carry structured outcome metadata; existing records use exact known response templates. My Agent is the single action inbox; the dashboard links there for pending requests and contains no customer reply forms or action badges. It starts collapsed. Button clicks measure opens, not completed bookings or purchases; the collection start date is shown.
2. **About your business:** the full public description, shown on the business page and supplied to its agent. Saving it preserves practical details, customer-only information, FAQs and customer actions.
3. **Business information:** opening hours, address and customer actions. Owner-entered details take priority over reviewed website information.
4. **Website & documents:** the website connected during signup, review and connection status, last successful check, optional daily updates, and additional pages, PDF menus or photos. Website checks run approximately every 24 hours while the sweeper is running; failures retain the previous information and successful-check timestamp. Each additional document has public or customers-only visibility. A public document can also become a customer button without creating a duplicate source. Customer-only text is edited separately here.
5. **Questions & answers:** approved reusable FAQs, with the total in the summary and no notification badge.
6. **Share your business:** the public page, QR code and printable poster. **Groups and communities** appears afterward when the business has placements or invitations.

The website supplied at signup is stored with the business before connecting. If connecting fails, **Website & documents** keeps that address prefilled on later visits with **Retry connection**. Connecting a replacement updates the saved address; explicitly removing the connection clears it.

**Test your agent** is available in the page header as a preview dialog, with separate visitor and customer modes.

- **Website and document safety:**
  - **Safe fetching** (`lib/business/fetch.ts`): http(s) only, standard ports, the resolved address must be public (checked at connect time and for raw IPs), at most 3 redirects, 5 MB and 10 s. Development can allow local pages with `ALLOW_LOCAL_FETCH=1`, which the e2e tests use with `/demo/trattoria-menu.html`.
  - **Website text is untrusted data** (`<website_content>`), never instructions.
- **Answers:** the agent answers from its business information and website. For a relevant unanswered question, signed-in askers can click **Ask the team**; no staff request is created before that click. Matching open questions from the same asker are reused. The database enforces 10 requests per asker/business/day and 50 total per business/day. The answer returns privately to the original conversation. Public FAQ publication is unchecked by default, offered only for general business questions, and reviewed for private details before saving. Customer-specific answers cannot become FAQs.
- **Personal plans:** questions about an existing agreement or attendance use the asker's authorised saved plans, including venue, time and latest RSVPs. A venue's `@handle` does not contact the business. Similar matching plans prompt a clarification; the user can reply with a numbered choice. Venue recall states that AGENTME has made no reservation, then offers published booking/contact methods with clickable buttons. The business's own current details take priority over its reviewed, live website information; private, hidden and unpublished contacts are excluded. No plan details are sent out to find these options.
- **Never:** bookings, orders or payments. Instead, the agent sends people to the business's own ways (next item).
- **Customer actions** (`lib/business/booking.ts`):
  - **What the business adds:** Book, Order, Call, WhatsApp, Email, Website or Custom. There is no four-entry limit, and multiple entries of the same kind are supported. Custom buttons have a label, URL and purpose (booking, ordering, contact or information); the purpose determines when an agent offers them. Businesses can reorder and feature buttons.
  - **Known services:** OpenTable, Fresha, Treatwell, Calendly, Deliveroo, Uber Eats and others are recognised from the link, so the button reads e.g. *"📅 Book on OpenTable"*.
  - **Safe links:** only validated HTTP(S), telephone, WhatsApp and email links are produced, and stored actions are re-checked whenever they're read.
  - **Where they appear:**
    - as buttons on the business page (`/u/handle`), with no account needed; the first four appear initially, with the rest under **More options**;
    - in the agent's answers. Code makes sure a booking or ordering question gets these ways and never goes to the team.
  - **In plans:** a business @mentioned in a plan request (*"Organise pizza at @trattoria on Friday at 8pm with @marco"*) becomes the plan's **place**, not a participant. The plan card shows *📍 At Trattoria Sole* with its booking buttons. Mentioning only a business makes the agent reply with that business's ways to book.

There are two visibility levels, not an "internal" one: anything given to the AI could be coaxed out by a clever question, so information that must never be shared is simply not given to it.

### One person, several identities

From a personal account, **＋ Add a business** (in the switcher at the top, or `/business/new`) creates the business as a **separate identity**, with its own chats, contacts, inbox and badges. Nothing is mixed with the person's own.
- **Switcher:** the header badge belongs to the selected account. Expanding the menu shows each personal/business identity's own total, including the selected identity. Totals combine unread chats/topics and pending actions, counting a request once when it appears on multiple surfaces. Individually viewed, deleted and removed messages are excluded; muted chats keep their own counters but do not increase the total. Linked request notes are historical records, not additional alerts. Staff see customer work rather than Owner/Manager approvals. My Agent's **Needs you** includes pending inbox requests alongside plan approvals.
- **Live notification isolation:** `notification_accounts()` returns one authorized snapshot for the actual signed-in person's accessible identities. Its private helpers also serve `unread_counts()`, `action_counts()` and `owner_attention_count()`. A metadata-only `identity_notification_versions` row invalidates that person's counts when a personal or managed-business item changes, even while a different identity is selected. Clients reset on identity switches, abort old requests and reject responses for a different actor/workspace. Apply migrations `20261116002100_identity_notifications.sql` through `20261116002400_notification_invalidation.sql`.
- **How it works** (`lib/identities.ts`):
  - Each added business has its own internal login (`…@business.agentme.app`) that nobody types.
  - `business_managers` links the business to the people who manage it. Roles are `owner`, `manager` and `staff`, checked against the live membership.
  - Switching creates a fresh session for the same real person, with a service-created `business_work_sessions` binding. The Auth JWT always identifies that person; `workspace_user_id()` resolves the effective business tenant for RLS and existing chats. This avoids giving staff the business owner?s Auth credentials. No impersonation cookie is trusted. Every switch and database access checks current membership.
  - Logging in or out clears the cookie.
- **Limits:** up to 5 owned businesses per person (staff memberships do not consume this allowance), and 10 creation attempts a day.
- **Deleting:**
  - Deleting a business you switched into deletes only the business and switches you back to yourself.
  - Deleting your personal account also deletes the businesses you're the only owner of.
- **Business-only sign-ups** still work as before: that login is the business's own manager.

### Business staff

**My Business ? Staff & access** shows roles, work availability, pending invitations and a private dated audit. Search by name or @address, then select a verified personal account. Email invitations are not supported. Existing users receive a My Agent invitation; a recipient-bound private link also works after personal login. Invitations expire after seven days. Renewing replaces the old link. Acceptance adds access to the existing business in the account switcher.

- **Owner:** all business settings, elevated roles, ownership transfer and business deletion. At least one owner must remain.
- **Manager:** business settings, approved answers, customer requests and ordinary staff. Cannot appoint elevated roles, remove owners/managers or delete the business.
- **Staff:** customer replies, work availability and reusable-answer suggestions. Q&A approval is required by default. Owners/Managers can open a Staff member's **Reply & Q&A permissions** in **Staff & access** and change two independent switches: **Require assignment before replying** (default off) and **Require approval before publishing to Q&A** (default on). These do not add customer-reply approval. Staff cannot change these permissions, other business settings, launch company plans or gain platform moderation powers.
- **Assignment:** when required, self-claiming cannot substitute for an Owner/Manager assignment, including claims made before the setting changed. Only assigned requests appear in that Staff member's action inbox and attention count. With the switch off, Staff can take unassigned requests. Other people's active claims remain protected.
- **Q&A publication:** Staff always choose explicitly whether to add an answer. With approval required, the suggestion waits in My Agent for an Owner/Manager to edit and approve. With approval off, the customer-reply checkbox and standalone FAQ form can publish general answers after the same privacy/coherence check. Changing the setting does not publish existing pending suggestions. Roles, controls, source eligibility and reply leases are rechecked in service-only database commits; browser RPCs cannot bypass the publication review. Retries do not add duplicate FAQs for the same customer request.
- **Clear publication feedback:** reviews distinguish private/customer-specific information, an answer that does not address the question, uncertainty and a temporarily unavailable check. Failed reviews leave the text editable and record the reason code in the private team audit. Approved drafts retain the edited question and answer. Apply migrations `20261116002500_staff_reply_controls.sql` and `20261116002600_staff_controls_attention.sql`.
- **Requests:** claim a customer question before answering, or let an owner/manager assign it. A database lease and conditional completion prevent two people answering the same request. Replies still come from the business; internal authorship records the actual person. Removed staff?s unhandled claims return to the team.
- **Availability:** each person explicitly enables **Available for customer requests** while acting for that business. New staff start off duty. Personal presence remains separate. Customers see only aggregate Team availability when enabled in Privacy; colleagues see coarse work status on private team-only channels.
- **Receipts:** **Agent received** remains separate from **Seen by team**, which requires a human to actually display the question in an active, visible chat.
- **Revocation:** membership removal ends that person?s work sessions and invalidates presence channels, without deleting their personal account or unrelated sessions. Role changes take effect on subsequent permission checks. Outstanding invitations lose authority when their inviter is removed or demoted.

Apply migrations `20261116001000` through `20261116002000` locally or in deployment before using staff features. The workspace migration retires older impersonated business sessions; those users must sign in again. This uses the existing Next.js and Supabase services.


**Reporting lines and transfers**

- Each Staff member reports to one Owner or Manager. New Staff report to the inviting supervisor. Existing memberships use a valid accepted inviter where available, otherwise the default receiving Owner.
- In **My Business > Staff & access**, expand **Move Staff to another supervisor** below a Staff member. Managers can request moves for their own Staff; Owners can request any move. Search a receiving Owner/Manager by name or @address. One pending request per Staff member; requests expire after seven days and can be cancelled by their requester or an Owner.
- The receiver opens **My Agent > Work updates** while acting for that business and accepts or declines. Only that actual person can decide. Reporting lines, assignments and pending Q&A oversight change on acceptance, never on request. The requester, previous supervisor and Staff member receive private business-work updates on completion. These updates are not posted in shared customer conversations or personal inboxes.
- Removing or demoting a supervisor automatically moves their Staff to **Default receiving Owner**, configurable by Owners in Staff & access. Assigned questions stay with Staff. Stale transfer requests close automatically. Personal accounts and unrelated logins remain intact.
- Managers can manage permissions, assignments and pending Q&A suggestions only for their own Staff. Linked customer notes and inbox records follow the same database-enforced boundaries.

**Dashboard filters and historical attribution**

- Open **My Business > Customer dashboard**. Owners can choose the entire business, a supervisor's team or an individual Staff member; Managers can choose their own team or its current Staff. People can be searched by name or @address. Filters are enforced by database RPCs, including manually modified URLs.
- People & teams shows assignments, human replies, current pending requests, median handoff-to-reply time, approved Q&A contributions, daily activity and per-person totals. Shared business-agent analytics and customer-action clicks remain in the Owner's entire-business view.
- Completed work records the actual person and reporting team at the time. Transfers do not rewrite historical totals; pending work follows the current reporting line. Older work without reliable team attribution is labelled Unattributed, never assigned to today's roster.
- Apply migrations `20261116002700` through `20261116003400` before using reporting lines and team dashboards. No additional server is required.


### Appearance per identity

Settings > Personalise saves theme, accent, text size, dark style and background
for the actual person and selected identity. Personal and business views are
independent; Owners, Managers and Staff can each personalise their own business
view without changing a colleague's choices. Switching identities and signing in
on another device restores that combination's saved appearance. Existing
preferences remain the starting defaults until changed for an identity.

Apply migration `20261117000100_identity_appearance.sql` before deploying this
change. Preferences use the existing Supabase database, with session-bound RPCs
and row-level security; no additional server is required.

### Businesses in groups and communities

A business is never a member of a group or community. It is *placed* there (`business_placements`) and follows four rules:
- It only sees the messages that @mention it. The server sends it just that message over A2A, as the sender's agent.
- It answers from its **public** information only, even when the person asking is one of its customers, because everyone in the chat reads the answer.
- It never posts on its own.
- A relevant question it can't answer offers **Ask the team** to the original asker. The team's answer reaches the asker privately after they choose to send the request.

How it works in each place:
- **Groups:**
  - Admins add a business (Group info → *Businesses* → ＋ Add a business), and anyone in the group can remove it.
  - The business is told in its My Agent and can leave from *My Business*.
  - Businesses are skipped when adding people as members and can't join with an invite link.
- **Communities:**
  - Businesses can't join as members. Moderators invite a business as an **official partner**, and it shows on the community page once the business accepts in *My Business*.
  - A business can still run its own community.
- **Limits:**
  - Up to 5 businesses per group or community.
  - Each message reaches at most 2 businesses.
  - 20 questions to businesses by mention per person per hour.
  - A business can be added only if it accepts questions from anyone.

## Ask around

In My Agent, type *"ask around: does anyone know a good plumber in Camden?"* (also *"Does anyone know…"*, *"Can anyone recommend…"*, *"Any tips for…"*, *"Who can lend me…"*). Add @mentions to ask only those people.
- **Who is asked:** contacts who allow it (Settings → *Friends can ask me for recommendations*, on by default), up to 25, with a daily limit. Guests and non-contacts are never asked. You approve the card before anything is sent.
- **How each friend's agent answers:** with a matching **saved tip** explicitly set to **My contacts' agents** (Settings → *What your agent knows about you* → *Saved tips*, below Lifestyle). Each tip has the same visibility tiles as the other profile fields, with **Edit → Save tip** for existing entries. New tips default to **Only my agent** and remain available in the owner's private agent context. Private tips are excluded before A2A replies and checked again by the reply policy. Existing tips keep their previous contact-sharing permission; an inbox answer saved with the explicit “share next time” choice is also marked for contacts. Apply `20261116000600_saved_tip_visibility.sql`. Otherwise the friend is asked in *Needs your answer* and can **Share tip** (optionally saving it as a tip) or say **I don't know**. The asker is never told who passed, and private facts are never used.
- **What you get back:** tips arrive one by one in My Agent. The card shows "Asked N friends · M tips so far". When everyone has answered, or you tap **✨ Summarise now**, your agent writes one short summary of who recommends what.

## Navigation

The tab bar is **Chats · Contacts · Groups · Communities · Settings**.
- **Waiting for your decision:** these live in **My Agent**, under **Needs your answer**. There is no separate Inbox, and `/inbox` redirects to My Agent.
- **Find people** (formerly Discover) is inside Contacts.
- **Tab badges** count only what waits for *you*, and each request has one home:
  - **Chats:** unread messages. My Agent holds agents' requests and contacts' questions under *Needs your answer*.
  - **Contacts:** contact requests and introductions.
  - **Groups:** group invites; join requests and reported messages in groups you admin; and **Updates**.
  - **Communities:** the same for communities you moderate, plus Updates.
- **Updates** cover: you were removed or banned; a group or community was deleted; your join request was approved or declined; a moderator muted you; you were made admin or moderator. They clear from the badge once seen, and each group or community row shows "N to review" for admins and moderators.
- **Activity** (formerly History) is inside Settings.

### My Agent: one thread per request

My Agent has a desktop topic sidebar and a mobile **Topics** drawer. Its centre shows requests needing attention and a compact overview of ongoing work; selecting a topic opens its conversation in the centre.
- **Topic views:**
  - **Needs you:** plan waiting for approval, or plan ready.
  - **In progress:** working, or waiting for answers.
  - **Recent:** done, shared, cancelled, or no plan.
  - **History:** inactive for 7+ days, searchable alongside newer topics.
- Each view fetches **10 topics at a time**, newest activity first, with a stable activity-time/ID cursor. Scrolling near the bottom fetches the next ten; **Load more** and retry controls remain available. Titles, latest plan status, previews, timestamps and unread badges stay current. Topic selection, loaded page counts and scroll anchors are preserved when returning; device storage contains navigation metadata rather than message previews.
- **Search topics** searches topic titles across all statuses and history, without fetching the entire archive. Topic lists and previews never mark messages read; visibility-based message tracking does that inside the conversation. Apply `20261116000500_agent_topic_pages.sql`.
- **Needs your answer** stays at the top.
- **＋ New request**, or typing in the box below the list, starts a new thread and opens it. A thread shows only that request's messages, and follow-ups typed in it stay there. The agent's chat memory is that thread only.
- **Titles** come from the plan (*"Dinner with @marco, @paul · Saturday evening"*, no AI call). Until a plan exists, the title is the first words you typed. You can rename a thread.
- **Filed by the database** (`agent_threads`, trigger `file_agent_message`), so no message is left out:
  - **A plan's messages** (`metadata.task_id`) go to that plan's thread. A plan started elsewhere (e.g. `@agent` in a group) gets its own thread.
  - **Messages sent in a thread** stay there.
  - **Everything else** goes to **📬 From your agent**: notes and others' requests, including notes about someone else's plan.
- **Badges:** My Agent's badge in Chats counts **requests with something new**, not messages. A thread's unread badge clears as its messages are visibly viewed.
- **Existing history:** each past plan became a thread, together with the request that started it; anything else went to *Earlier messages*.

## Groups and communities

- **Groups** (tab *Groups*, up to 256 people) are private chats with your contacts.
  - **Roles:** owner (the creator; when they leave, an admin takes over), admins and members.
  - **Admins can:** add or remove people, promote or demote admins, edit info (or let everyone edit it), switch on *only admins can send*, share an invite link that can require approval, handle join requests, and remove reported messages.
  - **Everyone can:** mute, leave, report (optionally leaving and blocking), and **block** a group so nobody can add them back.
  - **Only the owner can:** delete the group for everyone.
  - **Settings → Privacy → Group invitations:** *Ask me first* is the default; direct adds by contacts require an explicit opt-in. This applies equally to manual groups, agent-created plans and My Agent polls. The migration moves personal accounts to Ask me first; existing memberships keep their history. Invitations appear in My Agent, with the inviter, purpose, member count, history policy and expiry. They last 7 days, are deduplicated, can be declined quietly or blocked, and admins can withdraw them. Joining a group does not RSVP to its event.
  - **History:** new members see messages from joining plus current shared activity cards. Admins may explicitly enable earlier messages for future joins; the invitation/link preview discloses this and the group receives a dated settings update. Reads, downloads, quotes, forwarding, receipt acknowledgements, reactions and personal-agent context respect the same boundary. Existing memberships retain their previous access. Apply migrations `20261115001300_group_consent_history.sql`, `20261115001400_invitation_attention.sql` and `20261115001500_resolve_joined_invitations.sql`. Joining by a link or an approved request also clears an earlier pending invitation.
- **Communities** (tab *Communities*, up to 5,000 people) are bigger interest spaces.
  - **Chats:** each has **Announcements**, where only the owner and moderators post, and **General**, where everyone talks.
  - **Visibility:** **public** communities are listed and searchable, and you join by accepting the rules. **Private** ones are joined with an invite link, or by a request a moderator approves. Owners can require moderator approval even for private-community links; members still explicitly accept the rules. Businesses remain mention-only services rather than members, and personal agents cannot enter chats independently of their owners.
  - **Moderators can:** remove, **ban** or mute members for 24h; work the join-request and reported-messages queues; and remove messages.
  - **Only the owner can:** promote moderators, hand over ownership, and delete the community.
  - **Agents:** in community chats @agent only helps privately (summarise, translate, draft). It never organises plans with, or shares anything to, people who aren't your contacts.
  - **Creating one** (`lib/social/rules.ts`):
    - **Required:** a name, and *what it's about* (at least 20 characters). The description is shown before joining and is what "Stay on topic" is judged against.
    - **Optional:** a main language, pre-filled from the creator's browser. It's shown as a tag (*🇮🇹 Italian*) and never enforced.
  - **Rules:**
    - **3 core rules**, always there and impossible to edit or remove: *Be respectful · No spam or selling · Stay on topic*.
    - **Up to 5 house rules picked from a list,** never free text, so one tick is one rule. The list: *No spoilers*, *<Language> only*, *No links*, *No images or videos*, *No politics*, *Keep it family-friendly*, *No self-promotion*, *No religion debates*, *No reposts or chain messages*, *Events and meetups only*.
    - **How house rules are checked:**
      - *No links* and *No images or videos* are checked in code, before posting (moderators are exempt).
      - The others go through the AI check, and **only ever nudge**, never refuse.
      - The core rules always take precedence.
    - **Joining:** members see and accept all the rules before joining.
  - **Spam protection** (`lib/social/guard.ts`). Free checks run in code before a message is posted in a community chat, with no moderator needed.
    - **Trust levels** come from the member's own history there:
      - **new:** under a day, fewer than 3 messages, or a message removed in the last 30 days;
      - **member:** everyone else;
      - **trusted:** 7+ days and 20+ messages;
      - **moderators** are exempt.
    - **Slow mode,** in messages per minute: 3 for new, 8 for members, 15 for trusted.
    - **Links:** none for new members, 3 per message for members, 5 for trusted.
    - **Also refused:** more than 5 @mentions, and the same message again within 10 minutes. The sender is told why.
    - **Possible selling or promotion** (prices, "for sale", "DM me", crypto…) is **posted, but flagged** (`metadata.flags`). Moderators see a 🏷️ label, ready for the AI check in step 2.
    - Each community page says spam protection is on.
  - **Autopilot** (`lib/social/moderation*.ts`): moderation that works even if moderators do nothing.
    - **The check:** after the free checks, a small, fast model checks the message against the community's own name, description and rules. The message is treated as untrusted data, never as instructions.
    - **Who gets checked:** new members and members. Trusted members and moderators skip it, to save cost.
    - **What happens is decided by code, not by the model:**
      - near-certain spam (90% sure or more) or clear abuse (85% or more) is **not posted**, and the author is told why;
      - possibly disrespectful, selling or off-topic (60% or more) gets a **private nudge**, *"This might break 'Be respectful'. Edit, or post anyway?"*. The author decides. If they post anyway, the message is posted, and moderators see a label explaining the nudge;
      - everything else is posted.
    - **If the check is unavailable,** messages are posted.
    - **Members' reports with AI agreement:** when 3 different members report a community message *and* the check agrees (70% sure or more), it's hidden automatically. One person can't silence anyone.
    - **Log:** every automatic action is recorded in `moderation_events`, which only that community's moderators can read.
  - **Appeals** (`lib/social/appeals.ts`):
    - **Who and when:** the author can appeal once. From the message box for a message that wasn't posted, or under their own message for one hidden after reports.
    - **Moderators** can **Accept** (the message is posted, or restored) or **Reject**.
    - **If nobody answers within 3 days,** the appeal is resolved automatically. It's accepted for members with a good history there (in the community 7+ days, 5+ messages, nothing else refused or hidden in a month), and rejected otherwise.
    - The author is told the outcome.
  - **🤖 Autopilot section** on the community page, for moderators:
    - the last 7 days in numbers;
    - waiting appeals, with Accept or Reject;
    - what the agent did recently, with one-tap **Undo**.
  - **Daily digest** (`lib/social/digest.ts`): moderators get **one notice a day**, not an alert per message. For example: *"🤖 FC Fans: your community's agent kept 4 messages out, hid 1 after members' reports and nudged 3 members… 1 appeal needs you (optional)."*
  - **Quiet moderators:**
    - Opening a community or its chats counts as being around.
    - After **2 weeks** with no owner or moderator around, the owner is reminded. After **a month**, the reminder suggests active members with a clean record.
    - The community page also lists those members, with **Make moderator**, whenever there are fewer than 3 moderators.
    - Reminders go out at most every 2 weeks.
  - **Housekeeping** (3-day appeals, digests, reminders) runs in the sweeper every 15 minutes.
- **🔔 Updates** (Groups and Communities tabs, `lib/social/notices.ts`). The section opens by itself when something is new, and its counter badge is green for new updates and grey for the total.
  - **Pinned:** 📌 updates that need you (an appeal to review, members to promote) stay at the top with **Review ›** until handled.
  - **Grouped:** several updates about the same group or community on the same day become one line (*"3 updates about 'FC Fans'"*), which you can expand.
  - **Short list:** the section shows the latest 5. **See all updates (N) ›** opens `/updates/groups` or `/updates/communities`, grouped by *Today · Yesterday · This week · Older*, with a filter by group or community.
  - **Clearing:** ✕ on each update, and **Clear all**. Updates expire after 30 days anyway.
  - **Mute:** updates about a group (or a community's General chat) you muted still show, but don't add to the tab badge.
    - **Tests** use a predictable mock model, never the real one.
- **Enforced in code:** posting rules (`canPost`) and every permission check (`lib/social/*`). The browser only reads through RLS. Membership, requests, reports and links are server-written, and reports are visible only to the admins or moderators who handle them.

## People mentions and private agent requests

Typing `@` in the message composer offers current chat members, your own agent, and eligible business agents. Accepted contacts have separate **Mention [name]** and **Ask [name]'s agent** actions. In My Agent, contacts can be used in a request without notifying them. A human mention never invokes their agent; both **Ask @marco whether…** and **Ask @marco's agent whether…** prepare the same approval card. In a shared chat, **@agent ask @marco…** prepares that card privately. Only the explicit question is sent after approval, through the existing question workflow; the recipient's agent can ask its owner to answer. Ordinary planning requests keep their existing behaviour. The handle `agent` is reserved for private assistance.

Newly posted shared human messages capture eligible mention recipients as stable account IDs. Recipients must already belong to the conversation and be able to read that message. Private instructions, My Agent messages, AI output, quoted lines, code, emails and forwarded mentions do not generate alerts. Mentions never add anyone to a chat or grant access to its history. Changing a handle does not retarget old mentions.

Unread mentions appear beside each chat and in a persistent **@ Mentions** button beside Chats. The button opens unread mentions grouped by chat, with sender, preview, timestamp and exact-message links; older entries load in pages of 50. Opening the list never marks messages read. Mentions stay semibold and use your accent colour after reading, with contrasting styling inside your outgoing bubbles.

While the app is open elsewhere, a small **ten-second** banner offers **View** and **Dismiss**. Arrivals from separate updates accumulate in one banner, grouped across chats and deduplicated by message ID. New arrivals restart its timer; hovering, keyboard focus and hidden tabs pause it. View opens a single source message or the grouped list for several mentions. Dismissal and timeout leave unread counts intact. Mobile banners sit below the header and desktop banners appear at the top right. Active-chat mentions are highlighted instead. Muted chats and **Settings → Privacy → Mentions** control banners; unread lists and badges remain available. Alerts are claimed once across sessions and clear only through the existing visibility-based message tracking, even when read-receipt sharing is disabled. This uses Supabase Realtime and does not send agent messages or background push notifications. Apply migrations `20261116000200_people_mentions.sql`, `20261116000300_mention_fast_path.sql` and `20261116000400_mention_inbox.sql`.

## Platform reports and moderation

**Who configures this?** AGENTME operators appoint reviewers inside the app at **Settings → Platform staff** (`/moderation/staff`). They enter a registered account's email and choose **Grant access**, or choose **Remove access** next to a reviewer. Ordinary users and reviewers cannot manage staff. Group admins and community moderators already have their own individual-message review tools; that is a separate role. With no reviewer assigned, whole-space reports are saved and remain pending until a reviewer handles them.

- **Report group / Report community** is available to every member and always goes privately to AGENTME. The group name, description and available community rules are captured with the case. Members may select up to five supporting shared text messages, or explicitly explain why there is no specific message. Leaving/blocking is optional; report receipts remain available after leaving.
- **Individual messages:** use **⋯ → Report**. Group/community members choose **local admins/moderators** or **AGENTME**, without needing local approval first. DM and business-agent-chat messages go directly to AGENTME. Private My Agent conversations and messages labelled only visible to you cannot be reported or included as context.
- **Evidence preview:** choose a concern, including **Hate or discrimination**, and explain it. The reported message is included; up to two visible messages before/after are offered as optional context. Nothing else is selected automatically. Whole-space evidence supports loading older messages. **Review report → Send report** previews the selected text, author and full date/time. Private agent exchanges, attachment contents, location metadata and the rest of the chat are excluded. Changed message text requires a new preview. Evidence is captured from the database and retained independently of later message deletion.
- **Local reports** appear in **Group → Admin settings → Reported messages** or **Community → Moderation**, with quoted evidence and timestamps. My Agent links the responsible local moderators directly to review. Existing community spam checks and appeals continue separately. Choosing AGENTME creates no local report and does not disclose the report or reporter identity to local admins.
- **Platform reviewers:** **Settings → Platform moderation**, or `/moderation`. Reviewers see submitted evidence, never unrestricted chat history. They can request more evidence, close without action or issue a warning. Message cases support removing the reported message; whole-space cases support suspension/restoration. Suspension makes posting, joining, reactions and shared activities read-only without deleting history. Every decision records the human reviewer and time; internal notes stay private to reviewers. Agents never decide platform enforcement.
- **Additional evidence:** **Request more evidence** sends a private question to the reporter's My Agent. The case moves to **Waiting for evidence**. The reporter opens their report receipt, writes an explanation and optionally selects more messages, then uses **Review reply → Send evidence reply**. A text-only reply remains possible after leaving the space. On response, the case returns to **Needs review**. Requests and submitted replies are retained with the case; closing a case also closes unanswered requests. No investigation or general chat-browsing access is granted.
- **Updates:** reporters track their own cases in **Settings → Your reports**, or `/reports`, and receive private updates in My Agent. Owners/admins receive a public decision summary only for warnings, suspension or restoration, without the reporter's identity or original report. Duplicate pending submissions are reused; new reports are limited to five per person per day.
- **Access is unassigned by default.** Being a business owner, group admin or community moderator does not grant platform access. Current members, reporters and administrators captured when a case was created cannot review that space's cases, including after leaving. Pending reports wait for a human reviewer; submission never automatically suspends a space.

- **Account enforcement:** independent platform reviewers can suspend an account for **1 calendar month**, **3 calendar months**, or apply a **permanent ban**. Each final decision needs a justification, a human confirmation and an audit record. The affected user receives the justification privately. Whole-group/community cases must identify an author and supporting submitted evidence; group ownership alone is insufficient. Operators are protected and reviewer accounts require independent operator review.
- **Reporting history:** expand the reported account's history on the case screen. Prior reports show the report date, decision date, action, justification, expiry and whether a restriction remains active. Pending and dismissed reports are distinguished from enforcement decisions. History excludes the current case and redacts prior cases in which the reviewer was involved; it does not grant access to other chats.
- **Restricted accounts:** `/account-status` remains available after signing in, with the decision, exact end time and an appeal form. Other app activity is blocked, including agent messages and unfinished coordination work. Old sessions and direct Supabase writes are guarded. Managed business sessions are bound to the actual manager: a suspended manager cannot evade restrictions by switching identities or clearing a cookie, while a healthy co-owner remains operational. Temporary restrictions expire automatically against database time, without a scheduled job; overlapping restrictions remain independent. A permanent ban does not delete the account or its history.
- **Appeals:** a different, uninvolved reviewer handles **Platform moderation → Account appeals**, with counts and links in My Agent. The original reviewer cannot decide their own appeal. Reviewers can also correct a mistaken decision using **Lift account restriction**, with a required justification and audit record. Lifting one decision leaves any other active restrictions in place. Operators can appoint an additional reviewer through **Settings → Platform staff** when an independent appeal reviewer is needed.

Apply migrations `20261115001600` through `20261115003100` after the earlier chat/group migrations. Older local reports retain their existing excerpts and receive source timestamps when still available. This uses the existing Supabase database and Realtime, with no additional server. Reporting privacy is explained under **Settings → Privacy** and in each report preview.

To set up a reviewer:

1. Create a separate personal AGENTME account through `/signup` and complete onboarding. For local testing, an address such as `moderation@agentme.test` is suitable. For a deployed app, use a real staff email address and complete email verification. Choose its password privately.
2. Sign in as an AGENTME operator. Open **Settings → Platform staff**, enter the reviewer's email and click **Grant access**. The account must be verified and personal. New accounts can be assigned before finishing onboarding. Existing enabled accounts are left unchanged.
3. Sign in to that reviewer account and open **Settings → Platform moderation**, or `/moderation`. Pending cases also appear in My Agent. Reporting users track their own submissions under **Settings → Your reports**.

Removing access takes effect on subsequent permission checks and leaves reports intact. Reviewers receive private My Agent updates when access changes. The staff page records the operator, account and date/time of each change; customers and reviewers cannot read or alter that audit. Operator accounts are protected from reviewer removal through this interface.

**Deployment bootstrap (operator only):** the initial AGENTME operator must be assigned through trusted deployment administration. This is separate from appointing reviewers in the app, and cannot be claimed through public signup. Migrations deliberately assign no operators. For this local setup, `luca@agentme.test` is the operator; no email is hardcoded into the application or migrations. To bootstrap another environment, use the following statement with the existing verified operator's email:

```sql
insert into public.platform_operators(user_id)
select id from auth.users
where lower(email) = lower('operator@example.com') and email_confirmed_at is not null
on conflict(user_id) do update set enabled = true
returning user_id;
```

`returning user_id` must return one row. Role assignments apply only to that database; local setup does not grant production access. An operator does not automatically gain reviewer access. Use independent reviewers who do not belong to the spaces they review, and never expose a service-role key.

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
npm run test:e2e:case7 # isolated mock server on :3001, temporary accounts, no demo reseed
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

### Custom profile avatars

Signup (personal or business), Add a business and Settings > Profile & account share the same avatar editor. Presets remain available. Choose Upload photo or logo, drag to reposition, zoom, rotate, reset or fit the whole logo; the circular preview matches the published crop. Position sliders also support keyboard input. Use image prepares a local preview; Cancel preserves the previous selection. Nothing uploads or changes publicly until the signup/profile form is saved.

Images accept JPG, PNG or WebP sources up to 10 MB. The browser prepares a 512px crop, then the server verifies and re-encodes it as WebP, removes EXIF/GPS metadata and rejects animated/active formats and oversized inputs. The original is not retained. Stored avatars use a private Supabase bucket and a current-image-only public profile endpoint. Old URLs stop working after replacement, switching to a preset or account deletion. Durable cleanup and the existing maintenance sweep remove obsolete files.

Personal and business images stay separate. Business changes require a live Owner/Manager role; Staff cannot change the business profile. AI badges remain distinct from human authorship. Emoji and image avatars use the same renderer throughout chat, contact, search, mention, staff and account-switching views. Apply migrations `20261116003500_custom_avatars.sql` and `20261116003600_avatar_preset_cleanup.sql` before using uploads.
