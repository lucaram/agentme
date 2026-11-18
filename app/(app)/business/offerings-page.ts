import "server-only";
import { redirect } from "next/navigation";
import { requireBusinessPermission } from "@/lib/business/access";
import { adminClient } from "@/lib/supabase/admin";
import { offeringsOf } from "@/lib/business/offerings";
import { priceSources } from "@/lib/business/offerings-shared";

/** Prices and Facilities pages: owners and managers of a business only (staff see My Business instead). */
export async function offeringsPage() {
  const { agent } = await requireBusinessPermission("configure").catch(() => redirect("/business"));
  if (agent.type !== "business") redirect("/business");
  const db = adminClient();
  const [offerings, { data: rows }, { data: site }] = await Promise.all([
    offeringsOf(agent.id),
    db.from("business_sources").select("id, url, origin, status, error, offerings_error, offerings_reading_at, offerings_read_at, last_read_at").eq("agent_id", agent.id).order("created_at"),
    db.from("business_sites").select("domain").eq("agent_id", agent.id).maybeSingle(),
  ]);
  // Where the prices come from: each document, and the website's pages together; what's being read now.
  const sources = priceSources(rows ?? [], offerings.prices, Date.now(), site?.domain ?? null);
  return { ...offerings, agentId: agent.id, sources };
}
