import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { loadJoinLink, MAX_COMMUNITY_PEOPLE, MAX_GROUP_PEOPLE } from "@/lib/social/shared";
import { JoinWithLink } from "./JoinWithLink";

/** An invite link to a group or a community (shown only to signed-in people). */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { user } = await requireAgent();
  const link = await loadJoinLink(token);
  const db = adminClient();
  const gone = (
    <div className="card space-y-2">
      <h1 className="text-lg font-semibold">This invite link doesn&apos;t work any more</h1>
      <p className="text-sm text-muted">It may have expired or been turned off. Ask for a new one.</p>
    </div>
  );
  if (!link) return gone;

  if (link.conversation_id) {
    const { data: group } = await db.from("conversations").select("id, title, avatar, description, kind").eq("id", link.conversation_id).maybeSingle();
    if (!group || group.kind !== "group") return gone;
    const { data: member } = await db.from("conversation_members").select("user_id").eq("conversation_id", group.id).eq("user_id", user.id).maybeSingle();
    if (member) redirect(`/chats/${group.id}`);
    const { count } = await db.from("conversation_members").select("*", { count: "exact", head: true }).eq("conversation_id", group.id);
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <section className="card space-y-1 text-center">
          <div className="text-5xl">{group.avatar ?? "👥"}</div>
          <p className="text-xs uppercase tracking-wide text-muted">Group invite</p>
          <h1 className="text-xl font-semibold">{group.title}</h1>
          {group.description && <p className="text-sm">{group.description}</p>}
          <p className="text-xs text-muted">{count} of {MAX_GROUP_PEOPLE} members</p>
        </section>
        <JoinWithLink token={token} rules={false} label="Join group" />
        <Link href="/groups" className="block text-center text-sm text-muted underline">Not now</Link>
      </div>
    );
  }

  const { data: community } = await db.from("communities").select("*").eq("id", link.community_id!).maybeSingle();
  if (!community) return gone;
  const { data: member } = await db.from("community_members").select("user_id").eq("community_id", community.id).eq("user_id", user.id).maybeSingle();
  if (member) redirect(`/communities/${community.id}`);
  const { count } = await db.from("community_members").select("*", { count: "exact", head: true }).eq("community_id", community.id);
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <section className="card space-y-2 text-center">
        <div className="text-5xl">{community.avatar}</div>
        <p className="text-xs uppercase tracking-wide text-muted">Community invite</p>
        <h1 className="text-xl font-semibold">{community.name}</h1>
        {community.description && <p className="text-sm">{community.description}</p>}
        <p className="text-xs text-muted">{count} of {MAX_COMMUNITY_PEOPLE.toLocaleString("en-GB")} members</p>
        {community.rules && <p className="whitespace-pre-wrap rounded-lg bg-accent-soft px-3 py-2 text-left text-sm">{community.rules}</p>}
      </section>
      <JoinWithLink token={token} rules={Boolean(community.rules)} label="Join community" />
      <Link href="/communities" className="block text-center text-sm text-muted underline">Not now</Link>
    </div>
  );
}
