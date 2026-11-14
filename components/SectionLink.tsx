"use client";

import type { ReactNode } from "react";
import { revealSection } from "@/lib/client/sections";

/** An explicit section jump also works when the URL already contains that hash. */
export function SectionLink({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return <a href={`#${id}`} className={className} onClick={(event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (!revealSection(id, true)) return;
    event.preventDefault();
    if (window.location.hash !== `#${id}`) window.history.pushState(null, "", `#${id}`);
  }}>{children}</a>;
}
