import { parseAvailability, parseClock, type ParticipantReply } from "./heuristics";
import type { Proposal } from "./schemas";

export type ValidationResult = { ok: true } | { ok: false; problems: string[] };

/**
 * Deterministic checks on an LLM-generated proposal. The LLM proposes; code
 * decides whether the proposal is consistent with what the agents said.
 */
export function validateProposal(
  proposal: Proposal,
  organiser: string,
  replies: ParticipantReply[],
): ValidationResult {
  const problems: string[] = [];
  const time = parseClock(proposal.time);
  if (time === null) problems.push(`Unreadable time "${proposal.time}".`);

  const known = new Map(replies.map((r) => [r.handle, r]));
  const participants = new Set(proposal.participants.map((p) => p.replace(/^@/, "").toLowerCase()));

  if (!participants.has(organiser)) problems.push("The organiser must be a participant.");

  for (const handle of participants) {
    if (handle === organiser) continue;
    const reply = known.get(handle);
    if (!reply) {
      problems.push(`@${handle} was not part of the coordination.`);
      continue;
    }
    const window = parseAvailability(reply.availability);
    if (window.unavailable) {
      problems.push(`@${handle} said they are not available.`);
      continue;
    }
    if (time !== null && window.earliest !== undefined && time < window.earliest) {
      problems.push(`@${handle} is only available later.`);
    }
    if (time !== null && window.latest !== undefined && time > window.latest) {
      problems.push(`@${handle} is only available earlier.`);
    }
  }

  // The organiser's own constraints apply too.
  const own = known.get(organiser);
  if (own && time !== null) {
    const window = parseAvailability(own.availability);
    if (window.earliest !== undefined && time < window.earliest) problems.push("You are only available later.");
    if (window.latest !== undefined && time > window.latest) problems.push("You are only available earlier.");
  }

  if (participants.size < 2) problems.push("Nobody else can attend.");
  return problems.length ? { ok: false, problems } : { ok: true };
}
