"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { ChatDialog } from "@/components/chat/ChatDialog";
import { AVATAR_SIZE, AVATAR_SOURCE_BYTES, INITIAL_CROP, avatarGeometry, isImageAvatar, type Crop } from "@/lib/profile/avatar";

type Source = { url: string; owned: boolean };
export function AvatarPicker({ options, value, onChange, business = false }: { options: string[]; value: string; onChange: (value: string) => void; business?: boolean }) {
  const input = useRef<HTMLInputElement>(null); const upload = useRef<HTMLInputElement>(null);
  const [savedCrop, setSavedCrop] = useState<Crop>({ ...INITIAL_CROP });
  const ownedUrls = useRef(new Set<string>());
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState("");
  const [incoming, setIncoming] = useState<Source | null>(null);
  const [source, setSource] = useState<Source | null>(null); const [editing, setEditing] = useState(false); const [error, setError] = useState("");
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { const urls = ownedUrls.current; return () => { for (const url of urls) URL.revokeObjectURL(url); }; }, []);
  useEffect(() => () => { if (source?.owned) URL.revokeObjectURL(source.url); }, [source]);
  useEffect(() => {
    const field = upload.current; const form = field?.form; if (!field) return;
    const sync = () => { const data = new DataTransfer(); if (file) data.items.add(file); field.files = data.files; };
    const reset = () => queueMicrotask(sync);
    sync(); form?.addEventListener("reset", reset); return () => form?.removeEventListener("reset", reset);
  }, [file]);
  const preset = (next: string) => { if (upload.current) upload.current.value = ""; setFile(null); setPreview(""); setSource(null); onChange(next); setError(""); };
  return <div className="space-y-3" data-testid="avatar-picker">
    <input ref={upload} type="file" name="avatar_image" accept="image/webp" hidden tabIndex={-1} />
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose avatar image" className="sr-only" onChange={(event) => {
      const selected = event.target.files?.[0]; event.target.value = ""; if (!selected) return; setError("");
      if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type)) { setError("Choose a JPG, PNG or WebP image."); return; }
      if (selected.size > AVATAR_SOURCE_BYTES) { setError("Choose an image up to 10 MB."); return; }
      // The editor owns a temporary source until Use image; cancelling preserves the current selection.
      const url = URL.createObjectURL(selected); ownedUrls.current.add(url); setEditing(false); setIncoming({ url, owned: true });
    }} />
    <div className="flex flex-wrap items-center gap-4"><div className="text-5xl" data-testid="avatar-preview">{file && preview ? <Image src={preview} alt="Selected avatar preview" width={512} height={512} unoptimized className="h-20 w-20 rounded-full object-cover" /> : <Avatar value={value} />}</div><div className="flex flex-wrap gap-2"><button type="button" className="btn-ghost" onClick={() => input.current?.click()}>Upload photo or logo</button>{(file || isImageAvatar(value)) && <button type="button" className="btn-ghost" onClick={() => { setError(""); if (!source) setSource({ url: value, owned: false }); setEditing(true); }}>Edit image</button>}</div></div>
    <p className="hint">JPG, PNG or WebP · up to 10 MB. Changes are saved with this form.</p>
    <div className="flex flex-wrap gap-2" aria-label="Avatar presets">{options.filter((option) => !isImageAvatar(option)).map((option) => <button key={option} type="button" aria-label={`Avatar ${option}`} aria-pressed={!file && value === option} onClick={() => preset(option)} className={`flex h-10 w-10 items-center justify-center rounded-full border text-xl ${!file && value === option ? "border-accent bg-accent-soft ring-2 ring-accent" : "border-border bg-surface"}`}>{option}</button>)}</div>
    {(file || isImageAvatar(value)) && <button type="button" className="text-sm text-accent underline" onClick={() => preset(options.find((option) => !isImageAvatar(option))!)}>Use a preset instead</button>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {(incoming || editing) && <AvatarCropEditor key={incoming?.url ?? source?.url ?? value} source={incoming?.url ?? source?.url ?? value} business={business} initialCrop={incoming ? undefined : savedCrop} onCancel={() => { if (incoming?.owned) URL.revokeObjectURL(incoming.url); setIncoming(null); setEditing(false); }} onUse={(cropped, selection) => { const url = URL.createObjectURL(cropped); ownedUrls.current.add(url); setPreview(url); setSavedCrop(selection); setFile(cropped); if (incoming) setSource(incoming); setIncoming(null); setEditing(false); }} />}
  </div>;
}

function paint(canvas: HTMLCanvasElement, image: HTMLImageElement, crop: Crop) {
  const size = canvas.width; const context = canvas.getContext("2d"); if (!context) throw new Error("Image editing isn't available in this browser.");
  const geometry = avatarGeometry(image.naturalWidth, image.naturalHeight, crop, size);
  context.clearRect(0, 0, size, size); context.save(); context.translate(size / 2 + geometry.x, size / 2 + geometry.y); context.rotate(crop.rotation * Math.PI / 180); context.scale(geometry.scale, geometry.scale); context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2); context.restore();
}

function AvatarCropEditor({ source, business, initialCrop, onCancel, onUse }: { source: string; business: boolean; initialCrop?: Crop; onCancel: () => void; onUse: (file: File, crop: Crop) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null); const image = useRef<HTMLImageElement | null>(null); const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);
  const [crop, setCrop] = useState<Crop>(initialCrop ?? { ...INITIAL_CROP, fit: business }); const [ready, setReady] = useState(false); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => {
    const picture = new window.Image(); let cancelled = false;
    picture.onload = () => { if (cancelled) return; if (picture.naturalWidth * picture.naturalHeight > 40_000_000) { setError("Choose an image with fewer than 40 million pixels."); return; } image.current = picture; setReady(true); };
    picture.onerror = () => { if (!cancelled) setError("This image could not be opened. Please choose another."); }; picture.src = source;
    return () => { cancelled = true; picture.src = ""; image.current = null; };
  }, [source]);
  useEffect(() => { if (ready && image.current && canvas.current) paint(canvas.current, image.current, crop); }, [ready, crop]);
  const useImage = async () => {
    if (!image.current || !ready) return; setSaving(true); setError("");
    try { const output = document.createElement("canvas"); output.width = AVATAR_SIZE; output.height = AVATAR_SIZE; paint(output, image.current, crop);
      const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error("Couldn't prepare this image.")), "image/webp", 0.85));
      onUse(new File([blob], "avatar.webp", { type: "image/webp" }), crop);
    } catch { setError("Couldn't prepare this image. Please try again."); setSaving(false); }
  };
  return <ChatDialog label="Customise avatar" onClose={() => { if (!saving) onCancel(); }}><div className="space-y-4 p-5"><h2 className="text-lg font-semibold">Customise avatar</h2><p className="hint">Drag to reposition. The circle shows how your avatar will appear.</p>
    <div className="relative mx-auto aspect-square w-full max-w-80 overflow-hidden rounded-2xl border border-border bg-background" onPointerDown={(event) => { if (!ready || saving) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, crop }; }} onPointerMove={(event) => {
      if (!drag.current || !image.current) return; const rect = event.currentTarget.getBoundingClientRect(); const geometry = avatarGeometry(image.current.naturalWidth, image.current.naturalHeight, drag.current.crop, rect.width);
      setCrop({ ...drag.current.crop, x: Math.max(-1, Math.min(1, drag.current.crop.x + (geometry.maxX ? (event.clientX - drag.current.x) / geometry.maxX : 0))), y: Math.max(-1, Math.min(1, drag.current.crop.y + (geometry.maxY ? (event.clientY - drag.current.y) / geometry.maxY : 0))) });
    }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} style={{ touchAction: "none" }}>
      <canvas ref={canvas} width={AVATAR_SIZE} height={AVATAR_SIZE} className="h-full w-full" aria-label="Avatar crop preview" /><div className="pointer-events-none absolute inset-0 rounded-full border-2 border-accent shadow-[0_0_0_100px_rgba(0,0,0,0.55)]" />{!ready && !error && <p role="status" className="absolute inset-0 flex items-center justify-center bg-surface/80 text-sm">Opening image…</p>}
    </div>
    <label className="block space-y-2 text-sm"><span>Zoom</span><input type="range" min="1" max="4" step="0.01" value={crop.zoom} disabled={!ready || saving} onChange={(event) => setCrop((old) => ({ ...old, zoom: Number(event.target.value) }))} className="w-full accent-[var(--accent)]" /></label>
    <div className="flex flex-wrap gap-2"><button type="button" className="btn-ghost text-sm" disabled={!ready || saving} onClick={() => setCrop((old) => ({ ...old, rotation: (old.rotation + 90) % 360, x: 0, y: 0 }))}>Rotate</button><button type="button" className="btn-ghost text-sm" disabled={!ready || saving} onClick={() => setCrop({ ...INITIAL_CROP, fit: true })}>Fit whole {business ? "logo" : "image"}</button><button type="button" className="btn-ghost text-sm" disabled={!ready || saving} onClick={() => setCrop({ ...INITIAL_CROP })}>Reset</button></div>
    <details><summary className="cursor-pointer text-xs text-muted">Position controls</summary><div className="mt-2 space-y-2">{(["x", "y"] as const).map((axis) => <label key={axis} className="block text-xs">{axis === "x" ? "Horizontal position" : "Vertical position"}<input type="range" min="-1" max="1" step="0.01" value={crop[axis]} disabled={!ready || saving} className="block w-full" onChange={(event) => setCrop((old) => ({ ...old, [axis]: Number(event.target.value) }))} /></label>)}</div></details>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}<div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" className="btn-ghost" disabled={saving} onClick={onCancel}>Cancel</button><button type="button" className="btn-primary" disabled={!ready || saving} onClick={useImage}>{saving ? "Preparing…" : "Use image"}</button></div>
  </div></ChatDialog>;
}
