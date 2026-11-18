import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { OpenRequests } from "@/components/requests/OpenRequests";
import { TopicOverview } from "@/components/agent/TopicWorkspace";
import { Composer } from "./Composer";
import { ModerationAttention } from "@/components/moderation/ModerationAttention";
import { BusinessWorkInbox } from "@/components/business/BusinessWorkInbox";

export async function MyAgentHome({ conversationId, examples }: { conversationId: string; examples: { label: string; text?: string; href?: string }[]; now?: number }) {
  const client = await createClient(); const { count: requestsMade } = await client.from("tasks").select("*", { count: "exact", head: true });
  return <div className="flex flex-1 flex-col">
    <RealtimeRefresh channel={`my-agent-${conversationId}`} tables={["messages", "tasks", "inbox_items", "reports", "platform_cases", "platform_notifications", "platform_moderators", "platform_evidence_requests", "platform_account_appeals"]} filter={`conversation_id=eq.${conversationId}`} />
    <div className="mb-4"><h1 className="text-lg font-semibold">My Agent</h1><p className="text-xs text-muted">Your agent always asks before contacting anyone.</p></div>
    <div id="needs-your-answer" className="mb-4 scroll-mt-40"><OpenRequests title="Needs your answer" kinds={["info_request", "question", "group_invite", "business_invitation", "business_answer_review"]} hint="Only you can decide these. Nothing is shared until you choose." /><BusinessWorkInbox /></div>
    <ModerationAttention /><TopicOverview /><div className="min-h-6 flex-1" />
    <Composer conversationId={conversationId} threadId="new" nearMe attachments={false} placeholder="Start a new request, e.g. Arrange dinner with @marco on Saturday evening" thinkingLabel="Agent is thinking…" examples={examples} collapseExamples={(requestsMade ?? 0) >= 3} />
  </div>;
}
