import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MentionOption } from "@/lib/chat/mentions";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(); const { id } = await params; const query = new URL(request.url).searchParams.get("q") ?? "";
  if (!z.uuid().safeParse(id).success || query.length > 40) return new Response(null, { status: 400 });
  const db = await createClient(); const { data: conv } = await db.from("conversations").select("kind").eq("id", id).maybeSingle(); if (!conv) return new Response(null, { status: 404 });
  const { data, error } = await db.rpc("mention_suggestions", { p_conversation: id, p_query: query }); const options = MentionOption.array().safeParse(data); if (error || !options.success) return new Response(null, { status: 404 });
  return Response.json({ kind: conv.kind, options: options.data }, { headers: { "Cache-Control": "private, no-store" } });
}
