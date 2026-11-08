import "server-only";
import { resolveMx } from "node:dns/promises";
import { env } from "@/lib/env";
import type { RawContact } from "./imports";

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

/** Well-known consumer domains, without a DNS lookup. */
export function providerForEmail(email: string | null): Provider | null {
  const domain = email?.split("@")[1]?.toLowerCase() ?? "";
  if (["gmail.com", "googlemail.com"].includes(domain)) return "google";
  if (/^(hotmail|outlook|live|msn)\./.test(domain)) return "microsoft";
  return null;
}

/** Who runs a domain's email, from its mail servers (MX): Google Workspace or Microsoft 365. */
export function providerFromMx(hosts: string[]): Provider | null {
  const all = hosts.map((h) => h.toLowerCase().replace(/\.$/, ""));
  if (all.some((h) => h.endsWith(".google.com") || h.endsWith(".googlemail.com"))) return "google";
  if (all.some((h) => h.endsWith(".outlook.com") || h.endsWith(".outlook.cn"))) return "microsoft";
  return null;
}

const mxCache = new Map<string, { provider: Provider | null; at: number }>();

/**
 * The contacts provider for the email someone registered with, whatever the
 * domain: consumer addresses directly, work/company domains from their MX
 * records. Null when the domain's contacts can't be read by apps (iCloud,
 * Yahoo, self-hosted, …).
 */
export async function detectProvider(email: string | null): Promise<Provider | null> {
  const known = providerForEmail(email);
  if (known) return known;
  const domain = email?.split("@")[1]?.toLowerCase();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.at < 3600_000) return cached.provider;
  let provider: Provider | null = null;
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("dns timeout")), 3000)),
    ]);
    provider = providerFromMx(records.map((r) => r.exchange));
  } catch {
    provider = null;
  }
  mxCache.set(domain, { provider, at: Date.now() });
  return provider;
}

const redirectUri = (p: Provider) => `${env.appUrl.replace(/\/$/, "")}/api/contacts/${p}/callback`;

/** loginHint: the account they registered with, so the right mailbox is pre-selected. */
export function authUrl(p: Provider, state: string, loginHint: string | null): string {
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
      ...(loginHint ? { login_hint: loginHint } : {}),
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
    ...(loginHint ? { login_hint: loginHint } : {}),
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
  connections?: {
    names?: { displayName?: string }[];
    emailAddresses?: { value?: string }[];
    phoneNumbers?: { value?: string; canonicalForm?: string }[];
  }[];
  nextPageToken?: string;
};
type GraphPage = {
  value?: { displayName?: string; emailAddresses?: { address?: string }[]; mobilePhone?: string | null; homePhones?: string[]; businessPhones?: string[] }[];
  "@odata.nextLink"?: string;
};

/** Name, emails and phone numbers only, from one page of a provider's response. */
export function contactsFromGoogle(page: GooglePage): RawContact[] {
  return (page.connections ?? []).map((c) => ({
    name: c.names?.[0]?.displayName ?? null,
    addresses: [
      ...(c.emailAddresses ?? []).map((e) => e.value ?? ""),
      // canonicalForm is already international (E.164) when Google could parse it.
      ...(c.phoneNumbers ?? []).map((n) => n.canonicalForm ?? n.value ?? ""),
    ].filter(Boolean),
  }));
}
export function contactsFromGraph(page: GraphPage): RawContact[] {
  return (page.value ?? []).map((c) => ({
    name: c.displayName ?? null,
    addresses: [...(c.emailAddresses ?? []).map((e) => e.address ?? ""), c.mobilePhone ?? "", ...(c.homePhones ?? []), ...(c.businessPhones ?? [])].filter(Boolean),
  }));
}

const MAX_PAGES = 10;

/** Exchanges the code and reads the contact list (names, emails and numbers only). */
export async function fetchContacts(p: Provider, code: string): Promise<RawContact[]> {
  const token = await exchange(p, code);
  const headers = { authorization: `Bearer ${token}` };
  const entries: RawContact[] = [];
  if (p === "google") {
    let pageToken = "";
    for (let i = 0; i < MAX_PAGES; i++) {
      const q = new URLSearchParams({ personFields: "names,emailAddresses,phoneNumbers", pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
      const res = await fetch(`https://people.googleapis.com/v1/people/me/connections?${q}`, { headers });
      if (!res.ok) throw new Error("google contacts failed");
      const page = (await res.json()) as GooglePage;
      entries.push(...contactsFromGoogle(page));
      if (!page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }
  } else {
    let next: string | undefined = "https://graph.microsoft.com/v1.0/me/contacts?$select=displayName,emailAddresses,mobilePhone,homePhones,businessPhones&$top=500";
    for (let i = 0; i < MAX_PAGES && next; i++) {
      const res: Response = await fetch(next, { headers });
      if (!res.ok) throw new Error("microsoft contacts failed");
      const page = (await res.json()) as GraphPage;
      entries.push(...contactsFromGraph(page));
      next = page["@odata.nextLink"];
    }
  }
  return entries;
}

/** Development only: an address book made of the demo accounts plus two people not on AGENTME. */
export const SIMULATED_CONTACTS: RawContact[] = [
  { name: "Luca", addresses: ["luca@agentme.test"] },
  { name: "Marco", addresses: ["marco@agentme.test"] },
  { name: "Paul", addresses: ["paul@agentme.test"] },
  { name: "Eve", addresses: ["eve@agentme.test"] },
  { name: "Trattoria Sole", addresses: ["trattoria@agentme.test"] },
  { name: "Anna Bianchi", addresses: ["anna.bianchi@example.com"] },
  { name: "Giorgio", addresses: ["+44 7700 900999"] },
];
