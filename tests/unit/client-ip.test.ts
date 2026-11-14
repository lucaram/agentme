import { describe, expect, it } from "vitest";
import { ipTrustFromEnv, trustedClientIp } from "@/lib/a2a/client-ip";

const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });

describe("which address an anonymous caller is rate-limited by", () => {
  it("by default no header is trusted: a caller can't give itself a new allowance by writing one", () => {
    const trust = ipTrustFromEnv({});
    expect(trust).toEqual({ header: null, hops: null });
    for (const forged of ["1.2.3.4", "5.6.7.8", "9.9.9.9, 1.1.1.1"]) {
      expect(trustedClientIp(headers({ "x-forwarded-for": forged, "x-real-ip": forged }), trust)).toBeNull();
    }
  });

  it("behind one proxy, the address that proxy saw is used, whatever the caller wrote before it", () => {
    const trust = ipTrustFromEnv({ TRUSTED_PROXY_HOPS: "1" });
    // The proxy appends the real address; anything earlier came from the caller.
    expect(trustedClientIp(headers({ "x-forwarded-for": "203.0.113.7" }), trust)).toBe("203.0.113.7");
    expect(trustedClientIp(headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }), trust)).toBe("203.0.113.7");
    expect(trustedClientIp(headers({ "x-forwarded-for": "8.8.8.8, 1.1.1.1, 203.0.113.7" }), trust)).toBe("203.0.113.7");
  });

  it("behind two proxies, the entry two from the end; a shorter chain didn't come through them", () => {
    const trust = ipTrustFromEnv({ TRUSTED_PROXY_HOPS: "2" });
    expect(trustedClientIp(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" }), trust)).toBe("203.0.113.7");
    expect(trustedClientIp(headers({ "x-forwarded-for": "203.0.113.7" }), trust)).toBeNull();
    expect(trustedClientIp(headers({}), trust)).toBeNull();
  });

  it("a header the host sets itself is used; X-Forwarded-For is then ignored", () => {
    const trust = ipTrustFromEnv({ TRUSTED_IP_HEADER: "CF-Connecting-IP" });
    expect(trust.header).toBe("cf-connecting-ip");
    expect(trustedClientIp(headers({ "cf-connecting-ip": "2001:db8::1", "x-forwarded-for": "1.2.3.4" }), trust)).toBe("2001:db8::1");
    expect(trustedClientIp(headers({ "x-forwarded-for": "1.2.3.4" }), trust)).toBeNull();
  });

  it("only real-looking addresses, and sensible settings", () => {
    const trust = ipTrustFromEnv({ TRUSTED_PROXY_HOPS: "1" });
    expect(trustedClientIp(headers({ "x-forwarded-for": "not an address; drop table" }), trust)).toBeNull();
    for (const bad of ["0", "-1", "abc", "1.5", "100", ""]) expect(ipTrustFromEnv({ TRUSTED_PROXY_HOPS: bad }).hops).toBeNull();
    expect(ipTrustFromEnv({ TRUSTED_PROXY_HOPS: " 3 " }).hops).toBe(3);
  });
});
