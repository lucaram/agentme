"use client";

import { useLayoutEffect } from "react";
import { appearanceAttributes, type Appearance } from "@/lib/appearance";

/** Root layouts persist during navigation. Apply a switched identity before paint. */
export function AppearanceSync({ look }: { look: Appearance }) {
  const { theme, accent, text, dark, tint } = look;
  useLayoutEffect(() => {
    for (const [name, value] of Object.entries(appearanceAttributes({ theme, accent, text, dark, tint }))) {
      document.documentElement.setAttribute(name, value);
    }
  }, [theme, accent, text, dark, tint]);
  return null;
}
