import { MAX_FILE_BYTES } from "@/lib/chat/rich";

let pending: Promise<void> = Promise.resolve();

/** Some MediaRecorder files have no duration header. Decode silently, one at a time. */
export async function readAudioDuration(src: string, signal: AbortSignal) {
  const previous = pending;
  let release!: () => void;
  pending = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    signal.throwIfAborted();
    const response = await fetch(src, { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Audio unavailable.");
    const bytes = await response.arrayBuffer();
    signal.throwIfAborted();
    if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) throw new Error("Invalid audio size.");
    // No output device, playback or microphone access. A low sample rate limits decoded memory.
    const context = new OfflineAudioContext(1, 1, 8000);
    const decoded = await context.decodeAudioData(bytes);
    signal.throwIfAborted();
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error("Duration unavailable.");
    return decoded.duration;
  } finally { release(); }
}
