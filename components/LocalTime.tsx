"use client";

import { useSyncExternalStore } from "react";

/** "08 Nov, 09:05" in the given time zone (the viewer's own when omitted). */
export function formatShort(iso: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
}

const subscribe = () => () => {};

/**
 * A date and time in the viewer's own time zone. The server doesn't know it, so
 * it renders UTC and the browser switches to local time right after hydration.
 */
export function LocalTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => formatShort(iso),
    () => formatShort(iso, "UTC"),
  );
  return <time dateTime={iso}>{text}</time>;
}
