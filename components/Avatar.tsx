"use client";

import Image from "next/image";
import { useState } from "react";
import { avatarText, isImageAvatar } from "@/lib/profile/avatar";

/** Shared renderer for emoji presets and server-validated profile images. */
export function Avatar({ value, className = "", label }: { value?: string | null; className?: string; label?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const image = isImageAvatar(value) && failed !== value;
  return <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full align-middle ${className}`} style={{ width: "1.25em", height: "1.25em" }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {image ? <Image src={value!} alt="" width={512} height={512} unoptimized className="h-full w-full object-cover" loading="lazy" decoding="async" onError={() => setFailed(value!)} /> : avatarText(value) || "👤"}
  </span>;
}
