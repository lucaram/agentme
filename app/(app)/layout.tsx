import Link from "next/link";
import { Fragment } from "react";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { ChatsBadge } from "@/components/ChatsBadge";
import { TabBadge } from "@/components/TabBadge";
import { ChatSearch } from "@/components/ChatSearch";
import { signOut } from "../(auth)/actions";
import { IdentitySwitcher } from "@/components/IdentitySwitcher";
import { identityNotificationState } from "@/lib/identities";
import { switchIdentityAction } from "./identity-actions";
import { DeliveryTracker } from "@/components/chat/DeliveryTracker";
import { MentionNotifications, MentionsButton } from "@/components/chat/MentionNotifications";
import { SetupInvitation } from "@/components/onboarding/SetupInvitation";
import { PresenceProvider } from "@/components/presence/PresenceProvider";
import { BusinessSessionGuard } from "@/components/business/BusinessSessionGuard";
import { NotificationProvider } from "@/components/notifications/NotificationProvider";

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
  const [notifications, { data: setup }, { data: site }] = await Promise.all([
    identityNotificationState(user, agent),
    supabase.from("onboarding_state").select("dismissed_at").eq("user_id", user.id).maybeSingle(),
    agent.type === "business" ? supabase.from("business_sites").select("live_at").eq("agent_id", agent.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const identities = notifications.accounts.map((account) => ({ ...account, badge: account.notifications.total }));
  const actions = notifications.accounts.find((account) => account.current)!.notifications;
  // Muted chats keep their own counter but don't add to the tab total.
  const unreadTotal = actions.chats;

  return (
    <NotificationProvider key={`notifications-${user.actorId ?? user.id}-${user.id}`} initial={notifications}><PresenceProvider key={`presence-${user.id}`} userId={user.actorId ?? user.id} agentId={agent.id}><div data-app-shell className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      <RealtimeRefresh channel={`badges-${user.id}`} tables={["business_queue_versions", "inbox_items", "messages", "reports", "platform_cases", "platform_notifications", "platform_moderators", "platform_operators", "platform_evidence_requests", "platform_account_appeals", "account_access_versions"]} />
      <DeliveryTracker key={user.id} userId={user.id} />
      <BusinessSessionGuard actorId={user.actorId ?? user.id} userId={user.id} role={user.businessRole ?? null} />
      <MentionNotifications key={`mentions-${user.id}`} userId={user.id} />
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-4 pt-3 backdrop-blur">
        <div className="flex items-center justify-between">
          {/* Personal ⇄ businesses you manage: each its own chats, contacts and inbox. */}
          <IdentitySwitcher key={`switcher-${user.id}`} identities={identities} canAddBusiness={!agent.guest && !user.isAnonymous && identities.some((i) => i.type === "personal")} switchAction={switchIdentityAction} signOutAction={signOut} signedInAs={user.signInEmail ?? null} />
        </div>
        <ChatSearch />
        <nav className="-mx-1 mt-2 flex gap-1 overflow-x-auto pb-2 text-sm">
          {[...NAV.slice(0, 4), ...(agent.type === "business" ? ([["/business", "My Business"]] as const) : []), ...NAV.slice(4)].map(([href, label]) => (
            <Fragment key={href}><Link href={href} className="flex items-center gap-1 rounded-full px-3 py-1 hover:bg-accent-soft">
              {label}
              {href === "/chats" && <ChatsBadge initial={unreadTotal} />}
              {href === "/contacts" && <TabBadge tab="contacts" initial={Number(actions?.contacts ?? 0)} />}
              {href === "/groups" && <TabBadge tab="groups" initial={Number(actions?.groups ?? 0)} />}
              {href === "/communities" && <TabBadge tab="communities" initial={Number(actions?.communities ?? 0)} />}
            </Link>{href === "/chats" && <MentionsButton key={user.id} />}</Fragment>
          ))}
        </nav>
      </header>
      {agent.guest && (
        <p className="mx-4 mt-3 rounded-xl bg-accent-soft px-3 py-2 text-sm" data-testid="guest-banner">
          You&apos;re here as a guest.{" "}
          <Link href="/settings/profile#account" className="font-medium text-accent underline">Save your account</Link> to keep it on other devices.
        </p>
      )}
      {setup && !setup.dismissed_at && !agent.guest && user.businessRole !== "staff" && <SetupInvitation key={`setup-${user.id}`} business={agent.type === "business"} websiteSaved={Boolean(site && !site.live_at)} />}
      <div className="flex flex-1 flex-col px-4 py-4">{children}</div>
    </div></PresenceProvider></NotificationProvider>
  );
}
