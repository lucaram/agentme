/* eslint-disable @next/next/no-img-element -- Compressed images use authenticated routes; an optimiser must not fetch them without the viewer's session. */
import { VoiceMessage } from "./VoiceMessage";
import { LazyMedia } from "./LazyMedia";
import { fileIcon, fileSize, mapsUrl, type AttachmentView, type SharedLocation } from "@/lib/chat/rich";

export function MessageMedia({ files, location }: { files: AttachmentView[]; location?: SharedLocation }) {
  return <div className="w-full space-y-2 text-foreground" data-testid="message-media">
    {files.map((file) => {
      const url = `/api/chat-attachments/${file.id}`;
      return <div key={file.id}>
        {file.kind === "image" && <LazyMedia label="Photo" image><a href={url} target="_blank" rel="noopener noreferrer" className="block"><img src={url} alt={file.name} loading="lazy" className="block max-h-96 w-full rounded-xl object-contain" /></a></LazyMedia>}
        {file.kind === "video" && <LazyMedia label="Video"><video src={url} controls playsInline preload="metadata" aria-label={file.name} className="max-h-96 w-full rounded-xl bg-black" /></LazyMedia>}
        {file.kind === "audio" && <LazyMedia label="Voice message"><div className="rounded-xl bg-surface"><VoiceMessage src={url} name={file.name} /></div></LazyMedia>}
        {file.kind === "document" && <a href={url} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:bg-accent-soft"><span className="text-2xl" aria-hidden>{fileIcon(file.name)}</span><span className="min-w-0"><span className="block break-words text-sm font-medium">{file.name}</span><span className="text-xs text-muted">{fileSize(file.bytes)} · Download</span></span></a>}
      </div>;
    })}
    {location && <a href={mapsUrl(location)} target="_blank" rel="noopener noreferrer" className="block rounded-2xl border border-border bg-surface p-4 hover:bg-accent-soft" data-testid="shared-location"><p className="font-medium">📍 Shared location</p><p className="mt-1 text-xs text-muted">{location.lat.toFixed(5)}, {location.lon.toFixed(5)}</p><p className="mt-2 text-sm text-accent underline">Open in Google Maps ↗</p></a>}
  </div>;
}
