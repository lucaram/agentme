import "server-only";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { adminClient } from "@/lib/supabase/admin";
import { MAX_FILE_BYTES, type AttachmentView } from "./rich";

export const ATTACHMENT_BUCKET = "chat-attachments";
const cleanName = (name: string) => name.normalize("NFKC").replace(/[\x00-\x1f\x7f/\\<>:"|?*]/g, "_").slice(0, 140) || "Attachment";

let decoding = 0;
export async function validateChatFile(file: File, requestedKind?: string) {
  if (decoding >= 2) throw new Error("File processing is busy. Please try again in a moment.");
  decoding++;
  try { return await decodeChatFile(file, requestedKind); } finally { decoding--; }
}
async function decodeChatFile(file: File, requestedKind?: string) {
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error("Choose a file up to 16 MB.");
  let body = Buffer.from(await file.arrayBuffer());
  let name = cleanName(file.name);
  const extension = name.split(".").at(-1)?.toLowerCase();
  let mime = "";
  let kind: AttachmentView["kind"] = "document";
  const detected = await fileTypeFromBuffer(body).catch(() => undefined);
  if (["jpg", "jpeg", "png", "webp"].includes(extension ?? "") && detected?.mime.startsWith("image/") && ["image/jpeg", "image/png", "image/webp"].includes(detected.mime)) {
    body = await sharp(body, { limitInputPixels: 40_000_000, animated: false }).rotate().resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    name = `${name.replace(/\.[^.]+$/, "")}.webp`; mime = "image/webp"; kind = "image";
  } else if (extension === "pdf" && detected?.mime === "application/pdf") {
    // Documents are downloaded, never executed or embedded in the chat.
    if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction|XFA)\b/i.test(body.toString("latin1"))) throw new Error("This PDF contains active content. Export a plain PDF before attaching it.");
    mime = "application/pdf";
  } else if (extension === "txt" && !detected) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error("Choose a plain UTF-8 text file.");
    mime = "text/plain";
  } else if (["mp4", "webm", "m4a", "mp3", "ogg", "wav"].includes(extension ?? "") && detected && ["video/mp4", "video/webm", "audio/webm", "audio/mp4", "audio/x-m4a", "audio/mpeg", "audio/ogg", "audio/opus", "audio/wav", "audio/x-wav"].includes(detected.mime)) {
    kind = requestedKind === "audio" || ["m4a", "mp3", "ogg", "wav"].includes(extension ?? "") ? "audio" : "video";
    mime = kind === "audio" && detected.mime === "video/webm" ? "audio/webm" : detected.mime === "audio/x-m4a" || (kind === "audio" && detected.mime === "video/mp4") ? "audio/mp4" : detected.mime;
    const ext = mime.includes("webm") ? "webm" : mime.includes("ogg") || mime.includes("opus") ? "ogg" : mime.includes("mpeg") ? "mp3" : mime.includes("wav") ? "wav" : kind === "audio" ? "m4a" : "mp4";
    name = `${name.replace(/\.[^.]+$/, "")}.${ext}`;
  } else throw new Error("Attach a photo, MP4/WebM video, audio recording, PDF or plain text file. Executables, archives and active web files aren't accepted.");
  if (!body.length || body.length > MAX_FILE_BYTES) throw new Error("The processed file is too large.");
  return { body, name, mime, kind };
}

/** Expired drafts and deleted-message objects are removed in bounded batches. */
export async function pruneChatAttachments() {
  const db = adminClient();
  const { data: expired } = await db.from("chat_attachments").select("id").is("message_id", null).lt("created_at", new Date(Date.now() - 86400000).toISOString()).limit(100);
  if (expired?.length) await db.from("chat_attachments").delete().in("id", expired.map((a) => a.id));
  const { data: garbage } = await db.from("chat_attachment_gc").select("path").limit(100);
  if (garbage?.length) {
    const { error } = await db.storage.from(ATTACHMENT_BUCKET).remove(garbage.map((a) => a.path));
    if (!error) await db.from("chat_attachment_gc").delete().in("path", garbage.map((a) => a.path));
  }
  await db.from("chat_upload_usage").delete().lt("day", new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10));
}
