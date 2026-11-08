import "server-only";
import { env } from "@/lib/env";

/**
 * Reading someone's email contacts (Google / Microsoft) with their permission,
 * once, to find people they know. Read-only scopes; the access token is used
 * for this one sync and never stored.
 *
 * Needs an OAuth app per provider (GOOGLE_CLIENT_ID/SECRET,
 * MICROSOFT_CLIENT_ID/SECRET). Without keys, development simulates the
 * provider with the demo accounts, so the flow can be tried locally.
 */
export const PROVIDERS = ["google", "microsoft"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const isProvider = (p: string): p is Provider => (PROVIDERS as readonly string[]).includes(p);

export const PROVIDER_LABEL: Record<Provider, string> = { google: "Gmail", microsoft: "Outlook / Hotmail" };

type Config = { clientId: string; clientSecret: string };
function config(p: Provider): Config | null {
  const id = process.env[p === "google" ? "GOOGLE_CLIENT_ID" : "MICROSOFT_CLIENT_ID"];
  const secret = process.env[p === "google" ? "GOOGLE_CLIENT_SECRET" : "MICROSOFT_CLIENT_SECRET"];
  return id && secret ? { clientId: id, clientSecret: secret } : null;
}

/** "real" with keys, "simulated" in development without keys, "off" otherwise. */
export function providerMode(p: Provider): "real" | "simulated" | "off" {
  if (config(p)) return "real";
  const simulate = process.env.CONTACTS_PROVIDER ?? (process.env.NODE_ENV === "production" ? "" : "dev");
  return simulate === "dev" ? "simulated" : "off";
}

/** Which provider fits an email address (to highlight it). */
export function providerForEmail(email: string | null): Provider | null {
  const domain = email?.split("@")[1]?.toLowerCase() ?? "";
  if (["gmail.com", "googlemail.com"].includes(domain)) return "google";
  if (/^(hotmail|outlook|live|msn)\./.test(domain)) return "microsoft";
  return null;
}

const redirectUri = (p: Provider) => `${env.appUrl.replace(/\/$/, "")}/api/contacts/${p}/callback`;

export function authUrl(p: Provider, state: string): string {
  const c = config(p)!;
  if (p === "google") {
    const q = new URLSearchParams({
      client_id: c.clientId,
      redirect_uri: redirectUri(p),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/contacts.readonly",
      access_type: "online",
      include_granted_scopes: "true",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  const q = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri(p),
    response_type: "code",
    response_mode: "query",
    scope: "Contacts.Read",
    state,
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${q}`;
}

async function exchange(p: Provider, code: string): Promise<string> {
  const c = config(p)!;
  const url = p === "google" ? "https://oauth2.googleapis.com/token" : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code,
    redirect_uri: redirectUri(p),
    grant_type: "authorization_code",
    ...(p === "microsoft" ? { scope: "Contacts.Read" } : {}),
  });
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const json = (await res.json()) as { access_token?: string };
  if (!res.ok || !json.access_token) throw new Error("token exchange failed");
  return json.access_token;
}

type GooglePage = {
  connections?: { emailAddresses?: { value?: string }[]; phoneNumbers?: { value?: string; canonicalForm?: string }[] }[];
  nextPageToken?: string;
};
type GraphPage = {
  value?: { emailAddresses?: { address?: string }[]; mobilePhone?: string | null; homePhones?: string[]; businessPhones?: string[] }[];
  "@odata.nextLink"?: string;
};

/** Emails and phone numbers only, from one page of a provider's response. */
export function entriesFromGoogle(page: GooglePage): string[] {
  return (page.connections ?? []).flatMap((c) => [
    ...(c.emailAddresses ?? []).map((e) => e.value ?? ""),
    // canonicalForm is already international (E.164) when Google could parse it.
    ...(c.phoneNumbers ?? []).map((n) => n.canonicalForm ?? n.value ?? ""),
  ]).filter(Boolean);
}
export function entriesFromGraph(page: GraphPage): string[] {
  return (page.value ?? []).flatMap((c) => [
    ...(c.emailAddresses ?? []).map((e) => e.address ?? ""),
    c.mobilePhone ?? "",
    ...(c.homePhones ?? []),
    ...(c.businessPhones ?? []),
  ]).filter(Boolean);
}

const MAX_PAGES = 10;

/** Exchanges the code and reads the contact list (emails and numbers only). */
export async function fetchContacts(p: Provider, code: string): Promise<string[]> {
  const token = await exchange(p, code);
  const headers = { authorization: `Bearer ${token}` };
  const entries: string[] = [];
  if (p === "google") {
    let pageToken = "";
    for (let i = 0; i < MAX_PAGES; i++) {
      const q = new URLSearchParams({ personFields: "emailAddresses,phoneNumbers", pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
      const res = await fetch(`https://people.googleapis.com/v1/people/me/connections?${q}`, { headers });
      if (!res.ok) throw new Error("google contacts failed");
      const page = (await res.json()) as GooglePage;
      entries.push(...entriesFromGoogle(page));
      if (!page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }
  } else {
    let next: string | undefined = "https://graph.microsoft.com/v1.0/me/contacts?$select=emailAddresses,mobilePhone,homePhones,businessPhones&$top=500";
    for (let i = 0; i < MAX_PAGES && next; i++) {
      const res: Response = await fetch(next, { headers });
      if (!res.ok) throw new Error("microsoft contacts failed");
      const page = (await res.json()) as GraphPage;
      entries.push(...entriesFromGraph(page));
      next = page["@odata.nextLink"];
    }
  }
  return entries;
}

/** Development only: an address book made of the demo accounts. */
export const SIMULATED_CONTACTS = ["luca@agentme.test", "marco@agentme.test", "paul@agentme.test", "eve@agentme.test", "a.friend@example.com"];
