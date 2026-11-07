import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { signAgentToken, verifyAgentToken } from "@/lib/a2a/auth";

const SECRET = "test-secret-test-secret-test-secret-42";

describe("agent tokens", () => {
  it("round-trips claims for the intended recipient", async () => {
    const token = await signAgentToken({ sub: "agent-1", recipient: "marco", tid: "t1", xid: "x1" }, SECRET);
    expect(await verifyAgentToken(`Bearer ${token}`, "marco", SECRET)).toEqual({
      ok: true,
      claims: { sub: "agent-1", recipient: "marco", tid: "t1", xid: "x1" },
    });
  });

  it("rejects a token addressed to another agent (no replay)", async () => {
    const token = await signAgentToken({ sub: "agent-1", recipient: "marco" }, SECRET);
    expect(await verifyAgentToken(`Bearer ${token}`, "paul", SECRET)).toEqual({ ok: false, reason: "wrong_recipient" });
  });

  it("rejects forged, expired and missing tokens", async () => {
    const forged = await signAgentToken({ sub: "agent-1", recipient: "marco" }, "another-secret-another-secret-123456");
    expect(await verifyAgentToken(`Bearer ${forged}`, "marco", SECRET)).toEqual({ ok: false, reason: "invalid" });

    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("agentme")
      .setSubject("agent-1")
      .setAudience("agent:marco")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyAgentToken(`Bearer ${expired}`, "marco", SECRET)).toEqual({ ok: false, reason: "expired" });

    expect(await verifyAgentToken(null, "marco", SECRET)).toEqual({ ok: false, reason: "missing" });
    expect(await verifyAgentToken("Bearer not.a.jwt", "marco", SECRET)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects alg=none tokens", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: "agentme", sub: "agent-1", aud: "agent:marco", exp: 9999999999 })).toString("base64url");
    expect(await verifyAgentToken(`Bearer ${header}.${payload}.`, "marco", SECRET)).toEqual({ ok: false, reason: "invalid" });
  });
});
