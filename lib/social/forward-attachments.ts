import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { ATTACHMENT_BUCKET } from "@/lib/chat/files";
import type { AttachmentView } from "@/lib/chat/rich";

/** Independent private copies: destination recipients never gain access to the source chat. */
export async function copyForwardAttachments(userId: string, conversationId: string, sourceMessageId: string, files: AttachmentView[]) {
  const db = adminClient(); const ids: string[] = []; const paths: string[] = [];
  async function discard() {
    const { data: deleted } = ids.length ? await db.from("chat_attachments").delete().in("id", ids).is("message_id", null).select("path") : { data: [] };
    // Never remove a bound object if a post succeeded but its response was lost.
    const disposable = [...(deleted ?? []).map((file) => file.path), ...paths.filter((path) => !ids.includes(path.split("/").at(-1)!))];
    if (disposable.length) {
      await db.from("chat_attachment_gc").upsert(disposable.map((path) => ({ path })), { onConflict: "path", ignoreDuplicates: true });
      const { error } = await db.storage.from(ATTACHMENT_BUCKET).remove(disposable);
      if (!error) await db.from("chat_attachment_gc").delete().in("path", disposable);
    }
  }
  try {
    if (files.length) {
      const { data: originals } = await db.from("chat_attachments").select("id,path").eq("message_id", sourceMessageId).in("id", files.map((file) => file.id));
      if (originals?.length !== files.length) throw new Error("An attachment is no longer available.");
      for (const file of files) {
        const id = crypto.randomUUID(); const path = `${userId}/${id}`;
        paths.push(path);
        const { error: copyError } = await db.storage.from(ATTACHMENT_BUCKET).copy(originals.find((original) => original.id === file.id)!.path, path);
        if (copyError) throw new Error("Couldn't copy an attachment. Nothing was sent to this chat.");
        const { error } = await db.rpc("register_chat_attachment", { p_id: id, p_conversation: conversationId, p_user: userId, p_path: path, p_name: file.name, p_mime: file.mime, p_kind: file.kind, p_bytes: file.bytes });
        if (error) throw new Error(error.message.includes("limit") ? error.message : "Couldn't save the forwarded attachments.");
        ids.push(id);
      }
    }
    return { ids, discard };
  } catch (error) { await discard(); throw error; }
}
