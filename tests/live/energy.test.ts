/**
 * The energy check in My Agent: the question understood, the region found from the first half of the
 * postcode only, today's deals there, and the comparison written by code. A small local server stands
 * in for Octopus's public API; a throwaway owner, deleted afterwards.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, dbUp } from "./env";

type AgentRow = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>>>;
const run = Math.random().toString(36).slice(2, 7);
const tariff = (unit: number, standing: number, exit = 0) => ({ standard_unit_rate_inc_vat: unit, standing_charge_inc_vat: standing, exit_fees_inc_vat: exit });
const PRODUCTS: Record<string, unknown> = {
  "VAR-22-11-01": { code: "VAR-22-11-01", display_name: "Flexible Octopus", term: null, single_register_electricity_tariffs: { _C: { varying: tariff(26.5956, 41.3869) } }, single_register_gas_tariffs: { _C: { varying: tariff(8.146, 29.24) } } },
  "OE-FIX-12M-26-11-09": { code: "OE-FIX-12M-26-11-09", display_name: "Octopus 12M Fixed", term: 12, single_register_electricity_tariffs: { _C: { direct_debit_monthly: tariff(28.9754, 41.3869, 5000) } }, single_register_gas_tariffs: { _C: { direct_debit_monthly: tariff(9.747, 29.24, 5000) } } },
};

describe.skipIf(!dbUp)("energy check in My Agent (live)", () => {
  let server: Server;
  const paths: string[] = [];
  const was = process.env.OCTOPUS_API_BASE;
  let owner: AgentRow;
  let conv: string;
  let userId: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      paths.push(req.url ?? "");
      res.setHeader("content-type", "application/json");
      const url = new URL(req.url ?? "", "http://x");
      if (url.pathname === "/industry/grid-supply-points/") return res.end(JSON.stringify({ results: url.searchParams.get("postcode") === "NW1" ? [{ group_id: "_C" }] : [] }));
      if (url.pathname === "/products/") {
        return res.end(JSON.stringify({ results: [
          { code: "VAR-22-11-01", display_name: "Flexible Octopus" }, { code: "OE-FIX-12M-26-11-09", display_name: "Octopus 12M Fixed", term: 12 },
          { code: "AGILE-24-10-01", display_name: "Agile Octopus" }, { code: "PREPAY-VAR-18-09-21", display_name: "Key and Card", is_prepay: true },
        ] }));
      }
      const product = url.pathname.match(/^\/products\/([^/]+)\/$/)?.[1];
      if (product && PRODUCTS[product]) return res.end(JSON.stringify(PRODUCTS[product]));
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.OCTOPUS_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { data: created, error } = await admin().auth.admin.createUser({ email: `volt${run}@energy.test`, password: "energy-password", email_confirm: true });
    if (error) throw error;
    userId = created.user.id;
    const { data } = await admin().from("agents").insert({ owner_id: userId, handle: `volt${run}`, display_name: "Householder", type: "personal", contact_policy: "contacts_only" }).select("*").single();
    owner = data as AgentRow;
    conv = (await (await import("@/lib/data/chat")).getOrCreateMyAgentConversation(userId)).id;
  });
  afterAll(async () => {
    if (was === undefined) delete process.env.OCTOPUS_API_BASE;
    else process.env.OCTOPUS_API_BASE = was;
    await new Promise((resolve) => server.close(resolve));
    await admin().from("conversations").delete().eq("created_by", userId);
    if (userId) await admin().auth.admin.deleteUser(userId);
  });

  const ask = async (text: string) => {
    const { handleOwnerMessage } = await import("@/lib/coordination/orchestrator");
    await handleOwnerMessage({ userId, agent: owner, conversationId: conv, text });
    return (await admin().from("messages").select("content, metadata").eq("conversation_id", conv).not("sender_agent_id", "is", null).order("created_at", { ascending: false }).limit(1).single()).data!;
  };

  it("compares what they pay with today's deals in their region; only the postcode area goes out", async () => {
    paths.length = 0;
    const reply = await ask("am I paying too much for electricity? NW1 4RG, 27.5p and 45p a day");
    expect(reply.content).toContain("⚡ Energy check · London (NW1) · electricity 2,700 kWh a year (a typical home)");
    expect(reply.content).toContain("you could save about £38 a year with Flexible Octopus");
    expect(reply.content.split("\n").filter((l: string) => /^\d\. /.test(l))).toEqual(["1. **Flexible Octopus** · £869 a year · £38 less than now", "2. **Octopus 12M Fixed** · £933 a year · £27 more than now"]);
    expect(reply.content).toContain("fixed for 12 months · £50 exit fee per fuel");
    expect(reply.metadata).toMatchObject({ kind: "energy_answer", energy: "found", sources: [{ url: "https://octopus.energy/tariffs/" }] });
    // Only "NW1" (not the full postcode) is sent; Agile and prepay aren't looked at.
    expect(paths.find((p) => p.startsWith("/industry"))).toBe("/industry/grid-supply-points/?postcode=NW1");
    expect(paths.join(" ")).not.toContain("4RG");
    expect(paths.some((p) => p.includes("AGILE") || p.includes("PREPAY"))).toBe(false);
  });

  it("asks for the postcode area, and the reply completes the check", async () => {
    const first = await ask("should I fix my energy tariff?");
    expect(first.content).toBe("Which postcode area are you in? Just the first part, like NW1: prices depend on the region.");
    expect(first.metadata).toMatchObject({ kind: "energy_ask" });
    const second = await ask("NW1");
    expect(second.content).toContain("⚡ Energy check · London (NW1) · electricity 2,700 kWh + gas 11,500 kWh a year");
    expect(second.content).toContain("Tell me your unit rates and standing charges");
  });
});
