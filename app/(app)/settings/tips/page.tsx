import { redirect } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SavedTips } from "../SavedTips";
import { SettingsHeader } from "../SettingsHeader";

/** Settings → Saved tips: what your agent may share by itself when a friend asks around. */
export default async function TipsSettingsPage() {
  const { agent } = await requireAgent();
  if (agent.type !== "personal") redirect("/settings");
  const supabase = await createClient();
  const { data: tips } = await supabase.from("agent_tips").select("id, topic, tip").order("created_at", { ascending: false });
  return (
    <div className="space-y-6">
      <SettingsHeader
        title="Saved tips"
        hint="Your agent shares these by itself when a friend asks around about that topic (only with your contacts). Everything else, you answer yourself."
      />
      <section className="card space-y-3" aria-label="Saved tips">
        <SavedTips tips={tips ?? []} />
      </section>
    </div>
  );
}
