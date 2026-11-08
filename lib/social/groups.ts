import "server-only";
import { NEEDS_ANSWER, tellOwner } from "@/lib/requests/notify";
import { adminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/data/json";
import { getAgentById, getAgentForUser, getContactRow, type AgentRow } from "@/lib/data/agents";
import { createConversation, postMessage } from "@/lib/data/chat";
import { GROUP_AVATARS, MAX_GROUP_PEOPLE, groupRole, isGroupAdmin, loadJoinLink, type Result } from "./shared";

type Me = { userId: string; agent: AgentRow };

async function loadGroup(conversationId: string) {
  const { data } = await adminClient().from("conversations").select("*").eq("id", conversationId).eq("kind", "group").maybeSingle();
  return data;
}

const note = (conversationId: string, content: string) => postMessage({ conversationId, from: "system", content, metadata: { kind: "event" } });

async function memberCount(conversationId: string) {
  const { count } = await adminClient().from("conversation_members").select("*", { count: "exact", head: true }).eq("conversation_id", conversationId);
  return count ?? 0;
}

const listNames = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * Adds people (your accepted contacts) to a group. People who chose "nobody
 * can add me to groups" get an invite in their Inbox instead; people who
 * blocked this group are skipped.
 */
async function addPeople(groupId: string, groupTitle: string, me: Me, agentIds: string[]): Promise<{ added: AgentRow[]; invited: AgentRow[]; skipped: number }> {
  const db = adminClient();
  const added: AgentRow[] = [];
  const invited: AgentRow[] = [];
  let skipped = 0;
  const { data: current } = await db.from("conversation_members").select("user_id").eq("conversation_id", groupId);
  const inGroup = new Set((current ?? []).map((m) => m.user_id));
  const { data: blocks } = await db.from("conversation_blocks").select("user_id").eq("conversation_id", groupId);
  const blocked = new Set((blocks ?? []).map((b) => b.user_id));
  let size = inGroup.size;
  for (const id of [...new Set(agentIds)].slice(0, MAX_GROUP_PEOPLE)) {
    const other = await getAgentById(id);
    if (!other || other.id === me.agent.id || inGroup.has(other.owner_id)) continue;
    if ((await getContactRow(me.agent.id, other.id))?.status !== "accepted" || blocked.has(other.owner_id)) {
      skipped++;
      continue;
    }
    if (size >= MAX_GROUP_PEOPLE) {
      skipped++;
      continue;
    }
    if (other.group_add_policy === "nobody") {
      await db.from("inbox_items").insert({
        owner_id: other.owner_id,
        agent_id: other.id,
        from_agent: me.agent.id,
        kind: "group_invite",
        payload: asJson({ kind: "group_invite", conversation_id: groupId, title: groupTitle }),
      });
      await tellOwner(other.owner_id, other.id, `🔔 ${me.agent.display_name} wants to add you to the group “${groupTitle}”. ${NEEDS_ANSWER}`);
      invited.push(other);
      continue;
    }
    await db.from("conversation_members").insert({ conversation_id: groupId, user_id: other.owner_id, role: "member" });
    inGroup.add(other.owner_id);
    size++;
    added.push(other);
  }
  return { added, invited, skipped };
}

export async function createGroup(me: Me, input: { title: string; description: string; avatar: string; memberAgentIds: string[] }): Promise<Result<{ id: string; invited: number }>> {
  const title = input.title.trim().slice(0, 80);
  if (!title) return { ok: false, error: "Give the group a name." };
  if (!input.memberAgentIds.length) return { ok: false, error: "Pick at least one contact." };
  if (input.memberAgentIds.length + 1 > MAX_GROUP_PEOPLE) return { ok: false, error: `A group can have up to ${MAX_GROUP_PEOPLE} people.` };
  const conv = await createConversation({ kind: "group", title, createdBy: me.userId, memberIds: [] });
  await adminClient()
    .from("conversations")
    .update({ description: input.description.trim().slice(0, 500) || null, avatar: GROUP_AVATARS.includes(input.avatar) ? input.avatar : "👥" })
    .eq("id", conv.id);
  const { added, invited } = await addPeople(conv.id, title, me, input.memberAgentIds);
  await note(conv.id, `${me.agent.display_name} created the group.`);
  if (added.length) await note(conv.id, `${me.agent.display_name} added ${listNames(added.map((a) => a.display_name))}.`);
  if (!added.length && !invited.length) {
    await adminClient().from("conversations").delete().eq("id", conv.id);
    return { ok: false, error: "None of those people can be added. Pick your contacts." };
  }
  return { ok: true, id: conv.id, invited: invited.length };
}

export async function addMembers(groupId: string, me: Me, agentIds: string[]): Promise<Result<{ added: number; invited: number; skipped: number }>> {
  const group = await loadGroup(groupId);
  if (!group || !isGroupAdmin(await groupRole(groupId, me.userId))) return { ok: false, error: "Only admins can add people." };
  const { added, invited, skipped } = await addPeople(groupId, group.title ?? "Group", me, agentIds);
  if (added.length) await note(groupId, `${me.agent.display_name} added ${listNames(added.map((a) => a.display_name))}.`);
  return { ok: true, added: added.length, invited: invited.length, skipped };
}

/** Admins remove people; nobody can remove the owner. */
export async function removeMember(groupId: string, me: Me, userId: string): Promise<Result> {
  const myRole = await groupRole(groupId, me.userId);
  const theirRole = await groupRole(groupId, userId);
  if (!(await loadGroup(groupId)) || !isGroupAdmin(myRole) || !theirRole || userId === me.userId) return { ok: false, error: "Not allowed." };
  if (theirRole === "owner") return { ok: false, error: "The group's owner can't be removed." };
  await adminClient().from("conversation_members").delete().eq("conversation_id", groupId).eq("user_id", userId);
  const them = await getAgentForUser(userId);
  await note(groupId, `${me.agent.display_name} removed ${them?.display_name ?? "someone"}.`);
  return { ok: true };
}

export async function setMemberRole(groupId: string, me: Me, userId: string, role: "admin" | "member"): Promise<Result> {
  const myRole = await groupRole(groupId, me.userId);
  const theirRole = await groupRole(groupId, userId);
  if (!(await loadGroup(groupId)) || !isGroupAdmin(myRole) || !theirRole || theirRole === "owner") return { ok: false, error: "Not allowed." };
  if (theirRole === role) return { ok: true };
  await adminClient().from("conversation_members").update({ role }).eq("conversation_id", groupId).eq("user_id", userId);
  const them = await getAgentForUser(userId);
  await note(groupId, role === "admin" ? `${me.agent.display_name} made ${them?.display_name} an admin.` : `${them?.display_name} is no longer an admin.`);
  return { ok: true };
}

export async function updateGroupInfo(groupId: string, me: Me, input: { title: string; description: string; avatar: string }): Promise<Result> {
  const group = await loadGroup(groupId);
  const role = await groupRole(groupId, me.userId);
  if (!group || !role) return { ok: false, error: "Not found." };
  if (group.only_admins_edit && !isGroupAdmin(role)) return { ok: false, error: "Only admins can edit this group's info." };
  const title = input.title.trim().slice(0, 80);
  if (!title) return { ok: false, error: "Give the group a name." };
  await adminClient()
    .from("conversations")
    .update({ title, description: input.description.trim().slice(0, 500) || null, avatar: GROUP_AVATARS.includes(input.avatar) ? input.avatar : group.avatar })
    .eq("id", groupId);
  if (title !== group.title) await note(groupId, `${me.agent.display_name} renamed the group to “${title}”.`);
  return { ok: true };
}

export async function updateGroupSettings(groupId: string, me: Me, settings: { only_admins_send: boolean; only_admins_edit: boolean; approve_new_members: boolean }): Promise<Result> {
  const group = await loadGroup(groupId);
  if (!group || !isGroupAdmin(await groupRole(groupId, me.userId))) return { ok: false, error: "Only admins can change settings." };
  await adminClient().from("conversations").update(settings).eq("id", groupId);
  if (settings.only_admins_send !== group.only_admins_send) {
    await note(groupId, settings.only_admins_send ? "Only admins can send messages now." : "Everyone can send messages now.");
  }
  return { ok: true };
}

export async function setMuted(conversationId: string, userId: string, muted: boolean): Promise<Result> {
  const { data } = await adminClient().from("conversation_members").update({ muted }).eq("conversation_id", conversationId).eq("user_id", userId).select("user_id");
  return data?.length ? { ok: true } : { ok: false, error: "Not found." };
}

/** When the owner leaves, the longest-serving admin (or member) takes over. */
export async function handOverIfOwnerLeft(groupId: string, leavingUserId: string, wasOwner: boolean) {
  if (!wasOwner) return;
  const db = adminClient();
  const { data: rest } = await db.from("conversation_members").select("user_id, role, joined_at").eq("conversation_id", groupId).neq("user_id", leavingUserId);
  const next = (rest ?? []).sort((a, b) => Number(b.role === "admin") - Number(a.role === "admin") || a.joined_at.localeCompare(b.joined_at))[0];
  if (!next) return;
  await db.from("conversation_members").update({ role: "owner" }).eq("conversation_id", groupId).eq("user_id", next.user_id);
  const them = await getAgentForUser(next.user_id);
  await note(groupId, `${them?.display_name ?? "Someone"} is now the group's owner.`);
}

/** Leave and don't let anyone add you back. */
export async function blockGroup(groupId: string, me: Me): Promise<Result> {
  const db = adminClient();
  const role = await groupRole(groupId, me.userId);
  if (!(await loadGroup(groupId)) || !role) return { ok: false, error: "Not found." };
  await db.from("conversation_members").delete().eq("conversation_id", groupId).eq("user_id", me.userId);
  await db.from("conversation_blocks").upsert({ conversation_id: groupId, user_id: me.userId }, { onConflict: "conversation_id,user_id", ignoreDuplicates: true });
  await note(groupId, `${me.agent.display_name} left the group.`);
  await handOverIfOwnerLeft(groupId, me.userId, role === "owner");
  return { ok: true };
}

export async function reportGroup(groupId: string, me: Me, reason: string): Promise<Result> {
  if (!(await loadGroup(groupId)) || !(await groupRole(groupId, me.userId))) return { ok: false, error: "Not found." };
  const text = reason.trim().slice(0, 300);
  if (!text) return { ok: false, error: "Say briefly what's wrong." };
  await adminClient().from("reports").insert({ reporter_id: me.userId, conversation_id: groupId, reason: text });
  return { ok: true };
}

/** Only the owner can delete a group, for everyone. */
export async function deleteGroup(groupId: string, me: Me): Promise<Result> {
  if (!(await loadGroup(groupId)) || (await groupRole(groupId, me.userId)) !== "owner") return { ok: false, error: "Only the owner can delete the group." };
  await adminClient().from("conversations").delete().eq("id", groupId);
  return { ok: true };
}

// ------------------------------------------------------------- joining

/** Join with an invite link: directly, or as a request when admins approve new members. */
export async function joinGroupWithLink(token: string, me: Me): Promise<Result<{ status: "joined" | "requested" | "member"; id: string }>> {
  const link = await loadJoinLink(token);
  if (!link?.conversation_id) return { ok: false, error: "This link doesn't work any more." };
  const group = await loadGroup(link.conversation_id);
  if (!group) return { ok: false, error: "This group no longer exists." };
  const db = adminClient();
  if (await groupRole(group.id, me.userId)) return { ok: true, status: "member", id: group.id };
  if ((await memberCount(group.id)) >= MAX_GROUP_PEOPLE) return { ok: false, error: "This group is full." };
  // Choosing to join by link lifts your own earlier block.
  await db.from("conversation_blocks").delete().eq("conversation_id", group.id).eq("user_id", me.userId);
  if (group.approve_new_members) {
    // A second request while one is pending is a no-op (unique pending index).
    await db.from("join_requests").insert({ conversation_id: group.id, user_id: me.userId });
    return { ok: true, status: "requested", id: group.id };
  }
  await db.from("conversation_members").insert({ conversation_id: group.id, user_id: me.userId, role: "member" });
  await note(group.id, `${me.agent.display_name} joined with the invite link.`);
  return { ok: true, status: "joined", id: group.id };
}

export async function decideGroupRequest(requestId: string, me: Me, approve: boolean): Promise<Result> {
  const db = adminClient();
  const { data: req } = await db.from("join_requests").select("*").eq("id", requestId).maybeSingle();
  if (!req?.conversation_id || req.status !== "pending" || !isGroupAdmin(await groupRole(req.conversation_id, me.userId))) return { ok: false, error: "Not found." };
  await db.from("join_requests").update({ status: approve ? "approved" : "declined", decided_by: me.userId }).eq("id", req.id);
  if (approve) {
    if ((await memberCount(req.conversation_id)) >= MAX_GROUP_PEOPLE) return { ok: false, error: "The group is full." };
    await db.from("conversation_members").upsert({ conversation_id: req.conversation_id, user_id: req.user_id, role: "member" }, { onConflict: "conversation_id,user_id", ignoreDuplicates: true });
    const them = await getAgentForUser(req.user_id);
    await note(req.conversation_id, `${me.agent.display_name} let ${them?.display_name ?? "someone"} in.`);
  }
  return { ok: true };
}

/** "X wants to add you to a group" (you chose: nobody can add me directly). */
export async function answerGroupInvite(itemId: string, me: Me, accept: boolean): Promise<Result<{ id?: string }>> {
  const db = adminClient();
  const { data: item } = await db.from("inbox_items").select("*").eq("id", itemId).maybeSingle();
  if (!item || item.owner_id !== me.userId || item.kind !== "group_invite" || item.status !== "open") return { ok: false, error: "This invite is no longer open." };
  const payload = item.payload as { conversation_id: string };
  await db.from("inbox_items").update({ status: accept ? "answered" : "declined", answered_at: new Date().toISOString() }).eq("id", item.id);
  if (!accept) return { ok: true };
  const group = await loadGroup(payload.conversation_id);
  if (!group) return { ok: false, error: "This group no longer exists." };
  if ((await memberCount(group.id)) >= MAX_GROUP_PEOPLE) return { ok: false, error: "This group is full." };
  await db.from("conversation_members").upsert({ conversation_id: group.id, user_id: me.userId, role: "member" }, { onConflict: "conversation_id,user_id", ignoreDuplicates: true });
  await note(group.id, `${me.agent.display_name} joined.`);
  return { ok: true, id: group.id };
}

