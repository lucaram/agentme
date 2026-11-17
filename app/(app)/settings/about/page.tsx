import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { factsByRequest, REQUESTABLE_CATEGORIES, type Fact, type FactCategory, type RequestableCategory } from "@/lib/policy/disclosure";
import { TOPICS } from "@/lib/profile/topics";
import { AwayCard, CustomTopics, TopicCard } from "./TopicCards";
import { SavedTips } from "../SavedTips";
import { Fold } from "@/components/Fold";
import { OpenFromHash } from "@/components/OpenFromHash";

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
  const [{ data }, { data: tips }] = await Promise.all([
    supabase.from("agent_facts").select("category, value, disclosure, label, expires_at").or(`expires_at.is.null,expires_at.gt.${now}`).order("updated_at"),
    supabase.from("agent_tips").select("id, topic, tip, disclosure").order("created_at", { ascending: false }),
  ]);
  const rows = (data ?? []) as Row[];
  const get = (category: string) => rows.find((r) => r.category === category && !r.label);
  const away = get("away");
  const custom = rows.filter((r) => r.category === "custom");

  const shared = rows.filter((r) => r.disclosure === "contacts").map((r) => ({ category: r.category as FactCategory, value: r.value, disclosure: "contacts" as const, label: r.label })) satisfies Fact[];
  const preview = factsByRequest(shared);
  const privateTopics = TOPICS.filter((t) => get(t.key) && (t.alwaysPrivate || get(t.key)!.disclosure !== "contacts"));
  const sharedTips = (tips ?? []).filter((tip) => tip.disclosure === "contacts");
  const privateTips = (tips ?? []).some((tip) => tip.disclosure === "private");
  const sharedCount = REQUESTABLE_CATEGORIES.filter((c) => preview[c]).length + (sharedTips.length ? 1 : 0);

  return (
    <div className="space-y-5">
      <OpenFromHash />
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
            <span className="block text-sm font-semibold">Preview what contacts&apos; agents can see</span>
            <span className="block text-xs text-muted">
              What your agent can share when a contact&apos;s agent asks ·{" "}
              {sharedCount
                ? `${sharedCount} ${sharedCount === 1 ? "topic" : "topics"} shared`
                : "nothing shared yet"}
            </span>
          </span>
          <span className="text-muted transition group-open:rotate-90" aria-hidden>›</span>
        </summary>
        <div className="space-y-2 border-t border-agent-border px-4 py-3 text-sm">
          {REQUESTABLE_CATEGORIES.some((c) => preview[c]) || sharedTips.length > 0 ? (
            <ul className="space-y-1">
              {REQUESTABLE_CATEGORIES.filter((c) => preview[c]).map((c) => (
                <li key={c}>
                  <span className="font-medium">{TITLE[c]}:</span> {preview[c]}
                </li>
              ))}
              {sharedTips.length > 0 && <li><span className="font-medium">💡 Saved tips (matching recommendations only):</span><ul className="mt-1 space-y-1 pl-3">{sharedTips.map((tip) => <li key={tip.id}><span className="font-medium">{tip.topic}:</span> {tip.tip}</li>)}</ul></li>}
            </ul>
          ) : (
            <p>Nothing is shared yet: friends&apos; agents will ask you each time instead.</p>
          )}
          {(privateTopics.length > 0 || privateTips) && (
            <div className="space-y-1 pt-3">
              <p className="font-medium">Only my agent (never shared with others):</p>
              <ul className="space-y-1 text-muted" aria-label="Only my agent">
                {privateTopics.map((topic) => <li key={topic.key}>{topic.icon} {topic.title}</li>)}
                {privateTips && <li>💡 Private saved tips</li>}
              </ul>
            </div>
          )}
        </div>
      </details>

      <section className="space-y-2" aria-label="Topics">
        <TopicCard topic={TOPICS.find((topic) => topic.key === "availability")!} initialValue={get("availability")?.value ?? ""} initialShare={get("availability")?.disclosure === "contacts"} />
        <AwayCard current={away ? { until: away.expires_at!.slice(0, 10), text: away.value } : null} currentShare={away?.disclosure === "contacts"} minDate={now.slice(0, 10)} />
        <Link href="/settings/about/lifestyle" className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-5 py-4 hover:bg-accent-soft sm:px-6" data-testid="topic-lifestyle">
          <span className="text-xl" aria-hidden>🌿</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Lifestyle</span><span className="block text-xs text-accent">＋ Add</span></span><span className="text-muted" aria-hidden>›</span>
        </Link>
        <Fold id="saved-tips" name="topics" testId="topic-saved-tips" icon="💡" title="Saved tips" summary={<span className="text-accent">＋ Add</span>}>
          <div className="space-y-3 px-5 py-4 sm:px-6">
            <p className="text-sm text-muted">Recommendations for your agent, with sharing you control.</p>
            <p className="text-sm text-muted">Choose who can see each tip. Only tips shared with contacts can answer their matching recommendation requests automatically.</p>
            <SavedTips tips={tips ?? []} />
          </div>
        </Fold>
        <TopicCard topic={TOPICS.find((topic) => topic.key === "notes")!} initialValue={get("notes")?.value ?? ""} initialShare={false} />
      </section>

      <section className="space-y-2" aria-label="Your own topics">
        <h2 className="text-sm font-semibold text-muted">Your own topics</h2>
        <CustomTopics topics={custom.map((c) => ({ label: c.label, value: c.value, share: c.disclosure === "contacts" }))} />
      </section>
    </div>
  );
}
