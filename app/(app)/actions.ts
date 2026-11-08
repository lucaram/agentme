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
import { FACT_CATEGORIES } from "@/lib/policy/disclosure";
import { describeRetry, hit } from "@/lib/limits";
import { continueWithoutWaiting } from "@/lib/plans/engine";
import { answerInboxItem, declineInboxItem } from "@/lib/plans/inbox";
import { claimItem, closePollStep, respondRsvp, unclaimItem, votePoll } from "@/lib/plans/participation";
import { changePlan, type ChangeInputT } from "@/lib/plans/change";
import { MAX_PLAN_PEOPLE } from "@/lib/plans/types";
import { withUsageContext } from "@/lib/usage/context";
import { isAgentCommand } from "@/lib/agents/commands";
import { handleAgentCommand } from "@/lib/agents/in-chat";

const Id = z.uuid();

// ------------------------------------------------------------- messages

export async function sendMessage(conversationId: string, text: string): Promise<{ error?: string }> {
  const { user, agent } = await requireAgent();
  const content = text.trim().slice(0, 4000);
  if (!content || !Id.safeParse(conversationId).success) return {};
  if (!(await isMember(conversationId, user.id))) throw new Error("Not found");
  const conv = await getConversation(conversationId);
  if (!conv) throw new Error("Not found");

  // "@agent ..." in a group or DM summons the sender's own agent (privately).
  const summoned = (conv.kind === "group" || conv.kind === "dm") && isAgentCommand(content);
  const talksToAgent = conv.kind === "my_agent" || conv.kind === "agent_chat" || summoned;
  if (talksToAgent) {
    // Every message to an agent costs AI time: cap the rate per user.
    const limit = await hit("agentMessagesPerUser", user.id);
    if (!limit.allowed) {
      return { error: `You're sending messages to agents too quickly. Try again in ${describeRetry(limit.retryAfterSeconds)}.` };
    }
  }

  await withUsageContext({ userId: user.id, agentId: agent.id }, async () => {
    if (conv.kind === "my_agent") {
      await handleOwnerMessage({ userId: user.id, agent, conversationId, text: content });
    } else if (conv.kind === "agent_chat") {
      await askAgent({ userId: user.id, agent, conversationId, text: content });
    } else if (summoned) {
      await handleAgentCommand({ userId: user.id, agent, conversation: conv, text: content });
    } else {
      await postMessage({ conversationId, from: "human", userId: user.id, content });
    }
  });
  revalidatePath(`/chats/${conversationId}`);
  return {};
}

/**
 * "Send as me": the owner sends (possibly edited) text that their agent drafted.
 * It is posted as the owner's own message: the owner reviewed and chose to send it.
 */
export async function sendDraftAction(conversationId: string, draftMessageId: string, text: string): Promise<{ error?: string }> {
  const { user } = await requireAgent();
  const content = text.trim().slice(0, 4000);
  if (!content || !Id.safeParse(conversationId).success || !Id.safeParse(draftMessageId).success) return { error: "Nothing to send." };
  if (!(await isMember(conversationId, user.id))) return { error: "Not found." };
  const db = adminClient();
  // Only the owner's own, unused private draft in this chat.
  const { data: draft } = await db.from("messages").select("id, metadata").eq("id", draftMessageId).eq("conversation_id", conversationId).eq("visible_to", user.id).maybeSingle();
  const meta = (draft?.metadata ?? {}) as Record<string, unknown>;
  if (!draft || meta.kind !== "draft") return { error: "Not found." };
  if (meta.sent) return { error: "Already sent." };
  await postMessage({ conversationId, from: "human", userId: user.id, content });
  await db.from("messages").update({ metadata: asJson({ ...meta, sent: true }) }).eq("id", draftMessageId);
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
  revalidatePath("/inbox");
  return {};
}

export async function declineInboxAction(itemId: string): Promise<{ error?: string }> {
  const { user } = await requireAgent();
  const result = await declineInboxItem(itemId, user.id);
  if (!result.ok) return { error: result.error };
  const wake = result.wake;
  if (wake) after(() => runTask(wake));
  revalidatePath("/inbox");
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
  const existing = await getContactRow(agent.id, other.id);
  if (existing) {
    // Accepting a crossed request; never reveal or override a block.
    if (existing.status === "pending" && existing.addressee_agent === agent.id) {
      await adminClient().from("contacts").update({ status: "accepted" }).eq("id", existing.id);
    }
    revalidatePath("/contacts");
    return { ok: true };
  }
  if (other.contact_policy === "nobody") return { error: `@${other.handle} isn't accepting contact requests.` };
  const limit = await hit("contactRequestsPerAgent", agent.id);
  if (!limit.allowed) return { error: `Too many contact requests. Try again in ${describeRetry(limit.retryAfterSeconds)}.` };
  await adminClient().from("contacts").insert({ requester_agent: agent.id, addressee_agent: other.id });
  revalidatePath("/contacts");
  revalidatePath("/discover");
  return { ok: true };
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

export async function createGroup(form: FormData) {
  const { user, agent } = await requireAgent();
  const title = String(form.get("title") ?? "").trim().slice(0, 80) || "New group";
  const agentIds = form.getAll("members").map(String).filter((id) => Id.safeParse(id).success);
  const memberIds: string[] = [];
  for (const id of agentIds) {
    const other = await getAgentById(id);
    if (other && (await getContactRow(agent.id, other.id))?.status === "accepted") memberIds.push(other.owner_id);
  }
  if (!memberIds.length) redirect("/chats?error=group");
  if (memberIds.length + 1 > MAX_PLAN_PEOPLE) redirect("/chats?error=group-size");
  const conv = await createConversation({ kind: "group", title, createdBy: user.id, memberIds });
  await postMessage({ conversationId: conv.id, from: "system", content: `${agent.display_name} created the group.` });
  redirect(`/chats/${conv.id}`);
}

export async function leaveConversation(conversationId: string) {
  const { user } = await requireAgent();
  const db = adminClient();
  await db.from("conversation_members").delete().eq("conversation_id", conversationId).eq("user_id", user.id);
  const { count } = await db.from("conversation_members").select("*", { count: "exact", head: true }).eq("conversation_id", conversationId);
  // Delete the conversation (and its messages) once nobody is left.
  if (!count) await db.from("conversations").delete().eq("id", conversationId);
  redirect("/chats");
}

// ------------------------------------------------------------- settings / permissions

const FactInput = z.object({ value: z.string().trim().max(500), share: z.boolean() });

export async function saveSettings(form: FormData) {
  const { agent } = await requireAgent();
  const db = adminClient();
  const policy = z.enum(["contacts_only", "anyone", "nobody"]).safeParse(form.get("contact_policy"));
  const displayName = String(form.get("display_name") ?? "").trim().slice(0, 60);
  await db
    .from("agents")
    .update({
      ...(policy.success ? { contact_policy: policy.data } : {}),
      ...(displayName ? { display_name: displayName } : {}),
    })
    .eq("id", agent.id);

  if (agent.type === "personal") {
    for (const category of FACT_CATEGORIES) {
      const fact = FactInput.parse({ value: String(form.get(category) ?? ""), share: form.get(`share_${category}`) === "on" });
      if (!fact.value) {
        await db.from("agent_facts").delete().eq("agent_id", agent.id).eq("category", category);
        continue;
      }
      await db.from("agent_facts").upsert(
        // Private notes can never be shared.
        { agent_id: agent.id, category, value: fact.value, disclosure: category !== "notes" && fact.share ? "contacts" : "private" },
        { onConflict: "agent_id,category" },
      );
    }
  } else {
    const faqs = [1, 2, 3, 4, 5]
      .map((i) => ({ q: String(form.get(`faq_q_${i}`) ?? "").trim(), a: String(form.get(`faq_a_${i}`) ?? "").trim() }))
      .filter((f) => f.q && f.a);
    const description = String(form.get("description") ?? "").trim().slice(0, 500);
    await db
      .from("agents")
      .update({
        bio: description.slice(0, 280) || null,
        business_info: asJson({ description, hours: String(form.get("hours") ?? "").trim().slice(0, 300), faqs }),
      })
      .eq("id", agent.id);
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function deleteAccount(form: FormData) {
  const { user, agent } = await requireAgent();
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== agent.handle) redirect("/settings?error=confirm");
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Private conversations go entirely; shared ones keep other members' history.
  await adminClient().from("conversations").delete().eq("created_by", user.id).in("kind", ["my_agent", "agent_chat"]);
  // Cascades: agent, facts, contacts, memberships, tasks, exchanges, proposals.
  await adminClient().auth.admin.deleteUser(user.id);
  redirect("/?deleted=1");
}
