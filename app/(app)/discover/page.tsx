import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionButton } from "@/components/ActionButton";
import { openAgentChat, requestContact } from "../actions";
import Link from "next/link";
import { FindPeople } from "./FindPeople";
import { ContactList } from "./ContactList";
import { loadContactList } from "@/lib/people/imports";
import { personalLink } from "@/lib/people/links";
import { maskEmail } from "@/lib/people/normalise";

/** Problems coming back from Gmail / Outlook. */
function syncNotice(synced: unknown): string | null {
  if (synced === "cancelled") return "Nothing was shared: access wasn't allowed.";
  if (synced === "limit") return "You've checked a lot of contacts today. Try again tomorrow.";
  if (synced === "error") return "We couldn't read your contacts. Please try again.";
  return null;
}

export default async function DiscoverPage({ searchParams }: PageProps<"/discover">) {
  const { user, agent } = await requireAgent();
  const { q, synced } = await searchParams;
  const notice = syncNotice(synced);
  // Only letters, digits, spaces and a few name characters: keeps the PostgREST filter well-formed.
  const query = (typeof q === "string" ? q : "").trim().replace(/^@/, "").replace(/[^\p{L}\p{N}_ .'-]/gu, "").slice(0, 40);
  const supabase = await createClient();

  let results: { id: string; handle: string; display_name: string; avatar: string; type: string; bio: string | null }[] = [];
  if (query) {
    // Escape LIKE wildcards in user input.
    const pattern = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const { data } = await supabase
      .from("agents")
      .select("id, handle, display_name, avatar, type, bio")
      .or(`handle.ilike.${pattern},display_name.ilike.${pattern}`)
      .neq("id", agent.id)
      .eq("guest", false)
      .limit(20);
    results = data ?? [];
  }
  const { data: contacts } = await supabase.from("contacts").select("requester_agent, addressee_agent, status");
  const [list, { data: ids }] = await Promise.all([loadContactList(agent.id), supabase.from("agent_identifiers").select("kind, hint")]);
  const hint = (kind: string) => ids?.find((i) => i.kind === kind)?.hint ?? null;
  const statusOf = (id: string) =>
    contacts?.find((c) => c.requester_agent === id || c.addressee_agent === id)?.status ?? null;

  return (
    <div className="space-y-4">
      {!agent.guest && (
        <section className="card" aria-label="Find people you know">
          <h2 className="text-lg font-semibold">Find people you know</h2>
          <p className="mt-1 text-sm text-muted">🔒 You choose who to add. Your contacts are only used to show you this list, then deleted.</p>
          {notice && (
            <p className="mt-3 text-sm text-danger" role="alert">
              {notice}
            </p>
          )}
          <div className="mt-2">
            {list ? (
              <ContactList list={list} myLink={personalLink(agent.handle)} myName={agent.display_name} />
            ) : (
              <FindPeople
                sources={(agent.contact_sources ?? {}) as Record<string, string>}
                unsupported={synced === "unsupported" ? (user.email?.split("@")[1] ?? "your email") : null}
              />
            )}
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Friends can find you by</p>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              {!agent.discoverable ? (
                <Link href="/settings#find-me" className="rounded-full border border-dashed border-border px-3 py-1 text-muted hover:bg-accent-soft">
                  🙈 Nobody: you&apos;re hidden (change)
                </Link>
              ) : user.email && user.emailConfirmed ? (
                <span className="rounded-full bg-accent-soft px-3 py-1" data-testid="findable-email">✉️ {maskEmail(user.email)} ✓</span>
              ) : (
                <span className="rounded-full border border-dashed border-border px-3 py-1 text-muted">✉️ Email not verified yet</span>
              )}
              {!agent.discoverable ? null : hint("phone") ? (
                <span className="rounded-full bg-accent-soft px-3 py-1">📱 {hint("phone")} ✓</span>
              ) : (
                <Link href="/settings#find-me" className="rounded-full border border-dashed border-accent px-3 py-1 text-accent hover:bg-accent-soft">
                  📱 Add your phone number
                </Link>
              )}
            </div>
          </div>
        </section>
      )}
      <form className="flex gap-2" role="search">
        <input className="input" name="q" defaultValue={query} placeholder="Search by name or @address" aria-label="Search agents" />
        <button className="btn-primary">Search</button>
      </form>
      {query && results.length === 0 && <p className="text-sm text-muted">No agents found for “{query}”.</p>}
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface empty:hidden">
        {results.map((a) => {
          const status = statusOf(a.id);
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="text-2xl">{a.avatar}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{a.display_name}</span>
                <span className="block text-xs text-muted">@{a.handle}{a.type === "business" ? ` · Business${a.bio ? ` · ${a.bio}` : ""}` : ""}</span>
              </span>
              <span className="flex gap-2">
                {a.type === "business" && <ActionButton action={openAgentChat.bind(null, a.id)} label="Ask agent" />}
                {status === "accepted" ? (
                  <span className="text-xs text-muted">Contact</span>
                ) : status === "pending" ? (
                  <span className="text-xs text-muted">Requested</span>
                ) : status === "blocked" ? null : (
                  <ActionButton action={requestContact.bind(null, a.handle)} label="Add contact" variant="btn-primary" />
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
