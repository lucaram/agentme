import "server-only";
import { redirect } from "next/navigation";
import { requireBusinessPermission } from "@/lib/business/access";
import { adminClient } from "@/lib/supabase/admin";
import { offeringsOf } from "@/lib/business/offerings";
import { sourceLabel } from "@/lib/business/offerings-shared";

/** Prices and Facilities pages: owners and managers of a business only (staff see My Business instead). */
export async function offeringsPage() {
  const { agent } = await requireBusinessPermission("configure").catch(() => redirect("/business"));
  if (agent.type !== "business") redirect("/business");
  const db = adminClient();
  const [offerings, { data: sources }, { data: site }] = await Promise.all([
    offeringsOf(agent.id),
    db.from("business_sources").select("url, origin, offerings_error").eq("agent_id", agent.id),
    db.from("business_sites").select("live_at").eq("agent_id", agent.id).maybeSingle(),
  ]);
  const links = (sources ?? []).filter((s) => s.origin === "link");
  // Sources whose last read for prices and facilities didn't work: what was there before stays.
  const problems = (sources ?? []).flatMap((s) => (s.offerings_error ? [{ label: sourceLabel(s.url), error: s.offerings_error }] : []));
  return { ...offerings, agentId: agent.id, problems, hasSources: Boolean(site?.live_at) || links.length > 0 };
}
