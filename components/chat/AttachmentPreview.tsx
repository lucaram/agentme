"use client";
/* eslint-disable @next/next/no-img-element -- Private local object URLs are used only to review unsent files. */
import { useEffect, useRef, useState } from "react";
import { fileIcon, fileSize } from "@/lib/chat/rich";
import { ChatDialog } from "./ChatDialog";
import { VoiceMessage } from "./VoiceMessage";

export type DraftFile = { key: string; file: File; kind: "image" | "video" | "audio" | "document"; url: string; uploadedId?: string };

export function AttachmentPreview({ files, busy, onRemove }: { files: DraftFile[]; busy: boolean; onRemove: (file: DraftFile) => void }) {
  const strip = useRef<HTMLUListElement>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [scrollable, setScrollable] = useState({ back: false, next: false });
  const expanded = files.find((file) => file.key === expandedKey);
  const multiple = files.length > 1;
  useEffect(() => {
    const element = strip.current; if (!element) return;
    const update = () => {
      const back = element.scrollLeft > 1; const next = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setScrollable((old) => old.back === back && old.next === next ? old : { back, next });
    };
    const observer = new ResizeObserver(update); observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener("scroll", update); };
  }, [files.length]);
  function scroll(direction: number) {
    const element = strip.current;
    element?.scrollBy({ left: direction * Math.max(240, element.clientWidth * 0.8), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  return <>
    {multiple && <div className="flex items-center justify-between gap-3">
      <p className="text-[11px] text-muted">{files.length} attachments</p>
      <div className="flex gap-1">
        <button type="button" aria-label="Previous attachments" disabled={!scrollable.back} className="flex h-8 w-8 items-center justify-center rounded-full border border-border hover:bg-accent-soft disabled:opacity-30" onClick={() => scroll(-1)}>←</button>
        <button type="button" aria-label="Next attachments" disabled={!scrollable.next} className="flex h-8 w-8 items-center justify-center rounded-full border border-border hover:bg-accent-soft disabled:opacity-30" onClick={() => scroll(1)}>→</button>
      </div>
    </div>}
    <ul ref={strip} tabIndex={0} aria-label="Attachments to send" className="thin-scrollbar flex max-w-full items-start gap-3 overflow-x-auto overscroll-x-contain p-1 pb-2 focus-visible:outline-accent" data-testid="attachment-strip">
      {files.map((file) => <li key={file.key} data-testid="attachment-card" data-kind={file.kind} className={`relative shrink-0 rounded-xl bg-accent-soft/30 p-2 ${file.kind === "audio" ? "w-80" : file.kind === "document" ? "w-64" : multiple ? "w-48" : "w-fit"} max-w-full`}>
        <button type="button" className="absolute right-1.5 top-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/90 text-muted shadow-sm backdrop-blur-sm hover:text-foreground disabled:opacity-40" disabled={busy} aria-label={`Remove attachment ${file.file.name}`} onClick={() => onRemove(file)}>✕</button>
        {file.kind === "image" && <button type="button" aria-label={`Preview photo ${file.file.name}`} className="block max-w-full rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => setExpandedKey(file.key)}>
          <img src={file.url} alt={`Preview of ${file.file.name}`} className={multiple ? "h-32 w-full rounded-lg object-contain" : "block max-h-[min(24dvh,12rem)] max-w-[min(20rem,65vw)] rounded-lg object-contain"} />
        </button>}
        {file.kind === "video" && <video src={file.url} controls playsInline preload="metadata" className={multiple ? "h-32 w-full rounded-lg bg-black object-contain" : "max-h-[min(24dvh,12rem)] max-w-[min(20rem,65vw)] rounded-lg bg-black object-contain"} />}
        {file.kind === "audio" && <VoiceMessage src={file.url} name={file.file.name} />}
        {file.kind === "document" ? <div className="flex min-h-12 items-center gap-2 pr-9">
          <span className="text-2xl" aria-hidden>{fileIcon(file.file.name)}</span><div className="min-w-0"><p className="truncate text-xs font-medium" title={file.file.name}>{file.file.name}</p><p className="mt-1 text-[11px] text-muted">{fileSize(file.file.size)}</p></div>
        </div> : <div className={`mt-2 ${!multiple && file.kind !== "audio" ? "w-0 min-w-full" : "max-w-48"}`}><p className="truncate text-[11px]" title={file.file.name}>{file.file.name}</p><p className="text-[11px] text-muted">{fileSize(file.file.size)}</p></div>}
      </li>)}
    </ul>
    {expanded?.kind === "image" && <ChatDialog label="Photo preview" size="wide" onClose={() => setExpandedKey(null)}>
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-sm font-semibold">{expanded.file.name}</h2><p className="text-xs text-muted">{fileSize(expanded.file.size)} · Not sent yet</p></div><button type="button" aria-label="Close photo preview" className="btn-ghost shrink-0" onClick={() => setExpandedKey(null)}>✕</button></div>
        <img src={expanded.url} alt={expanded.file.name} className="max-h-[65dvh] w-full rounded-xl object-contain" />
      </div>
    </ChatDialog>}
  </>;
}
