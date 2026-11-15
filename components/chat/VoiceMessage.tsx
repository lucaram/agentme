"use client";
import { useEffect, useRef, useState } from "react";
import { readAudioDuration } from "@/lib/client/audio-duration";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function VoiceMessage({ src, name }: { src: string; name: string }) {
  const ref = useRef<HTMLAudioElement>(null); const panel = useRef<HTMLDivElement>(null);
  const [speed, setSpeed] = useState(1); const [duration, setDuration] = useState(0); const [position, setPosition] = useState(0); const [playing, setPlaying] = useState(false); const [finished, setFinished] = useState(false); const [muted, setMuted] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
    const audio = ref.current; if (!audio) return;
    const abort = new AbortController(); let visible = false; let probing = false;
    const update = () => {
      if (abort.signal.aborted) return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) { setDuration(audio.duration); return; }
      if (!visible || probing || audio.readyState < 1) return;
      probing = true;
      void readAudioDuration(src, abort.signal).then((seconds) => { if (!abort.signal.aborted) setDuration(seconds); }).catch(() => { /* Playback can still work when a browser cannot decode duration. */ });
    };
    audio.addEventListener("loadedmetadata", update); audio.addEventListener("durationchange", update);
    // Offscreen messages don't download/decode full recordings just to calculate a length.
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { visible = true; observer.disconnect(); update(); } }, { rootMargin: "200px" });
    if (panel.current) observer.observe(panel.current);
    return () => { abort.abort(); observer.disconnect(); audio.removeEventListener("loadedmetadata", update); audio.removeEventListener("durationchange", update); audio.pause(); };
  }, [src]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const audio = ref.current;
      if (!audio || audio.paused || audio.ended) return;
      setPosition(audio.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  async function toggle() {
    const audio = ref.current; if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    setError("");
    try { if (audio.ended) audio.currentTime = 0; await audio.play(); } catch { setError("Couldn't play this recording. Please try again."); }
  }
  const elapsed = finished ? duration || position : position;
  const progress = finished ? 100 : duration ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
  return <div ref={panel} className="min-w-0 space-y-2 rounded-xl bg-accent-soft/30 p-3" data-testid="voice-message">
    <p className="text-xs font-medium">🎙️ Voice message</p>
    <audio ref={ref} src={src} preload="metadata" aria-label={name} className="hidden" onPlay={() => { setFinished(false); setPlaying(true); }} onPause={(e) => { setPosition(e.currentTarget.currentTime); setPlaying(false); }} onEnded={() => { setFinished(true); setPlaying(false); }} onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)} onError={() => setError("This recording is unavailable.")} />
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => { void toggle(); }} aria-label={playing ? "Pause voice message" : "Play voice message"} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-background">
        <svg aria-hidden viewBox="0 0 24 24" width="20" height="20" fill="currentColor">{playing ? <path d="M6 4h4v16H6zm8 0h4v16h-4z" /> : <path d="m8 4 12 8-12 8z" />}</svg>
      </button>
      <div className="min-w-0 flex-1 space-y-1">
        <input type="range" aria-label="Seek voice message" aria-valuetext={`${clock(elapsed)} of ${duration ? clock(Math.max(1, duration)) : "unknown duration"}`} min={0} max={100} step="any" value={progress} disabled={!duration} className="block h-3 w-full cursor-pointer accent-accent disabled:opacity-40" onChange={(e) => { if (ref.current) { const seconds = Number(e.target.value) / 100 * duration; setFinished(false); ref.current.currentTime = seconds; setPosition(seconds); } }} />
        <p className="text-xs tabular-nums text-muted">{elapsed > 0 && <span>{clock(elapsed)} / </span>}<span data-testid="voice-duration" aria-label="Total duration">{duration ? clock(Math.max(1, duration)) : "—:—"}</span></p>
      </div>
      <button type="button" aria-label={muted ? "Unmute voice message" : "Mute voice message"} className="rounded-full p-2 text-muted hover:bg-accent-soft" onClick={() => { if (ref.current) ref.current.muted = !muted; setMuted(!muted); }}>
        <svg aria-hidden viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4 5 9H2v6h3l6 5z" />{muted ? <path d="m16 9 5 6m0-6-5 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></>}</svg>
      </button>
    </div>
    <div className="flex items-center gap-1" role="group" aria-label="Playback speed">{[1, 2, 4].map((rate) => <button key={rate} type="button" aria-pressed={speed === rate} className={`rounded-full px-3 py-1 text-xs font-semibold ${speed === rate ? "bg-accent text-white dark:text-black" : "border border-border text-muted"}`} onClick={() => { setSpeed(rate); if (ref.current) ref.current.playbackRate = rate; }}>{rate}×</button>)}</div>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </div>;
}
