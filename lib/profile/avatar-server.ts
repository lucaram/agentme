import "server-only";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { randomUUID } from "node:crypto";
import { adminClient } from "@/lib/supabase/admin";
import { hit } from "@/lib/limits";
import { AVATAR_BUCKET, AVATAR_SIZE, AVATAR_UPLOAD_BYTES } from "./avatar";

let processing = 0;
export async function decodeAvatar(file: File): Promise<Buffer> {
  if (!file.size || file.size > AVATAR_UPLOAD_BYTES) throw new Error("Choose a smaller image and crop it before saving.");
  if (processing >= 2) throw new Error("Image processing is busy. Please try again in a moment.");
  processing++;
  try {
    const body = Buffer.from(await file.arrayBuffer());
    const type = await fileTypeFromBuffer(body).catch(() => undefined);
    if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type.mime)) throw new Error("Choose a JPG, PNG or WebP image.");
    const image = sharp(body, { limitInputPixels: 16_000_000, animated: false, failOn: "warning" });
    const info = await image.metadata();
    if ((info.pages ?? 1) !== 1) throw new Error("Choose a still image instead of an animation.");
    // Re-encoding strips EXIF/GPS and other metadata. Never retain the original.
    return await image.rotate().resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
  } catch (error) {
    if (error instanceof Error && /Choose a|processing is busy/.test(error.message)) throw error;
    throw new Error("This image could not be opened. Choose a different JPG, PNG or WebP image.");
  } finally { processing--; }
}

export async function prepareAvatar(form: FormData, actorId: string): Promise<Buffer | null> {
  const file = form.get("avatar_image");
  if (!(file instanceof File) || !file.size) return null;
  if (!(await hit("avatarUploadsPerUser", actorId)).allowed) throw new Error("You've changed images several times. Please try again in a minute.");
  return decodeAvatar(file);
}

export async function commitAvatar(agentId: string, actorId: string, image: Buffer | null, preset: string): Promise<string> {
  const db = adminClient(); const id = randomUUID(); const path = `${agentId}/${id}.webp`;
  if (image) {
    const stored = await db.storage.from(AVATAR_BUCKET).upload(path, image, { contentType: "image/webp", upsert: false, cacheControl: "0" });
    if (stored.error) throw new Error("Couldn't upload your avatar. Please try again.");
  }
  const result = await db.rpc("commit_profile_avatar", { p_agent: agentId, p_actor: actorId, p_preset: image ? null : preset, p_asset: image ? id : null, p_path: image ? path : null });
  if (result.error || !result.data) {
    if (image) await db.storage.from(AVATAR_BUCKET).remove([path]);
    throw new Error("Couldn't save your avatar. Your existing avatar is unchanged; please try again.");
  }
  return result.data;
}

/** Durable cleanup covers replaced images, account deletion and interrupted uploads. */
export async function pruneAvatarFiles() {
  const db = adminClient(); await db.rpc("queue_unused_avatar_files");
  const { data, error } = await db.from("profile_avatar_deletions").select("path").order("created_at").limit(100);
  if (error || !data?.length) return;
  const paths = data.map((row) => row.path);
  const removed = await db.storage.from(AVATAR_BUCKET).remove(paths);
  if (!removed.error) await db.from("profile_avatar_deletions").delete().in("path", paths);
}
