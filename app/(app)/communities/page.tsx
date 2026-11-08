import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { COMMUNITY_AVATARS } from "@/lib/social/shared";
import { CreateCommunityForm } from "./CommunityForm";
import { Notices } from "@/components/social/Notices";

type Row = { id: string; name: string; description: string | null; avatar: string; visibility: string };

function List({ rows, counts, roles, toReview }: { rows: Row[]; counts: Map<string, number>; roles?: Map<string, string>; toReview?: Map<string, number> }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {rows.map((c) => (
        <li key={c.id}>
          <Link href={`/communities/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent-soft" data-testid="community-row">
            <span className="text-2xl">{c.avatar}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="block truncate text-xs text-muted">
                {counts.get(c.id) ?? 0} {(counts.get(c.id) ?? 0) === 1 ? "member" : "members"} · {c.visibility === "private" ? "🔒 Private" : "Public"}
                {roles?.get(c.id) && roles.get(c.id) !== "member" && ` · ${roles.get(c.id) === "owner" ? "Owner" : "Moderator"}`}
                {c.description && ` · ${c.description}`}
              </span>
            </span>
            {toReview?.get(c.id) ? (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white dark:text-black" data-testid="to-review">
                {toReview.get(c.id)} to review
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function CommunitiesPage() {
  const { user, agent } = await requireAgent();
  const supabase = await createClient();
  const { data: memberships } = await supabase.from("community_members").select("community_id, role").eq("user_id", user.id);
  const mineIds = (memberships ?? []).map((m) => m.community_id);
  const roles = new Map((memberships ?? []).map((m) => [m.community_id, m.role]));
  // What moderators have to review, per community (RLS: only communities you moderate).
  const [{ data: pendingRequests }, { data: openReports }] = await Promise.all([
    supabase.from("join_requests").select("community_id").eq("status", "pending").not("community_id", "is", null),
    supabase.from("reports").select("community_id").eq("status", "open").not("community_id", "is", null),
  ]);
  const toReview = new Map<string, number>();
  for (const r of [...(pendingRequests ?? []), ...(openReports ?? [])]) {
    const role = r.community_id ? roles.get(r.community_id) : null;
    if (r.community_id && (role === "owner" || role === "moderator")) toReview.set(r.community_id, (toReview.get(r.community_id) ?? 0) + 1);
  }

  const [{ data: mine }, { data: publicOnes }] = await Promise.all([
    mineIds.length ? supabase.from("communities").select("id, name, description, avatar, visibility").in("id", mineIds).order("name") : Promise.resolve({ data: [] as Row[] }),
    // Search lives in the header bar; here, the biggest public communities.
    supabase.from("communities").select("id, name, description, avatar, visibility").eq("visibility", "public").order("created_at", { ascending: false }).limit(50),
  ]);
  const discover = (publicOnes ?? []).filter((c) => !roles.has(c.id));
  const allIds = [...(mine ?? []), ...discover].map((c) => c.id);
  const { data: countRows } = allIds.length ? await supabase.rpc("community_member_counts", { p_ids: allIds }) : { data: [] };
  const counts = new Map((countRows ?? []).map((r) => [r.community_id, Number(r.members)]));
  discover.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Communities</h1>
        <p className="text-xs text-muted">Bigger spaces around a shared interest, with moderators, rules, Announcements and a General chat.</p>
      </div>
      <Notices area="communities" />
      {agent.type === "business" && (
        <p className="card text-sm" data-testid="business-community-hint">
          🏪 Run a community for your customers: news in Announcements, chat in General. Your business can&apos;t join other communities, but their
          moderators can invite it as an official partner.
        </p>
      )}
      <CreateCommunityForm avatars={COMMUNITY_AVATARS} />

      <section aria-label="Your communities">
        <h2 className="mb-2 text-sm font-semibold text-muted">Your communities</h2>
        {mine?.length ? <List rows={mine} counts={counts} roles={roles} toReview={toReview} /> : <p className="card text-sm text-muted">You haven&apos;t joined any communities yet.</p>}
      </section>

      <section aria-label="Discover communities" className="space-y-2">
        <h2 className="text-sm font-semibold text-muted">Popular public communities</h2>
        <p className="hint">Looking for something specific? Use the search bar at the top.</p>
        {discover.length ? <List rows={discover.slice(0, 20)} counts={counts} /> : <p className="text-sm text-muted">No other public communities yet.</p>}
      </section>
    </div>
  );
}
