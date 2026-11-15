import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ReactionDetails } from "@/lib/chat/reactions";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!await getUser()) return Response.json({ error: "Sign in first." }, { status: 401, headers });
  const { id } = await params; const url = new URL(request.url);
  const input = z.object({ id: z.uuid(), message: z.uuid(), offset: z.coerce.number().int().min(0).max(10000) }).safeParse({ id, message: url.searchParams.get("message"), offset: url.searchParams.get("offset") ?? 0 });
  if (!input.success) return Response.json({ error: "Invalid reaction request." }, { status: 400, headers });
  const db = await createClient();
  const { data: message } = await db.from("messages").select("id,visible_to,removed_at").eq("id", input.data.message).eq("conversation_id", id).maybeSingle();
  if (!message || message.visible_to || message.removed_at) return Response.json({ error: "Message unavailable." }, { status: 404, headers });
  const { data, error } = await db.rpc("get_message_reaction_details", { p_message: message.id, p_offset: input.data.offset });
  const parsed = ReactionDetails.safeParse(data);
  if (error || !parsed.success) return Response.json({ error: "Couldn't load reactions." }, { status: 500, headers });
  return Response.json({ ...parsed.data, items: parsed.data.items.slice(0, 50) }, { headers });
}
