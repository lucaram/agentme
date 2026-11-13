import "server-only";
import { canPost, type ConvRow } from "@/lib/social/shared";
import { adminClient } from "@/lib/supabase/admin";
import { llm, LLMError } from "@/lib/llm";
import type { AgentRow } from "@/lib/data/agents";
import { getOrCreateMyAgentConversation, postMessage } from "@/lib/data/chat";
import { composePlan } from "@/lib/coordination/orchestrator";
import { CHAT_ASSIST_SYSTEM, wrapUntrusted } from "./prompts";
import { parseAgentCommand, splitInline } from "./commands";
import { routeRequest, researchWeb } from "@/lib/research";
import { answerForDraft, answerMessage, lookedUpNote } from "@/lib/research/answer";
import { describeRetry, hit } from "@/lib/limits";
import { WHICH_PLACE, placeNote } from "@/lib/research/place";
import { placeFor } from "@/lib/research/usual-place";
import { quoteContext } from "@/lib/social/quote";
import type { ReplyInfo } from "@/lib/social/quote-server";

type Conversation = { id: string; kind: string; title: string | null };

/**
 * "@agent ..." typed in a group or DM. Rules:
 *  - only the person who typed it can see the command and the agent's answer
 *    (messages.visible_to, enforced by RLS);
 *  - the agent only reads what everyone in the chat can already see (no
 *    private messages, nobody's private data), and treats it as data;
 *  - anything sent to others (a plan, a poll, a reply) still needs the
 *    owner's explicit approval;
 *  - "@agent" inside a message ("I'm fine thanks. @agent: what's the weather
 *    in Falkirk?") keeps the owner's own words exactly and adds what the agent
 *    found, as a private draft the owner edits and sends themselves;
 *  - research only ever gets a standalone question: never the chat.
 */
export async function handleAgentCommand(opts: { userId: string; agent: AgentRow; conversation: Conversation; text: string; reply?: ReplyInfo | null }) {
  const { userId, agent, conversation, text } = opts;
  const inline = splitInline(text);
  const own = inline?.own ?? "";
  const command = parseAgentCommand(inline ? `@agent ${inline.instruction}` : text);
  const db = adminClient();

  // The command itself is private to the owner (with the message it's about, if one was quoted).
  await postMessage({ conversationId: conversation.id, from: "human", userId, content: text, visibleTo: userId, replyTo: opts.reply?.id, metadata: { kind: "agent_command" } });
  // ↩ Reply: "@agent translate" / "draft a reply" about one message in particular (as data).
  const about = opts.reply ? `\n\nThe owner means this message in particular:\n${wrapUntrusted("replying_to", quoteContext(opts.reply.author, opts.reply.text))}` : "";
  const reply = (content: string, metadata: Record<string, unknown> = {}) =>
    postMessage({ conversationId: conversation.id, from: "agent", agentId: agent.id, content, visibleTo: userId, metadata: { kind: "agent_reply", ...metadata } });

  // Shared context: only messages everyone in this chat can see.
  const [{ data: recent }, { data: members }] = await Promise.all([
    db
      .from("messages")
      .select("content, sender_user_id, sender_agent_id, created_at")
      .eq("conversation_id", conversation.id)
      .is("visible_to", null)
      .order("created_at", { ascending: false })
      .limit(40),
    db.from("conversation_members").select("user_id").eq("conversation_id", conversation.id),
  ]);
  const memberIds = (members ?? []).map((m) => m.user_id);
  const { data: agents } = await db.from("agents").select("id, owner_id, handle, display_name").in("owner_id", memberIds);
  const byOwner = new Map((agents ?? []).map((a) => [a.owner_id, a]));
  const byAgent = new Map((agents ?? []).map((a) => [a.id, a]));
  const messages = (recent ?? []).reverse();
  const nameOf = (m: { sender_user_id: string | null; sender_agent_id: string | null }) =>
    m.sender_user_id
      ? m.sender_user_id === userId
        ? `${byOwner.get(userId)?.display_name ?? "Me"} (me)`
        : byOwner.get(m.sender_user_id)?.display_name ?? "Someone"
      : m.sender_agent_id
        ? `@${byAgent.get(m.sender_agent_id)?.handle ?? "an"}'s agent`
        : "Event";
  const lines = messages.map((m) => `${nameOf(m)}: ${m.content}`);
  const chatBlock = wrapUntrusted("chat", lines.join("\n") || "(no messages yet)");

  const assist = async (mode: keyof typeof CHAT_ASSIST_SYSTEM, user: string, mock: Record<string, unknown>) => {
    try {
      return await llm().generateText({
        purpose: "chat_assist",
        tier: mode === "translate" ? "fast" : "smart",
        system: CHAT_ASSIST_SYSTEM[mode],
        messages: [{ role: "user", content: user }],
        maxTokens: 1500,
        mockContext: { mode, lines, ...mock },
      });
    } catch (error) {
      return `Sorry — I couldn't do that (${error instanceof LLMError ? error.message : "something went wrong"}).`;
    }
  };

  /** The owner's own words, then what the agent adds. */
  const withOwn = (addition: string) => [own, addition].filter(Boolean).join(" ");
  const draftCard = (draft: string, intro = "", metadata: Record<string, unknown> = {}) =>
    reply(`${intro ? `${intro}\n\n` : ""}✍️ Draft (only you can see this). Edit it, then send it as your own message:\n${draft}`, { ...metadata, kind: "draft", draft });
  /** Nothing to add: the owner's own words aren't lost (they can still send them). */
  const keepOwn = (content: string) => (own ? reply(`${content}\n\nYour own words are below; nothing has been sent.`, { kind: "draft", draft: own }) : reply(content));

  /** A question about public facts: looked up on the web (only the question is sent), offered as a draft. */
  const research = async (request: string): Promise<boolean> => {
    // ↩ Reply: the quoted message only helps complete the question ("what's the score?" → which match).
    const quoted = opts.reply?.text;
    const route = await routeRequest(request, quoted);
    if (route.kind !== "research" || !route.question.trim()) return false;
    const limit = await hit("researchPerUser", userId);
    if (!limit.allowed) {
      await keepOwn(`You've looked up a lot in the last hour. Try again in ${describeRetry(limit.retryAfterSeconds)}.`);
      return true;
    }
    // No place named for something that depends on it: the town where the owner usually is (only the town goes out).
    const where = await placeFor(agent, request, route);
    if (where.ask) {
      await keepOwn(WHICH_PLACE);
      return true;
    }
    const answer = await researchWeb({ question: where.question, time: route.time, place: where.place });
    const addition = answerForDraft(answer);
    // What was taken from a quoted message is shown: the question that actually went out.
    const notes = [quoted ? lookedUpNote(where.question) : "", where.assumed ? placeNote(where.assumed) : ""].filter(Boolean);
    const shown = [...notes, answerMessage(answer)].join("\n\n");
    if (!addition) await keepOwn(shown);
    else await draftCard(withOwn(addition), quoted ? shown : `🔎 ${shown}`, { sources: answer.sources.slice(0, 3), research: answer.status });
    return true;
  };

  switch (command.mode) {
    case "summarise": {
      const summary = await assist("summarise", `${chatBlock}${about}`, {});
      return keepOwn(`📝 Summary\n${summary}`);
    }
    case "translate": {
      const lastFromOthers = [...messages].reverse().find((m) => m.sender_user_id !== userId && (m.sender_user_id || m.sender_agent_id));
      const source = command.text || own || opts.reply?.text || lastFromOthers?.content || "";
      if (!source) return reply("There's nothing to translate yet.");
      const translation = await assist("translate", `Translate into ${command.language}:\n${wrapUntrusted("text", source)}`, {
        language: command.language,
        text: source,
      });
      // Inline: your words (translated, or followed by the translation) become a draft you send yourself.
      if (inline) return draftCard(command.text ? withOwn(translation) : translation, `🌐 ${command.language}`);
      return reply(`🌐 ${command.language}: ${translation}`);
    }
    case "draft": {
      const draft = await assist("draft", `${chatBlock}${about}\n\nThe owner's instruction: ${command.instruction}`, { instruction: command.instruction });
      if (inline) return draftCard(withOwn(draft));
      return reply(`✍️ Draft reply (only you can see this):\n${draft}`, { kind: "draft", draft });
    }
    case "plan": {
      // A question about public facts (weather, news, a score): looked up, never guessed.
      if (await research(command.request)) return;
      // Inline and not a look-up: the agent writes what follows your own words, as a draft.
      if (inline) {
        const draft = await assist(
          "draft",
          `${chatBlock}${about}\n\nThe owner has already written: ${wrapUntrusted("own_words", own)}\nWrite only what should follow it. The owner's instruction: ${command.request}`,
          { instruction: command.request },
        );
        return draftCard(withOwn(draft));
      }
      // Communities are full of strangers: the agent only helps privately there.
      if (conversation.kind === "channel") {
        return reply("In communities I can only help you privately (summarise, translate, draft). To organise something, ask me in My Agent or in a group with your contacts.");
      }
      const allowed = await canPost(conversation as unknown as ConvRow, userId);
      if (!allowed.ok) return reply(allowed.error);
      // Everyone in this chat is a participant; the result is posted in this chat.
      const others = (agents ?? []).filter((a) => a.owner_id !== userId).map((a) => a.handle);
      const myAgentChat = await getOrCreateMyAgentConversation(userId);
      return composePlan({
        userId,
        agent,
        text: command.request,
        participants: others,
        chatMembers: others,
        say: (content) => reply(content),
        card: { conversationId: conversation.id, visibleTo: userId },
        taskConversationId: myAgentChat.id,
        groupConversationId: conversation.id,
        onChat: async () => reply(`🤖 ${await assist("ask", `${chatBlock}${about}\n\nThe owner asks: ${command.request}`, {})}`),
      });
    }
  }
}
