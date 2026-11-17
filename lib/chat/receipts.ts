import { z } from "zod";

export const ReceiptSchema = z.object({
  message_id: z.string(), sent_at: z.string(), kind: z.enum(["people", "agent", "untracked"]), group: z.boolean(),
  total: z.number(), delivered: z.number(), seen: z.number(), agent_name: z.string().nullable(), agent_business: z.boolean(),
  agent_received_at: z.string().nullable(), owner_seen_at: z.string().nullable(), owner_seen_shared: z.boolean(),
  recipients: z.array(z.object({ user_id: z.string().nullable(), name: z.string(), delivered_at: z.string().nullable(), seen_at: z.string().nullable(), seen_shared: z.boolean() })),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

export function receiptDisplay(receipt?: Receipt) {
  if (receipt?.kind === "agent") {
    if (receipt.owner_seen_at && receipt.owner_seen_shared) return { state: "seen", icon: "eye", label: receipt.agent_business ? "Seen by team" : "Seen by agent's owner", text: receipt.agent_business ? "Seen by team" : "Seen by agent's owner", green: true } as const;
    if (receipt.agent_received_at) return { state: "agent", icon: "agent", label: "Agent received", text: "Agent received", green: false } as const;
  }
  const allSeen = Boolean(receipt?.total && receipt.seen === receipt.total);
  const delivered = Boolean(receipt?.total && receipt.delivered === receipt.total);
  const text = receipt?.group && receipt.total ? `Seen by ${receipt.seen} of ${receipt.total}` : "";
  const label = text || (allSeen ? "Seen" : delivered ? "Delivered" : "Sent");
  return { state: allSeen ? "seen" : receipt?.seen ? "partial" : delivered ? "delivered" : "sent", icon: allSeen || receipt?.seen ? "eye" : delivered ? "inbox" : "up", label, text, green: allSeen } as const;
}
