import "server-only";
import { REGIONS, type Deal, type Rate } from "./check";

/**
 * Octopus Energy's public API (no key): the region for a postcode area, and today's household deals
 * there. Only the first half of the postcode ("NW1") is sent.
 */
const base = () => process.env.OCTOPUS_API_BASE || "https://api.octopus.energy/v1";
const get = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${base()}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Octopus ${res.status}`);
  return (await res.json()) as T;
};

/** "NW1" → "_C" (London). */
export async function regionOf(outward: string): Promise<{ code: string; name: string } | null> {
  const { results } = await get<{ results?: { group_id?: string }[] }>(`/industry/grid-supply-points/?postcode=${encodeURIComponent(outward)}`);
  const code = results?.length === 1 ? results[0].group_id : undefined;
  return code && REGIONS[code] ? { code, name: REGIONS[code] } : null;
}

type Tariff = { standard_unit_rate_inc_vat?: number; standing_charge_inc_vat?: number; exit_fees_inc_vat?: number };
type Product = { code: string; display_name: string; is_prepay?: boolean; is_business?: boolean; is_restricted?: boolean; term?: number | null };
type ProductDetail = Product & {
  single_register_electricity_tariffs?: Record<string, Record<string, Tariff>>;
  single_register_gas_tariffs?: Record<string, Record<string, Tariff>>;
};

/** Standard home deals only: the variable one (Flexible) and the fixed ones; not EV, heat-pump, export or prepay. */
const STANDARD = /^(VAR|OE-FIX)-/;
const tariffIn = (byRegion: Record<string, Record<string, Tariff>> | undefined, region: string): Tariff | null => {
  const payments = byRegion?.[region];
  return payments?.direct_debit_monthly ?? payments?.varying ?? null;
};
const rate = (t: Tariff | null): Rate | null =>
  t && typeof t.standard_unit_rate_inc_vat === "number" && typeof t.standing_charge_inc_vat === "number" ? { unit: t.standard_unit_rate_inc_vat, standing: t.standing_charge_inc_vat } : null;

export async function dealsIn(region: string): Promise<Deal[]> {
  const { results } = await get<{ results?: Product[] }>("/products/?brand=OCTOPUS_ENERGY&is_business=false");
  const products = (results ?? []).filter((p) => STANDARD.test(p.code) && !p.is_prepay && !p.is_business && !p.is_restricted).slice(0, 6);
  const details = await Promise.all(products.map((p) => get<ProductDetail>(`/products/${encodeURIComponent(p.code)}/`).catch(() => null)));
  return details.flatMap((d) => {
    if (!d) return [];
    const elec = tariffIn(d.single_register_electricity_tariffs, region), gas = tariffIn(d.single_register_gas_tariffs, region);
    const deal: Deal = { name: d.display_name, fixedMonths: /^OE-FIX-/.test(d.code) ? d.term ?? null : null, exitFee: Math.max(elec?.exit_fees_inc_vat ?? 0, gas?.exit_fees_inc_vat ?? 0) / 100, elec: rate(elec), gas: rate(gas) };
    return deal.elec || deal.gas ? [deal] : [];
  });
}
