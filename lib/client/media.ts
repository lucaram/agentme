/** Browser encoders keep camera media small before it reaches storage. */
export async function compressPhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("This browser couldn't prepare the photo.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Couldn't compress this photo.")), "image/webp", 0.8));
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: blob.type });
  } finally { bitmap.close(); }
}

export function recordingMime(video: boolean) {
  if (typeof MediaRecorder === "undefined") throw new Error("Recording isn't available in this browser. You can attach an existing file instead.");
  const types = video ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4", "video/webm"] : ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error("This browser doesn't support a compatible recording format.");
  return mime;
}
export const recordingName = (mime: string, video: boolean) => `${video ? "Video" : "Voice"}-${Date.now()}.${mime.includes("mp4") ? video ? "mp4" : "m4a" : mime.includes("ogg") ? "ogg" : "webm"}`;

export async function compressVideo(file: File, signal?: AbortSignal): Promise<File> {
  const mime = recordingMime(true);
  const url = URL.createObjectURL(file); const video = document.createElement("video"); video.src = url; video.muted = true; video.playsInline = true;
  let context: AudioContext | undefined; let stream: MediaStream | undefined; let encoder: MediaRecorder | undefined; let frame = 0;
  try {
    await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error("This video can't be opened. Try MP4 or WebM.")); });
    if (!Number.isFinite(video.duration) || video.duration > 120) throw new Error("Choose a video up to 2 minutes long.");
    const ratio = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight)); const canvas = document.createElement("canvas"); canvas.width = Math.max(2, Math.round(video.videoWidth * ratio)); canvas.height = Math.max(2, Math.round(video.videoHeight * ratio));
    const ctx = canvas.getContext("2d"); if (!ctx || !canvas.captureStream) throw new Error("Video compression isn't supported here. Record a video with the camera instead.");
    stream = canvas.captureStream(24);
    context = new AudioContext(); const source = context.createMediaElementSource(video); const audio = context.createMediaStreamDestination(); source.connect(audio); await context.resume();
    audio.stream.getAudioTracks().forEach((t) => stream!.addTrack(t));
    if (signal?.aborted) throw new Error("Video preparation cancelled.");
    const recorder = encoder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.max(150000, Math.min(1000000, file.size * 8 / Math.max(1, video.duration) * 0.75)), audioBitsPerSecond: 64000 });
    const parts: BlobPart[] = [];
    const result = new Promise<Blob>((resolve, reject) => { recorder.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); }; recorder.onstop = () => resolve(new Blob(parts, { type: mime.split(";")[0] })); recorder.onerror = () => reject(new Error("Couldn't compress the video.")); });
    const draw = () => { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); frame = requestAnimationFrame(draw); };
    recorder.start(500); draw(); await video.play();
    const ended = new Promise<void>((resolve, reject) => { video.onended = () => resolve(); video.onerror = () => reject(new Error("Couldn't read the video.")); signal?.addEventListener("abort", () => reject(new Error("Video preparation cancelled.")), { once: true }); if (signal?.aborted) reject(new Error("Video preparation cancelled.")); });
    let timer: ReturnType<typeof setTimeout>;
    try { await Promise.race([ended, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Video compression took too long.")), 150000); })]); } finally { clearTimeout(timer!); recorder.stop(); }
    const blob = await result;
    return new File([blob], recordingName(mime, true), { type: blob.type });
  } finally { if (encoder?.state === "recording") encoder.stop(); cancelAnimationFrame(frame); video.pause(); video.removeAttribute("src"); video.load(); stream?.getTracks().forEach((t) => t.stop()); await context?.close().catch(() => {}); URL.revokeObjectURL(url); }
}
