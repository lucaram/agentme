"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissNoticeAction } from "@/app/(app)/social-actions";

type Area = "groups" | "communities";

/** ✕ on one update. */
export function DismissNotice({ area, id }: { area: Area; id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="rounded-full px-1.5 text-muted hover:bg-accent-soft hover:text-foreground"
      aria-label="Clear this update"
      title="Clear"
      disabled={pending}
      onClick={() => start(async () => { await dismissNoticeAction(area, id); router.refresh(); })}
    >
      ✕
    </button>
  );
}

/** "Clear all" updates in this tab. */
export function ClearNotices({ area }: { area: Area }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="text-xs text-muted hover:text-danger hover:underline"
      disabled={pending}
      data-testid="clear-notices"
      onClick={() => {
        if (!window.confirm("Clear all updates here? This can't be undone.")) return;
        start(async () => { await dismissNoticeAction(area); router.refresh(); });
      }}
    >
      {pending ? "Clearing…" : "Clear all"}
    </button>
  );
}
