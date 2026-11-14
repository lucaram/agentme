import "server-only";
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { checkUrl, isPublicAddress } from "./extract";

/** No bytes for this long: give up. */
const TIMEOUT_MS = 10_000;
/**
 * The whole download (redirects included) must finish within this, however it trickles in. The idle
 * timeout alone lets a server keep a connection open for ever by sending a byte now and then.
 */
export const DEADLINE_MS = 20_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/**
 * Local pages are allowed only for development/tests with ALLOW_LOCAL_FETCH=1
 * (never in production), so the demo menu can be served by the app itself.
 */
export const allowLocal = () => process.env.NODE_ENV !== "production" && process.env.ALLOW_LOCAL_FETCH === "1";

/**
 * Resolves the hostname and refuses non-public addresses AT CONNECT TIME, so
 * neither a hostname nor a redirect (nor DNS rebinding) can reach internal
 * machines or cloud metadata.
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses as unknown as string, family: 4 }];
    const ok = list.filter((a) => allowLocal() || isPublicAddress(a.address));
    if (!ok.length) return callback(new Error("blocked_address"), "", 4);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof ok) => void)(null, ok);
    callback(null, ok[0].address, ok[0].family);
  });
};

export type Fetched = { contentType: string; body: Buffer; finalUrl: string };

/** GET a public web page/file with strict limits. Throws an Error with a user-readable message. */
export async function safeFetch(raw: string, redirects = 0, deadlineAt = Date.now() + DEADLINE_MS): Promise<Fetched> {
  const check = checkUrl(raw, { allowLocal: allowLocal() });
  if (!check.ok) throw new Error(check.error);
  const url = check.url;
  if (url.hostname === "localhost" && !allowLocal()) throw new Error("That doesn't look like a public website.");
  // A raw IP address skips the DNS lookup (and so the connect-time check): check it here.
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) && !allowLocal() && !isPublicAddress(literal)) throw new Error("That address isn't a public website.");
  const client = url.protocol === "https:" ? https : http;

  const left = deadlineAt - Date.now();
  if (left <= 0) throw new Error("The website took too long to answer.");

  return new Promise<Fetched>((done, fail) => {
    // Settles once: the deadline, the idle timeout, an error or the end of the download, whichever is first.
    let settled = false;
    const resolve = (value: Fetched) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      done(value);
    };
    const reject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fail(error);
    };
    const deadline = setTimeout(() => {
      reject(new Error("The website took too long to answer."));
      req.destroy();
    }, left);
    const req = client.get(
      url,
      {
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: { "user-agent": "AGENTME business reader (+https://agentme.app)", accept: "text/html,application/pdf,image/*,text/plain;q=0.8,*/*;q=0.1" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          // Closed, not drained: a redirect whose body never ends would otherwise stream on past the deadline.
          res.destroy();
          if (redirects >= MAX_REDIRECTS) return reject(new Error("Too many redirects."));
          // Every hop is checked again (scheme, host and resolved address).
          // The same deadline covers the whole chain of redirects.
          clearTimeout(deadline);
          return safeFetch(new URL(res.headers.location, url).toString(), redirects + 1, deadlineAt).then(resolve, reject);
        }
        if (status !== 200) {
          res.destroy();
          return reject(new Error(`The website answered with an error (${status}).`));
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > MAX_BYTES) {
          res.destroy();
          return reject(new Error("That file is too big (over 5 MB)."));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.destroy();
            reject(new Error("That file is too big (over 5 MB)."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ contentType: String(res.headers["content-type"] ?? "").toLowerCase(), body: Buffer.concat(chunks), finalUrl: url.toString() }));
        res.on("error", () => reject(new Error("The download was interrupted.")));
      },
    );
    req.on("timeout", () => req.destroy(new Error("The website took too long to answer.")));
    req.on("error", (e) => reject(new Error(e.message === "blocked_address" ? "That address isn't a public website." : e.message.startsWith("The ") ? e.message : "Couldn't reach that website.")));
  });
}
