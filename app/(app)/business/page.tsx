import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { BusinessInfoForm, SourcesManager, TryIt } from "./BusinessForms";
import { QuestionsAnswers } from "./QuestionsAnswers";
import { AddBusinessIntro } from "./AddBusinessIntro";

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
  const sources = (rows ?? []).map((s) => ({
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
        <div className="mt-4 rounded-xl border border-dashed border-border p-3">
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
        <Link href="/print/qr" className="btn-primary">🖨️ Print poster</Link>
      </section>

      <section className="card space-y-3" aria-label="In your own words">
        <h2 className="font-semibold">In your own words</h2>
        <BusinessInfoForm about={about} customers={info.customers ?? ""} />
      </section>

      <section className="card space-y-3" aria-label="Links your agent reads">
        <h2 className="font-semibold">Links your agent reads</h2>
        <SourcesManager sources={sources} />
      </section>

      <section className="card space-y-2" aria-label="Questions and answers">
        <h2 className="font-semibold">Questions &amp; answers</h2>
        <p className="hint">Common questions and your answers. Your agent answers these by itself. Answers you give when it didn&apos;t know can be added here too.</p>
        <QuestionsAnswers faqs={faqs} />
      </section>
    </div>
  );
}
