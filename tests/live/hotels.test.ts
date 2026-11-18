/**
 * Hotel prices in My Agent: the request is understood, checked (or one question back), sent to the
 * hotel provider as the stay only, and answered by code with the best options. A small local server
 * stands in for LiteAPI; a throwaway owner, deleted afterwards.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, dbUp } from "./env";

type AgentRow = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>>>;
const run = Math.random().toString(36).slice(2, 7);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const hotel = (id: string, name: string, rating: number, total: number) => ({
  info: { id, name, stars: 4, rating, review_count: 1200, address: `${name} street 1` },
  rates: { hotelId: id, roomTypes: [{ offerRetailRate: { amount: total, currency: "GBP" }, rates: [{ name: "Double", boardName: "Breakfast Included", cancellationPolicies: { refundableTag: "RFN" }, retailRate: { taxesAndFees: [{ included: false, amount: 12 }] } }] }] },
});
const HOTELS = [hotel("h1", "Albergo Uno", 8.8, 240), hotel("h2", "Hotel Due", 9.1, 310), hotel("h3", "Casa Tre", 6.0, 150), hotel("h4", "Palazzo Quattro", 8.0, 280)];

describe.skipIf(!dbUp)("hotel prices in My Agent (live)", () => {
  let server: Server;
  const requests: { path: string; body: Record<string, unknown> | null; key: string }[] = [];
  const env = { base: process.env.LITEAPI_API_BASE, key: process.env.LITEAPI_KEY };
  let owner: AgentRow;
  let conv: string;
  let userId: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        requests.push({ path: req.url ?? "", body: raw ? JSON.parse(raw) : null, key: String(req.headers["x-api-key"] ?? "") });
        res.setHeader("content-type", "application/json");
        if (req.url === "/v3.0/hotels/rates") return res.end(JSON.stringify({ sandbox: true, data: HOTELS.map((h) => h.rates), hotels: HOTELS.map((h) => h.info) }));
        res.statusCode = 404;
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.LITEAPI_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.LITEAPI_KEY = "sand_fake";
    const { data: created, error } = await admin().auth.admin.createUser({ email: `stay${run}@hotels.test`, password: "hotels-password", email_confirm: true });
    if (error) throw error;
    userId = created.user.id;
    const { data } = await admin().from("agents").insert({ owner_id: userId, handle: `stay${run}`, display_name: "Traveller", type: "personal", contact_policy: "contacts_only" }).select("*").single();
    owner = data as AgentRow;
    conv = (await (await import("@/lib/data/chat")).getOrCreateMyAgentConversation(userId)).id;
  });
  afterAll(async () => {
    for (const [name, value] of [["LITEAPI_API_BASE", env.base], ["LITEAPI_KEY", env.key]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise((resolve) => server.close(resolve));
    await admin().from("conversations").delete().eq("created_by", userId);
    if (userId) await admin().auth.admin.deleteUser(userId);
  });

  const ask = async (text: string) => {
    const { handleOwnerMessage } = await import("@/lib/coordination/orchestrator");
    await handleOwnerMessage({ userId, agent: owner, conversationId: conv, text });
    return (await admin().from("messages").select("content, metadata").eq("conversation_id", conv).not("sender_agent_id", "is", null).order("created_at", { ascending: false }).limit(1).single()).data!;
  };

  it("answers with the best value (well-reviewed first), sends only the stay, links each hotel, says it's test data", async () => {
    requests.length = 0;
    const [checkin, checkout] = [inDays(30), inDays(32)];
    const reply = await ask(`hotels in Rome from ${checkin} to ${checkout} for 2`);
    expect(reply.content).toContain("🏨 Rome ·");
    expect(reply.content).toContain("(2 nights) · 2 adults");
    expect(reply.content.split("\n").filter((l: string) => /^\d\. /.test(l))).toEqual(["1. **Albergo Uno** ★★★★ · 8.8/10 (1,200 reviews)", "2. **Palazzo Quattro** ★★★★ · 8.0/10 (1,200 reviews)", "3. **Hotel Due** ★★★★ · 9.1/10 (1,200 reviews)"]);
    expect(reply.content).toContain("£240 for 2 nights (£120 a night) · breakfast included · refundable");
    expect(reply.content).toContain("+ £12 taxes paid at the hotel");
    expect(reply.content).toContain("🧪 Test data");
    expect(reply.metadata).toMatchObject({ kind: "hotels_answer", hotels: "found", sources: [{ title: "Albergo Uno", url: expect.stringContaining("google.com/search") }, { title: "Palazzo Quattro" }, { title: "Hotel Due" }] });
    // Only the stay goes to the provider: city, country, nights, rooms, currency (and a fixed market). Nothing about the owner.
    expect(requests).toHaveLength(1);
    expect(requests[0].key).toBe("sand_fake");
    expect(requests[0].body).toEqual({ cityName: "Rome", countryCode: "IT", checkin, checkout, occupancies: [{ adults: 2 }], currency: "GBP", guestNationality: "GB", limit: 60, maxRatesPerHotel: 1, includeHotelData: true, timeout: 8 });
    expect(JSON.stringify(requests)).not.toContain("Traveller");
  });

  it("asks for the nights, and the reply completes the request; a budget nothing fits says so", async () => {
    const first = await ask("any hotels in Rome?");
    expect(first.content).toBe('Which nights do you want to stay in Rome? For example: "12 to 14 December".');
    expect(first.metadata).toMatchObject({ kind: "hotels_ask" });
    const second = await ask(`from ${inDays(40)} to ${inDays(43)}`);
    expect(second.content).toContain("(3 nights)");
    const budget = await ask(`hotels in Rome from ${inDays(40)} to ${inDays(41)} under £100`);
    expect(budget.content).toContain("None of the 4 hotels with rooms is within £100 a night. The cheapest is £150 a night.");
  });
});
