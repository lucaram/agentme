/**
 * Which address a request came from, for rate limiting anonymous callers.
 *
 * Headers like X-Forwarded-For are written by whoever sends the request unless
 * a proxy in front of the app overwrites them. Trusting them as they arrive
 * would let a caller pick a new "address" (and a fresh allowance) on every
 * request. So an address is only used when the deployment says where a
 * trustworthy one is:
 *
 *  - TRUSTED_IP_HEADER: a header your host sets itself and callers cannot
 *    forge (e.g. "cf-connecting-ip", "x-vercel-forwarded-for", "x-real-ip"
 *    behind your own nginx);
 *  - TRUSTED_PROXY_HOPS: how many proxies you run in front of the app. Each
 *    one appends the address it saw to X-Forwarded-For, so the entry that
 *    many places from the END is the last one written by a machine you
 *    control (1 for a single proxy).
 *
 * Neither set (the default): no address is trusted, and all anonymous callers
 * of an agent share one allowance. Pure (unit-tested).
 */
export type IpTrust = { header?: string | null; hops?: number | null };

/** From the environment: TRUSTED_IP_HEADER and/or TRUSTED_PROXY_HOPS. */
export function ipTrustFromEnv(env: Record<string, string | undefined> = process.env): IpTrust {
  const header = env.TRUSTED_IP_HEADER?.trim().toLowerCase() || null;
  const hops = /^[1-9]\d?$/.test(env.TRUSTED_PROXY_HOPS?.trim() ?? "") ? Number(env.TRUSTED_PROXY_HOPS) : null;
  return { header, hops };
}

const looksLikeIp = (v: string) => /^[0-9a-f:.]{3,45}$/i.test(v);

/** The caller's address when it can be trusted, otherwise null. */
export function trustedClientIp(headers: { get(name: string): string | null }, trust: IpTrust): string | null {
  if (trust.header) {
    const value = headers.get(trust.header)?.split(",")[0]?.trim();
    if (value && looksLikeIp(value)) return value;
  }
  if (trust.hops) {
    const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
    // Fewer entries than proxies: the request didn't come through them, so nothing in it is trustworthy.
    const value = chain.length >= trust.hops ? chain[chain.length - trust.hops] : undefined;
    if (value && looksLikeIp(value)) return value;
  }
  return null;
}
