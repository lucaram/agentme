"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

/**
 * The end of a long list: the next rows appear by themselves as it comes near the screen.
 * - `href`: the server sends more (the address says how many); shown as a link, for keyboards
 *   and when that can't run.
 * - `onMore`: the rows are already here and only hidden; shown as a button.
 */
export function LoadMore({ href, onMore, left }: { href?: string; onMore?: () => void; /** How many are still to come, when known. */ left?: number }) {
  const router = useRouter();
  const ref = useRef<HTMLAnchorElement & HTMLButtonElement>(null);
  const [pending, start] = useTransition();
  const more = useRef(onMore);
  useEffect(() => { more.current = onMore; });

  useEffect(() => {
    const end = ref.current;
    if (!end || typeof IntersectionObserver === "undefined") return;
    // Once per step: when those rows arrive, the next step watches again.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        if (href) start(() => router.replace(href, { scroll: false }));
        else more.current?.();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [href, left, router]);

  const label = pending ? "Loading…" : left ? `Show more (${left} left)` : "Show more";
  const className = "mt-2 inline-block text-sm text-accent hover:underline";
  return href ? (
    <Link ref={ref} href={href} replace scroll={false} className={className} data-testid="load-more">{label}</Link>
  ) : (
    <button ref={ref} type="button" onClick={() => onMore?.()} className={className} data-testid="load-more">{label}</button>
  );
}
