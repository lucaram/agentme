"use client";

import { usePathname } from "next/navigation";

/** My Business tab: website changes and "customers asked about…" not seen yet (gone once you open the tab). */
export function BusinessBadge({ initial }: { initial: number }) {
  const pathname = usePathname();
  if (initial <= 0 || pathname.startsWith("/business")) return null;
  return (
    <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white dark:text-black" data-testid="business-badge" aria-label={`${initial} updates`}>
      {initial > 99 ? "99+" : initial}
    </span>
  );
}
