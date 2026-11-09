import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { ChatsBadge } from "@/components/ChatsBadge";
import { TabBadge } from "@/components/TabBadge";
import { ChatSearch } from "@/components/ChatSearch";
import { signOut } from "../(auth)/actions";
import { IdentitySwitcher } from "@/components/IdentitySwitcher";
import { listIdentities } from "@/lib/identities";
import { switchIdentityAction } from "./identity-actions";

// Requests that need your answer live in My Agent; Find people is inside Contacts; Activity inside Settings.
const NAV = [
  ["/chats", "Chats"],
  ["/contacts", "Contacts"],
  ["/groups", "Groups"],
  ["/communities", "Communities"],
  ["/settings", "Settings"],
] as const;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, agent } = await requireAgent();
  const supabase = await createClient();
  const [{ data: unreadRows }, { data: actionRows }, identities] = await Promise.all([
    supabase.rpc("unread_counts"),
    supabase.rpc("action_counts"),
    listIdentities(user, agent),
  ]);
  const actions = actionRows?.[0];
  // Muted chats keep their own counter but don't add to the tab total.
  const unreadTotal = (unreadRows ?? []).filter((r) => !r.muted).reduce((n, r) => n + Number(r.unread), 0);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      <RealtimeRefresh channel={`badges-${user.id}`} tables={["inbox_items", "messages"]} />
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-4 pt-3 backdrop-blur">
        <div className="flex items-center justify-between">
          {/* Personal ⇄ businesses you manage: each its own chats, contacts and inbox. */}
          <IdentitySwitcher identities={identities} canAddBusiness={!agent.guest && !user.isAnonymous && identities.some((i) => i.type === "personal")} switchAction={switchIdentityAction} />
          <form action={signOut}>
            <button className="text-sm text-muted hover:underline">Log out</button>
          </form>
        </div>
        <ChatSearch />
        <nav className="-mx-1 mt-2 flex gap-1 overflow-x-auto pb-2 text-sm">
          {[...NAV.slice(0, 4), ...(agent.type === "business" ? ([["/business", "My Business"]] as const) : []), ...NAV.slice(4)].map(([href, label]) => (
            <Link key={href} href={href} className="flex items-center gap-1 rounded-full px-3 py-1 hover:bg-accent-soft">
              {label}
              {href === "/chats" && <ChatsBadge initial={unreadTotal} />}
              {href === "/contacts" && <TabBadge tab="contacts" initial={Number(actions?.contacts ?? 0)} />}
              {href === "/groups" && <TabBadge tab="groups" initial={Number(actions?.groups ?? 0)} />}
              {href === "/communities" && <TabBadge tab="communities" initial={Number(actions?.communities ?? 0)} />}
            </Link>
          ))}
        </nav>
      </header>
      {agent.guest && (
        <p className="mx-4 mt-3 rounded-xl bg-accent-soft px-3 py-2 text-sm" data-testid="guest-banner">
          You&apos;re here as a guest.{" "}
          <Link href="/settings/profile#account" className="font-medium text-accent underline">Save your account</Link> to keep it on other devices.
        </p>
      )}
      <div className="flex flex-1 flex-col px-4 py-4">{children}</div>
    </div>
  );
}
