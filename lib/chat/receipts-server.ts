import "server-only";
import { adminClient } from "@/lib/supabase/admin";

/** Called by the agent handler after accepting a request; this is never a human read acknowledgement. */
export async function recordAgentReceipt(messageId: string, agentId: string, taskId?: string | null) {
  const { error } = await adminClient().rpc("record_agent_receipt", { p_message: messageId, p_agent: agentId, p_task: taskId ?? null });
  if (error) console.error("Agent receipt could not be recorded", error.code);
}
