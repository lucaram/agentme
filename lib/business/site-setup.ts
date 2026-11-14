import "server-only";
import { after } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { asJson } from "@/lib/data/json";
import { allowLocal } from "./fetch";
import { normaliseSite, verifiesByEmail } from "./site";
import { readWebsite } from "./website";
import { emailProofEnforced } from "./verify";

/**
 * Connects a website to a business agent and starts reading it in the
 * background. The same website again keeps what was reviewed; a different
 * one starts afresh (its old pages and verification go).
 */
export async function attachWebsite(agentId: string, raw: string, owner?: { email: string | null; emailConfirmed: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  const site = normaliseSite(raw, { allowLocal: allowLocal() });
  if (!site.ok) return site;
  const db = adminClient();
  const { data: current } = await db.from("business_sites").select("domain").eq("agent_id", agentId).maybeSingle();
  const same = current?.domain === site.domain;
  if (current && !same) {
    await db.from("business_sources").delete().eq("agent_id", agentId).eq("origin", "site");
    await db.from("agents").update({ verified_domain: null, verified_method: null }).eq("id", agentId);
  }
  const { error } = await db.from("business_sites").upsert(
    {
      agent_id: agentId,
      url: site.url.toString(),
      domain: site.domain,
      status: "reading",
      pages_read: 0,
      pages_found: 0,
      progress: asJson([]),
      error: null,
      warning: null,
      reading_started_at: null,
      ...(same ? {} : { learned: asJson({}), hidden: [], live_at: null }),
    },
    { onConflict: "agent_id" },
  );
  if (error) return { ok: false, error: "Couldn't add your website. Please try again." };
  // ✓ Verified straight away when the owner's email is at the website's domain, and only where emails are
  // really confirmed (a link clicked in that mailbox): see emailProofEnforced.
  if (emailProofEnforced() && owner?.emailConfirmed && verifiesByEmail(owner.email, site.domain)) await markVerified(agentId, site.domain, "email");
  after(() => readWebsite(agentId, "first"));
  return { ok: true };
}

/** ✓ Verified: one business per website (the first to prove it). */
export async function markVerified(agentId: string, domain: string, method: "email" | "meta"): Promise<{ ok: true } | { ok: false; error: string }> {
  // How it was proved is kept, so badges can be reviewed later.
  const { error } = await adminClient().from("agents").update({ verified_domain: domain, verified_method: method }).eq("id", agentId);
  if (error) return { ok: false, error: error.code === "23505" ? "Another business on AGENTME has already verified this website." : "Couldn't verify it. Please try again." };
  return { ok: true };
}
