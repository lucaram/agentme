"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Audio/video sources are not mounted until they approach the actual chat viewport. */
export function LazyMedia({ children, label, image = false }: { children: ReactNode; label: string; image?: boolean }) {
  const ref = useRef<HTMLDivElement>(null); const [active, setActive] = useState(false);
  useEffect(() => {
    const element = ref.current; if (!element) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setActive(true); observer.disconnect(); } }, { root: element.closest("dialog") ?? element.closest("[data-chat-scroll]"), rootMargin: "200px" });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  return <div ref={ref}>{active ? children : <div className={`flex items-center justify-center rounded-xl bg-surface text-xs text-muted ${image ? "min-h-40" : "min-h-28"}`} aria-label={label}>{label}</div>}</div>;
}
