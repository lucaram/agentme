import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { factsByRequest, REQUESTABLE_CATEGORIES, type Fact, type FactCategory, type RequestableCategory } from "@/lib/policy/disclosure";
import { TOPICS } from "@/lib/profile/topics";
import { Fragment } from "react";
import { AwayCard, CustomTopics, TopicCard } from "./TopicCards";

type Row = { category: string; value: string; disclosure: string; label: string; expires_at: string | null };

const TITLE: Record<RequestableCategory, string> = {
  availability: "🗓️ When you're free",
  food: "🍽️ Food & drink",
  interests: "🎯 Hobbies & interests (and your own topics)",
  location: "📍 Where you usually are",
  budget: "💸 Budget for going out",
  practical: "🏠 Practical",
};

/** "What your agent knows about you": topics, who sees each, and a preview of what friends' agents can get. */
export default async function AboutYouPage() {
  const { agent } = await requireAgent();
  if (agent.type !== "personal") redirect("/business");
  const supabase = await createClient();
  const now = new Date().toISOString();
  // RLS: your own entries. Expired ones ("away until" a past date) are left out.
  const { data } = await supabase
    .from("agent_facts")
    .select("category, value, disclosure, label, expires_at")
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("updated_at");
  const rows = (data ?? []) as Row[];
  const get = (category: string) => rows.find((r) => r.category === category && !r.label);
  const away = get("away");
  const custom = rows.filter((r) => r.category === "custom");

  const shared = rows.filter((r) => r.disclosure === "contacts").map((r) => ({ category: r.category as FactCategory, value: r.value, disclosure: "contacts" as const, label: r.label })) satisfies Fact[];
  const preview = factsByRequest(shared);
  const privateTopics = TOPICS.filter((t) => get(t.key) && (t.alwaysPrivate || get(t.key)!.disclosure !== "contacts"));

  return (
    <div className="space-y-5">
      <Link href="/settings" className="text-sm text-accent">‹ Settings</Link>
      <div>
        <h1 className="text-lg font-semibold">What your agent knows about you</h1>
        <p className="text-xs text-muted">
          Your agent uses this to plan for you. 👥 items are given to a contact&apos;s agent only when their plan asks for that kind of thing; 🔒 items are
          never given to anyone. You can also tell your agent in My Agent (e.g. “I&apos;m vegetarian now”) and it offers to save it here.
        </p>
      </div>

      {/* Not a topic: a read-only view of what's shared, in the agents' colours. */}
      <details className="group rounded-2xl border border-agent-border bg-agent transition-shadow open:shadow-2xl" data-testid="profile-preview">
        <summary className="flex items-center gap-3 px-4 py-3">
          <span className="text-xl" aria-hidden>👁️</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Preview what friends&apos; agents can see</span>
            <span className="block text-xs text-muted">
              Exactly what a contact&apos;s agent could get when their plan asks ·{" "}
              {REQUESTABLE_CATEGORIES.filter((c) => preview[c]).length
                ? `${REQUESTABLE_CATEGORIES.filter((c) => preview[c]).length} ${REQUESTABLE_CATEGORIES.filter((c) => preview[c]).length === 1 ? "topic" : "topics"} shared`
                : "nothing shared yet"}
            </span>
          </span>
          <span className="text-muted transition group-open:rotate-90" aria-hidden>›</span>
        </summary>
        <div className="space-y-2 border-t border-agent-border px-4 py-3 text-sm">
          <p className="hint">
            For example, if Marco plans a dinner with you, his agent asks for when you&apos;re free and food &amp; drink, and gets only what you shared below
            in those topics.
          </p>
          {REQUESTABLE_CATEGORIES.some((c) => preview[c]) ? (
            <ul className="space-y-1">
              {REQUESTABLE_CATEGORIES.filter((c) => preview[c]).map((c) => (
                <li key={c}>
                  <span className="font-medium">{TITLE[c]}:</span> {preview[c]}
                </li>
              ))}
            </ul>
          ) : (
            <p>Nothing is shared yet: friends&apos; agents will ask you each time instead.</p>
          )}
          {privateTopics.length > 0 && (
            <p className="text-muted">🔒 Never shared: {privateTopics.map((t) => `${t.icon} ${t.title}`).join(", ")}.</p>
          )}
        </div>
      </details>

      <section className="space-y-2" aria-label="Topics">
        {TOPICS.map((topic) => (
          <Fragment key={topic.key}>
            <TopicCard topic={topic} initialValue={get(topic.key)?.value ?? ""} initialShare={get(topic.key)?.disclosure === "contacts"} />
            {/* Time away gets its own row, right under when you're free. */}
            {topic.key === "availability" && (
              <AwayCard
                current={away ? { until: away.expires_at!.slice(0, 10), text: away.value } : null}
                currentShare={away?.disclosure === "contacts"}
                minDate={now.slice(0, 10)}
              />
            )}
          </Fragment>
        ))}
      </section>

      <section className="space-y-2" aria-label="Your own topics">
        <h2 className="text-sm font-semibold text-muted">Your own topics</h2>
        <CustomTopics topics={custom.map((c) => ({ label: c.label, value: c.value, share: c.disclosure === "contacts" }))} />
      </section>
    </div>
  );
}
