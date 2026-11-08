import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { COMMUNITY_AVATARS } from "@/lib/social/shared";
import { CreateCommunityForm } from "./CommunityForm";

type Row = { id: string; name: string; description: string | null; avatar: string; visibility: string };

function List({ rows, counts, roles }: { rows: Row[]; counts: Map<string, number>; roles?: Map<string, string> }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {rows.map((c) => (
        <li key={c.id}>
          <Link href={`/communities/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent-soft" data-testid="community-row">
            <span className="text-2xl">{c.avatar}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="block truncate text-xs text-muted">
                {counts.get(c.id) ?? 0} members · {c.visibility === "private" ? "🔒 Private" : "Public"}
                {roles?.get(c.id) && roles.get(c.id) !== "member" && ` · ${roles.get(c.id) === "owner" ? "Owner" : "Moderator"}`}
                {c.description && ` · ${c.description}`}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function CommunitiesPage({ searchParams }: PageProps<"/communities">) {
  const { user } = await requireAgent();
  const { q } = await searchParams;
  const query = (typeof q === "string" ? q : "").trim().replace(/[^\p{L}\p{N} _.'&-]/gu, "").slice(0, 40);
  const supabase = await createClient();
  const { data: memberships } = await supabase.from("community_members").select("community_id, role").eq("user_id", user.id);
  const mineIds = (memberships ?? []).map((m) => m.community_id);
  const roles = new Map((memberships ?? []).map((m) => [m.community_id, m.role]));

  const [{ data: mine }, { data: publicOnes }] = await Promise.all([
    mineIds.length ? supabase.from("communities").select("id, name, description, avatar, visibility").in("id", mineIds).order("name") : Promise.resolve({ data: [] as Row[] }),
    (() => {
      let req = supabase.from("communities").select("id, name, description, avatar, visibility").eq("visibility", "public");
      if (query) {
        const pattern = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        req = req.or(`name.ilike.${pattern},description.ilike.${pattern}`);
      }
      return req.order("created_at", { ascending: false }).limit(30);
    })(),
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
      <CreateCommunityForm avatars={COMMUNITY_AVATARS} />

      <section aria-label="Your communities">
        <h2 className="mb-2 text-sm font-semibold text-muted">Your communities</h2>
        {mine?.length ? <List rows={mine} counts={counts} roles={roles} /> : <p className="card text-sm text-muted">You haven&apos;t joined any communities yet.</p>}
      </section>

      <section aria-label="Discover communities" className="space-y-2">
        <h2 className="text-sm font-semibold text-muted">Discover communities</h2>
        <form className="flex gap-2" role="search">
          <input className="input" name="q" defaultValue={query} placeholder="Search communities (e.g. football, politics)" aria-label="Search communities" />
          <button className="btn-primary">Search</button>
        </form>
        {discover.length ? <List rows={discover} counts={counts} /> : <p className="text-sm text-muted">{query ? `No public communities match “${query}”.` : "No other public communities yet."}</p>}
      </section>
    </div>
  );
}
