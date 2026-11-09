import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { BusinessInfoForm, SourcesManager, TryIt } from "./BusinessForms";
import { QuestionsAnswers } from "./QuestionsAnswers";
import { AddBusinessIntro } from "./AddBusinessIntro";
import { WaysEditor } from "./WaysEditor";
import { waysOf } from "@/lib/business/booking";
import { adminClient } from "@/lib/supabase/admin";
import { ActionButton } from "@/components/ActionButton";
import { answerPartnerInviteAction, leavePlacementAction } from "../social-actions";
import { linkKey, linksIn } from "@/lib/business/extract";

type Info = { about?: string; customers?: string; description?: string; hours?: string; faqs?: { q: string; a: string }[] };
const words = (s: string | null | undefined) => (s ?? "").split(/\s+/).filter(Boolean).length;

/** My Business: everything your business agent knows, in your own words and from your links. */
export default async function MyBusinessPage({ searchParams }: PageProps<"/business">) {
  const { user, agent } = await requireAgent();
  if (agent.type !== "business") return <AddBusinessIntro guest={agent.guest} />;
  const { welcome } = await searchParams;
  const supabase = await createClient();
  const info = (agent.business_info ?? {}) as Info;
  const about = info.about ?? [info.description, info.hours && `Opening hours: ${info.hours}`].filter(Boolean).join("\n");
  // RLS: the owner's own links and what was read.
  const { data: rows } = await supabase.from("business_sources").select("*").order("created_at");
  // Links also written in the text boxes: shown as one item seen from two places, not a duplicate.
  const inAbout = new Set(linksIn(about).map(linkKey));
  const inCustomers = new Set(linksIn(info.customers ?? "").map(linkKey));
  const sources = (rows ?? []).map((s) => ({
    fromText: inAbout.has(linkKey(s.url)) ? "About your business" : inCustomers.has(linkKey(s.url)) ? "For customers only" : null,
    id: s.id,
    url: s.url,
    visibility: s.visibility,
    status: s.status,
    kind: s.kind,
    error: s.error,
    last_read_at: s.last_read_at,
    words: words(s.content),
    preview: (s.content ?? "").slice(0, 1500),
  }));
  const readWords = sources.filter((s) => s.status === "ok").reduce((n, s) => n + s.words, 0);
  const faqs = info.faqs ?? [];
  // Where the business has been placed (RLS: its own placements). The business isn't a
  // member, so names come from the server.
  const { data: placementRows } = await supabase.from("business_placements").select("id, conversation_id, community_id, status").order("created_at", { ascending: false });
  const groupIds = (placementRows ?? []).flatMap((p) => (p.conversation_id ? [p.conversation_id] : []));
  const communityIds = (placementRows ?? []).flatMap((p) => (p.community_id ? [p.community_id] : []));
  const [{ data: groupRows }, { data: communityRows }] = await Promise.all([
    groupIds.length ? adminClient().from("conversations").select("id, title").in("id", groupIds) : Promise.resolve({ data: [] as { id: string; title: string | null }[] }),
    communityIds.length ? adminClient().from("communities").select("id, name").in("id", communityIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const places = (placementRows ?? []).map((p) => ({
    ...p,
    name: p.conversation_id ? (groupRows ?? []).find((g) => g.id === p.conversation_id)?.title ?? "A group" : (communityRows ?? []).find((c) => c.id === p.community_id)?.name ?? "A community",
  }));

  return (
    <div className="space-y-6">
      <RealtimeRefresh channel={`business-${user.id}`} tables={["business_sources"]} />
      {welcome && (
        <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status" data-testid="business-welcome">
          🎉 {agent.display_name} is live at @{agent.handle}. You&apos;re now acting as your business: tap its name at the top to switch back to
          you. Tell your agent about your business below, then print your QR code.
        </p>
      )}
      <div>
        <h1 className="text-lg font-semibold">My Business</h1>
        <p className="text-xs text-muted">
          Everything {agent.display_name}&apos;s agent knows. It answers visitors only from this, never guesses, and asks you when it doesn&apos;t know. It never
          takes bookings, orders or payments.
        </p>
      </div>

      <section className="card" aria-label="What my agent knows" data-testid="agent-knows">
        <h2 className="font-semibold">What your agent knows</h2>
        <p className="mt-1 text-sm text-muted">
          {words(about).toLocaleString("en-GB")} words about your business · {sources.filter((s) => s.status === "ok").length} of {sources.length} links read (
          {readWords.toLocaleString("en-GB")} words) · {faqs.length} questions &amp; answers
        </p>
        <div id="test-your-agent" className="mt-4 scroll-mt-40 rounded-xl border border-dashed border-border p-3">
          <h3 className="text-sm font-semibold">🧪 Test your agent</h3>
          <p className="mb-2 text-xs text-muted">See how your agent would answer a customer, before anyone asks. It&apos;s only a preview: nothing is sent to anyone.</p>
          <TryIt />
        </div>
      </section>

      <section className="card flex flex-wrap items-center gap-3" aria-label="Your QR code">
        <span className="text-3xl" aria-hidden>📷</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Your QR code for customers</span>
          <span className="block text-xs text-muted">Use it anywhere you meet customers: in your shop, on your website or on social media. One scan and they can ask your agent anything.</span>
        </span>
        <span className="flex flex-wrap gap-2">
          {/* What customers see when they scan the code or tap your name in AGENTME. */}
          <Link href={`/u/${agent.handle}`} className="btn-ghost" data-testid="see-your-page">👁️ See your page</Link>
          <Link href="/print/qr" className="btn-primary">🖨️ Print poster</Link>
        </span>
      </section>

      <section id="book-or-order" className="card scroll-mt-40 space-y-3" aria-label="Book or order">
        <div>
          <h2 className="font-semibold">How customers book or order</h2>
          <p className="hint">
            Your agent never books or takes orders itself: it sends people to your own booking page, shop, phone or WhatsApp. These show as buttons
            on your page, in your agent&apos;s answers, and in friends&apos; plans that pick your place.
          </p>
        </div>
        <WaysEditor initial={waysOf(agent.business_info)} />
      </section>

      <section className="card space-y-3" aria-label="In your own words">
        <h2 className="font-semibold">In your own words</h2>
        <BusinessInfoForm about={about} customers={info.customers ?? ""} />
      </section>

      <section id="links" className="card scroll-mt-40 space-y-3" aria-label="Links your agent reads">
        <h2 className="font-semibold">Links your agent reads</h2>
        <SourcesManager sources={sources} />
      </section>

      {places.length > 0 && (
        <section className="card space-y-2" aria-label="Groups and communities">
          <h2 className="font-semibold">Groups and communities</h2>
          <p className="hint">
            Where people can mention @{agent.handle}. Your agent only sees the messages that mention it, answers from your public information (never
            “For customers only”) and never posts on its own.
          </p>
          <ul className="divide-y divide-border">
            {places.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="placement">
                <span className="min-w-0 flex-1 text-sm">
                  {p.conversation_id ? "👥" : "🏟️"} {p.name}
                  <span className="block text-xs text-muted">
                    {p.conversation_id ? "Group" : p.status === "invited" ? "Community · invited you to be an official partner" : "Community · official partner"}
                  </span>
                </span>
                {p.status === "invited" ? (
                  <>
                    <ActionButton action={answerPartnerInviteAction.bind(null, p.id, true)} label="Accept" variant="btn-primary" />
                    <ActionButton action={answerPartnerInviteAction.bind(null, p.id, false)} label="Decline" />
                  </>
                ) : (
                  <ActionButton action={leavePlacementAction.bind(null, p.id)} label="Leave" />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-2" aria-label="Questions and answers">
        <h2 className="font-semibold">Questions &amp; answers</h2>
        <p className="hint">Common questions and your answers. Your agent answers these by itself. Answers you give when it didn&apos;t know can be added here too.</p>
        <QuestionsAnswers faqs={faqs} />
      </section>
    </div>
  );
}
