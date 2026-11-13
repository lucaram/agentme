import "server-only";
import { getFacts, type AgentRow } from "@/lib/data/agents";
import { dependsOnPlace, townOf, withPlace } from "./place";

/**
 * A look-up that depends on where the owner is, with no place named: uses the
 * town from their "Where you usually are" (if they allow it: Settings →
 * Privacy). This is the one thing from the profile that goes out with a
 * search, and only the town. `ask`: no place to use, so ask instead of searching.
 */
export async function placeFor(agent: Pick<AgentRow, "id" | "lookup_place">, text: string, route: { question: string; place: string }): Promise<{ question: string; place: string; assumed: string | null; ask: boolean }> {
  if (route.place || !dependsOnPlace(text)) return { question: route.question, place: route.place, assumed: null, ask: false };
  const saved = agent.lookup_place === false ? null : (await getFacts(agent.id)).find((f) => f.category === "location")?.value;
  const town = saved ? townOf(saved) : null;
  if (!town) return { question: route.question, place: "", assumed: null, ask: true };
  return { question: withPlace(route.question, town), place: town, assumed: town, ask: false };
}
