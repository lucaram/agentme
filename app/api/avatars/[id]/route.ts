import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import { AVATAR_BUCKET } from "@/lib/profile/avatar";

export const runtime = "nodejs";
/** Like the existing public profile, only the currently published avatar is visible. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  const db = adminClient(); const { data: asset } = await db.from("profile_avatar_assets").select("path,agent_id").eq("id", id).maybeSingle();
  if (!asset) return new Response(null, { status: 404 });
  const { data: agent } = await db.from("agents").select("avatar").eq("id", asset.agent_id).eq("avatar", `/api/avatars/${id}`).maybeSingle();
  if (!agent) return new Response(null, { status: 404 });
  const { data: file, error } = await db.storage.from(AVATAR_BUCKET).download(asset.path);
  if (error || !file) return new Response(null, { status: 503 });
  return new Response(file, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
