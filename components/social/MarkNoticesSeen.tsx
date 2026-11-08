"use client";

import { useEffect } from "react";
import { markNoticesSeenAction } from "@/app/(app)/social-actions";

/** Seeing the Updates list clears them from the tab badge (they stay listed, dimmed). */
export function MarkNoticesSeen({ area }: { area: "groups" | "communities" }) {
  useEffect(() => {
    void markNoticesSeenAction(area);
  }, [area]);
  return null;
}
