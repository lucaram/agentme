import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getAgentById, getContactRow, type AgentRow } from "@/lib/data/agents";
import { postMessage } from "@/lib/data/chat";
import { randomToken } from "@/lib/people/crypto";
import { connectPeople } from "@/lib/people/connect";
import { MAX_PLAN_PEOPLE, type TaskParsed } from "./types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const INVITE_DAYS = 14;
const CLOSED = new Set(["cancelled", "failed", "rejected", "awaiting_approval"]);

export const inviteUrl = (token: string) => `${env.appUrl.replace(/\/$/, "")}/join/${token}`;

/**
 * The organiser's invite link for a plan, for people who aren't on AGENTME (or
 * aren't their contacts yet). The organiser shares it themselves (WhatsApp,
 * SMS, email): AGENTME never stores the invitee's number or address.
 */
export async function getOrCreateInvite(taskId: string, userId: string): Promise<Result<{ url: string }>> {
  const db = adminClient();
  const { data: task } = await db.from("tasks").select("id, owner_id, initiator_agent, status, group_conversation_id").eq("id", taskId).maybeSingle();
  if (!task || task.owner_id !== userId) return { ok: false, error: "Only the organiser can invite people." };
  if (!task.group_conversation_id || CLOSED.has(task.status)) return { ok: false, error: "This plan can't take new people." };
  const { data: existing } = await db
    .from("plan_invites")
    .select("token")
    .eq("task_id", taskId)
    .eq("revoked", false)
    .gt("expires_at", new Date(Date.now() + 24 * 3600 * 1000).toISOString())
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true, url: inviteUrl(existing.token) };
  const token = randomToken();
  const { error } = await db.from("plan_invites").insert({
    token,
    task_id: taskId,
    created_by: task.initiator_agent,
    expires_at: new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000).toISOString(),
  });
  if (error) return { ok: false, error: "Couldn't create the link." };
  return { ok: true, url: inviteUrl(token) };
}

/** Stops the link working (people who already joined stay in). */
export async function revokeInvites(taskId: string, userId: string): Promise<Result> {
  const db = adminClient();
  const { data: task } = await db.from("tasks").select("owner_id").eq("id", taskId).maybeSingle();
  if (!task || task.owner_id !== userId) return { ok: false, error: "Not found." };
  await db.from("plan_invites").update({ revoked: true }).eq("task_id", taskId);
  return { ok: true };
}

export type InvitePreview = {
  token: string;
  taskId: string;
  conversationId: string;
  title: string;
  when: string;
  organiser: AgentRow;
  people: number;
};

/** What someone opening the link may see: title, when, who organises, how many. Null if invalid. */
export async function loadInvite(token: string): Promise<InvitePreview | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const db = adminClient();
  const { data: invite } = await db.from("plan_invites").select("*").eq("token", token).maybeSingle();
  if (!invite || invite.revoked || new Date(invite.expires_at).getTime() < Date.now()) return null;
  const { data: task } = await db.from("tasks").select("*").eq("id", invite.task_id).maybeSingle();
  if (!task || !task.group_conversation_id || CLOSED.has(task.status)) return null;
  const organiser = await getAgentById(task.initiator_agent);
  if (!organiser) return null;
  const parsed = task.parsed as TaskParsed & { title?: string };
  const [{ data: proposal }, { data: group }] = await Promise.all([
    db.from("proposals").select("content").eq("task_id", task.id).maybeSingle(),
    db.from("conversations").select("title").eq("id", task.group_conversation_id).maybeSingle(),
  ]);
  const content = (proposal?.content ?? {}) as { title?: string; when?: string };
  const time = parsed.time ? ` at ${parsed.time}` : "";
  return {
    token,
    taskId: task.id,
    conversationId: task.group_conversation_id,
    // The name members see on the group chat (e.g. "📊 Where shall we eat?").
    title: content.title || group?.title || parsed.title || parsed.event || "A plan",
    when: content.when || `${parsed.window ?? ""}${time}`.trim(),
    organiser,
    people: 1 + (parsed.participants?.length ?? 0),
  };
}

/**
 * Joins the plan from its invite link: added to the plan (and its open polls
 * and sign-up lists) and its group chat, and connected with the organiser
 * (both chose this: the organiser shared the link, the person opened it and
 * tapped Join).
 */
export async function joinPlan(token: string, userId: string, agent: AgentRow): Promise<Result<{ conversationId: string }>> {
  const invite = await loadInvite(token);
  if (!invite) return { ok: false, error: "This invite link has expired or was turned off." };
  const db = adminClient();
  if (invite.organiser.id !== agent.id) {
    if ((await getContactRow(invite.organiser.id, agent.id))?.status === "blocked") {
      return { ok: false, error: "This invite link has expired or was turned off." };
    }
    const { data: outcome } = await db.rpc("add_plan_participant", { p_task: invite.taskId, p_handle: agent.handle, p_max: MAX_PLAN_PEOPLE });
    if (outcome === "full") return { ok: false, error: `This plan is full (${MAX_PLAN_PEOPLE} people max).` };
    if (outcome === "missing") return { ok: false, error: "This invite link has expired or was turned off." };
    await db.from("conversation_members").upsert({ conversation_id: invite.conversationId, user_id: userId }, { onConflict: "conversation_id,user_id", ignoreDuplicates: true });
    await connectPeople(invite.organiser, agent);
    if (outcome === "added") {
      await db.rpc("increment_invite_uses", { p_token: token });
      await postMessage({ conversationId: invite.conversationId, from: "system", content: `${agent.display_name} joined with the invite link.`, metadata: { kind: "event" } });
    }
  }
  return { ok: true, conversationId: invite.conversationId };
}
