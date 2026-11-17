import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MentionPage } from "@/lib/chat/mentions";

export async function GET(request: Request) {
  await requireUser(); const query = new URL(request.url).searchParams;
  const cursor = z.object({ before: z.iso.datetime({ offset: true }).nullable(), message: z.uuid().nullable() }).refine((v) => Boolean(v.before) === Boolean(v.message)).safeParse({ before: query.get("before"), message: query.get("message") });
  if (!cursor.success) return new Response(null, { status: 400 });
  const { data, error } = await (await createClient()).rpc("unread_mention_page", { p_before: cursor.data.before, p_message: cursor.data.message });
  const parsed = MentionPage.safeParse(data);
  return Response.json(error || !parsed.success ? { error: "Couldn't load unread mentions." } : parsed.data, { status: error || !parsed.success ? 503 : 200, headers: { "Cache-Control": "private, no-store" } });
}
