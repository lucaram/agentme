"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getAgentByHandle, getAgentById, getContactRow } from "@/lib/data/agents";
import { createConversation, findConversation, getConversation, getOrCreateMyAgentConversation, isMember, postMessage } from "@/lib/data/chat";
import { asJson } from "@/lib/data/json";
import {
  approveTask,
  askAgent,
  cancelTask,
  decideProposal,
  handleOwnerMessage,
  runTask,
  updateDraft,
} from "@/lib/coordination/orchestrator";
import type { PlanDraft } from "@/lib/plans/compose";
import { describeRetry, hit } from "@/lib/limits";
import { continueWithoutWaiting } from "@/lib/plans/engine";
import { answerInboxItem, declineInboxItem } from "@/lib/plans/inbox";
import { claimItem, closePollStep, respondRsvp, unclaimItem, votePoll } from "@/lib/plans/participation";
import { changePlan, type ChangeInputT } from "@/lib/plans/change";
import { withUsageContext } from "@/lib/usage/context";
import { summonsAgent } from "@/lib/agents/commands";
import { townAt } from "@/lib/geo";
import { handleAgentCommand } from "@/lib/agents/in-chat";
import { sendContactRequest } from "@/lib/people/requests";
import { tellOwner } from "@/lib/requests/notify";
import { canPost, type ConvRow } from "@/lib/social/shared";
import { handOverIfOwnerLeft } from "@/lib/social/groups";
import { answerMentions } from "@/lib/social/businesses";
import { MIN_NAME, maxNameFor } from "@/lib/social/limits";
import { avatarsFor } from "@/lib/avatars";
import { DM_CLOSED, dmState } from "@/lib/people/dm";
import { guardCommunityPost } from "@/lib/social/guard-server";
import { autopilot } from "@/lib/social/moderation-server";
import { renameThread, resolveThread } from "@/lib/agents/threads";
import { withThread } from "@/lib/agents/thread-context";
import { answerSuggestion, offerProfileSave } from "@/lib/profile/offer";
import { answerBusinessSuggestion } from "@/lib/agents/ask-business";
import { resolveReply } from "@/lib/social/quote-server";
import { quoteContext } from "@/lib/social/quote";
import { businessesOnlyOwnedBy, forgetPerson, realPerson, signInAs } from "@/lib/identities";

const Id = z.uuid();

// ------------------------------------------------------------- messages

/**
 * Sends a message. In My Agent, `threadId` is the request thread it was typed
 * in (none or "new" starts a new one); the thread used is returned.
 */
export async function sendMessage(
  conversationId: string,
  text: string,
  threadId?: string | null,
  /** Community: the author chose "Post anyway" after a nudge. replyTo: ↩ Reply to this earlier message in the chat. */
  options: { confirmed?: boolean; replyTo?: string | null; /** My Agent, "📍 Near me now": the sender's position, for this message only (never stored). */ here?: { lat: number; lon: number } | null } = {},
): Promise<{ error?: string; threadId?: string; nudge?: { rule: string; message: string }; appealId?: string }> {
  const { user, agent } = await requireAgent();
  const content = text.trim().slice(0, 4000);
  if (!content || !Id.safeParse(conversationId).success) return {};
  if (!(await isMember(conversationId, user.id))) throw new Error("Not found");
  const conv = await getConversation(conversationId);
  if (!conv) throw new Error("Not found");
  // Direct messages are for contacts: removed or blocked closes the chat (also for "@agent" there).
  if (conv.kind === "dm") {
    const { state } = await dmState(conversationId, user.id, agent.id);
    if (state !== "open") return { error: DM_CLOSED[state] };
  }

  // ↩ Reply: only a message in this chat that everyone here can see (otherwise it's sent without the quote).
  const reply = await resolveReply(conversationId, options.replyTo);
  const replyContext = reply ? quoteContext(reply.author, reply.text) : undefined;

  // "@agent ..." in a group, DM or community chat summons the sender's own agent (privately). Also inside a
  // message ("I'm fine thanks. @agent: what's the weather?"): nothing is posted until they send the draft.
  const summoned = (conv.kind === "group" || conv.kind === "dm" || conv.kind === "channel") && summonsAgent(content);
  // Private @agent help is always fine; posting for everyone follows the chat's rules.
  if (!summoned) {
    const allowed = await canPost(conv as unknown as ConvRow, user.id);
    if (!allowed.ok) return { error: allowed.error };
  }
  const talksToAgent = conv.kind === "my_agent" || conv.kind === "agent_chat" || summoned;
  if (talksToAgent) {
    // Every message to an agent costs AI time: cap the rate per user.
    const limit = await hit("agentMessagesPerUser", user.id);
    if (!limit.allowed) {
      return { error: `You're sending messages to agents too quickly. Try again in ${describeRetry(limit.retryAfterSeconds)}.` };
    }
  }

  // Communities: free spam checks before posting (slow mode, links, mentions, repeats), by trust level.
  let flags: string[] = [];
  if (conv.kind === "channel" && conv.community_id && !summoned) {
    const guard = await guardCommunityPost(conv.community_id, user.id, content, { resend: Boolean(options.confirmed) });
    if (!guard.ok) return { error: guard.error };
    // Autopilot: an AI check against the community's rules; code decides (refuse, nudge, or post).
    const auto = await autopilot({ communityId: conv.community_id, conversationId, userId: user.id, text: content, level: guard.level, confirmed: Boolean(options.confirmed), replyingTo: replyContext });
    if (auto.action === "refuse") return { error: auto.message, ...(auto.eventId ? { appealId: auto.eventId } : {}) };
    if (auto.action === "nudge") return { nudge: { rule: auto.rule, message: auto.message } };
    flags = [...new Set([...guard.flags, ...auto.flags])];
  }

  // My Agent: one thread per request; everything the agent says while handling this stays in it.
  const thread = conv.kind === "my_agent" ? await resolveThread({ userId: user.id, conversationId, threadId, text: content }) : null;

  await withUsageContext({ userId: user.id, agentId: agent.id }, async () => {
    if (conv.kind === "my_agent" && thread) {
      await withThread({ conversationId, threadId: thread }, async () => {
        // "📍 Near me now": the position becomes the nearest town here, on our server; only the town is used.
        await handleOwnerMessage({ userId: user.id, agent, conversationId, text: content, reply, here: townAt(options.here) });
        // "I'm vegetarian now": offer to remember it (nothing is saved until you tap Save).
        await offerProfileSave(agent, conversationId, content);
      });
    } else if (conv.kind === "agent_chat") {
      await askAgent({ userId: user.id, agent, conversationId, text: content, reply });
    } else if (summoned) {
      await handleAgentCommand({ userId: user.id, agent, conversation: conv, text: content, reply });
    } else {
      await postMessage({ conversationId, from: "human", userId: user.id, content, replyTo: reply?.id, ...(flags.length ? { metadata: { flags } } : {}) });
      // Businesses placed in this group or community answer when @mentioned (after the reply is sent).
      if (conv.kind === "group" || conv.kind === "channel") {
        after(() => withUsageContext({ userId: user.id, agentId: agent.id }, () => answerMentions({ conversation: conv, userId: user.id, agent, text: content, replyContext })));
      }
    }
  });
  revalidatePath(`/chats/${conversationId}`);
  return thread ? { threadId: thread } : {};
}

/** "Shall I remember …?" in My Agent: save it to your profile, or not. */
export async function answerFactSuggestionAction(messageId: string, accept: boolean): Promise<{ error?: string }> {
  const { user, agent } = await requireAgent();
  if (!Id.safeParse(messageId).success) return { error: "Not found." };
  const result = await answerSuggestion(user.id, agent, messageId, Boolean(accept));
  revalidatePath("/chats", "layout");
  revalidatePath("/settings/about");
  return result.ok ? {} : { error: result.error };
}

/** "Shall I ask its agent?" in My Agent: your agent asks the business for you, or not. */
export async function answerBusinessSuggestionAction(messageId: string, ask: boolean): Promise<{ error?: string }> {
  const { user, agent } = await requireAgent();
  if (!Id.safeParse(messageId).success) return { error: "Not found." };
  if (ask) {
    const limit = await hit("agentMessagesPerUser", user.id);
    if (!limit.allowed) return { error: `You're sending messages to agents too quickly. Try again in ${describeRetry(limit.retryAfterSeconds)}.` };
  }
  const result = await withUsageContext({ userId: user.id, agentId: agent.id }, () => answerBusinessSuggestion(user.id, agent, messageId, Boolean(ask)));
  revalidatePath("/chats", "layout");
  return result.ok ? {} : { error: result.error };
}

/** Rename a My Agent thread. */
export async function renameThreadAction(threadId: string, title: string): Promise<{ error?: string }> {
  const { user } = await requireAgent();
  if (!Id.safeParse(threadId).success) return { error: "Not found." };
  const result = await renameThread(user.id, threadId, String(title ?? ""));
  revalidatePath("/chats", "layout");
  return result.ok ? {} : { error: result.error };
}

/** Viewing a thread: its updates are read (keeps its badge in step while it's open). */
export async function markThreadReadAction(threadId: string) {
  await requireAgent();
  if (!Id.safeParse(threadId).success) return;
  const supabase = await createClient();
  await supabase.rpc("mark_thread_read", { p_thread: threadId });
}

/**
 * "Send as me": the owner sends (possibly edited) text that their agent drafted.
 * It is posted as the owner's own message, under the same rules as any message
 * they type (closed chats, community checks), and exactly once.
 */
export async function sendDraftAction(conversationId: string, draftMessageId: string, text: string): Promise<{ error?: string }> {
  const { user, agent } = await requireAgent();
  const content = text.trim().slice(0, 4000);
  if (!content || !Id.safeParse(conversationId).success || !Id.safeParse(draftMessageId).success) return { error: "Nothing to send." };
  if (!(await isMember(conversationId, user.id))) return { error: "Not found." };
  const conv = await getConversation(conversationId);
  if (!conv) return { error: "Not found." };
  if (conv.kind === "dm") {
    const { state } = await dmState(conversationId, user.id, agent.id);
    if (state !== "open") return { error: DM_CLOSED[state] };
  }
  const allowed = await canPost(conv as unknown as ConvRow, user.id);
  if (!allowed.ok) return { error: allowed.error };
  const db = adminClient();
  // Only the owner's own, unused private draft in this chat.
  const { data: draft } = await db.from("messages").select("id, metadata").eq("id", draftMessageId).eq("conversation_id", conversationId).eq("visible_to", user.id).maybeSingle();
  const meta = (draft?.metadata ?? {}) as Record<string, unknown>;
  if (!draft || meta.kind !== "draft") return { error: "Not found." };
  if (meta.sent) return { error: "Already sent." };

  // Communities: the same checks as a typed message (spam checks, then the community's rules).
  let flags: string[] = [];
  if (conv.kind === "channel" && conv.community_id) {
    const communityId = conv.community_id;
    const guard = await guardCommunityPost(communityId, user.id, content, { resend: false });
    if (!guard.ok) return { error: guard.error };
    const auto = await withUsageContext({ userId: user.id, agentId: agent.id }, () =>
      autopilot({ communityId, conversationId, userId: user.id, text: content, level: guard.level, confirmed: false }),
    );
    if (auto.action === "refuse") return { error: auto.message };
    if (auto.action === "nudge") return { error: `${auto.message} Edit the draft and try again.` };
    flags = [...new Set([...guard.flags, ...auto.flags])];
  }

  // Claim the draft first, so two taps (or two tabs) can't send it twice.
  const { data: claimed } = await db
    .from("messages")
    .update({ metadata: asJson({ ...meta, sent: true }) })
    .eq("id", draftMessageId)
    .is("metadata->>sent", null)
    .select("id");
  if (!claimed?.length) return { error: "Already sent." };
  try {
    await postMessage({ conversationId, from: "human", userId: user.id, content, ...(flags.length ? { metadata: { flags } } : {}) });
  } catch {
    await db.from("messages").update({ metadata: asJson(meta) }).eq("id", draftMessageId);
    return { error: "Couldn't send it. Please try again." };
  }
  // Businesses placed in this group or community answer when @mentioned, as for a typed message.
  if (conv.kind === "group" || conv.kind === "channel") {
    after(() => withUsageContext({ userId: user.id, agentId: agent.id }, () => answerMentions({ conversation: conv, userId: user.id, agent, text: content })));
  }
  revalidatePath(`/chats/${conversationId}`);
  return {};
}

/** The user has seen this conversation up to now (clears its unread counter). */
export async function markReadAction(conversationId: string) {
  await requireAgent();
  if (!Id.safeParse(conversationId).success) return;
  // Database clock + the caller's own row only (see mark_conversation_read).
  const supabase = await createClient();
  await supabase.rpc("mark_conversation_read", { p_conversation: conversationId });
}

// ------------------------------------------------------------- tasks & proposals

export async function approveTaskAction(taskId: string) {
  const { user } = await requireAgent();
  if (await approveTask(taskId, user.id)) {
    // Respond immediately; agents work in the background and progress streams in via Realtime.
    after(() => runTask(taskId));
  }
}

/** Organiser edits the composed plan in the preview, before approving. */
export async function updateDraftAction(taskId: string, draft: PlanDraft): Promise<{ error?: string }> {
  const { user } = await requireAgent();
  const result = await updateDraft(taskId, user.id, draft);
  revalidatePath("/chats", "layout");
  return result.ok ? {} : { error: result.error };
}

/** Organiser: go ahead with the people who answered instead of waiting for the rest. */
export async function continueWithoutWaitingAction(taskId: string) {
  const { user } = await requireAgent();
  if (await continueWithoutWaiting(taskId, user.id)) after(() => runTask(taskId));
}

// ------------------------------------------------------------- inbox ("ask my human")

export async function answerInboxAction(itemId: string, answers: Record<string, string>, remember: boolean): Promise<{ error?: string }> {
  const { user, agent } = await requireAgent();
  const result = await withUsageContext({ userId: user.id, agentId: agent.id }, () => answerInboxItem(itemId, user.id, answers, remember));
  if (!result.ok) return { error: result.error };
  const wake = result.wake;
  if (wake) after(() => runTask(wake));
  await tellOwner(user.id, agent.id, "✅ Done: I sent your answer, marked as answered by you personally.");
  revalidatePath("/chats", "layout");
  return {};
}

export async function declineInboxAction(itemId: string): Promise<{ error?: string }> {
  const { user, agent } = await requireAgent();
  const result = await declineInboxItem(itemId, user.id);
  if (!result.ok) return { error: result.error };
  const wake = result.wake;
  if (wake) after(() => runTask(wake));
  await tellOwner(user.id, agent.id, "🙅 OK: I didn't answer. Nothing was shared.");
  revalidatePath("/chats", "layout");
  return {};
}

export async function cancelTaskAction(taskId: string) {
  const { user } = await requireAgent();
  await cancelTask(taskId, user.id);
}

export async function decideProposalAction(proposalId: string, decision: "accept" | "reject") {
  const { user } = await requireAgent();
  const { data } = await adminClient().from("proposals").select("task_id").eq("id", proposalId).maybeSingle();
  if (await decideProposal(proposalId, user.id, decision)) {
    const taskId = data?.task_id;
    if (taskId) after(() => runTask(taskId));
  }
}

// ------------------------------------------------------------- RSVP & polls (always the person's own action)

export async function rsvpAction(stepId: string, response: "in" | "out"): Promise<{ error?: string }> {
  const { user, agent } = await requireAgent();
  const result = await respondRsvp(stepId, user.id, agent, response);
  // Show the responder their own answer immediately (others get it via Realtime).
  revalidatePath("/chats", "layout");
  return result.ok ? {} : { error: result.error };
}

export async function voteAction(stepId: string, option: string): Promise<{ error?: string }> {
  const { user, agent } = await requireAgent();
  const result = await votePoll(stepId, user.id, agent, option);
  if (result.ok && result.wake) {
    const wake = result.wake;
    after(() => runTask(wake));
  }
  revalidatePath("/chats", "layout");
  return result.ok ? {} : { error: result.error };
}

export async function claimItemAction(stepId: string, item: string): Promise<{ error?: string }> {
  const { user, agent } = await requireAgent();
  const result = await claimItem(stepId, user.id, agent, item);
  if (result.ok && result.wake) {
    const wake = result.wake;
    after(() => runTask(wake));
  }
  revalidatePath("/chats", "layout");
  return result.ok ? {} : { error: result.error };
}

export async function unclaimItemAction(stepId: string, item: string): Promise<{ error?: string }> {
  const { user, agent } = await requireAgent();
  const result = await unclaimItem(stepId, user.id, agent, item);
  revalidatePath("/chats", "layout");
  return result.ok ? {} : { error: result.error };
}

/** Organiser edits a shared plan (Change block). */
export async function changePlanAction(proposalId: string, input: ChangeInputT): Promise<{ error?: string; warnings?: string[] }> {
  const { user } = await requireAgent();
  const result = await changePlan(proposalId, user.id, input);
  revalidatePath("/chats", "layout");
  return result.ok ? { warnings: result.warnings } : { error: result.error };
}

export async function closePollAction(stepId: string): Promise<{ error?: string }> {
  const { user } = await requireAgent();
  const result = await closePollStep(stepId, user.id);
  if (result.ok && result.wake) {
    const wake = result.wake;
    after(() => runTask(wake));
  }
  revalidatePath("/chats", "layout");
  return result.ok ? {} : { error: result.error };
}

// ------------------------------------------------------------- contacts

export async function requestContact(handle: string) {
  const { agent } = await requireAgent();
  const other = await getAgentByHandle(handle);
  if (!other || other.id === agent.id) return { error: "Agent not found." };
  const result = await sendContactRequest(agent, other);
  revalidatePath("/contacts");
  revalidatePath("/discover");
  revalidatePath(`/u/${other.handle}`);
  return result;
}

async function ownContactRow(contactId: string) {
  const { agent } = await requireAgent();
  const { data } = await adminClient().from("contacts").select("*").eq("id", contactId).maybeSingle();
  if (!data || (data.requester_agent !== agent.id && data.addressee_agent !== agent.id)) throw new Error("Not found");
  return { agent, row: data };
}

export async function acceptContact(contactId: string) {
  const { agent, row } = await ownContactRow(contactId);
  if (row.status !== "pending" || row.addressee_agent !== agent.id) return;
  await adminClient().from("contacts").update({ status: "accepted" }).eq("id", contactId);
  revalidatePath("/contacts");
}

export async function removeContact(contactId: string) {
  const { agent, row } = await ownContactRow(contactId);
  // A block can only be lifted by the agent that blocked.
  if (row.status === "blocked" && row.blocked_by !== agent.id) return;
  await adminClient().from("contacts").delete().eq("id", contactId);
  revalidatePath("/contacts");
}

export async function blockContact(contactId: string) {
  const { agent } = await ownContactRow(contactId);
  await adminClient().from("contacts").update({ status: "blocked", blocked_by: agent.id }).eq("id", contactId);
  revalidatePath("/contacts");
}

// ------------------------------------------------------------- conversations

export async function openDirectMessage(otherAgentId: string) {
  const { user, agent } = await requireAgent();
  const other = await getAgentById(otherAgentId);
  if (!other) throw new Error("Not found");
  if ((await getContactRow(agent.id, other.id))?.status !== "accepted") throw new Error("Only contacts can message each other.");
  const existing = await findConversation("dm", [user.id, other.owner_id]);
  const conv = existing ?? (await createConversation({ kind: "dm", createdBy: user.id, memberIds: [other.owner_id] }));
  redirect(`/chats/${conv.id}`);
}

export async function openAgentChat(otherAgentId: string) {
  const { user, agent } = await requireAgent();
  const other = await getAgentById(otherAgentId);
  if (!other || other.id === agent.id) throw new Error("Not found");
  const existing = await findConversation("agent_chat", [user.id], other.id);
  const conv =
    existing ??
    (await createConversation({ kind: "agent_chat", title: other.display_name, createdBy: user.id, memberIds: [], targetAgent: other.id }));
  redirect(`/chats/${conv.id}`);
}

export async function openMyAgent() {
  const { user } = await requireAgent();
  const conv = await getOrCreateMyAgentConversation(user.id);
  redirect(`/chats/${conv.id}`);
}

export async function leaveConversation(conversationId: string) {
  const { user, agent } = await requireAgent();
  const db = adminClient();
  const { data: kind } = await db.from("conversations").select("kind, community_id").eq("id", conversationId).maybeSingle();
  // Community chats are left from the community's page (you leave both of its chats).
  if (kind?.kind === "channel" && kind.community_id) redirect(`/communities/${kind.community_id}`);
  // Only an actual member can leave (and so announce it).
  const { data: left } = await db.from("conversation_members").delete().eq("conversation_id", conversationId).eq("user_id", user.id).select("user_id, role");
  if (!left?.length) redirect("/chats");
  const { count } = await db.from("conversation_members").select("*", { count: "exact", head: true }).eq("conversation_id", conversationId);
  if (!count) {
    // Delete the conversation (and its messages) once nobody is left.
    await db.from("conversations").delete().eq("id", conversationId);
  } else {
    // Tell the people still in the chat, WhatsApp-style.
    const { data: conv } = await db.from("conversations").select("kind").eq("id", conversationId).single();
    if (conv?.kind === "dm") {
      // A DM is named after the other person: keep their name so the chat doesn't go blank.
      await db.from("conversations").update({ title: `${agent.display_name} (left)` }).eq("id", conversationId);
    }
    if (conv?.kind === "group" || conv?.kind === "dm") {
      await postMessage({ conversationId, from: "system", content: `${agent.display_name} left the chat.` });
    }
    if (conv?.kind === "group") await handOverIfOwnerLeft(conversationId, user.id, left[0].role === "owner");
  }
  redirect("/chats");
}

// ------------------------------------------------------------- settings / permissions


export async function saveSettings(form: FormData) {
  const { agent } = await requireAgent();
  const db = adminClient();
  const policy = z.enum(["contacts_only", "anyone", "nobody"]).safeParse(form.get("contact_policy"));
  const groupPolicy = z.enum(["contacts", "nobody"]).safeParse(form.get("group_add_policy"));
  const typedName = String(form.get("display_name") ?? "").trim().slice(0, maxNameFor(agent.type));
  const displayName = typedName.length >= MIN_NAME ? typedName : "";
  const pickedAvatar = String(form.get("avatar") ?? "");
  const avatar = avatarsFor(agent.type, agent.avatar).includes(pickedAvatar) ? pickedAvatar : null;
  await db
    .from("agents")
    .update({
      ...(policy.success ? { contact_policy: policy.data } : {}),
      ...(groupPolicy.success ? { group_add_policy: groupPolicy.data } : {}),
      // A checkbox sends nothing when unticked: only trust its absence when the form section was there.
      ...(form.get("recommendations_form") ? { recommendations_ok: form.get("recommendations_ok") === "on" } : {}),
      ...(form.get("lookup_form") ? { lookup_place: form.get("lookup_place") === "on" } : {}),
      ...(displayName ? { display_name: displayName } : {}),
      ...(avatar ? { avatar } : {}),
    })
    .eq("id", agent.id);

  // What the agent knows about you is edited in Settings → What your agent knows (its own page).
  // Business details are edited in My Business (they'd be wiped if saved from here).
  // Back to the settings page the form was on.
  const returnTo = String(form.get("return_to") ?? "");
  const page = ["/settings/profile", "/settings/privacy"].includes(returnTo) ? returnTo : "/settings";
  // The name and avatar show all over the app (header, chats, contacts).
  revalidatePath("/", "layout");
  redirect(`${page}?saved=1`);
}

export async function deleteAccount(form: FormData) {
  const { user, agent } = await requireAgent();
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== agent.handle) redirect("/settings/profile?error=confirm");
  const person = await realPerson(user, agent);
  const db = adminClient();
  const removeLogin = async (userId: string) => {
    // Private conversations go entirely; shared ones keep other members' history.
    await db.from("conversations").delete().eq("created_by", userId).in("kind", ["my_agent", "agent_chat"]);
    // Cascades: agent, facts, contacts, memberships, tasks, exchanges, proposals.
    await db.auth.admin.deleteUser(userId);
  };

  // Deleting a business you switched into: back to your personal account.
  if (agent.type === "business" && person && person !== user.id) {
    await removeLogin(user.id);
    await forgetPerson();
    if (await signInAs(person)) redirect("/chats?business_deleted=1");
    redirect("/login");
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  await forgetPerson();
  // Businesses only you own go with you (shared ones stay with their other owners).
  for (const biz of await businessesOnlyOwnedBy(user.id)) await removeLogin(biz.ownerId);
  await removeLogin(user.id);
  redirect("/?deleted=1");
}
