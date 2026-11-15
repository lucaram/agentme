import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { getConversation, postMessage } from "@/lib/data/chat";
import { createGroup } from "@/lib/social/groups";
import type { AgentRow } from "@/lib/data/agents";
import { RichSchema, mapsUrl, MAX_MESSAGE_BYTES } from "./rich";
import { resolveThread } from "@/lib/agents/threads";
import { resolveReply } from "@/lib/social/quote-server";
import { guardCommunityPost } from "@/lib/social/guard-server";
import { autopilot } from "@/lib/social/moderation-server";
import { communityMembership, isModerator } from "@/lib/social/shared";
import { hit } from "@/lib/limits";
import { summonsAgent } from "@/lib/agents/commands";
import { asJson } from "@/lib/data/json";
import { recordAgentReceipt } from "./receipts-server";

type Conv = NonNullable<Awaited<ReturnType<typeof getConversation>>>;
export async function pollPeople(conv: Conv, agent: AgentRow) {
  const db = adminClient();
  if (conv.kind === "agent_chat") return [];
  if (conv.kind === "my_agent") {
    const { data } = await db.from("contacts").select("requester_agent,addressee_agent").eq("status", "accepted").or(`requester_agent.eq.${agent.id},addressee_agent.eq.${agent.id}`);
    const ids = (data ?? []).map((c) => c.requester_agent === agent.id ? c.addressee_agent : c.requester_agent);
    return ids.length ? (await db.from("agents").select("id,owner_id,handle,display_name").in("id", ids).eq("type", "personal")).data ?? [] : [];
  }
  const { data: members } = await db.from("conversation_members").select("user_id").eq("conversation_id", conv.id).limit(257);
  if (!members || members.length > 256) throw new Error("Polls support chats with up to 256 people.");
  return (await db.from("agents").select("id,owner_id,handle,display_name").in("owner_id", members.map((m) => m.user_id))).data ?? [];
}

export async function sendRichMessage({ conv, userId, agent, text, threadId, replyTo, confirmed, raw }: { conv: Conv; userId: string; agent: AgentRow; text: string; threadId?: string | null; replyTo?: string | null; confirmed?: boolean; raw: unknown }): Promise<{ error?: string; threadId?: string; nudge?: { rule: string; message: string }; appealId?: string }> {
  const parsed = RichSchema.safeParse(raw);
  if (!parsed.success) return { error: "Check your attachments, location or poll." };
  const rich = parsed.data; const db = adminClient();
  const { data: existing } = await db.from("messages").select("thread_id").eq("conversation_id", conv.id).eq("sender_user_id", userId).eq("metadata->>client_id", rich.clientId).maybeSingle();
  if (existing) return existing.thread_id ? { threadId: existing.thread_id } : {};
  if (!(await hit("richMessagesPerUser", userId)).allowed) return { error: "You're sending too quickly. Try again in a minute." };
  if (summonsAgent(text) && conv.kind !== "my_agent" && conv.kind !== "agent_chat") return { error: "Send attachments to this chat, or ask @agent in a separate message. Nothing has been shared." };
  if (rich.poll && (rich.attachments.length || rich.location)) return { error: "Send the poll separately from files and location." };
  const { data: files, error } = rich.attachments.length ? await db.from("chat_attachments").select("id,name,kind,bytes").in("id", rich.attachments).eq("conversation_id", conv.id).eq("uploader_id", userId).is("message_id", null) : { data: [], error: null };
  if (error || files?.length !== rich.attachments.length) return { error: "An attachment is missing or already sent. Remove it and attach it again." };
  if ((files ?? []).reduce((total, file) => total + file.bytes, 0) > MAX_MESSAGE_BYTES) return { error: "Keep attachments below 32 MB in one message." };
  const description = [text, rich.poll?.question, ...(rich.poll?.options ?? []), ...(files ?? []).map((f) => `${f.kind}: ${f.name}`), rich.location ? mapsUrl(rich.location) : ""].filter(Boolean).join("\n");
  if (!description) return { error: "Add something to send." };
  let flags: string[] = [];
  if (conv.kind === "channel" && conv.community_id) {
    const { data: community } = await db.from("communities").select("house_rules").eq("id", conv.community_id).single();
    if (community?.house_rules?.includes("no_media") && files?.some((f) => f.kind === "image" || f.kind === "video") && !isModerator((await communityMembership(conv.community_id, userId))?.role)) return { error: "This community doesn't allow images or videos." };
    const guard = await guardCommunityPost(conv.community_id, userId, description, { resend: Boolean(confirmed) });
    if (!guard.ok) return { error: guard.error };
    const auto = await autopilot({ communityId: conv.community_id, conversationId: conv.id, userId, text: description, level: guard.level, confirmed: Boolean(confirmed) });
    if (auto.action === "refuse") return { error: auto.message, ...(auto.eventId ? { appealId: auto.eventId } : {}) };
    if (auto.action === "nudge") return { nudge: { rule: auto.rule, message: auto.message } };
    flags = [...new Set([...guard.flags, ...auto.flags])];
  }
  const thread = conv.kind === "my_agent" ? await resolveThread({ userId, conversationId: conv.id, threadId, text: description }) : null;
  const reply = await resolveReply(conv.id, replyTo, userId);
  if (rich.poll) {
    const people = await pollPeople(conv, agent);
    const selected = conv.kind === "my_agent" ? people.filter((p) => rich.poll!.people.includes(p.id)) : people.filter((p) => p.id !== agent.id);
    if (!selected.length || (conv.kind === "my_agent" && selected.length !== rich.poll.people.length)) return { error: "Choose people from your contacts for this poll." };
    let createdGroup: string | null = null;
    try {
      let groupId = conv.id;
      if (conv.kind === "my_agent") {
        const group = await createGroup({ userId, agent }, { title: rich.poll.question, description: "", avatar: "📊", memberAgentIds: selected.map((p) => p.id) });
        if (!group.ok) return { error: group.error };
        createdGroup = group.id; groupId = group.id;
      }
      // For polls made in a chat, the progress/result origin is that chat too.
      const { data: pollMessage, error: pollError } = await db.rpc("create_chat_poll", { p_owner: userId, p_agent: agent.id, p_origin: conv.id, p_group: groupId, p_thread: thread, p_client: rich.clientId, p_question: rich.poll.question, p_options: asJson(rich.poll.options), p_voters: asJson([agent.handle, ...selected.map((p) => p.handle)]), p_caption: text || null, p_reply: reply?.id ?? null });
      if (pollError) { console.error("Direct poll creation failed", pollError.code, pollError.message); throw pollError; }
      if (pollMessage && conv.kind === "my_agent") await recordAgentReceipt(pollMessage, agent.id);
    } catch {
      if (createdGroup) { await db.from("inbox_items").delete().eq("kind", "group_invite").eq("payload->>conversation_id", createdGroup).eq("status", "open"); await db.from("conversations").delete().eq("id", createdGroup); }
      return { error: "Couldn't send the poll. Your draft is still here." };
    }
  } else {
    await postMessage({ conversationId: conv.id, from: "human", userId, content: text || (rich.location ? "📍 Shared location" : files!.map((f) => f.kind === "audio" ? "🎙️ Voice message" : f.name).join(", ")), threadId: thread ?? undefined, replyTo: reply?.id, metadata: { kind: "rich_message", client_id: rich.clientId, attachment_ids: rich.attachments, ...(rich.location ? { shared_location: rich.location } : {}), ...(flags.length ? { flags } : {}) } });
  }
  return thread ? { threadId: thread } : {};
}
