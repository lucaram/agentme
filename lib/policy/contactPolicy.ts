export type ContactPolicy = "contacts_only" | "anyone" | "nobody";
export type Relationship = "none" | "pending" | "accepted" | "blocked";

export type ContactDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Trust rule: an agent may only be contacted when the RECIPIENT's contact
 * policy allows it. Enforced in code before any LLM sees the request.
 *
 * `relationship` is the contact state between sender and recipient
 * ("none" for anonymous/external callers).
 */
export function canContact(recipientPolicy: ContactPolicy, relationship: Relationship): ContactDecision {
  if (relationship === "blocked") return { allowed: false, reason: "blocked" };
  switch (recipientPolicy) {
    case "nobody":
      return { allowed: false, reason: "recipient_accepts_no_contact" };
    case "contacts_only":
      return relationship === "accepted"
        ? { allowed: true }
        : { allowed: false, reason: "not_a_contact" };
    case "anyone":
      return { allowed: true };
  }
}

/**
 * Private, owner-scoped data (preferences, availability) is only ever shared
 * between accepted contacts — independent of the contact policy, which merely
 * governs whether a conversation may start.
 */
export function mayShareContactScopedData(relationship: Relationship): boolean {
  return relationship === "accepted";
}
