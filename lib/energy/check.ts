/**
 * Energy check for My Agent: what the owner pays (or a typical home), against today's deals for their
 * region, worked out and written by code (never by the model). Pure: no server code. Unit-tested.
 * Only the first half of the postcode ("NW1") ever leaves AGENTME, to find the region.
 */
import { z } from "zod";

export const FUELS = ["electricity", "gas", "both"] as const;

/** What the router takes out of an energy request ("am I paying too much? 27p and 45p a day, NW1"). */
export const EnergyQuerySchema = z.object({
  fuel: z.enum(FUELS).describe("energy only: electricity, gas, or both (both when they say energy, bills or dual fuel)."),
  postcode: z.string().describe("energy only: the postcode or its first part (outward code) as given, e.g. 'NW1' or 'M1 1AE'. Empty if not given."),
  elec_kwh: z.number().describe("energy only: electricity used a year in kWh if given, else 0."),
  gas_kwh: z.number().describe("energy only: gas used a year in kWh if given, else 0."),
  elec_rate: z.number().describe("energy only: their electricity unit rate in pence per kWh if given (27.5), else 0."),
  elec_standing: z.number().describe("energy only: their electricity standing charge in pence per day if given, else 0."),
  gas_rate: z.number().describe("energy only: their gas unit rate in pence per kWh if given, else 0."),
  gas_standing: z.number().describe("energy only: their gas standing charge in pence per day if given, else 0."),
  yearly_cost: z.number().describe("energy only: what they pay for energy a year in pounds if given (a monthly amount × 12), else 0."),
});
export type EnergyQuery = z.infer<typeof EnergyQuerySchema>;
export const NO_ENERGY: EnergyQuery = { fuel: "both", postcode: "", elec_kwh: 0, gas_kwh: 0, elec_rate: 0, elec_standing: 0, gas_rate: 0, gas_standing: 0, yearly_cost: 0 };

/** Ofgem's typical yearly use for a home (used when the owner doesn't say). */
export const TYPICAL = { elec: 2700, gas: 11500 };

/** The electricity regions (grid supply point groups) prices depend on. */
export const REGIONS: Record<string, string> = {
  _A: "Eastern England", _B: "East Midlands", _C: "London", _D: "Merseyside and North Wales", _E: "West Midlands", _F: "North East England", _G: "North West England",
  _H: "Southern England", _J: "South East England", _K: "South Wales", _L: "South West England", _M: "Yorkshire", _N: "South Scotland", _P: "North Scotland",
};

/** "nw1 4rg" → "NW1": only this goes out (to find the region). */
export function outwardCode(postcode: string): string | null {
  const clean = postcode.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
  const outward = clean.includes(" ") ? clean.split(/\s+/)[0] : clean.length > 4 ? clean.slice(0, -3) : clean;
  return /^[A-Z]{1,2}\d[A-Z\d]?$/.test(outward) ? outward : null;
}

/** Ready to check, or the one thing to ask first. */
export function checkEnergy(q: EnergyQuery): { ok: true; query: EnergyQuery; outward: string } | { ok: false; ask: string } {
  const outward = outwardCode(q.postcode);
  if (!outward) return { ok: false, ask: "Which postcode area are you in? Just the first part, like NW1: prices depend on the region." };
  const n = (v: number, max: number) => (Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 100) / 100 : 0);
  return {
    ok: true,
    outward,
    query: {
      fuel: FUELS.includes(q.fuel) ? q.fuel : "both", postcode: outward,
      elec_kwh: n(q.elec_kwh, 50_000), gas_kwh: n(q.gas_kwh, 100_000),
      elec_rate: n(q.elec_rate, 200), elec_standing: n(q.elec_standing, 300), gas_rate: n(q.gas_rate, 100), gas_standing: n(q.gas_standing, 300),
      yearly_cost: n(q.yearly_cost, 20_000),
    },
  };
}

/** One fuel's price: pence per kWh and pence per day (including VAT). */
export type Rate = { unit: number; standing: number };
/** A deal for the owner's region. */
export type Deal = { name: string; fixedMonths: number | null; exitFee: number; elec: Rate | null; gas: Rate | null };

const yearOf = (kwh: number, r: Rate) => (kwh * r.unit + 365 * r.standing) / 100;
const uses = (q: EnergyQuery) => ({ elec: q.fuel !== "gas", gas: q.fuel !== "electricity" });
export const usageOf = (q: EnergyQuery) => ({ elec: q.elec_kwh || TYPICAL.elec, gas: q.gas_kwh || TYPICAL.gas, typical: (uses(q).elec && !q.elec_kwh) || (uses(q).gas && !q.gas_kwh) });

/** A deal's yearly cost for this use (null when it doesn't cover a fuel the owner needs). */
export function yearlyCost(q: EnergyQuery, deal: Pick<Deal, "elec" | "gas">): number | null {
  const need = uses(q), use = usageOf(q);
  if ((need.elec && !deal.elec) || (need.gas && !deal.gas)) return null;
  return (need.elec ? yearOf(use.elec, deal.elec!) : 0) + (need.gas ? yearOf(use.gas, deal.gas!) : 0);
}

/** What the owner pays now, from their rates (for each fuel they need) or the yearly amount they gave. */
export function currentCost(q: EnergyQuery): number | null {
  const need = uses(q);
  const rated = (!need.elec || (q.elec_rate && q.elec_standing)) && (!need.gas || (q.gas_rate && q.gas_standing));
  if (rated) return yearlyCost(q, { elec: need.elec ? { unit: q.elec_rate, standing: q.elec_standing } : null, gas: need.gas ? { unit: q.gas_rate, standing: q.gas_standing } : null });
  return q.yearly_cost || null;
}

const pounds = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const pence = (n: number) => `${n.toFixed(2).replace(/\.?0+$/, "")}p`;
const rateText = (label: string, r: Rate) => `${label} ${pence(r.unit)}/kWh + ${pence(r.standing)}/day`;

/** The answer: the region and use, what they pay, the deals cheapest first, and what to make of it. */
export function energyMessage(q: EnergyQuery, region: string, deals: Deal[]): string {
  const need = uses(q), use = usageOf(q);
  const fuels = [need.elec ? `electricity ${use.elec.toLocaleString("en-GB")} kWh` : "", need.gas ? `gas ${use.gas.toLocaleString("en-GB")} kWh` : ""].filter(Boolean).join(" + ");
  const head = `⚡ Energy check · ${region} (${q.postcode}) · ${fuels} a year${use.typical ? " (a typical home)" : ""}`;
  const priced = deals.map((d) => ({ d, cost: yearlyCost(q, d) })).filter((x): x is { d: Deal; cost: number } => x.cost !== null).sort((a, b) => a.cost - b.cost);
  if (!priced.length) return `${head}\n\nI couldn't find deals for your area just now. Please try again later.`;
  const now = currentCost(q);
  // A bill amount set against a typical home's use isn't a fair comparison: no savings claimed then.
  const fair = now !== null && (Boolean(q.elec_rate || q.gas_rate) || !use.typical);
  const lines = priced.slice(0, 3).map(({ d, cost }, i) => {
    const kind = d.fixedMonths ? `fixed for ${d.fixedMonths} months${d.exitFee ? ` · ${pounds(d.exitFee)} exit fee per fuel` : ""}` : "variable (follows the price cap) · no exit fees";
    const rates = [need.elec && d.elec ? rateText("Electricity", d.elec) : "", need.gas && d.gas ? rateText("Gas", d.gas) : ""].filter(Boolean).join(" · ");
    const vs = fair && now ? ` · ${cost < now ? `${pounds(now - cost)} less` : cost > now ? `${pounds(cost - now)} more` : "the same"} than now` : "";
    return `${i + 1}. **${d.name}** · ${pounds(cost)} a year${vs}\n   ${kind}\n   ${rates}`;
  });
  const best = priced[0];
  const verdict = now && !fair
    ? `You pay about ${pounds(now)} a year. A typical home would pay about ${pounds(best.cost)} with ${best.d.name}, but your use may be different: tell me how many kWh you use a year (it's on your bill) for a fair comparison.`
    : now
    ? best.cost < now - 20
      ? `You pay about ${pounds(now)} a year now: you could save about ${pounds(now - best.cost)} a year with ${best.d.name}.`
      : `You pay about ${pounds(now)} a year now, already about as little as these deals (or less).`
    : "Tell me your unit rates and standing charges (they're on your bill), or what you pay a year, and I'll work out what you'd save.";
  const note = "Estimates for this use at today's rates, including VAT. These are Octopus Energy's deals: to compare every supplier, use an Ofgem-accredited comparison site. Nothing is switched for you.";
  return [head, verdict, lines.join("\n"), note].join("\n\n");
}
