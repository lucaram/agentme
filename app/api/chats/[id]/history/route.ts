import { z } from "zod";
import { getUser } from "@/lib/auth";
import { getAgentForUser } from "@/lib/data/agents";
import { createClient } from "@/lib/supabase/server";
import { historyPage, prepareHistory } from "@/lib/chat/history";

const Query = z.object({ mode: z.enum(["initial", "latest", "before", "after", "around", "refresh"]).default("initial"), thread: z.uuid().optional(), anchor: z.uuid().optional(), ids: z.array(z.uuid()).max(50).default([]) });
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(); if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params; const url = new URL(request.url);
  const input = Query.safeParse({ mode: url.searchParams.get("mode") ?? undefined, thread: url.searchParams.get("thread") ?? undefined, anchor: url.searchParams.get("anchor") ?? undefined, ids: url.searchParams.getAll("item") });
  if (!z.uuid().safeParse(id).success || !input.success) return Response.json({ error: "Invalid history request." }, { status: 400 });
  const client = await createClient(); const agent = await getAgentForUser(user.id);
  const { data: conv } = await client.from("conversations").select("*").eq("id", id).maybeSingle();
  if (!conv || !agent) return Response.json({ error: "Conversation unavailable." }, { status: 404 });
  try {
    const page = await historyPage(client, id, input.data.thread ?? null, input.data);
    const bundle = await prepareHistory(client, user.id, agent, conv, input.data.thread ?? null, page);
    return Response.json(bundle, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "Conversation unavailable." }, { status: 404, headers: { "Cache-Control": "private, no-store" } }); }
}
