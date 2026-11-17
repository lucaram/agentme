import "server-only";
import { getAgentForUser } from "@/lib/data/agents";
import { realPerson } from "@/lib/identities";
import { accountRestriction } from "./accounts";

/** Both the business and the authenticated human must remain unrestricted. */
export async function sessionRestriction(userId: string) {
  const agent = await getAgentForUser(userId);
  if (agent?.type === "business") {
    const person = await realPerson({ id: userId }, agent);
    if (!person) return { id: null, user_key: userId, name: agent.display_name, action: "owner_restricted" as const, justification: "Please sign in again to reopen this business workspace.", created_at: null, expires_at: null };
    if (person !== userId) { const restriction = await accountRestriction(person); if (restriction) return restriction; }
  }
  return accountRestriction(userId);
}
