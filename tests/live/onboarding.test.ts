import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbUp, ANON_KEY, SUPABASE_URL } from "./env";
import { onboardingFixture } from "../fixtures/onboarding";
import { BUSINESS_AVATARS, AVATARS } from "@/lib/avatars";
import { TOPICS } from "@/lib/profile/topics";

const auth = vi.hoisted(() => ({ user: { id: "", email: "", emailConfirmed: true, isAnonymous: false } }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => auth.user }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/business/site-setup", () => ({ attachWebsite: vi.fn(async () => ({ ok: true })) }));

describe.skipIf(!dbUp)("onboarding saves optional details and guards setup state", () => {
  let f: Awaited<ReturnType<typeof onboardingFixture>>;
  beforeEach(async () => { f = await onboardingFixture(); const user = await f.user(); auth.user = { ...user, emailConfirmed: true, isAnonymous: false }; });
  afterEach(async () => { await f.cleanup(); });
  const form = (values: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };

  it("saves personal fields privately by default, honours chosen sharing and never shares notes", async () => {
    const { createAgent } = await import("@/app/onboarding/actions");
    await expect(createAgent(undefined, form({ type: "personal", display_name: "New Person", handle: `person_${f.tag}`, avatar: AVATARS[0], availability: "Saturday evenings", food: "Vegetarian", notes: "Private condition", share_food: "on", share_notes: "on", next: "/contacts?invite=accepted" }))).rejects.toThrow("redirect:/contacts?invite=accepted");
    const { data: agent } = await f.db.from("agents").select("id").eq("owner_id", auth.user.id).single();
    const { data: facts } = await f.db.from("agent_facts").select("category,value,disclosure").eq("agent_id", agent!.id);
    expect(facts).toEqual(expect.arrayContaining([
      { category: "availability", value: "Saturday evenings", disclosure: "private" },
      { category: "food", value: "Vegetarian", disclosure: "contacts" },
      { category: "notes", value: "Private condition", disclosure: "private" },
    ]));
    expect(TOPICS.every((topic) => !topic.shareByDefault)).toBe(true);
  });

  it("rejects incomplete or overlong optional details before creating anything", async () => {
    const { createAgent } = await import("@/app/onboarding/actions");
    const data = form({ type: "business", display_name: "New Business", handle: `biz_${f.tag}`, avatar: BUSINESS_AVATARS[0], faq_q_1: "Do you allow dogs?" });
    expect(await createAgent(undefined, data)).toMatchObject({ error: expect.stringContaining("both") });
    data.set("faq_a_1", "Yes"); data.set("description", "x".repeat(501));
    expect(await createAgent(undefined, data)).toMatchObject({ error: expect.stringContaining("500") });
    expect((await f.db.from("agents").select("id").eq("owner_id", auth.user.id)).data).toEqual([]);
  });

  it("stores one business website and all supplied fields without forcing review or losing an invite", async () => {
    const { createAgent } = await import("@/app/onboarding/actions");
    await expect(createAgent(undefined, form({ type: "business", display_name: "New Business", handle: `biz_${f.tag}`, avatar: BUSINESS_AVATARS[0], description: "Neighbourhood cafe.", hours: "Tue–Sun 9–17", faq_q_1: "Dogs?", faq_a_1: "Welcome.", website: "cafe.example/menu/", next: "/groups?invitation=join" }))).rejects.toThrow("redirect:/groups?invitation=join");
    const { data: agent } = await f.db.from("agents").select("id,business_info").eq("owner_id", auth.user.id).single();
    expect(agent!.business_info).toMatchObject({ about: "Neighbourhood cafe.", description: "Neighbourhood cafe.", hours: "Tue–Sun 9–17", website: "https://cafe.example/menu/", faqs: [{ q: "Dogs?", a: "Welcome." }] });
    expect((await f.db.from("business_managers").select("role").eq("business_agent_id", agent!.id).single()).data?.role).toBe("owner");
    expect((await f.db.from("onboarding_state").select("dismissed_at").eq("user_id", auth.user.id).single()).data).toEqual({ dismissed_at: null });
  });

  it("suggests a valid available address when the obvious one is taken", async () => {
    const { suggestAvailableHandle } = await import("@/app/onboarding/actions");
    const handle = `same_${f.tag}`;
    expect((await f.db.from("agents").insert({ owner_id: auth.user.id, handle, display_name: "Existing", type: "personal" })).error).toBeNull();
    const result = await suggestAvailableHandle(handle);
    expect(result).toMatchObject({ ok: true, handle: `${handle}_2` });
    expect((await suggestAvailableHandle("agent")).handle).toBe("agent_me");
  });

  it("only lets an identity read and dismiss its own setup invitation", async () => {
    const second = await f.user();
    expect((await f.db.from("onboarding_state").insert([{ user_id: auth.user.id }, { user_id: second.id }])).error).toBeNull();
    const own = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    expect((await own.auth.signInWithPassword({ email: auth.user.email, password: f.password })).error).toBeNull();
    expect((await own.from("onboarding_state").select("user_id")).data).toEqual([{ user_id: auth.user.id }]);
    expect((await own.from("onboarding_state").update({ dismissed_at: new Date().toISOString() }).eq("user_id", second.id).select()).data).toEqual([]);
    expect((await own.from("onboarding_state").update({ dismissed_at: new Date().toISOString() }).eq("user_id", auth.user.id)).error).toBeNull();
    expect((await f.db.from("onboarding_state").select("dismissed_at").eq("user_id", second.id).single()).data?.dismissed_at).toBeNull();
    expect((await own.from("onboarding_state").update({ user_id: second.id }).eq("user_id", auth.user.id)).error).toBeTruthy();
    await own.auth.signOut();
  });
});
