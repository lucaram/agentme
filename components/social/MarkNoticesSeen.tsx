"use client";

import { useEffect, useRef } from "react";
import { markNoticesSeenAction } from "@/app/(app)/social-actions";

/** Seeing the Updates list clears them from the tab badge (they stay listed, dimmed). */
export function MarkNoticesSeen({ area }: { area: "groups" | "communities" }) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const section = marker.current?.closest("details");
    let marked = false;
    const markVisible = () => {
      if (marked || (section && !section.open)) return;
      marked = true;
      void markNoticesSeenAction(area);
    };
    section?.addEventListener("toggle", markVisible);
    markVisible();
    return () => section?.removeEventListener("toggle", markVisible);
  }, [area]);
  return <span ref={marker} hidden />;
}
