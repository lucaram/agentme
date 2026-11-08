import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { ChatsBadge } from "@/components/ChatsBadge";
import { signOut } from "../(auth)/actions";

const NAV = [
  ["/chats", "Chats"],
  ["/inbox", "Inbox"],
  ["/contacts", "Contacts"],
  ["/discover", "Discover"],
  ["/history", "History"],
  ["/settings", "Settings"],
] as const;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, agent } = await requireAgent();
  const supabase = await createClient();
  // RLS: counts only this user's own open requests.
  const [{ count: inboxCount }, { data: unreadRows }] = await Promise.all([
    supabase.from("inbox_items").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabase.rpc("unread_counts"),
  ]);
  const unreadTotal = (unreadRows ?? []).reduce((n, r) => n + Number(r.unread), 0);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      <RealtimeRefresh channel={`badges-${user.id}`} tables={["inbox_items", "messages"]} />
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-4 pt-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <Link href="/chats" className="flex items-center gap-2 font-semibold">
            <span className="text-2xl">{agent.avatar}</span>
            <span>@{agent.handle}</span>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-normal text-accent">
              {agent.type === "business" ? "Business" : "Personal"}
            </span>
          </Link>
          <form action={signOut}>
            <button className="text-sm text-muted hover:underline">Log out</button>
          </form>
        </div>
        <nav className="-mx-1 mt-2 flex gap-1 overflow-x-auto pb-2 text-sm">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="flex items-center gap-1 rounded-full px-3 py-1 hover:bg-accent-soft">
              {label}
              {href === "/chats" && <ChatsBadge initial={unreadTotal} />}
              {href === "/inbox" && Boolean(inboxCount) && (
                <span className="rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white" data-testid="inbox-badge" aria-label={`${inboxCount} open`}>
                  {inboxCount}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </header>
      <div className="flex flex-1 flex-col px-4 py-4">{children}</div>
    </div>
  );
}
