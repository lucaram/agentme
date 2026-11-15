"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ReportInput, ReviewInput, MessageReportInput, Versions, ReportingHistoryEntry } from "@/lib/moderation/types";
import { blockGroup } from "@/lib/social/groups";
import { leaveCommunity } from "@/lib/social/communities";
import { reportMessage } from "@/lib/social/shared";

export async function submitPlatformReport(input: z.infer<typeof ReportInput>, leave = false): Promise<{ error?: string; id?: string; duplicate?: boolean; left?: boolean }> {
  const { user, agent } = await requireAgent(); const parsed = ReportInput.safeParse(input);
  if (!parsed.success) return { error: "Add a reason and select up to five shared messages." };
  const value = parsed.data;
  const db = await createClient();
  const { data, error } = await db.rpc("submit_platform_report", { p_kind: value.kind, p_target: value.target, p_category: value.category, p_reason: value.reason, p_evidence: value.evidence, p_versions: value.versions });
  if (error) return { error: error.message.includes("already reported") ? "You already reported this space today. You can track it in Your reports." : error.message.includes("evidence") ? "Some selected messages are no longer available. Remove or reselect the evidence and try again." : "Couldn't submit this report. You must belong to the space. You can submit up to five reports a day." };
  const result = z.object({ id: z.uuid(), duplicate: z.boolean() }).safeParse(data); if (!result.success) return { error: "Couldn't submit this report. Try again." };
  let left = false;
  if (leave && value.kind !== "message") {
    const outcome = value.kind === "group" ? await blockGroup(value.target, { userId: user.id, agent }) : await leaveCommunity(value.target, { userId: user.id, agent });
    left = outcome.ok;
  }
  revalidatePath("/chats", "layout"); revalidatePath("/reports");
  return { ...result.data, left };
}

export async function submitMessageReport(input: z.infer<typeof MessageReportInput>): Promise<{ error?: string; id?: string }> {
  const { user } = await requireAgent(); const parsed = MessageReportInput.safeParse(input);
  if (!parsed.success) return { error: "Choose a destination, add a reason and include the reported message." };
  const value = parsed.data;
  if (value.destination === "platform") return submitPlatformReport(value);
  const result = await reportMessage(value.target, user.id, value.reason, { category: value.category, evidence: value.evidence, versions: value.versions });
  if (!result.ok) return { error: result.error };
  revalidatePath("/chats", "layout"); revalidatePath("/groups", "layout"); revalidatePath("/communities", "layout");
  return {};
}

export async function requestReportEvidence(report: string, revision: number, question: string): Promise<{ error?: string }> {
  await requireAgent(); const parsed = z.object({ report: z.uuid(), revision: z.number().int().positive(), question: z.string().trim().min(5).max(500) }).safeParse({ report, revision, question });
  if (!parsed.success) return { error: "Add a question between 5 and 500 characters." };
  const { error } = await (await createClient()).rpc("request_report_evidence", { p_report: parsed.data.report, p_revision: revision, p_question: parsed.data.question });
  if (error) return { error: "Couldn't request evidence. Check your access and refresh this case." };
  revalidatePath("/moderation", "layout"); revalidatePath("/reports", "layout"); revalidatePath("/chats", "layout"); return {};
}

export async function answerReportEvidence(input: { request: string; reply: string; evidence: string[]; versions: Record<string, string> }): Promise<{ error?: string }> {
  await requireAgent(); const parsed = z.object({ request: z.uuid(), reply: z.string().trim().min(1).max(2000), evidence: z.array(z.uuid()).max(5), versions: Versions }).safeParse(input);
  if (!parsed.success) return { error: "Add an explanation and select up to five messages." };
  const value = parsed.data; const { error } = await (await createClient()).rpc("answer_report_evidence", { p_request: value.request, p_reply: value.reply, p_evidence: value.evidence, p_versions: value.versions });
  if (error) return { error: error.message.includes("evidence") ? "The evidence is no longer available or changed. Review your selection, or reply without attachments." : "Couldn't send this reply. Check that the request is still open." };
  revalidatePath("/reports", "layout"); revalidatePath("/moderation", "layout"); revalidatePath("/chats", "layout"); return {};
}

export async function reviewPlatformCase(input: ReviewInput): Promise<{ error?: string }> {
  await requireAgent(); const parsed = ReviewInput.safeParse(input); if (!parsed.success) return { error: "Add a short public decision and keep internal notes under 2,000 characters." };
  const value = parsed.data;
  const { error } = await (await createClient()).rpc("review_platform_case", { p_case: value.id, p_revision: value.revision, p_action: value.action, p_response: value.response, p_note: value.note, p_subject: value.subject, p_evidence: value.evidence });
  if (error) return { error: error.message.includes("supporting evidence") ? "Select evidence authored by the account you are restricting." : error.message.includes("staff account") ? "This staff account requires an independent operator review." : "Couldn't apply this decision. Check your access and refresh: another reviewer may have updated the case." };
  revalidatePath("/moderation", "layout"); revalidatePath("/chats", "layout"); revalidatePath("/groups", "layout"); revalidatePath("/communities", "layout"); revalidatePath("/reports", "layout");
  return {};
}

export async function reportingHistory(caseId: string, subject: string, page = 0): Promise<{ rows?: ReportingHistoryEntry[]; error?: string }> {
  await requireAgent(); if (!z.uuid().safeParse(caseId).success || !z.uuid().safeParse(subject).success || !Number.isInteger(page) || page < 0 || page > 400) return { error: "Invalid account history request." };
  const { data, error } = await (await createClient()).rpc("platform_reporting_history", { p_case: caseId, p_subject: subject, p_offset: page * 25 });
  const parsed = z.array(ReportingHistoryEntry).safeParse(data); if (error || !parsed.success) return { error: "Couldn't load reporting history. Check your access and try again." }; return { rows: parsed.data };
}
export async function liftAccountRestriction(id: string, reason: string): Promise<{ error?: string }> {
  await requireAgent(); const parsed = z.object({ id: z.uuid(), reason: z.string().trim().min(5).max(500) }).safeParse({ id, reason }); if (!parsed.success) return { error: "Add a justification between 5 and 500 characters." };
  const { error } = await (await createClient()).rpc("lift_account_restriction", { p_sanction: id, p_reason: parsed.data.reason }); if (error) return { error: "Couldn't lift this restriction. Check your access and refresh the case." };
  revalidatePath("/moderation", "layout"); revalidatePath("/account-status"); revalidatePath("/chats", "layout"); revalidatePath("/reports", "layout"); return {};
}
export async function reviewAccountAppeal(id: string, accept: boolean, response: string): Promise<{ error?: string }> {
  await requireAgent(); const parsed = z.object({ id: z.uuid(), accept: z.boolean(), response: z.string().trim().min(5).max(500) }).safeParse({ id, accept, response }); if (!parsed.success) return { error: "Add a justification between 5 and 500 characters." };
  const { error } = await (await createClient()).rpc("review_account_appeal", { p_appeal: id, p_accept: accept, p_response: parsed.data.response }); if (error) return { error: "An independent reviewer must handle this appeal. Check your access and refresh." };
  revalidatePath("/moderation", "layout"); revalidatePath("/account-status"); revalidatePath("/chats", "layout"); revalidatePath("/reports", "layout"); return {};
}

export async function openPlatformUpdate(id: string, follow = true): Promise<void> {
  await requireAgent(); if (!z.uuid().safeParse(id).success) return;
  const db = await createClient(); const { data } = await db.from("platform_notifications").select("id,link").eq("id", id).maybeSingle(); if (!data) return;
  await db.rpc("ack_platform_notifications", { p_ids: [id] }); revalidatePath("/chats", "layout");
  if (follow && (/^\/(reports|groups|communities)\/[0-9a-f-]{36}$/.test(data.link) || data.link === "/moderation" || data.link === "/settings" || data.link === "/account-status")) redirect(data.link);
}
