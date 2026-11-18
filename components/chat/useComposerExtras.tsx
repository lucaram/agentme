"use client";
import { useEffect, useRef, useState } from "react";
import { CaptureDialog } from "./CaptureDialog";
import { PollEditor } from "./PollEditor";
import { AttachmentPreview, type DraftFile } from "./AttachmentPreview";
import { compressPhoto, compressVideo } from "@/lib/client/media";
import { FILE_ACCEPT, MAX_FILES, MAX_FILE_BYTES, MAX_MESSAGE_BYTES, mapsUrl, type PollDraft, type SharedLocation } from "@/lib/chat/rich";

const EMOJI = ["😀", "😂", "🥰", "😍", "😊", "😉", "😎", "🤔", "😢", "😭", "😮", "😴", "👍", "👎", "👏", "🙌", "🙏", "👋", "💪", "🤝", "❤️", "💚", "💙", "💛", "🔥", "🎉", "🎂", "🎁", "✨", "✅", "🍕", "🍣", "☕", "🍻", "⚽", "🎮", "📍", "📅", "🌞", "🌧️"];

/** `textOnly`: while true, files, camera, location, polls and voice messages are held back (e.g. a message to @agent). */
export function useComposerExtras(conversationId: string, insertEmoji: (emoji: string) => void, textOnly = false) {
  const [menu, setMenu] = useState<"attach" | "emoji" | null>(null); const [capture, setCapture] = useState<"camera" | "audio" | null>(null); const [pollOpen, setPollOpen] = useState(false);
  const [files, setFiles] = useState<DraftFile[]>([]); const [location, setLocation] = useState<SharedLocation | null>(null); const [poll, setPoll] = useState<PollDraft | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [pollAudience, setPollAudience] = useState("");
  const input = useRef<HTMLInputElement>(null); const fileRef = useRef(files); const clientId = useRef<string>(""); const alive = useRef(true);
  const preparation = useRef<AbortController | null>(null);
  useEffect(() => { fileRef.current = files; }, [files]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; preparation.current?.abort(); for (const f of fileRef.current) URL.revokeObjectURL(f.url); }; }, []);
  async function addFile(file: File, recordedKind?: DraftFile["kind"]) {
    if (poll) return setError("Send the poll separately from files and location.");
    if (fileRef.current.length >= MAX_FILES) return setError("Attach up to 6 files in one message.");
    if (file.size > 64 * 1024 * 1024) return setError("Choose a smaller file. Camera videos are compressed automatically.");
    setBusy(true); setError("");
    const controller = new AbortController(); preparation.current = controller;
    try {
      const kind = recordedKind ?? (file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "document");
      const prepared = kind === "image" ? await compressPhoto(file) : kind === "video" && !recordedKind ? await compressVideo(file, controller.signal) : file;
      if (prepared.size > MAX_FILE_BYTES) throw new Error("Choose a file up to 16 MB after compression.");
      if (fileRef.current.reduce((n, f) => n + f.file.size, 0) + prepared.size > MAX_MESSAGE_BYTES) throw new Error("Keep attachments below 32 MB in one message.");
      if (alive.current) { const next = [...fileRef.current, { key: crypto.randomUUID(), file: prepared, kind, url: URL.createObjectURL(prepared) }]; fileRef.current = next; setFiles(next); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Couldn't prepare this file."); }
    finally { if (alive.current) setBusy(false); }
  }
  function removeFile(file: DraftFile) {
    URL.revokeObjectURL(file.url); fileRef.current = fileRef.current.filter((f) => f.key !== file.key); setFiles(fileRef.current);
    if (file.uploadedId) void fetch(`/api/chats/${conversationId}/attachments?file=${file.uploadedId}`, { method: "DELETE" }).catch(() => {});
  }
  function chooseFiles() { setMenu(null); input.current?.click(); }
  function shareLocation() {
    setMenu(null); if (poll) return setError("Send the poll separately from location.");
    if (!navigator.geolocation) return setError("Location isn't available in this browser.");
    setBusy(true); setError("");
    navigator.geolocation.getCurrentPosition((p) => { if (!alive.current) return; setLocation({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lon: Math.round(p.coords.longitude * 1e6) / 1e6, accuracy: Math.min(100000, p.coords.accuracy) }); setBusy(false); }, () => { if (!alive.current) return; setBusy(false); setError("Location access wasn't granted. Allow it in your browser and try again."); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }
  async function prepare() {
    if (!files.length && !location && !poll) return undefined;
    setBusy(true);
    try {
      if (!clientId.current) clientId.current = crypto.randomUUID();
      const ids: string[] = [];
      for (const file of files) {
        if (file.uploadedId) { ids.push(file.uploadedId); continue; }
        const data = new FormData(); data.set("file", file.file); data.set("kind", file.kind);
        const response = await fetch(`/api/chats/${conversationId}/attachments`, { method: "POST", body: data });
        const result = await response.json(); if (!response.ok || !result.id) throw new Error(result.error ?? "Couldn't upload this attachment.");
        file.uploadedId = result.id; ids.push(result.id); // Retained for an error/nudge retry, never uploaded twice.
      }
      return { clientId: clientId.current, attachments: ids, location, poll };
    } finally { if (alive.current) setBusy(false); }
  }
  function clear() { files.forEach((f) => URL.revokeObjectURL(f.url)); fileRef.current = []; setFiles([]); setLocation(null); setPoll(null); setError(""); setMenu(null); clientId.current = ""; }
  const draftCount = files.length + (location ? 1 : 0) + (poll ? 1 : 0);
  const hasDraft = draftCount > 0;
  const iconClass = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-muted hover:bg-accent-soft hover:text-foreground disabled:opacity-40";
  return {
    hasDraft, draftCount, busy, prepare, clear,
    buttons: <>
      <button type="button" className={iconClass} aria-label="Emojis" title="Emojis" aria-expanded={menu === "emoji"} onClick={() => setMenu((m) => m === "emoji" ? null : "emoji")}><svg aria-hidden viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="9" /><path d="M8 14c2 3 6 3 8 0" /><circle cx="8.5" cy="9" r=".8" fill="currentColor" /><circle cx="15.5" cy="9" r=".8" fill="currentColor" /></svg></button>
    </>,
    attach: <button type="button" className={iconClass} aria-label="Attach" title={textOnly ? "@agent reads text only" : "Attach"} aria-expanded={menu === "attach"} disabled={busy || textOnly} onClick={() => setMenu((m) => m === "attach" ? null : "attach")}>＋</button>,
    microphone: <button type="button" className={iconClass} aria-label="Record audio" title={textOnly ? "@agent reads text only" : "Record audio"} disabled={busy || Boolean(poll) || textOnly} onClick={() => { setMenu(null); setCapture("audio"); }}><svg aria-hidden viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></svg></button>,
    panel: <div className="relative">
      <input ref={input} type="file" accept={FILE_ACCEPT} multiple className="hidden" aria-label="Choose attachments" onChange={async (e) => { const picked = [...(e.target.files ?? [])]; e.target.value = ""; for (const file of picked) await addFile(file); }} />
      {menu && !(menu === "attach" && textOnly) && <div className="mb-2 rounded-2xl border border-border bg-surface p-3 shadow-lg" role="region" aria-label={menu === "emoji" ? "Emoji picker" : "Attachment menu"}>
        <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-muted">{menu === "emoji" ? "Emojis" : "Add to your message"}</span><button type="button" className="px-2 text-muted" aria-label="Close attachment menu" onClick={() => setMenu(null)}>✕</button></div>
        {menu === "emoji" ? <div className="grid grid-cols-8 gap-1">{EMOJI.map((emoji) => <button type="button" key={emoji} aria-label={`Emoji ${emoji}`} className="rounded-xl p-2 text-xl hover:bg-accent-soft" onClick={() => insertEmoji(emoji)}>{emoji}</button>)}</div> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button type="button" className="rounded-xl bg-accent-soft/40 p-3 text-left text-sm hover:bg-accent-soft" disabled={busy} onClick={chooseFiles}>📎 Photos &amp; files</button>
          <button type="button" className="rounded-xl bg-accent-soft/40 p-3 text-left text-sm hover:bg-accent-soft" disabled={busy || Boolean(poll)} onClick={() => { setMenu(null); setCapture("camera"); }}>📷 Camera</button>
          <button type="button" className="rounded-xl bg-accent-soft/40 p-3 text-left text-sm hover:bg-accent-soft" disabled={busy} onClick={shareLocation}>📍 Share location</button>
          <button type="button" className="rounded-xl bg-accent-soft/40 p-3 text-left text-sm hover:bg-accent-soft" disabled={busy} onClick={() => { setMenu(null); if (files.length || location) return setError("Send your files or location before creating a poll."); setPollOpen(true); }}>📊 Create poll</button>
        </div>}
        {menu === "attach" && <p className="mt-3 text-[11px] text-muted">Photos, MP4/WebM video, audio, PDF or TXT · up to 16 MB per file</p>}
      </div>}
      {hasDraft && <section className={`mb-2 max-h-[45dvh] ${files.length === 1 && !location && !poll ? "w-fit" : "w-full"} max-w-full space-y-2 overflow-y-auto rounded-2xl border border-accent/30 bg-surface p-3`} aria-label="Message preview" data-testid="attachment-preview">
        <div><p className="text-xs font-medium">Review your message</p><p className="mt-0.5 text-[11px] text-muted">Nothing is sent until you choose Send.</p></div>
        {files.length > 0 && <AttachmentPreview files={files} busy={busy} onRemove={removeFile} />}
        {location && <div className="flex items-start justify-between gap-2 rounded-xl bg-accent-soft/30 p-3"><div><p className="text-sm font-medium">📍 Current location</p><p className="hint">{location.lat.toFixed(5)}, {location.lon.toFixed(5)}{location.accuracy ? ` · accurate to about ${Math.round(location.accuracy)} m` : ""}</p><a href={mapsUrl(location)} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline">Preview in Google Maps</a><p className="hint">A snapshot shared with this chat. No live tracking.</p></div><button type="button" className="px-2 text-muted" aria-label="Remove location" onClick={() => setLocation(null)}>✕</button></div>}
        {poll && <div className="rounded-xl bg-accent-soft/30 p-3"><p className="font-medium">📊 {poll.question}</p><p className="hint">With: {pollAudience}</p><ul className="my-2 space-y-1 text-sm text-muted">{poll.options.map((o) => <li key={o}>○ {o}</li>)}</ul><div className="flex gap-3"><button type="button" className="text-xs text-accent underline" onClick={() => setPollOpen(true)}>Edit poll</button><button type="button" className="text-xs text-muted underline" onClick={() => setPoll(null)}>Remove poll</button></div></div>}
      </section>}
      {busy && <p className="mb-1 text-xs text-muted" role="status">Preparing your attachment…</p>}
      {error && <p className="mb-1 text-xs text-danger" role="alert">{error}</p>}
      {capture && <CaptureDialog mode={capture} onClose={() => setCapture(null)} onFile={(file, kind) => { void addFile(file, kind); }} />}
      {pollOpen && <PollEditor conversationId={conversationId} initial={poll} onClose={() => setPollOpen(false)} onConfirm={(draft, audience) => { setPoll(draft); setPollAudience(audience); setPollOpen(false); }} />}
    </div>,
  };
}
