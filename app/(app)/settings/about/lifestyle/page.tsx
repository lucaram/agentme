import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LIFESTYLE_TOPICS } from "@/lib/profile/topics";
import { TopicCard } from "../TopicCards";

export default async function LifestylePage() {
  const { agent } = await requireAgent();
  if (agent.type !== "personal") redirect("/business");
  const client = await createClient();
  const { data } = await client.from("agent_facts").select("category, value, disclosure").in("category", LIFESTYLE_TOPICS.map((topic) => topic.key)).eq("label", "").or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  return <div className="space-y-5">
    <Link href="/settings/about" className="text-sm text-accent hover:underline" data-testid="back-to-about">‹ What your agent knows about you</Link>
    <div><h1 className="text-lg font-semibold">Lifestyle</h1><p className="text-xs text-muted">Food, interests, location, budget and practical needs. Choose who can see each section.</p></div>
    <section className="space-y-2" aria-label="Lifestyle topics">{LIFESTYLE_TOPICS.map((topic) => {
      const fact = data?.find((row) => row.category === topic.key);
      return <TopicCard key={topic.key} topic={topic} initialValue={fact?.value ?? ""} initialShare={fact?.disclosure === "contacts"} />;
    })}</section>
  </div>;
}
