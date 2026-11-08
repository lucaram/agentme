import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionButton } from "@/components/ActionButton";
import { openAgentChat, requestContact } from "../actions";
import Link from "next/link";
import { mutualSuggestions } from "@/lib/people/matching";
import { FindPeople } from "./FindPeople";

export default async function DiscoverPage({ searchParams }: PageProps<"/discover">) {
  const { agent } = await requireAgent();
  const { q } = await searchParams;
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
  const [suggestions, { data: ids }] = await Promise.all([
    mutualSuggestions(agent.id),
    supabase.from("agent_identifiers").select("kind, hint"),
  ]);
  const findable = (ids ?? []).map((i) => i.hint);
  const statusOf = (id: string) =>
    contacts?.find((c) => c.requester_agent === id || c.addressee_agent === id)?.status ?? null;

  return (
    <div className="space-y-4">
      {suggestions.length > 0 && (
        <section aria-label="People you know">
          <h2 className="mb-2 text-sm font-semibold text-muted">People you know</h2>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {suggestions.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="suggestion">
                <span className="text-2xl">{a.avatar}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{a.display_name}</span>
                  <span className="block text-xs text-muted">@{a.handle} · You&apos;re in each other&apos;s contacts</span>
                </span>
                <ActionButton action={requestContact.bind(null, a.handle)} label="Add contact" variant="btn-primary" />
              </li>
            ))}
          </ul>
        </section>
      )}
      {!agent.guest && (
        <section className="card space-y-3" aria-label="Find people you know">
          <div>
            <h2 className="font-semibold">Find people you know</h2>
            <p className="hint">
              Someone only shows up if you have their number or email <b>and they have yours</b>. We compare, keep only the people
              already on AGENTME, and forget the rest of your address book. Nobody is added without a tap.
            </p>
          </div>
          <FindPeople syncedAt={agent.contacts_synced_at} />
          <p className="hint">
            People can find you by: {findable.length ? findable.join(" · ") : "nothing yet"} ·{" "}
            <Link href="/settings#find-me" className="text-accent underline">{findable.some((h) => h.startsWith("+")) ? "change" : "add your phone"}</Link>
          </p>
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
