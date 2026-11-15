"use client";

import { useEffect, useRef, type ReactEventHandler } from "react";

/**
 * A pop-up menu (<details>) that also closes when you click or tap anywhere
 * outside it, or press Esc, not only by tapping its button again.
 */
export function ClosableDetails({ className, children, onToggle }: { className?: string; children: React.ReactNode; onToggle?: ReactEventHandler<HTMLDetailsElement> }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const el = ref.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.open) ref.current.open = false;
    };
    const moved = (event: Event) => { const el = ref.current; if (el?.open && (!(event.target instanceof Node) || !el.contains(event.target))) el.open = false; };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    document.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, []);
  return (
    <details ref={ref} className={className} onToggle={onToggle}>
      {children}
    </details>
  );
}
