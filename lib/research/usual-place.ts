import "server-only";
import { getFacts, type AgentRow } from "@/lib/data/agents";
import { dependsOnPlace, townOf, withPlace } from "./place";
import { knownTown } from "@/lib/geo";

/**
 * A look-up that depends on where the owner is, with no place named: uses the
 * town from their "Where you usually are" (if they allow it: Settings →
 * Privacy). This is the one thing from the profile that goes out with a
 * search, and only the town. `ask`: no place to use, so ask instead of searching.
 */
export async function placeFor(
  agent: Pick<AgentRow, "id" | "lookup_place">,
  text: string,
  route: { question: string; place: string },
  /** "📍 Near me now": the town the owner is in right now, shared for this one message. */
  here?: string | null,
): Promise<{ question: string; place: string; assumed: string | null; ask: boolean; now?: boolean }> {
  // A place named in the question always wins; then where they are now (they attached it on purpose).
  if (!route.place && here) return { question: withPlace(route.question, here), place: here, assumed: here, ask: false, now: true };
  if (route.place || !dependsOnPlace(text)) return { question: route.question, place: route.place, assumed: null, ask: false };
  const saved = agent.lookup_place === false ? null : (await getFacts(agent.id)).find((f) => f.category === "location")?.value;
  // Only a town we know by name, and only its name: nothing else the owner wrote there goes out.
  const town = saved ? townOf(saved, knownTown) : null;
  if (!town) return { question: route.question, place: "", assumed: null, ask: true };
  return { question: withPlace(route.question, town), place: town, assumed: town, ask: false };
}
