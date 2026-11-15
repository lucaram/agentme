import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, dbUp, SUPABASE_URL } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import * as groups from "@/lib/social/groups";
import * as communities from "@/lib/social/communities";
import { createJoinLink } from "@/lib/social/shared";
import { ensurePlanGroup } from "@/lib/plans/group";
import { handleAgentCommand } from "@/lib/agents/in-chat";
import { resolveReply } from "@/lib/social/quote-server";
import type { Database } from "@/lib/database.types";
import type { TaskRow } from "@/lib/plans/types";

describe.skipIf(!dbUp)("group consent and history boundaries", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>; const communityIds: string[] = [];
  const clients: Record<string, ReturnType<typeof createClient<Database>>> = {};
  beforeAll(async () => {
    f = await planBusinessFixture();
    for (const [key, person] of Object.entries({ luca: f.luca, marco: f.marco, paul: f.paul, business: f.business })) {
      const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { error } = await client.auth.signInWithPassword({ email: person.email, password: f.password }); if (error) throw error; clients[key] = client;
    }
    expect((await f.db.from("contacts").insert([f.marco, f.paul].map((p) => ({ requester_agent: f.luca.agent.id, addressee_agent: p.agent.id, status: "accepted" as const })))).error).toBeNull();
  });
  afterAll(async () => { if (f) { if (communityIds.length) await f.db.from("communities").delete().in("id", communityIds); await f.cleanup(); } });
  const who = (p: typeof f.luca) => ({ userId: p.userId, agent: p.agent });
  async function make(target = f.marco) {
    const result = await groups.createGroup(who(f.luca), { title: "Consent test", description: "Dinner planning", avatar: "👥", memberAgentIds: [target.agent.id] }); if (!result.ok) throw new Error(result.error); return result.id;
  }
  async function invite(group: string, target = f.marco) {
    const { data, error } = await f.db.from("inbox_items").select("id").eq("kind", "group_invite").eq("owner_id", target.userId).eq("payload->>conversation_id", group).eq("status", "open").single(); if (error) throw error; return data!.id;
  }
  async function message(group: string, content: string, metadata = {}) {
    const { data, error } = await f.db.from("messages").insert({ conversation_id: group, sender_user_id: f.luca.userId, content, is_ai_generated: false, metadata }).select("id").single(); if (error) throw error; return data!.id;
  }
  it("defaults to invitations, deduplicates concurrent sends, and grants no group access before consent", async () => {
    expect((await f.db.from("agents").select("group_add_policy").eq("id", f.marco.agent.id).single()).data!.group_add_policy).toBe("nobody");
    const group = await make();
    await Promise.all([groups.addMembers(group, who(f.luca), [f.marco.agent.id]), groups.addMembers(group, who(f.luca), [f.marco.agent.id])]);
    expect((await f.db.from("inbox_items").select("id").eq("payload->>conversation_id", group).eq("status", "open")).data).toHaveLength(1);
    expect((await clients.marco.from("conversations").select("id").eq("id", group)).data).toEqual([]);
    expect((await clients.marco.rpc("chat_history_page", { p_conversation: group })).error).toBeTruthy();
    const item = await invite(group); const preview = await clients.marco.rpc("group_invite_previews", { p_ids: [item] }); expect(preview.error).toBeNull(); expect(preview.data).toEqual([expect.objectContaining({ id: item, members: 1, earlierHistory: false, description: "Dinner planning" })]);
    expect((await clients.business.rpc("group_invite_previews", { p_ids: [item] })).data).toEqual([]);
    expect((await clients.luca.rpc("answer_group_invitation", { p_item: item, p_decision: "join", p_actor: f.marco.userId })).error).toBeTruthy();
    expect((await clients.marco.rpc("invite_group_person", { p_group: group, p_inviter: f.luca.userId, p_agent: f.paul.agent.id })).error).toBeTruthy();
  });
  it("joining hides old chat, quotes, files, receipt payloads and agent context while sharing current activities", async () => {
    const group = await make(); const old = await message(group, "SECRET_BEFORE_JOIN");
    const card = await message(group, "Current shared plan", { kind: "proposal", proposal_id: crypto.randomUUID() });
    const file = crypto.randomUUID(); expect((await f.db.from("chat_attachments").insert({ id: file, conversation_id: group, uploader_id: f.luca.userId, message_id: old, path: `${f.luca.userId}/${file}.txt`, name: "old.txt", mime: "text/plain", kind: "document", bytes: 5 })).error).toBeNull();
    const result = await groups.answerGroupInvite(await invite(group), who(f.marco), true); expect(result).toMatchObject({ ok: true, id: group });
    const after = await message(group, "AFTER_JOIN");
    const visible = (await clients.marco.from("messages").select("id,content").eq("conversation_id", group)).data!;
    expect(visible.some((m) => m.id === old)).toBe(false); expect(visible.map((m) => m.id)).toEqual(expect.arrayContaining([card, after]));
    expect((await clients.marco.from("chat_attachments").select("id").eq("id", file)).data).toEqual([]);
    expect(await resolveReply(group, old, f.marco.userId)).toBeNull();
    expect((await clients.marco.rpc("set_message_reaction", { p_message: old, p_reaction: "heart" })).error).toBeTruthy();
    expect((await clients.marco.rpc("acknowledge_messages", { p_ids: [old], p_seen: true })).data).toEqual([]);
    expect((await clients.marco.rpc("pending_message_deliveries")).data?.some((m) => m.id === old)).toBe(false);
    const context = await f.db.rpc("read_member_context", { p_group: group, p_user: f.marco.userId }); expect(context.error).toBeNull(); expect(context.data?.some((m) => m.id === old)).toBe(false);
    expect((await clients.marco.rpc("read_member_context", { p_group: group, p_user: f.luca.userId })).error).toBeTruthy();
    expect((await clients.marco.rpc("can_read_chat_message", { p_message: old, p_user: f.luca.userId })).data).toBe(false);
    expect((await clients.luca.from("messages").select("id").eq("id", old)).data).toHaveLength(1);
    expect((await f.db.from("message_receipts").select("id").eq("message_id", old).eq("user_id", f.marco.userId)).data).toEqual([]);
    const rsvps = await f.db.from("step_responses").select("step_id").eq("agent_id", f.marco.agent.id).eq("step_id", f.stepId); expect(rsvps.error).toBeNull(); expect(rsvps.data).toHaveLength(1); // Joining did not write a new RSVP.
  });
  it("earlier history sharing is explicit for future joins and cannot be enabled by members", async () => {
    const group = await make(f.paul); const old = await message(group, "History explicitly shared");
    expect(await groups.updateGroupSettings(group, who(f.luca), { only_admins_send: false, only_admins_edit: true, approve_new_members: true, share_earlier_history: true })).toMatchObject({ ok: true });
    expect((await clients.paul.rpc("group_invite_previews", { p_ids: [await invite(group, f.paul)] })).data).toEqual([expect.objectContaining({ earlierHistory: true })]);
    expect(await groups.answerGroupInvite(await invite(group, f.paul), who(f.paul), true)).toMatchObject({ ok: true });
    expect((await clients.paul.from("messages").select("id").eq("id", old)).data).toHaveLength(1);
    expect((await clients.paul.from("conversation_members").update({ history_from: "-infinity" }).eq("conversation_id", group).eq("user_id", f.paul.userId).select("user_id")).data).toEqual([]);
    expect(await groups.updateGroupSettings(group, who(f.paul), { only_admins_send: false, only_admins_edit: true, approve_new_members: false, share_earlier_history: true })).toMatchObject({ ok: false });
  });
  it("declines quietly, blocks repeat invitations, expires old invitations and permits admin withdrawal only", async () => {
    const group = await make(); const item = await invite(group);
    expect((await clients.marco.rpc("cancel_group_invitation", { p_item: item })).error).toBeTruthy();
    const before = (await f.db.from("messages").select("id").eq("conversation_id", group)).data!.length;
    expect(await groups.answerGroupInvite(item, who(f.marco), false, true)).toMatchObject({ ok: true });
    expect((await f.db.from("messages").select("id").eq("conversation_id", group)).data).toHaveLength(before);
    expect(await groups.addMembers(group, who(f.luca), [f.marco.agent.id])).toMatchObject({ ok: true, invited: 0, skipped: 1 });
    const withdrawn = await make(); const cancel = await invite(withdrawn); expect((await clients.luca.rpc("cancel_group_invitation", { p_item: cancel })).error).toBeNull(); expect(await groups.answerGroupInvite(cancel, who(f.marco), true)).toMatchObject({ ok: false });
    const expired = await make(); const stale = await invite(expired); await f.db.from("inbox_items").update({ created_at: new Date(Date.now() - 8 * 86400000).toISOString() }).eq("id", stale);
    expect((await clients.marco.rpc("group_invite_previews", { p_ids: [stale] })).data).toEqual([]); expect(await groups.answerGroupInvite(stale, who(f.marco), true)).toMatchObject({ ok: false });
  });
  it("uses invitations for agent-created groups; direct contact adds require explicit opt-in", async () => {
    const { data: task } = await f.db.from("tasks").insert({ owner_id: f.luca.userId, initiator_agent: f.luca.agent.id, conversation_id: f.myAgent, goal: "An invited plan", status: "running", parsed: { participants: [f.marco.agent.handle] } }).select("*").single();
    const group = await ensurePlanGroup(task as TaskRow, [f.marco.agent.handle], "An invited plan");
    expect((await f.db.from("conversation_members").select("user_id").eq("conversation_id", group.id)).data).toEqual([expect.objectContaining({ user_id: f.luca.userId })]);
    expect(await invite(group.id)).toBeTruthy();
    await expect(handleAgentCommand({ userId: f.marco.userId, agent: f.marco.agent, conversation: { id: group.id, kind: "group", title: "Private group" }, text: "@agent summarise" })).rejects.toThrow(/belong/);
    const { data: rsvp } = await f.db.from("plan_steps").insert({ task_id: task!.id, type: "rsvp", position: 0, config: {}, status: "waiting" }).select("id").single();
    expect(await groups.answerGroupInvite(await invite(group.id), who(f.marco), true)).toMatchObject({ ok: true });
    const responses = await f.db.from("step_responses").select("step_id").eq("step_id", rsvp!.id).eq("agent_id", f.marco.agent.id); expect(responses.error).toBeNull(); expect(responses.data).toEqual([]);
    await f.db.from("agents").update({ group_add_policy: "contacts" }).eq("id", f.paul.agent.id); const direct = await make(f.paul);
    expect((await f.db.from("conversation_members").select("user_id").eq("conversation_id", direct).eq("user_id", f.paul.userId)).data).toHaveLength(1);
    await f.db.from("agents").update({ group_add_policy: "nobody" }).eq("id", f.paul.agent.id);
  });
  it("joining once through an invitation link resolves an earlier pending invitation", async () => {
    const group = await make(); const item = await invite(group);
    expect(await groups.updateGroupSettings(group, who(f.luca), { only_admins_send: false, only_admins_edit: true, approve_new_members: false })).toMatchObject({ ok: true });
    const url = await createJoinLink({ conversationId: group }, f.luca.userId);
    expect(await groups.joinGroupWithLink(url.split("/").at(-1)!, who(f.marco))).toMatchObject({ ok: true, status: "joined" });
    expect((await f.db.from("inbox_items").select("status").eq("id", item).single()).data!.status).toBe("answered");
    expect((await clients.marco.rpc("open_group_invitation", { p_item: item })).data).toBe(false);
  });
  it("keeps explicit community joining and adds moderator approval for private links, including ban checks", async () => {
    const made = await communities.createCommunity(who(f.luca), { name: `Consent ${crypto.randomUUID().slice(0, 8)}`, description: "Community for testing explicit membership approval", avatar: "💬", visibility: "private", approveLinkMembers: true }); if (!made.ok) throw new Error(made.error); communityIds.push(made.id);
    const link = await createJoinLink({ communityId: made.id }, f.luca.userId); const token = link.split("/").at(-1)!;
    expect(await communities.joinCommunity(made.id, who(f.marco), { acceptRules: false, viaLink: token })).toMatchObject({ ok: false });
    expect(await communities.joinCommunity(made.id, who(f.marco), { acceptRules: true, viaLink: token })).toMatchObject({ ok: true, status: "requested" });
    expect((await f.db.from("community_members").select("user_id").eq("community_id", made.id).eq("user_id", f.marco.userId)).data).toEqual([]);
    const request = (await f.db.from("join_requests").select("id").eq("community_id", made.id).eq("user_id", f.marco.userId).single()).data!.id;
    expect(await communities.decideCommunityRequest(request, who(f.luca), true)).toMatchObject({ ok: true });
    expect(await communities.joinCommunity(made.id, who(f.business), { acceptRules: true, viaLink: token })).toMatchObject({ ok: false });
    expect(await communities.joinCommunity(made.id, who(f.paul), { acceptRules: true, viaLink: token })).toMatchObject({ status: "requested" });
    await f.db.from("community_bans").insert({ community_id: made.id, user_id: f.paul.userId, banned_by: f.luca.userId });
    const bannedRequest = (await f.db.from("join_requests").select("id").eq("community_id", made.id).eq("user_id", f.paul.userId).single()).data!.id;
    expect(await communities.decideCommunityRequest(bannedRequest, who(f.luca), true)).toMatchObject({ ok: false });
  });
});
