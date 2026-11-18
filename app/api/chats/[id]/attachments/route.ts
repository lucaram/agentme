import { z } from "zod";
import { getUser, requireAgent } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { chatWriteAccess } from "@/lib/chat/access";
import { ATTACHMENT_BUCKET, validateChatFile } from "@/lib/chat/files";
import { MAX_FILE_BYTES } from "@/lib/chat/rich";
import { hit } from "@/lib/limits";
import { agentFileProblem } from "@/lib/agents/file-checks";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (!(await getUser())) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { user, agent } = await requireAgent();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Not found." }, { status: 404 });
  try {
    const conv = await chatWriteAccess(id, user.id, agent.id);
    if (conv.kind === "agent_chat") throw new Error("A business's agent reads text only.");
    if (!(await hit("chatUploadsPerUser", user.id)).allowed) return Response.json({ error: "Too many uploads. Try again in a minute." }, { status: 429 });
    // Bound the stream before multipart parsing; Content-Length is not trusted.
    const reader = request.body?.getReader(); if (!reader) throw new Error("Choose a file.");
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > MAX_FILE_BYTES + 65536) { await reader.cancel(); return Response.json({ error: "Choose a file up to 16 MB." }, { status: 413 }); } chunks.push(value); }
    const multipart = new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("content-type") ?? "" }, body: Buffer.concat(chunks) });
    const form = await multipart.formData(); const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a file.");
    const checked = await validateChatFile(file, String(form.get("kind") ?? ""));
    if (conv.kind === "my_agent") {
      const problem = agentFileProblem({ name: checked.name, mime: checked.mime, kind: checked.kind, bytes: checked.body.length }, checked.body);
      if (problem) throw new Error(problem);
    }
    const attachmentId = crypto.randomUUID(); const path = `${user.id}/${attachmentId}`;
    const db = adminClient();
    const { error } = await db.storage.from(ATTACHMENT_BUCKET).upload(path, checked.body, { contentType: checked.mime, upsert: false });
    if (error) throw new Error("Attachment storage is unavailable. Your draft is still here; please try again.");
    const registered = await db.rpc("register_chat_attachment", { p_id: attachmentId, p_conversation: id, p_user: user.id, p_path: path, p_name: checked.name, p_mime: checked.mime, p_kind: checked.kind, p_bytes: checked.body.length });
    if (registered.error) { await db.storage.from(ATTACHMENT_BUCKET).remove([path]); throw new Error(registered.error.message.includes("limit") ? registered.error.message : "Couldn't save the attachment."); }
    return Response.json({ id: attachmentId, name: checked.name, mime: checked.mime, kind: checked.kind, bytes: checked.body.length });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Couldn't upload this file." }, { status: 400 }); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const user = await getUser(); if (!user) return new Response(null, { status: 401 });
  const { id } = await params; const fileId = new URL(request.url).searchParams.get("file");
  if (!z.uuid().safeParse(fileId).success) return new Response(null, { status: 400 });
  const db = adminClient();
  const { data } = await db.from("chat_attachments").delete().eq("id", fileId!).eq("conversation_id", id).eq("uploader_id", user.id).is("message_id", null).select("path");
  if (data?.length) await db.storage.from(ATTACHMENT_BUCKET).remove(data.map((a) => a.path));
  return new Response(null, { status: 204 });
}
