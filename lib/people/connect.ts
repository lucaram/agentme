import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { getContactRow, type AgentRow } from "@/lib/data/agents";
import { createConversation, findConversation, postMessage } from "@/lib/data/chat";

/**
 * Makes two people contacts after both have shown consent (a live QR code,
 * an introduction both accepted, an invite link). Never overrides a block.
 * Returns false when they can't be connected (blocked).
 */
export async function connectPeople(requester: AgentRow, addressee: AgentRow): Promise<boolean> {
  const db = adminClient();
  const row = await getContactRow(requester.id, addressee.id);
  if (row?.status === "blocked") return false;
  if (row?.status === "pending") await db.from("contacts").update({ status: "accepted" }).eq("id", row.id);
  if (!row) await db.from("contacts").insert({ requester_agent: requester.id, addressee_agent: addressee.id, status: "accepted" });
  return true;
}

/** The two people's direct chat (created if needed), with a first system note. */
export async function openDmWithNote(a: AgentRow, b: AgentRow, note: string): Promise<string> {
  const existing = await findConversation("dm", [a.owner_id, b.owner_id]);
  const conv = existing ?? (await createConversation({ kind: "dm", createdBy: a.owner_id, memberIds: [b.owner_id] }));
  await postMessage({ conversationId: conv.id, from: "system", content: note });
  return conv.id;
}
