/**
 * The business link reader must never reach internal machines (SSRF): raw IPs,
 * loopback, private ranges and cloud metadata are refused before connecting.
 */
import { describe, expect, it } from "vitest";
import { safeFetch } from "@/lib/business/fetch";

describe("business link reader (security)", () => {
  for (const url of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/", "http://192.168.1.1/admin", "http://[::1]/", "http://0.0.0.0/"]) {
    it(`refuses ${url}`, async () => {
      await expect(safeFetch(url)).rejects.toThrow(/public website/);
    });
  }
  it("refuses localhost, odd ports and non-web schemes", async () => {
    await expect(safeFetch("http://localhost/")).rejects.toThrow(/public website/);
    await expect(safeFetch("https://example.com:8443/")).rejects.toThrow(/standard web addresses/);
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow(/https/);
  });
});
