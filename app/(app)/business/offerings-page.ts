import "server-only";
import { redirect } from "next/navigation";
import { requireBusinessPermission } from "@/lib/business/access";
import { adminClient } from "@/lib/supabase/admin";
import { offeringsOf } from "@/lib/business/offerings";

/** Prices and Facilities pages: owners and managers of a business only (staff see My Business instead). */
export async function offeringsPage() {
  const { agent } = await requireBusinessPermission("configure").catch(() => redirect("/business"));
  if (agent.type !== "business") redirect("/business");
  const db = adminClient();
  const [offerings, { count }, { data: site }] = await Promise.all([
    offeringsOf(agent.id),
    db.from("business_sources").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).eq("origin", "link"),
    db.from("business_sites").select("live_at").eq("agent_id", agent.id).maybeSingle(),
  ]);
  return { ...offerings, hasSources: Boolean(site?.live_at) || (count ?? 0) > 0 };
}
