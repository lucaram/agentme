import { Avatar } from "@/components/Avatar";
import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { openMyAgent } from "../actions";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { MentionBadge } from "@/components/chat/MentionNotifications";
import { MentionState } from "@/lib/chat/mentions";
import { PresenceBadge } from "@/components/presence/PresenceBadge";
import { AgentNotificationSubtitle, ConversationNotificationBadge } from "@/components/notifications/ConversationNotifications";

const KIND_LABEL = { my_agent: "Your agent", dm: "Direct message", group: "Group", agent_chat: "Agent chat", channel: "Community" } as const;

/** WhatsApp-style time: "14:05" today, "Yesterday", otherwise "07/11". */
function formatWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
}

export default async function ChatsPage() {
  const { user, agent } = await requireAgent();
  const supabase = await createClient();

  // RLS limits these to conversations the user is a member of.
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, kind, title, avatar, community_id, channel, target_agent, conversation_members(user_id), messages(content, created_at, is_ai_generated, sender_user_id, sender_agent_id)")
    .order("created_at", { ascending: false, referencedTable: "messages" })
    .limit(1, { referencedTable: "messages" });

  const { data: agents } = await supabase.from("agents").select("id, owner_id, handle, display_name, avatar, type");
  // Unread messages per chat (RLS: only the user's own memberships).
  const { data: unreadRows } = await supabase.rpc("unread_counts");
  const unread = new Map((unreadRows ?? []).map((r) => [r.conversation_id, Number(r.unread)]));
  // Community chats are named after their community; muted chats are shown dimmed.
  const communityIds = [...new Set((conversations ?? []).map((c) => c.community_id).filter((id): id is string => Boolean(id)))];
  const [{ data: communities }, { data: myMemberships }] = await Promise.all([
    communityIds.length ? supabase.from("communities").select("id, name, avatar").in("id", communityIds) : Promise.resolve({ data: [] }),
    supabase.from("conversation_members").select("conversation_id, muted").eq("user_id", user.id),
  ]);
  const communityById = new Map((communities ?? []).map((c) => [c.id, c]));
  const { data: needsAnswer } = await supabase.rpc("owner_attention_count");
  const mentionState = MentionState.safeParse((await supabase.rpc("mention_state")).data).data;
  const muted = new Set((myMemberships ?? []).filter((m) => m.muted).map((m) => m.conversation_id));
  const byOwner = new Map((agents ?? []).map((a) => [a.owner_id, a]));
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));


  const rows = (conversations ?? [])
    .map((c) => {
      const others = c.conversation_members.filter((m) => m.user_id !== user.id).map((m) => byOwner.get(m.user_id));
      const target = c.target_agent ? byId.get(c.target_agent) : undefined;
      const name =
        c.kind === "my_agent"
          ? `My Agent (@${agent.handle})`
          : c.kind === "agent_chat"
            ? `${target?.display_name ?? "Agent"} · agent`
            : c.kind === "channel"
              ? `${communityById.get(c.community_id ?? "")?.name ?? "Community"} · ${c.title}`
              : c.title ?? others.map((o) => o?.display_name ?? "Someone").join(", ");
      const icon =
        c.kind === "my_agent"
          ? agent.avatar
          : c.kind === "group"
            ? c.avatar ?? "👥"
            : c.kind === "channel"
              ? communityById.get(c.community_id ?? "")?.avatar ?? "🏟️"
              : (target ?? others[0])?.avatar ?? "💬";
      const last = c.messages[0];
      // Say who wrote the last message, so a "✅ I'm in." in a group is attributable.
      const author = !last
        ? ""
        : last.sender_agent_id
          ? c.kind === "my_agent" || c.kind === "agent_chat" ? "🤖 " : `🤖 @${byId.get(last.sender_agent_id)?.handle ?? "agent"}'s agent: `
          : last.sender_user_id === user.id
            ? "You: "
            : last.sender_user_id
              ? `${byOwner.get(last.sender_user_id)?.display_name ?? "Someone"}: `
              : "";
      const presence = c.kind === "dm" ? others[0] : c.kind === "agent_chat" && target?.type === "business" ? target : null;
      return { id: c.id, kind: c.kind, name, icon, last, author, presence, at: last?.created_at ?? "", unread: unread.get(c.id) ?? 0, muted: muted.has(c.id) };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
  const myAgentRow = rows.find((r) => r.kind === "my_agent");
  const chatRows = rows.filter((r) => r.kind !== "my_agent");

  return (
    <div className="space-y-4">
      <RealtimeRefresh channel={`chats-${user.id}`} tables={["messages", "inbox_items"]} />
      {!myAgentRow && (
        <form action={openMyAgent}><button className="btn-primary">Talk to your agent</button></form>
      )}
      {/* My Agent: its own card above the chats, in the agent colour, always first. */}
      {myAgentRow && (
        <section aria-label="Your agent">
          <Link
            href={`/chats/${myAgentRow.id}`}
            className="flex items-center gap-3 rounded-2xl border-2 border-agent-border bg-agent px-4 py-3.5 shadow-sm transition hover:border-accent"
            data-testid="my-agent-card"
          >
            <span className="text-3xl"><Avatar value={myAgentRow.icon} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={`truncate ${myAgentRow.unread ? "font-semibold" : "font-medium"}`}>My Agent</span>
                <span className="rounded bg-agent-border px-1 text-[10px] font-semibold uppercase text-foreground" title="Your AI agent">AI</span>
                <span className="truncate text-xs text-muted">@{agent.handle}</span>
              </span>
              <AgentNotificationSubtitle initial={Number(needsAnswer ?? 0)} fallback={myAgentRow.last ? `${myAgentRow.author === "🤖 " ? "" : myAgentRow.author}${myAgentRow.last.content}` : "Ask me to organise something with your contacts"} />
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className={`text-xs ${myAgentRow.unread ? "text-accent" : "text-muted"}`}>{formatWhen(myAgentRow.at)}</span>
              <ConversationNotificationBadge conversationId={myAgentRow.id} initial={myAgentRow.unread} muted={myAgentRow.muted} />
            </span>
          </Link>
        </section>
      )}

      {chatRows.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface" aria-label="Chats">
          {chatRows.map((r) => (
            <li key={r.id} className="flex items-center">
              <Link href={`/chats/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-accent-soft">
                <span className="text-2xl"><Avatar value={r.icon} /></span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${r.unread && !r.muted ? "font-semibold" : "font-medium"}`}>
                    {r.name}
                    {r.muted && <span className="ml-1 text-xs" title="Muted" aria-label="muted">🔕</span>}
                    {r.presence && <span className="ml-2"><PresenceBadge agentId={r.presence.id} business={r.presence.type === "business"} /></span>}
                  </span>
                  <span className={`block truncate text-sm ${r.unread ? "text-foreground" : "text-muted"}`}>
                    {r.last ? `${r.author}${r.last.content}` : KIND_LABEL[r.kind]}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`text-xs ${r.unread ? "text-accent" : "text-muted"}`}>{formatWhen(r.at)}</span>
                  <ConversationNotificationBadge conversationId={r.id} initial={r.unread} muted={r.muted} />
                </span>
              </Link>
              <MentionBadge conversationId={r.id} initial={mentionState?.chats.find((c) => c.conversation_id === r.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="card text-sm text-muted">No chats yet. Message a contact, create a group, or join a community.</p>
      )}

    </div>
  );
}
