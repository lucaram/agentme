import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import { AVATAR_BUCKET } from "@/lib/profile/avatar";

export const runtime = "nodejs";
/** A business's public page is public: its current cover is visible to anyone, and nothing else is. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  const db = adminClient();
  const { data: cover } = await db.from("business_page_covers").select("path, agent_id").eq("id", id).maybeSingle();
  if (!cover) return new Response(null, { status: 404 });
  const { data: agent } = await db.from("agents").select("id").eq("id", cover.agent_id).eq("type", "business").eq("guest", false).maybeSingle();
  if (!agent) return new Response(null, { status: 404 });
  const { data: file, error } = await db.storage.from(AVATAR_BUCKET).download(cover.path);
  if (error || !file) return new Response(null, { status: 503 });
  return new Response(file, { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
