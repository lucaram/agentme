"use client";

import { useEffect } from "react";
import { revealSection } from "@/lib/client/sections";

/**
 * A page opened at "#section" (e.g. /business#links from an idea in My Agent):
 * opens the tap-to-open card it's in, and scrolls to it.
 */
export function OpenFromHash() {
  useEffect(() => {
    let waiting: MutationObserver | undefined;
    const open = () => {
      waiting?.disconnect();
      let id: string;
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (!id) return;
      const reveal = () => revealSection(id);
      if (reveal()) return;
      // Server-rendered sections may arrive after this component hydrates.
      waiting = new MutationObserver(() => { if (reveal()) waiting?.disconnect(); });
      waiting.observe(document.body, { childList: true, subtree: true });
    };
    open();
    window.addEventListener("hashchange", open);
    return () => { waiting?.disconnect(); window.removeEventListener("hashchange", open); };
  }, []);
  return null;
}
