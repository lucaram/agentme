"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function ChatDialog({ label, onClose, children, size = "default" }: { label: string; onClose: () => void; children: ReactNode; size?: "default" | "wide" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} aria-label={label} className={`max-h-[90dvh] w-[calc(100%_-_2rem)] ${size === "wide" ? "max-w-4xl" : "max-w-lg"} overflow-y-auto rounded-3xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/70`} onCancel={(e) => { e.preventDefault(); onClose(); }}>{children}</dialog>;
}
