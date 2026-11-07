import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createGroup, openMyAgent } from "../actions";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";

const KIND_LABEL = { my_agent: "Your agent", dm: "Direct message", group: "Group", agent_chat: "Agent chat" } as const;

export default async function ChatsPage({ searchParams }: PageProps<"/chats">) {
  const { user, agent } = await requireAgent();
  const { error } = await searchParams;
  const supabase = await createClient();

  // RLS limits these to conversations the user is a member of.
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, kind, title, target_agent, conversation_members(user_id), messages(content, created_at, is_ai_generated, sender_user_id, sender_agent_id)")
    .order("created_at", { ascending: false, referencedTable: "messages" })
    .limit(1, { referencedTable: "messages" });

  const { data: agents } = await supabase.from("agents").select("id, owner_id, handle, display_name, avatar");
  const byOwner = new Map((agents ?? []).map((a) => [a.owner_id, a]));
  const byId = new Map((agents ?? []).map((a) => [a.id, a]));

  const { data: contacts } = await supabase.from("contacts").select("requester_agent, addressee_agent").eq("status", "accepted");
  const contactAgents = (contacts ?? [])
    .map((c) => byId.get(c.requester_agent === agent.id ? c.addressee_agent : c.requester_agent))
    .filter((a) => a !== undefined);

  const rows = (conversations ?? [])
    .map((c) => {
      const others = c.conversation_members.filter((m) => m.user_id !== user.id).map((m) => byOwner.get(m.user_id));
      const target = c.target_agent ? byId.get(c.target_agent) : undefined;
      const name =
        c.kind === "my_agent"
          ? `My Agent (@${agent.handle})`
          : c.kind === "agent_chat"
            ? `${target?.display_name ?? "Agent"} · agent`
            : c.title ?? others.map((o) => o?.display_name ?? "Someone").join(", ");
      const icon = c.kind === "my_agent" ? agent.avatar : c.kind === "group" ? "👥" : (target ?? others[0])?.avatar ?? "💬";
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
      return { id: c.id, kind: c.kind, name, icon, last, author, at: last?.created_at ?? "" };
    })
    .sort((a, b) => (a.kind === "my_agent" ? -1 : b.kind === "my_agent" ? 1 : b.at.localeCompare(a.at)));

  return (
    <div className="space-y-6">
      <RealtimeRefresh channel={`chats-${user.id}`} tables={["messages"]} />
      {!rows.some((r) => r.kind === "my_agent") && (
        <form action={openMyAgent}><button className="btn-primary">Talk to your agent</button></form>
      )}
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/chats/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent-soft">
              <span className="text-2xl">{r.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.name}</span>
                <span className="block truncate text-sm text-muted">
                  {r.last ? `${r.author}${r.last.content}` : KIND_LABEL[r.kind]}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <details className="card">
        <summary className="cursor-pointer font-medium">New group</summary>
        {contactAgents.length ? (
          <form action={createGroup} className="mt-3 space-y-3">
            <input className="input" name="title" placeholder="Group name" maxLength={80} />
            <div className="flex flex-wrap gap-2">
              {contactAgents.map((a) => (
                <label key={a.id} className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm">
                  <input type="checkbox" name="members" value={a.id} /> {a.avatar} @{a.handle}
                </label>
              ))}
            </div>
            {error === "group" && <p className="text-sm text-danger">Pick at least one contact.</p>}
            {error === "group-size" && <p className="text-sm text-danger">A group can have up to 20 people, including you.</p>}
            <button className="btn-primary">Create group</button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-muted">Add contacts first, from Discover.</p>
        )}
      </details>
    </div>
  );
}
