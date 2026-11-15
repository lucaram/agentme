import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { ATTACHMENT_BUCKET } from "@/lib/chat/files";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getUser())) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  // RLS rechecks current membership and message visibility on every request.
  const { data: visible } = await (await createClient()).from("chat_attachments").select("id").eq("id", id).maybeSingle();
  if (!visible) return new Response(null, { status: 404 });
  const db = adminClient();
  const { data: file } = await db.from("chat_attachments").select("path,name,mime,kind").eq("id", id).not("message_id", "is", null).maybeSingle();
  if (!file) return new Response(null, { status: 404 });
  const { data: signed } = await db.storage.from(ATTACHMENT_BUCKET).createSignedUrl(file.path, 60);
  if (!signed) return new Response(null, { status: 503 });
  const range = request.headers.get("range");
  if (range && !/^bytes=\d*-\d*$/.test(range)) return new Response(null, { status: 416 });
  const upstream = await fetch(signed.signedUrl, { cache: "no-store", headers: range ? { Range: range } : {} });
  if (!upstream.ok) return new Response(null, { status: upstream.status });
  const headers = new Headers({ "Content-Type": file.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": `${file.kind === "document" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}` });
  for (const key of ["content-length", "content-range", "accept-ranges"]) { const value = upstream.headers.get(key); if (value) headers.set(key, value); }
  return new Response(upstream.body, { status: upstream.status, headers });
}
