import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TopicPage } from "@/lib/agents/topic-types";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(); const { id } = await params; const q = new URL(request.url).searchParams;
  const parsed = z.object({ id: z.uuid(), group: z.enum(["needs", "progress", "recent", "older", "search"]), q: z.string().max(80), before: z.iso.datetime({ offset: true }).nullable(), item: z.uuid().nullable(), asOf: z.iso.datetime({ offset: true }) }).refine((v) => Boolean(v.before) === Boolean(v.item)).safeParse({ id, group: q.get("group") ?? "recent", q: q.get("q") ?? "", before: q.get("before"), item: q.get("item"), asOf: q.get("asOf") ?? new Date().toISOString() });
  if (!parsed.success) return new Response(null, { status: 400 });
  const v = parsed.data; const client = await createClient();
  const { data: conversation } = await client.from("conversations").select("id").eq("id", id).eq("kind", "my_agent").maybeSingle();
  if (!conversation) return new Response(null, { status: 404 });
  const { data, error } = await client.rpc("my_agent_topic_page", { p_conversation: id, p_group: v.group, p_query: v.q, p_before: v.before, p_id: v.item, p_as_of: v.asOf }); const page = TopicPage.safeParse(data);
  return Response.json(error || !page.success ? { error: "Couldn't load topics." } : page.data, { status: error || !page.success ? 503 : 200, headers: { "Cache-Control": "private, no-store" } });
}
