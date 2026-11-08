import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { getAgentForUser } from "@/lib/data/agents";
import { randomToken } from "@/lib/people/crypto";
import { registerAccountEmail } from "@/lib/people/matching";
import { createContactList } from "@/lib/people/imports";
import { authUrl, detectProvider, providerMode, SIMULATED_CONTACTS } from "@/lib/people/providers";

const STATE_COOKIE = "contacts_oauth_state";

/**
 * "Connect" on a computer (or a phone browser without a contact picker): reads
 * the contacts of the email the person registered with. The provider is
 * worked out here (consumer domain, or the company domain's mail servers);
 * the person never has to choose.
 */
export async function GET(request: NextRequest) {
  const back = (q: string) => NextResponse.redirect(new URL(`/discover?${q}`, request.url));
  const user = await getUser();
  const agent = user ? await getAgentForUser(user.id) : null;
  if (!user || !agent) return NextResponse.redirect(new URL("/login?next=/discover", request.url));

  const provider = await detectProvider(user.email);
  if (provider && providerMode(provider) === "real") {
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
  if (providerMode(provider ?? "google") === "simulated") {
    // Development without provider keys: pretend the address book holds the demo accounts.
    await registerAccountEmail(agent.id, user);
    const result = await createContactList(agent, provider ?? "google", SIMULATED_CONTACTS, null);
    return back(result.ok ? "list=1" : "synced=limit");
  }
  return back("synced=unsupported");
}
