import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, dbUp } from "./env";
import { BUSINESS_AVATARS } from "@/lib/avatars";

const auth = vi.hoisted(() => ({ user: { id: "", email: null as string | null, emailConfirmed: true, isAnonymous: false } }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => auth.user }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/business/site-setup", () => ({ attachWebsite: async () => ({ ok: false, error: "Temporary database failure" }) }));

describe.skipIf(!dbUp)("business website lifecycle", () => {
  const db = admin();
  let agentId = "";
  const tag = crypto.randomUUID().slice(0, 6);
  beforeAll(async () => {
    const email = `website_${tag}@agentme.test`;
    const { data, error } = await db.auth.admin.createUser({ email, password: "isolated-website-password", email_confirm: true });
    if (error) throw error;
    auth.user = { id: data.user.id, email, emailConfirmed: true, isAnonymous: false };
  });
  afterAll(async () => {
    if (!auth.user.id) return;
    await db.from("conversations").delete().eq("created_by", auth.user.id);
    await db.auth.admin.deleteUser(auth.user.id);
  });

  it("keeps the signup website available for retry if attachment fails", async () => {
    const { createAgent } = await import("@/app/onboarding/actions");
    const form = new FormData();
    const website = "retry.example/menu/";
    for (const [key, value] of Object.entries({ type: "business", display_name: "Website Retry", handle: `retry_${tag}`, avatar: BUSINESS_AVATARS[0], website })) form.set(key, value);
    await expect(createAgent(undefined, form)).rejects.toThrow(`redirect:/business?website=${encodeURIComponent(website)}&website_error=1`);
    const { data } = await db.from("agents").select("id,business_info").eq("owner_id", auth.user.id).single();
    expect(data?.id).toBeTruthy();
    expect(data?.business_info).toMatchObject({ website: "https://retry.example/menu/" });
    agentId = data!.id;
    expect((await db.from("business_sites").select("agent_id").eq("agent_id", agentId)).data).toEqual([]);
  });

  it("retains the last successful check after a failed manual read", async () => {
    const lastSuccess = "2026-10-01T12:00:00.000Z";
    // The fetch policy rejects this port before any network request.
    const { error } = await db.from("business_sites").insert({ agent_id: agentId, url: "https://invalid.example:12345/", domain: "invalid.example", status: "ready", last_success_at: lastSuccess, last_read_at: lastSuccess });
    if (error) throw error;
    const { readWebsite } = await import("@/lib/business/website");
    await readWebsite(agentId, "manual");
    const { data } = await db.from("business_sites").select("status,error,last_success_at,last_read_at,reading_started_at").eq("agent_id", agentId).single();
    expect(data).toMatchObject({ status: "error", error: expect.any(String), reading_started_at: null });
    expect(Date.parse(data!.last_success_at!)).toBe(Date.parse(lastSuccess));
    expect(Date.parse(data!.last_read_at!)).toBeGreaterThan(Date.parse(lastSuccess));
  });
});
