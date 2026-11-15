"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** The database expires access restrictions; this keeps a page left open in sync. */
export function RestrictionExpiry({ until }: { until: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const remaining = until ? Date.parse(until) - Date.now() : 60000;
    const timer = setInterval(refresh, Math.min(60000, Math.max(1000, remaining + 200)));
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [router, until]);
  return null;
}
