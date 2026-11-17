import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { dbUp } from "./env";
import { businessTeamsFixture } from "../fixtures/business-teams";
import { commitAvatar, pruneAvatarFiles } from "@/lib/profile/avatar-server";
import { AVATAR_BUCKET } from "@/lib/profile/avatar";
import { GET } from "@/app/api/avatars/[id]/route";

describe.skipIf(!dbUp)("published avatar access and business permissions", () => {
  let f: Awaited<ReturnType<typeof businessTeamsFixture>>;
  beforeEach(async () => { f = await businessTeamsFixture(); });
  afterEach(async () => { await f?.cleanup(); await pruneAvatarFiles(); });
  const image = () => sharp({ create: { width: 512, height: 512, channels: 4, background: "blue" } }).webp().toBuffer();
  const get = (url: string) => GET(new Request(`http://localhost${url}`), { params: Promise.resolve({ id: url.split("/").at(-1)! }) });
  it("publishes only the selected image, revokes old URLs and removes replaced files", async () => {
    const url = await commitAvatar(f.luca.agent.id, f.luca.userId, await image(), "🦊");
    const response = await get(url); expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("image/webp"); expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await f.worker.from("profile_avatar_assets").select("path")).error).toBeTruthy();
    const old = (await f.db.from("profile_avatar_assets").select("path").eq("agent_id", f.luca.agent.id).single()).data!;
    const next = await commitAvatar(f.luca.agent.id, f.luca.userId, await image(), "🦊"); expect(next).not.toBe(url); expect((await get(url)).status).toBe(404);
    await pruneAvatarFiles(); expect((await f.db.storage.from(AVATAR_BUCKET).download(old.path)).error).toBeTruthy();
    await commitAvatar(f.luca.agent.id, f.luca.userId, null, "🦊"); expect((await get(next)).status).toBe(404);
  });
  it("keeps personal/business avatars separate and rechecks live Staff/Manager roles", async () => {
    const personal = await commitAvatar(f.marco.agent.id, f.marco.userId, await image(), "🦊");
    const business = await commitAvatar(f.business.agent.id, f.marco.userId, await image(), "🏪"); expect(business).not.toBe(personal);
    await expect(commitAvatar(f.business.agent.id, f.luca.userId, await image(), "🏪")).rejects.toThrow("Couldn't save");
    await expect(commitAvatar(f.paul.agent.id, f.marco.userId, await image(), "🦊")).rejects.toThrow("Couldn't save");
    expect((await f.manager1.rpc("commit_profile_avatar", { p_agent: f.business.agent.id, p_actor: f.marco.userId, p_preset: "🏪" })).error?.code).toBe("42501");
    await f.owner.rpc("change_business_member", { p_user: f.marco.userId, p_role: "staff" });
    await expect(commitAvatar(f.business.agent.id, f.marco.userId, await image(), "🏪")).rejects.toThrow("Couldn't save");
    expect((await get(personal)).status).toBe(200);
  });
  it("prevents assigning another person's asset and denies deleted account images", async () => {
    const url = await commitAvatar(f.eve.agent.id, f.eve.userId, await image(), "🦊");
    expect((await f.db.from("agents").update({ avatar: url }).eq("id", f.marco.agent.id)).error).toBeTruthy();
    await f.db.auth.admin.deleteUser(f.eve.userId); expect((await get(url)).status).toBe(404);
  });
});
