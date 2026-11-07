import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

const ISSUER = "agentme";
const TTL_SECONDS = 120;

export type AgentTokenClaims = {
  /** Sending agent id */
  sub: string;
  /** Recipient handle this token is valid for */
  recipient: string;
  /** AGENTME task this exchange belongs to (optional) */
  tid?: string;
  /** task_exchanges row the recipient should record into (optional) */
  xid?: string;
};

function key(secret: string) {
  return new TextEncoder().encode(secret);
}

/**
 * Short-lived platform-signed token proving which agent is calling. Scoped to a
 * single recipient (audience) so it can't be replayed against another agent.
 */
export async function signAgentToken(claims: AgentTokenClaims, secret: string): Promise<string> {
  const jwt = new SignJWT({ ...(claims.tid ? { tid: claims.tid } : {}), ...(claims.xid ? { xid: claims.xid } : {}) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setSubject(claims.sub)
    .setAudience(`agent:${claims.recipient}`)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${TTL_SECONDS}s`);
  return jwt.sign(key(secret));
}

export type VerifyResult =
  | { ok: true; claims: AgentTokenClaims }
  | { ok: false; reason: "missing" | "expired" | "invalid" | "wrong_recipient" };

export async function verifyAgentToken(
  authorization: string | null | undefined,
  recipientHandle: string,
  secret: string,
): Promise<VerifyResult> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { ok: false, reason: "missing" };
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: `agent:${recipientHandle}`,
      algorithms: ["HS256"],
    });
    if (!payload.sub) return { ok: false, reason: "invalid" };
    return {
      ok: true,
      claims: {
        sub: payload.sub,
        recipient: recipientHandle,
        tid: typeof payload.tid === "string" ? payload.tid : undefined,
        xid: typeof payload.xid === "string" ? payload.xid : undefined,
      },
    };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired" };
    if (error instanceof joseErrors.JWTClaimValidationFailed && error.claim === "aud") {
      return { ok: false, reason: "wrong_recipient" };
    }
    return { ok: false, reason: "invalid" };
  }
}
