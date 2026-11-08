import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { getAgentForUser } from "@/lib/data/agents";
import { randomToken } from "@/lib/people/crypto";
import { registerAccountEmail } from "@/lib/people/matching";
import { createContactList } from "@/lib/people/imports";
import { authUrl, isProvider, providerMode, SIMULATED_CONTACTS } from "@/lib/people/providers";

const STATE_COOKIE = "contacts_oauth_state";

/** Starts "connect my email contacts" (the provider of the email they registered with). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/contacts/[provider]">) {
  const { provider } = await ctx.params;
  const back = (q: string) => NextResponse.redirect(new URL(`/discover?${q}`, request.url));
  const user = await getUser();
  const agent = user ? await getAgentForUser(user.id) : null;
  if (!user || !agent) return NextResponse.redirect(new URL("/login?next=/discover", request.url));
  if (!isProvider(provider)) return back("synced=error");

  const mode = providerMode(provider);
  if (mode === "off") return back("synced=error");
  if (mode === "simulated") {
    // Development without provider keys: pretend the address book holds the demo accounts.
    await registerAccountEmail(agent.id, user);
    const result = await createContactList(agent, provider, SIMULATED_CONTACTS, null);
    return back(result.ok ? "list=1&simulated=1" : "synced=limit");
  }

  // CSRF protection: the callback must carry the same random state as this browser's cookie.
  const state = randomToken();
  const response = NextResponse.redirect(authUrl(provider, state, user.email));
  response.cookies.set(STATE_COOKIE, `${provider}:${state}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/api/contacts",
    maxAge: 600,
  });
  return response;
}
