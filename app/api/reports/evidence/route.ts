import { createHash } from "node:crypto";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TargetKind } from "@/lib/moderation/types";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" }; const user = await getUser(); if (!user) return Response.json({ error: "Sign in first." }, { status: 401, headers });
  const query = new URL(request.url).searchParams;
  const input = z.object({ kind: TargetKind, target: z.uuid(), before: z.uuid().nullable() }).safeParse({ kind: query.get("kind"), target: query.get("target"), before: query.get("before") });
  if (!input.success) return Response.json({ error: "Invalid target." }, { status: 400, headers });
  const db = await createClient(); const { kind, target, before } = input.data;
  let source: { id: string; title: string | null; description: string | null; kind: string; community_id: string | null } | null = null;
  let focus: { id: string; created_at: string } | null = null;
  let rules: string | null = null; let title: string | null = null; let description: string | null = null;
  if (kind === "message") {
    const { data } = await db.from("messages").select("id,created_at,conversation_id").eq("id", target).is("visible_to", null).is("removed_at", null).maybeSingle();
    if (data) { focus = data; source = (await db.from("conversations").select("id,title,description,kind,community_id").eq("id", data.conversation_id).in("kind", ["dm", "group", "channel", "agent_chat"]).maybeSingle()).data; }
    if (!source) return Response.json({ error: "Not found." }, { status: 404, headers });
  } else if (kind === "group") {
    source = (await db.from("conversations").select("id,title,description,kind,community_id").eq("id", target).eq("kind", "group").maybeSingle()).data;
    if (!source || !(await db.from("conversation_members").select("user_id").eq("conversation_id", target).eq("user_id", user.id).maybeSingle()).data) return Response.json({ error: "Not found." }, { status: 404, headers });
    title = source.title; description = source.description;
  } else {
    const { data } = await db.from("communities").select("name,description,rules").eq("id", target).maybeSingle();
    if (!data || !(await db.from("community_members").select("user_id").eq("community_id", target).eq("user_id", user.id).maybeSingle()).data) return Response.json({ error: "Not found." }, { status: 404, headers });
    title = data.name; description = data.description; rules = data.rules;
  }
  const { data: conversations } = source ? { data: [source] } : await db.from("conversations").select("id").eq("community_id", target);
  if (!conversations?.length) return Response.json({ messages: [], next: null, space: { title, description, rules } }, { headers });
  const base = () => db.from("messages").select("id,content,created_at,sender_user_id,sender_agent_id,is_ai_generated").in("conversation_id", conversations.map((c) => c.id)).is("visible_to", null).is("removed_at", null).or("sender_user_id.not.is.null,sender_agent_id.not.is.null");
  let messages;
  if (focus) {
    const [primary, earlier, later] = await Promise.all([
      base().eq("id", focus.id),
      base().or(`created_at.lt.${focus.created_at},and(created_at.eq.${focus.created_at},id.lt.${focus.id})`).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(2),
      base().or(`created_at.gt.${focus.created_at},and(created_at.eq.${focus.created_at},id.gt.${focus.id})`).order("created_at").order("id").limit(2),
    ]);
    if (!primary.data?.length) return Response.json({ error: "Not found." }, { status: 404, headers });
    messages = [...(earlier.data ?? []).reverse(), ...primary.data, ...(later.data ?? [])];
  } else {
    let rows = base();
    if (before) {
      const anchor = await base().eq("id", before).maybeSingle();
      if (!anchor.data) return Response.json({ error: "Invalid cursor." }, { status: 400, headers });
      rows = rows.or(`created_at.lt.${anchor.data.created_at},and(created_at.eq.${anchor.data.created_at},id.lt.${before})`);
    }
    const result = await rows.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(21);
    if (result.error) return Response.json({ error: "Couldn't load evidence." }, { status: 503, headers });
    messages = result.data ?? [];
  }
  const ids = [...new Set(messages.flatMap((m) => [m.sender_user_id, m.sender_agent_id]).filter((id): id is string => Boolean(id)))];
  const { data: agents } = ids.length ? await db.from("agents").select("id,owner_id,display_name").or(`id.in.(${ids.join(",")}),owner_id.in.(${ids.join(",")})`) : { data: [] };
  return Response.json({ messages: messages.slice(0, 20).map((m) => ({ id: m.id, content: m.content, at: m.created_at, author: agents?.find((a) => a.id === m.sender_agent_id || a.owner_id === m.sender_user_id)?.display_name ?? "Former member", ai: m.is_ai_generated, version: createHash("sha256").update(m.content).digest("hex") })), next: !focus && messages.length > 20 ? messages[19].id : null, space: { title, description, rules } }, { headers });
}
