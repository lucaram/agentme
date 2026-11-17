"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { requireBusinessPermission } from "@/lib/business/access";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { publicationWarning, staffControls } from "@/lib/business/staff-controls";
import { env } from "@/lib/env";
import { getOrCreateMyAgentConversation } from "@/lib/data/chat";

type Result = { error?: string; link?: string };
export type StaffSearchHit = { id: string; name: string; handle: string; avatar: string };
export async function searchBusinessStaff(query: string): Promise<{ hits: StaffSearchHit[]; error?: string }> {
  await requireBusinessPermission("staff");
  if (typeof query !== "string" || query.trim().length > 60 || query.trim().replace(/^@/, "").length < 2) return { hits: [] };
  const { data, error } = await (await createClient()).rpc("search_business_staff", { p_query: query.trim() });
  return error ? { hits: [], error: "Couldn't search. Please try again." } : { hits: data ?? [] };
}
const update = () => { revalidatePath("/business"); revalidatePath("/chats", "layout"); };
export async function inviteBusinessStaff(target: string, role: string, existing?: string): Promise<Result> {
  await requireBusinessPermission("staff");
  const parsed = z.object({ target: z.string().trim().max(60), role: z.enum(["manager", "staff"]), existing: z.uuid().optional() }).refine((value) => Boolean(value.existing) || /^@[a-z0-9_]{3,20}$/i.test(value.target)).safeParse({ target, role, existing });
  if (!parsed.success) return { error: "Select a person and choose a role." };
  const token = randomBytes(32).toString("base64url"); const digest = createHash("sha256").update(token).digest("hex");
  const { error } = await (await createClient()).rpc("issue_business_invite", { p_target: parsed.data.target, p_role: parsed.data.role, p_digest: digest, p_existing: existing ?? null });
  if (error) return { error: error.message };
  update(); return { link: `${env.appUrl}/staff-invite/${token}` };
}
export async function cancelBusinessStaffInvite(id: string): Promise<Result> {
  await requireBusinessPermission("staff"); if (!z.uuid().safeParse(id).success) return { error: "Invitation unavailable." };
  const { error } = await (await createClient()).rpc("cancel_business_invite", { p_invite: id }); update(); return error ? { error: error.message } : {};
}
export async function changeBusinessStaff(id: string, role: string, transfer = false): Promise<Result> {
  await requireBusinessPermission("staff");
  if (!z.uuid().safeParse(id).success || !["owner", "manager", "staff", "remove"].includes(role)) return { error: "Choose a valid person and role." };
  const { error } = await (await createClient()).rpc("change_business_member", { p_user: id, p_role: role, p_transfer: transfer }); update(); return error ? { error: error.message } : {};
}
export async function saveBusinessStaffControls(id: string, requireAssignment: boolean, requirePublicationApproval: boolean): Promise<Result> {
  await requireBusinessPermission("staff");
  const parsed = z.object({ id: z.uuid(), requireAssignment: z.boolean(), requirePublicationApproval: z.boolean() }).safeParse({ id, requireAssignment, requirePublicationApproval });
  if (!parsed.success) return { error: "Choose a Staff member and valid permission settings." };
  const { error } = await (await createClient()).rpc("set_business_staff_controls", { p_user: id, p_require_assignment: requireAssignment, p_require_publication_approval: requirePublicationApproval });
  update(); return error ? { error: error.message } : {};
}
export async function requestStaffTransfer(staffId: string, supervisorId: string): Promise<Result> {
  await requireBusinessPermission("staff");
  if (!z.uuid().safeParse(staffId).success || !z.uuid().safeParse(supervisorId).success) return { error: "Choose a Staff member and receiving supervisor." };
  const { error } = await (await createClient()).rpc("request_business_staff_transfer", { p_staff: staffId, p_target: supervisorId }); update(); return error ? { error: error.message } : {};
}
export async function respondStaffTransfer(id: string, decision: string): Promise<Result> {
  await requireBusinessPermission("read");
  if (!z.uuid().safeParse(id).success || !["accept", "decline", "cancel"].includes(decision)) return { error: "Choose a valid transfer action." };
  const { error } = await (await createClient()).rpc("respond_business_staff_transfer", { p_transfer: id, p_decision: decision }); update(); return error ? { error: error.message } : {};
}
export async function saveDefaultReceivingOwner(id: string): Promise<Result> {
  await requireBusinessPermission("ownership"); if (!z.uuid().safeParse(id).success) return { error: "Choose an Owner." };
  const { error } = await (await createClient()).rpc("set_business_default_owner", { p_owner: id }); update(); return error ? { error: error.message } : {};
}
export async function acknowledgeBusinessWorkNotice(id: string): Promise<Result> {
  await requireBusinessPermission("read"); if (!z.uuid().safeParse(id).success) return { error: "Update unavailable." };
  const { error } = await (await createClient()).rpc("acknowledge_business_work_notice", { p_notice: id }); update(); return error ? { error: error.message } : {};
}
export async function respondBusinessStaffInvite(id: string, accept: boolean): Promise<Result> {
  await requireAgent(); if (!z.uuid().safeParse(id).success) return { error: "Invitation unavailable." };
  const { data, error } = await (await createClient()).rpc("respond_business_invite", { p_invite: id, p_accept: accept });
  if (error) return { error: error.message };
  if (accept && data) { const { data: business } = await adminClient().from("agents").select("owner_id").eq("id", data).single(); if (business) await getOrCreateMyAgentConversation(business.owner_id); }
  update(); return {};
}
export async function claimBusinessQuestion(id: string, assignee?: string | null, release = false): Promise<Result> {
  await requireBusinessPermission("respond");
  if (!z.uuid().safeParse(id).success || assignee && !z.uuid().safeParse(assignee).success) return { error: "Question unavailable." };
  const { error } = await (await createClient()).rpc("claim_business_question", { p_item: id, p_assignee: assignee ?? null, p_release: release }); update(); return error ? { error: error.message } : {};
}
export async function suggestBusinessAnswer(question: string, answer: string): Promise<Result & { published?: boolean }> {
  const { user, agent } = await requireBusinessPermission("draft");
  const parsed = z.object({ question: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(1000) }).safeParse({ question, answer });
  if (!parsed.success) return { error: "Write a question (up to 300 characters) and answer (up to 1,000)." };
  if (user.businessRole === "staff" && !(await staffControls(user, agent)).require_publication_approval) {
    const warning = await publicationWarning(user, agent, parsed.data.question, parsed.data.answer); if (warning) return { error: warning };
    const result = await adminClient().rpc("publish_staff_business_answer", { p_business: agent.id, p_actor: user.actorId ?? user.id, p_question: parsed.data.question, p_answer: parsed.data.answer });
    update(); return result.error ? { error: result.error.message } : { published: true };
  }
  const { error } = await (await createClient()).rpc("suggest_business_answer", { p_question: parsed.data.question, p_answer: parsed.data.answer }); update(); return error ? { error: error.message } : {};
}
export async function reviewBusinessAnswer(id: string, approve: boolean, question: string, answer: string): Promise<Result> {
  const { user, agent } = await requireBusinessPermission("configure");
  const parsed = z.object({ id: z.uuid(), approve: z.boolean(), question: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(1000) }).safeParse({ id, approve, question, answer });
  if (!parsed.success) return { error: "Check the question and answer." };
  const { data: draft } = await (await createClient()).from("business_answer_drafts").select("id").eq("id", id).eq("business_agent_id", agent.id).eq("status", "pending").maybeSingle();
  if (!draft) return { error: "This suggestion is no longer available." };
  if (approve) { const warning = await publicationWarning(user, agent, parsed.data.question, parsed.data.answer); if (warning) { update(); return { error: warning }; } }
  const { error } = await adminClient().rpc("review_business_answer_as", { p_business: agent.id, p_actor: user.actorId ?? user.id, p_draft: id, p_approve: approve, p_question: parsed.data.question, p_answer: parsed.data.answer }); update(); return error ? { error: error.message } : {};
}
