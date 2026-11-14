import { siteDomain } from "./site";

/**
 * ✓ Verified: the two ways a business proves a website is its own, and what
 * each proof must satisfy. Pure (unit-tested).
 */

/**
 * "My email is at this domain" only proves anything when the email itself was
 * proved: the person clicked a link sent to that mailbox. Supabase marks an
 * address as confirmed WITHOUT that step when email confirmations are switched
 * off (as in this repository's local configuration), so the app can't tell
 * from the account alone. The deployment says so explicitly:
 * EMAIL_CONFIRMATION_ENFORCED=1 means "this Supabase project makes people
 * confirm their email before they can sign in". Without it, an email never
 * verifies a website; the code on the homepage still does.
 */
export function emailProofEnforced(env: Record<string, string | undefined> = process.env): boolean {
  return env.EMAIL_CONFIRMATION_ENFORCED === "1";
}

/**
 * Where the code must be: the homepage of the website itself (the root of its
 * address), over https. Not a page somewhere under it: on a shared host
 * ("sites.example.com/my-shop") a page of yours would otherwise prove you own
 * the whole host. `allowLocal`: development and tests, where the site is
 * served over http on this machine.
 */
export function homepageToVerify(siteUrl: string, opts: { allowLocal?: boolean } = {}): string | null {
  let url: URL;
  try {
    url = new URL("/", siteUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && !(opts.allowLocal && url.protocol === "http:")) return null;
  return url.toString();
}

/**
 * The page that was finally read must still be on the website being verified.
 * A homepage that redirects elsewhere proves nothing about this domain: the
 * code would have been read from the other website.
 */
export function readFromSameSite(finalUrl: string, domain: string): boolean {
  try {
    return siteDomain(new URL(finalUrl).hostname) === siteDomain(domain);
  } catch {
    return false;
  }
}
