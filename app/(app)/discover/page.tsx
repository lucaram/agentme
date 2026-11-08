import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionButton } from "@/components/ActionButton";
import { openAgentChat, requestContact } from "../actions";
import Link from "next/link";
import { mutualSuggestions } from "@/lib/people/matching";
import { FindPeople } from "./FindPeople";
import { PROVIDER_LABEL, isProvider, providerForEmail, providerMode } from "@/lib/people/providers";

/** The message after coming back from Gmail / Outlook. */
function syncNotice(synced: unknown, checked: unknown, simulated: unknown): { ok: boolean; text: string } | null {
  if (typeof synced !== "string") return null;
  if (isProvider(synced)) {
    const fake = simulated ? " (simulated: no " + PROVIDER_LABEL[synced] + " keys are set up in development)" : "";
    return { ok: true, text: `✓ Checked ${Number(checked) || 0} ${PROVIDER_LABEL[synced]} contacts${fake}. Anyone who also has you appears above.` };
  }
  if (synced === "cancelled") return { ok: false, text: "Nothing was shared: access wasn't allowed." };
  if (synced === "limit") return { ok: false, text: "You've synced a lot today. Try again tomorrow." };
  return { ok: false, text: "We couldn't read your contacts. Please try again." };
}

export default async function DiscoverPage({ searchParams }: PageProps<"/discover">) {
  const { user, agent } = await requireAgent();
  const { q, synced, checked, simulated } = await searchParams;
  const notice = syncNotice(synced, checked, simulated);
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
  const hint = (kind: string) => ids?.find((i) => i.kind === kind)?.hint ?? null;
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
        <section className="card" aria-label="Find people you know">
          <h2 className="text-lg font-semibold">Find people you know</h2>
          <p className="mt-1 text-sm text-muted">🔒 Only people who also have you in their contacts show up. Your contacts are never stored.</p>
          {notice && (
            <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${notice.ok ? "bg-accent-soft" : "text-danger"}`} role={notice.ok ? "status" : "alert"}>
              {notice.text}
            </p>
          )}
          <FindPeople
            sources={(agent.contact_sources ?? {}) as Record<string, string>}
            providers={{ google: providerMode("google"), microsoft: providerMode("microsoft") }}
            preferred={providerForEmail(user.email)}
          />
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Friends can find you by</p>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              {hint("email") ? (
                <span className="rounded-full bg-accent-soft px-3 py-1" data-testid="findable-email">✉️ {hint("email")} ✓</span>
              ) : (
                <span className="rounded-full border border-dashed border-border px-3 py-1 text-muted">✉️ Email not verified yet</span>
              )}
              {hint("phone") ? (
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
