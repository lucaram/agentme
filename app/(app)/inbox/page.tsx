import { redirect } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { getOrCreateMyAgentConversation } from "@/lib/data/chat";

/** The Inbox now lives in My Agent ("Needs your answer"); old links land there. */
export default async function InboxPage() {
  const { user } = await requireAgent();
  const conv = await getOrCreateMyAgentConversation(user.id);
  redirect(`/chats/${conv.id}`);
}
