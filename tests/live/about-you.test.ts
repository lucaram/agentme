/**
 * "What your agent knows about you": saving topics, your own topics, time away
 * that expires, notes that can never be shared, and "Shall I remember…?".
 * Throwaway user, deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, dbUp } from "./env";

type AgentRow = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/agents").getAgentById>>>;
const run = Math.random().toString(36).slice(2, 7);
let userId = "";
let agent: AgentRow;

const lib = async () => ({
  save: await import("@/lib/profile/save"),
  offer: await import("@/lib/profile/offer"),
  agents: await import("@/lib/data/agents"),
  chat: await import("@/lib/data/chat"),
});

describe.skipIf(!dbUp)("what your agent knows about you (live)", () => {
  beforeAll(async () => {
    const db = admin();
    const { data: created, error } = await db.auth.admin.createUser({ email: `ty${run}@about.test`, password: "about-you-password", email_confirm: true });
    if (error) throw error;
    userId = created.user.id;
    const { data } = await db.from("agents").insert({ owner_id: userId, handle: `ty${run}`, display_name: "Test", avatar: "🦊" }).select("*").single();
    agent = data!;
  });

  afterAll(async () => {
    await admin().from("conversations").delete().eq("created_by", userId);
    await admin().auth.admin.deleteUser(userId);
  });

  it("saves topics with their sharing; empty removes; notes are always private", async () => {
    const { save, agents } = await lib();
    expect(await save.saveFact(agent.id, { category: "interests", value: "Climbing", share: true })).toEqual({ ok: true });
    expect(await save.saveFact(agent.id, { category: "budget", value: "££", share: false })).toEqual({ ok: true });
    expect(await save.saveFact(agent.id, { category: "notes", value: "Secret", share: true })).toEqual({ ok: true });
    const facts = await agents.getFacts(agent.id);
    expect(facts.find((f) => f.category === "notes")?.disclosure).toBe("private");
    expect(facts.find((f) => f.category === "interests")?.disclosure).toBe("contacts");
    await save.saveFact(agent.id, { category: "budget", value: "", share: false });
    expect((await agents.getFacts(agent.id)).some((f) => f.category === "budget")).toBe(false);
    // The database refuses shared notes even if the app didn't.
    const { error } = await admin().from("agent_facts").update({ disclosure: "contacts" }).eq("agent_id", agent.id).eq("category", "notes");
    expect(error).not.toBeNull();
  });

  it("your own topics: named, same name means same topic, up to 5", async () => {
    const { save, agents } = await lib();
    expect(await save.saveFact(agent.id, { category: "custom", label: "", value: "x", share: true })).toMatchObject({ ok: false });
    await save.saveFact(agent.id, { category: "custom", label: "music i like", value: "Jazz", share: true });
    await save.saveFact(agent.id, { category: "custom", label: "Music I Like", value: "Jazz, soul", share: true });
    const music = (await agents.getFacts(agent.id)).filter((f) => f.category === "custom");
    expect(music).toEqual([{ category: "custom", label: "Music I Like", value: "Jazz, soul", disclosure: "contacts" }]);
    for (const n of [2, 3, 4, 5]) expect(await save.saveFact(agent.id, { category: "custom", label: `Topic ${n}`, value: "v", share: false })).toEqual({ ok: true });
    expect(await save.saveFact(agent.id, { category: "custom", label: "Topic 6", value: "v", share: false })).toMatchObject({ ok: false, error: expect.stringContaining("5") });
  });

  it("time away is forgotten by itself after its day", async () => {
    const { save, agents } = await lib();
    expect(await save.saveFact(agent.id, { category: "away", value: "Away until yesterday", share: true, expiresAt: new Date(Date.now() - 3600_000).toISOString() })).toMatchObject({ ok: false });
    await save.saveFact(agent.id, { category: "away", value: "Away until next week", share: true, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() });
    expect((await agents.getFacts(agent.id)).find((f) => f.category === "away")?.value).toBe("Away until next week");
    await admin().from("agent_facts").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("agent_id", agent.id).eq("category", "away");
    expect((await agents.getFacts(agent.id)).some((f) => f.category === "away")).toBe(false);
  });

  it("“I'm vegetarian now”: offered in My Agent, saved only after Save, added to what's there", async () => {
    const { save, offer, agents, chat } = await lib();
    await save.saveFact(agent.id, { category: "food", value: "Italian", share: true });
    const conv = await chat.getOrCreateMyAgentConversation(userId);
    await offer.offerProfileSave(agent, conv.id, "I'm vegetarian now");
    const { data: card } = await admin().from("messages").select("id, content, metadata").eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(1).single();
    expect(card?.content).toContain("“vegetarian”");
    expect((await agents.getFacts(agent.id)).find((f) => f.category === "food")?.value).toBe("Italian"); // not yet
    // Someone else can't answer it.
    expect(await offer.answerSuggestion("00000000-0000-0000-0000-000000000000", agent, card!.id, true)).toMatchObject({ ok: false });
    expect(await offer.answerSuggestion(userId, agent, card!.id, true)).toEqual({ ok: true });
    expect((await agents.getFacts(agent.id)).find((f) => f.category === "food")).toMatchObject({ value: "Italian, vegetarian", disclosure: "contacts" });
    // Already known: not offered again.
    const before = (await admin().from("messages").select("*", { count: "exact", head: true }).eq("conversation_id", conv.id)).count;
    await offer.offerProfileSave(agent, conv.id, "I'm vegetarian now");
    expect((await admin().from("messages").select("*", { count: "exact", head: true }).eq("conversation_id", conv.id)).count).toBe(before);
  });

  it("from what you say in My Agent: adds, updates and removes, always showing old and new, and only on your tap", async () => {
    const { save, offer, agents, chat } = await lib();
    await save.saveFact(agent.id, { category: "availability", value: "Saturdays after 7 PM; Sundays all day", share: true });
    await save.saveFact(agent.id, { category: "food", value: "vegetarian", share: false });
    const conv = await chat.getOrCreateMyAgentConversation(userId);
    const latest = async () => (await admin().from("messages").select("id, content, metadata").eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(1).single()).data!;
    const saved = async (category: string) => (await agents.getFacts(agent.id)).find((f) => f.category === category)?.value;
    const count = async () => (await admin().from("messages").select("*", { count: "exact", head: true }).eq("conversation_id", conv.id)).count;

    // New: offered, nothing saved until Save; shared like the section already is.
    await offer.offerProfileUpdates(agent, conv.id, "I'm also free on Tuesday and Thursday evenings too");
    let card = await latest();
    expect(card.content).toBe("💡 Save to When you're free: “Tuesday and Thursday evenings”?");
    expect(card.metadata).toMatchObject({ kind: "profile_update", shared: true });
    expect(await saved("availability")).toBe("Saturdays after 7 PM; Sundays all day");
    expect(await offer.answerProfileUpdate("00000000-0000-0000-0000-000000000000", agent, card.id, "apply")).toMatchObject({ ok: false });
    expect(await offer.answerProfileUpdate(userId, agent, card.id, "apply")).toEqual({ ok: true });
    expect(await saved("availability")).toBe("Saturdays after 7 PM; Sundays all day; Tuesday and Thursday evenings");

    // No longer true: asked first, showing exactly what goes.
    await offer.offerProfileUpdates(agent, conv.id, "I can't do Saturdays any more");
    card = await latest();
    expect(card.content).toBe("⚠️ You said you can't do Saturdays any more. Remove “Saturdays after 7 PM” from When you're free?");
    expect(await offer.answerProfileUpdate(userId, agent, card.id, "apply")).toEqual({ ok: true });
    expect(await saved("availability")).toBe("Sundays all day; Tuesday and Thursday evenings");

    // A contradiction: old and new on the card; "Keep both" keeps both; private stays private.
    await offer.offerProfileUpdates(agent, conv.id, "I eat fish now");
    card = await latest();
    expect(card.content).toBe("⚠️ You said you eat fish now. You've saved “vegetarian” in Lifestyle → Food & drink. Update it to “pescatarian”?");
    expect(card.metadata).toMatchObject({ shared: false });
    expect(await offer.answerProfileUpdate(userId, agent, card.id, "keep_both")).toEqual({ ok: true });
    expect(await saved("food")).toBe("vegetarian; pescatarian");

    // Changed in Settings meanwhile: not applied over it.
    await offer.offerProfileUpdates(agent, conv.id, "I eat fish now");
    expect(await count()).toBeGreaterThan(0);
    await save.saveFact(agent.id, { category: "food", value: "vegetarian", share: false });
    await offer.offerProfileUpdates(agent, conv.id, "I eat fish now");
    card = await latest();
    await save.saveFact(agent.id, { category: "food", value: "Italian", share: false });
    expect(await offer.answerProfileUpdate(userId, agent, card.id, "apply")).toMatchObject({ ok: false, error: expect.stringContaining("changed since") });
    expect(await saved("food")).toBe("Italian");

    // Already saved, a question, or about someone else: no card.
    const before = await count();
    for (const text of ["I'm also free on Sundays all day", "Am I free on Sunday?", "Marco is vegetarian", "Organise dinner with @marco"]) await offer.offerProfileUpdates(agent, conv.id, text);
    expect(await count()).toBe(before);
  });

  it("your own topics: offered by their name, updated with old and new shown, never recreated after you remove them", async () => {
    const { save, offer, agents, chat } = await lib();
    // The earlier test fills all 5 topics of your own: start from none.
    await admin().from("agent_facts").delete().eq("agent_id", agent.id).eq("category", "custom");
    expect(await save.saveFact(agent.id, { category: "custom", label: "My car", value: "Red Fiat 500", share: false })).toEqual({ ok: true });
    const conv = await chat.getOrCreateMyAgentConversation(userId);
    const latest = async () => (await admin().from("messages").select("id, content, metadata").eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(1).single()).data!;
    const car = async () => (await agents.getFacts(agent.id)).find((f) => f.category === "custom" && f.label === "My car")?.value;

    await offer.offerProfileUpdates(agent, conv.id, "I've just bought a blue Golf");
    let card = await latest();
    expect(card.content).toBe("⚠️ You said you've got blue Golf. You've saved “Red Fiat 500” in My car. Update it to “blue Golf”?");
    expect(card.metadata).toMatchObject({ kind: "profile_update", shared: false, update: { category: "custom", topic: "My car" } });
    expect(await car()).toBe("Red Fiat 500");
    expect(await offer.answerProfileUpdate(userId, agent, card.id, "apply")).toEqual({ ok: true });
    expect(await car()).toBe("blue Golf");

    // You removed the topic meanwhile: the card doesn't bring it back.
    await save.saveFact(agent.id, { category: "custom", label: "My car", value: "Red Fiat 500", share: false });
    await offer.offerProfileUpdates(agent, conv.id, "I've just bought a blue Golf");
    card = await latest();
    await save.saveFact(agent.id, { category: "custom", label: "My car", value: "", share: false });
    expect(await offer.answerProfileUpdate(userId, agent, card.id, "apply")).toMatchObject({ ok: false, error: expect.stringContaining("isn't one of your topics any more") });
    expect(await car()).toBeUndefined();
  });
});
