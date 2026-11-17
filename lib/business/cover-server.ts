import "server-only";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { randomUUID } from "node:crypto";
import { adminClient } from "@/lib/supabase/admin";
import { AVATAR_BUCKET, AVATAR_SOURCE_BYTES } from "@/lib/profile/avatar";
import { COVER_HEIGHT, COVER_WIDTH, coverUrl } from "./public-page";

/**
 * A business's cover image: re-encoded to a 1200×400 WebP (which also strips EXIF/GPS and any
 * other metadata), stored privately next to avatars and served only while it's the current cover.
 */
export async function decodeCover(file: File): Promise<Buffer> {
  if (!file.size || file.size > AVATAR_SOURCE_BYTES) throw new Error("Choose an image under 10 MB.");
  const body = Buffer.from(await file.arrayBuffer());
  const type = await fileTypeFromBuffer(body).catch(() => undefined);
  if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type.mime)) throw new Error("Choose a JPG, PNG or WebP image.");
  try {
    const image = sharp(body, { limitInputPixels: 40_000_000, animated: false, failOn: "warning" });
    if (((await image.metadata()).pages ?? 1) !== 1) throw new Error("Choose a still image instead of an animation.");
    return await image.rotate().resize(COVER_WIDTH, COVER_HEIGHT, { fit: "cover", position: "attention" }).webp({ quality: 78 }).toBuffer();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Choose")) throw error;
    throw new Error("This image could not be opened. Choose a different JPG, PNG or WebP image.");
  }
}

/** The business's current cover, as an address the page can show (null: none). */
export async function currentCover(agentId: string): Promise<string | null> {
  const { data } = await adminClient().from("business_page_covers").select("id").eq("agent_id", agentId).maybeSingle();
  return data ? coverUrl(data.id) : null;
}

/** Saves a new cover (the old file is queued for deletion by the database). */
export async function saveCover(agentId: string, image: Buffer): Promise<void> {
  const db = adminClient();
  const id = randomUUID();
  const path = `${agentId}/cover-${id}.webp`;
  const stored = await db.storage.from(AVATAR_BUCKET).upload(path, image, { contentType: "image/webp", upsert: false, cacheControl: "0" });
  if (stored.error) throw new Error("Couldn't upload your cover image. Please try again.");
  const { error } = await db.from("business_page_covers").upsert({ agent_id: agentId, id, path, created_at: new Date().toISOString() }, { onConflict: "agent_id" });
  if (error) {
    await db.storage.from(AVATAR_BUCKET).remove([path]);
    throw new Error("Couldn't save your cover image. Your page is unchanged; please try again.");
  }
}

export async function removeCover(agentId: string): Promise<void> {
  await adminClient().from("business_page_covers").delete().eq("agent_id", agentId);
}
