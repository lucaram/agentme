"use client";
import { Avatar } from "@/components/Avatar";


import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { OwnPresenceBadge } from "@/components/presence/PresenceBadge";
import { PresenceControl } from "@/components/presence/PresenceControl";
import { AccountNotificationBadge, useNotificationState } from "@/components/notifications/NotificationProvider";

type Identity = { agentId: string; handle: string; displayName: string; avatar: string; type: "personal" | "business"; current: boolean; badge: number };

/**
 * The header's "who am I acting as": your personal identity and the businesses
 * you manage, each with its own chats, contacts and inbox. The header and each
 * menu row show that identity's own notifications.
 */
export function IdentitySwitcher({
  identities,
  canAddBusiness,
  switchAction,
}: {
  identities: Identity[];
  canAddBusiness: boolean;
  switchAction: (agentId: string) => Promise<{ error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const notifications = useNotificationState();
  const accounts = notifications?.state.accounts.map((account) => ({ ...account, badge: account.notifications.total })) ?? identities;
  const current = accounts.find((i) => i.current) ?? accounts[0];

  // Close after navigating (e.g. after a switch) and when clicking elsewhere.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  if (!current) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex items-center gap-2 font-semibold"
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="identity-switcher"
        onClick={() => { if (!open) notifications?.refresh(); setOpen((o) => !o); }}
      >
        <span className="text-2xl"><Avatar value={current.avatar} /></span>
        <span className="flex min-w-0 flex-col items-start"><span>@{current.handle}</span><OwnPresenceBadge /></span>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-normal text-accent">{current.type === "business" ? "Business" : "Personal"}</span>
        <AccountNotificationBadge count={current.badge} testId="identity-waiting" label={`notifications for ${current.displayName}`} />
        <span className="text-xs text-muted" aria-hidden>▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-20 mt-2 max-h-[75dvh] w-72 overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-lg">
          <p className="px-2 pb-1 text-xs text-muted">Acting as</p>
          {accounts.map((i) => (
            <button
              key={i.agentId}
              type="button"
              role="menuitem"
              disabled={pending || i.current}
              data-testid={`identity-${i.handle}`}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await switchAction(i.agentId);
                  if (result?.error) setError(result.error);
                })
              }
              className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left ${i.current ? "bg-accent-soft" : "hover:bg-accent-soft"}`}
            >
              <span className="text-xl"><Avatar value={i.avatar} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{i.displayName}</span>
                <span className="block text-xs text-muted">@{i.handle} · {i.type === "business" ? "Business" : "Personal"}</span>
              </span>
              <AccountNotificationBadge count={i.badge} testId={`identity-count-${i.handle}`} label={`notifications for ${i.displayName}`} />
              {i.current && <span className="text-accent" aria-label="Current">✓</span>}
            </button>
          ))}
          <div role="none"><PresenceControl /></div>
          {pending && <p className="px-2 py-1 text-xs text-muted" role="status">Switching…</p>}
          {error && <p className="px-2 py-1 text-xs text-danger" role="alert">{error}</p>}
          {canAddBusiness && (
            <Link href="/business/new" role="menuitem" className="mt-1 block rounded-xl border-t border-border px-2 py-2 text-sm text-accent hover:bg-accent-soft" data-testid="add-business-link">
              ＋ Add a business
            </Link>
          )}
          <p className="px-2 pt-1 text-xs text-muted">Each one has its own chats, contacts and inbox.</p>
        </div>
      )}
    </div>
  );
}
