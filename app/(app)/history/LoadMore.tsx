"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

/**
 * The end of a long list: the next rows load by themselves as it comes near the screen
 * (and it stays a link, for keyboards and when that can't run).
 */
export function LoadMore({ href, left }: { href: string; left: number }) {
  const router = useRouter();
  const ref = useRef<HTMLAnchorElement>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const end = ref.current;
    if (!end || typeof IntersectionObserver === "undefined") return;
    // Once per address: when those rows arrive, the next address watches again.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        start(() => router.replace(href, { scroll: false }));
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [href, router]);

  return (
    <Link ref={ref} href={href} replace scroll={false} className="mt-2 inline-block text-sm text-accent hover:underline" data-testid="load-more">
      {pending ? "Loading…" : `Show more (${left} left)`}
    </Link>
  );
}
