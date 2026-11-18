/**
 * Flight prices in My Agent: the request is understood, checked (or one question back), sent to the
 * flight provider as the trip only, and answered by code with the cheapest options. A small local
 * server stands in for Duffel; a throwaway owner, deleted afterwards.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, dbUp } from "./env";

type AgentRow = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>>>;
const run = Math.random().toString(36).slice(2, 7);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const offer = (amount: string, airline: string, dep: string, arr: string, stops = 0) => ({
  total_amount: amount, total_currency: "GBP", owner: { name: airline },
  slices: [{ duration: "PT2H35M", segments: Array.from({ length: stops + 1 }, (_, i) => ({ origin: { iata_code: i ? "MXP" : "LGW" }, destination: { iata_code: i === stops ? "FCO" : "MXP" }, departing_at: dep, arriving_at: arr })) }],
});

describe.skipIf(!dbUp)("flight prices in My Agent (live)", () => {
  let server: Server;
  const requests: { path: string; body: unknown; auth: string }[] = [];
  const env = { base: process.env.DUFFEL_API_BASE, token: process.env.DUFFEL_ACCESS_TOKEN };
  let owner: AgentRow;
  let conv: string;
  let userId: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        requests.push({ path: req.url ?? "", body: raw ? JSON.parse(raw) : null, auth: req.headers.authorization ?? "" });
        res.setHeader("content-type", "application/json");
        if (req.url?.startsWith("/places/suggestions")) {
          const q = new URL(req.url, "http://x").searchParams.get("query")?.toLowerCase();
          const city = q === "london" ? { type: "city", iata_code: "LON", name: "London" } : q === "rome" ? { type: "city", iata_code: "ROM", name: "Rome" } : null;
          return res.end(JSON.stringify({ data: city ? [city, { type: "airport", iata_code: "XXX", name: `${city.name} Airport` }] : [] }));
        }
        if (req.url?.startsWith("/air/offer_requests")) {
          const d = (JSON.parse(raw) as { data: { slices: { departure_date: string }[] } }).data.slices[0].departure_date;
          return res.end(JSON.stringify({ data: { offers: [
            offer("98.40", "ITA", `${d}T09:00:00`, `${d}T12:30:00`),
            offer("61.99", "easyJet", `${d}T06:45:00`, `${d}T10:20:00`),
            offer("61.99", "easyJet", `${d}T06:45:00`, `${d}T10:20:00`), // the same flight twice: shown once
            offer("75.10", "Lufthansa", `${d}T07:05:00`, `${d}T13:40:00`, 1),
            offer("120.00", "British Airways", `${d}T08:00:00`, `${d}T11:30:00`),
          ] } }));
        }
        res.statusCode = 404;
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.DUFFEL_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.DUFFEL_ACCESS_TOKEN = "duffel_test_fake";
    const { data: created, error } = await admin().auth.admin.createUser({ email: `fly${run}@flights.test`, password: "flights-password", email_confirm: true });
    if (error) throw error;
    userId = created.user.id;
    const { data } = await admin().from("agents").insert({ owner_id: userId, handle: `fly${run}`, display_name: "Flyer", type: "personal", contact_policy: "contacts_only" }).select("*").single();
    owner = data as AgentRow;
    conv = (await (await import("@/lib/data/chat")).getOrCreateMyAgentConversation(userId)).id;
  });
  afterAll(async () => {
    for (const [key, value] of [["DUFFEL_API_BASE", env.base], ["DUFFEL_ACCESS_TOKEN", env.token]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
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

  it("answers with the cheapest three, sends only the trip, links to compare, and says it's test data", async () => {
    requests.length = 0;
    const day = inDays(30);
    const reply = await ask(`cheapest flights from London to Rome on ${day} for 2`);
    expect(reply.content).toContain("✈️ London → Rome");
    expect(reply.content).toContain("2 adults");
    const lines = reply.content.split("\n").filter((l: string) => /^\d\. /.test(l));
    expect(lines).toEqual(["1. **easyJet** · £61.99 for 2 adults", "2. **Lufthansa** · £75.10 for 2 adults", "3. **ITA** · £98.40 for 2 adults"]);
    expect(reply.content).toContain("06:45 LGW → 10:20 FCO · direct · 2h 35m");
    expect(reply.content).toContain("1 stop");
    expect(reply.content).toContain("Cheapest of 4 options");
    expect(reply.content).toContain("🧪 Test data");
    expect(reply.metadata).toMatchObject({ kind: "flights_answer", flights: "found", sources: [{ url: expect.stringContaining("google.com/travel/flights"), title: "Compare and book (Google Flights)" }] });
    // Only the trip goes to the provider: places, the day, two adults, the cabin. Nothing about the owner.
    const search = requests.find((r) => r.path.startsWith("/air/offer_requests"))!;
    expect(search.auth).toBe("Bearer duffel_test_fake");
    expect(search.body).toEqual({ data: { slices: [{ origin: "LON", destination: "ROM", departure_date: day }], passengers: [{ type: "adult" }, { type: "adult" }], cabin_class: "economy" } });
    expect(JSON.stringify(requests)).not.toContain("Flyer");
  });

  it("asks for the missing day, and the reply completes the request", async () => {
    const first = await ask("any flights from London to Rome?");
    expect(first.content).toBe("Which day do you want to fly from London to Rome?");
    expect(first.metadata).toMatchObject({ kind: "flights_ask" });
    const day = inDays(45);
    const second = await ask(`on ${day}`);
    expect(second.content).toContain("✈️ London → Rome");
    expect(second.content).toMatch(/· 1 adult$/m);
  });

  it("an unknown place, a past day: one question back, nothing searched", async () => {
    requests.length = 0;
    expect((await ask(`flights from Narnia to Rome on ${inDays(20)}`)).content).toBe('I couldn\'t find an airport for "Narnia". Which city or airport do you mean?');
    expect((await ask(`flights from London to Rome on ${inDays(-3)}`)).content).toBe("That day has already passed. Which day do you want to fly?");
    expect(requests.some((r) => r.path.startsWith("/air/offer_requests"))).toBe(false);
  });
});
