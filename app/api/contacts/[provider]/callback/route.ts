import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { getAgentForUser } from "@/lib/data/agents";
import { sameHash } from "@/lib/people/crypto";
import { registerAccountEmail } from "@/lib/people/matching";
import { createContactList } from "@/lib/people/imports";
import { fetchContacts, isProvider, providerMode } from "@/lib/people/providers";

const STATE_COOKIE = "contacts_oauth_state";

/** Google / Microsoft send the person back here after they allowed (or refused) access. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/contacts/[provider]/callback">) {
  const { provider } = await ctx.params;
  const url = request.nextUrl;
  const back = (q: string) => {
    const response = NextResponse.redirect(new URL(`/discover?${q}`, request.url));
    response.cookies.delete({ name: STATE_COOKIE, path: "/api/contacts" });
    return response;
  };
  const user = await getUser();
  const agent = user ? await getAgentForUser(user.id) : null;
  if (!user || !agent) return NextResponse.redirect(new URL("/login?next=/discover", request.url));
  if (!isProvider(provider) || providerMode(provider) !== "real") return back("synced=error");
  if (url.searchParams.get("error")) return back("synced=cancelled");

  const expected = request.cookies.get(STATE_COOKIE)?.value ?? "";
  const state = `${provider}:${url.searchParams.get("state") ?? ""}`;
  const code = url.searchParams.get("code");
  if (!code || !expected || !sameHash(expected, state)) return back("synced=error");

  try {
    const contacts = await fetchContacts(provider, code);
    await registerAccountEmail(agent.id, user);
    const result = await createContactList(agent, provider, contacts, null);
    return back(result.ok ? "list=1" : "synced=limit");
  } catch (error) {
    console.error("contacts sync failed", provider, error instanceof Error ? error.message : error);
    return back("synced=error");
  }
}
