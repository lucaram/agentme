import "server-only";
import { checkEnergy, energyMessage, type EnergyQuery } from "./check";
import { dealsIn, regionOf } from "./octopus";

export type EnergyReply = { content: string; metadata: Record<string, unknown> };

/**
 * An energy check in My Agent: the region from the first half of the postcode, today's deals there,
 * and the comparison worked out and written by code. `request` is the owner's own words, kept only in
 * their own chat so a reply like "NW1" can complete it; only the postcode area is ever sent out.
 */
export async function answerEnergyRequest(energy: EnergyQuery, request: string): Promise<EnergyReply> {
  const ask = (content: string): EnergyReply => ({ content, metadata: { kind: "energy_ask", request: request.trim().slice(0, 500) } });
  const checked = checkEnergy(energy);
  if (!checked.ok) return ask(checked.ask);
  try {
    const region = await regionOf(checked.outward);
    if (!region) return ask(`I couldn't find the area ${checked.outward}. Which postcode area are you in? Just the first part, like NW1.`);
    const deals = await dealsIn(region.code);
    return {
      content: energyMessage(checked.query, region.name, deals),
      metadata: { kind: "energy_answer", energy: deals.length ? "found" : "none", sources: [{ url: "https://octopus.energy/tariffs/", title: "Octopus Energy tariffs" }] },
    };
  } catch (error) {
    console.error("energy check unavailable", error instanceof Error ? error.message : error);
    return { content: "I couldn't check energy prices just now. Please try again in a moment.", metadata: { kind: "energy_answer", energy: "unavailable" } };
  }
}
