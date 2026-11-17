import "server-only";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth";
import type { AgentRow } from "@/lib/data/agents";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { answerInboxItem, declineInboxItem } from "@/lib/plans/inbox";
import { withBusinessActor } from "./actor-context";
import { withUsageContext } from "@/lib/usage/context";
import { after } from "next/server";
import { runTask } from "@/lib/plans/engine";
import { publicationWarning, staffControls } from "./staff-controls";

/** Atomic claim/lease before delivery; a second staff member cannot also send. */
export async function handleBusinessInbox(user: SessionUser, agent: AgentRow, id: string, answers: Record<string, string>, remember: boolean, decline: boolean): Promise<{ error?: string }> {
  if (!z.uuid().safeParse(id).success) return { error: "Question unavailable." };
  if (!decline && !z.string().trim().min(1).max(1000).safeParse(answers.answer).success) return { error: "Write an answer of up to 1,000 characters." };
  const client = await createClient(); const db = adminClient();
  const { data: ticket, error } = await client.rpc("reserve_business_answer", { p_item: id }); if (error || !ticket) return { error: error?.message ?? "Question unavailable." };
  const actor = user.actorId ?? user.id;
  let publishedToQA = false;
  try {
    if (!decline && remember && user.businessRole === "staff") {
      const { data: item } = await db.from("inbox_items").select("payload").eq("id", id).eq("owner_id", user.id).single();
      const payload = item?.payload as { question?: string; faq_eligible?: boolean } | undefined;
      if (!payload?.faq_eligible || !payload.question) return { error: "This request cannot be published as a general FAQ. Clear the Q&A checkbox to send a private customer reply. Nothing has been sent." };
      const question = payload.question.trim().slice(0, 300); const answer = answers.answer.trim();
      const controls = await staffControls(user, agent);
      if (controls.require_publication_approval) {
        const draft = await client.rpc("suggest_business_answer", { p_question: question, p_answer: answer }); if (draft.error) return { error: "Couldn't submit the suggested answer. Nothing has been sent; please try again." };
      } else {
        const warning = await publicationWarning(user, agent, question, answer);
        if (warning) return { error: `${warning} Your customer reply has not been sent. Edit it, or clear the Q&A checkbox to send without publishing.` };
        const published = await db.rpc("publish_staff_business_answer", { p_business: agent.id, p_actor: actor, p_question: question, p_answer: answer, p_inbox: id, p_ticket: ticket });
        if (published.error) return { error: `${published.error.message}. Your customer reply has not been sent.` };
        publishedToQA = true;
      }
    }
    const result = await withBusinessActor(user, agent, () => withUsageContext({ userId: user.id, agentId: agent.id }, () => decline ? declineInboxItem(id, user.id) : answerInboxItem(id, user.id, answers, remember && user.businessRole !== "staff")));
    if (!result.ok) return { error: publishedToQA ? `The FAQ was published, but the customer reply was not sent: ${result.error} Retry sending; the FAQ will not be added twice.` : result.error };
    if (result.wake) { const wake = result.wake; after(() => runTask(wake)); }
    await db.from("business_question_claims").update({ handled_by: actor, handled_at: new Date().toISOString() }).eq("inbox_id", id).eq("processing_token", ticket);
    const { data: person } = await db.from("agents").select("display_name").eq("owner_id", actor).maybeSingle();
    await db.from("business_staff_audit").insert({ business_agent_id: agent.id, actor_id: actor, actor_name: person?.display_name ?? "Team member", subject_name: "Customer request", action: decline ? "Question declined" : "Question answered" });
    return {};
  } catch { return { error: publishedToQA ? "The FAQ was published, but the customer reply could not be sent. Retry sending; the FAQ will not be added twice." : "Couldn't finish sending. Your draft is still here; please try again." }; }
  finally { await db.from("business_question_claims").update({ processing_token: null, processing_until: null }).eq("inbox_id", id).eq("processing_token", ticket); }
}
