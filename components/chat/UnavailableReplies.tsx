"use client";
import { useEffect } from "react";
import { clearReplyTo } from "@/lib/client/reply";

/** Remove a stale composer quote when its source is deleted or moderated in another session. */
export function UnavailableReplies({ ids }: { ids: string[] }) {
  const key = ids.join(",");
  useEffect(() => { clearReplyTo(key.split(",")); }, [key]);
  return null;
}
