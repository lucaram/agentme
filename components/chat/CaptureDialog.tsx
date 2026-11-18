"use client";
import { useEffect, useRef, useState } from "react";
import { recordingMime, recordingName } from "@/lib/client/media";
import { ChatDialog } from "./ChatDialog";

/** `photoOnly`: the camera takes photos only (e.g. for your agent, which can't watch videos). */
export function CaptureDialog({ mode, onFile, onClose, photoOnly = false }: { mode: "camera" | "audio"; onFile: (file: File, kind: "image" | "video" | "audio") => void; onClose: () => void; photoOnly?: boolean }) {
  const video = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null); const recorder = useRef<MediaRecorder | null>(null); const cancelled = useRef(false);
  const [ready, setReady] = useState(false); const [recording, setRecording] = useState(false); const [seconds, setSeconds] = useState(0); const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false; cancelled.current = false;
    const request = navigator.mediaDevices?.getUserMedia ? navigator.mediaDevices.getUserMedia(mode === "camera" ? { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" }, audio: false } : { audio: { echoCancellation: true, noiseSuppression: true }, video: false }) : Promise.reject(new Error("Unsupported browser"));
    request.then((s) => {
      if (disposed) return s.getTracks().forEach((t) => t.stop());
      stream.current = s; if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => {}); } setReady(true);
    }).catch(() => setError(`${mode === "camera" ? "Camera" : "Microphone"} access wasn't granted. Allow it in your browser, or attach an existing file.`));
    return () => { disposed = true; cancelled.current = true; if (recorder.current?.state === "recording") recorder.current.stop(); stream.current?.getTracks().forEach((t) => t.stop()); };
  }, [mode]);
  useEffect(() => { if (!recording) return; const timer = setInterval(() => setSeconds((n) => n + 1), 1000); return () => clearInterval(timer); }, [recording]);
  useEffect(() => { if (recording && seconds >= (mode === "camera" ? 120 : 300)) recorder.current?.stop(); }, [seconds, recording, mode]);
  const stop = () => recorder.current?.state === "recording" && recorder.current.stop();
  async function record() {
    if (!stream.current) return;
    try {
      setError("");
      if (mode === "camera" && !stream.current.getAudioTracks().length) {
        try { const audio = await navigator.mediaDevices.getUserMedia({ audio: true }); if (cancelled.current) { audio.getTracks().forEach((t) => t.stop()); return; } audio.getAudioTracks().forEach((t) => stream.current!.addTrack(t)); } catch { /* Video can still be captured without sound. */ }
      }
      if (cancelled.current) return;
      const mime = recordingMime(mode === "camera"); const parts: BlobPart[] = [];
      recorder.current = new MediaRecorder(stream.current, { mimeType: mime, audioBitsPerSecond: 64000, ...(mode === "camera" ? { videoBitsPerSecond: 1000000 } : {}) });
      recorder.current.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      recorder.current.onstop = () => { setRecording(false); if (!cancelled.current && parts.length) { onFile(new File(parts, recordingName(mime, mode === "camera"), { type: mime.split(";")[0] }), mode === "camera" ? "video" : "audio"); onClose(); } };
      recorder.current.onerror = () => setError("The recording failed. Please try again.");
      setSeconds(0); recorder.current.start(500); setRecording(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't start recording."); }
  }
  async function photo() {
    if (!video.current?.videoWidth) return;
    const canvas = document.createElement("canvas"); canvas.width = video.current.videoWidth; canvas.height = video.current.videoHeight; canvas.getContext("2d")?.drawImage(video.current, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
    if (blob) { onFile(new File([blob], `Photo-${Date.now()}.webp`, { type: blob.type }), "image"); onClose(); }
  }
  return <ChatDialog label={mode === "camera" ? "Camera" : "Record voice message"} onClose={onClose}>
    <section className="space-y-4 p-5">
      <div className="flex items-center justify-between"><h2 className="font-semibold">{mode === "camera" ? "Camera" : "Voice message"}</h2><button type="button" className="btn-ghost" aria-label="Cancel recording" onClick={onClose}>✕</button></div>
      {mode === "camera" ? <video ref={video} autoPlay muted playsInline className="max-h-[50vh] w-full rounded-2xl bg-black" /> : <div className={`rounded-2xl bg-accent-soft p-8 text-center ${recording ? "animate-pulse" : ""}`}><span className="text-4xl" aria-hidden>🎙️</span><p className="mt-3 tabular-nums" role="status">{recording ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} · Recording` : "Ready when you are"}</p></div>}
      {mode === "camera" && recording && <p role="status" className="text-sm tabular-nums text-danger">● {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · Recording</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <p className="hint">{mode === "camera" ? (photoOnly ? "A compressed photo" : "Compressed photos and videos · videos up to 2 minutes") : "Compressed audio · up to 5 minutes"}. Review it before sending.</p>
      <div className="flex flex-wrap gap-2">{recording ? <button type="button" className="btn-primary" onClick={stop}>Stop &amp; review</button> : <>{mode === "camera" && <button type="button" className="btn-primary" disabled={!ready} onClick={photo}>Take photo</button>}{!photoOnly && <button type="button" className={mode === "camera" ? "btn-ghost" : "btn-primary"} disabled={!ready} onClick={record}>{mode === "camera" ? "Record video" : "Start recording"}</button>}</>}</div>
    </section>
  </ChatDialog>;
}
