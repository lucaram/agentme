import { redirect } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { learnedOf, type Correction } from "@/lib/business/learn";
import { SiteSetup } from "./SiteSetup";

/**
 * "Paste your website", step by step: reading it (live), what the agent
 * learned (fix or remove anything), try it as a customer, then Go live.
 */
export default async function WebsiteSetupPage() {
  const { agent } = await requireAgent();
  if (agent.type !== "business") redirect("/business");
  const supabase = await createClient();
  // RLS: the business's own website row.
  const { data: site } = await supabase.from("business_sites").select("*").eq("agent_id", agent.id).maybeSingle();
  if (!site) redirect("/business");
  const info = (agent.business_info ?? {}) as { corrections?: Correction[] };

  return (
    <SiteSetup
      name={agent.display_name}
      site={{
        domain: site.domain,
        url: site.url,
        status: site.status,
        pagesRead: site.pages_read,
        pagesFound: site.pages_found,
        progress: (site.progress ?? []) as { title: string; url: string }[],
        warning: site.warning,
        error: site.error,
        live: Boolean(site.live_at),
        verified: agent.verified_domain === site.domain,
      }}
      learned={learnedOf(site.learned)}
      hidden={site.hidden}
      corrections={info.corrections ?? []}
    />
  );
}
