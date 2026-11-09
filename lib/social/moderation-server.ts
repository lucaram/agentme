import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { llm } from "@/lib/llm";
import { MODERATION_SYSTEM, wrapUntrusted } from "@/lib/agents/prompts";
import { agreesWithReports, decide, ModerationSchema, THRESHOLDS, type Decision, type Moderation } from "./moderation";
import type { TrustLevel } from "./guard";

type Event = {
  communityId: string;
  conversationId: string;
  messageId?: string | null;
  userId: string | null;
  action: "refused" | "nudged" | "posted_after_nudge" | "hidden_after_reports";
  m: Moderation;
  text: string;
};

async function logEvent(e: Event) {
  await adminClient().from("moderation_events").insert({
    community_id: e.communityId,
    conversation_id: e.conversationId,
    message_id: e.messageId ?? null,
    user_id: e.userId,
    action: e.action,
    verdict: e.m.verdict,
    confidence: e.m.confidence,
    reason: e.m.reason.slice(0, 200),
    excerpt: e.text.slice(0, 500),
  });
}

/** The AI check of one message against the community's own description and rules. Fails open (posts) if the check is unavailable. */
export async function checkAgainstRules(communityId: string, text: string): Promise<Moderation | null> {
  const { data: community } = await adminClient().from("communities").select("name, description, rules").eq("id", communityId).maybeSingle();
  if (!community) return null;
  try {
    return await llm().generateObject({
      purpose: "moderation",
      tier: "fast",
      system: MODERATION_SYSTEM,
      messages: [
        {
          role: "user",
          content: `<community>\nName: ${community.name}\nAbout: ${community.description ?? ""}\nRules:\n${community.rules ?? "Be respectful. No spam or selling. Stay on topic."}\n</community>\n\n${wrapUntrusted("untrusted_message", text.slice(0, 2000))}`,
        },
      ],
      schema: ModerationSchema,
      maxTokens: 300,
      mockContext: { text },
    });
  } catch (error) {
    console.error("moderation check unavailable", error instanceof Error ? error.message : error);
    return null;
  }
}

export type AutopilotOutcome = Decision & { flags: string[] };

/**
 * Before a community message is posted: trusted members and moderators skip
 * the AI check (most trouble comes from new accounts, and it saves cost).
 * `confirmed`: the author chose "Post anyway" after a nudge.
 */
export async function autopilot(opts: { communityId: string; conversationId: string; userId: string; text: string; level: TrustLevel; confirmed: boolean }): Promise<AutopilotOutcome> {
  if (opts.level === "trusted" || opts.level === "moderator") return { action: "post", flags: [] };
  const m = await checkAgainstRules(opts.communityId, opts.text);
  if (!m) return { action: "post", flags: [] };
  const decision = decide(m);
  const base = { communityId: opts.communityId, conversationId: opts.conversationId, userId: opts.userId, m, text: opts.text };
  if (decision.action === "refuse") {
    await logEvent({ ...base, action: "refused" });
    return { ...decision, flags: [] };
  }
  if (decision.action === "nudge") {
    if (!opts.confirmed) {
      await logEvent({ ...base, action: "nudged" });
      return { ...decision, flags: [] };
    }
    // Their choice: posted, and moderators see why it was nudged.
    await logEvent({ ...base, action: "posted_after_nudge" });
    return { action: "post", flags: [m.verdict] };
  }
  return { action: "post", flags: [] };
}

/**
 * Members' reports with AI agreement: once enough different members report a
 * community message AND the check agrees it breaks a rule, it's hidden
 * automatically (no moderator needed). One person alone can't silence anyone.
 */
export async function hideIfReportsAgree(messageId: string): Promise<boolean> {
  const db = adminClient();
  const { data: msg } = await db.from("messages").select("id, conversation_id, content, sender_user_id, removed_at").eq("id", messageId).maybeSingle();
  if (!msg || msg.removed_at) return false;
  const { data: conv } = await db.from("conversations").select("kind, community_id").eq("id", msg.conversation_id).single();
  if (conv?.kind !== "channel" || !conv.community_id) return false;
  const { data: reports } = await db.from("reports").select("reporter_id").eq("message_id", messageId).eq("status", "open");
  const reporters = new Set((reports ?? []).map((r) => r.reporter_id).filter((r) => r && r !== msg.sender_user_id));
  if (reporters.size < THRESHOLDS.reportsNeeded) return false;
  const m = await checkAgainstRules(conv.community_id, msg.content);
  if (!m || !agreesWithReports(m)) return false;
  await db
    .from("messages")
    .update({ content: "🤖 Message hidden automatically: several members reported it and it breaks the community's rules.", removed_at: new Date().toISOString() })
    .eq("id", messageId)
    .is("removed_at", null);
  await db.from("reports").update({ status: "resolved" }).eq("message_id", messageId).eq("status", "open");
  await logEvent({ communityId: conv.community_id, conversationId: msg.conversation_id, messageId, userId: msg.sender_user_id, action: "hidden_after_reports", m, text: msg.content });
  return true;
}
