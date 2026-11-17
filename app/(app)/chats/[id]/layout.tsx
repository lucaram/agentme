import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TopicPage, type TopicSeed } from "@/lib/agents/topic-types";
import { TopicWorkspace } from "@/components/agent/TopicWorkspace";

export default async function ChatLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params; const user = await requireUser(); const client = await createClient();
  const { data: conversation } = await client.from("conversations").select("kind").eq("id", id).maybeSingle();
  if (conversation?.kind !== "my_agent") return children;
  const asOf = new Date().toISOString(); const entries = await Promise.all((["needs", "progress", "recent"] as const).map(async (group) => {
    const result = await client.rpc("my_agent_topic_page", { p_conversation: id, p_group: group, p_as_of: asOf }); const page = TopicPage.safeParse(result.data);
    return [group, !result.error && page.success ? page.data : null] as const;
  }));
  return <TopicWorkspace key={`${user.id}:${id}`} conversationId={id} userId={user.id} seed={Object.fromEntries(entries) as TopicSeed}>{children}</TopicWorkspace>;
}
